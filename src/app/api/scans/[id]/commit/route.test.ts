import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse, type NextRequest } from "next/server";

const auth = vi.hoisted(() => ({ requireRole: vi.fn() }));
vi.mock("@/lib/api/auth", () => ({
  requireRole: (...args: unknown[]) => auth.requireRole(...args),
}));

const { POST } = await import("./route");

const SCAN_ID = "11111111-1111-4111-8111-111111111111";
const RESTAURANT_ID = "22222222-2222-4222-8222-222222222222";
const RECEIPT = { scanId: SCAN_ID, itemCount: 2, wineCount: 1 };

function makeSupabase(result: { data: unknown; error: unknown } = {
  data: RECEIPT,
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
    user: { id: "44444444-4444-4444-8444-444444444444" },
    role: "manager",
  });
}

function call(id = SCAN_ID) {
  return POST({} as NextRequest, {
    params: Promise.resolve({ id }),
  });
}

describe("POST /api/scans/[id]/commit", () => {
  beforeEach(() => vi.clearAllMocks());

  it("commits through one atomic RPC and returns its closed receipt", async () => {
    const db = makeSupabase();
    authorize(db.supabase);
    const response = await call();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(RECEIPT);
    expect(db.rpc).toHaveBeenCalledTimes(1);
    expect(db.rpc).toHaveBeenCalledWith("commit_invoice_scan", { p_scan_id: SCAN_ID });
  });

  it("binds an otherwise authorized scan to the selected venue", async () => {
    const db = makeSupabase();
    db.query.maybeSingle.mockResolvedValue({ data: null, error: null });
    authorize(db.supabase);
    const response = await call();
    expect(response.status).toBe(404);
    expect(db.from).toHaveBeenCalledWith("invoice_scans");
    expect(db.query.select).toHaveBeenCalledWith("id");
    expect(db.query.eq).toHaveBeenCalledWith("id", SCAN_ID);
    expect(db.query.eq).toHaveBeenCalledWith("restaurant_id", RESTAURANT_ID);
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it.each(["returned", "thrown"])("does not commit after a %s site lookup failure", async (kind) => {
    const db = makeSupabase();
    db.query.maybeSingle.mockResolvedValue({ data: null, error: { message: "private lookup" } });
    if (kind === "thrown") db.query.maybeSingle.mockRejectedValue(new Error("private lookup"));
    authorize(db.supabase);
    const response = await call();
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain("private lookup");
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it("requires manager authorization before the commit RPC", async () => {
    const db = makeSupabase();
    auth.requireRole.mockResolvedValue(NextResponse.json({ error: "no" }, { status: 403 }));
    const response = await call();
    expect(response.status).toBe(403);
    expect(auth.requireRole).toHaveBeenCalledWith(["owner", "manager"]);
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it("rejects a malformed scan id before the commit RPC", async () => {
    const db = makeSupabase();
    authorize(db.supabase);
    expect((await call("not-a-uuid")).status).toBe(400);
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it("keeps cross-site and missing-cost authorization dependent on the RPC", async () => {
    const db = makeSupabase({ data: null, error: { code: "42501", message: "forbidden" } });
    authorize(db.supabase);
    const response = await call();
    expect(response.status).toBe(403);
    expect((await response.json()).error.code).toBe("forbidden");
    expect(db.rpc).toHaveBeenCalledTimes(1);
  });

  it("redacts unexpected database failures", async () => {
    const db = makeSupabase({ data: null, error: { code: "P0001", message: "private cost detail" } });
    authorize(db.supabase);
    const response = await call();
    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain("private cost detail");
  });

  it.each([
    { scanId: "33333333-3333-4333-8333-333333333333", itemCount: 2, wineCount: 1 },
    { scanId: SCAN_ID, itemCount: 1, wineCount: 2 },
    { scanId: SCAN_ID, itemCount: 2, wineCount: 1, unitCost: 95 },
    { scanId: SCAN_ID, itemCount: 0, wineCount: 0 },
  ])("rejects malformed or mismatched commit receipt %#", async (data) => {
    const db = makeSupabase({ data, error: null });
    authorize(db.supabase);
    const response = await call();
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: { code: "internal_error", message: "Internal server error." },
    });
  });

  it("returns the identical closed receipt when the atomic RPC replays", async () => {
    const db = makeSupabase();
    authorize(db.supabase);
    const first = await call();
    const second = await call();
    expect(await first.json()).toEqual(RECEIPT);
    expect(await second.json()).toEqual(RECEIPT);
    expect(db.rpc).toHaveBeenCalledTimes(2);
  });
});
