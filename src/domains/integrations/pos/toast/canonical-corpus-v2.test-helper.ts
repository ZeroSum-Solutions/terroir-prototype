import type {
  InterpretationRequestInput,
  ManualSourceInput,
} from "./canonical-frame-manifest";
import type { NormalizedSnapshotInput } from "./normalized-snapshot";
import { selection } from "./canonical-frame-vectors.test-helper";

const uuid = (digit: string): string => (
  `${digit.repeat(8)}-${digit.repeat(4)}-4${digit.repeat(3)}-8${digit.repeat(3)}-${digit.repeat(12)}`
);

export const MANUAL_BASE = Object.freeze({
  operationId: uuid("1"),
  eventTime: "2024-01-01T00:00:00Z",
  providerRestaurantGuid: uuid("2"),
  orderModifiedDate: "2024-01-02T00:00:00Z",
  normalizedSnapshotRecord: {
    orderGuid: uuid("3"),
    orderVoided: false,
    orderedSelections: [selection(uuid("a"))],
  },
}) satisfies ManualSourceInput;

export const CONTROL_TEXT = Array.from(
  { length: 31 },
  (_value, index) => String.fromCharCode(index + 1),
).join("");

const manualWithUnit = (unit: string): ManualSourceInput => ({
  ...MANUAL_BASE,
  normalizedSnapshotRecord: {
    ...MANUAL_BASE.normalizedSnapshotRecord,
    orderedSelections: [selection(uuid("a"), { unit })],
  },
});

export const MANUAL_ACCEPTED = Object.freeze([
  { name: "manual_all_non_null", input: MANUAL_BASE },
  { name: "manual_all_nullable_null", input: {
    ...MANUAL_BASE, providerRestaurantGuid: null, orderModifiedDate: null,
  } },
  { name: "manual_operation_changed", input: { ...MANUAL_BASE, operationId: uuid("4") } },
  { name: "manual_event_changed", input: {
    ...MANUAL_BASE, eventTime: "2024-02-01T00:00:00Z",
  } },
  { name: "manual_opaque_provider_changed", input: {
    ...MANUAL_BASE, providerRestaurantGuid: "opaque-provider-guid",
  } },
  { name: "manual_modified_changed", input: {
    ...MANUAL_BASE, orderModifiedDate: "2024-02-02T00:00:00Z",
  } },
  { name: "manual_snapshot_changed", input: {
    ...MANUAL_BASE,
    normalizedSnapshotRecord: { ...MANUAL_BASE.normalizedSnapshotRecord, orderVoided: true },
  } },
  { name: "manual_provider_null", input: { ...MANUAL_BASE, providerRestaurantGuid: null } },
  { name: "manual_modified_null", input: { ...MANUAL_BASE, orderModifiedDate: null } },
  { name: "manual_control_text", input: manualWithUnit(CONTROL_TEXT) },
  { name: "manual_astral_text", input: manualWithUnit("wine 🍷") },
  { name: "manual_composed_text", input: manualWithUnit("é") },
  { name: "manual_decomposed_text", input: manualWithUnit("é") },
] as const satisfies readonly Readonly<{ name: string; input: ManualSourceInput }>[]);

export const INTERPRETATION_BASE = Object.freeze({
  operationId: uuid("1"),
  receiptId: uuid("2"),
  conflictId: uuid("3"),
  expectedCurrentInterpretationId: uuid("4"),
  decision: "mapping_review",
  sortedReasonCodeArray: [],
  sourceSelectionGuid: uuid("a"),
  sourceItemGuid: uuid("b"),
  sourceUnit: "ML",
  targetVariantId: uuid("5"),
  targetQuantityToken: "1.00",
  targetQuantityUnit: "BOTTLE",
  approvalState: "unreviewed",
  effectiveFrom: "2024-01-01T00:00:00Z",
  effectiveUntil: "2025-01-01T00:00:00Z",
}) satisfies InterpretationRequestInput;

const serviceBase = Object.freeze({
  ...INTERPRETATION_BASE,
  decision: "before_service",
  approvalState: "approved",
  sourceItemGuid: null,
  sourceUnit: null,
  targetVariantId: null,
  targetQuantityToken: null,
  targetQuantityUnit: null,
  effectiveFrom: null,
  effectiveUntil: null,
}) satisfies InterpretationRequestInput;

