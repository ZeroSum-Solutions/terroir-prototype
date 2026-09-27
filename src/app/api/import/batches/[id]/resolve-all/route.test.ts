import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse, type NextRequest } from "next/server";

const auth = vi.hoisted(() => ({ requireMembership: vi.fn() }));
vi.mock("@/lib/api/auth", () => ({
  requireMembership: (...args: unknown[]) => auth.requireMembership(...args),
}));

const service = vi.hoisted(() => ({ bulkResolveImportBatchRows: vi.fn() }));
vi.mock("@/domains/import/batch-service", () => ({
  bulkResolveImportBatchRows: (...args: unknown[]) =>
    service.bulkResolveImportBatchRows(...args),
}));
vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn() }));

const { POST } = await import("./route");

const BATCH_ID = "11111111-1111-4111-8111-111111111111";
const SITE_ID = "22222222-2222-4222-8222-222222222222";
const USER_ID = "33333333-3333-4333-8333-333333333333";
const RECEIPT = {
  batchId: BATCH_ID,
  status: "resolved",
  resolvedCount: 3,
  remainingPending: 1,
} as const;

function request(body: unknown, rawBody?: string): NextRequest {
  return new Request(
    `http://localhost/api/import/batches/${BATCH_ID}/resolve-all`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: rawBody ?? JSON.stringify(body),
    },
  ) as unknown as NextRequest;
}

function params(id = BATCH_ID) {
  return Promise.resolve({ id });
}

function allow() {
  const supabase = { rpc: vi.fn(), from: vi.fn() };
  auth.requireMembership.mockResolvedValue({
    supabase,
    restaurantId: SITE_ID,
    user: { id: USER_ID },
    role: "staff",
  });
  return supabase;
}

describe("POST /api/import/batches/[id]/resolve-all", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns membership denial before params, body, or service work", async () => {
    auth.requireMembership.mockResolvedValue(
      NextResponse.json({ error: "denied" }, { status: 401 }),
    );

    const response = await POST(request(undefined, "not-json"), {
      params: params("not-a-uuid"),
    });

    expect(response.status).toBe(401);
    expect(service.bulkResolveImportBatchRows).not.toHaveBeenCalled();
  });

  it.each([
    ["invalid batch id", params("not-a-uuid"), request({ action: "exclude" })],
    ["invalid action", params(), request({ action: "delete" })],
    ["malformed JSON", params(), request(undefined, "{")],
  ])("rejects %s before service work", async (_label, routeParams, req) => {
    allow();

    const response = await POST(req, { params: routeParams });

    expect(response.status).toBe(400);
    expect(service.bulkResolveImportBatchRows).not.toHaveBeenCalled();
  });

  it("returns the exact safe RPC receipt", async () => {
    const supabase = allow();
    service.bulkResolveImportBatchRows.mockResolvedValue({
      ok: true,
      receipt: RECEIPT,
    });

    const response = await POST(request({ action: "exclude" }), {
      params: params(),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(RECEIPT);
    expect(service.bulkResolveImportBatchRows).toHaveBeenCalledOnce();
    expect(service.bulkResolveImportBatchRows).toHaveBeenCalledWith(
      supabase,
      SITE_ID,
      USER_ID,
      BATCH_ID,
      "exclude",
    );
  });

  it.each([
    ["not_found", 404],
    ["reverted", 422],
    ["forbidden", 403],
    ["resolution_refused", 500],
    ["internal_error", 500],
  ])("maps the fixed %s failure without leaking details", async (code, status) => {
    allow();
    service.bulkResolveImportBatchRows.mockResolvedValue({
      ok: false,
      error: { code, message: "Fixed safe message." },
    });

    const response = await POST(request({ action: "include" }), {
      params: params(),
    });

    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({
      error: { code, message: "Fixed safe message." },
    });
  });
});
