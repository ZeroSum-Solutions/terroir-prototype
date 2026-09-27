import { beforeEach, describe, expect, it, vi } from "vitest";
import { type NextRequest } from "next/server";

const auth = vi.hoisted(() => ({ requireMembership: vi.fn() }));
vi.mock("@/lib/api/auth", () => ({
  requireMembership: (...args: unknown[]) => auth.requireMembership(...args),
}));
vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn() }));

const { POST } = await import("./route");

const KEY = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const SITE = "11111111-1111-4111-8111-111111111111";
const WINE_ID = "22222222-2222-4222-8222-222222222222";
const USER = "33333333-3333-4333-8333-333333333333";
const OTHER_USER = "44444444-4444-4444-8444-444444444444";
const OTHER_SITE = "55555555-5555-4555-8555-555555555555";

function receipt() {
  return {
    version: 1,
    kind: "bottle_inventory_save",
    wineId: WINE_ID,
    status: "committed",
    itemCount: 1,
  };
}

function makeSupabase(options: {
  claim?: { data: unknown; error: unknown };
  batch?: { data: string[] | null; error: unknown };
  inventoryError?: unknown;
  save?: { data: unknown; error: unknown };
} = {}) {
  const calls: Array<{ method: string; args: unknown }> = [];
  return {
    calls,
    rpc: vi.fn(async (name: string, args: unknown) => {
      calls.push({ method: `rpc:${name}`, args });
      if (name === "claim_scan_idempotency") {
        return options.claim ?? {
          data: [{ disposition: "claimed", receipt: null }],
          error: null,
        };
      }
      if (name === "find_or_create_wines_batch") {
        return options.batch ?? { data: [WINE_ID], error: null };
      }
      if (name === "match_lwin_batch") return { data: [], error: null };
      if (name === "save_bottle_inventory_private") {
        return options.save ?? { data: receipt(), error: null };
      }
      throw new Error(`Unexpected RPC ${name}`);
    }),
    from: vi.fn((table: string) => {
      if (table !== "inventory_items") throw new Error(`Unexpected table ${table}`);
      return {
        insert: async (payload: unknown) => {
          calls.push({ method: "inventory:insert", args: payload });
          return { error: options.inventoryError ?? null };
        },
      };
    }),
  };
}

function allow(
  supabase: ReturnType<typeof makeSupabase>,
  current = { userId: USER, restaurantId: SITE },
) {
  auth.requireMembership.mockResolvedValue({
    supabase,
    restaurantId: current.restaurantId,
    user: { id: current.userId },
    role: "staff",
  });
}

function request(
  overrides: Record<string, unknown> = {},
  key: string | null = KEY,
  expected: { userId: string; restaurantId: string } | null = {
    userId: USER,
    restaurantId: SITE,
  },
): NextRequest {
  const headers = new Headers({ "content-type": "application/json" });
  if (key) headers.set("Idempotency-Key", key);
  if (expected) {
    headers.set("X-Expected-User-Id", expected.userId);
    headers.set("X-Expected-Restaurant-Id", expected.restaurantId);
  }
  return new Request("http://localhost/api/inventory/save-bottle-scan", {
    method: "POST",
    headers,
    body: JSON.stringify({
      wine: {
        name: " Volnay ",
        producer: " Domaine Test ",
        vintage: 2021,
        varietal: "Pinot Noir",
        region: "Burgundy",
        country: "France",
        qty: 2,
        unitCost: 42.5,
        ...overrides,
      },
    }),
  }) as unknown as NextRequest;
}

