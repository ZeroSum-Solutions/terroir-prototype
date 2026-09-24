import { describe, expect, it } from "vitest";

import { isJsonObject } from "./contracts";
import { parseLosslessJson } from "./lossless-json";
import {
  assessAutomatedMapping,
  extractSelections,
  guardNormalizedSnapshot,
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
      "guid":"00000000-0000-4000-8000-000000000001",
      "checks":[{"guid":"00000000-0000-4000-8000-000000000002","selections":[{
        "guid":"00000000-0000-4000-8000-000000000003",
        "item":{"guid":"00000000-0000-4000-8000-000000000004"},
        "quantity":1.2300,
        "unitOfMeasure":"ML",
        "createdDate":"2024-03-28T15:10:00.000Z",
        "modifiedDate":"2024-03-28T15:11:00.000Z",
        "modifiers":[{
          "guid":"00000000-0000-4000-8000-000000000005",
          "item":{"guid":"00000000-0000-4000-8000-000000000006"},
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
        guid: "00000000-0000-4000-8000-000000000003",
        itemGuid: "00000000-0000-4000-8000-000000000004",
        checkGuid: "00000000-0000-4000-8000-000000000002",
        parentGuid: null,
        depth: 0,
        quantityToken: "1.2300",
      }),
      expect.objectContaining({
        guid: "00000000-0000-4000-8000-000000000005",
        itemGuid: "00000000-0000-4000-8000-000000000006",
        checkGuid: "00000000-0000-4000-8000-000000000002",
        parentGuid: "00000000-0000-4000-8000-000000000003",
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
    const extraction = extractSelections(parseOrder(`{
      "guid":"00000000-0000-4000-8000-000000000001",
      "checks":[{"selections":[{
        "guid":"00000000-0000-4000-8000-000000000002",
        "item":{"guid":"00000000-0000-4000-8000-000000000003"},"quantity":1,
        "modifiers":[{
          "guid":"00000000-0000-4000-8000-000000000004",
          "item":{"guid":"00000000-0000-4000-8000-000000000005"},"quantity":1
        }]
      }]}]
    }`));
    expect(selectMappedContributions(extraction, new Map([
      ["00000000-0000-4000-8000-000000000003", "liquid-1"],
      ["00000000-0000-4000-8000-000000000005", "liquid-1"],
    ]))).toEqual({
      contributions: [{
        selectionGuid: "00000000-0000-4000-8000-000000000002",
        liquidId: "liquid-1",
      }],
      issues: ["ancestor_descendant_same_liquid"],
    });
  });

  it("normalizes UUID identity before duplicate detection and preserves both facts", () => {
    const lower = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const upper = lower.toUpperCase();
    const result = guardNormalizedSnapshot({
      orderGuid: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      orderVoided: false,
      selections: [
        {
          guid: upper,
          itemGuid: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
          checkGuid: null,
          parentGuid: null,
          depth: 0,
          quantityToken: "1.00",
          unit: "ML",
          createdDate: "2024-01-01T00:00:00Z",
          modifiedDate: null,
          fulfillmentStatus: null,
          selectionType: null,
          splitOriginGuid: null,
          deferred: false,
          voided: false,
          deleted: false,
          refunded: false,
          excludedReason: null,
        },
        {
          guid: lower,
          itemGuid: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
          checkGuid: null,
          parentGuid: null,
          depth: 0,
          quantityToken: "1.00",
          unit: "ML",
          createdDate: "2024-01-01T00:00:00Z",
          modifiedDate: null,
          fulfillmentStatus: null,
          selectionType: null,
          splitOriginGuid: null,
          deferred: false,
          voided: false,
          deleted: false,
          refunded: false,
          excludedReason: null,
        },
      ],
    });

    expect(result.selections).toHaveLength(2);
    expect(result.selections.map((selection) => selection.guid)).toEqual([lower, lower]);
    expect(result).toMatchObject({
      incomplete: true,
      issues: ["duplicate_selection_guid"],
    });
    expect(selectMappedContributions(result, new Map([
      ["cccccccc-cccc-4ccc-8ccc-cccccccccccc", "liquid-1"],
    ]))).toEqual({
      contributions: [],
      issues: ["duplicate_selection_guid"],
    });
  });

  it("normalizes fixture parent and child identity before ancestor matching", () => {
    const parent = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const child = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const result = extractSelections(parseOrder(`{
      "guid":"cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      "checks":[{"selections":[{
        "guid":"${parent.toUpperCase()}",
        "item":{"guid":"dddddddd-dddd-4ddd-8ddd-dddddddddddd"},
        "quantity":1,
        "modifiers":[{
          "guid":"${child.toUpperCase()}",
          "item":{"guid":"eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"},
          "quantity":1
        }]
      }]}]
    }`));

    expect(result.incomplete).toBe(false);
    expect(result.selections).toEqual([
      expect.objectContaining({ guid: parent, parentGuid: null }),
      expect.objectContaining({ guid: child, parentGuid: parent }),
    ]);
  });
});
