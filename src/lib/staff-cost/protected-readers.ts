import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { HEALTH_SEGMENTS } from "@/lib/cellar-health/classify";
import type { Database } from "@/types/database";

const PAGE_SIZE = 1000;
const MAX_WINE_FILTER = 500;

const UuidSchema = z.uuid();
const TimestampSchema = z.iso.datetime({ offset: true });
const JsonSchema = z.json();

const InventoryCostRowSchema = z.object({
  inventory_item_id: UuidSchema,
  wine_id: UuidSchema,
  invoice_scan_id: UuidSchema.nullable(),
  unit_cost: z.number().finite(),
  currency: z.string().nullable(),
  added_at: TimestampSchema,
}).strict();

const WinePricingStrategyRowSchema = z.object({
  wine_id: UuidSchema,
  pricing_target_pour_cost_pct: z.number().finite().nullable(),
  pricing_target_markup_ratio: z.number().finite().nullable(),
  pricing_dismissed_until: TimestampSchema.nullable(),
}).strict();

const WineCostFlagRowSchema = z.object({
  wine_id: UuidSchema,
  overpaid_flag: z.boolean(),
}).strict();

const RestaurantPricingDefaultsRowSchema = z.object({
  restaurant_id: UuidSchema,
  default_target_pour_cost_pct: z.number().finite().nullable(),
  default_target_markup_ratio: z.number().finite().nullable(),
}).strict();

const InvoiceScanPrivateRowSchema = z.object({
  scan_id: UuidSchema,
  restaurant_id: UuidSchema,
  distributor_name: z.string(),
  invoice_number: z.string().nullable(),
  invoice_date: z.iso.date().nullable(),
  status: z.string(),
  status_reason: z.string().nullable(),
  accuracy_score: z.number().finite().nullable(),
  item_count: z.number().int().nonnegative(),
  created_at: TimestampSchema,
  created_by: UuidSchema.nullable(),
  updated_at: TimestampSchema,
  committed_at: TimestampSchema.nullable(),
  parsed_line_items: JsonSchema,
  final_line_items: JsonSchema,
  edits: JsonSchema,
  ocr_text: JsonSchema.nullable(),
  has_image: z.boolean(),
  image_count: z.number().int().min(0).max(8),
}).strict();

const InvoiceImageTargetRowSchema = z.object({
  object_name: z.string().min(1).max(200),
}).strict();

const InvoiceScanDeletionPrivateRowSchema = z.object({
  deletion_id: UuidSchema,
  restaurant_id: UuidSchema,
  invoice_scan_id: UuidSchema,
  deleted_by: UuidSchema.nullable(),
  deleted_at: TimestampSchema,
  distributor_name: z.string(),
  invoice_number: z.string().nullable(),
  scan_status: z.string(),
  item_count: z.number().int().nonnegative(),
  inventory_rows_deleted: z.number().int().nonnegative(),
  bottles_removed: z.number().int().nonnegative(),
  final_line_items: JsonSchema,
}).strict();

const ReconcileActionPrivateRowSchema = z.object({
  action_id: UuidSchema,
  batch_id: UuidSchema,
  restaurant_id: UuidSchema,
  action_type: z.string(),
  subject_table: z.string(),
  subject_id: UuidSchema,
  ordinal: z.number().int().nonnegative(),
  prior_state: JsonSchema,
  new_state: JsonSchema,
  created_at: TimestampSchema,
}).strict();

const IdentityMergePrivateRowSchema = z.object({
  merge_id: UuidSchema,
  merge_type: z.string(),
  source_id: UuidSchema,
  target_id: UuidSchema,
  restaurant_id: UuidSchema,
  source_snapshot: JsonSchema,
  moved_counts: JsonSchema,
  merged_by: UuidSchema.nullable(),
  merged_at: TimestampSchema,
}).strict();

const ImportBatchCostRowSchema = z.object({
  row_id: UuidSchema,
  batch_id: UuidSchema,
  restaurant_id: UuidSchema,
  row_number: z.number().int().positive(),
  raw: JsonSchema,
  manual_unit_cost: z.number().finite().nullable(),
  validation_errors: JsonSchema,
  last_error_message: z.string().nullable(),
  cost_status: z.string(),
  resolution: z.string(),
  apply_status: z.string(),
  applied_inventory_item_id: UuidSchema.nullable(),
  applied_wine_id: UuidSchema.nullable(),
  apply_attempts: z.number().int().nonnegative(),
  lwin_id: z.string().nullable(),
  lwin_score: z.number().finite().nullable(),
  lwin_status: z.string(),
  duplicate_reason: JsonSchema.nullable(),
  row_state: z.string(),
  resolved_at: TimestampSchema.nullable(),
  resolved_by: UuidSchema.nullable(),
  created_at: TimestampSchema,
  updated_at: TimestampSchema,
}).strict();

