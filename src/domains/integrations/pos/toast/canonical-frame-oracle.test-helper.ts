import { createHash } from "node:crypto";

import type {
  InterpretationRequestInput,
  ManualSourceInput,
} from "./canonical-frame-manifest";
import type {
  NormalizedSnapshotInput,
  SelectionObservation,
} from "./normalized-snapshot";

const PREFIX = new TextEncoder().encode("TERROIR_TOAST");
const utf8 = new TextEncoder();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const TAG = Object.freeze({
  null: 0x00,
  false: 0x01,
  true: 0x02,
  uint: 0x03,
  text: 0x04,
  guid: 0x05,
  number: 0x06,
  timestamp: 0x07,
  array: 0x08,
  snapshot: 0x20,
  selection: 0x21,
  manual: 0x22,
  interpretation: 0x23,
});

export function oracleConcat(...parts: readonly Uint8Array[]): Uint8Array {
  const length = parts.reduce((sum, part) => sum + part.byteLength, 0);
  const result = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.byteLength;
  }
  return result;
}

function oracleU32(value: number): Uint8Array {
  const result = new Uint8Array(4);
  new DataView(result.buffer).setUint32(0, value, false);
  return result;
}

export const oracleNullFrame = (): Uint8Array => Uint8Array.of(TAG.null);
const oracleBooleanFrame = (value: boolean): Uint8Array => Uint8Array.of(
  value ? TAG.true : TAG.false,
);

function scalar(tag: number, value: string | null): Uint8Array {
  if (value === null) return oracleNullFrame();
  const payload = utf8.encode(value);
  return oracleConcat(Uint8Array.of(tag), oracleU32(payload.byteLength), payload);
}

export const oracleTextFrame = (value: string | null): Uint8Array => scalar(TAG.text, value);
const oracleGuidFrame = (value: string | null): Uint8Array => scalar(TAG.guid, value);
const oracleNumberFrame = (value: string | null): Uint8Array => scalar(TAG.number, value);
const oracleTimestampFrame = (value: string | null): Uint8Array => (
  scalar(TAG.timestamp, value)
);

export function oracleArrayFrame(elements: readonly Uint8Array[]): Uint8Array {
  return oracleConcat(Uint8Array.of(TAG.array), oracleU32(elements.length), ...elements);
}

export function oracleRecord(tag: number, fields: readonly Uint8Array[]): Uint8Array {
  return oracleConcat(Uint8Array.of(tag), oracleU32(fields.length), ...fields);
}

export function oracleCompleteFrame(domain: number, root: Uint8Array): Uint8Array {
  return oracleConcat(PREFIX, Uint8Array.of(1, domain), root);
}

const providerGuid = (value: string | null): string | null => (
  value !== null && UUID.test(value) ? value.toLowerCase() : value
);
const applicationUuid = (value: string | null): string | null => (
  value === null ? null : value.toLowerCase()
);

function normalizeSelection(selection: SelectionObservation): SelectionObservation {
  return {
    ...selection,
    guid: providerGuid(selection.guid),
    itemGuid: providerGuid(selection.itemGuid),
    checkGuid: providerGuid(selection.checkGuid),
    parentGuid: providerGuid(selection.parentGuid),
    splitOriginGuid: providerGuid(selection.splitOriginGuid),
  };
}

function oracleSelectionStructure(raw: SelectionObservation): readonly unknown[] {
  const selection = normalizeSelection(raw);
  return [
    selection.guid,
    selection.itemGuid,
    selection.checkGuid,
    selection.parentGuid,
    selection.depth,
    selection.quantityToken,
    selection.unit,
    selection.createdDate,
    selection.modifiedDate,
    selection.fulfillmentStatus,
    selection.selectionType,
    selection.splitOriginGuid,
    selection.deferred,
    selection.voided,
    selection.deleted,
    selection.refunded,
    selection.excludedReason,
  ];
}

export function oracleSnapshotStructure(input: NormalizedSnapshotInput): readonly unknown[] {
  const ordered = input.selections.map((selection) => ({
    frame: oracleSelectionFrame(selection),
    value: oracleSelectionStructure(selection),
  })).sort((left, right) => Buffer.compare(Buffer.from(left.frame), Buffer.from(right.frame)));
  return [providerGuid(input.orderGuid), input.orderVoided, ordered.map(({ value }) => value)];
}

