import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database } from "@/types/database";
import type { PhysicalBottleSummary } from "@/lib/wine-list/shapes";
import { InventoryCommandError } from "./inventory-command";

export type InventoryContractVersion = 1 | 2;
type PhysicalCommandName = "open" | "pour" | "spill" | "close" | "discard" | "undo";

const uuid = z.string().uuid();
const preservation = z.enum(["coravin", "argon", "vacuum", "none"]);
const identityOrigin = z.enum(["legacy_slot", "migrated_active", "native"]);
const sourceProvenance = z.enum(["known", "legacy_unknown"]);

const readerRowSchema = z.strictObject({
  id: uuid,
  restaurant_id: uuid,
  wine_id: uuid,
  remaining_ml: z.number().int().nonnegative(),
  nominal_capacity_ml: z.number().int().positive().nullable(),
  opened_at: z.string().datetime({ offset: true }),
  preservation_method: preservation,
  source_inventory_item_id: uuid.nullable(),
  source_provenance: sourceProvenance,
  source_bin_location: z.string().nullable(),
  identity_contract: z.union([z.literal(1), z.literal(2)]),
  identity_origin: identityOrigin,
  state_version: z.number().int().nonnegative(),
}).superRefine((row, context) => {
  if (row.identity_contract === 2 && row.nominal_capacity_ml === null) {
    context.addIssue({ code: "custom", message: "contract-2 capacity is required" });
  }
});

const commandBottleFields = {
  id: uuid,
  restaurant_id: uuid,
  wine_id: uuid,
  remaining_ml: z.number().int().nonnegative(),
  nominal_capacity_ml: z.number().int().positive(),
  opened_at: z.string().datetime({ offset: true }),
  closed_at: z.string().datetime({ offset: true }).nullable(),
  preservation_method: preservation,
  source_inventory_item_id: uuid.nullable(),
  source_provenance: sourceProvenance,
  identity_contract: z.literal(2),
  identity_origin: z.enum(["migrated_active", "native"]),
  state_version: z.number().int().nonnegative(),
};
const commandBottleSchema = z.strictObject(commandBottleFields).superRefine((row, context) => {
  if (
    row.identity_origin === "native" &&
    (row.source_inventory_item_id === null || row.source_provenance !== "known")
  ) {
    context.addIssue({ code: "custom", message: "native source identity is required" });
  }
});

const closeoutSchema = z.strictObject({
  id: uuid,
  restaurant_id: uuid,
  wine_id: uuid,
  open_bottle_id: uuid,
  preservation_method: preservation,
  opened_at: z.string().datetime({ offset: true }),
  closed_at: z.string().datetime({ offset: true }),
  theoretical_remaining_ml: z.number().int().nonnegative(),
  actual_remaining_ml: z.number().int().nonnegative(),
  variance_ml: z.number().int(),
  written_off_ml: z.number().int().nonnegative(),
  reason_code_id: uuid.nullable(),
  event_contract: z.literal(2),
});

const activeCommandResultSchema = z.strictObject({
  operation_id: uuid,
  command: z.enum(["open", "pour", "spill", "undo"]),
  open_bottle: commandBottleSchema,
  pour_event_ids: z.array(uuid).length(1),
  closeout: z.null(),
  replayed: z.boolean(),
});
const closeCommandResultSchema = z.strictObject({
  operation_id: uuid,
  command: z.literal("close"),
  open_bottle: z.strictObject({ ...commandBottleFields,
    remaining_ml: z.literal(0),
    closed_at: z.string().datetime({ offset: true }),
  }),
  pour_event_ids: z.array(uuid).length(1),
  closeout: closeoutSchema,
  replayed: z.boolean(),
});
const discardCommandResultSchema = z.strictObject({
  operation_id: uuid,
  command: z.literal("discard"),
  open_bottle: z.strictObject({ ...commandBottleFields,
    remaining_ml: z.literal(0),
    closed_at: z.string().datetime({ offset: true }),
  }),
  pour_event_ids: z.array(uuid).length(1),
  closeout: z.null(),
  replayed: z.boolean(),
});
const commandResultSchema = z.discriminatedUnion("command", [
  activeCommandResultSchema,
  closeCommandResultSchema,
  discardCommandResultSchema,
]);

export async function getInventoryContractVersion(
  supabase: SupabaseClient<Database>,
): Promise<InventoryContractVersion> {
  const { data, error } = await supabase.rpc("current_inventory_contract_version");
  if (error || (data !== 1 && data !== 2)) {
    throw new InventoryCommandError("inventory_contract_version_unknown");
  }
  return data;
}

export function formatPhysicalBottleId(id: string): string {
  const hex = id.replaceAll("-", "").toLowerCase();
  return /^[0-9a-f]{32}$/.test(hex)
    ? BigInt(`0x${hex}`).toString(36).padStart(25, "0").toUpperCase()
    : id;
}

export async function listActivePhysicalBottles(
  supabase: SupabaseClient<Database>,
  restaurantId: string,
): Promise<PhysicalBottleSummary[]> {
  const { data, error } = await supabase.rpc("list_active_physical_bottles", {
    p_restaurant_id: restaurantId,
  });
  const parsed = z.array(readerRowSchema).safeParse(data);
  if (error || !parsed.success || parsed.data.some((row) => row.restaurant_id !== restaurantId)) {
    throw new InventoryCommandError("invalid_physical_bottle_reader_result");
  }
  return parsed.data.map((row) => ({
    id: row.id,
    wineId: row.wine_id,
    remainingMl: row.remaining_ml,
    nominalCapacityMl: row.nominal_capacity_ml,
    openedAt: row.opened_at,
    preservationMethod: row.preservation_method,
    sourceProvenance: row.source_provenance,
    sourceBinLocation: row.source_bin_location,
    identityContract: row.identity_contract,
    identityOrigin: row.identity_origin,
    stateVersion: row.state_version,
  }));
}

