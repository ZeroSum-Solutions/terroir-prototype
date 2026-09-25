import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/types/database";

export type InventoryCommandName = "open" | "pour" | "spill" | "close" | "discard";

export type InventoryCommandInput = {
  supabase: SupabaseClient<Database>;
  operationId: string;
  restaurantId: string;
  command: InventoryCommandName;
  wineId: string;
  ml?: number | null;
  note?: string | null;
  preservationMethod?: string | null;
  expectedOpenBottleId?: string | null;
  expectedOpenedAt?: string | null;
  actualRemainingMl?: number | null;
  writtenOffMl?: number;
  reasonCodeId?: string | null;
};

export type InventoryCommandResult = {
  operationId: string;
  command: InventoryCommandName;
  pourEventIds: string[];
  replayed: boolean;
  openBottle: Record<string, Json> | null;
  closeout: Record<string, Json> | null;
};

export type CompletedInventoryReplayExpectation = {
  operationId: string;
  restaurantId: string;
  command: InventoryCommandName;
  wineId?: string;
  expectedOpenBottleId?: string;
  expectedOpenedAt?: string;
};

export class InventoryCommandError extends Error {
  readonly databaseCode?: string;

  constructor(message: string, databaseCode?: string) {
    super(message);
    this.name = "InventoryCommandError";
    this.databaseCode = databaseCode;
  }
}

export function isLegacyInventoryCommandRetired(
  error: unknown,
): error is InventoryCommandError {
  return error instanceof InventoryCommandError &&
    error.databaseCode === "P0001" &&
    error.message.trim() === "legacy_inventory_command_retired";
}

export function validateCompletedInventoryReplay(
  result: InventoryCommandResult,
  expected: CompletedInventoryReplayExpectation,
): InventoryCommandResult {
  const bottle = result.openBottle;
  if (
    result.replayed !== true ||
    result.operationId !== expected.operationId ||
    result.command !== expected.command ||
    bottle === null ||
    bottle.restaurant_id !== expected.restaurantId ||
    (expected.wineId !== undefined && bottle.wine_id !== expected.wineId) ||
    (expected.expectedOpenBottleId !== undefined &&
      bottle.id !== expected.expectedOpenBottleId) ||
    (expected.expectedOpenedAt !== undefined &&
      !isSameInstant(bottle.opened_at, expected.expectedOpenedAt))
  ) {
    throw new InventoryCommandError("invalid_inventory_command_result");
  }

  const closeout = result.closeout;
  if (closeout !== null && (
    closeout.restaurant_id !== expected.restaurantId ||
    (expected.expectedOpenBottleId !== undefined &&
      closeout.open_bottle_id !== expected.expectedOpenBottleId) ||
    (expected.expectedOpenedAt !== undefined &&
      !isSameInstant(closeout.opened_at, expected.expectedOpenedAt))
  )) {
    throw new InventoryCommandError("invalid_inventory_command_result");
  }

  return result;
}

export async function executeCompletedInventoryReplay(
  input: InventoryCommandInput,
  binding: Pick<
    CompletedInventoryReplayExpectation,
    "wineId" | "expectedOpenBottleId" | "expectedOpenedAt"
  >,
): Promise<InventoryCommandResult> {
  const result = await executeInventoryCommand(input);
  return validateCompletedInventoryReplay(result, {
    operationId: input.operationId,
    restaurantId: input.restaurantId,
    command: input.command,
    ...binding,
  });
}

export async function executeInventoryCommand(
  input: InventoryCommandInput,
): Promise<InventoryCommandResult> {
  const { data, error } = await input.supabase.rpc("execute_inventory_command", {
    p_operation_id: input.operationId,
    p_restaurant_id: input.restaurantId,
    p_command: input.command,
    p_wine_id: input.wineId,
    p_ml: input.ml ?? undefined,
    p_note: input.note?.trim() || undefined,
    p_preservation_method: input.preservationMethod ?? undefined,
    p_expected_open_bottle_id: input.expectedOpenBottleId ?? undefined,
    p_expected_opened_at: input.expectedOpenedAt ?? undefined,
    p_actual_remaining_ml: input.actualRemainingMl ?? undefined,
    p_written_off_ml: input.writtenOffMl ?? 0,
    p_reason_code_id: input.reasonCodeId ?? undefined,
  });

  if (error) {
    throw new InventoryCommandError(
      String(error.message ?? "inventory_command_failed").trim(),
      error.code,
    );
  }

  return parseResult(data);
}

function parseResult(data: Json | null): InventoryCommandResult {
  if (!isRecord(data)) {
    throw new InventoryCommandError("invalid_inventory_command_result");
  }

  const operationId = data.operation_id;
  const command = data.command;
  const pourEventIds = data.pour_event_ids;
  const replayed = data.replayed;
  if (
    typeof operationId !== "string" ||
    !isCommand(command) ||
    !Array.isArray(pourEventIds) ||
    !pourEventIds.every((id) => typeof id === "string") ||
    typeof replayed !== "boolean"
  ) {
    throw new InventoryCommandError("invalid_inventory_command_result");
  }

  return {
    operationId,
    command,
    pourEventIds,
    replayed,
    openBottle: optionalRecord(data.open_bottle),
    closeout: optionalRecord(data.closeout),
  };
}

function optionalRecord(value: Json | undefined): Record<string, Json> | null {
  if (value === undefined || value === null) return null;
  if (!isRecord(value)) {
    throw new InventoryCommandError("invalid_inventory_command_result");
  }
  return value;
}

function isRecord(value: Json | null | undefined): value is Record<string, Json> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isCommand(value: Json | undefined): value is InventoryCommandName {
  return value === "open" || value === "pour" || value === "spill" ||
    value === "close" || value === "discard";
}

function isSameInstant(value: Json | undefined, expected: string): boolean {
  if (typeof value !== "string") return false;
  const actualMs = Date.parse(value);
  const expectedMs = Date.parse(expected);
  return Number.isFinite(actualMs) && actualMs === expectedMs;
}
