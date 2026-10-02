import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse, type NextRequest } from "next/server";

const mockRequireRole = vi.fn();
vi.mock("@/lib/api/auth", () => ({
  requireRole: (...args: unknown[]) => mockRequireRole(...args),
}));

const { POST } = await import("./route");

const RESTAURANT_ID = "11111111-1111-4111-8111-111111111111";
const WINE_ID = "22222222-2222-4222-8222-222222222222";
const INVENTORY_ID = "33333333-3333-4333-8333-333333333333";

function request(body: unknown): NextRequest {
  return new Request("http://localhost/api/cellar", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }) as NextRequest;
}

function allow() {
  const rpc = vi.fn(async (name: string) => {
    if (name === "find_or_create_wines_batch") {
      return { data: [WINE_ID], error: null };
    }
    if (name === "create_inventory_item_private") {
      return {
        data: { inventoryItemId: INVENTORY_ID, quantity: 2, updated: true },
        error: null,
      };
    }
    if (name === "enrich_wines_batch" || name === "match_lwin_batch") {
      return { data: null, error: null };
    }
    throw new Error(`Unexpected RPC: ${name}`);
  });
  const from = vi.fn();
  mockRequireRole.mockResolvedValue({
    supabase: { rpc, from },
    restaurantId: RESTAURANT_ID,
    role: "manager",
    user: { id: "user-a" },
  });
  return { rpc, from };
}

describe("POST /api/cellar", () => {
  beforeEach(() => vi.clearAllMocks());

  it("keeps authorization ahead of body parsing", async () => {
    const json = vi.fn();
    mockRequireRole.mockResolvedValue(
      NextResponse.json({ error: "denied" }, { status: 403 }),
    );

    const response = await POST({ json } as unknown as NextRequest);

    expect(response.status).toBe(403);
    expect(json).not.toHaveBeenCalled();
  });

  it("uses the closed inventory RPC and omits cost from the receipt", async () => {
    const supabase = allow();

    const response = await POST(request({
      name: "Test Wine",
      producer: "Test Producer",
      quantity: 2,
    }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      wineId: WINE_ID,
      inventoryId: INVENTORY_ID,
      quantity: 2,
      updated: true,
    });
    expect(supabase.rpc).toHaveBeenCalledWith(
      "create_inventory_item_private",
      expect.objectContaining({
        p_restaurant_id: RESTAURANT_ID,
        p_wine_id: WINE_ID,
        p_quantity: 2,
        p_unit_cost: 0,
        p_added_via: "manual",
      }),
    );
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it("preserves an explicit cost but never returns it", async () => {
    const supabase = allow();

    const response = await POST(request({
      name: "Test Wine",
      producer: "Test Producer",
      quantity: 2,
      unit_cost: 42,
    }));

    expect(supabase.rpc).toHaveBeenCalledWith(
      "create_inventory_item_private",
      expect.objectContaining({ p_unit_cost: 42 }),
    );
    expect(await response.json()).not.toHaveProperty("unitCost");
  });

  it("rejects explicit null cost before any database call", async () => {
    const supabase = allow();

    const response = await POST(request({
      name: "Test Wine",
      producer: "Test Producer",
      unit_cost: null,
    }));

    expect(response.status).toBe(400);
    expect(supabase.rpc).not.toHaveBeenCalled();
  });
});
