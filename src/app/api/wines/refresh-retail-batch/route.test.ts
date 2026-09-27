import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireMembership: vi.fn(),
  resolveSiteCostReadAccess: vi.fn(),
  readInventoryCosts: vi.fn(),
  fetchRetailPrices: vi.fn(),
  captureException: vi.fn(),
  captureMessage: vi.fn(),
}));

vi.mock("@/lib/api/auth", () => ({
  requireMembership: mocks.requireMembership,
}));

vi.mock("@/lib/api/site-capability", () => ({
  resolveSiteCostReadAccess: mocks.resolveSiteCostReadAccess,
}));

vi.mock("@/lib/staff-cost/protected-readers", () => ({
  readInventoryCosts: mocks.readInventoryCosts,
}));

vi.mock("@/lib/wine-intelligence/wine-searcher", () => ({
  fetchRetailPrices: mocks.fetchRetailPrices,
}));

vi.mock("@sentry/nextjs", () => ({
  captureException: mocks.captureException,
  captureMessage: mocks.captureMessage,
}));

import { POST } from "./route";

const RESTAURANT_ID = "10000000-0000-4000-8000-000000000001";
const WINE_ID = "20000000-0000-4000-8000-000000000002";
const ITEM_ID = "30000000-0000-4000-8000-000000000003";

function makeSupabase() {
  let retailRefreshedAt: string | null = null;
  const updates: Array<Record<string, unknown>> = [];

  const from = vi.fn((table: string) => {
    const chain = {
      select: vi.fn(() => chain),
      eq: vi.fn(() => chain),
      not: vi.fn(() => chain),
      or: vi.fn(() => chain),
      in: vi.fn(() => chain),
      limit: vi.fn(async () => ({
        data: retailRefreshedAt === null
          ? [{ id: WINE_ID, lwin_id: "1010101", retail_refreshed_at: null }]
          : [],
        error: null,
      })),
      order: vi.fn(async () => ({ data: [], error: null })),
      update: vi.fn((values: Record<string, unknown>) => {
        updates.push(values);
        if (typeof values.retail_refreshed_at === "string") {
          retailRefreshedAt = values.retail_refreshed_at;
        }
        return chain;
      }),
    };

    if (table !== "wines") {
      throw new Error(`Unexpected table: ${table}`);
    }
    return chain;
  });

  return { from, updates };
}

