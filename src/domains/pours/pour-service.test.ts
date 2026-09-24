import { beforeEach, describe, expect, it, vi } from "vitest";
import { InventoryCommandError } from "./inventory-command";

const mockRevalidate = vi.fn();
vi.mock("next/cache", () => ({ revalidatePath: mockRevalidate }));
const mockCaptureException = vi.fn();
vi.mock("@sentry/nextjs", () => ({ captureException: mockCaptureException }));
const mockRevalidateAutoEightysixedWines = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api/auto-eightysix-revalidation", () => ({
  revalidateAutoEightysixedWines: mockRevalidateAutoEightysixedWines,
}));

const {
  PourForbiddenError,
  PourNotFoundError,
  closeOpenBottle,
  discardOpenBottle,
  openBottle,
  recordPour,
  undoLastPour,
} = await import("./pour-service");

const OPERATION_ID = "11111111-1111-4111-8111-111111111111";
const RESTAURANT_ID = "22222222-2222-4222-8222-222222222222";
const WINE_ID = "55555555-5555-4555-8555-555555555555";
const BOTTLE_ID = "66666666-6666-4666-8666-666666666666";
const OPENED_AT = "2026-09-23T12:00:00.000Z";

function commandResult(command: "open" | "pour" | "spill" | "close" | "discard") {
  return {
    operation_id: OPERATION_ID,
    command,
    pour_event_ids: [],
    replayed: false,
    ...(command === "close"
      ? { closeout: { id: "closeout-1", wine_id: WINE_ID } }
      : {
          open_bottle: {
            id: BOTTLE_ID,
            wine_id: WINE_ID,
            remaining_ml: command === "discard" ? 0 : 600,
            closed_at: command === "discard" ? "2026-09-23T13:00:00.000Z" : null,
          },
        }),
  };
}

function makeRpcSupabase(result: {
  data: unknown;
  error: { code?: string; message?: string } | null;
}, contractVersion: unknown = 1) {
  const rpc = vi.fn((name: string) => {
    if (name === "current_inventory_contract_version") {
      return Promise.resolve({ data: contractVersion, error: null });
    }
    if (name === "wine_published_list_slugs") {
      return Promise.resolve({ data: [], error: null });
    }
    return Promise.resolve(result);
  });
  const from = vi.fn(() => {
    const chain = {
      select: () => chain,
      eq: () => chain,
      is: () => chain,
      gte: () => chain,
      in: () => chain,
      then: (resolve: (value: unknown) => void) =>
        resolve({ data: [], error: null }),
    };
    return chain;
  });
  return { rpc, from };
}

