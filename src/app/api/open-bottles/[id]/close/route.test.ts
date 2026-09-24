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
const OPENED_AT = "2026-09-23T12:00:00.000Z";

function makeSupabase(options: {
  contractVersion?: 1 | 2;
  rpcError?: { code?: string; message?: string } | null;
  closedAt?: string | null;
  restaurantId?: string;
  replayed?: boolean;
} = {}) {
  const commandResponse = {
    data: options.rpcError
      ? null
      : {
          operation_id: OPERATION_ID,
          command: "discard",
          pour_event_ids: ["77777777-7777-4777-8777-777777777777"],
          replayed: options.replayed ?? false,
          open_bottle: {
            id: "closeout-1",
            wine_id: WINE_ID,
            remaining_ml: 0,
            closed_at: "2026-09-23T13:00:00.000Z",
          },
        },
    error: options.rpcError ?? null,
  };
  const rpc = vi.fn((name: string) => Promise.resolve(
    name === "current_inventory_contract_version"
      ? { data: options.contractVersion ?? 1, error: null }
      : commandResponse,
  ));
  const from = vi.fn(() => ({
    select: () => {
      const chain = {
        eq: () => chain,
        single: async () => ({
          data: {
            id: BOTTLE_ID,
            wine_id: WINE_ID,
            opened_at: OPENED_AT,
            closed_at: options.closedAt ?? null,
            restaurant_id: options.restaurantId ?? RESTAURANT_ID,
          },
          error: null,
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
  body: unknown = { expected_opened_at: OPENED_AT },
  operationId: string | null = OPERATION_ID,
) {
  const headers = new Headers({ "content-type": "application/json" });
  if (operationId) headers.set("Idempotency-Key", operationId);
  return new Request(`http://localhost/api/open-bottles/${BOTTLE_ID}/close`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  }) as unknown as NextRequest;
}

const context = { params: Promise.resolve({ id: BOTTLE_ID }) };

describe("POST /api/open-bottles/[id]/close", () => {
  beforeEach(() => vi.clearAllMocks());

  it("keeps authentication first", async () => {
    mockRequireMembership.mockResolvedValue(
      NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    );
    expect((await POST(request({}, null), context)).status).toBe(401);
  });

  it("requires the idempotency UUID and caller-observed opened_at", async () => {
    const supabase = makeSupabase();
    allow(supabase);
    expect((await POST(request(undefined, null), context)).status).toBe(400);
    expect((await POST(request({}), context)).status).toBe(400);
    expect(supabase.rpc).not.toHaveBeenCalledWith("execute_inventory_command", expect.anything());
  });

  it("keeps the 200 closed envelope and forwards the lifecycle pair", async () => {
    const supabase = makeSupabase();
    allow(supabase);
    const response = await POST(request(), context);

    expect(response.status).toBe(200);
    expect((await response.json()).closed).toMatchObject({
      id: "closeout-1",
      wine_id: WINE_ID,
    });
    expect(response.headers.get("Idempotency-Key")).toBe(OPERATION_ID);
    expect(response.headers.get("Idempotency-Replayed")).toBe("false");
    expect(supabase.rpc).toHaveBeenCalledWith(
      "execute_inventory_command",
      expect.objectContaining({
        p_command: "discard",
        p_expected_open_bottle_id: BOTTLE_ID,
        p_expected_opened_at: OPENED_AT,
        p_actual_remaining_ml: undefined,
        p_reason_code_id: undefined,
      }),
    );
  });

  it("never falls back to record_pour", async () => {
    const supabase = makeSupabase({
      rpcError: { code: "P0001", message: "open_bottle_changed" },
    });
    allow(supabase);
    const response = await POST(request(), context);
    expect(response.status).toBe(409);
    expect((await response.json()).error.code).toBe("open_bottle_changed");
    expect(supabase.rpc).not.toHaveBeenCalledWith("record_pour", expect.anything());
  });

  it("replays a stored receipt after a lost successful close response", async () => {
    const supabase = makeSupabase({
      closedAt: "2026-09-23T13:00:00.000Z",
      replayed: true,
    });
    allow(supabase);
    const response = await POST(request(), context);
    expect(response.status).toBe(200);
    expect((await response.json()).closed).toMatchObject({
      id: "closeout-1",
    });
    expect(response.headers.get("Idempotency-Replayed")).toBe("true");
    expect(supabase.rpc).toHaveBeenCalledTimes(2);
  });

  it("preserves the existing already_closed compatibility response", async () => {
    const supabase = makeSupabase({
      rpcError: { code: "P0001", message: "open_bottle_already_closed" },
    });
    allow(supabase);

    const response = await POST(request(), context);

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: { code: "already_closed", message: "Bottle is already closed." },
    });
    expect(response.headers.get("Idempotency-Key")).toBe(OPERATION_ID);
  });

  it("uses wine-only physical discard without a mutable bottle pre-read", async () => {
    const supabase = makeSupabase({ contractVersion: 2 });
    supabase.rpc.mockImplementation((name: string) => Promise.resolve(
      name === "current_inventory_contract_version"
        ? { data: 2, error: null }
        : { data: physicalDiscardResult(), error: null },
    ));
    allow(supabase);
    const response = await POST(request({ wine_id: WINE_ID }), context);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      discard_event_id: "77777777-7777-4777-8777-777777777777",
      closed: { id: BOTTLE_ID, wine_id: WINE_ID },
    });
    expect(supabase.from).not.toHaveBeenCalled();
    expect(supabase.rpc).toHaveBeenCalledWith("execute_physical_bottle_command",
      expect.objectContaining({ p_command: "discard", p_wine_id: WINE_ID,
        p_open_bottle_id: BOTTLE_ID, p_actual_remaining_ml: undefined }));
    expect((await POST(request({ wine_id: WINE_ID, expected_opened_at: OPENED_AT }), context)).status)
      .toBe(400);
  });
});

function physicalDiscardResult() {
  return {
    operation_id: OPERATION_ID, command: "discard", replayed: false,
    pour_event_ids: ["77777777-7777-4777-8777-777777777777"], closeout: null,
    open_bottle: {
      id: BOTTLE_ID, restaurant_id: RESTAURANT_ID, wine_id: WINE_ID,
      remaining_ml: 0, nominal_capacity_ml: 750, opened_at: OPENED_AT,
      closed_at: "2026-09-23T13:00:00.000Z", preservation_method: "argon",
      source_inventory_item_id: "88888888-8888-4888-8888-888888888888",
      source_provenance: "known", identity_contract: 2,
      identity_origin: "native", state_version: 2,
    },
  };
}
