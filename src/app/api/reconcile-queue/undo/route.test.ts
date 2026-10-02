import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse, type NextRequest } from "next/server";

const auth = vi.hoisted(() => ({ requireRole: vi.fn() }));
vi.mock("@/lib/api/auth", () => ({
  requireRole: (...args: unknown[]) => auth.requireRole(...args),
}));
vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn() }));

const { POST } = await import("./route");

const BATCH = "11111111-1111-4111-8111-111111111111";
const SITE = "22222222-2222-4222-8222-222222222222";
const USER = "33333333-3333-4333-8333-333333333333";
const UNDONE_AT = "2026-09-26T12:34:56.000Z";

function makeSupabase(result: { data: unknown; error: unknown } = {
  data: { batchId: BATCH, actionCount: 2, status: "undone", undoneAt: UNDONE_AT },
  error: null,
}, batch: { restaurantId?: string; missing?: boolean; error?: unknown } = {}) {
  const filters = new Map<string, unknown>();
  const query = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn(function (column: string, value: unknown) {
      filters.set(column, value);
      return query;
    }),
    maybeSingle: vi.fn(async () => ({
      data: batch.missing || batch.error ||
        (filters.has("restaurant_id") && filters.get("restaurant_id") !== (batch.restaurantId ?? SITE))
        ? null : { id: BATCH },
      error: batch.error ?? null,
    })),
  };
  return {
    rpc: vi.fn(async () => result),
    from: vi.fn(() => query),
    query,
  };
}

function allow(
  supabase: ReturnType<typeof makeSupabase>,
  current = { userId: USER, restaurantId: SITE },
) {
  auth.requireRole.mockResolvedValue({
    supabase,
    restaurantId: current.restaurantId,
    user: { id: current.userId },
    role: "manager",
  });
}

function request(
  body: unknown = { batch_id: BATCH },
  expected: { userId: string; restaurantId: string } | null = {
    userId: USER,
    restaurantId: SITE,
  },
  rawBody?: string,
): NextRequest {
  const headers = new Headers({ "Content-Type": "application/json" });
  if (expected) {
    headers.set("X-Expected-User-Id", expected.userId);
    headers.set("X-Expected-Restaurant-Id", expected.restaurantId);
  }
  return new Request("http://localhost/api/reconcile-queue/undo", {
    method: "POST",
    headers,
    body: rawBody ?? JSON.stringify(body),
  }) as unknown as NextRequest;
}