describe("inventory command services", () => {
  beforeEach(() => vi.clearAllMocks());

  it("opens through execute_inventory_command and preserves replay state", async () => {
    const supabase = makeRpcSupabase({ data: commandResult("open"), error: null });

    const outcome = await openBottle({
      supabase: supabase as never,
      operationId: OPERATION_ID,
      restaurantId: RESTAURANT_ID,
      wineId: WINE_ID,
      preservationMethod: "coravin",
    });

    expect(outcome.openBottle).toMatchObject({ id: BOTTLE_ID, wine_id: WINE_ID });
    expect(outcome.replayed).toBe(false);
    expect(supabase.rpc).toHaveBeenCalledWith("execute_inventory_command", {
      p_operation_id: OPERATION_ID,
      p_restaurant_id: RESTAURANT_ID,
      p_command: "open",
      p_wine_id: WINE_ID,
      p_ml: undefined,
      p_note: undefined,
      p_preservation_method: "coravin",
      p_expected_open_bottle_id: undefined,
      p_expected_opened_at: undefined,
      p_actual_remaining_ml: undefined,
      p_written_off_ml: 0,
      p_reason_code_id: undefined,
    });
    expect(mockRevalidate).toHaveBeenCalledWith("/cellar/open");
  });

  it("pours with preservation in the same RPC", async () => {
    const supabase = makeRpcSupabase({ data: commandResult("pour"), error: null });

    const outcome = await recordPour({
      supabase: supabase as never,
      operationId: OPERATION_ID,
      restaurantId: RESTAURANT_ID,
      wineId: WINE_ID,
      ml: 150,
      kind: "pour",
      note: "  glass  ",
      preservationMethod: "argon",
    });

    expect(outcome.openBottle).toMatchObject({ remaining_ml: 600 });
    expect(supabase.rpc).toHaveBeenCalledWith(
      "execute_inventory_command",
      expect.objectContaining({
        p_command: "pour",
        p_ml: 150,
        p_note: "glass",
        p_preservation_method: "argon",
      }),
    );
    expect(mockRevalidate).toHaveBeenCalledWith("/availability");
    expect(mockRevalidateAutoEightysixedWines).toHaveBeenCalledWith({
      supabase,
      restaurantId: RESTAURANT_ID,
      touchedWineIds: [WINE_ID],
      sinceTs: expect.any(String),
    });
  });

  it("surfaces stable RPC messages without rewriting them", async () => {
    const supabase = makeRpcSupabase({
      data: null,
      error: { code: "P0001", message: "no_inventory" },
    });

    await expect(recordPour({
      supabase: supabase as never,
      operationId: OPERATION_ID,
      restaurantId: RESTAURANT_ID,
      wineId: WINE_ID,
      ml: 150,
      kind: "pour",
    })).rejects.toMatchObject({
      message: "no_inventory",
      databaseCode: "P0001",
    } satisfies Partial<InventoryCommandError>);
    expect(mockRevalidate).not.toHaveBeenCalled();
  });

  it("dispatches a contract-2 pour to the selected bottle without legacy preservation", async () => {
    const supabase = makeRpcSupabase({
      data: physicalCommandResult("pour"),
      error: null,
    }, 2);

    await expect(recordPour({
      supabase: supabase as never,
      operationId: OPERATION_ID,
      restaurantId: RESTAURANT_ID,
      wineId: WINE_ID,
      openBottleId: BOTTLE_ID,
      ml: 150,
      kind: "pour",
      note: "glass",
    })).resolves.toMatchObject({
      openBottle: { id: BOTTLE_ID, remaining_ml: 600 },
    });
    expect(supabase.rpc).toHaveBeenCalledWith(
      "execute_physical_bottle_command",
      expect.objectContaining({
        p_command: "pour",
        p_open_bottle_id: BOTTLE_ID,
        p_preservation_method: undefined,
      }),
    );
    expect(supabase.rpc).not.toHaveBeenCalledWith(
      "execute_inventory_command",
      expect.anything(),
    );
  });

  it("keeps Open explicit in contract 2 and returns the exact new bottle", async () => {
    const supabase = makeRpcSupabase({
      data: physicalCommandResult("open"),
      error: null,
    }, 2);
    await expect(openBottle({
      supabase: supabase as never,
      operationId: OPERATION_ID,
      restaurantId: RESTAURANT_ID,
      wineId: WINE_ID,
      preservationMethod: "argon",
    })).resolves.toMatchObject({ openBottle: { id: BOTTLE_ID } });
    expect(supabase.rpc).toHaveBeenCalledWith(
      "execute_physical_bottle_command",
      expect.objectContaining({
        p_command: "open",
        p_open_bottle_id: undefined,
        p_preservation_method: "argon",
      }),
    );
  });

  it("fails closed instead of treating an unknown contract as version 1", async () => {
    const supabase = makeRpcSupabase({ data: commandResult("pour"), error: null }, null);
    await expect(recordPour({
      supabase: supabase as never,
      operationId: OPERATION_ID,
      restaurantId: RESTAURANT_ID,
      wineId: WINE_ID,
      openBottleId: BOTTLE_ID,
      ml: 150,
      kind: "pour",
    })).rejects.toMatchObject({ message: "inventory_contract_version_unknown" });
    expect(supabase.rpc).not.toHaveBeenCalledWith(
      "execute_inventory_command",
      expect.anything(),
    );
  });
});

function physicalCommandResult(command: "open" | "pour") {
  return {
    operation_id: OPERATION_ID,
    command,
    pour_event_ids: ["77777777-7777-4777-8777-777777777777"],
    replayed: false,
    closeout: null,
    open_bottle: {
      id: BOTTLE_ID,
      restaurant_id: RESTAURANT_ID,
      wine_id: WINE_ID,
      remaining_ml: command === "open" ? 750 : 600,
      nominal_capacity_ml: 750,
      opened_at: "2026-09-23T12:00:00.000Z",
      closed_at: null,
      preservation_method: "argon",
      source_inventory_item_id: "88888888-8888-4888-8888-888888888888",
      source_provenance: "known",
      identity_contract: 2,
      identity_origin: "native",
      state_version: command === "open" ? 0 : 1,
    },
  };
}

