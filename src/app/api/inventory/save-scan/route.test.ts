import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse, type NextRequest } from "next/server";
import { makeLineItem, makeScan } from "@/test/fixtures/invoices/scans";

const auth = vi.hoisted(() => ({ requireRole: vi.fn() }));
vi.mock("@/lib/api/auth", () => ({
  requireRole: (...args: unknown[]) => auth.requireRole(...args),
}));

const readers = vi.hoisted(() => ({ readInvoiceScanPrivate: vi.fn() }));
vi.mock("@/lib/staff-cost/protected-readers", () => ({
  readInvoiceScanPrivate: (...args: unknown[]) =>
    readers.readInvoiceScanPrivate(...args),
}));

const { POST } = await import("./route");

const KEY = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const SITE = "11111111-1111-4111-8111-111111111111";
const SCAN = "22222222-2222-4222-8222-222222222222";

function cacheReceipt() {
  return {
    version: 1,
    kind: "invoice_inventory_save",
    scanId: SCAN,
    status: "committed",
    itemCount: 2,
    wineCount: 2,
  };
}

function makeSupabase(options: {
  claim?: { data: unknown; error: unknown };
  review?: { data: unknown; error: unknown };
  commit?: { data: unknown; error: unknown };
  complete?: { data: unknown; error: unknown };
  abandon?: { data: unknown; error: unknown };
} = {}) {
  const calls: Array<{ name: string; args: unknown }> = [];
  return {
    calls,
    from: vi.fn(() => {
      throw new Error("save-scan must not use direct table DML");
    }),
    rpc: vi.fn(async (name: string, args: unknown) => {
      calls.push({ name, args });
      if (name === "claim_scan_idempotency") {
        return options.claim ?? {
          data: [{ disposition: "claimed", receipt: null }],
          error: null,
        };
      }
      if (name === "review_invoice_scan") {
        return options.review ?? {
          data: { scanId: SCAN, status: "complete", itemCount: 2, updated: true },
          error: null,
        };
      }
      if (name === "commit_invoice_scan") {
        return options.commit ?? {
          data: { scanId: SCAN, itemCount: 2, wineCount: 2 },
          error: null,
        };
      }
      if (name === "complete_scan_idempotency") {
        return options.complete ?? { data: cacheReceipt(), error: null };
      }
      if (name === "abandon_scan_idempotency") {
        return options.abandon ?? { data: true, error: null };
      }
      throw new Error(`Unexpected RPC ${name}`);
    }),
  };
}

function allow(supabase: ReturnType<typeof makeSupabase>) {
  auth.requireRole.mockResolvedValue({
    supabase,
    restaurantId: SITE,
    user: { id: "33333333-3333-4333-8333-333333333333" },
    role: "manager",
  });
}

function privateScan(overrides: Record<string, unknown> = {}) {
  return {
    scan_id: SCAN,
    restaurant_id: SITE,
    updated_at: "2026-09-26T12:00:00.000Z",
    committed_at: null,
    ...overrides,
  };
}

function request(
  body: unknown,
  key: string | null = KEY,
): NextRequest {
  const headers = new Headers({ "content-type": "application/json" });
  if (key) headers.set("Idempotency-Key", key);
  return new Request("http://localhost/api/inventory/save-scan", {
    method: "POST",
    headers,
    body: typeof body === "string" ? body : JSON.stringify(body),
  }) as unknown as NextRequest;
}

function body(overrides: Record<string, unknown> = {}) {
  const scan = makeScan({ scanId: SCAN, ...overrides });
  return { scan, originalItems: scan.items };
}

