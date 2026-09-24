import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse, type NextRequest } from "next/server";

const mockRequireMembership = vi.fn();
vi.mock("@/lib/api/auth", () => ({
  requireMembership: (...args: unknown[]) => mockRequireMembership(...args),
}));

const mockRevalidate = vi.fn();
vi.mock("next/cache", () => ({ revalidatePath: mockRevalidate }));

vi.mock("@sentry/nextjs", () => ({
  captureException: vi.fn(),
}));

const { POST } = await import("./route");

type RpcCall = { fn: string; args: unknown };

function makeSupabase(opts: {
  undo:
    | { data: { wine_id: string; remaining_ml: number } | null; error: null }
    | { data: null; error: { code?: string; message?: string } };
  contractVersion?: unknown;
  physicalError?: { code?: string; message?: string } | null;
  replayed?: boolean;
}) {
  const calls: RpcCall[] = [];
  const rpc = vi.fn((fn: string, args: unknown) => {
    calls.push({ fn, args });
    if (fn === "current_inventory_contract_version") {
      return Promise.resolve({
        data: "contractVersion" in opts ? opts.contractVersion : 1,
        error: null,
      });
    }
    if (fn === "execute_physical_bottle_command") return Promise.resolve({
      data: opts.physicalError ? null : physicalUndoResult(opts.replayed),
      error: opts.physicalError ?? null,
    });
    if (fn === "undo_last_pour") return Promise.resolve(opts.undo);
    if (fn === "wine_published_list_slugs") {
      return Promise.resolve({ data: [], error: null });
    }
    return Promise.resolve({ data: null, error: null });
  });
  const from = vi.fn(() => {
    const chain = {
      select: () => chain,
      eq: () => chain,
      is: () => chain,
      gte: () => chain,
      in: () => Promise.resolve({ data: [], error: null }),
    };
    return chain;
  });
  return { supabase: { rpc, from }, calls };
}

function makeRequest(body: unknown, operationId?: string): NextRequest {
  const headers = new Headers({ "content-type": "application/json" });
  if (operationId) headers.set("Idempotency-Key", operationId);
  return new Request("http://localhost/api/pour/undo", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  }) as unknown as NextRequest;
}

const WINE_ID = "a1b2c3d4-e5f6-4789-8abc-def012345678";
const RESTAURANT_ID = "22222222-2222-4222-8222-222222222222";
const OPERATION_ID = "11111111-1111-4111-8111-111111111111";
const BOTTLE_ID = "66666666-6666-4666-8666-666666666666";
const REVERSAL_EVENT_ID = "77777777-7777-4777-8777-777777777777";