const ImportBatchDisplayRowSchema = z.object({
  row_id: UuidSchema,
  batch_id: UuidSchema,
  restaurant_id: UuidSchema,
  row_number: z.number().int().positive(),
  producer: z.string().nullable(),
  name: z.string().nullable(),
}).strict();

const CellarHealthPrivateRowSchema = z.object({
  health_id: UuidSchema,
  restaurant_id: UuidSchema,
  wine_id: UuidSchema,
  segment: z.enum(HEALTH_SEGMENTS),
  reason: z.string(),
  computed_at: TimestampSchema,
}).strict();

export type InventoryCostRow = z.infer<typeof InventoryCostRowSchema>;
export type WinePricingStrategyRow = z.infer<typeof WinePricingStrategyRowSchema>;
export type WineCostFlagRow = z.infer<typeof WineCostFlagRowSchema>;
export type RestaurantPricingDefaultsRow = z.infer<typeof RestaurantPricingDefaultsRowSchema>;
export type InvoiceScanPrivateRow = z.infer<typeof InvoiceScanPrivateRowSchema>;
export type InvoiceImageTargetRow = z.infer<typeof InvoiceImageTargetRowSchema>;
export type InvoiceScanDeletionPrivateRow = z.infer<typeof InvoiceScanDeletionPrivateRowSchema>;
export type ReconcileActionPrivateRow = z.infer<typeof ReconcileActionPrivateRowSchema>;
export type IdentityMergePrivateRow = z.infer<typeof IdentityMergePrivateRowSchema>;
export type ImportBatchCostRow = z.infer<typeof ImportBatchCostRowSchema>;
export type ImportBatchDisplayRow = z.infer<typeof ImportBatchDisplayRowSchema>;
export type CellarHealthPrivateRow = z.infer<typeof CellarHealthPrivateRowSchema>;

type RpcRangeQuery = {
  range(from: number, to: number): PromiseLike<{
    data: unknown[] | null;
    error: { message: string } | null;
  }>;
};

function validateWineIds(wineIds: readonly string[] | null): string[] | null {
  if (wineIds === null) return null;
  if (wineIds.length > MAX_WINE_FILTER || new Set(wineIds).size !== wineIds.length) {
    throw new Error("Wine filter must contain at most 500 unique UUIDs.");
  }
  return z.array(UuidSchema).parse(wineIds);
}

