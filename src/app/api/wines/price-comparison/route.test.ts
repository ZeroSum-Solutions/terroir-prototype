import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";

const mocks = vi.hoisted(() => ({
  requireMembership: vi.fn(),
  resolveSiteCostReadAccess: vi.fn(),
  fetchDistributorPriceRows: vi.fn(),
  captureException: vi.fn(),
}));

vi.mock("@/lib/api/auth", () => ({
  requireMembership: (...args: unknown[]) => mocks.requireMembership(...args),
}));
vi.mock("@/lib/api/site-capability", () => ({
  resolveSiteCostReadAccess: (...args: unknown[]) =>
    mocks.resolveSiteCostReadAccess(...args),
}));
vi.mock("@/lib/pricing/price-comparison-data", () => ({
  fetchDistributorPriceRows: (...args: unknown[]) =>
    mocks.fetchDistributorPriceRows(...args),
}));
vi.mock("@sentry/nextjs", () => ({
  captureException: (...args: unknown[]) => mocks.captureException(...args),
}));

const { GET } = await import("./route");

const RESTAURANT_ID = "11111111-1111-4111-8111-111111111111";

function makeSupabase() {
  return { from: vi.fn() };
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
    mocks.resolveSiteCostReadAccess.mockResolvedValue(true);
  });

  it("returns the membership denial before resolving cost authority", async () => {
    mocks.requireMembership.mockResolvedValue(
      NextResponse.json({ error: "denied" }, { status: 401 }),
    );

    const response = await GET();

    expect(response.status).toBe(401);
    expect(mocks.resolveSiteCostReadAccess).not.toHaveBeenCalled();
  });

  it("denies a manager without exact-site cost.read before the protected query", async () => {
    const supabase = makeSupabase();
    allow(supabase);
    mocks.resolveSiteCostReadAccess.mockResolvedValue(false);

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body).toEqual({
      error: {
        code: "forbidden",
        message: "Cost access is required to compare distributor prices.",
      },
    });
    expect(mocks.resolveSiteCostReadAccess).toHaveBeenCalledWith(
      supabase,
      RESTAURANT_ID,
    );
    expect(mocks.fetchDistributorPriceRows).not.toHaveBeenCalled();
    expect(JSON.stringify(body)).not.toContain("999");
    expect(JSON.stringify(body)).not.toContain("Secret");
  });

  it("preserves price comparisons for an explicit cost-only grant", async () => {
    const supabase = makeSupabase();
    mocks.fetchDistributorPriceRows.mockResolvedValue([
        {
          inventoryItemId: "inventory-1",
          unitCost: 18,
          quantity: 2,
          wine: {
            id: "wine-1",
            name: "Reserve",
            producer: "Producer",
            vintage: 2022,
            varietal: "Cabernet Sauvignon",
            retail_median: null,
            retail_min: null,
            retail_max: null,
            hero_image_url: null,
            colour: null,
          },
          scan: {
            distributor_name: "Supplier A",
            invoice_date: "2026-09-01",
          },
          overpaidFlag: false,
        },
        {
          inventoryItemId: "inventory-2",
          unitCost: 24,
          quantity: 1,
          wine: {
            id: "wine-1",
            name: "Reserve",
            producer: "Producer",
            vintage: 2022,
            varietal: "Cabernet Sauvignon",
            retail_median: null,
            retail_min: null,
            retail_max: null,
            hero_image_url: null,
            colour: null,
          },
          scan: {
            distributor_name: "Supplier B",
            invoice_date: "2026-09-15",
          },
          overpaidFlag: false,
        },
      ]);
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
    expect(mocks.fetchDistributorPriceRows).toHaveBeenCalledWith(
      supabase,
      RESTAURANT_ID,
    );
  });

  it("returns a redacted error without serializing provider data", async () => {
    const providerError = { message: "unit_cost 777 leaked by provider" };
    const supabase = makeSupabase();
    mocks.fetchDistributorPriceRows.mockRejectedValue(providerError);
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
