import * as Sentry from "@sentry/nextjs";
import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { revalidateAutoEightysixedWines } from "@/lib/api/auto-eightysix-revalidation";
import type { Database } from "@/types/database";
import {
  executeInventoryCommand,
  InventoryCommandError,
} from "./inventory-command";
import {
  executePhysicalBottleCommand,
  getInventoryContractVersion,
} from "./physical-bottle-command";

export class PourNoInventoryError extends Error {
  constructor() {
    super("No inventory available.");
    this.name = "PourNoInventoryError";
  }
}

export class PourForbiddenError extends Error {
  constructor() {
    super("Forbidden.");
    this.name = "PourForbiddenError";
  }
}

export class PourNotFoundError extends Error {
  constructor(message = "Resource not found.") {
    super(message);
    this.name = "PourNotFoundError";
  }
}

export class PourNotReversibleError extends Error {
  constructor() {
    super("Cannot safely undo this pour; ask a manager to reconcile.");
    this.name = "PourNotReversibleError";
  }
}

export class PourRpcError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message);
    this.name = "PourRpcError";
    this.cause = options?.cause;
  }
}

export type RecordPourInput = {
  supabase: SupabaseClient<Database>;
  operationId: string;
  restaurantId: string;
  wineId: string;
  openBottleId?: string;
  ml: number;
  kind: "pour" | "spill";
  note?: string;
  preservationMethod?: string;
};

export async function recordPour(input: RecordPourInput) {
  const {
    supabase,
    operationId,
    restaurantId,
    wineId,
    openBottleId,
    ml,
    kind,
    note,
    preservationMethod,
  } = input;
  const sinceTs = new Date().toISOString();
  const contractVersion = await getInventoryContractVersion(supabase);
  const result = contractVersion === 2
    ? await executePhysicalBottleCommand({
        supabase,
        operationId,
        restaurantId,
        command: kind,
        wineId,
        openBottleId,
        ml,
        note,
        preservationMethod,
      })
    : await executeLegacyPour();
  if (!result.openBottle) {
    throw new InventoryCommandError("invalid_inventory_command_result");
  }

  revalidatePath("/availability");

  await revalidateAutoEightysixedWines({
    supabase,
    restaurantId,
    touchedWineIds: [wineId],
    sinceTs,
  });

  return { openBottle: result.openBottle, replayed: result.replayed };

  async function executeLegacyPour() {
    if (openBottleId !== undefined) {
      throw new InventoryCommandError("invalid_inventory_command");
    }
    return executeInventoryCommand({
      supabase,
      operationId,
      restaurantId,
      command: kind,
      wineId,
      ml,
      note,
      preservationMethod,
    });
  }
}

export async function openBottle(input: {
  supabase: SupabaseClient<Database>;
  operationId: string;
  restaurantId: string;
  wineId: string;
  preservationMethod: string;
}) {
  const contractVersion = await getInventoryContractVersion(input.supabase);
  const result = contractVersion === 2
    ? await executePhysicalBottleCommand({
        supabase: input.supabase,
        operationId: input.operationId,
        restaurantId: input.restaurantId,
        command: "open",
        wineId: input.wineId,
        preservationMethod: input.preservationMethod,
      })
    : await executeInventoryCommand({
        supabase: input.supabase,
        operationId: input.operationId,
        restaurantId: input.restaurantId,
        command: "open",
        wineId: input.wineId,
        preservationMethod: input.preservationMethod,
      });
  if (!result.openBottle) {
    throw new InventoryCommandError("invalid_inventory_command_result");
  }

  revalidatePath("/cellar/open");
  return { openBottle: result.openBottle, replayed: result.replayed };
}

export type UndoLastPourInput = {
  supabase: SupabaseClient<Database>;
  restaurantId: string;
  wineId: string;
};

export async function undoLastPour(input: UndoLastPourInput) {
  const { supabase, restaurantId, wineId } = input;
  const sinceTs = new Date().toISOString();

  const { data, error } = await supabase.rpc("undo_last_pour", {
    p_wine_id: wineId,
  });

  if (error) {
    if (error.message?.includes("no recent pour to undo")) {
      throw new PourNotFoundError("Pour to undo not found.");
    }
    if (error.code === "42501") {
      throw new PourForbiddenError();
    }
    if (error.message?.includes("undo_inventory_command_not_reversible")) {
      throw new PourNotReversibleError();
    }
    try {
      Sentry.captureException(new Error("Undo RPC failed"), {
        tags: { surface: "pour", phase: "undo_last_pour-rpc" },
      });
    } catch {
      // Monitoring must not replace the intended domain error.
    }
    throw new PourRpcError("Undo failed.", { cause: error });
  }

  revalidatePath("/availability");

  await revalidateAutoEightysixedWines({
    supabase,
    restaurantId,
    touchedWineIds: [wineId],
    sinceTs,
  });

  return data;
}

