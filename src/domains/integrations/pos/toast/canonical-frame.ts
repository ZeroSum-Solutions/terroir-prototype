import { createHash } from "node:crypto";

import {
  isToastNumberToken,
  isToastTimestampToken,
  TOAST_BODY_LIMIT_BYTES,
  TOAST_CANONICAL_COLLECTION_LIMIT,
  TOAST_MODIFIER_DEPTH_LIMIT,
  ToastContractError,
  toastCanonicalTextBytes,
} from "./contracts";
import {
  INTERPRETATION_APPROVAL_STATES,
  INTERPRETATION_DECISIONS,
  INTERPRETATION_FIELDS,
  MANUAL_SOURCE_FIELDS,
  SELECTION_FIELDS,
  SNAPSHOT_FIELDS,
  TOAST_FRAME_DOMAINS,
  TOAST_FRAME_TAGS,
  TOAST_FRAME_VERSION,
  type InterpretationRequestInput,
  type ManualSourceInput,
} from "./canonical-frame-manifest";
import {
  guardNormalizedSnapshot,
  normalizeApplicationUuid,
  normalizeProviderGuidEvidence,
  type GuardedNormalizedSnapshot,
  type SelectionObservation,
} from "./normalized-snapshot";

export * from "./canonical-frame-manifest";

const PREFIX = new TextEncoder().encode("TERROIR_TOAST");

function fail(code: string, message: string): never {
  throw new ToastContractError(code, message);
}

