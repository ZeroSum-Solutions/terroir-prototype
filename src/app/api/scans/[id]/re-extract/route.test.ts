import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse, type NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(),
  readInvoiceScanPrivate: vi.fn(),
}));

vi.mock("@/lib/api/auth", () => ({
  requireRole: (...args: unknown[]) => mocks.requireRole(...args),
}));

vi.mock("@/lib/staff-cost/protected-readers", () => ({
  readInvoiceScanPrivate: (...args: unknown[]) =>
    mocks.readInvoiceScanPrivate(...args),
}));

vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn() }));

const { POST } = await import("./route");

const SCAN_ID = "11111111-1111-4111-8111-111111111111";
const RESTAURANT_ID = "22222222-2222-4222-8222-222222222222";

function makeSupabase(result: {
  data?: unknown;
  error?: { code?: string; message: string } | null;
} = {}) {
  const rpc = vi.fn().mockResolvedValue({
    data: result.data ?? { scanId: SCAN_ID, status: "queued" },
    error: result.error ?? null,
  });
  return { rpc };
}

function currentScan(overrides: Record<string, unknown> = {}) {
  return {
    scan_id: SCAN_ID,
    restaurant_id: RESTAURANT_ID,
    committed_at: null,
    ...overrides,
  };
}

function call(id = SCAN_ID) {
  return POST({} as NextRequest, {
    params: Promise.resolve({ id }),
  });
}

describe("POST /api/scans/[id]/re-extract", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const supabase = makeSupabase();
    mocks.requireRole.mockResolvedValue({
      supabase,
      restaurantId: RESTAURANT_ID,
      user: { id: "33333333-3333-4333-8333-333333333333" },
      role: "manager",
    });
    mocks.readInvoiceScanPrivate.mockResolvedValue(currentScan());
  });

  it("requires an owner or manager before reading the protected scan", async () => {
    mocks.requireRole.mockResolvedValue(
      NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    );

    const response = await call();

    expect(response.status).toBe(401);
    expect(mocks.requireRole).toHaveBeenCalledWith(["owner", "manager"]);
    expect(mocks.readInvoiceScanPrivate).not.toHaveBeenCalled();
  });

  it("rejects an invalid scan id before reading protected data", async () => {
    const response = await call("not-a-uuid");

    expect(response.status).toBe(400);
    expect(mocks.readInvoiceScanPrivate).not.toHaveBeenCalled();
  });

  it("fails closed when the scan is absent or belongs to another site", async () => {
    mocks.readInvoiceScanPrivate.mockResolvedValueOnce(null);
    expect((await call()).status).toBe(403);

    mocks.readInvoiceScanPrivate.mockResolvedValueOnce(
      currentScan({ restaurant_id: "44444444-4444-4444-8444-444444444444" }),
    );
    expect((await call()).status).toBe(403);
  });

  it("refuses to rewrite a committed scan", async () => {
    mocks.readInvoiceScanPrivate.mockResolvedValue(
      currentScan({ committed_at: "2026-09-26T12:00:00.000Z" }),
    );
    const auth = await mocks.requireRole();

    const response = await call();

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "scan_already_committed",
        message: "A committed scan can no longer be re-extracted.",
      },
    });
    expect(auth.supabase.rpc).not.toHaveBeenCalled();
  });

  it("queues one exact-site re-extraction and returns the typed receipt", async () => {
    const auth = await mocks.requireRole();

    const response = await call();

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({
      scanId: SCAN_ID,
      status: "queued",
    });
    expect(mocks.readInvoiceScanPrivate).toHaveBeenCalledWith(
      auth.supabase,
      SCAN_ID,
    );
    expect(auth.supabase.rpc).toHaveBeenCalledWith(
      "request_invoice_scan_reextract",
      { p_scan_id: SCAN_ID },
    );
  });

  it("maps a capability refusal to a fixed 403 without leaking SQL detail", async () => {
    const supabase = makeSupabase({
      error: { code: "42501", message: "private capability detail" },
    });
    mocks.requireRole.mockResolvedValue({
      supabase,
      restaurantId: RESTAURANT_ID,
      role: "manager",
    });

    const response = await call();

    expect(response.status).toBe(403);
    expect(JSON.stringify(await response.json())).not.toContain("private");
  });

  it("redacts unexpected RPC errors", async () => {
    const supabase = makeSupabase({
      error: { code: "XX000", message: "stored protected row detail" },
    });
    mocks.requireRole.mockResolvedValue({
      supabase,
      restaurantId: RESTAURANT_ID,
      role: "manager",
    });

    const response = await call();

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body).toEqual({
      error: { code: "internal_error", message: "Internal server error." },
    });
    expect(JSON.stringify(body)).not.toContain("protected");
  });

  it("rejects a malformed or mismatched receipt instead of acknowledging work", async () => {
    const supabase = makeSupabase({
      data: { scanId: "44444444-4444-4444-8444-444444444444", status: "queued" },
    });
    mocks.requireRole.mockResolvedValue({
      supabase,
      restaurantId: RESTAURANT_ID,
      role: "manager",
    });

    const response = await call();

    expect(response.status).toBe(500);
  });
});
