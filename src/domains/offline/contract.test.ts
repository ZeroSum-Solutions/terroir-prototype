import { describe, expect, it } from "vitest";
import { OfflineContextResponseSchema } from "./contract";

const validResponse = {
  schemaVersion: 1,
  context: {
    contextId: "10000000-0000-4000-8000-000000000001",
    userId: "10000000-0000-4000-8000-000000000002",
    restaurantId: "10000000-0000-4000-8000-000000000003",
    issuedAt: "2026-09-23T12:00:00.000Z",
    expiresAt: "2026-09-24T00:00:00.000Z",
  },
  projection: {
    kind: "cellar_lookup",
    version: 1,
    asOf: "2026-09-23T12:00:00.000Z",
    rows: [
      {
        wineId: "10000000-0000-4000-8000-000000000004",
        displayName: "Volnay",
        producer: "Maison Example",
        vintage: 2022,
        format: "750ml",
        sealedQuantity: 4,
        placements: [
          {
            binId: "10000000-0000-4000-8000-000000000005",
            label: "A-01",
            sealedQuantity: 3,
          },
        ],
        activeOpenBottleId: "10000000-0000-4000-8000-000000000006",
        openedAt: "2026-09-23T10:00:00.000Z",
        remainingMl: 500,
      },
    ],
  },
} as const;

describe("OfflineContextResponseSchema", () => {
  it("accepts exactly the cost-free lookup contract", () => {
    expect(OfflineContextResponseSchema.parse(validResponse)).toEqual(validResponse);
  });

  it.each([
    ["top-level", { ...validResponse, role: "owner" }],
    [
      "context",
      { ...validResponse, context: { ...validResponse.context, membershipId: "hidden" } },
    ],
    [
      "projection",
      { ...validResponse, projection: { ...validResponse.projection, currentUnitCost: 12 } },
    ],
    [
      "row",
      {
        ...validResponse,
        projection: {
          ...validResponse.projection,
          rows: [{ ...validResponse.projection.rows[0], note: "hidden" }],
        },
      },
    ],
  ])("rejects unexpected %s fields", (_label, value) => {
    expect(OfflineContextResponseSchema.safeParse(value).success).toBe(false);
  });

  it("rejects malformed identifiers, dates, formats, and quantities", () => {
    const row = validResponse.projection.rows[0];
    const malformed = {
      ...validResponse,
      context: { ...validResponse.context, userId: "not-a-uuid" },
      projection: {
        ...validResponse.projection,
        rows: [{ ...row, format: "bottle", sealedQuantity: -1 }],
      },
    };

    expect(OfflineContextResponseSchema.safeParse(malformed).success).toBe(false);
  });

  it("rejects expired, backwards, or longer-than-12-hour display leases", () => {
    for (const expiresAt of [
      "2026-09-23T12:00:00.000Z",
      "2026-09-23T11:59:59.999Z",
      "2026-09-24T00:00:00.001Z",
    ]) {
      expect(OfflineContextResponseSchema.safeParse({
        ...validResponse,
        context: { ...validResponse.context, expiresAt },
      }).success).toBe(false);
    }
  });

  it("requires an active bottle lifecycle to be wholly present or wholly absent", () => {
    const row = validResponse.projection.rows[0];
    const partialLifecycle = {
      ...validResponse,
      projection: {
        ...validResponse.projection,
        rows: [{ ...row, openedAt: null, remainingMl: null }],
      },
    };
    const noLifecycle = {
      ...validResponse,
      projection: {
        ...validResponse.projection,
        rows: [{
          ...row,
          activeOpenBottleId: null,
          openedAt: null,
          remainingMl: null,
        }],
      },
    };

    expect(OfflineContextResponseSchema.safeParse(partialLifecycle).success).toBe(false);
    expect(OfflineContextResponseSchema.safeParse(noLifecycle).success).toBe(true);
  });
});
