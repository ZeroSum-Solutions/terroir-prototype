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
  formatRetailPriceBasis: (basis: string) =>
    basis === "median" ? "median" : "avg-based",
}));

vi.mock("@sentry/nextjs", () => ({
  captureException: mocks.captureException,
  captureMessage: mocks.captureMessage,
}));

import { POST } from "./route";

const RESTAURANT_ID = "10000000-0000-4000-8000-000000000001";
const WINE_ID = "20000000-0000-4000-8000-000000000002";
const ITEM_OLD_ID = "30000000-0000-4000-8000-000000000003";
const ITEM_NEW_ID = "40000000-0000-4000-8000-000000000004";

function makeSupabase(options?: {
  wine?: { id: string; lwin_id: string | null } | null;
  fetchError?: { message: string } | null;
  writeError?: { message: string } | null;
}) {
  const wine = options?.wine === undefined
    ? { id: WINE_ID, lwin_id: "1010101" }
    : options.wine;
  const updates: Array<Record<string, unknown>> = [];
  const readEq = vi.fn();
  const writeEq = vi.fn();
  let fromCalls = 0;

  const readChain = {
    select: vi.fn(() => readChain),
    eq: readEq,
    single: vi.fn(async () => ({
      data: wine,
      error: options?.fetchError ?? null,
    })),
  };
  readEq.mockReturnValue(readChain);

  const writeChain = {
    update: vi.fn((values: Record<string, unknown>) => {
      updates.push(values);
      return writeChain;
    }),
    eq: writeEq,
    then: (
      resolve: (result: { error: { message: string } | null }) => void,
    ) => resolve({ error: options?.writeError ?? null }),
  };
  writeEq.mockReturnValue(writeChain);

  const from = vi.fn((table: string) => {
    if (table !== "wines") throw new Error(`Unexpected table: ${table}`);
    fromCalls += 1;
    return fromCalls === 1 ? readChain : writeChain;
  });

  return { from, readEq, writeEq, updates };
}

function authWith(supabase: ReturnType<typeof makeSupabase>, role = "manager") {
  mocks.requireMembership.mockResolvedValue({
    supabase,
    restaurantId: RESTAURANT_ID,
    role,
  });
}

function medianResult(retailMedian = 80) {
  return {
    retailMin: 70,
    retailMax: 90,
    retailMedian,
    retailMedianBasis: "median",
    retailerCount: 3,
    refreshedAt: new Date("2026-09-26T12:00:00.000Z"),
  };
}