describe("POST /api/inventory/save-bottle-scan transport cache", () => {
  beforeEach(() => vi.clearAllMocks());

  it("requires a valid idempotency key before business work", async () => {
    const supabase = makeSupabase();
    allow(supabase);
    const response = await POST(request({}, null));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: { code: "idempotency_key_required" },
    });
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it("rejects fractional quantities before cache or persistence", async () => {
    const supabase = makeSupabase();
    allow(supabase);
    const response = await POST(request({ qty: 1.5 }));
    expect(response.status).toBe(400);
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it.each([
    ["missing context", { current: { userId: USER, restaurantId: SITE }, expected: null }],
    ["stale actor", {
      current: { userId: OTHER_USER, restaurantId: SITE },
      expected: { userId: USER, restaurantId: SITE },
    }],
    ["stale active site", {
      current: { userId: USER, restaurantId: OTHER_SITE },
      expected: { userId: USER, restaurantId: SITE },
    }],
  ])("refuses %s before the transport claim", async (_label, context) => {
    const supabase = makeSupabase();
    allow(supabase, context.current);
    const response = await POST(request({}, KEY, context.expected));
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: {
        code: "bottle_context_mismatch",
        message: "Bottle save context changed. No save was attempted.",
      },
    });
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it("validates an exact transport replay through the durable writer", async () => {
    const supabase = makeSupabase({
      claim: {
        data: [{ disposition: "replay", receipt: receipt() }],
        error: null,
      },
    });
    allow(supabase);
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(receipt());
    expect(supabase.calls.map((call) => call.method)).toEqual([
      "rpc:claim_scan_idempotency",
      "rpc:save_bottle_inventory_private",
    ]);
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it.each([
    ["in_progress", "idempotency_in_progress"],
    ["expired", "idempotency_expired"],
  ])("returns the redacted %s transport state without atomic work", async (
    disposition,
    code,
  ) => {
    const supabase = makeSupabase({
      claim: { data: [{ disposition, receipt: null }], error: null },
    });
    allow(supabase);
    const response = await POST(request());
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: { code } });
    expect(supabase.calls.map((call) => call.method)).toEqual([
      "rpc:claim_scan_idempotency",
    ]);
  });

  it("redacts an actor/kind transport conflict before atomic work", async () => {
    const supabase = makeSupabase({
      claim: {
        data: null,
        error: { code: "P0001", message: "C04_IDEMPOTENCY_CONFLICT" },
      },
    });
    allow(supabase);
    const response = await POST(request());
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      error: { code: "idempotency_conflict" },
    });
    expect(supabase.calls.map((call) => call.method)).toEqual([
      "rpc:claim_scan_idempotency",
    ]);
  });

  it("refuses a completed transport replay when a direct caller changes the body", async () => {
    const supabase = makeSupabase({
      claim: {
        data: [{ disposition: "replay", receipt: receipt() }],
        error: null,
      },
      save: {
        data: null,
        error: { code: "P0001", message: "C04_BOTTLE_OPERATION_CONFLICT" },
      },
    });
    allow(supabase);
    const response = await POST(request({ qty: 99, unitCost: 999 }));
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      error: { code: "idempotency_conflict" },
    });
    expect(supabase.calls.map((call) => call.method)).toEqual([
      "rpc:claim_scan_idempotency",
      "rpc:save_bottle_inventory_private",
    ]);
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it("preserves staff bottle save through the typed atomic RPC", async () => {
    const supabase = makeSupabase();
    allow(supabase);
    const response = await POST(request({ format: "Magnum (1.5L)" }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(receipt());
    expect(supabase.calls).toContainEqual({
      method: "rpc:save_bottle_inventory_private",
      args: expect.objectContaining({
        p_restaurant_id: SITE,
        p_key: KEY,
        p_name: "Volnay",
        p_producer: "Domaine Test",
        p_quantity: 2,
        p_unit_cost: 42.5,
        p_format: "Magnum (1.5L)",
      }),
    });
    expect(supabase.calls.map((call) => call.method)).toEqual([
      "rpc:claim_scan_idempotency",
      "rpc:save_bottle_inventory_private",
    ]);
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it("retains uncertainty and redacts a failed atomic RPC", async () => {
    const supabase = makeSupabase({
      save: { data: null, error: { code: "XX000", message: "private inventory detail 42.5" } },
    });
    allow(supabase);
    const response = await POST(request());
    const text = await response.text();
    expect(response.status).toBe(500);
    expect(text).not.toContain("private inventory detail");
    expect(supabase.calls.map((call) => call.method)).not.toContain(
      "rpc:abandon_scan_idempotency",
    );
    expect(supabase.calls.map((call) => call.method)).not.toContain(
      "rpc:complete_scan_idempotency",
    );
  });

  it("maps a durable canonical-input conflict to a redacted 409", async () => {
    const supabase = makeSupabase({
      save: {
        data: null,
        error: { code: "P0001", message: "C04_BOTTLE_OPERATION_CONFLICT" },
      },
    });
    allow(supabase);
    const response = await POST(request());
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      error: { code: "idempotency_conflict" },
    });
    expect(supabase.calls.map((call) => call.method)).toEqual([
      "rpc:claim_scan_idempotency",
      "rpc:save_bottle_inventory_private",
    ]);
  });

  it("rejects a malformed atomic receipt without clearing the claim", async () => {
    const supabase = makeSupabase({
      save: { data: { wineId: WINE_ID }, error: null },
    });
    allow(supabase);
    const response = await POST(request());
    expect(response.status).toBe(500);
    expect(supabase.calls.map((call) => call.method)).not.toContain(
      "rpc:abandon_scan_idempotency",
    );
    expect(supabase.calls.map((call) => call.method)).not.toContain(
      "rpc:complete_scan_idempotency",
    );
  });
});
