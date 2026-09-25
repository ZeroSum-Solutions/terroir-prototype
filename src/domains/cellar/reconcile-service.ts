import * as Sentry from "@sentry/nextjs";
import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import {
  canonicalizePhysicalReconcileEntries,
  type PhysicalReconcileEntry,
} from "./reconcile-contract";
import { InventoryCommandError } from "@/domains/pours/inventory-command";
import { revalidateAutoEightysixedWines } from "@/lib/api/auto-eightysix-revalidation";
import type { Database, Json } from "@/types/database";

export class ReconcileForbiddenError extends Error {
  constructor() {
    super("Forbidden.");
    this.name = "ReconcileForbiddenError";
  }
}

export class ReconcileExceedsSizeError extends Error {
  constructor() {
    super("new_remaining_ml exceeds bottle size.");
    this.name = "ReconcileExceedsSizeError";
  }
}

export class ReconcileRpcError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message);
    this.name = "ReconcileRpcError";
    this.cause = options?.cause;
  }
}

export type ReconcileEntry = {
  wine_id: string;
  new_remaining_ml: number;
  note?: string;
};

export type ReconcileOpenBottlesInput = {
  supabase: SupabaseClient<Database>;
  restaurantId: string;
  entries: ReconcileEntry[];
};

const uuid = z.string().uuid();
const resultBottleSchema = z.strictObject({
  id: uuid,
  restaurant_id: uuid,
  wine_id: uuid,
  remaining_ml: z.number().int().nonnegative(),
  nominal_capacity_ml: z.number().int().positive(),
  opened_at: z.string().datetime({ offset: true }),
  closed_at: z.null(),
  preservation_method: z.enum(["coravin", "argon", "vacuum", "none"]),
  source_inventory_item_id: uuid.nullable(),
  source_provenance: z.enum(["known", "legacy_unknown"]),
  identity_contract: z.literal(2),
  identity_origin: z.enum(["migrated_active", "native"]),
  state_version: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
}).superRefine((bottle, context) => {
  if (bottle.identity_origin === "native" &&
    (bottle.source_inventory_item_id === null || bottle.source_provenance !== "known")) {
    context.addIssue({ code: "custom", message: "native source identity is required" });
  }
});
const physicalResultSchema = z.strictObject({
  operation_id: uuid,
  command: z.literal("reconcile_batch"),
  entries: z.array(z.strictObject({
    entry_ordinal: z.number().int().nonnegative(),
    open_bottle_id: uuid,
    wine_id: uuid,
    pour_event_id: uuid,
    open_bottle: resultBottleSchema,
  })).min(1).max(100),
  replayed: z.boolean(),
});

export type PhysicalReconcileOutcome = {
  operationId: string;
  replayed: boolean;
  entries: Array<{
    entryOrdinal: number;
    openBottleId: string;
    wineId: string;
    pourEventId: string;
    remainingMl: number;
    stateVersion: number;
  }>;
};

export async function reconcileOpenBottles(
  input: ReconcileOpenBottlesInput,
): Promise<number> {
  const { supabase, restaurantId, entries } = input;
  const sinceTs = new Date().toISOString();

  const { data, error } = await supabase.rpc(
    "reconcile_open_bottles_batch",
    {
      p_entries: entries as unknown as Json,
    },
  );

  if (error) {
    if (error.code === "42501") {
      throw new ReconcileForbiddenError();
    }
    if (error.code === "P0002") {
      throw new ReconcileExceedsSizeError();
    }
    console.error("reconcile_open_bottles_batch failed:", error);
    Sentry.captureException(error, {
      tags: { surface: "reconcile", phase: "reconcile_open_bottles_batch-rpc" },
      extra: { entry_count: entries.length },
    });
    throw new ReconcileRpcError("Reconcile failed.", { cause: error });
  }

  revalidatePath("/availability");

  const touchedWineIds = Array.from(new Set(entries.map((entry) => entry.wine_id)));
  await revalidateAutoEightysixedWines({
    supabase,
    restaurantId,
    touchedWineIds,
    sinceTs,
  });

  return (data as number) ?? 0;
}

export async function reconcilePhysicalBottles(input: {
  supabase: SupabaseClient<Database>;
  operationId: string;
  restaurantId: string;
  entries: PhysicalReconcileEntry[];
}): Promise<PhysicalReconcileOutcome> {
  const entries = canonicalizePhysicalReconcileEntries(input.entries);
  if (new Set(entries.map((entry) => entry.open_bottle_id)).size !== entries.length) {
    throw new InventoryCommandError("invalid_reconciliation_batch");
  }
  const sinceTs = new Date().toISOString();
  const { data, error } = await input.supabase.rpc(
    "execute_physical_reconciliation_batch",
    {
      p_operation_id: input.operationId,
      p_restaurant_id: input.restaurantId,
      p_entries: entries as unknown as Json,
    },
  );
  if (error) {
    throw new InventoryCommandError(
      String(error.message ?? "physical_reconciliation_failed").trim(),
      error.code,
    );
  }

  const parsed = physicalResultSchema.safeParse(data);
  const result = parsed.success ? parsed.data : null;
  const valid = result &&
    result.operation_id === input.operationId &&
    result.entries.length === entries.length &&
    result.entries.every((entry, index) => {
      const expected = entries[index];
      return entry.entry_ordinal === index &&
        entry.open_bottle_id === expected.open_bottle_id &&
        entry.open_bottle.id === expected.open_bottle_id &&
        entry.open_bottle.restaurant_id === input.restaurantId &&
        entry.open_bottle.wine_id === entry.wine_id &&
        entry.open_bottle.remaining_ml === expected.target_remaining_ml &&
        entry.open_bottle.state_version === expected.expected_state_version + 1 &&
        expected.target_remaining_ml <= entry.open_bottle.nominal_capacity_ml;
    }) &&
    new Set(result.entries.map((entry) => entry.pour_event_id)).size === entries.length;
  if (!valid) throw new InventoryCommandError("invalid_physical_reconciliation_result");

  revalidatePath("/availability");
  await revalidateAutoEightysixedWines({
    supabase: input.supabase,
    restaurantId: input.restaurantId,
    touchedWineIds: Array.from(new Set(result.entries.map((entry) => entry.wine_id))),
    sinceTs,
  });

  return {
    operationId: result.operation_id,
    replayed: result.replayed,
    entries: result.entries.map((entry) => ({
      entryOrdinal: entry.entry_ordinal,
      openBottleId: entry.open_bottle_id,
      wineId: entry.wine_id,
      pourEventId: entry.pour_event_id,
      remainingMl: entry.open_bottle.remaining_ml,
      stateVersion: entry.open_bottle.state_version,
    })),
  };
}
