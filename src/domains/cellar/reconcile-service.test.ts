import { beforeEach, describe, expect, it, vi } from "vitest";

const mockRevalidate = vi.fn();
vi.mock("next/cache", () => ({ revalidatePath: mockRevalidate }));
const mockCaptureException = vi.fn();
vi.mock("@sentry/nextjs", () => ({ captureException: mockCaptureException }));

const {
  ReconcileExceedsSizeError,
  ReconcileForbiddenError,
  ReconcileRpcError,
  reconcileOpenBottles,
  reconcilePhysicalBottles,
} = await import("./reconcile-service");

function makeSupabase(rpcResult: { data: unknown; error: { code?: string; message?: string } | null }) {
  const rpc = vi.fn((fn: string) => fn === "wine_published_list_slugs"
    ? Promise.resolve({ data: [], error: null })
    : Promise.resolve(rpcResult));
  const from = vi.fn(() => {
    const thenable = {
      select: () => thenable,
      eq: () => thenable,
      is: () => thenable,
      gte: () => thenable,
      in: () => thenable,
      then: (resolve: (v: unknown) => void) => resolve({ data: [], error: null }),
    };
    return thenable;
  });
  return { rpc, from };
}

const RESTAURANT_ID = "11111111-1111-4111-8111-111111111111";
const entries = [{ wine_id: "wine-1", new_remaining_ml: 400 }];

describe("reconcileOpenBottles", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns the reconciled count on success", async () => {
    const supabase = makeSupabase({ data: 3, error: null });

    const result = await reconcileOpenBottles({ supabase: supabase as never, restaurantId: RESTAURANT_ID, entries });

    expect(result).toBe(3);
    expect(mockRevalidate).toHaveBeenCalledWith("/availability");
  });

  it("maps a 42501 RPC error to ReconcileForbiddenError without reporting to Sentry", async () => {
    const supabase = makeSupabase({ data: null, error: { code: "42501" } });

    await expect(
      reconcileOpenBottles({ supabase: supabase as never, restaurantId: RESTAURANT_ID, entries }),
    ).rejects.toBeInstanceOf(ReconcileForbiddenError);
    expect(mockCaptureException).not.toHaveBeenCalled();
  });

  it("maps a P0002 RPC error to ReconcileExceedsSizeError (new_remaining_ml exceeds the bottle size)", async () => {
    const supabase = makeSupabase({ data: null, error: { code: "P0002" } });

    await expect(
      reconcileOpenBottles({ supabase: supabase as never, restaurantId: RESTAURANT_ID, entries }),
    ).rejects.toBeInstanceOf(ReconcileExceedsSizeError);
    expect(mockCaptureException).not.toHaveBeenCalled();
  });

  it("wraps any other RPC error as a reported ReconcileRpcError, not a false forbidden/size error", async () => {
    const supabase = makeSupabase({ data: null, error: { code: "XX000", message: "db exploded" } });

    await expect(
      reconcileOpenBottles({ supabase: supabase as never, restaurantId: RESTAURANT_ID, entries }),
    ).rejects.toBeInstanceOf(ReconcileRpcError);
    expect(mockCaptureException).toHaveBeenCalledTimes(1);
    expect(mockRevalidate).not.toHaveBeenCalled();
  });
});

describe("reconcilePhysicalBottles", () => {
  beforeEach(() => vi.clearAllMocks());
  const operationId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const bottleA = "00000000-0000-4000-8000-00000000000f";
  const bottleB = "00000000-0000-4000-8000-000000000010";
  const wineA = "11111111-1111-4111-8111-111111111111";
  const wineB = "22222222-2222-4222-8222-222222222222";
  const inputEntries = [
    { open_bottle_id: bottleB, expected_state_version: 6, target_remaining_ml: 250, note: null },
    { open_bottle_id: bottleA, expected_state_version: 3, target_remaining_ml: 100, note: "count" },
  ];

  function resultEntry(index: number, bottleId: string, wineId: string, remainingMl: number, stateVersion: number) {
    return {
      entry_ordinal: index,
      open_bottle_id: bottleId,
      wine_id: wineId,
      pour_event_id: `${index + 3}3333333-3333-4333-8333-333333333333`,
      open_bottle: {
        id: bottleId,
        restaurant_id: RESTAURANT_ID,
        wine_id: wineId,
        remaining_ml: remainingMl,
        nominal_capacity_ml: 750,
        opened_at: "2026-09-24T12:00:00.000Z",
        closed_at: null,
        preservation_method: "none",
        source_inventory_item_id: null,
        source_provenance: "legacy_unknown",
        identity_contract: 2,
        identity_origin: "migrated_active",
        state_version: stateVersion,
      },
    };
  }

  it("sends one canonical exact-bottle RPC and validates the full ordered result", async () => {
    const supabase = makeSupabase({ data: {
      operation_id: operationId,
      command: "reconcile_batch",
      entries: [
        resultEntry(0, bottleA, wineA, 100, 4),
        resultEntry(1, bottleB, wineB, 250, 7),
      ],
      replayed: false,
    }, error: null });

    const result = await reconcilePhysicalBottles({
      supabase: supabase as never,
      operationId,
      restaurantId: RESTAURANT_ID,
      entries: inputEntries,
    });

    expect(result.entries.map((entry) => entry.openBottleId)).toEqual([bottleA, bottleB]);
    expect(supabase.rpc).toHaveBeenNthCalledWith(1, "execute_physical_reconciliation_batch", {
      p_operation_id: operationId,
      p_restaurant_id: RESTAURANT_ID,
      p_entries: [inputEntries[1], inputEntries[0]],
    });
    expect(supabase.rpc).not.toHaveBeenCalledWith("reconcile_open_bottles_batch", expect.anything());
  });

  it("rejects a partial or retargeted result without revalidation or legacy fallback", async () => {
    const supabase = makeSupabase({ data: {
      operation_id: operationId,
      command: "reconcile_batch",
      entries: [resultEntry(0, bottleB, wineB, 250, 7)],
      replayed: false,
    }, error: null });

    await expect(reconcilePhysicalBottles({
      supabase: supabase as never,
      operationId,
      restaurantId: RESTAURANT_ID,
      entries: inputEntries,
    })).rejects.toThrow("invalid_physical_reconciliation_result");
    expect(mockRevalidate).not.toHaveBeenCalled();
    expect(supabase.rpc).toHaveBeenCalledTimes(1);
  });
});
