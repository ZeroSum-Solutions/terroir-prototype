import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse, type NextRequest } from "next/server";

const mockRequireMembership = vi.fn();
vi.mock("@/lib/api/auth", () => ({
  requireMembership: (...args: unknown[]) => mockRequireMembership(...args),
}));

const mockResolveImportBatchRow = vi.fn();
vi.mock("@/domains/import/batch-service", () => ({
  resolveImportBatchRow: (...args: unknown[]) => mockResolveImportBatchRow(...args),
}));

const { PATCH } = await import("./route");

const BATCH_ID = "11111111-1111-4111-8111-111111111111";
const ROW_ID = "22222222-2222-4222-8222-222222222222";
const RECEIPT = {
  rowId: ROW_ID,
  batchId: BATCH_ID,
  status: "resolved",
  updated: true,
} as const;

function request(body: unknown) {
  return new Request(`http://localhost/api/import/batches/${BATCH_ID}/rows/${ROW_ID}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;
}
function params() {
  return Promise.resolve({ id: BATCH_ID, rowId: ROW_ID });
}

function makeSupabase(row: unknown) {
  const eqCalls: Array<[string, unknown]> = [];
  return {
    eqCalls,
    from: vi.fn(() => ({
      select: () => ({
        eq: (c: string, v: unknown) => {
          eqCalls.push([c, v]);
          return {
            eq: (c2: string, v2: unknown) => {
              eqCalls.push([c2, v2]);
              return {
                eq: (c3: string, v3: unknown) => {
                  eqCalls.push([c3, v3]);
                  return { maybeSingle: async () => ({ data: row, error: null }) };
                },
              };
            },
          };
        },
      }),
    })),
  };
}

function allow(supabase: unknown) {
  mockRequireMembership.mockResolvedValue({
    supabase,
    restaurantId: "restaurant-a",
    user: { id: "user-a" },
    role: "staff",
  });
}

describe("PATCH /api/import/batches/[id]/rows/[rowId]", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns membership denial before params, body, lookup, or service work", async () => {
    const supabase = makeSupabase({ id: ROW_ID });
    mockRequireMembership.mockResolvedValue(
      NextResponse.json({ error: "denied" }, { status: 401 }),
    );

    const response = await PATCH(request({ action: "delete" }), {
      params: Promise.resolve({ id: "not-a-uuid", rowId: "not-a-uuid" }),
    });

    expect(response.status).toBe(401);
    expect(supabase.from).not.toHaveBeenCalled();
    expect(mockResolveImportBatchRow).not.toHaveBeenCalled();
  });

  it("404s when the row doesn't belong to this batch/tenant, never calling resolve", async () => {
    allow(makeSupabase(null));
    const response = await PATCH(request({ action: "exclude" }), { params: params() });
    expect(response.status).toBe(404);
    expect(mockResolveImportBatchRow).not.toHaveBeenCalled();
  });

  it("rejects an invalid action", async () => {
    allow(makeSupabase({ id: ROW_ID }));
    const response = await PATCH(request({ action: "delete" }), { params: params() });
    expect(response.status).toBe(400);
  });

  it.each([
    ["invalid params", request({ action: "exclude" }), Promise.resolve({ id: "bad", rowId: ROW_ID })],
    ["malformed JSON", request(undefined), params()],
  ])("rejects %s before row lookup or service work", async (_label, req, routeParams) => {
    const supabase = makeSupabase({ id: ROW_ID });
    allow(supabase);
    const actualRequest = _label === "malformed JSON"
      ? new Request(`http://localhost/api/import/batches/${BATCH_ID}/rows/${ROW_ID}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: "{",
        }) as unknown as NextRequest
      : req;

    const response = await PATCH(actualRequest, { params: routeParams });

    expect(response.status).toBe(400);
    expect(supabase.from).not.toHaveBeenCalled();
    expect(mockResolveImportBatchRow).not.toHaveBeenCalled();
  });

  it("scopes the row lookup to id + batch_id + restaurant_id", async () => {
    const supabase = makeSupabase({ id: ROW_ID });
    allow(supabase);
    mockResolveImportBatchRow.mockResolvedValue({ ok: true, receipt: RECEIPT });
    const response = await PATCH(request({ action: "exclude" }), { params: params() });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(RECEIPT);
    expect(supabase.eqCalls).toEqual([
      ["id", ROW_ID],
      ["batch_id", BATCH_ID],
      ["restaurant_id", "restaurant-a"],
    ]);
    expect(mockResolveImportBatchRow).toHaveBeenCalledWith(
      supabase,
      "restaurant-a",
      "user-a",
      ROW_ID,
      "exclude",
      undefined,
    );
  });

  it("surfaces a manual-cost-required rejection as 422", async () => {
    allow(makeSupabase({ id: ROW_ID }));
    mockResolveImportBatchRow.mockResolvedValue({
      ok: false,
      error: { code: "manual_cost_required", message: "A non-negative unit cost is required." },
    });
    const response = await PATCH(request({ action: "include" }), { params: params() });
    expect(response.status).toBe(422);
  });

  it.each([
    ["not_found", 404],
    ["not_pending", 422],
    ["manual_cost_required", 422],
    ["forbidden", 403],
    ["resolution_refused", 500],
    ["internal_error", 500],
  ])("maps the fixed %s failure without leaking details", async (code, status) => {
    allow(makeSupabase({ id: ROW_ID }));
    mockResolveImportBatchRow.mockResolvedValue({
      ok: false,
      error: { code, message: "Fixed safe message." },
    });

    const response = await PATCH(request({ action: "exclude" }), { params: params() });

    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({
      error: { code, message: "Fixed safe message." },
    });
  });
});
