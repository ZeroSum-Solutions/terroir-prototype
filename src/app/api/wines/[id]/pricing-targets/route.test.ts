import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";

const mockRequireMembership = vi.fn();
vi.mock("@/lib/api/auth", () => ({
  requireMembership: () => mockRequireMembership(),
}));

const { PATCH } = await import("./route");
const RESTAURANT_ID = "11111111-1111-4111-8111-111111111111";
const WINE_ID = "22222222-2222-4222-8222-222222222222";

function request(body: unknown) {
  return new Request(`http://localhost/api/wines/${WINE_ID}/pricing-targets`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function allow(result: {
  data: unknown;
  error: { code: string; message: string } | null;
} = {
  data: { wineId: WINE_ID, updated: true },
  error: null,
}) {
  const rpc = vi.fn().mockResolvedValue(result);
  const from = vi.fn();
  mockRequireMembership.mockResolvedValue({
    supabase: { rpc, from },
    restaurantId: RESTAURANT_ID,
    role: "staff",
  });
  return { rpc, from };
}

describe("PATCH /api/wines/[id]/pricing-targets", () => {
  beforeEach(() => vi.clearAllMocks());

  it("preserves authorization precedence", async () => {
    mockRequireMembership.mockResolvedValue(
      NextResponse.json({ error: "denied" }, { status: 401 }),
    );
    const response = await PATCH(request({}), {
      params: Promise.resolve({ id: "bad" }),
    });
    expect(response.status).toBe(401);
  });

  it("requires both values so a hidden peer is never overwritten", async () => {
    const supabase = allow();
    const response = await PATCH(request({ pour_cost_pct: 22 }), {
      params: Promise.resolve({ id: WINE_ID }),
    });
    expect(response.status).toBe(400);
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it("uses the pricing.manage RPC with no direct DML or protected response", async () => {
    const supabase = allow();
    const response = await PATCH(
      request({ pour_cost_pct: 22, markup_ratio: 2.7 }),
      { params: Promise.resolve({ id: WINE_ID }) },
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ wineId: WINE_ID, updated: true });
    expect(supabase.rpc).toHaveBeenCalledWith("set_wine_pricing_strategy", {
      p_restaurant_id: RESTAURANT_ID,
      p_wine_id: WINE_ID,
      p_target_pour_cost_pct: 22,
      p_target_markup_ratio: 2.7,
    });
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it("maps database authorization denial without leaking its message", async () => {
    const supabase = allow({
      data: null,
      error: { code: "42501", message: "private policy detail" },
    });
    const response = await PATCH(
      request({ pour_cost_pct: null, markup_ratio: null }),
      { params: Promise.resolve({ id: WINE_ID }) },
    );
    expect(response.status).toBe(403);
    expect(JSON.stringify(await response.json())).not.toContain("private");
    expect(supabase.from).not.toHaveBeenCalled();
  });
});
