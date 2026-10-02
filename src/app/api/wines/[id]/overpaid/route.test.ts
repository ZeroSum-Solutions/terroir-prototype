import { beforeEach, describe, expect, it, vi } from "vitest";

const mockRequireMembership = vi.fn();
vi.mock("@/lib/api/auth", () => ({
  requireMembership: () => mockRequireMembership(),
}));

const { POST } = await import("./route");
const RESTAURANT_ID = "11111111-1111-4111-8111-111111111111";
const WINE_ID = "22222222-2222-4222-8222-222222222222";

function request(body: unknown) {
  return new Request(`http://localhost/api/wines/${WINE_ID}/overpaid`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function allow() {
  const rpc = vi.fn().mockResolvedValue({
    data: { wineId: WINE_ID, updated: true },
    error: null,
  });
  const from = vi.fn();
  mockRequireMembership.mockResolvedValue({
    supabase: { rpc, from },
    restaurantId: RESTAURANT_ID,
    role: "staff",
  });
  return { rpc, from };
}

describe("POST /api/wines/[id]/overpaid", () => {
  beforeEach(() => vi.clearAllMocks());

  it("requires the explicit target flag", async () => {
    const supabase = allow();
    const response = await POST(request({}), {
      params: Promise.resolve({ id: WINE_ID }),
    });
    expect(response.status).toBe(400);
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it("uses pricing.manage RPC without first reading the protected flag", async () => {
    const supabase = allow();
    const response = await POST(request({ flag: true }), {
      params: Promise.resolve({ id: WINE_ID }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ wineId: WINE_ID, updated: true });
    expect(supabase.rpc).toHaveBeenCalledWith("set_wine_overpaid_flag", {
      p_restaurant_id: RESTAURANT_ID,
      p_wine_id: WINE_ID,
      p_flag: true,
    });
    expect(supabase.from).not.toHaveBeenCalled();
  });
});
