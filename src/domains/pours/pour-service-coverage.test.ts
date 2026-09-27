import { beforeEach, describe, expect, it, vi } from "vitest";
import * as physicalBottleCommand from "./physical-bottle-command";

const mockRevalidate = vi.fn();
vi.mock("next/cache", () => ({ revalidatePath: mockRevalidate }));
vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn() }));
vi.mock("@/lib/api/auto-eightysix-revalidation", () => ({
  revalidateAutoEightysixedWines: vi.fn(),
}));

const {
  PourNoInventoryError,
  PourNotFoundError,
  closeOpenBottle,
  discardOpenBottle,
  recordPour,
  undoLastPour,
} = await import("./pour-service");

const OPERATION_ID = "11111111-1111-4111-8111-111111111111";
const RESTAURANT_ID = "22222222-2222-4222-8222-222222222222";
const WINE_ID = "55555555-5555-4555-8555-555555555555";
const BOTTLE_ID = "66666666-6666-4666-8666-666666666666";
const OPENED_AT = "2026-09-23T12:00:00.000Z";

function makeRpcSupabase(
  result: { data: unknown; error: { code?: string; message?: string } | null },
  contractVersion: unknown = 1,
) {
  const rpc = vi.fn((name: string) => {
    if (name === "current_inventory_contract_version") {
      return Promise.resolve({ data: contractVersion, error: null });
    }
    return Promise.resolve(result);
  });
  return { rpc };
}

function makeLifecycleSupabase(options: {
  bottle: typeof activeBottle | null;
  fetchError?: { code?: string; message?: string } | null;
  rpcResult?: { data: unknown; error: { code?: string; message?: string } | null };
}) {
  const rpc = vi.fn(() => Promise.resolve(options.rpcResult ?? {
    data: null,
    error: null,
  }));
  const from = vi.fn(() => {
    const chain = {
      select: () => chain,
      eq: () => chain,
      single: async () => ({
        data: options.bottle,
        error: options.fetchError ?? null,
      }),
    };
    return chain;
  });
  return { rpc, from };
}

const activeBottle = {
  id: BOTTLE_ID,
  wine_id: WINE_ID,
  opened_at: OPENED_AT,
  closed_at: null,
  restaurant_id: RESTAURANT_ID,
};