function assertExactKeys(
  value: object,
  expected: readonly string[],
  recordName: string,
): void {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  if (actual.length !== sortedExpected.length ||
      actual.some((key, index) => key !== sortedExpected[index])) {
    fail("invalid_canonical_record", `${recordName} has unexpected fields`);
  }
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const length = parts.reduce((sum, part) => sum + part.length, 0);
  if (length > TOAST_BODY_LIMIT_BYTES) fail("canonical_frame_too_large", "frame exceeds limit");
  const result = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

function u32(value: number): Uint8Array {
  if (!Number.isSafeInteger(value) || value < 0 || value > 0xffff_ffff) {
    return fail("invalid_canonical_uint", "unsigned integer is out of range");
  }
  return Uint8Array.of(value >>> 24, value >>> 16, value >>> 8, value);
}

function strictBytes(value: string): Uint8Array {
  return toastCanonicalTextBytes(value);
}

function taggedText(tag: number, value: string): Uint8Array {
  const payload = strictBytes(value);
  return concat([Uint8Array.of(tag), u32(payload.length), payload]);
}

const nullFrame = () => Uint8Array.of(TOAST_FRAME_TAGS.null);
const boolFrame = (value: boolean) => {
  if (typeof value !== "boolean") {
    return fail("invalid_canonical_boolean", "boolean field has the wrong type");
  }
  return Uint8Array.of(value ? TOAST_FRAME_TAGS.true : TOAST_FRAME_TAGS.false);
};
const guidFrame = (value: string | null) => value === null
  ? nullFrame()
  : taggedText(TOAST_FRAME_TAGS.guid, value);
const textFrame = (value: string | null) => value === null
  ? nullFrame()
  : taggedText(TOAST_FRAME_TAGS.text, value);
const timestampFrame = (value: string | null) => {
  if (value === null) return nullFrame();
  strictBytes(value);
  if (!isToastTimestampToken(value)) {
    return fail("invalid_timestamp_token", "timestamp token is invalid");
  }
  return taggedText(TOAST_FRAME_TAGS.timestamp, value);
};
const numberFrame = (value: string | null) => {
  if (value === null) return nullFrame();
  strictBytes(value);
  if (!isToastNumberToken(value)) {
    return fail("invalid_number_token", "lossless number token is invalid");
  }
  return taggedText(TOAST_FRAME_TAGS.number, value);
};
const uintFrame = (value: number) => concat([Uint8Array.of(TOAST_FRAME_TAGS.uint), u32(value)]);

function record(tag: number, fields: readonly Uint8Array[]): Uint8Array {
  return concat([Uint8Array.of(tag), u32(fields.length), ...fields]);
}

function array(elements: readonly Uint8Array[]): Uint8Array {
  if (elements.length > TOAST_CANONICAL_COLLECTION_LIMIT) {
    return fail("canonical_collection_too_large", "array exceeds item limit");
  }
  return concat([Uint8Array.of(TOAST_FRAME_TAGS.array), u32(elements.length), ...elements]);
}

export function compareCanonicalBytes(left: Uint8Array, right: Uint8Array): number {
  const length = Math.min(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    if (left[index] !== right[index]) return left[index] - right[index];
  }
  return left.length - right.length;
}

function selectionFrame(selection: SelectionObservation): Uint8Array {
  assertExactKeys(selection, SELECTION_FIELDS.map(({ name }) => name), "selection");
  if (selection.depth > TOAST_MODIFIER_DEPTH_LIMIT) {
    return fail("modifier_depth_exceeded", "selection depth exceeds limit");
  }
  return record(TOAST_FRAME_TAGS.selection, [
    guidFrame(selection.guid),
    guidFrame(selection.itemGuid),
    guidFrame(selection.checkGuid),
    guidFrame(selection.parentGuid),
    uintFrame(selection.depth),
    numberFrame(selection.quantityToken),
    textFrame(selection.unit),
    timestampFrame(selection.createdDate),
    timestampFrame(selection.modifiedDate),
    textFrame(selection.fulfillmentStatus),
    textFrame(selection.selectionType),
    guidFrame(selection.splitOriginGuid),
    boolFrame(selection.deferred),
    boolFrame(selection.voided),
    boolFrame(selection.deleted),
    boolFrame(selection.refunded),
    textFrame(selection.excludedReason),
  ]);
}

function snapshotRoot(snapshot: GuardedNormalizedSnapshot): Uint8Array {
  if (!snapshot.orderGuid) fail("missing_order_guid", "orderGuid is required");
  const selections = snapshot.selections.map(selectionFrame).sort(compareCanonicalBytes);
  return record(TOAST_FRAME_TAGS.snapshot, [
    guidFrame(snapshot.orderGuid),
    boolFrame(snapshot.orderVoided),
    array(selections),
  ]);
}

function completeFrame(domain: number, root: Uint8Array): Uint8Array {
  return concat([PREFIX, Uint8Array.of(TOAST_FRAME_VERSION, domain), root]);
}

export function encodeNormalizedSnapshotFrame(
  snapshot: GuardedNormalizedSnapshot,
): Uint8Array {
  return completeFrame(TOAST_FRAME_DOMAINS.normalizedSnapshot, snapshotRoot(snapshot));
}

export function encodeManualSourceFrame(input: ManualSourceInput) {
  assertExactKeys(input, MANUAL_SOURCE_FIELDS.map(({ name }) => name), "manual source");
  assertExactKeys(
    input.normalizedSnapshotRecord,
    SNAPSHOT_FIELDS.map(({ name }) => name),
    "normalized snapshot",
  );
  const normalizedSnapshot = guardNormalizedSnapshot({
    orderGuid: input.normalizedSnapshotRecord.orderGuid,
    orderVoided: input.normalizedSnapshotRecord.orderVoided,
    selections: input.normalizedSnapshotRecord.orderedSelections,
  });
  const providerGuid = normalizeProviderGuidEvidence(input.providerRestaurantGuid);
  const issues = Object.freeze([
    ...new Set([
      ...normalizedSnapshot.issues,
      ...(providerGuid.issue ? [providerGuid.issue] : []),
    ]),
  ].sort());
  const incomplete = issues.length > 0;
  const root = record(TOAST_FRAME_TAGS.manualSource, [
    guidFrame(normalizeApplicationUuid(input.operationId, "operationId")),
    timestampFrame(input.eventTime),
    guidFrame(providerGuid.value),
    timestampFrame(input.orderModifiedDate),
    snapshotRoot(normalizedSnapshot),
  ]);
  return Object.freeze({
    frame: completeFrame(TOAST_FRAME_DOMAINS.manualSource, root),
    normalizedSnapshot,
    issues,
    incomplete,
  });
}

function optionalApplicationUuid(value: string | null, field: string): string | null {
  return value === null ? null : normalizeApplicationUuid(value, field);
}

function interpretationProviderGuid(value: string | null, field: string): string | null {
  const normalized = normalizeProviderGuidEvidence(value);
  if (normalized.issue) fail("invalid_provider_guid", `${field} must be a UUID`);
  return normalized.value;
}

function includesLiteral<const Values extends readonly string[]>(
  values: Values,
  candidate: string,
): candidate is Values[number] {
  return values.includes(candidate);
}

function validateInterpretationVocabulary(input: InterpretationRequestInput): void {
  if (!includesLiteral(INTERPRETATION_DECISIONS, input.decision)) {
    fail("unknown_interpretation_decision", "decision is not allowlisted");
  }
  if (!includesLiteral(INTERPRETATION_APPROVAL_STATES, input.approvalState)) {
    fail("unknown_interpretation_approval", "approvalState is not allowlisted");
  }
  if (input.decision === "mapping_review") return;
  if (input.approvalState !== "approved" || input.sourceSelectionGuid === null) {
    fail(
      "invalid_service_classification",
      "service classification requires approved selection authority",
    );
  }
  const mappingOnlyFields = [
    input.sourceItemGuid,
    input.sourceUnit,
    input.targetVariantId,
    input.targetQuantityToken,
    input.targetQuantityUnit,
    input.effectiveFrom,
    input.effectiveUntil,
  ];
  if (mappingOnlyFields.some((value) => value !== null)) {
    fail(
      "invalid_service_classification",
      "service classification cannot carry mapping fields",
    );
  }
}

export function encodeInterpretationRequestFrame(
  input: InterpretationRequestInput,
): Uint8Array {
  assertExactKeys(input, INTERPRETATION_FIELDS.map(({ name }) => name), "interpretation");
  if (input.sortedReasonCodeArray.length > TOAST_CANONICAL_COLLECTION_LIMIT) {
    fail("canonical_collection_too_large", "reason count exceeds limit");
  }
  for (const value of [
    input.operationId,
    input.receiptId,
    input.conflictId,
    input.expectedCurrentInterpretationId,
    input.decision,
    ...input.sortedReasonCodeArray,
    input.sourceSelectionGuid,
    input.sourceItemGuid,
    input.sourceUnit,
    input.targetVariantId,
    input.targetQuantityToken,
    input.targetQuantityUnit,
    input.approvalState,
    input.effectiveFrom,
    input.effectiveUntil,
  ]) {
    if (value !== null) strictBytes(value);
  }
  validateInterpretationVocabulary(input);
  const reasonFrames = input.sortedReasonCodeArray.map((reason) => textFrame(reason));
  for (let index = 1; index < reasonFrames.length; index += 1) {
    const comparison = compareCanonicalBytes(reasonFrames[index - 1], reasonFrames[index]);
    if (comparison > 0) {
      fail("unsorted_reason_codes", "reason codes must be in canonical byte order");
    }
    if (comparison === 0) {
      fail("duplicate_reason_code", "reason codes must be unique");
    }
  }
  if (input.sortedReasonCodeArray.length !== 0) {
    fail("unknown_caller_reason", "v1 does not accept caller-authored reasons");
  }
  const root = record(TOAST_FRAME_TAGS.interpretation, [
    guidFrame(normalizeApplicationUuid(input.operationId, "operationId")),
    guidFrame(normalizeApplicationUuid(input.receiptId, "receiptId")),
    guidFrame(optionalApplicationUuid(input.conflictId, "conflictId")),
    guidFrame(optionalApplicationUuid(
      input.expectedCurrentInterpretationId,
      "expectedCurrentInterpretationId",
    )),
    textFrame(input.decision),
    array(reasonFrames),
    guidFrame(interpretationProviderGuid(input.sourceSelectionGuid, "sourceSelectionGuid")),
    guidFrame(interpretationProviderGuid(input.sourceItemGuid, "sourceItemGuid")),
    textFrame(input.sourceUnit),
    guidFrame(optionalApplicationUuid(input.targetVariantId, "targetVariantId")),
    numberFrame(input.targetQuantityToken),
    textFrame(input.targetQuantityUnit),
    textFrame(input.approvalState),
    timestampFrame(input.effectiveFrom),
    timestampFrame(input.effectiveUntil),
  ]);
  return completeFrame(TOAST_FRAME_DOMAINS.interpretationRequest, root);
}

export function sha256Hex(frame: Uint8Array): string {
  return createHash("sha256").update(frame).digest("hex");
}

export function frameHex(frame: Uint8Array): string {
  return Buffer.from(frame).toString("hex");
}