describe("POST /api/wines/refresh-retail-batch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("WINE_SEARCHER_API_KEY", "configured");
    mocks.resolveSiteCostReadAccess.mockResolvedValue(false);
    mocks.readInventoryCosts.mockResolvedValue([]);
  });

  it("does not re-select an average-only wine on a consecutive batch run", async () => {
    const supabase = makeSupabase();
    mocks.requireMembership.mockResolvedValue({
      supabase,
      restaurantId: RESTAURANT_ID,
      role: "owner",
    });
    mocks.fetchRetailPrices.mockResolvedValue({
      retailMin: 20,
      retailMax: 40,
      retailMedian: 30,
      retailMedianBasis: "average",
      retailerCount: 3,
      refreshedAt: new Date("2026-08-26T12:00:00.000Z"),
    });

    const firstResponse = await POST();
    const secondResponse = await POST();

    expect(await firstResponse.json()).toMatchObject({
      total: 1,
      refreshed: 0,
      skipped: 1,
    });
    expect(supabase.updates).toEqual([
      { retail_refreshed_at: "2026-08-26T12:00:00.000Z" },
    ]);
    expect(await secondResponse.json()).toMatchObject({
      total: 0,
      refreshed: 0,
      skipped: 0,
    });
    expect(mocks.fetchRetailPrices).toHaveBeenCalledTimes(1);
  });

  it.each(["margin.read only", "pricing.manage only", "no pricing capability"])(
    "keeps a manager's retail refresh useful with %s and reports the cost check as restricted",
    async () => {
      const supabase = makeSupabase();
      mocks.requireMembership.mockResolvedValue({
        supabase,
        restaurantId: RESTAURANT_ID,
        role: "manager",
      });
      mocks.fetchRetailPrices.mockResolvedValue({
        retailMin: 20,
        retailMax: 40,
        retailMedian: 30,
        retailMedianBasis: "median",
        retailerCount: 3,
        refreshedAt: new Date("2026-09-26T12:00:00.000Z"),
      });

      const response = await POST();

      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        refreshed: 1,
        costSanityCheck: "restricted",
      });
      expect(mocks.readInventoryCosts).not.toHaveBeenCalled();
      expect(mocks.fetchRetailPrices).toHaveBeenCalledWith({ lwinId: "1010101" });
      expect(supabase.from).not.toHaveBeenCalledWith("inventory_items");
    },
  );

  it("uses the exact-site private reader for a cost.read-only manager and keeps cost out of provider/log/response", async () => {
    const supabase = makeSupabase();
    mocks.requireMembership.mockResolvedValue({
      supabase,
      restaurantId: RESTAURANT_ID,
      role: "manager",
    });
    mocks.resolveSiteCostReadAccess.mockResolvedValue(true);
    mocks.readInventoryCosts.mockResolvedValue([
      {
        inventory_item_id: ITEM_ID,
        wine_id: WINE_ID,
        invoice_scan_id: null,
        unit_cost: 5,
        currency: "USD",
        added_at: "2026-09-25T12:00:00.000Z",
      },
    ]);
    mocks.fetchRetailPrices.mockResolvedValue({
      retailMin: 70,
      retailMax: 90,
      retailMedian: 80,
      retailMedianBasis: "median",
      retailerCount: 3,
      refreshedAt: new Date("2026-09-26T12:00:00.000Z"),
    });

    const response = await POST();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      refreshed: 0,
      skipped: 1,
      costSanityCheck: "applied_when_available",
    });
    expect(mocks.resolveSiteCostReadAccess).toHaveBeenCalledWith(
      supabase,
      RESTAURANT_ID,
    );
    expect(mocks.readInventoryCosts).toHaveBeenCalledWith(
      supabase,
      RESTAURANT_ID,
      [WINE_ID],
    );
    expect(mocks.fetchRetailPrices).toHaveBeenCalledWith({ lwinId: "1010101" });
    expect(JSON.stringify(body)).not.toContain("unit_cost");
    expect(JSON.stringify(mocks.captureMessage.mock.calls)).not.toContain("5");
    expect(supabase.updates).toEqual([]);
  });

  it("rejects staff before capability, private-reader, or provider work", async () => {
    const supabase = makeSupabase();
    mocks.requireMembership.mockResolvedValue({
      supabase,
      restaurantId: RESTAURANT_ID,
      role: "staff",
    });

    const response = await POST();

    expect(response.status).toBe(403);
    expect(mocks.resolveSiteCostReadAccess).not.toHaveBeenCalled();
    expect(mocks.readInventoryCosts).not.toHaveBeenCalled();
    expect(mocks.fetchRetailPrices).not.toHaveBeenCalled();
  });

  it("hard-fails capability and private-reader errors rather than downgrading to a cost-free refresh", async () => {
    const supabase = makeSupabase();
    mocks.requireMembership.mockResolvedValue({
      supabase,
      restaurantId: RESTAURANT_ID,
      role: "manager",
    });
    mocks.resolveSiteCostReadAccess.mockRejectedValueOnce(new Error("capability outage"));

    const capabilityResponse = await POST();
    expect(capabilityResponse.status).toBe(500);
    expect(await capabilityResponse.json()).toMatchObject({
      error: { message: "Cost authorization check failed." },
    });

    mocks.resolveSiteCostReadAccess.mockResolvedValueOnce(true);
    mocks.readInventoryCosts.mockRejectedValueOnce(new Error("reader outage"));

    const readerResponse = await POST();
    expect(readerResponse.status).toBe(500);
    expect(await readerResponse.json()).toMatchObject({
      error: { message: "Cost lookup failed." },
    });
    expect(mocks.fetchRetailPrices).not.toHaveBeenCalled();
  });

  it("uses the active restaurant for both the safe selection and protected cost read", async () => {
    const supabase = makeSupabase();
    mocks.requireMembership.mockResolvedValue({
      supabase,
      restaurantId: RESTAURANT_ID,
      role: "owner",
    });
    mocks.resolveSiteCostReadAccess.mockResolvedValue(true);

    await POST();

    expect(mocks.readInventoryCosts).toHaveBeenCalledWith(
      supabase,
      RESTAURANT_ID,
      [WINE_ID],
    );
    const wineChain = supabase.from.mock.results[0]?.value;
    expect(wineChain.eq).toHaveBeenCalledWith("restaurant_id", RESTAURANT_ID);
  });
});
