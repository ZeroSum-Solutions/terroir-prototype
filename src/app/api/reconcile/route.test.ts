import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse, type NextRequest } from "next/server";

const mockRequireRole = vi.fn();
vi.mock("@/lib/api/auth", () => ({
  requireRole: (...args: unknown[]) => mockRequireRole(...args),
}));
const mockRevalidate = vi.fn();
vi.mock("next/cache", () => ({ revalidatePath: mockRevalidate }));

const { POST } = await import("./route");

type RpcCall = { fn: string; args: unknown };

/**
 * Mock satisfies:
 *   - supabase.rpc('reconcile_open_bottles_batch', ...)  →  count
 *   - supabase.rpc('wine_published_list_slugs', ...)  →  slug rows
 *   - supabase.from('availability_events').select(...)
 *       .eq().eq().is().gte().in()  →  auto-86 event rows (ARCH-023)
 */
function makeSupabase(opts: {
  contractVersion?: 1 | 2;
  reconcile:
    | { data: number; error: null }
    | { data: null; error: { code?: string; message?: string } };
  physicalResult?: { data: unknown; error: null | { code?: string; message?: string } };
  autoEightysixedWineIds?: string[];
  publishedSlugs?: Array<{ slug: string }>;
}) {
  const calls: RpcCall[] = [];
  const rpc = vi.fn((fn: string, args: unknown) => {
    calls.push({ fn, args });
    if (fn === "current_inventory_contract_version") {
      return Promise.resolve({ data: opts.contractVersion ?? 1, error: null });
    }
    if (fn === "reconcile_open_bottles_batch") {
      return Promise.resolve(opts.reconcile);
    }
    if (fn === "execute_physical_reconciliation_batch") {
      return Promise.resolve(opts.physicalResult ?? { data: null, error: null });
    }
    if (fn === "wine_published_list_slugs") {
      return Promise.resolve({
        data: opts.publishedSlugs ?? [],
        error: null,
      });
    }
    return Promise.resolve({ data: null, error: null });
  });
  const from = vi.fn((table: string) => {
    const chain: Record<string, unknown> = {};
    const thenable = {
      select: () => thenable,
      eq: () => thenable,
      is: () => thenable,
      gte: () => thenable,
      in: () => thenable,
      then: (resolve: (v: unknown) => void) => {
        if (table === "availability_events") {
          resolve({
            data: (opts.autoEightysixedWineIds ?? []).map((id) => ({
              wine_id: id,
            })),
            error: null,
          });
        } else {
          resolve({ data: null, error: null });
        }
      },
    };
    Object.assign(chain, thenable);
    return chain;
  });
  return { supabase: { rpc, from }, calls };
}

function makeRequest(body: unknown, operationId?: string): NextRequest {
  const headers = new Headers({ "content-type": "application/json" });
  if (operationId) headers.set("Idempotency-Key", operationId);
  return new Request("http://localhost/api/reconcile", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  }) as unknown as NextRequest;
}

const UUID_A = "a1b2c3d4-e5f6-4789-8abc-def012345678";
const UUID_B = "b1b2c3d4-e5f6-4789-8abc-def012345679";
const RESTAURANT_ID = "11111111-1111-4111-8111-111111111111";
const OPERATION_ID = "22222222-2222-4222-8222-222222222222";