export type CloseOpenBottleInput = {
  supabase: SupabaseClient<Database>;
  operationId: string;
  restaurantId: string;
  bottleId: string;
  wineId?: string;
  contractVersion?: 1 | 2;
  expectedOpenedAt?: string;
  actualRemainingMl: number;
  writtenOffMl?: number;
  reasonCodeId?: string;
};

export async function closeOpenBottle(input: CloseOpenBottleInput) {
  const {
    supabase,
    operationId,
    restaurantId,
    bottleId,
    expectedOpenedAt,
    wineId,
    contractVersion = 1,
    actualRemainingMl,
    writtenOffMl,
    reasonCodeId,
  } = input;

  if (contractVersion === 2) {
    if (!wineId) throw new InventoryCommandError("invalid_physical_command");
    const result = await executePhysicalBottleCommand({
      supabase, operationId, restaurantId, command: "close", wineId,
      openBottleId: bottleId, actualRemainingMl, writtenOffMl, reasonCodeId,
    });
    revalidateClosePaths();
    return { closeout: result.closeout!, replayed: result.replayed };
  }
  if (!expectedOpenedAt) throw new InventoryCommandError("invalid_inventory_command");
  const { data: bottle, error: fetchError } = await supabase
    .from("open_bottles")
    .select("id, wine_id, restaurant_id")
    .eq("id", bottleId)
    .eq("restaurant_id", restaurantId)
    .single();

  if (
    fetchError &&
    (fetchError as { code?: string }).code !== "PGRST116"
  ) {
    throw fetchError;
  }
  if (!bottle) {
    throw new PourNotFoundError("Bottle not found.");
  }

  if (bottle.restaurant_id !== restaurantId) {
    throw new PourForbiddenError();
  }

  const result = await executeInventoryCommand({
    supabase,
    operationId,
    restaurantId,
    command: "close",
    wineId: bottle.wine_id,
    expectedOpenBottleId: bottleId,
    expectedOpenedAt,
    actualRemainingMl,
    writtenOffMl,
    reasonCodeId,
  });
  if (!result.closeout) {
    throw new InventoryCommandError("invalid_inventory_command_result");
  }

  revalidatePath("/cellar/open");
  revalidatePath("/cellar");
  revalidatePath("/insights");

  return { closeout: result.closeout, replayed: result.replayed };
}

export type DiscardOpenBottleInput = {
  supabase: SupabaseClient<Database>;
  operationId: string;
  restaurantId: string;
  bottleId: string;
  wineId?: string;
  contractVersion?: 1 | 2;
  expectedOpenedAt?: string;
};

export async function discardOpenBottle(input: DiscardOpenBottleInput) {
  const { supabase, operationId, restaurantId, bottleId, expectedOpenedAt,
    wineId, contractVersion = 1 } = input;
  if (contractVersion === 2) {
    if (!wineId) throw new InventoryCommandError("invalid_physical_command");
    const result = await executePhysicalBottleCommand({
      supabase, operationId, restaurantId, command: "discard", wineId,
      openBottleId: bottleId,
    });
    revalidateClosePaths();
    return { closed: result.openBottle, replayed: result.replayed };
  }
  if (!expectedOpenedAt) throw new InventoryCommandError("invalid_inventory_command");
  const { data: bottle, error: fetchError } = await supabase
    .from("open_bottles")
    .select("id, wine_id, restaurant_id")
    .eq("id", bottleId)
    .eq("restaurant_id", restaurantId)
    .single();

  if (fetchError && fetchError.code !== "PGRST116") throw fetchError;
  if (!bottle) throw new PourNotFoundError("Bottle not found.");

  const result = await executeInventoryCommand({
    supabase,
    operationId,
    restaurantId,
    command: "discard",
    wineId: bottle.wine_id,
    expectedOpenBottleId: bottleId,
    expectedOpenedAt,
  });
  if (!result.openBottle) {
    throw new InventoryCommandError("invalid_inventory_command_result");
  }

  revalidatePath("/cellar/open");
  revalidatePath("/cellar");
  revalidatePath("/insights");
  return { closed: result.openBottle, replayed: result.replayed };
}

function revalidateClosePaths() {
  revalidatePath("/cellar/open");
  revalidatePath("/cellar");
  revalidatePath("/insights");
}
