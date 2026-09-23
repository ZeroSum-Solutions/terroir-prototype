import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse, type NextRequest } from "next/server";

const mockRequireMembership = vi.fn();
vi.mock("@/lib/api/auth", () => ({
  requireMembership: (...args: unknown[]) => mockRequireMembership(...args),
}));
const mockRevalidate = vi.fn();
vi.mock("next/cache", () => ({ revalidatePath: mockRevalidate }));
vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn() }));

const { POST } = await import("./route");

const OPERATION_ID = "11111111-1111-4111-8111-111111111111";
const RESTAURANT_ID = "22222222-2222-4222-8222-222222222222";
const WINE_ID = "55555555-5555-4555-8555-555555555555";
const BOTTLE_ID = "66666666-6666-4666-8666-666666666666";
const REASON_ID = "77777777-7777-4777-8777-777777777777";
const OPENED_AT = "2026-09-23T12:00:00.000Z";

function makeSupabase(options: {
  replayed?: boolean;
  rpcError?: { code?: string; message?: string } | null;
  bottle?: null | {
    id: string;
    wine_id: string;
    opened_at: string;
    closed_at: string | null;
    restaurant_id: string;
  };
} = {}) {
  const bottle = options.bottle === undefined
    ? {
        id: BOTTLE_ID,
        wine_id: WINE_ID,
        opened_at: OPENED_AT,
        closed_at: null,
        restaurant_id: RESTAURANT_ID,
      }
    : options.bottle;
  const rpc = vi.fn().mockResolvedValue({
    data: options.rpcError
      ? null
      : {
          operation_id: OPERATION_ID,
          command: "close",
          pour_event_ids: ["88888888-8888-4888-8888-888888888888"],
          replayed: options.replayed ?? false,
          closeout: {
            id: "closeout-1",
            open_bottle_id: BOTTLE_ID,
            wine_id: WINE_ID,
            actual_remaining_ml: 570,
          },
        },
    error: options.rpcError ?? null,
  });
  const from = vi.fn(() => ({
    select: () => {
      const chain = {
        eq: () => chain,
        single: async () => ({
          data: bottle,
          error: bottle ? null : { code: "PGRST116" },
        }),
      };
      return chain;
    },
  }));
  return { rpc, from };
}

function allow(supabase: ReturnType<typeof makeSupabase>) {
  mockRequireMembership.mockResolvedValue({
    supabase,
    restaurantId: RESTAURANT_ID,
    user: { id: "user-a" },
    role: "staff",
  });
}

function request(
  body: unknown = {
    open_bottle_id: BOTTLE_ID,
    expected_opened_at: OPENED_AT,
    actual_remaining_ml: 570,
    written_off_ml: 30,
    reason_code_id: REASON_ID,
  },
  operationId: string | null = OPERATION_ID,
) {
  const headers = new Headers({ "content-type": "application/json" });
  if (operationId) headers.set("Idempotency-Key", operationId);
  return new Request("http://localhost/api/open-bottles/close", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  }) as unknown as NextRequest;
}

describe("POST /api/open-bottles/close", () => {
  beforeEach(() => vi.clearAllMocks());

  it("keeps authentication first", async () => {
    mockRequireMembership.mockResolvedValue(
      NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    );
    expect((await POST(request({}, null))).status).toBe(401);
  });

  it("requires both a valid operation UUID and exact lifecycle version", async () => {
    const supabase = makeSupabase();
    allow(supabase);

    const missingKey = await POST(request(undefined, null));
    const wineOnly = await POST(request({
      wine_id: WINE_ID,
      actual_remaining_ml: 570,
    }));
    const missingVersion = await POST(request({
      open_bottle_id: BOTTLE_ID,
      actual_remaining_ml: 570,
    }));

    expect(missingKey.status).toBe(400);
    expect((await missingKey.json()).error.code).toBe("invalid_idempotency_key");
    expect(wineOnly.status).toBe(400);
    expect(missingVersion.status).toBe(400);
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it("forwards the exact lifecycle and keeps the 201 closeout envelope", async () => {
    const supabase = makeSupabase({ replayed: true });
    allow(supabase);
    const response = await POST(request());

    expect(response.status).toBe(201);
    expect((await response.json()).closeout).toMatchObject({
      open_bottle_id: BOTTLE_ID,
      wine_id: WINE_ID,
    });
    expect(response.headers.get("Idempotency-Replayed")).toBe("true");
    expect(supabase.rpc).toHaveBeenCalledWith(
      "execute_inventory_command",
      expect.objectContaining({
        p_operation_id: OPERATION_ID,
        p_command: "close",
        p_wine_id: WINE_ID,
        p_expected_open_bottle_id: BOTTLE_ID,
        p_expected_opened_at: OPENED_AT,
        p_actual_remaining_ml: 570,
        p_written_off_ml: 30,
        p_reason_code_id: REASON_ID,
      }),
    );
  });

  it("rejects a write-off without a reason before the RPC", async () => {
    const supabase = makeSupabase();
    allow(supabase);
    const response = await POST(request({
      open_bottle_id: BOTTLE_ID,
      expected_opened_at: OPENED_AT,
      actual_remaining_ml: 570,
      written_off_ml: 30,
    }));
    expect(response.status).toBe(422);
    expect((await response.json()).error.code).toBe("writeoff_reason_required");
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it.each([
    ["open_bottle_changed", 409, "open_bottle_changed"],
    ["inventory_operation_actor_conflict", 409, "idempotency_conflict"],
    ["invalid_reason_code", 422, "invalid_reason_code"],
    ["invalid_writeoff_amount", 422, "invalid_writeoff_amount"],
    ["invalid_actual_remaining", 422, "invalid_actual_remaining"],
    ["wine_size_unknown", 422, "wine_size_unknown"],
  ])("maps %s to %i/%s", async (message, status, code) => {
    const supabase = makeSupabase({ rpcError: { code: "P0001", message } });
    allow(supabase);
    const response = await POST(request());
    expect(response.status).toBe(status);
    expect((await response.json()).error.code).toBe(code);
  });

  it("returns a stable 404 when the scoped bottle lookup misses", async () => {
    const supabase = makeSupabase({ bottle: null });
    allow(supabase);
    const response = await POST(request());
    expect(response.status).toBe(404);
    expect((await response.json()).error.code).toBe("open_bottle_not_found");
    expect(supabase.rpc).not.toHaveBeenCalled();
  });
});
