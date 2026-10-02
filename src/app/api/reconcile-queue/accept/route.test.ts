import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse, type NextRequest } from "next/server";
import {
  AcceptActionsSchema,
  MAX_RECONCILE_ACTION_BYTES,
} from "@/lib/reconcile-ledger";

const auth = vi.hoisted(() => ({ requireRole: vi.fn() }));
vi.mock("@/lib/api/auth", () => ({
  requireRole: (...args: unknown[]) => auth.requireRole(...args),
}));
vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn() }));

const { POST } = await import("./route");

const KEY = "11111111-1111-4111-8111-111111111111";
const SITE = "22222222-2222-4222-8222-222222222222";
const USER = "33333333-3333-4333-8333-333333333333";
const SUBJECT = "44444444-4444-4444-8444-444444444444";
const WINE = "55555555-5555-4555-8555-555555555555";

const expectedLine = {
  id: "line-1",
  name: "Estate Red",
  producer: "Domaine Test",
  vintage: 2021,
  varietal: "Pinot Noir",
  region: "Burgundy",
  qty: 2,
  unitCost: 42.5,
  currency: "USD",
  format: "750ml",
  confidence: 0.95,
  lowFields: [],
};

const actions = [{
  action_type: "match_scan",
  subject_table: "invoice_scans",
  subject_id: SUBJECT,
  patch: { line_index: 0, wine_id: WINE, expected_line: expectedLine },
}];