export function summarizePhysicalBottlesByWine(
  bottles: PhysicalBottleSummary[],
) {
  const summaries = new Map<string, {
    bottles: PhysicalBottleSummary[];
    activeOpenMl: number;
  }>();
  for (const bottle of bottles) {
    const summary = summaries.get(bottle.wineId) ?? { bottles: [], activeOpenMl: 0 };
    summary.bottles.push(bottle);
    summary.activeOpenMl += bottle.remainingMl;
    summaries.set(bottle.wineId, summary);
  }
  return summaries;
}

export type ExecutePhysicalBottleCommandInput = {
  supabase: SupabaseClient<Database>;
  operationId: string;
  restaurantId: string;
  command: PhysicalCommandName;
  wineId: string;
  openBottleId?: string;
  expectedOpenBottleId?: string;
  ml?: number;
  note?: string;
  preservationMethod?: string;
  actualRemainingMl?: number;
  writtenOffMl?: number;
  reasonCodeId?: string;
  reversalOfEventId?: string;
  correctionReason?: "mistaken_report";
  operatorConfirmsSameBottlePresent?: boolean;
};

export async function executePhysicalBottleCommand(
  input: ExecutePhysicalBottleCommandInput,
) {
  if (input.command !== "open" && input.command !== "undo" && !input.openBottleId) {
    throw new InventoryCommandError("legacy_inventory_command_retired");
  }
  const isPour = input.command === "pour" || input.command === "spill";
  const isClose = input.command === "close";
  const isDiscard = input.command === "discard";
  const isUndo = input.command === "undo";
  const hasDiscardCorrection = input.correctionReason === "mistaken_report" &&
    input.operatorConfirmsSameBottlePresent === true;
  if ((!isUndo && (input.expectedOpenBottleId !== undefined ||
      input.reversalOfEventId !== undefined || input.correctionReason !== undefined ||
      input.operatorConfirmsSameBottlePresent !== undefined)) ||
    (input.command === "open" && (input.openBottleId !== undefined || input.ml !== undefined)) ||
    (isPour && (input.ml === undefined || input.preservationMethod !== undefined)) ||
    (isClose && (input.ml !== undefined || input.actualRemainingMl === undefined)) ||
    (isDiscard && (input.ml !== undefined || input.actualRemainingMl !== undefined ||
      input.writtenOffMl !== undefined || input.reasonCodeId !== undefined)) ||
    (isUndo && (
      input.openBottleId !== undefined || input.expectedOpenBottleId === undefined ||
      input.reversalOfEventId === undefined || input.ml !== undefined ||
      input.preservationMethod !== undefined || input.actualRemainingMl !== undefined ||
      input.writtenOffMl !== undefined || input.reasonCodeId !== undefined ||
      ((input.correctionReason !== undefined ||
        input.operatorConfirmsSameBottlePresent !== undefined) && !hasDiscardCorrection)
    ))) {
    throw new InventoryCommandError("invalid_physical_command");
  }

  const { data, error } = await input.supabase.rpc("execute_physical_bottle_command", {
    p_operation_id: input.operationId,
    p_restaurant_id: input.restaurantId,
    p_command: input.command,
    p_wine_id: input.wineId,
    p_open_bottle_id: input.openBottleId,
    p_predecessor_open_operation_id: undefined,
    p_ml: input.ml,
    p_note: input.note?.trim() || undefined,
    p_preservation_method: input.preservationMethod,
    p_actual_remaining_ml: input.actualRemainingMl,
    p_written_off_ml: input.writtenOffMl ?? 0,
    p_reason_code_id: input.reasonCodeId,
    p_reversal_of_event_id: input.reversalOfEventId,
    p_correction_reason: input.correctionReason,
    p_operator_confirms_same_bottle_present:
      input.operatorConfirmsSameBottlePresent ?? false,
  });
  if (error) {
    throw new InventoryCommandError(
      String(error.message ?? "physical_inventory_command_failed").trim(),
      error.code,
    );
  }

  const parsed = commandResultSchema.safeParse(data);
  const result = parsed.success ? parsed.data : null;
  if (
    !result ||
    (result.open_bottle.identity_origin === "native" &&
      (result.open_bottle.source_inventory_item_id === null ||
        result.open_bottle.source_provenance !== "known")) ||
    result.operation_id !== input.operationId ||
    result.command !== input.command ||
    result.open_bottle.restaurant_id !== input.restaurantId ||
    result.open_bottle.wine_id !== input.wineId ||
    (input.openBottleId !== undefined && result.open_bottle.id !== input.openBottleId) ||
    (isUndo && (result.open_bottle.id !== input.expectedOpenBottleId ||
      result.pour_event_ids[0] === input.reversalOfEventId))
    || (result.command === "close" && (
      result.closeout.restaurant_id !== input.restaurantId ||
      result.closeout.wine_id !== input.wineId ||
      result.closeout.open_bottle_id !== input.openBottleId ||
      result.closeout.actual_remaining_ml !== input.actualRemainingMl ||
      result.closeout.written_off_ml !== (input.writtenOffMl ?? 0) ||
      result.closeout.reason_code_id !== (input.reasonCodeId ?? null)
    ))
  ) {
    throw new InventoryCommandError("invalid_physical_command_result");
  }
  return {
    operationId: result.operation_id,
    command: result.command,
    pourEventIds: result.pour_event_ids,
    replayed: result.replayed,
    openBottle: result.open_bottle,
    closeout: result.closeout,
  };
}
