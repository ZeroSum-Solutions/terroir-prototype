import type { SelectionObservation } from "./normalized-snapshot";

export const TOAST_FRAME_VERSION = 1;
export const TOAST_FRAME_CORPUS_VERSION = 1;
export const TOAST_FRAME_DOMAINS = Object.freeze({
  normalizedSnapshot: 0x01,
  manualSource: 0x02,
  interpretationRequest: 0x03,
});
export const TOAST_FRAME_TAGS = Object.freeze({
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
  manualSource: 0x22,
  interpretation: 0x23,
});

type FieldTag = "text" | "guid" | "number" | "timestamp" | "uint" |
  "boolean" | "array" | "snapshot";
const field = <Name extends string, Tag extends FieldTag, Nullable extends boolean>(
  name: Name,
  tag: Tag,
  nullable: Nullable,
) => Object.freeze({ name, tag, nullable });

export const SNAPSHOT_FIELDS = Object.freeze([
  field("orderGuid", "guid", false),
  field("orderVoided", "boolean", false),
  field("orderedSelections", "array", false),
] as const);

export const SELECTION_FIELDS = Object.freeze([
  field("guid", "guid", true),
  field("itemGuid", "guid", true),
  field("checkGuid", "guid", true),
  field("parentGuid", "guid", true),
  field("depth", "uint", false),
  field("quantityToken", "number", true),
  field("unit", "text", true),
  field("createdDate", "timestamp", true),
  field("modifiedDate", "timestamp", true),
  field("fulfillmentStatus", "text", true),
  field("selectionType", "text", true),
  field("splitOriginGuid", "guid", true),
  field("deferred", "boolean", false),
  field("voided", "boolean", false),
  field("deleted", "boolean", false),
  field("refunded", "boolean", false),
  field("excludedReason", "text", true),
] as const);

export const MANUAL_SOURCE_FIELDS = Object.freeze([
  field("operationId", "guid", false),
  field("eventTime", "timestamp", false),
  field("providerRestaurantGuid", "guid", true),
  field("orderModifiedDate", "timestamp", true),
  field("normalizedSnapshotRecord", "snapshot", false),
] as const);

export const INTERPRETATION_FIELDS = Object.freeze([
  field("operationId", "guid", false),
  field("receiptId", "guid", false),
  field("conflictId", "guid", true),
  field("expectedCurrentInterpretationId", "guid", true),
  field("decision", "text", false),
  field("sortedReasonCodeArray", "array", false),
  field("sourceSelectionGuid", "guid", true),
  field("sourceItemGuid", "guid", true),
  field("sourceUnit", "text", true),
  field("targetVariantId", "guid", true),
  field("targetQuantityToken", "number", true),
  field("targetQuantityUnit", "text", true),
  field("approvalState", "text", false),
  field("effectiveFrom", "timestamp", true),
  field("effectiveUntil", "timestamp", true),
] as const);

export const INTERPRETATION_DECISIONS = Object.freeze([
  "after_service", "before_service", "mapping_review",
] as const);
export const INTERPRETATION_APPROVAL_STATES = Object.freeze([
  "approved", "unreviewed",
] as const);
export const INTERPRETATION_CALLER_REASON_CODES = Object.freeze([] as const);
export const INTERPRETATION_DERIVED_RESULT_REASONS = Object.freeze([
  "missing_unit",
  "unknown_unit",
  "mapping_expired",
  "missing_quantity",
  "missing_item_guid",
  "mapping_not_approved",
  "mapping_item_mismatch",
  "mapping_unit_mismatch",
  "missing_selection_guid",
  "missing_occurrence_time",
  "mapping_not_yet_effective",
  "reason_coded_manual_review",
  "incomplete_approved_mapping",
  "invalid_mapping_effective_interval",
] as const);

export type InterpretationDecision = typeof INTERPRETATION_DECISIONS[number];
export type InterpretationApprovalState = typeof INTERPRETATION_APPROVAL_STATES[number];
export type InterpretationDerivedResultReason =
  typeof INTERPRETATION_DERIVED_RESULT_REASONS[number];

export type ManualSourceInput = Readonly<{
  operationId: string;
  eventTime: string;
  providerRestaurantGuid: string | null;
  orderModifiedDate: string | null;
  normalizedSnapshotRecord: Readonly<{
    orderGuid: string;
    orderVoided: boolean;
    orderedSelections: readonly SelectionObservation[];
  }>;
}>;

export type InterpretationRequestInput = Readonly<{
  operationId: string;
  receiptId: string;
  conflictId: string | null;
  expectedCurrentInterpretationId: string | null;
  decision: InterpretationDecision;
  sortedReasonCodeArray: readonly string[];
  sourceSelectionGuid: string | null;
  sourceItemGuid: string | null;
  sourceUnit: string | null;
  targetVariantId: string | null;
  targetQuantityToken: string | null;
  targetQuantityUnit: string | null;
  approvalState: InterpretationApprovalState;
  effectiveFrom: string | null;
  effectiveUntil: string | null;
}>;