function makeSupabase(result: { data: unknown; error: unknown } = {
  data: { batchId: KEY, actionCount: 1, status: "accepted" },
  error: null,
}) {
  return {
    rpc: vi.fn(async () => result),
    from: vi.fn(),
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
  body: unknown = actions,
  options: {
    key?: string | null;
    expected?: { userId: string; restaurantId: string } | null;
    rawBody?: string;
    contentLength?: string;
  } = {},
): NextRequest {
  const headers = new Headers({ "Content-Type": "application/json" });
  const key = options.key === undefined ? KEY : options.key;
  const expected = options.expected === undefined
    ? { userId: USER, restaurantId: SITE }
    : options.expected;
  if (key !== null) headers.set("Idempotency-Key", key);
  if (expected) {
    headers.set("X-Expected-User-Id", expected.userId);
    headers.set("X-Expected-Restaurant-Id", expected.restaurantId);
  }
  if (options.contentLength !== undefined) {
    headers.set("Content-Length", options.contentLength);
  }
  return new Request("http://localhost/api/reconcile-queue/accept", {
    method: "POST",
    headers,
    body: options.rawBody ?? JSON.stringify(body),
  }) as unknown as NextRequest;
}

describe("POST /api/reconcile-queue/accept", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns the role denial before reading mutation context or body", async () => {
    auth.requireRole.mockResolvedValue(
      NextResponse.json({ error: "denied" }, { status: 401 }),
    );

    const response = await POST(request(undefined, {
      key: null,
      expected: null,
      rawBody: "not-json",
    }));

    expect(response.status).toBe(401);
    expect(auth.requireRole).toHaveBeenCalledWith(["owner", "manager"]);
  });

  it.each([
    ["missing context", { current: { userId: USER, restaurantId: SITE }, expected: null }],
    ["stale actor", {
      current: { userId: "66666666-6666-4666-8666-666666666666", restaurantId: SITE },
      expected: { userId: USER, restaurantId: SITE },
    }],
    ["stale site", {
      current: { userId: USER, restaurantId: "77777777-7777-4777-8777-777777777777" },
      expected: { userId: USER, restaurantId: SITE },
    }],
  ])("refuses %s before key, body, or RPC work", async (_label, context) => {
    const supabase = makeSupabase();
    allow(supabase, context.current);

    const response = await POST(request(undefined, {
      key: null,
      expected: context.expected,
      rawBody: "not-json",
    }));

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

  it.each([null, "not-a-uuid"])(
    "requires a valid UUID Idempotency-Key (%s)",
    async (key) => {
      const supabase = makeSupabase();
      allow(supabase);

      const response = await POST(request(actions, { key }));

      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        error: {
          code: "invalid_idempotency_key",
          message: "A valid UUID Idempotency-Key header is required.",
        },
      });
      expect(supabase.rpc).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["malformed JSON", () => request(undefined, { rawBody: "{" })],
    ["extra action key", () => request([{ ...actions[0], extra: true }])],
    ["extra patch key", () => request([{
      ...actions[0],
      patch: { ...actions[0].patch, extra: true },
    }])],
    ["duplicate subject", () => request([actions[0], actions[0]])],
    ["invalid expected line", () => request([{
      ...actions[0],
      patch: { ...actions[0].patch, expected_line: { id: "incomplete" } },
    }])],
  ])("rejects %s before the RPC", async (_label, makeRequest) => {
    const supabase = makeSupabase();
    allow(supabase);

    const response = await POST(makeRequest());

    expect(response.status).toBe(400);
    expect(supabase.rpc).not.toHaveBeenCalled();
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it("makes one exact RPC call and returns its validated receipt", async () => {
    const supabase = makeSupabase();
    allow(supabase);

    const response = await POST(request());

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({
      batchId: KEY,
      actionCount: 1,
      status: "accepted",
    });
    expect(supabase.rpc).toHaveBeenCalledOnce();
    expect(supabase.rpc).toHaveBeenCalledWith("accept_reconcile_batch", {
      p_restaurant_id: SITE,
      p_actions: actions,
      p_idempotency_key: KEY,
    });
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it.each([
    ["invalid leading byte", [0xff]],
    ["lone continuation byte", [0x80]],
    ["overlong encoding", [0xc0, 0xaf]],
  ])("rejects %s without changing the submitted action", async (_label, invalid) => {
    const supabase = makeSupabase();
    allow(supabase);
    const json = JSON.stringify(actions);
    const bytes = new TextEncoder().encode(json);
    bytes.set(invalid, json.indexOf("Estate Red"));
    const raw = new Request("http://localhost/api/reconcile-queue/accept", {
      method: "POST",
      headers: request().headers,
      body: bytes,
    });

    const response = await POST(raw as unknown as NextRequest);

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: { code: "invalid_json", message: "Invalid JSON." },
    });
    expect(supabase.rpc).not.toHaveBeenCalled();
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it("preserves valid multibyte text split across request chunks", async () => {
    const supabase = makeSupabase();
    allow(supabase);
    const json = JSON.stringify(actions).replace("Estate Red", "Éstate Red");
    const bytes = new TextEncoder().encode(json);
    const split = bytes.indexOf(0xc3) + 1;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes.slice(0, split));
        controller.enqueue(bytes.slice(split));
        controller.close();
      },
    });

    const response = await POST({ headers: request().headers, body } as NextRequest);

    expect(response.status).toBe(201);
    expect(supabase.rpc).toHaveBeenCalledExactlyOnceWith("accept_reconcile_batch", {
      p_restaurant_id: SITE,
      p_actions: JSON.parse(json),
      p_idempotency_key: KEY,
    });
  });

  it("accepts a valid request at the exact raw UTF-8 byte boundary", async () => {
    const supabase = makeSupabase();
    allow(supabase);
    const body = JSON.stringify(actions);
    const rawBody = body + " ".repeat(
      MAX_RECONCILE_ACTION_BYTES - new TextEncoder().encode(body).byteLength,
    );
    expect(new TextEncoder().encode(rawBody)).toHaveLength(
      MAX_RECONCILE_ACTION_BYTES,
    );

    const response = await POST(request(undefined, { rawBody }));

    expect(response.status).toBe(201);
    expect(supabase.rpc).toHaveBeenCalledOnce();
  });

  it.each([
    ["without Content-Length", undefined],
    ["with a falsely small Content-Length", "10"],
  ])("rejects an oversized invalid nested body %s before parsing or RPC", async (
    _label,
    contentLength,
  ) => {
    const supabase = makeSupabase();
    allow(supabase);
    const rawBody = JSON.stringify({
      extra: { nested: "x".repeat(MAX_RECONCILE_ACTION_BYTES) },
    });

    const response = await POST(request(undefined, { rawBody, contentLength }));

    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({
      error: { code: "too_large", message: "Action payload exceeds 2 MB." },
    });
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it("rejects a raw oversized payload whose parsed fields pass the action schema", async () => {
    const supabase = makeSupabase();
    allow(supabase);
    const rawBody = JSON.stringify(actions).replace(
      '"unitCost":42.5',
      `"unitCost":0.${"0".repeat(MAX_RECONCILE_ACTION_BYTES)}1`,
    );
    expect(AcceptActionsSchema.safeParse(JSON.parse(rawBody)).success).toBe(true);

    const response = await POST(request(undefined, { rawBody }));

    expect(response.status).toBe(413);
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it("cancels the request stream as soon as the aggregate byte bound is crossed", async () => {
    const supabase = makeSupabase();
    allow(supabase);
    const cancel = vi.fn();
    const headers = new Headers({
      "Content-Type": "application/json",
      "Content-Length": "1",
      "Idempotency-Key": KEY,
      "X-Expected-User-Id": USER,
      "X-Expected-Restaurant-Id": SITE,
    });
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(MAX_RECONCILE_ACTION_BYTES + 1));
      },
      cancel,
    });

    const response = await POST({ headers, body } as unknown as NextRequest);

    expect(response.status).toBe(413);
    expect(cancel).toHaveBeenCalledOnce();
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it.each([
    null,
    [],
    { actionCount: 1, status: "accepted" },
    { batchId: KEY, actionCount: 1, status: "accepted", extra: true },
    { batchId: KEY, actionCount: 1, status: "undone" },
    { batchId: "88888888-8888-4888-8888-888888888888", actionCount: 1, status: "accepted" },
    { batchId: KEY, actionCount: 2, status: "accepted" },
    { batchId: KEY, actionCount: 0, status: "accepted" },
  ])("redacts an invalid or mismatched receipt %#", async (data) => {
    const supabase = makeSupabase({ data, error: null });
    allow(supabase);

    const response = await POST(request());

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: { code: "internal_error", message: "Reconciliation failed." },
    });
  });

  it.each([
    ["42501", "forbidden", 403, "forbidden"],
    ["P0001", "C04_RECONCILE_BATCH_INVALID", 400, "validation_error"],
    ["P0001", "C04_RECONCILE_ACTION_INVALID", 400, "validation_error"],
    ["P0001", "C04_RECONCILE_DUPLICATE_SUBJECT", 400, "validation_error"],
    ["P0002", "reconcile_subject_not_found", 404, "not_found"],
    ["P0001", "reconcile_subject_conflict", 409, "reconcile_conflict"],
    ["P0001", "C04_RECONCILE_IDEMPOTENCY_CONFLICT", 409, "reconcile_conflict"],
    ["23505", "reconcile_batch_conflict", 409, "reconcile_conflict"],
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
    { code: "P0001", message: "reconcile_subject_not_found", details: "raw detail" },
    { code: "P0001", message: "C04_RECONCILE_ACCEPT_REFUSED", hint: "raw hint" },
    { code: "XX000", message: "database exploded", details: "raw detail" },
  ])("keeps lookalike, broad, and unknown database errors generic %#", async (error) => {
    const supabase = makeSupabase({ data: null, error });
    allow(supabase);

    const response = await POST(request());
    const text = await response.text();

    expect(response.status).toBe(500);
    expect(JSON.parse(text)).toEqual({
      error: { code: "internal_error", message: "Reconciliation failed." },
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
      error: { code: "internal_error", message: "Reconciliation failed." },
    });
    expect(text).not.toContain("secret detail");
  });
});
