import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";

const mocks = vi.hoisted(() => ({
  requireMembership: vi.fn(),
  resolveSitePricingAccess: vi.fn(),
  captureException: vi.fn(),
}));

vi.mock("@/lib/api/auth", () => ({
  requireMembership: (...args: unknown[]) => mocks.requireMembership(...args),
}));
vi.mock("@/lib/api/site-capability", () => ({
  resolveSitePricingAccess: (...args: unknown[]) =>
    mocks.resolveSitePricingAccess(...args),
}));
vi.mock("@sentry/nextjs", () => ({
  captureException: (...args: unknown[]) => mocks.captureException(...args),
}));

const { GET } = await import("./route");

const RESTAURANT_ID = "11111111-1111-4111-8111-111111111111";

type QueryResult = { data: unknown[] | null; error: unknown };

function makeSupabase(result: QueryResult) {
  const query = {
    select: vi.fn(),
    eq: vi.fn(),
  };
  query.select.mockReturnValue(query);
  query.eq.mockResolvedValue(result);
  return {
    from: vi.fn(() => query),
    query,
  };
}

function allow(supabase: ReturnType<typeof makeSupabase>) {
  mocks.requireMembership.mockResolvedValue({
    supabase,
    restaurantId: RESTAURANT_ID,
    user: { id: "user-1" },
    role: "manager",
  });
}

describe("GET /api/wines/price-comparison", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveSitePricingAccess.mockResolvedValue({
      canReadCost: true,
      canReadMargin: false,
      canManagePricing: false,
    });
  });

  it("returns the membership denial before resolving cost authority", async () => {
    mocks.requireMembership.mockResolvedValue(
      NextResponse.json({ error: "denied" }, { status: 401 }),
    );

    const response = await GET();

    expect(response.status).toBe(401);
    expect(mocks.resolveSitePricingAccess).not.toHaveBeenCalled();
  });

  it("denies a manager without exact-site cost.read before the protected query", async () => {
    const supabase = makeSupabase({
      data: [{ unit_cost: 999, wines: { producer: "Secret" } }],
      error: null,
    });
    allow(supabase);
    mocks.resolveSitePricingAccess.mockResolvedValue({
      canReadCost: false,
      canReadMargin: true,
      canManagePricing: true,
    });

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body).toEqual({
      error: {
        code: "forbidden",
        message: "Cost access is required to compare distributor prices.",
      },
    });
    expect(mocks.resolveSitePricingAccess).toHaveBeenCalledWith(
      supabase,
      RESTAURANT_ID,
    );
    expect(supabase.from).not.toHaveBeenCalled();
    expect(JSON.stringify(body)).not.toContain("999");
    expect(JSON.stringify(body)).not.toContain("Secret");
  });

  it("preserves price comparisons for an explicit cost-only grant", async () => {
    const supabase = makeSupabase({
      data: [
        {
          unit_cost: 18,
          quantity: 2,
          wine_id: "wine-1",
          wines: {
            id: "wine-1",
            name: "Reserve",
            producer: "Producer",
            vintage: 2022,
            varietal: "Cabernet Sauvignon",
          },
          invoice_scans: {
            distributor_name: "Supplier A",
            invoice_date: "2026-09-01",
          },
        },
        {
          unit_cost: 24,
          quantity: 1,
          wine_id: "wine-1",
          wines: {
            id: "wine-1",
            name: "Reserve",
            producer: "Producer",
            vintage: 2022,
            varietal: "Cabernet Sauvignon",
          },
          invoice_scans: {
            distributor_name: "Supplier B",
            invoice_date: "2026-09-15",
          },
        },
      ],
      error: null,
    });
    allow(supabase);

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual([
      expect.objectContaining({
        cheapest: 18,
        mostExpensive: 24,
        spread: 1 / 3,
        distributorCount: 2,
      }),
    ]);
    expect(body[0].prices).toHaveLength(2);
    expect(supabase.query.eq).toHaveBeenCalledWith(
      "restaurant_id",
      RESTAURANT_ID,
    );
  });

  it("returns a redacted error without serializing provider data", async () => {
    const providerError = { message: "unit_cost 777 leaked by provider" };
    const supabase = makeSupabase({ data: null, error: providerError });
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    allow(supabase);

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toEqual({ error: "Failed to fetch price data." });
    expect(JSON.stringify(body)).not.toContain("777");
    expect(mocks.captureException).toHaveBeenCalledWith(
      providerError,
      expect.objectContaining({ extra: { restaurantId: RESTAURANT_ID } }),
    );
    consoleError.mockRestore();
  });
});