describe("pour service defensive coverage", () => {
  beforeEach(() => vi.clearAllMocks());

  it("exposes a stable no-inventory domain error", () => {
    expect(new PourNoInventoryError()).toMatchObject({
      name: "PourNoInventoryError",
      message: "No inventory available.",
    });
  });

  it("rejects a malformed inventory result envelope", async () => {
    const supabase = makeRpcSupabase({
      data: {
        operation_id: 42,
        command: "pour",
        pour_event_ids: [],
        replayed: false,
      },
      error: null,
    });

    await expect(recordPour({
      supabase: supabase as never,
      operationId: OPERATION_ID,
      restaurantId: RESTAURANT_ID,
      wineId: WINE_ID,
      ml: 150,
      kind: "pour",
    })).rejects.toMatchObject({ message: "invalid_inventory_command_result" });
    expect(mockRevalidate).not.toHaveBeenCalled();
  });

  it("rejects a bottle selector under the legacy contract before writing", async () => {
    const supabase = makeRpcSupabase({ data: null, error: null });

    await expect(recordPour({
      supabase: supabase as never,
      operationId: OPERATION_ID,
      restaurantId: RESTAURANT_ID,
      wineId: WINE_ID,
      openBottleId: BOTTLE_ID,
      ml: 150,
      kind: "pour",
    })).rejects.toMatchObject({ message: "invalid_inventory_command" });
    expect(supabase.rpc).not.toHaveBeenCalledWith(
      "execute_inventory_command",
      expect.anything(),
    );
  });

  it("rejects a physical adapter result without an open bottle", async () => {
    const executePhysical = vi
      .spyOn(physicalBottleCommand, "executePhysicalBottleCommand")
      .mockResolvedValue({
        openBottle: null,
        pourEventIds: [],
        replayed: false,
      } as never);
    const supabase = makeRpcSupabase({ data: null, error: null }, 2);

    try {
      await expect(recordPour({
        supabase: supabase as never,
        operationId: OPERATION_ID,
        restaurantId: RESTAURANT_ID,
        wineId: WINE_ID,
        openBottleId: BOTTLE_ID,
        ml: 150,
        kind: "pour",
      })).rejects.toMatchObject({ message: "invalid_inventory_command_result" });
      expect(executePhysical).toHaveBeenCalledOnce();
    } finally {
      executePhysical.mockRestore();
    }
  });

  it("maps a non-reversible undo to the manager-safe error", async () => {
    const supabase = makeRpcSupabase({
      data: null,
      error: { message: "undo_inventory_command_not_reversible" },
    });

    await expect(undoLastPour({
      supabase: supabase as never,
      restaurantId: RESTAURANT_ID,
      wineId: WINE_ID,
    })).rejects.toMatchObject({
      name: "PourNotReversibleError",
      message: "Cannot safely undo this pour; ask a manager to reconcile.",
    });
  });

  it.each([
    ["close", closeOpenBottle],
    ["discard", discardOpenBottle],
  ])("rejects missing legacy lifecycle input for %s", async (command, execute) => {
    const supabase = makeLifecycleSupabase({ bottle: activeBottle });
    const common = {
      supabase: supabase as never,
      operationId: OPERATION_ID,
      restaurantId: RESTAURANT_ID,
      bottleId: BOTTLE_ID,
    };

    const promise = command === "close"
      ? closeOpenBottle({ ...common, actualRemainingMl: 125 })
      : execute(common as never);
    await expect(promise).rejects.toMatchObject({
      message: "invalid_inventory_command",
    });
    expect(supabase.from).not.toHaveBeenCalled();
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it.each([
    ["close", closeOpenBottle],
    ["discard", discardOpenBottle],
  ])("rejects an empty physical wine identity for %s", async (command, execute) => {
    const supabase = makeLifecycleSupabase({ bottle: activeBottle });
    const common = {
      supabase: supabase as never,
      operationId: OPERATION_ID,
      restaurantId: RESTAURANT_ID,
      bottleId: BOTTLE_ID,
      contractVersion: 2 as const,
      wineId: "",
    };

    const promise = command === "close"
      ? closeOpenBottle({ ...common, actualRemainingMl: 125 })
      : execute(common as never);
    await expect(promise).rejects.toMatchObject({
      message: "invalid_physical_command",
    });
    expect(supabase.from).not.toHaveBeenCalled();
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it("rejects a contract-2 close replay with a non-string lifecycle", async () => {
    const replay = {
      operation_id: OPERATION_ID,
      command: "close",
      pour_event_ids: ["77777777-7777-4777-8777-777777777777"],
      replayed: true,
      open_bottle: {
        ...activeBottle,
        opened_at: null,
        remaining_ml: 0,
      },
      closeout: {
        id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        restaurant_id: RESTAURANT_ID,
        wine_id: WINE_ID,
        open_bottle_id: BOTTLE_ID,
        opened_at: OPENED_AT,
      },
    };
    const supabase = makeLifecycleSupabase({
      bottle: activeBottle,
      rpcResult: { data: replay, error: null },
    });

    await expect(closeOpenBottle({
      supabase: supabase as never,
      operationId: OPERATION_ID,
      restaurantId: RESTAURANT_ID,
      bottleId: BOTTLE_ID,
      expectedOpenedAt: OPENED_AT,
      contractVersion: 2,
      actualRemainingMl: 125,
    })).rejects.toMatchObject({ message: "invalid_inventory_command_result" });
    expect(mockRevalidate).not.toHaveBeenCalled();
  });

  it("distinguishes a discard fetch failure from a missing bottle", async () => {
    const fetchError = { code: "XX000", message: "database unavailable" };
    const failed = makeLifecycleSupabase({ bottle: null, fetchError });
    await expect(discardOpenBottle({
      supabase: failed as never,
      operationId: OPERATION_ID,
      restaurantId: RESTAURANT_ID,
      bottleId: BOTTLE_ID,
      expectedOpenedAt: OPENED_AT,
    })).rejects.toBe(fetchError);

    const missing = makeLifecycleSupabase({
      bottle: null,
      fetchError: { code: "PGRST116" },
    });
    await expect(discardOpenBottle({
      supabase: missing as never,
      operationId: OPERATION_ID,
      restaurantId: RESTAURANT_ID,
      bottleId: BOTTLE_ID,
      expectedOpenedAt: OPENED_AT,
    })).rejects.toBeInstanceOf(PourNotFoundError);
    expect(failed.rpc).not.toHaveBeenCalled();
    expect(missing.rpc).not.toHaveBeenCalled();
  });
});
