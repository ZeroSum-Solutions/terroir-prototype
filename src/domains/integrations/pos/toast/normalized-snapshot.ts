import {
  TOAST_CANONICAL_COLLECTION_LIMIT,
  ToastContractError,
  toastCanonicalTextBytes,
} from "./contracts";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const GUARDED_SNAPSHOT = Symbol("guarded Toast snapshot");

export type SelectionObservation = Readonly<{
  guid: string | null;
  itemGuid: string | null;
  checkGuid: string | null;
  parentGuid: string | null;
  depth: number;
  quantityToken: string | null;
  unit: string | null;
  createdDate: string | null;
  modifiedDate: string | null;
  fulfillmentStatus: string | null;
  selectionType: string | null;
  splitOriginGuid: string | null;
  deferred: boolean;
  voided: boolean;
  deleted: boolean;
  refunded: boolean;
  excludedReason: "deferred" | "nonphysical_selection_type" | null;
}>;

export type NormalizedSnapshotInput = Readonly<{
  orderGuid: string;
  orderVoided: boolean;
  selections: readonly SelectionObservation[];
}>;

export type GuardedNormalizedSnapshot = Readonly<{
  orderGuid: string;
  orderVoided: boolean;
  selections: readonly SelectionObservation[];
  issues: readonly string[];
  incomplete: boolean;
  [GUARDED_SNAPSHOT]: true;
}>;

export type NormalizedGuidEvidence = Readonly<{
  value: string | null;
  issue: "invalid_provider_guid" | null;
}>;

export function normalizeProviderGuidEvidence(
  value: string | null,
): NormalizedGuidEvidence {
  if (value === null) return { value, issue: null };
  toastCanonicalTextBytes(value);
  if (UUID_PATTERN.test(value)) return { value: value.toLowerCase(), issue: null };
  return { value, issue: "invalid_provider_guid" };
}

export function normalizeApplicationUuid(value: string, field: string): string {
  toastCanonicalTextBytes(value);
  if (!UUID_PATTERN.test(value)) {
    throw new ToastContractError("invalid_application_uuid", `${field} must be a UUID`);
  }
  return value.toLowerCase();
}

const textEncoder = new TextEncoder();

function compareTextBytes(left: string, right: string): number {
  const leftBytes = textEncoder.encode(left);
  const rightBytes = textEncoder.encode(right);
  const length = Math.min(leftBytes.length, rightBytes.length);
  for (let index = 0; index < length; index += 1) {
    if (leftBytes[index] !== rightBytes[index]) {
      return leftBytes[index] - rightBytes[index];
    }
  }
  return leftBytes.length - rightBytes.length;
}

function normalizedGuid(
  value: string | null,
  issues: string[],
): string | null {
  const normalized = normalizeProviderGuidEvidence(value);
  if (normalized.issue) issues.push(normalized.issue);
  return normalized.value;
}

function requireBoolean(value: unknown, field: string): asserts value is boolean {
  if (typeof value !== "boolean") {
    throw new ToastContractError(
      "invalid_snapshot_boolean",
      `${field} must be a boolean`,
    );
  }
}

export function guardNormalizedSnapshot(
  input: NormalizedSnapshotInput,
  additionalIssues: readonly string[] = [],
): GuardedNormalizedSnapshot {
  if (input.selections.length > TOAST_CANONICAL_COLLECTION_LIMIT) {
    throw new ToastContractError(
      "canonical_collection_too_large",
      "snapshot selection count exceeds limit",
    );
  }
  requireBoolean(input.orderVoided, "orderVoided");
  const issues = [...additionalIssues];
  const normalizedOrderGuid = normalizeProviderGuidEvidence(input.orderGuid);
  if (!input.orderGuid) issues.push("missing_order_guid");
  else if (normalizedOrderGuid.issue) issues.push(normalizedOrderGuid.issue);

  const seen = new Set<string>();
  const selections = input.selections.map((selection, index) => {
    requireBoolean(selection.deferred, `selections[${index}].deferred`);
    requireBoolean(selection.voided, `selections[${index}].voided`);
    requireBoolean(selection.deleted, `selections[${index}].deleted`);
    requireBoolean(selection.refunded, `selections[${index}].refunded`);
    const guid = normalizedGuid(selection.guid, issues);
    if (guid && seen.has(guid)) issues.push("duplicate_selection_guid");
    if (guid) seen.add(guid);
    return Object.freeze({
      ...selection,
      guid,
      itemGuid: normalizedGuid(selection.itemGuid, issues),
      checkGuid: normalizedGuid(selection.checkGuid, issues),
      parentGuid: normalizedGuid(selection.parentGuid, issues),
      splitOriginGuid: normalizedGuid(selection.splitOriginGuid, issues),
    });
  });
  const uniqueIssues = Object.freeze([...new Set(issues)].sort(compareTextBytes));
  const frozenSelections = Object.freeze(selections);
  const incomplete = uniqueIssues.length > 0;

  return Object.freeze({
    orderGuid: normalizedOrderGuid.value ?? input.orderGuid,
    orderVoided: input.orderVoided,
    selections: frozenSelections,
    issues: uniqueIssues,
    incomplete,
    [GUARDED_SNAPSHOT]: true as const,
  });
}
