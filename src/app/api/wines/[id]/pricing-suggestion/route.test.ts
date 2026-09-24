import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";

const { requireMembership, captureException } = vi.hoisted(() => ({
  requireMembership: vi.fn(),
  captureException: vi.fn(),
}));
vi.mock("@/lib/api/auth", () => ({ requireMembership }));
vi.mock("@sentry/nextjs", () => ({ captureException }));

const { GET } = await import("./route");
const restaurantId = "11111111-1111-4111-8111-111111111111";
const wineId = "22222222-2222-4222-8222-222222222222";

function fixture(grants: string[] = []) {
  const queries: Array<{ table: string; eq: ReturnType<typeof vi.fn> }> = [];
  const authority: { grants: string[]; error: unknown; thrown?: Error } = { grants, error: null };
  const rows: Record<string, unknown> = {
    wines: {
      id: wineId, varietal: null, region: null, rating: null, size_ml: 750,
      retail_median: 50, retail_min: 45, retail_max: 55,
      retail_retailer_count: 3, retail_refreshed_at: null,
      pricing_target_pour_cost_pct: 25, pricing_target_markup_ratio: 2,
    },
    restaurants: { default_target_pour_cost_pct: 25, default_target_markup_ratio: 2 },
    inventory_items: { unit_cost: 30 },
  };
  const client = {
    rpc: vi.fn((_name: string, args: { p_capability_key: string }) => ({
      abortSignal: vi.fn(async () => {
        if (authority.thrown) throw authority.thrown;
        return { data: authority.grants.includes(args.p_capability_key), error: authority.error };
      }),
    })),
    from: vi.fn((table: string) => {
      const query = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        single: vi.fn(async () => ({ data: rows[table], error: null })),
        maybeSingle: vi.fn(async () => ({ data: rows[table], error: null })),
      };
      queries.push({ table, eq: query.eq });
      return query;
    }),
  };
  requireMembership.mockResolvedValue({
    supabase: client, restaurantId, role: "staff", user: { id: "actor" },
  });
  return { client, rows, queries, authority };
}

function request(id = wineId) {
  return GET(new Request(`http://localhost/api/wines/${id}/pricing-suggestion?glassPourMl=150`), {
    params: Promise.resolve({ id }),
  });
}

describe("GET pricing suggestion capability boundary", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it.each([401, 403])("preserves authentication/membership rejection %s", async (status) => {
    requireMembership.mockResolvedValue(NextResponse.json({ error: "Denied" }, { status }));
    expect((await request()).status).toBe(status);
  });

  it.each(["staff", "manager", "owner"])("does not infer cost access from legacy %s", async (role) => {
    const { client } = fixture();
    requireMembership.mockResolvedValue({ supabase: client, restaurantId, role });
    const response = await request();
    expect(response.status).toBe(403);
    expect(client.from).not.toHaveBeenCalled();
    expect(await response.text()).not.toContain("targetPourCostPct");
  });

  it.each([["cost.read"], ["margin.read"], ["pricing.manage"]])(
    "requires both read grants, not only %s", async (grant) => {
      const { client } = fixture([grant]);
      expect((await request()).status).toBe(403);
      expect(client.from).not.toHaveBeenCalled();
    },
  );

  it("denies an unavailable authority before reading private data", async () => {
    const { client, authority } = fixture();
    authority.error = { code: "PGRST202" };
    expect((await request()).status).toBe(403);
    expect(client.from).not.toHaveBeenCalled();
  });

  it("denies a rejected authority request without leaking its error", async () => {
    const { client, authority } = fixture();
    authority.thrown = new Error("private authority error");
    const response = await request();
    expect(response.status).toBe(403);
    expect(client.from).not.toHaveBeenCalled();
    expect(await response.text()).not.toContain("private authority error");
  });

  it("permits an explicit site delegate and scopes every protected query", async () => {
    const { client, queries } = fixture(["cost.read", "margin.read"]);
    const response = await request();
    expect(response.status).toBe(200);
    for (const capability of ["cost.read", "margin.read"]) {
      expect(client.rpc).toHaveBeenCalledWith("effective_site_capability", {
        p_restaurant_id: restaurantId, p_capability_key: capability,
      });
    }
    for (const query of queries) {
      expect(query.eq).toHaveBeenCalledWith(
        query.table === "restaurants" ? "id" : "restaurant_id", restaurantId,
      );
    }
    expect(queries.find(query => query.table === "wines")?.eq).toHaveBeenCalledWith("id", wineId);
    expect(await response.json()).toMatchObject({ wineId, glassPourMl: 150, hasRetailData: true });
  });

  it("does not fall back to unscoped data for an unavailable wine", async () => {
    const { client, rows } = fixture(["cost.read", "margin.read"]);
    rows.wines = null;
    expect((await request()).status).toBe(404);
    expect(client.from).toHaveBeenCalledTimes(1);
    expect(client.from).toHaveBeenCalledWith("wines");
  });

  it("rechecks authority on a later request after revocation", async () => {
    const { client, authority } = fixture(["cost.read", "margin.read"]);
    expect((await request()).status).toBe(200);
    client.from.mockClear();
    authority.grants = [];
    expect((await request()).status).toBe(403);
    expect(client.from).not.toHaveBeenCalled();
  });
});