describe("POST /api/reconcile-queue/undo", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns the role denial before reading mutation context or body", async () => {
    auth.requireRole.mockResolvedValue(
      NextResponse.json({ error: "denied" }, { status: 401 }),
    );

    const response = await POST(request(undefined, null, "not-json"));

    expect(response.status).toBe(401);
    expect(auth.requireRole).toHaveBeenCalledWith(["owner", "manager"]);
  });

  it.each([
    ["missing context", { current: { userId: USER, restaurantId: SITE }, expected: null }],
    ["stale actor", {
      current: { userId: "44444444-4444-4444-8444-444444444444", restaurantId: SITE },
      expected: { userId: USER, restaurantId: SITE },
    }],
    ["stale site", {
      current: { userId: USER, restaurantId: "55555555-5555-4555-8555-555555555555" },
      expected: { userId: USER, restaurantId: SITE },
    }],
  ])("refuses %s before body or RPC work", async (_label, context) => {
    const supabase = makeSupabase();
    allow(supabase, context.current);

    const response = await POST(request(undefined, context.expected, "not-json"));

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: {
        code: "reconcile_context_mismatch",
        message: "Reconciliation context changed. No action was attempted.",
      },
    });
    expect(supabase.rpc).not.toHaveBeenCalled();
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it.each([
    ["invalid UUID", { batch_id: "not-a-uuid" }],
    ["extra body key", { batch_id: BATCH, extra: true }],
  ])("rejects %s before the RPC", async (_label, body) => {
    const supabase = makeSupabase();
    allow(supabase);

    const response = await POST(request(body));

    expect(response.status).toBe(400);
    expect(supabase.rpc).not.toHaveBeenCalled();
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it("makes one exact RPC call and returns its validated receipt", async () => {
    const supabase = makeSupabase();
    allow(supabase);

    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      batchId: BATCH,
      actionCount: 2,
      status: "undone",
      undoneAt: UNDONE_AT,
    });
    expect(supabase.rpc).toHaveBeenCalledOnce();
    expect(supabase.rpc).toHaveBeenCalledWith("undo_reconcile_batch", {
      p_batch_id: BATCH,
    });
    expect(supabase.from).toHaveBeenCalledWith("reconcile_batches");
    expect(supabase.query.select).toHaveBeenCalledWith("id");
    expect(supabase.query.eq).toHaveBeenCalledWith("id", BATCH);
    expect(supabase.query.eq).toHaveBeenCalledWith("restaurant_id", SITE);
  });

  it("refuses another managed site's batch before its otherwise authorized RPC", async () => {
    const supabase = makeSupabase(undefined, {
      restaurantId: "55555555-5555-4555-8555-555555555555",
    });
    allow(supabase);

    const response = await POST(request());

    expect(response.status).toBe(409);
    expect((await response.json()).error.code).toBe("reconcile_context_mismatch");
    expect(supabase.query.eq).toHaveBeenCalledWith("restaurant_id", SITE);
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it("refuses a missing batch without attempting undo", async () => {
    const supabase = makeSupabase(undefined, { missing: true });
    allow(supabase);

    const response = await POST(request());

    expect(response.status).toBe(409);
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it.each(["returned", "thrown"])("redacts a %s site lookup failure and does not undo", async (kind) => {
    const supabase = makeSupabase(undefined, { error: { message: "private lookup detail" } });
    if (kind === "thrown") supabase.query.maybeSingle.mockRejectedValue(new Error("private lookup detail"));
    allow(supabase);

    const response = await POST(request());

    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain("private lookup detail");
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it.each([
    null,
    [],
    { batchId: BATCH, actionCount: 2, status: "undone" },
    { batchId: BATCH, actionCount: 2, status: "undone", undoneAt: UNDONE_AT, extra: true },
    { batchId: BATCH, actionCount: 2, status: "accepted", undoneAt: UNDONE_AT },
    { batchId: "66666666-6666-4666-8666-666666666666", actionCount: 2, status: "undone", undoneAt: UNDONE_AT },
    { batchId: BATCH, actionCount: 0, status: "undone", undoneAt: UNDONE_AT },
    { batchId: BATCH, actionCount: 2, status: "undone", undoneAt: "yesterday" },
  ])("redacts an invalid or mismatched receipt %#", async (data) => {
    const supabase = makeSupabase({ data, error: null });
    allow(supabase);

    const response = await POST(request());

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: { code: "internal_error", message: "Reconcile undo failed." },
    });
  });

  it.each([
    ["42501", "forbidden", 403, "forbidden"],
    ["P0001", "reconcile_batch_already_undone", 409, "reconcile_conflict"],
    ["P0001", "reconcile_subject_changed", 409, "reconcile_conflict"],
    ["P0001", "reconcile_batch_conflict", 409, "reconcile_conflict"],
  ])("maps admitted %s/%s to a fixed response", async (code, message, status, apiCode) => {
    const supabase = makeSupabase({
      data: null,
      error: { code, message: ` ${message} `, details: "private", hint: "private" },
    });
    allow(supabase);

    const response = await POST(request());
    const text = await response.text();

    expect(response.status).toBe(status);
    expect(JSON.parse(text).error.code).toBe(apiCode);
    expect(text).not.toContain("private");
    expect(text).not.toContain(message === "forbidden" ? "42501" : message);
  });

  it.each([
    { code: "P0001", message: "reconcile_action_invalid", details: "raw detail" },
    { code: "P0001", message: "C04_RECONCILE_UNDO_REFUSED", hint: "raw hint" },
    { code: "XX000", message: "database exploded", details: "raw detail" },
  ])("keeps invalid stored actions, broad, and unknown failures generic %#", async (error) => {
    const supabase = makeSupabase({ data: null, error });
    allow(supabase);

    const response = await POST(request());
    const text = await response.text();

    expect(response.status).toBe(500);
    expect(JSON.parse(text)).toEqual({
      error: { code: "internal_error", message: "Reconcile undo failed." },
    });
    expect(text).not.toContain(error.message);
    expect(text).not.toContain("raw");
  });

  it("redacts a thrown RPC failure", async () => {
    const supabase = makeSupabase();
    supabase.rpc.mockRejectedValue(new Error("socket contained secret detail"));
    allow(supabase);

    const response = await POST(request());
    const text = await response.text();

    expect(response.status).toBe(500);
    expect(JSON.parse(text)).toEqual({
      error: { code: "internal_error", message: "Reconcile undo failed." },
    });
    expect(text).not.toContain("secret detail");
  });
});
