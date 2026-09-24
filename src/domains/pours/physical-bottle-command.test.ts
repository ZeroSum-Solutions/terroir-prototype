import { describe, expect, it, vi } from "vitest";
import {
  executePhysicalBottleCommand,
  getInventoryContractVersion,
  listActivePhysicalBottles,
  summarizePhysicalBottlesByWine,
} from "./physical-bottle-command";

const OPERATION_ID = "11111111-1111-4111-8111-111111111111";
const RESTAURANT_ID = "22222222-2222-4222-8222-222222222222";
const WINE_ID = "55555555-5555-4555-8555-555555555555";
const BOTTLE_ID = "66666666-6666-4666-8666-666666666666";
const REVERSAL_EVENT_ID = "77777777-7777-4777-8777-777777777777";

describe("physical bottle database adapters", () => {
  it("derives count and total from one exact array without collapsing siblings", () => {
    const summary = summarizePhysicalBottlesByWine([
      summaryBottle(BOTTLE_ID, 600),
      summaryBottle("99999999-9999-4999-8999-999999999999", 300),
    ]).get(WINE_ID)!;
    expect(summary.bottles.map((bottle) => bottle.id)).toEqual([
      BOTTLE_ID,
      "99999999-9999-4999-8999-999999999999",
    ]);
    expect(summary.activeOpenMl).toBe(900);
  });

  it.each([1, 2] as const)("accepts inventory contract version %i", async (version) => {
    const rpc = vi.fn().mockResolvedValue({ data: version, error: null });
    await expect(getInventoryContractVersion({ rpc } as never)).resolves.toBe(version);
  });

  it.each([null, 0, 3, "1"])("fails closed for unknown contract version %o", async (data) => {
    const rpc = vi.fn().mockResolvedValue({ data, error: null });
    await expect(getInventoryContractVersion({ rpc } as never)).rejects.toMatchObject({
      message: "inventory_contract_version_unknown",
    });
  });

  it("accepts nullable legacy capture fields and omits private source identity", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [{
        id: BOTTLE_ID,
        restaurant_id: RESTAURANT_ID,
        wine_id: WINE_ID,
        remaining_ml: 375,
        nominal_capacity_ml: null,
        opened_at: "2026-09-23T12:00:00.000Z",
        preservation_method: "coravin",
        source_inventory_item_id: null,
        source_provenance: "legacy_unknown",
        source_bin_location: null,
        identity_contract: 1,
        identity_origin: "legacy_slot",
        state_version: 0,
      }],
      error: null,
    });

    await expect(listActivePhysicalBottles({ rpc } as never, RESTAURANT_ID))
      .resolves.toEqual([{
        id: BOTTLE_ID,
        wineId: WINE_ID,
        remainingMl: 375,
        nominalCapacityMl: null,
        openedAt: "2026-09-23T12:00:00.000Z",
        preservationMethod: "coravin",
        sourceProvenance: "legacy_unknown",
        sourceBinLocation: null,
        identityContract: 1,
        identityOrigin: "legacy_slot",
        stateVersion: 0,
      }]);
  });

  it.each([
    [{ opened_by: "private-user" }],
    [{ unit_cost: 125 }],
  ])("rejects an unapproved exact-reader field", async (extra) => {
    const rpc = vi.fn().mockResolvedValue({
      data: [{ ...physicalReaderRow(), ...extra }],
      error: null,
    });
    await expect(listActivePhysicalBottles({ rpc } as never, RESTAURANT_ID))
      .rejects.toMatchObject({ message: "invalid_physical_bottle_reader_result" });
  });

  it("requires captured capacity for a contract-2 bottle", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [{ ...physicalReaderRow(), nominal_capacity_ml: null }],
      error: null,
    });
    await expect(listActivePhysicalBottles({ rpc } as never, RESTAURANT_ID))
      .rejects.toMatchObject({ message: "invalid_physical_bottle_reader_result" });
  });

  it("sends an exact physical pour and strictly parses its result", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: physicalCommandResult(),
      error: null,
    });
    const result = await executePhysicalBottleCommand({
      supabase: { rpc } as never,
      operationId: OPERATION_ID,
      restaurantId: RESTAURANT_ID,
      command: "pour",
      wineId: WINE_ID,
      openBottleId: BOTTLE_ID,
      ml: 150,
      note: "  glass  ",
    });

    expect(rpc).toHaveBeenCalledWith("execute_physical_bottle_command", {
      p_operation_id: OPERATION_ID,
      p_restaurant_id: RESTAURANT_ID,
      p_command: "pour",
      p_wine_id: WINE_ID,
      p_open_bottle_id: BOTTLE_ID,
      p_predecessor_open_operation_id: undefined,
      p_ml: 150,
      p_note: "glass",
      p_preservation_method: undefined,
      p_actual_remaining_ml: undefined,
      p_written_off_ml: 0,
      p_reason_code_id: undefined,
      p_reversal_of_event_id: undefined,
      p_correction_reason: undefined,
      p_operator_confirms_same_bottle_present: false,
    });
    expect(result.openBottle).toMatchObject({ id: BOTTLE_ID, remaining_ml: 600 });
  });

  it("rejects an unclassified physical command result", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: { ...physicalCommandResult(), unexpected: true },
      error: null,
    });
    await expect(executePhysicalBottleCommand({
      supabase: { rpc } as never,
      operationId: OPERATION_ID,
      restaurantId: RESTAURANT_ID,
      command: "pour",
      wineId: WINE_ID,
      openBottleId: BOTTLE_ID,
      ml: 150,
    })).rejects.toMatchObject({ message: "invalid_physical_command_result" });
  });

  it("rejects a valid-shaped response for a different bottle", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: {
        ...physicalCommandResult(),
        open_bottle: {
          ...physicalCommandResult().open_bottle,
          id: "99999999-9999-4999-8999-999999999999",
        },
      },
      error: null,
    });
    await expect(executePhysicalBottleCommand({
      supabase: { rpc } as never,
      operationId: OPERATION_ID,
      restaurantId: RESTAURANT_ID,
      command: "pour",
      wineId: WINE_ID,
      openBottleId: BOTTLE_ID,
      ml: 150,
    })).rejects.toMatchObject({ message: "invalid_physical_command_result" });
  });

  it("accepts a migrated contract-2 bottle without invented source provenance", async () => {
    const result = physicalCommandResult();
    const rpc = vi.fn().mockResolvedValue({
      data: {
        ...result,
        open_bottle: {
          ...result.open_bottle,
          identity_origin: "migrated_active",
          source_inventory_item_id: null,
          source_provenance: "legacy_unknown",
        },
      },
      error: null,
    });
    await expect(executePhysicalBottleCommand({
      supabase: { rpc } as never,
      operationId: OPERATION_ID,
      restaurantId: RESTAURANT_ID,
      command: "pour",
      wineId: WINE_ID,
      openBottleId: BOTTLE_ID,
      ml: 150,
    })).resolves.toMatchObject({ openBottle: { source_provenance: "legacy_unknown" } });
  });

  it("sends measured close fields and requires an exact non-null closeout", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: physicalCommandResult("close"), error: null });
    await expect(executePhysicalBottleCommand({
      supabase: { rpc } as never, operationId: OPERATION_ID,
      restaurantId: RESTAURANT_ID, command: "close", wineId: WINE_ID,
      openBottleId: BOTTLE_ID, actualRemainingMl: 125, writtenOffMl: 25,
      reasonCodeId: "99999999-9999-4999-8999-999999999999",
    })).resolves.toMatchObject({ closeout: { open_bottle_id: BOTTLE_ID } });
    expect(rpc).toHaveBeenCalledWith("execute_physical_bottle_command",
      expect.objectContaining({ p_command: "close", p_actual_remaining_ml: 125,
        p_written_off_ml: 25 }));

    rpc.mockResolvedValueOnce({ data: { ...physicalCommandResult("close"), closeout: null }, error: null });
    await expect(executePhysicalBottleCommand({
      supabase: { rpc } as never, operationId: OPERATION_ID,
      restaurantId: RESTAURANT_ID, command: "close", wineId: WINE_ID,
      openBottleId: BOTTLE_ID, actualRemainingMl: 125,
    })).rejects.toMatchObject({ message: "invalid_physical_command_result" });
  });

  it("requires discard to return the exact closed bottle and no closeout", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: physicalCommandResult("discard"), error: null });
    await expect(executePhysicalBottleCommand({
      supabase: { rpc } as never, operationId: OPERATION_ID,
      restaurantId: RESTAURANT_ID, command: "discard", wineId: WINE_ID,
      openBottleId: BOTTLE_ID,
    })).resolves.toMatchObject({ command: "discard", closeout: null });
  });

  it("binds undo to the receipt event without sending a bottle selector", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: { ...physicalCommandResult(), command: "undo" },
      error: null,
    });
    await expect(executePhysicalBottleCommand({
      supabase: { rpc } as never,
      operationId: OPERATION_ID,
      restaurantId: RESTAURANT_ID,
      command: "undo",
      wineId: WINE_ID,
      expectedOpenBottleId: BOTTLE_ID,
      reversalOfEventId: REVERSAL_EVENT_ID,
    })).resolves.toMatchObject({
      command: "undo",
      openBottle: { id: BOTTLE_ID },
      pourEventIds: ["88888888-8888-4888-8888-888888888888"],
    });
    expect(rpc).toHaveBeenCalledWith("execute_physical_bottle_command",
      expect.objectContaining({
        p_command: "undo",
        p_wine_id: WINE_ID,
        p_open_bottle_id: undefined,
        p_reversal_of_event_id: REVERSAL_EVENT_ID,
      }));
  });

  it.each([
    ["operation", { operation_id: "99999999-9999-4999-8999-999999999999" }],
    ["command", { command: "pour" }],
    ["restaurant", { open_bottle: {
      ...physicalCommandResult().open_bottle,
      restaurant_id: "99999999-9999-4999-8999-999999999999",
    } }],
    ["wine", { open_bottle: {
      ...physicalCommandResult().open_bottle,
      wine_id: "99999999-9999-4999-8999-999999999999",
    } }],
    ["bottle", { open_bottle: {
      ...physicalCommandResult().open_bottle,
      id: "99999999-9999-4999-8999-999999999999",
    } }],
    ["new Undo event", { pour_event_ids: [] }],
  ])("rejects an Undo result with mismatched %s", async (_field, override) => {
    const rpc = vi.fn().mockResolvedValue({
      data: { ...physicalCommandResult(), command: "undo", ...override },
      error: null,
    });
    await expect(executePhysicalBottleCommand({
      supabase: { rpc } as never,
      operationId: OPERATION_ID,
      restaurantId: RESTAURANT_ID,
      command: "undo",
      wineId: WINE_ID,
      expectedOpenBottleId: BOTTLE_ID,
      reversalOfEventId: REVERSAL_EVENT_ID,
    })).rejects.toMatchObject({ message: "invalid_physical_command_result" });
  });

  it("rejects an Undo result that reuses the original reversal event", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: {
        ...physicalCommandResult(),
        command: "undo",
        pour_event_ids: [REVERSAL_EVENT_ID],
      },
      error: null,
    });
    await expect(executePhysicalBottleCommand({
      supabase: { rpc } as never, operationId: OPERATION_ID,
      restaurantId: RESTAURANT_ID, command: "undo", wineId: WINE_ID,
      expectedOpenBottleId: BOTTLE_ID,
      reversalOfEventId: REVERSAL_EVENT_ID,
    })).rejects.toMatchObject({ message: "invalid_physical_command_result" });
  });
});