async function readPaged<T>(
  makeQuery: () => RpcRangeQuery,
  rowSchema: z.ZodType<T>,
): Promise<T[]> {
  const rows: unknown[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await makeQuery().range(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    const page = data ?? [];
    rows.push(...page);
    if (page.length < PAGE_SIZE) return z.array(rowSchema).parse(rows);
  }
}

function parseOptionalSingleton<T>(data: unknown, schema: z.ZodType<T>): T | null {
  const rows = z.array(schema).max(1).parse(data ?? []);
  return rows[0] ?? null;
}

export function readInventoryCosts(
  supabase: SupabaseClient<Database>,
  restaurantId: string,
  wineIds: readonly string[] | null = null,
): Promise<InventoryCostRow[]> {
  const filter = validateWineIds(wineIds);
  return readPaged(
    () => supabase.rpc("read_inventory_costs", {
      p_restaurant_id: restaurantId,
      p_wine_ids: filter,
    }),
    InventoryCostRowSchema,
  );
}

export function readWinePricingStrategy(
  supabase: SupabaseClient<Database>,
  restaurantId: string,
  wineIds: readonly string[] | null = null,
): Promise<WinePricingStrategyRow[]> {
  const filter = validateWineIds(wineIds);
  return readPaged(
    () => supabase.rpc("read_wine_pricing_strategy", {
      p_restaurant_id: restaurantId,
      p_wine_ids: filter,
    }),
    WinePricingStrategyRowSchema,
  );
}

export function readWineCostFlags(
  supabase: SupabaseClient<Database>,
  restaurantId: string,
  wineIds: readonly string[] | null = null,
): Promise<WineCostFlagRow[]> {
  const filter = validateWineIds(wineIds);
  return readPaged(
    () => supabase.rpc("read_wine_cost_flags", {
      p_restaurant_id: restaurantId,
      p_wine_ids: filter,
    }),
    WineCostFlagRowSchema,
  );
}

export async function readRestaurantPricingDefaults(
  supabase: SupabaseClient<Database>,
  restaurantId: string,
): Promise<RestaurantPricingDefaultsRow | null> {
  const { data, error } = await supabase.rpc("read_restaurant_pricing_defaults", {
    p_restaurant_id: restaurantId,
  });
  if (error) throw error;
  return parseOptionalSingleton(data, RestaurantPricingDefaultsRowSchema);
}

export async function readInvoiceScanPrivate(
  supabase: SupabaseClient<Database>,
  scanId: string,
): Promise<InvoiceScanPrivateRow | null> {
  const { data, error } = await supabase.rpc("read_invoice_scan_private", {
    p_scan_id: scanId,
  });
  if (error) throw error;
  return parseOptionalSingleton(data, InvoiceScanPrivateRowSchema);
}

export async function readInvoiceImageTarget(
  supabase: SupabaseClient<Database>,
  scanId: string,
  pageIndex = 0,
): Promise<InvoiceImageTargetRow | null> {
  const validatedPageIndex = z.number().int().min(0).max(7).parse(pageIndex);
  const { data, error } = await supabase.rpc("read_invoice_image_target", {
    p_scan_id: scanId,
    p_page_index: validatedPageIndex,
  });
  if (error) throw error;
  return parseOptionalSingleton(data, InvoiceImageTargetRowSchema);
}

export async function readInvoiceScanDeletionPrivate(
  supabase: SupabaseClient<Database>,
  deletionId: string,
): Promise<InvoiceScanDeletionPrivateRow | null> {
  const { data, error } = await supabase.rpc("read_invoice_scan_deletion_private", {
    p_deletion_id: deletionId,
  });
  if (error) throw error;
  return parseOptionalSingleton(data, InvoiceScanDeletionPrivateRowSchema);
}

export function readReconcileActionPrivate(
  supabase: SupabaseClient<Database>,
  batchId: string,
): Promise<ReconcileActionPrivateRow[]> {
  return readPaged(
    () => supabase.rpc("read_reconcile_action_private", { p_batch_id: batchId }),
    ReconcileActionPrivateRowSchema,
  );
}

export async function readIdentityMergePrivate(
  supabase: SupabaseClient<Database>,
  mergeId: string,
): Promise<IdentityMergePrivateRow | null> {
  const { data, error } = await supabase.rpc("read_identity_merge_private", {
    p_merge_id: mergeId,
  });
  if (error) throw error;
  return parseOptionalSingleton(data, IdentityMergePrivateRowSchema);
}

export async function readImportBatchCostRows(
  supabase: SupabaseClient<Database>,
  batchId: string,
  options: { afterRowNumber?: number; limit?: number } = {},
): Promise<ImportBatchCostRow[]> {
  const afterRowNumber = z.number().int().nonnegative().parse(options.afterRowNumber ?? 0);
  const limit = z.number().int().min(1).max(500).parse(options.limit ?? 100);
  const { data, error } = await supabase.rpc("read_import_batch_cost_rows", {
    p_batch_id: batchId,
    p_after_row_number: afterRowNumber,
    p_limit: limit,
  });
  if (error) throw error;
  return z.array(ImportBatchCostRowSchema).parse(data ?? []);
}

export async function readImportBatchDisplayRows(
  supabase: SupabaseClient<Database>,
  batchId: string,
  options: { afterRowNumber?: number; limit?: number } = {},
): Promise<ImportBatchDisplayRow[]> {
  const afterRowNumber = z.number().int().nonnegative().parse(options.afterRowNumber ?? 0);
  const limit = z.number().int().min(1).max(500).parse(options.limit ?? 100);
  const { data, error } = await supabase.rpc("read_import_batch_display_rows", {
    p_batch_id: batchId,
    p_after_row_number: afterRowNumber,
    p_limit: limit,
  });
  if (error) throw error;
  return z.array(ImportBatchDisplayRowSchema).parse(data ?? []);
}

export function readCellarHealthPrivate(
  supabase: SupabaseClient<Database>,
  restaurantId: string,
  wineIds: readonly string[] | null = null,
): Promise<CellarHealthPrivateRow[]> {
  const filter = validateWineIds(wineIds);
  return readPaged(
    () => supabase.rpc("read_cellar_health_private", {
      p_restaurant_id: restaurantId,
      p_wine_ids: filter,
    }),
    CellarHealthPrivateRowSchema,
  );
}