describe("POST /api/pour/undo", () => {
  beforeEach(() => vi.clearAllMocks());

  it("401s when unauthenticated", async () => {
    mockRequireMembership.mockResolvedValue(
      NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    );

    const res = await POST(makeRequest({ wine_id: WINE_ID }));

    expect(res.status).toBe(401);
  });

  it("undoes the latest pour through the domain service", async () => {
    const { supabase, calls } = makeSupabase({
      undo: { data: { wine_id: WINE_ID, remaining_ml: 602 }, error: null },
    });
    mockRequireMembership.mockResolvedValue({
      supabase,
      restaurantId: "r-A",
      user: { id: "u-1" },
      role: "staff",
    });

    const res = await POST(makeRequest({ wine_id: WINE_ID }));

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      open_bottle: { wine_id: WINE_ID, remaining_ml: 602 },
    });
    expect(calls).toContainEqual({
      fn: "undo_last_pour",
      args: { p_wine_id: WINE_ID },
    });
    expect(mockRevalidate).toHaveBeenCalledWith("/availability");
  });

  it("returns 404 when there is no recent pour to undo", async () => {
    const { supabase } = makeSupabase({
      undo: {
        data: null,
        error: { code: "P0001", message: "no recent pour to undo" },
      },
    });
    mockRequireMembership.mockResolvedValue({
      supabase,
      restaurantId: "r-A",
      user: { id: "u-1" },
      role: "staff",
    });

    const res = await POST(makeRequest({ wine_id: WINE_ID }));

    expect(res.status).toBe(404);
  });

  it("returns 403 when the RPC raises permission error", async () => {
    const { supabase } = makeSupabase({
      undo: {
        data: null,
        error: { code: "42501", message: "forbidden" },
      },
    });
    mockRequireMembership.mockResolvedValue({
      supabase,
      restaurantId: "r-A",
      user: { id: "u-1" },
      role: "staff",
    });

    const res = await POST(makeRequest({ wine_id: WINE_ID }));

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({
      error: {
        code: "forbidden",
        message:
          "This wine isn't in your restaurant. Refresh the page and try again.",
      },
    });
  });

  it("returns a useful 409 when a multi-lifecycle command cannot be undone safely", async () => {
    const { supabase } = makeSupabase({
      undo: {
        data: null,
        error: {
          code: "P0001",
          message: "undo_inventory_command_not_reversible",
        },
      },
    });
    mockRequireMembership.mockResolvedValue({
      supabase,
      restaurantId: "r-A",
      user: { id: "u-1" },
      role: "staff",
    });

    const res = await POST(makeRequest({ wine_id: WINE_ID }));

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: {
        code: "undo_not_reversible",
        message: "Cannot safely undo this pour; ask a manager to reconcile.",
      },
    });
  });

  it("dispatches a strict receipt-bound physical Undo with no bottle selector", async () => {
    const { supabase, calls } = makeSupabase({
      contractVersion: 2,
      undo: { data: null, error: { message: "unused" } },
      replayed: true,
    });
    mockRequireMembership.mockResolvedValue({
      supabase, restaurantId: RESTAURANT_ID, user: { id: "u-1" }, role: "staff",
    });
    const response = await POST(makeRequest({
      wine_id: WINE_ID,
      open_bottle_id: BOTTLE_ID,
      reversal_of_event_id: REVERSAL_EVENT_ID,
    }, OPERATION_ID));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      open_bottle: physicalUndoResult(true).open_bottle,
      undo_event_id: "88888888-8888-4888-8888-888888888888",
    });
    expect(response.headers.get("Idempotency-Replayed")).toBe("true");
    expect(calls).toContainEqual({
      fn: "execute_physical_bottle_command",
      args: expect.objectContaining({
        p_operation_id: OPERATION_ID,
        p_wine_id: WINE_ID,
        p_open_bottle_id: undefined,
        p_reversal_of_event_id: REVERSAL_EVENT_ID,
      }),
    });
    expect(calls.filter((call) => call.fn === "current_inventory_contract_version"))
      .toHaveLength(1);
  });

  it.each([
    ["missing key", {
      wine_id: WINE_ID, open_bottle_id: BOTTLE_ID,
      reversal_of_event_id: REVERSAL_EVENT_ID,
    }, undefined],
    ["wine-only body", { wine_id: WINE_ID }, OPERATION_ID],
    ["unknown key", {
      wine_id: WINE_ID, open_bottle_id: BOTTLE_ID,
      reversal_of_event_id: REVERSAL_EVENT_ID, latest: true,
    }, OPERATION_ID],
    ["bad event UUID", {
      wine_id: WINE_ID, open_bottle_id: BOTTLE_ID,
      reversal_of_event_id: "not-an-event",
    }, OPERATION_ID],
  ])("rejects physical Undo with %s before mutation", async (_case, body, key) => {
    const { supabase, calls } = makeSupabase({
      contractVersion: 2,
      undo: { data: null, error: { message: "unused" } },
    });
    mockRequireMembership.mockResolvedValue({
      supabase, restaurantId: RESTAURANT_ID, user: { id: "u-1" }, role: "staff",
    });
    expect((await POST(makeRequest(body, key))).status).toBe(400);
    expect(calls.some((call) => call.fn === "execute_physical_bottle_command"))
      .toBe(false);
  });

  it("maps a physical replay-payload conflict without exposing database detail", async () => {
    const { supabase } = makeSupabase({
      contractVersion: 2,
      undo: { data: null, error: { message: "unused" } },
      physicalError: {
        code: "P0001",
        message: "inventory_operation_payload_conflict",
      },
    });
    mockRequireMembership.mockResolvedValue({
      supabase, restaurantId: RESTAURANT_ID, user: { id: "u-1" }, role: "staff",
    });
    const response = await POST(makeRequest({
      wine_id: WINE_ID, open_bottle_id: BOTTLE_ID,
      reversal_of_event_id: REVERSAL_EVENT_ID,
    }, OPERATION_ID));
    expect(response.status).toBe(409);
    const text = await response.text();
    expect(JSON.parse(text).error.code).toBe("idempotency_conflict");
    expect(text).not.toContain("P0001");
  });

  it("requires and forwards both mistaken-discard attestations together", async () => {
    const { supabase, calls } = makeSupabase({
      contractVersion: 2,
      undo: { data: null, error: { message: "unused" } },
    });
    mockRequireMembership.mockResolvedValue({
      supabase, restaurantId: RESTAURANT_ID, user: { id: "u-1" }, role: "staff",
    });
    const partial = await POST(makeRequest({
      wine_id: WINE_ID, open_bottle_id: BOTTLE_ID,
      reversal_of_event_id: REVERSAL_EVENT_ID,
      correction_reason: "mistaken_report",
    }, OPERATION_ID));
    expect(partial.status).toBe(400);
    expect(calls.some((call) => call.fn === "execute_physical_bottle_command"))
      .toBe(false);

    const complete = await POST(makeRequest({
      wine_id: WINE_ID, open_bottle_id: BOTTLE_ID,
      reversal_of_event_id: REVERSAL_EVENT_ID,
      correction_reason: "mistaken_report",
      operator_confirms_same_bottle_present: true,
    }, OPERATION_ID));
    expect(complete.status).toBe(200);
    expect(calls).toContainEqual({
      fn: "execute_physical_bottle_command",
      args: expect.objectContaining({
        p_correction_reason: "mistaken_report",
        p_operator_confirms_same_bottle_present: true,
      }),
    });
  });

  it("maps an unknown contract without losing a supplied operation receipt", async () => {
    const { supabase } = makeSupabase({
      contractVersion: null,
      undo: { data: null, error: { message: "unused" } },
    });
    mockRequireMembership.mockResolvedValue({
      supabase, restaurantId: RESTAURANT_ID, user: { id: "u-1" }, role: "staff",
    });
    const response = await POST(makeRequest({ wine_id: WINE_ID }, OPERATION_ID));
    expect(response.status).toBe(500);
    expect(response.headers.get("Idempotency-Key")).toBe(OPERATION_ID);
    expect((await response.json()).error.message).toBe("Inventory command failed.");
  });

  it.each([
    ["undo_window_expired", "undo_window_expired"],
    ["undo_already_applied", "undo_already_applied"],
    ["undo_requires_review", "undo_requires_review"],
  ])("maps physical %s without falling back to latest-wine Undo", async (message, code) => {
    const { supabase, calls } = makeSupabase({
      contractVersion: 2,
      undo: { data: null, error: { message: "unused" } },
      physicalError: { code: "P0001", message },
    });
    mockRequireMembership.mockResolvedValue({
      supabase, restaurantId: RESTAURANT_ID, user: { id: "u-1" }, role: "staff",
    });
    const response = await POST(makeRequest({
      wine_id: WINE_ID, open_bottle_id: BOTTLE_ID,
      reversal_of_event_id: REVERSAL_EVENT_ID,
    }, OPERATION_ID));
    expect(response.status).toBe(409);
    expect((await response.json()).error.code).toBe(code);
    expect(calls.some((call) => call.fn === "undo_last_pour")).toBe(false);
  });
});

function physicalUndoResult(replayed = false) {
  return {
    operation_id: OPERATION_ID,
    command: "undo",
    pour_event_ids: ["88888888-8888-4888-8888-888888888888"],
    replayed,
    closeout: null,
    open_bottle: {
      id: BOTTLE_ID, restaurant_id: RESTAURANT_ID, wine_id: WINE_ID,
      remaining_ml: 0, nominal_capacity_ml: 750,
      opened_at: "2026-09-23T12:00:00.000Z", closed_at: null,
      preservation_method: "argon",
      source_inventory_item_id: "99999999-9999-4999-8999-999999999999",
      source_provenance: "known", identity_contract: 2,
      identity_origin: "native", state_version: 3,
    },
  };
}
