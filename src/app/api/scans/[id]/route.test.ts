import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse, type NextRequest } from "next/server";

const auth = vi.hoisted(() => ({ requireRole: vi.fn() }));
vi.mock("@/lib/api/auth", () => ({
  requireRole: (...args: unknown[]) => auth.requireRole(...args),
}));

const { PATCH } = await import("./route");

const SCAN_ID = "11111111-1111-4111-8111-111111111111";
const RESTAURANT_ID = "22222222-2222-4222-8222-222222222222";
const UPDATED_AT = "2026-09-26T12:00:00.000Z";

function lineItem(overrides: Record<string, unknown> = {}) {
  return {
    id: "line-1",
    name: "Barolo",
    producer: "Test Producer",
    vintage: 2019,
    varietal: "Nebbiolo",
    region: "Piedmont",
    qty: 2,
    unitCost: 95,
    currency: "EUR",
    format: "1.5L",
    confidence: 0.92,
    lowFields: ["currency", "format"],
    ...overrides,
  };
}

function makeRequest(body: unknown) {
  return new Request(`http://localhost/api/scans/${SCAN_ID}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }) as NextRequest;
}

function reviewBody(overrides: Record<string, unknown> = {}) {
  return {
    expectedUpdatedAt: UPDATED_AT,
    distributor: "Reliable Distribution",
    invoiceNumber: "INV-1",
    invoiceDate: "2026-09-26",
    items: [lineItem()],
    edits: {},
    ...overrides,
  };
}

function makeReviewSupabase(result: { data: unknown; error: unknown } = {
  data: { scanId: SCAN_ID, status: "complete", itemCount: 1, updated: true },
  error: null,
}) {
  const rpc = vi.fn(async () => result);
  const filters = new Map<string, unknown>();
  const query = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn((column: string, value: unknown) => {
      filters.set(column, value);
      return query;
    }),
    maybeSingle: vi.fn(async () => ({
      data: filters.get("restaurant_id") === RESTAURANT_ID ? { id: SCAN_ID } : null,
      error: null as unknown,
    })),
  };
  const from = vi.fn(() => query);
  return { supabase: { rpc, from }, rpc, from, query };
}

function authorize(supabase: unknown) {
  auth.requireRole.mockResolvedValue({
    supabase,
    restaurantId: RESTAURANT_ID,
    user: { id: "33333333-3333-4333-8333-333333333333" },
    role: "manager",
  });
}

describe("PATCH /api/scans/[id]", () => {
  beforeEach(() => vi.clearAllMocks());

  it.each([
    ["fractional quantity", { items: [lineItem({ qty: 1.5 })] }],
    ["fractional vintage", { items: [lineItem({ vintage: 2019.5 })] }],
    ["out-of-range confidence", { items: [lineItem({ confidence: 1.1 })] }],
    ["false edit markers", { edits: { "line-1:name": false } }],
    ["an invalid displayed revision", { expectedUpdatedAt: "not-a-date" }],
    ["an extra top-level key", { protectedCost: 95 }],
    ["an extra line key", { items: [lineItem({ protectedCost: 95 })] }],
    ["a malformed matched wine identity", { items: [lineItem({ wine_id: "not-a-uuid" })] }],
    ["too many line items", { items: Array.from({ length: 501 }, () => lineItem()) }],
    ["an oversized field", { distributor: "x".repeat(501) }],
  ])("rejects %s before database work", async (_name, overrides) => {
    const { supabase, rpc } = makeReviewSupabase();
    authorize(supabase);

    const response = await PATCH(makeRequest(reviewBody(overrides)), {
      params: Promise.resolve({ id: SCAN_ID }),
    });

    expect(response.status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("binds an otherwise authorized review to the selected venue", async () => {
    const db = makeReviewSupabase();
    db.query.maybeSingle.mockResolvedValue({ data: null, error: null });
    authorize(db.supabase);
    const response = await PATCH(makeRequest(reviewBody()), { params: Promise.resolve({ id: SCAN_ID }) });
    expect(response.status).toBe(404);
    expect(db.from).toHaveBeenCalledWith("invoice_scans");
    expect(db.query.select).toHaveBeenCalledWith("id");
    expect(db.query.eq).toHaveBeenCalledWith("id", SCAN_ID);
    expect(db.query.eq).toHaveBeenCalledWith("restaurant_id", RESTAURANT_ID);
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it.each(["returned", "thrown"])("does not review after a %s site lookup failure", async (kind) => {
    const db = makeReviewSupabase();
    db.query.maybeSingle.mockResolvedValue({ data: null, error: { message: "private lookup" } });
    if (kind === "thrown") db.query.maybeSingle.mockRejectedValue(new Error("private lookup"));
    authorize(db.supabase);
    const response = await PATCH(makeRequest(reviewBody()), { params: Promise.resolve({ id: SCAN_ID }) });
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain("private lookup");
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it("requires manager authorization before the review RPC", async () => {
    const { rpc } = makeReviewSupabase();
    auth.requireRole.mockResolvedValue(NextResponse.json({ error: "no" }, { status: 403 }));
    const response = await PATCH(makeRequest(reviewBody()), {
      params: Promise.resolve({ id: SCAN_ID }),
    });
    expect(response.status).toBe(403);
    expect(auth.requireRole).toHaveBeenCalledWith(["owner", "manager"]);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("sends displayed CAS, metadata, line edits, and identities through one closed RPC", async () => {
    const db = makeReviewSupabase();
    authorize(db.supabase);

    const response = await PATCH(
      makeRequest(reviewBody({
        items: [lineItem()],
        edits: { "line-1:name": true },
      })),
      { params: Promise.resolve({ id: SCAN_ID }) },
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      scanId: SCAN_ID,
      status: "complete",
      itemCount: 1,
      updated: true,
    });
    expect(db.rpc).toHaveBeenCalledTimes(1);
    expect(db.rpc).toHaveBeenCalledWith("review_invoice_scan", {
      p_scan_id: SCAN_ID,
      p_expected_updated_at: UPDATED_AT,
      p_distributor_name: "Reliable Distribution",
      p_invoice_number: "INV-1",
      p_invoice_date: "2026-09-26",
      p_final_line_items: [lineItem()],
      p_edits: { "line-1:name": true },
    });
  });

  it("preserves a reconciled wine identity through the closed review RPC", async () => {
    const db = makeReviewSupabase();
    authorize(db.supabase);
    const wineId = "33333333-3333-4333-8333-333333333333";
    const response = await PATCH(makeRequest(reviewBody({
      items: [lineItem({ wine_id: wineId })],
    })), { params: Promise.resolve({ id: SCAN_ID }) });
    expect(response.status).toBe(200);
    expect(db.rpc).toHaveBeenCalledWith(
      "review_invoice_scan",
      expect.objectContaining({
        p_final_line_items: [lineItem({ wine_id: wineId })],
      }),
    );
  });

  it.each([
    ["stale review", { code: "P0001", message: "scan_superseded" }, 409, "scan_superseded"],
    ["committed review", { code: "P0001", message: "scan_already_committed" }, 409, "scan_already_committed"],
    ["missing or cross-site cost grant", { code: "42501", message: "forbidden" }, 403, "forbidden"],
  ])("maps %s to a safe refusal", async (_name, error, status, code) => {
    const db = makeReviewSupabase({ data: null, error });
    authorize(db.supabase);
    const response = await PATCH(makeRequest(reviewBody()), {
      params: Promise.resolve({ id: SCAN_ID }),
    });
    expect(response.status).toBe(status);
    expect((await response.json()).error.code).toBe(code);
    expect(db.rpc).toHaveBeenCalledTimes(1);
  });

  it.each([
    { scanId: "33333333-3333-4333-8333-333333333333", status: "complete", itemCount: 1, updated: true },
    { scanId: SCAN_ID, status: "complete", itemCount: 2, updated: true },
    { scanId: SCAN_ID, status: "complete", itemCount: 1, updated: true, unitCost: 95 },
  ])("rejects malformed or mismatched review receipt %#", async (data) => {
    const db = makeReviewSupabase({ data, error: null });
    authorize(db.supabase);
    const response = await PATCH(makeRequest(reviewBody()), {
      params: Promise.resolve({ id: SCAN_ID }),
    });
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: { code: "internal_error", message: "Internal server error." },
    });
  });
});

// ── DELETE (SCAN-04 / D6) ───────────────────────────────────────────────

const { DELETE } = await import("./route");

function makeDeleteRequest() {
  return new Request(`http://localhost/api/scans/${SCAN_ID}`, {
    method: "DELETE",
  }) as NextRequest;
}