describe("POST /api/reconcile", () => {
  beforeEach(() => vi.clearAllMocks());

  it("401s when unauthenticated", async () => {
    mockRequireRole.mockResolvedValue(
      NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    );
    const res = await POST(makeRequest({ entries: [] }));
    expect(res.status).toBe(401);
  });

  // BND-136: staff role is rejected at the HTTP endpoint level (before RPC)
  it("returns 403 when staff calls reconcile (endpoint-level role gate)", async () => {
    mockRequireRole.mockResolvedValue(
      NextResponse.json({ error: "Forbidden" }, { status: 403 }),
    );
    const res = await POST(
      makeRequest({
        entries: [{ wine_id: UUID_A, new_remaining_ml: 375 }],
      }),
    );
    expect(res.status).toBe(403);
    // requireRole was called with owner+manager roles
    expect(mockRequireRole).toHaveBeenCalledWith(["owner", "manager"]);
  });

  it("400s on empty entries", async () => {
    const { supabase } = makeSupabase({
      reconcile: { data: 0, error: null },
    });
    mockRequireRole.mockResolvedValue({
      supabase,
      restaurantId: "r-A",
      user: { id: "u-1" },
      role: "manager",
    });
    const res = await POST(makeRequest({ entries: [] }));
    expect(res.status).toBe(400);
  });

  it("returns 200 with updated count on happy path (single atomic RPC)", async () => {
    const { supabase, calls } = makeSupabase({
      reconcile: { data: 2, error: null },
    });
    mockRequireRole.mockResolvedValue({
      supabase,
      restaurantId: "r-A",
      user: { id: "u-1" },
      role: "manager",
    });
    const res = await POST(
      makeRequest({
        entries: [
          { wine_id: UUID_A, new_remaining_ml: 375 },
          { wine_id: UUID_B, new_remaining_ml: 0, note: "finished" },
        ],
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.updated).toBe(2);
    // Exactly ONE reconcile RPC call — the atomic batch.
    expect(
      calls.filter((c) => c.fn === "reconcile_open_bottles_batch"),
    ).toHaveLength(1);
    expect(mockRevalidate).toHaveBeenCalledWith("/availability");
  });

  it("requires a UUID operation key and rejects duplicate physical bottle entries before mutation", async () => {
    const { supabase, calls } = makeSupabase({
      contractVersion: 2,
      reconcile: { data: 0, error: null },
    });
    mockRequireRole.mockResolvedValue({
      supabase,
      restaurantId: RESTAURANT_ID,
      user: { id: "u-1" },
      role: "manager",
    });
    const entry = {
      open_bottle_id: UUID_A,
      expected_state_version: 2,
      target_remaining_ml: 200,
      note: null,
    };

    expect((await POST(makeRequest({ entries: [entry] }))).status).toBe(400);
    const duplicate = await POST(makeRequest({ entries: [entry, entry] }, OPERATION_ID));
    expect(duplicate.status).toBe(400);
    const legacyField = await POST(makeRequest({
      entries: [{ ...entry, wine_id: UUID_B }],
    }, OPERATION_ID));
    expect(legacyField.status).toBe(400);
    expect(calls.some((call) => call.fn === "execute_physical_reconciliation_batch")).toBe(false);
    expect(calls.some((call) => call.fn === "reconcile_open_bottles_batch")).toBe(false);
  });

  it("dispatches a strict physical batch and returns its validated canonical result", async () => {
    const bottle = UUID_A;
    const event = "33333333-3333-4333-8333-333333333333";
    const wine = UUID_B;
    const physicalResult = {
      operation_id: OPERATION_ID,
      command: "reconcile_batch",
      entries: [{
        entry_ordinal: 0,
        open_bottle_id: bottle,
        wine_id: wine,
        pour_event_id: event,
        open_bottle: {
          id: bottle,
          restaurant_id: RESTAURANT_ID,
          wine_id: wine,
          remaining_ml: 200,
          nominal_capacity_ml: 750,
          opened_at: "2026-09-24T12:00:00.000Z",
          closed_at: null,
          preservation_method: "none",
          source_inventory_item_id: null,
          source_provenance: "legacy_unknown",
          identity_contract: 2,
          identity_origin: "migrated_active",
          state_version: 3,
        },
      }],
      replayed: false,
    };
    const { supabase, calls } = makeSupabase({
      contractVersion: 2,
      reconcile: { data: 0, error: null },
      physicalResult: { data: physicalResult, error: null },
    });
    mockRequireRole.mockResolvedValue({
      supabase,
      restaurantId: RESTAURANT_ID,
      user: { id: "u-1" },
      role: "manager",
    });

    const response = await POST(makeRequest({ entries: [{
      open_bottle_id: bottle,
      expected_state_version: 2,
      target_remaining_ml: 200,
      note: null,
    }] }, OPERATION_ID));

    expect(response.status).toBe(200);
    expect(response.headers.get("Idempotency-Key")).toBe(OPERATION_ID);
    expect(await response.json()).toMatchObject({
      operation_id: OPERATION_ID,
      command: "reconcile_batch",
      entries: [{ open_bottle_id: bottle, wine_id: wine, state_version: 3 }],
    });
    expect(calls.filter((call) => call.fn === "execute_physical_reconciliation_batch")).toHaveLength(1);
    expect(calls.some((call) => call.fn === "reconcile_open_bottles_batch")).toBe(false);
    expect(calls.filter((call) => call.fn === "current_inventory_contract_version")).toHaveLength(1);
  });

  it("maps a stale physical batch to conflict without a legacy retry", async () => {
    const { supabase, calls } = makeSupabase({
      contractVersion: 2,
      reconcile: { data: 0, error: null },
      physicalResult: { data: null, error: { code: "P0001", message: "reconciliation_batch_stale" } },
    });
    mockRequireRole.mockResolvedValue({
      supabase, restaurantId: RESTAURANT_ID, user: { id: "u-1" }, role: "manager",
    });
    const response = await POST(makeRequest({ entries: [{
      open_bottle_id: UUID_A,
      expected_state_version: 2,
      target_remaining_ml: 200,
      note: null,
    }] }, OPERATION_ID));

    expect(response.status).toBe(409);
    expect(response.headers.get("Idempotency-Key")).toBe(OPERATION_ID);
    expect(calls.filter((call) => call.fn === "execute_physical_reconciliation_batch")).toHaveLength(1);
    expect(calls.some((call) => call.fn === "reconcile_open_bottles_batch")).toBe(false);
  });

  // Defense-in-depth: RPC also enforces role. If a manager somehow has
  // insufficient DB-level perms the RPC surfaces 42501 → 403.
  it("returns 403 when the RPC raises permission error (42501) as defense-in-depth", async () => {
    const { supabase } = makeSupabase({
      reconcile: {
        data: null,
        error: { code: "42501", message: "forbidden" },
      },
    });
    mockRequireRole.mockResolvedValue({
      supabase,
      restaurantId: "r-A",
      user: { id: "u-1" },
      role: "manager",
    });
    const res = await POST(
      makeRequest({
        entries: [{ wine_id: UUID_A, new_remaining_ml: 375 }],
      }),
    );
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({
      error: {
        code: "forbidden",
        message:
          "One or more of these wines aren't in your restaurant. Refresh the page and try again.",
      },
    });
  });

  it("returns 400 EXCEEDS_SIZE when RPC raises P0002", async () => {
    const { supabase } = makeSupabase({
      reconcile: {
        data: null,
        error: {
          code: "P0002",
          message: "p_new_remaining_ml exceeds bottle size (750)",
        },
      },
    });
    mockRequireRole.mockResolvedValue({
      supabase,
      restaurantId: "r-A",
      user: { id: "u-1" },
      role: "manager",
    });
    const res = await POST(
      makeRequest({
        entries: [{ wine_id: UUID_A, new_remaining_ml: 7500 }],
      }),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("EXCEEDS_SIZE");
  });

  // ARCH-023: auto-86 revalidation across a batch
  it("does NOT revalidate /list/* paths when no auto-86 events were inserted", async () => {
    const { supabase, calls } = makeSupabase({
      reconcile: { data: 2, error: null },
      autoEightysixedWineIds: [],
    });
    mockRequireRole.mockResolvedValue({
      supabase,
      restaurantId: "r-A",
      user: { id: "u-1" },
      role: "manager",
    });
    await POST(
      makeRequest({
        entries: [
          { wine_id: UUID_A, new_remaining_ml: 375 },
          { wine_id: UUID_B, new_remaining_ml: 0 },
        ],
      }),
    );
    expect(
      mockRevalidate.mock.calls.some((c) =>
        String(c[0] ?? "").startsWith("/list/"),
      ),
    ).toBe(false);
    expect(calls.some((c) => c.fn === "wine_published_list_slugs")).toBe(
      false,
    );
  });

  it("revalidates /list/<slug> for every wine in the batch that got auto-86'd", async () => {
    const { supabase, calls } = makeSupabase({
      reconcile: { data: 2, error: null },
      // Only UUID_B got auto-86'd (its entry set remaining to 0).
      autoEightysixedWineIds: [UUID_B],
      publishedSlugs: [{ slug: "dinner-menu" }],
    });
    mockRequireRole.mockResolvedValue({
      supabase,
      restaurantId: "r-A",
      user: { id: "u-1" },
      role: "manager",
    });
    await POST(
      makeRequest({
        entries: [
          { wine_id: UUID_A, new_remaining_ml: 375 },
          { wine_id: UUID_B, new_remaining_ml: 0 },
        ],
      }),
    );
    expect(mockRevalidate).toHaveBeenCalledWith("/list/dinner-menu");
    const slugCalls = calls.filter(
      (c) => c.fn === "wine_published_list_slugs",
    );
    expect(slugCalls).toHaveLength(1);
    expect(slugCalls[0].args).toMatchObject({
      p_wine_id: UUID_B,
      p_restaurant_id: "r-A",
    });
  });
});
