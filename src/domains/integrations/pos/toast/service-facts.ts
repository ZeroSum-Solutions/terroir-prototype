import { SelectionObservation } from "./selections";

export type PhysicalServiceEvidence = Readonly<{
  source: "linked_physical_event" | "authorized_operator";
  state: "before_service" | "after_service";
}>;

export function classifyServiceFacts(
  selection: Pick<
    SelectionObservation,
    "voided" | "deleted" | "refunded" | "fulfillmentStatus"
  >,
  physicalEvidence?: PhysicalServiceEvidence,
) {
  const fulfillment = selection.fulfillmentStatus;
  const kdsState = fulfillment === "NEW" || fulfillment === "HOLD"
    ? "pre_fire"
    : fulfillment === "SENT" || fulfillment === "READY"
      ? "post_fire"
      : "unknown";

  return {
    financial: {
      voided: selection.voided,
      deleted: selection.deleted,
      refunded: selection.refunded,
    },
    posFulfillment: fulfillment,
    kdsState,
    physicalService: physicalEvidence?.state ?? "unknown",
    physicalEvidenceSource: physicalEvidence?.source ?? null,
    restoresPhysicalInventory: false,
  } as const;
}