function makeRpcSupabase(result: { data: unknown; error: unknown }) {
  const rpc = vi.fn(async () => result);
  return { supabase: { rpc }, rpc };
}

describe("DELETE /api/scans/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("reverses inventory through delete_invoice_scan and reports the impact", async () => {
    const { supabase, rpc } = makeRpcSupabase({
      data: { scanId: SCAN_ID, inventoryRowsDeleted: 3, bottlesRemoved: 18 },
      error: null,
    });
    auth.requireRole.mockResolvedValue({
      supabase,
      restaurantId: RESTAURANT_ID,
      role: "manager",
    });

    const response = await DELETE(makeDeleteRequest(), {
      params: Promise.resolve({ id: SCAN_ID }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      scanId: SCAN_ID,
      inventoryRowsDeleted: 3,
      bottlesRemoved: 18,
    });
    // One RPC, one transaction — never a client-side "delete inventory then
    // delete the scan" sequence that can half-happen.
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("delete_invoice_scan", { p_scan_id: SCAN_ID });
  });

  it("requires owner or manager", async () => {
    auth.requireRole.mockImplementation(async (roles: string[]) => {
      expect(roles).toEqual(["owner", "manager"]);
      return NextResponse.json({ error: "no" }, { status: 403 });
    });

    const response = await DELETE(makeDeleteRequest(), {
      params: Promise.resolve({ id: SCAN_ID }),
    });
    expect(response.status).toBe(403);
  });

  it("maps the RPC's not-found signal to 404 without leaking the raw error", async () => {
    const { supabase } = makeRpcSupabase({
      data: null,
      error: { code: "P0002", message: "invoice scan ... not found" },
    });
    auth.requireRole.mockResolvedValue({ supabase, restaurantId: RESTAURANT_ID, role: "owner" });

    const response = await DELETE(makeDeleteRequest(), {
      params: Promise.resolve({ id: SCAN_ID }),
    });
    expect(response.status).toBe(404);
    expect((await response.json()).error.code).toBe("not_found");
  });

  it("maps the RPC's privilege signal to 403", async () => {
    const { supabase } = makeRpcSupabase({
      data: null,
      error: { code: "P0003", message: "insufficient privilege" },
    });
    auth.requireRole.mockResolvedValue({ supabase, restaurantId: RESTAURANT_ID, role: "manager" });

    const response = await DELETE(makeDeleteRequest(), {
      params: Promise.resolve({ id: SCAN_ID }),
    });
    expect(response.status).toBe(403);
  });

  it("maps only the exact dependency signal to a sanitized 409 and still calls one RPC", async () => {
    const { supabase, rpc } = makeRpcSupabase({
      data: null,
      error: { code: "P0001", message: " physical_bottle_dependency " },
    });
    auth.requireRole.mockResolvedValue({ supabase, restaurantId: RESTAURANT_ID, role: "owner" });

    const response = await DELETE(makeDeleteRequest(), {
      params: Promise.resolve({ id: SCAN_ID }),
    });

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: {
        code: "physical_bottle_dependency",
        message: "Invoice cannot be deleted because physical bottles depend on its imported inventory.",
      },
    });
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it.each([
    [{ code: "P0001", message: "other failure" }],
    [{ code: "P0001", message: "physical_bottle_dependency: detail" }],
    [{ code: "23503", message: "physical_bottle_dependency" }],
  ])("keeps non-exact dependency errors on the redacted 500 path", async (error) => {
    const { supabase } = makeRpcSupabase({ data: null, error });
    auth.requireRole.mockResolvedValue({ supabase, restaurantId: RESTAURANT_ID, role: "owner" });

    const response = await DELETE(makeDeleteRequest(), { params: Promise.resolve({ id: SCAN_ID }) });
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: { code: "internal_error", message: "Internal server error." } });
  });

  it("rejects a non-uuid scan id before touching the database", async () => {
    const { supabase, rpc } = makeRpcSupabase({ data: null, error: null });
    auth.requireRole.mockResolvedValue({ supabase, restaurantId: RESTAURANT_ID, role: "owner" });

    const response = await DELETE(makeDeleteRequest(), {
      params: Promise.resolve({ id: "not-a-uuid" }),
    });
    expect(response.status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });
});