describe("POST /api/inventory/save-scan closed commit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    readers.readInvoiceScanPrivate.mockResolvedValue(privateScan());
  });

  it("requires owner or manager before any cache operation", async () => {
    auth.requireRole.mockResolvedValue(
      NextResponse.json({ error: "Forbidden" }, { status: 403 }),
    );
    const response = await POST(request(body()));
    expect(response.status).toBe(403);
    expect(readers.readInvoiceScanPrivate).not.toHaveBeenCalled();
  });

  it("requires a valid idempotency key before protected reads or writes", async () => {
    const supabase = makeSupabase();
    allow(supabase);
    const response = await POST(request(body(), null));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: { code: "idempotency_key_required" },
    });
    expect(supabase.rpc).not.toHaveBeenCalled();
    expect(readers.readInvoiceScanPrivate).not.toHaveBeenCalled();
  });

  it("requires an existing uploaded scan instead of creating a private row directly", async () => {
    const supabase = makeSupabase();
    allow(supabase);
    const response = await POST(request(body({ scanId: undefined })));
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({
      error: { code: "scan_upload_required" },
    });
    expect(supabase.rpc).not.toHaveBeenCalled();
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it("rejects arithmetic mismatches before claiming or mutating", async () => {
    const supabase = makeSupabase();
    allow(supabase);
    const response = await POST(request(body({
      items: [makeLineItem({ qty: 6, unitCost: 18, lineTotal: 270 })],
    })));
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({
      error: { code: "arithmetic_mismatch" },
    });
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it("reviews then atomically commits and completes the typed count receipt", async () => {
    const supabase = makeSupabase();
    allow(supabase);

    const response = await POST(request(body()));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(cacheReceipt());
    expect(supabase.from).not.toHaveBeenCalled();
    expect(supabase.calls.map((call) => call.name)).toEqual([
      "claim_scan_idempotency",
      "review_invoice_scan",
      "commit_invoice_scan",
      "complete_scan_idempotency",
    ]);
    expect(supabase.calls[1]).toEqual({
      name: "review_invoice_scan",
      args: expect.objectContaining({
        p_scan_id: SCAN,
        p_expected_updated_at: "2026-09-26T12:00:00.000Z",
      }),
    });
    expect(supabase.calls.at(-1)).toEqual({
      name: "complete_scan_idempotency",
      args: expect.objectContaining({
        p_kind: "invoice_inventory_save",
        p_scan_id: SCAN,
        p_item_count: 2,
        p_wine_count: 2,
        p_wine_id: null,
      }),
    });
  });

  it("returns a validated cache replay without protected reader or commit work", async () => {
    const supabase = makeSupabase({
      claim: {
        data: [{ disposition: "replay", receipt: cacheReceipt() }],
        error: null,
      },
    });
    allow(supabase);
    const response = await POST(request(body()));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(cacheReceipt());
    expect(readers.readInvoiceScanPrivate).not.toHaveBeenCalled();
    expect(supabase.calls.map((call) => call.name)).toEqual([
      "claim_scan_idempotency",
    ]);
  });

  it("uses the durable commit replay when the scan is already committed", async () => {
    const supabase = makeSupabase();
    allow(supabase);
    readers.readInvoiceScanPrivate.mockResolvedValue(
      privateScan({ committed_at: "2026-09-26T12:01:00.000Z" }),
    );
    const response = await POST(request(body()));
    expect(response.status).toBe(200);
    expect(supabase.calls.map((call) => call.name)).toEqual([
      "claim_scan_idempotency",
      "commit_invoice_scan",
      "complete_scan_idempotency",
    ]);
  });

  it("abandons a known rolled-back commit refusal before returning a redacted error", async () => {
    const supabase = makeSupabase({
      commit: {
        data: null,
        error: { code: "P0001", message: "sensitive database detail" },
      },
    });
    allow(supabase);
    const response = await POST(request(body()));
    const text = await response.text();
    expect(response.status).toBe(500);
    expect(text).not.toContain("sensitive");
    expect(supabase.calls.map((call) => call.name)).toEqual([
      "claim_scan_idempotency",
      "review_invoice_scan",
      "commit_invoice_scan",
      "abandon_scan_idempotency",
    ]);
  });

  it("preserves the claim after a malformed commit receipt because the write may be durable", async () => {
    const supabase = makeSupabase({
      commit: { data: { scanId: SCAN, itemCount: 2 }, error: null },
    });
    allow(supabase);
    const response = await POST(request(body()));
    expect(response.status).toBe(500);
    expect(supabase.calls.map((call) => call.name)).toEqual([
      "claim_scan_idempotency",
      "review_invoice_scan",
      "commit_invoice_scan",
    ]);
  });
});