export const INTERPRETATION_ACCEPTED = Object.freeze([
  { name: "interpretation_all_optionals_present", input: INTERPRETATION_BASE },
  { name: "interpretation_all_optionals_null", input: {
    ...INTERPRETATION_BASE,
    conflictId: null,
    expectedCurrentInterpretationId: null,
    sourceSelectionGuid: null,
    sourceItemGuid: null,
    sourceUnit: null,
    targetVariantId: null,
    targetQuantityToken: null,
    targetQuantityUnit: null,
    effectiveFrom: null,
    effectiveUntil: null,
  } },
  { name: "interpretation_operation_changed", input: {
    ...INTERPRETATION_BASE, operationId: uuid("6"),
  } },
  { name: "interpretation_receipt_changed", input: {
    ...INTERPRETATION_BASE, receiptId: uuid("6"),
  } },
  { name: "interpretation_conflict_changed", input: {
    ...INTERPRETATION_BASE, conflictId: uuid("6"),
  } },
  { name: "interpretation_expected_changed", input: {
    ...INTERPRETATION_BASE, expectedCurrentInterpretationId: uuid("6"),
  } },
  { name: "interpretation_decision_service_alternative", input: serviceBase },
  { name: "interpretation_decision_after_service", input: {
    ...serviceBase, decision: "after_service",
  } },
  { name: "interpretation_selection_changed", input: {
    ...INTERPRETATION_BASE, sourceSelectionGuid: uuid("c"),
  } },
  { name: "interpretation_item_changed", input: {
    ...INTERPRETATION_BASE, sourceItemGuid: uuid("c"),
  } },
  { name: "interpretation_unit_changed", input: {
    ...INTERPRETATION_BASE, sourceUnit: "L",
  } },
  { name: "interpretation_target_changed", input: {
    ...INTERPRETATION_BASE, targetVariantId: uuid("6"),
  } },
  { name: "interpretation_quantity_changed", input: {
    ...INTERPRETATION_BASE, targetQuantityToken: "1e0",
  } },
  { name: "interpretation_quantity_unit_changed", input: {
    ...INTERPRETATION_BASE, targetQuantityUnit: "ML",
  } },
  { name: "interpretation_approval_changed", input: {
    ...INTERPRETATION_BASE, approvalState: "approved",
  } },
  { name: "interpretation_from_changed", input: {
    ...INTERPRETATION_BASE, effectiveFrom: "2024-02-01T00:00:00Z",
  } },
  { name: "interpretation_until_changed", input: {
    ...INTERPRETATION_BASE, effectiveUntil: "2026-01-01T00:00:00Z",
  } },
  { name: "interpretation_control_text", input: {
    ...INTERPRETATION_BASE, sourceUnit: CONTROL_TEXT,
  } },
  { name: "interpretation_astral_text", input: {
    ...INTERPRETATION_BASE, sourceUnit: "wine 🍷",
  } },
  { name: "interpretation_composed_text", input: {
    ...INTERPRETATION_BASE, sourceUnit: "é",
  } },
  { name: "interpretation_decomposed_text", input: {
    ...INTERPRETATION_BASE, sourceUnit: "é",
  } },
  ...([
    ["conflict", "conflictId"],
    ["expected", "expectedCurrentInterpretationId"],
    ["selection", "sourceSelectionGuid"],
    ["item", "sourceItemGuid"],
    ["unit", "sourceUnit"],
    ["target", "targetVariantId"],
    ["quantity", "targetQuantityToken"],
    ["quantity_unit", "targetQuantityUnit"],
    ["from", "effectiveFrom"],
    ["until", "effectiveUntil"],
  ] as const).map(([label, field]) => ({
    name: `interpretation_${label}_null`,
    input: { ...INTERPRETATION_BASE, [field]: null },
  })),
] as const satisfies readonly Readonly<{
  name: string;
  input: InterpretationRequestInput;
}>[]);

export const HIGH_BIT_SNAPSHOT = Object.freeze({
  orderGuid: uuid("e"),
  orderVoided: false,
  selections: [
    selection(null, { fulfillmentStatus: "é" }),
    selection(null, { fulfillmentStatus: "zz" }),
  ],
}) satisfies NormalizedSnapshotInput;
