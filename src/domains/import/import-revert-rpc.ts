import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database } from "@/types/database";

const CountSchema = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);

const BatchRevertReceiptSchema = z.strictObject({
  version: z.literal(1),
  batchId: z.string().uuid(),
  status: z.literal("reverted"),
  revertedItemCount: CountSchema,
  orphanWinesDeleted: z.literal(0),
  lwinStampsCleared: CountSchema,
});

const RevertedSessionBatchSchema = z.strictObject({
  batchId: z.string().uuid(),
  chunkIndex: z.number().int().nullable(),
  skipped: z.literal(false),
  status: z.literal("reverted"),
  revertedItemCount: CountSchema,
  orphanWinesDeleted: z.literal(0),
  lwinStampsCleared: CountSchema,
});

const AlreadyRevertedSessionBatchSchema = z.strictObject({
  batchId: z.string().uuid(),
  chunkIndex: z.number().int().nullable(),
  skipped: z.literal(true),
  reason: z.literal("already_reverted"),
});

const SessionRevertReceiptSchema = z.strictObject({
  version: z.literal(1),
  sessionId: z.string().uuid(),
  status: z.literal("reverted"),
  batches: z.array(z.discriminatedUnion("skipped", [
    RevertedSessionBatchSchema,
    AlreadyRevertedSessionBatchSchema,
  ])),
  revertedBatchCount: CountSchema,
  blockedBatchCount: z.literal(0),
  revertedItemCount: CountSchema,
}).superRefine((receipt, context) => {
  const reverted = receipt.batches.filter((batch) => !batch.skipped);
  if (reverted.length !== receipt.revertedBatchCount) {
    context.addIssue({ code: "custom", message: "Reverted batch count does not match child receipts." });
  }
  if (new Set(receipt.batches.map((batch) => batch.batchId)).size !== receipt.batches.length) {
    context.addIssue({ code: "custom", message: "Session receipt contains duplicate batch IDs." });
  }
  const revertedItems = reverted.reduce((total, batch) => total + batch.revertedItemCount, 0);
  if (!Number.isSafeInteger(revertedItems) || revertedItems !== receipt.revertedItemCount) {
    context.addIssue({ code: "custom", message: "Reverted item count does not match child receipts." });
  }
});

export type BatchRevertReceipt = z.infer<typeof BatchRevertReceiptSchema>;
export type SessionRevertReceipt = z.infer<typeof SessionRevertReceiptSchema>;

export type ImportRevertError = {
  code:
    | "forbidden"
    | "not_found"
    | "already_reverted"
    | "physical_bottle_dependency"
    | "import_source_conflict"
    | "internal_error";
  message: string;
};

export type BatchRevertRpcResult =
  | { ok: true; receipt: BatchRevertReceipt }
  | { ok: false; error: ImportRevertError };

export type SessionRevertRpcResult =
  | { ok: true; receipt: SessionRevertReceipt }
  | { ok: false; error: ImportRevertError };

export async function revertImportBatchRpc(
  supabase: SupabaseClient<Database>,
  batchId: string,
): Promise<BatchRevertRpcResult> {
  let result;
  try {
    result = await supabase.rpc("revert_import_batch_private", { p_batch_id: batchId });
  } catch {
    return internalError("batch");
  }
  if (result.error) return { ok: false, error: mapRpcError(result.error, "batch") };

  const parsed = BatchRevertReceiptSchema.safeParse(result.data);
  if (!parsed.success || parsed.data.batchId.toLowerCase() !== batchId.toLowerCase()) return internalError("batch");
  return { ok: true, receipt: parsed.data };
}

export async function revertImportSessionRpc(
  supabase: SupabaseClient<Database>,
  sessionId: string,
): Promise<SessionRevertRpcResult> {
  let result;
  try {
    result = await supabase.rpc("revert_import_session", { p_session_id: sessionId });
  } catch {
    return internalError("session");
  }
  if (result.error) return { ok: false, error: mapRpcError(result.error, "session") };

  const parsed = SessionRevertReceiptSchema.safeParse(result.data);
  if (!parsed.success || parsed.data.sessionId.toLowerCase() !== sessionId.toLowerCase()) return internalError("session");
  return { ok: true, receipt: parsed.data };
}

type RevertKind = "batch" | "session";
type RpcFailure = { code?: string; message?: string };

function mapRpcError(error: RpcFailure, kind: RevertKind): ImportRevertError {
  const pair = `${error.code ?? ""}:${error.message ?? ""}`;
  if (pair === "42501:forbidden") return { code: "forbidden", message: "Forbidden" };
  if (pair === "P0002:import_batch_not_found" && kind === "batch") {
    return { code: "not_found", message: "Import batch not found." };
  }
  if (pair === "P0002:import_session_not_found" && kind === "session") {
    return { code: "not_found", message: "Import session not found." };
  }
  if (pair === "P04I1:import_batch_already_reverted" && kind === "batch") {
    return { code: "already_reverted", message: "Import batch is already reverted." };
  }
  if (pair === "P04D3:physical_bottle_dependency") {
    return {
      code: "physical_bottle_dependency",
      message: kind === "batch"
        ? "Import batch cannot be reverted because physical bottles depend on its source inventory."
        : "Import session cannot be reverted because physical bottles depend on imported inventory.",
    };
  }
  if (pair === "P04I2:import_source_conflict") {
    return {
      code: "import_source_conflict",
      message: "Import inventory is linked to multiple import rows, so this revert was not performed. Wine catalog entries and import history are unchanged. Ask a manager to review the import.",
    };
  }
  return internalError(kind).error;
}

function internalError(kind: RevertKind) {
  return {
    ok: false as const,
    error: {
      code: "internal_error" as const,
      message: kind === "batch" ? "Could not revert import batch." : "Could not revert import session.",
    },
  };
}
