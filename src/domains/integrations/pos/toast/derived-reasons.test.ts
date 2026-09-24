import { describe, expect, it } from "vitest";

import { assessAutomatedMapping, type SelectionMappingCandidate } from "./selections";
import { selection } from "./canonical-frame-vectors.test-helper";

const mapping = Object.freeze({
  approvalState: "approved",
  conversionId: "conversion-1",
  sourceItemGuid: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  sourceUnit: "ML",
  targetVariantId: "variant-1",
  targetFormatId: "format-1",
  effectiveFrom: "2024-01-01T00:00:00Z",
  effectiveUntil: "2025-01-01T00:00:00Z",
  reviewedByActorId: "actor-1",
  reviewedAt: "2024-01-01T00:00:00Z",
}) satisfies SelectionMappingCandidate;

describe("derived interpretation reasons", () => {
  it.each([
    ["missing_selection_guid", selection(null), mapping],
    ["missing_quantity", selection("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", {
      quantityToken: null,
    }), mapping],
    ["missing_unit", selection("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", {
      unit: null,
    }), mapping],
    ["invalid_mapping_effective_interval", selection(
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    ), { ...mapping, effectiveUntil: mapping.effectiveFrom }],
  ] as const)("produces %s from the reachable branch", (reason, observed, candidate) => {
    expect(assessAutomatedMapping(observed, candidate).reasons).toContain(reason);
  });
});
