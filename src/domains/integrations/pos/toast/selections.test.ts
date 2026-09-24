import { describe, expect, it } from "vitest";

import { isJsonObject } from "./contracts";
import { parseLosslessJson } from "./lossless-json";
import {
  assessAutomatedMapping,
  extractSelections,
  type SelectionMappingCandidate,
  selectMappedContributions,
} from "./selections";

const parseOrder = (source: string) => {
  const value = parseLosslessJson(new TextEncoder().encode(source));
  if (!isJsonObject(value)) throw new Error("expected order object");
  return value;
};

const approvedMapping = (
  overrides: Partial<Extract<SelectionMappingCandidate, { approvalState: "approved" }>> = {},
): Extract<SelectionMappingCandidate, { approvalState: "approved" }> => ({
  approvalState: "approved",
  conversionId: "conversion-1",
  sourceItemGuid: "item-1",
  sourceUnit: "ML",
  targetVariantId: "variant-1",
  targetFormatId: "format-750ml",
  effectiveFrom: "2024-01-01T00:00:00.000Z",
  effectiveUntil: null,
  reviewedByActorId: "actor-1",
  reviewedAt: "2024-01-01T00:00:00.000Z",
  ...overrides,
});

describe("Toast selection observations", () => {
  it("walks recursive modifiers with parent identity and exact quantity tokens", () => {
    const order = parseOrder(`{
      "checks":[{"guid":"check-1","selections":[{
        "guid":"selection-1",
        "item":{"guid":"item-1"},
        "quantity":1.2300,
        "unitOfMeasure":"ML",
        "createdDate":"2024-03-28T15:10:00.000Z",
        "modifiedDate":"2024-03-28T15:11:00.000Z",
        "modifiers":[{
          "guid":"selection-2",
          "item":{"guid":"item-2"},
          "quantity":2e-3,
          "unitOfMeasure":"L",
          "createdDate":"2024-03-28T15:10:01.000Z"
        }]
      }]}]
    }`);

    const result = extractSelections(order);
    expect(result).toMatchObject({ incomplete: false, issues: [] });
    expect(result.selections).toEqual([
      expect.objectContaining({
        guid: "selection-1",
        itemGuid: "item-1",
        checkGuid: "check-1",
        parentGuid: null,
        depth: 0,
        quantityToken: "1.2300",
      }),
      expect.objectContaining({
        guid: "selection-2",
        itemGuid: "item-2",
        checkGuid: "check-1",
        parentGuid: "selection-1",
        depth: 1,
        quantityToken: "2e-3",
      }),
    ]);
  });

  it("marks depth overflow incomplete instead of silently presenting a complete order", () => {
    let selection: Record<string, unknown> = {
      guid: "selection-9",
      item: { guid: "item-9" },
      quantity: 1,
      unitOfMeasure: "NONE",
      createdDate: "2024-03-28T15:10:09.000Z",
    };
    for (let depth = 8; depth >= 0; depth -= 1) {
      selection = {
        guid: `selection-${depth}`,
        item: { guid: `item-${depth}` },
        quantity: 1,
        unitOfMeasure: "NONE",
        createdDate: `2024-03-28T15:10:0${depth}.000Z`,
        modifiers: [selection],
      };
    }

    const result = extractSelections(
      parseOrder(JSON.stringify({ checks: [{ selections: [selection] }] })),
    );
    expect(result.incomplete).toBe(true);
    expect(result.issues).toContain("modifier_depth_exceeded");
    expect(result.selections).toHaveLength(9);
  });

  it("abstains when identity, unit, occurrence time, or reviewed conversion is missing", () => {
    const [selection] = extractSelections(parseOrder(`{
      "checks":[{"selections":[{
        "guid":"selection-1",
        "quantity":0.5,
        "unitOfMeasure":"BOTTLE",
        "selectionType":"OPEN_ITEM"
      }]}]
    }`)).selections;

    expect(assessAutomatedMapping(selection, null)).toEqual({
      status: "needs_review",
      reasons: [
        "missing_item_guid",
        "unknown_unit",
        "missing_occurrence_time",
        "mapping_not_approved",
        "reason_coded_manual_review",
      ],
    });
  });

  it("accepts mapping only with selection-scoped occurrence time and reviewed conversion", () => {
    const [selection] = extractSelections(parseOrder(`{
      "checks":[{"selections":[{
        "guid":"selection-1",
        "item":{"guid":"item-1"},
        "quantity":150.00,
        "unitOfMeasure":"ML",
        "createdDate":"2024-03-28T15:10:00.000Z"
      }]}]
    }`)).selections;

    expect(assessAutomatedMapping(selection, approvedMapping()))
      .toEqual({ status: "ready", reasons: [] });
  });

  it("does not treat a naked or unreviewed conversion identifier as mapping authority", () => {
    const [selection] = extractSelections(parseOrder(`{
      "checks":[{"selections":[{
        "guid":"selection-1",
        "item":{"guid":"item-1"},
        "quantity":150,
        "unitOfMeasure":"ML",
        "createdDate":"2024-03-28T15:10:00.000Z"
      }]}]
    }`)).selections;

    if (false) {
      // @ts-expect-error A naked conversion ID is not an approved mapping.
      assessAutomatedMapping(selection, { conversionId: "fabricated" });
    }
    expect(assessAutomatedMapping(
      selection,
      { conversionId: "fabricated" } as never,
    )).toEqual({
      status: "needs_review",
      reasons: ["mapping_not_approved"],
    });
    expect(assessAutomatedMapping(selection, {
      approvalState: "approved",
      conversionId: "fabricated",
    } as never)).toEqual({
      status: "needs_review",
      reasons: ["incomplete_approved_mapping"],
    });
    expect(assessAutomatedMapping(selection, {
      approvalState: "unreviewed",
      conversionId: "conversion-1",
    })).toEqual({
      status: "needs_review",
      reasons: ["mapping_not_approved"],
    });
  });

  it.each([
    ["wrong source item", approvedMapping({ sourceItemGuid: "item-2" }), "mapping_item_mismatch"],
    ["wrong source unit", approvedMapping({ sourceUnit: "FL_OZ" }), "mapping_unit_mismatch"],
    [
      "not yet effective",
      approvedMapping({ effectiveFrom: "2024-04-01T00:00:00.000Z" }),
      "mapping_not_yet_effective",
    ],
    [
      "expired",
      approvedMapping({ effectiveUntil: "2024-03-01T00:00:00.000Z" }),
      "mapping_expired",
    ],
  ])("marks an approved but %s mapping unable to automate", (_label, mapping, reason) => {
    const [selection] = extractSelections(parseOrder(`{
      "checks":[{"selections":[{
        "guid":"selection-1",
        "item":{"guid":"item-1"},
        "quantity":150,
        "unitOfMeasure":"ML",
        "createdDate":"2024-03-28T15:10:00.000Z"
      }]}]
    }`)).selections;

    expect(assessAutomatedMapping(selection, mapping)).toEqual({
      status: "needs_review",
      reasons: [reason],
    });
  });

  it("labels deferred and gift-card selections nonphysical without restoring stock", () => {
    const result = extractSelections(parseOrder(`{
      "checks":[{"selections":[
        {"guid":"deferred","deferred":true,"quantity":1},
        {"guid":"gift","selectionType":"TOAST_CARD_RELOAD","quantity":1}
      ]}]
    }`));
    expect(result.selections.map((selection) => selection.excludedReason)).toEqual([
      "deferred",
      "nonphysical_selection_type",
    ]);
  });

  it("allows at most one contribution when an ancestor and modifier map to one liquid", () => {
    const selections = extractSelections(parseOrder(`{
      "checks":[{"selections":[{
        "guid":"parent","item":{"guid":"wine-item"},"quantity":1,
        "modifiers":[{"guid":"modifier","item":{"guid":"wine-option"},"quantity":1}]
      }]}]
    }`)).selections;
    expect(selectMappedContributions(selections, new Map([
      ["wine-item", "liquid-1"],
      ["wine-option", "liquid-1"],
    ]))).toEqual({
      contributions: [{ selectionGuid: "parent", liquidId: "liquid-1" }],
      issues: ["ancestor_descendant_same_liquid"],
    });
  });
});
