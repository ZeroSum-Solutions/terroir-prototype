import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database } from "@/types/database";
import { MAX_ROWS } from "./constants";

export type ResolveAction = "include" | "exclude";
export type ResolutionKind = "row" | "bulk";

const ResolveRowReceiptSchema = z.strictObject({
  rowId: z.string().uuid(),
  batchId: z.string().uuid(),
  status: z.literal("resolved"),
  updated: z.literal(true),
});

const BulkResolveReceiptSchema = z.strictObject({
  batchId: z.string().uuid(),
  status: z.literal("resolved"),
  resolvedCount: z.number().int().min(0).max(MAX_ROWS),
  remainingPending: z.number().int().min(0).max(MAX_ROWS),
}).refine(
  (receipt) => receipt.resolvedCount + receipt.remainingPending <= MAX_ROWS,
  "Import resolution counts exceed the batch row limit.",
);

export type ResolveRowReceipt = z.infer<typeof ResolveRowReceiptSchema>;
export type BulkResolveReceipt = z.infer<typeof BulkResolveReceiptSchema>;

export type ImportResolutionError = {
  code: string;
  message: string;
};

export type ResolveRowResult =
  | { ok: true; receipt: ResolveRowReceipt }
  | { ok: false; error: ImportResolutionError };

export type BulkResolveResult =
  | { ok: true; receipt: BulkResolveReceipt }
  | { ok: false; error: ImportResolutionError };

export async function resolveImportRowRpc(
  supabase: SupabaseClient<Database>,
  rowId: string,
  expectedBatchId: string,
  action: ResolveAction,
  manualUnitCost?: number,
): Promise<ResolveRowResult> {
  const args = manualUnitCost === undefined
    ? { p_row_id: rowId, p_action: action }
    : { p_row_id: rowId, p_action: action, p_manual_unit_cost: manualUnitCost };
  let rpcResult;
  try {
    rpcResult = await supabase.rpc("resolve_import_batch_row", args);
  } catch {
    return resolutionInternalError("row");
  }
  if (rpcResult.error) {
    return { ok: false, error: mapResolutionRpcError(rpcResult.error, "row") };
  }

  const receipt = ResolveRowReceiptSchema.safeParse(rpcResult.data);
  if (
    !receipt.success ||
    receipt.data.rowId !== rowId ||
    receipt.data.batchId !== expectedBatchId
  ) {
    return resolutionInternalError("row");
  }
  return { ok: true, receipt: receipt.data };
}

export async function bulkResolveImportRowsRpc(
  supabase: SupabaseClient<Database>,
  batchId: string,
  action: ResolveAction,
): Promise<BulkResolveResult> {
  let rpcResult;
  try {
    rpcResult = await supabase.rpc("bulk_resolve_import_batch_rows", {
      p_batch_id: batchId,
      p_action: action,
    });
  } catch {
    return resolutionInternalError("bulk");
  }
  if (rpcResult.error) {
    return { ok: false, error: mapResolutionRpcError(rpcResult.error, "bulk") };
  }

  const receipt = BulkResolveReceiptSchema.safeParse(rpcResult.data);
  if (!receipt.success || receipt.data.batchId !== batchId) {
    return resolutionInternalError("bulk");
  }
  return { ok: true, receipt: receipt.data };
}

type RpcFailure = { code?: string; message?: string };

function mapResolutionRpcError(
  error: RpcFailure,
  kind: ResolutionKind,
): ImportResolutionError {
  const pair = `${error.code ?? ""}:${error.message ?? ""}`;
  if (pair === "42501:forbidden") {
    return { code: "forbidden", message: "Forbidden" };
  }
  if (
    (kind === "row" && pair === "P0001:C04_IMPORT_RESOLVE_REFUSED") ||
    (kind === "bulk" && pair === "P0001:C04_IMPORT_BULK_RESOLVE_REFUSED")
  ) {
    return {
      code: "resolution_refused",
      message: kind === "row"
        ? "Could not resolve import row."
        : "Could not resolve import rows.",
    };
  }
  return resolutionInternalError(kind).error;
}

export function resolutionInternalError(kind: ResolutionKind) {
  return {
    ok: false as const,
    error: {
      code: "internal_error",
      message: kind === "row"
        ? "Could not resolve import row."
        : "Could not resolve import rows.",
    },
  };
}