export function oracleSelectionFrame(raw: SelectionObservation): Uint8Array {
  const selection = normalizeSelection(raw);
  return oracleRecord(TAG.selection, [
    oracleGuidFrame(selection.guid),
    oracleGuidFrame(selection.itemGuid),
    oracleGuidFrame(selection.checkGuid),
    oracleGuidFrame(selection.parentGuid),
    oracleConcat(Uint8Array.of(TAG.uint), oracleU32(selection.depth)),
    oracleNumberFrame(selection.quantityToken),
    oracleTextFrame(selection.unit),
    oracleTimestampFrame(selection.createdDate),
    oracleTimestampFrame(selection.modifiedDate),
    oracleTextFrame(selection.fulfillmentStatus),
    oracleTextFrame(selection.selectionType),
    oracleGuidFrame(selection.splitOriginGuid),
    oracleBooleanFrame(selection.deferred),
    oracleBooleanFrame(selection.voided),
    oracleBooleanFrame(selection.deleted),
    oracleBooleanFrame(selection.refunded),
    oracleTextFrame(selection.excludedReason),
  ]);
}

export function oracleSnapshotRoot(input: NormalizedSnapshotInput): Uint8Array {
  const selections = input.selections.map(oracleSelectionFrame)
    .sort((left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right)));
  return oracleRecord(TAG.snapshot, [
    oracleGuidFrame(providerGuid(input.orderGuid)),
    oracleBooleanFrame(input.orderVoided),
    oracleArrayFrame(selections),
  ]);
}

export function oracleSnapshotFrame(input: NormalizedSnapshotInput): Uint8Array {
  return oracleCompleteFrame(0x01, oracleSnapshotRoot(input));
}

export function oracleManualFieldFrames(input: ManualSourceInput): readonly Uint8Array[] {
  return [
    oracleGuidFrame(applicationUuid(input.operationId)),
    oracleTimestampFrame(input.eventTime),
    oracleGuidFrame(providerGuid(input.providerRestaurantGuid)),
    oracleTimestampFrame(input.orderModifiedDate),
    oracleSnapshotRoot({
      orderGuid: input.normalizedSnapshotRecord.orderGuid,
      orderVoided: input.normalizedSnapshotRecord.orderVoided,
      selections: input.normalizedSnapshotRecord.orderedSelections,
    }),
  ];
}

export function oracleManualFrame(input: ManualSourceInput): Uint8Array {
  return oracleCompleteFrame(0x02, oracleRecord(TAG.manual, oracleManualFieldFrames(input)));
}

export function oracleManualStructure(input: ManualSourceInput): readonly unknown[] {
  return [
    applicationUuid(input.operationId),
    input.eventTime,
    providerGuid(input.providerRestaurantGuid),
    input.orderModifiedDate,
    oracleSnapshotStructure({
      orderGuid: input.normalizedSnapshotRecord.orderGuid,
      orderVoided: input.normalizedSnapshotRecord.orderVoided,
      selections: input.normalizedSnapshotRecord.orderedSelections,
    }),
  ];
}

export function oracleInterpretationFieldFrames(
  input: InterpretationRequestInput,
): readonly Uint8Array[] {
  return [
    oracleGuidFrame(applicationUuid(input.operationId)),
    oracleGuidFrame(applicationUuid(input.receiptId)),
    oracleGuidFrame(applicationUuid(input.conflictId)),
    oracleGuidFrame(applicationUuid(input.expectedCurrentInterpretationId)),
    oracleTextFrame(input.decision),
    oracleArrayFrame(input.sortedReasonCodeArray.map(oracleTextFrame)),
    oracleGuidFrame(providerGuid(input.sourceSelectionGuid)),
    oracleGuidFrame(providerGuid(input.sourceItemGuid)),
    oracleTextFrame(input.sourceUnit),
    oracleGuidFrame(applicationUuid(input.targetVariantId)),
    oracleNumberFrame(input.targetQuantityToken),
    oracleTextFrame(input.targetQuantityUnit),
    oracleTextFrame(input.approvalState),
    oracleTimestampFrame(input.effectiveFrom),
    oracleTimestampFrame(input.effectiveUntil),
  ];
}

export function oracleInterpretationFrame(input: InterpretationRequestInput): Uint8Array {
  return oracleCompleteFrame(
    0x03,
    oracleRecord(TAG.interpretation, oracleInterpretationFieldFrames(input)),
  );
}

export function oracleInterpretationStructure(
  input: InterpretationRequestInput,
): readonly unknown[] {
  return [
    applicationUuid(input.operationId),
    applicationUuid(input.receiptId),
    input.conflictId === null ? null : applicationUuid(input.conflictId),
    input.expectedCurrentInterpretationId === null
      ? null
      : applicationUuid(input.expectedCurrentInterpretationId),
    input.decision,
    [...input.sortedReasonCodeArray],
    providerGuid(input.sourceSelectionGuid),
    providerGuid(input.sourceItemGuid),
    input.sourceUnit,
    input.targetVariantId === null ? null : applicationUuid(input.targetVariantId),
    input.targetQuantityToken,
    input.targetQuantityUnit,
    input.approvalState,
    input.effectiveFrom,
    input.effectiveUntil,
  ];
}

export const oracleHex = (value: Uint8Array): string => Buffer.from(value).toString("hex");
export const oracleDigest = (value: Uint8Array): string => (
  createHash("sha256").update(value).digest("hex")
);