function physicalReaderRow() {
  return {
    id: BOTTLE_ID,
    restaurant_id: RESTAURANT_ID,
    wine_id: WINE_ID,
    remaining_ml: 600,
    nominal_capacity_ml: 750,
    opened_at: "2026-09-23T12:00:00.000Z",
    preservation_method: "argon",
    source_inventory_item_id: "77777777-7777-4777-8777-777777777777",
    source_provenance: "known",
    source_bin_location: "A-1",
    identity_contract: 2,
    identity_origin: "native",
    state_version: 1,
  };
}

function physicalCommandResult(command: "pour" | "close" | "discard" = "pour") {
  const closed = command !== "pour";
  return {
    operation_id: OPERATION_ID,
    command,
    open_bottle: {
      id: BOTTLE_ID,
      restaurant_id: RESTAURANT_ID,
      wine_id: WINE_ID,
      remaining_ml: closed ? 0 : 600,
      nominal_capacity_ml: 750,
      opened_at: "2026-09-23T12:00:00.000Z",
      closed_at: closed ? "2026-09-23T13:00:00.000Z" : null,
      preservation_method: "argon",
      source_inventory_item_id: "77777777-7777-4777-8777-777777777777",
      source_provenance: "known",
      identity_contract: 2,
      identity_origin: "native",
      state_version: 1,
    },
    pour_event_ids: ["88888888-8888-4888-8888-888888888888"],
    closeout: command === "close" ? {
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      restaurant_id: RESTAURANT_ID,
      wine_id: WINE_ID,
      open_bottle_id: BOTTLE_ID,
      preservation_method: "argon",
      opened_at: "2026-09-23T12:00:00.000Z",
      closed_at: "2026-09-23T13:00:00.000Z",
      theoretical_remaining_ml: 600,
      actual_remaining_ml: 125,
      variance_ml: -475,
      written_off_ml: 25,
      reason_code_id: "99999999-9999-4999-8999-999999999999",
      event_contract: 2,
    } : null,
    replayed: false,
  };
}

function summaryBottle(id: string, remainingMl: number) {
  return {
    id,
    wineId: WINE_ID,
    remainingMl,
    nominalCapacityMl: 750,
    openedAt: "2026-09-23T12:00:00.000Z",
    preservationMethod: "argon" as const,
    sourceProvenance: "known" as const,
    sourceBinLocation: null,
    identityContract: 2 as const,
    identityOrigin: "native" as const,
    stateVersion: 0,
  };
}