describe("POST /api/wines/[id]/refresh-retail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveSiteCostReadAccess.mockResolvedValue(false);
    mocks.readInventoryCosts.mockResolvedValue([]);
    mocks.fetchRetailPrices.mockResolvedValue(medianResult());
  });

  it.each(["owner", "manager"])(
    "keeps the existing %s role authority for safe retail refresh",
    async (role) => {
      const supabase = makeSupabase();
      authWith(supabase, role);

      const response = await POST(new Request("http://local"), {
        params: Promise.resolve({ id: WINE_ID }),
      });

      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        wineId: WINE_ID,
        refreshed: true,
        costSanityCheck: "restricted",
      });
    },
  );

  it("uses the latest private inventory cost for a cost.read-only manager without sending it to the provider", async () => {
    const supabase = makeSupabase();
    authWith(supabase);
    mocks.resolveSiteCostReadAccess.mockResolvedValue(true);
    mocks.readInventoryCosts.mockResolvedValue([
      {
        inventory_item_id: ITEM_OLD_ID,
        wine_id: WINE_ID,
        invoice_scan_id: null,
        unit_cost: 50,
        currency: "USD",
        added_at: "2026-09-20T12:00:00.000Z",
      },
      {
        inventory_item_id: ITEM_NEW_ID,
        wine_id: WINE_ID,
        invoice_scan_id: null,
        unit_cost: 60,
        currency: "USD",
        added_at: "2026-09-25T12:00:00.000Z",
      },
    ]);

    const response = await POST(new Request("http://local"), {
      params: Promise.resolve({ id: WINE_ID }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      refreshed: true,
      costSanityCheck: "applied",
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
    expect(supabase.from).not.toHaveBeenCalledWith("inventory_items");
  });

  it.each(["margin.read only", "pricing.manage only", "no pricing capability"])(
    "refreshes public retail observations for a manager with %s without reading or classifying by cost",
    async () => {
      const supabase = makeSupabase();
      authWith(supabase);

      const response = await POST(new Request("http://local"), {
        params: Promise.resolve({ id: WINE_ID }),
      });

      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        refreshed: true,
        costSanityCheck: "restricted",
      });
      expect(mocks.readInventoryCosts).not.toHaveBeenCalled();
      expect(mocks.fetchRetailPrices).toHaveBeenCalledWith({ lwinId: "1010101" });
      expect(supabase.from).not.toHaveBeenCalledWith("inventory_items");
    },
  );

  it("rejects staff before capability or provider work even when the staff member has a grant", async () => {
    const supabase = makeSupabase();
    authWith(supabase, "staff");
    mocks.resolveSiteCostReadAccess.mockResolvedValue(true);

    const response = await POST(new Request("http://local"), {
      params: Promise.resolve({ id: WINE_ID }),
    });

    expect(response.status).toBe(403);
    expect(mocks.resolveSiteCostReadAccess).not.toHaveBeenCalled();
    expect(mocks.readInventoryCosts).not.toHaveBeenCalled();
    expect(mocks.fetchRetailPrices).not.toHaveBeenCalled();
  });

  it("hard-fails a cost capability outage instead of treating it as restricted", async () => {
    const supabase = makeSupabase();
    authWith(supabase);
    mocks.resolveSiteCostReadAccess.mockRejectedValue(new Error("rpc unavailable"));

    const response = await POST(new Request("http://local"), {
      params: Promise.resolve({ id: WINE_ID }),
    });

    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({
      error: { code: "internal_error", message: "Cost authorization check failed." },
    });
    expect(mocks.fetchRetailPrices).not.toHaveBeenCalled();
  });

  it("hard-fails a private cost reader error instead of refreshing without the authorized anchor", async () => {
    const supabase = makeSupabase();
    authWith(supabase);
    mocks.resolveSiteCostReadAccess.mockResolvedValue(true);
    mocks.readInventoryCosts.mockRejectedValue(new Error("reader unavailable"));

    const response = await POST(new Request("http://local"), {
      params: Promise.resolve({ id: WINE_ID }),
    });

    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({
      error: { code: "internal_error", message: "Cost lookup failed." },
    });
    expect(mocks.fetchRetailPrices).not.toHaveBeenCalled();
  });

  it("filters an implausible result locally without logging or returning acquisition cost", async () => {
    const supabase = makeSupabase();
    authWith(supabase);
    mocks.resolveSiteCostReadAccess.mockResolvedValue(true);
    mocks.readInventoryCosts.mockResolvedValue([
      {
        inventory_item_id: ITEM_NEW_ID,
        wine_id: WINE_ID,
        invoice_scan_id: null,
        unit_cost: 5,
        currency: "USD",
        added_at: "2026-09-25T12:00:00.000Z",
      },
    ]);
    mocks.fetchRetailPrices.mockResolvedValue(medianResult(80));

    const response = await POST(new Request("http://local"), {
      params: Promise.resolve({ id: WINE_ID }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      refreshed: false,
      reason: "unavailable",
      costSanityCheck: "applied",
    });
    expect(JSON.stringify(body)).not.toContain("unit_cost");
    expect(JSON.stringify(mocks.captureMessage.mock.calls)).not.toContain("5");
    expect(supabase.updates).toEqual([]);
  });

  it("scopes both the safe wine lookup and private reader to the active site", async () => {
    const supabase = makeSupabase();
    authWith(supabase);
    mocks.resolveSiteCostReadAccess.mockResolvedValue(true);

    await POST(new Request("http://local"), {
      params: Promise.resolve({ id: WINE_ID }),
    });

    expect(supabase.readEq).toHaveBeenCalledWith("id", WINE_ID);
    expect(supabase.readEq).toHaveBeenCalledWith("restaurant_id", RESTAURANT_ID);
    expect(supabase.writeEq).toHaveBeenCalledWith("id", WINE_ID);
    expect(supabase.writeEq).toHaveBeenCalledWith("restaurant_id", RESTAURANT_ID);
    expect(mocks.readInventoryCosts).toHaveBeenCalledWith(
      supabase,
      RESTAURANT_ID,
      [WINE_ID],
    );
  });
});