describe("undoLastPour", () => {
  beforeEach(() => vi.clearAllMocks());

  it("does not export a raw database error or wine identity", async () => {
    const databaseError = { code: "XX000", message: "private customer note" };
    const supabase = makeRpcSupabase({ data: null, error: databaseError });
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await expect(undoLastPour({
        supabase: supabase as never,
        restaurantId: RESTAURANT_ID,
        wineId: WINE_ID,
      })).rejects.toMatchObject({ name: "PourRpcError", message: "Undo failed." });
      expect(mockCaptureException).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ message: "Undo RPC failed" }),
        { tags: { surface: "pour", phase: "undo_last_pour-rpc" } },
      );
      expect(consoleSpy).not.toHaveBeenCalled();
    } finally {
      consoleSpy.mockRestore();
    }
  });

  it("keeps the intended RPC error when monitoring throws", async () => {
    const databaseError = { code: "XX000", message: "private database detail" };
    const supabase = makeRpcSupabase({ data: null, error: databaseError });
    mockCaptureException.mockImplementationOnce(() => {
      throw new Error("monitor unavailable");
    });
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await expect(undoLastPour({
        supabase: supabase as never,
        restaurantId: RESTAURANT_ID,
        wineId: WINE_ID,
      })).rejects.toMatchObject({
        name: "PourRpcError", message: "Undo failed.", cause: databaseError,
      });
    } finally {
      consoleSpy.mockRestore();
    }
  });

  it("keeps the bounded reversal path unchanged", async () => {
    const supabase = makeRpcSupabase({ data: { wine_id: WINE_ID }, error: null });
    await expect(undoLastPour({
      supabase: supabase as never,
      restaurantId: RESTAURANT_ID,
      wineId: WINE_ID,
    })).resolves.toEqual({ wine_id: WINE_ID });
    expect(supabase.rpc).toHaveBeenCalledWith("undo_last_pour", {
      p_wine_id: WINE_ID,
    });
  });

  it("keeps reversal not-found and permission mappings", async () => {
    const missing = makeRpcSupabase({
      data: null,
      error: { message: "no recent pour to undo" },
    });
    await expect(undoLastPour({
      supabase: missing as never,
      restaurantId: RESTAURANT_ID,
      wineId: WINE_ID,
    })).rejects.toBeInstanceOf(PourNotFoundError);

    const forbidden = makeRpcSupabase({
      data: null,
      error: { code: "42501", message: "forbidden" },
    });
    await expect(undoLastPour({
      supabase: forbidden as never,
      restaurantId: RESTAURANT_ID,
      wineId: WINE_ID,
    })).rejects.toBeInstanceOf(PourForbiddenError);
  });
});

function makeCloseSupabase(options: {
  bottle: {
    id: string;
    wine_id: string;
    opened_at: string;
    closed_at: string | null;
    restaurant_id: string;
  } | null;
  fetchError?: { code?: string } | null;
  rpcError?: { code?: string; message?: string } | null;
}) {
  const rpc = vi.fn(() => Promise.resolve({
    data: options.rpcError ? null : commandResult("close"),
    error: options.rpcError ?? null,
  }));
  const eq = vi.fn();
  const from = vi.fn(() => ({
    select: () => {
      const chain = {
        eq: (column: string, value: string) => {
          eq(column, value);
          return chain;
        },
        single: async () => ({
          data: options.bottle,
          error: options.fetchError ?? null,
        }),
      };
      return chain;
    },
  }));
  return { rpc, from, eq };
}

const activeBottle = {
  id: BOTTLE_ID,
  wine_id: WINE_ID,
  opened_at: OPENED_AT,
  closed_at: null,
  restaurant_id: RESTAURANT_ID,
};

