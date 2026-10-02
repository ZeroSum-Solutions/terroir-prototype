import { beforeEach, describe, expect, it, vi } from "vitest";

const mockRequireMembership = vi.fn();
vi.mock("@/lib/api/auth", () => ({
  requireMembership: () => mockRequireMembership(),
}));

const { POST } = await import("./route");
const RESTAURANT_ID = "11111111-1111-4111-8111-111111111111";
const WINE_ID = "22222222-2222-4222-8222-222222222222";

function request(body: unknown) {
  return new Request(`http://localhost/api/wines/${WINE_ID}/dismiss-pricing-alert`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function rawRequest(body?: string) {
  return new Request(`http://localhost/api/wines/${WINE_ID}/dismiss-pricing-alert`, {
    method: "POST",
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body,
  });
}

function allow() {
  const rpc = vi.fn().mockResolvedValue({
    data: { wineId: WINE_ID, updated: true },
    error: null,
  });
  const query = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn(async () => ({ data: { id: WINE_ID } as { id: string } | null, error: null as unknown })),
  };
  const from = vi.fn(() => query);
  mockRequireMembership.mockResolvedValue({
    supabase: { rpc, from },
    restaurantId: RESTAURANT_ID,
    role: "staff",
  });
  return { rpc, from, query };
}

describe("POST /api/wines/[id]/dismiss-pricing-alert", () => {
  beforeEach(() => vi.clearAllMocks());

  it.each([30, 0])("uses the closed RPC for days=%s", async (days) => {
    const supabase = allow();
    const response = await POST(request({ days }), {
      params: Promise.resolve({ id: WINE_ID }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ wineId: WINE_ID, updated: true });
    expect(supabase.rpc).toHaveBeenCalledWith("dismiss_pricing_alert_private", {
      p_wine_id: WINE_ID,
      p_days: days,
    });
    expect(supabase.from).toHaveBeenCalledWith("wines");
    expect(supabase.query.select).toHaveBeenCalledWith("id");
    expect(supabase.query.eq).toHaveBeenCalledWith("id", WINE_ID);
    expect(supabase.query.eq).toHaveBeenCalledWith("restaurant_id", RESTAURANT_ID);
  });

  it("refuses an otherwise authorized wine outside the selected venue", async () => {
    const db = allow();
    db.query.maybeSingle.mockResolvedValue({ data: null, error: null });
    const response = await POST(request({ days: 30 }), { params: Promise.resolve({ id: WINE_ID }) });
    expect(response.status).toBe(404);
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it.each(["returned", "thrown"])("does not dismiss after a %s site lookup failure", async (kind) => {
    const db = allow();
    db.query.maybeSingle.mockResolvedValue({ data: null, error: { message: "private lookup" } });
    if (kind === "thrown") db.query.maybeSingle.mockRejectedValue(new Error("private lookup"));
    const response = await POST(request({ days: 30 }), { params: Promise.resolve({ id: WINE_ID }) });
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain("private lookup");
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it("rejects out-of-range days before the RPC", async () => {
    const supabase = allow();
    const response = await POST(request({ days: 366 }), {
      params: Promise.resolve({ id: WINE_ID }),
    });
    expect(response.status).toBe(400);
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it("rejects present malformed JSON before the RPC", async () => {
    const supabase = allow();
    const response = await POST(rawRequest("{not-json"), {
      params: Promise.resolve({ id: WINE_ID }),
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: { code: "invalid_json", message: "Invalid JSON." },
    });
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it.each([null, [], 30, "30"])(
    "rejects present non-object JSON %# before the RPC",
    async (body) => {
      const supabase = allow();
      const response = await POST(request(body), {
        params: Promise.resolve({ id: WINE_ID }),
      });
      expect(response.status).toBe(400);
      expect(supabase.rpc).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["bodyless", undefined],
    ["whitespace-only", "   "],
    ["empty object", "{}"],
  ])("defaults a genuinely empty %s request to 30 days", async (_label, body) => {
    const supabase = allow();
    const response = await POST(rawRequest(body), {
      params: Promise.resolve({ id: WINE_ID }),
    });
    expect(response.status).toBe(200);
    expect(supabase.rpc).toHaveBeenCalledWith("dismiss_pricing_alert_private", {
      p_wine_id: WINE_ID,
      p_days: 30,
    });
  });
});