describe("closeOpenBottle", () => {
  beforeEach(() => vi.clearAllMocks());

  it("forwards the exact lifecycle pair and closeout fields", async () => {
    const supabase = makeCloseSupabase({ bottle: activeBottle });

    const outcome = await closeOpenBottle({
      supabase: supabase as never,
      operationId: OPERATION_ID,
      restaurantId: RESTAURANT_ID,
      bottleId: BOTTLE_ID,
      expectedOpenedAt: OPENED_AT,
      actualRemainingMl: 125,
      writtenOffMl: 25,
      reasonCodeId: "77777777-7777-4777-8777-777777777777",
    });

    expect(outcome.closeout).toMatchObject({ id: "closeout-1" });
    expect(supabase.rpc).toHaveBeenCalledWith(
      "execute_inventory_command",
      expect.objectContaining({
        p_command: "close",
        p_expected_open_bottle_id: BOTTLE_ID,
        p_expected_opened_at: OPENED_AT,
        p_actual_remaining_ml: 125,
        p_written_off_ml: 25,
      }),
    );
    expect(mockRevalidate).toHaveBeenCalledWith("/cellar/open");
    expect(mockRevalidate).toHaveBeenCalledWith("/cellar");
    expect(mockRevalidate).toHaveBeenCalledWith("/insights");
    expect(supabase.eq).toHaveBeenCalledWith("id", BOTTLE_ID);
    expect(supabase.eq).toHaveBeenCalledWith("restaurant_id", RESTAURANT_ID);
  });

  it("fails closed for missing or cross-tenant rows", async () => {
    const missing = makeCloseSupabase({
      bottle: null,
      fetchError: { code: "PGRST116" },
    });
    await expect(closeOpenBottle(closeInput(missing))).rejects.toBeInstanceOf(
      PourNotFoundError,
    );

    const crossTenant = makeCloseSupabase({
      bottle: { ...activeBottle, restaurant_id: "other-restaurant" },
    });
    await expect(closeOpenBottle(closeInput(crossTenant))).rejects.toBeInstanceOf(
      PourForbiddenError,
    );
    expect(crossTenant.rpc).not.toHaveBeenCalled();

  });

  it("lets the atomic command replay a stored receipt after the bottle closed", async () => {
    const closed = makeCloseSupabase({
      bottle: { ...activeBottle, closed_at: "2026-09-23T13:00:00.000Z" },
    });
    closed.rpc.mockResolvedValueOnce({
      data: { ...commandResult("close"), replayed: true },
      error: null,
    });

    await expect(closeOpenBottle(closeInput(closed))).resolves.toMatchObject({
      replayed: true,
      closeout: { id: "closeout-1" },
    });
    expect(closed.rpc).toHaveBeenCalledWith(
      "execute_inventory_command",
      expect.objectContaining({
        p_operation_id: OPERATION_ID,
        p_expected_open_bottle_id: BOTTLE_ID,
        p_expected_opened_at: OPENED_AT,
      }),
    );
  });

  it("propagates a real bottle fetch error instead of treating it as missing", async () => {
    const fetchError = { code: "XX000", message: "database unavailable" };
    const supabase = makeCloseSupabase({
      bottle: null,
      fetchError,
    });

    await expect(closeOpenBottle(closeInput(supabase))).rejects.toBe(fetchError);
    expect(supabase.rpc).not.toHaveBeenCalled();
  });
});

describe("discardOpenBottle", () => {
  beforeEach(() => vi.clearAllMocks());

  it("uses the locked lifecycle discard command without measurement fields", async () => {
    const supabase = makeCloseSupabase({ bottle: activeBottle });
    supabase.rpc.mockResolvedValueOnce({
      data: commandResult("discard"),
      error: null,
    });

    const outcome = await discardOpenBottle({
      supabase: supabase as never,
      operationId: OPERATION_ID,
      restaurantId: RESTAURANT_ID,
      bottleId: BOTTLE_ID,
      expectedOpenedAt: OPENED_AT,
    });

    expect(outcome.closed).toMatchObject({
      id: BOTTLE_ID,
      wine_id: WINE_ID,
      remaining_ml: 0,
    });
    expect(supabase.rpc).toHaveBeenCalledWith(
      "execute_inventory_command",
      expect.objectContaining({
        p_command: "discard",
        p_expected_open_bottle_id: BOTTLE_ID,
        p_expected_opened_at: OPENED_AT,
        p_actual_remaining_ml: undefined,
        p_written_off_ml: 0,
        p_reason_code_id: undefined,
      }),
    );
    expect(supabase.eq).toHaveBeenCalledWith("restaurant_id", RESTAURANT_ID);
  });
});

function closeInput(supabase: ReturnType<typeof makeCloseSupabase>) {
  return {
    supabase: supabase as never,
    operationId: OPERATION_ID,
    restaurantId: RESTAURANT_ID,
    bottleId: BOTTLE_ID,
    expectedOpenedAt: OPENED_AT,
    actualRemainingMl: 0,
  };
}
