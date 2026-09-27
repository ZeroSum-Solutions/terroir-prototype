import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/api/auth";
import { apiError, Errors } from "@/lib/api/errors";
import { withApiHandler } from "@/lib/api/handler";
import { parseJson } from "@/lib/api/validation";
import { UndoReconcileReceiptSchema } from "@/lib/reconcile-ledger";

export const runtime = "nodejs";

const UndoSchema = z.strictObject({ batch_id: z.string().uuid() });
type RpcError = { code?: string; message?: string };

export async function POST(request: NextRequest) {
  return withApiHandler(async () => {
    const auth = await requireRole(["owner", "manager"]);
    if (auth instanceof NextResponse) return auth;

    if (
      request.headers.get("X-Expected-User-Id") !== auth.user.id ||
      request.headers.get("X-Expected-Restaurant-Id") !== auth.restaurantId
    ) {
      return contextMismatch();
    }

    const parsed = await parseJson(request, UndoSchema);
    if (!parsed.ok) return parsed.response;

    let result;
    try {
      // The RPC checks authority for the batch's site; also bind it to the
      // active site so a manager of multiple venues cannot undo stale context.
      const batch = await auth.supabase
        .from("reconcile_batches")
        .select("id")
        .eq("id", parsed.data.batch_id)
        .eq("restaurant_id", auth.restaurantId)
        .maybeSingle();
      if (batch.error) return Errors.internal("Reconcile undo failed.");
      if (!batch.data) return contextMismatch();

      result = await auth.supabase.rpc("undo_reconcile_batch", {
        p_batch_id: parsed.data.batch_id,
      });
    } catch {
      return Errors.internal("Reconcile undo failed.");
    }
    if (result.error) return rpcFailure(result.error);

    const receipt = UndoReconcileReceiptSchema.safeParse(result.data);
    if (!receipt.success || receipt.data.batchId !== parsed.data.batch_id) {
      return Errors.internal("Reconcile undo failed.");
    }
    return NextResponse.json(receipt.data);
  });
}

function contextMismatch() {
  return apiError(
    409,
    "reconcile_context_mismatch",
    "Reconciliation context changed. No action was attempted.",
  );
}

function rpcFailure(error: RpcError) {
  const pair = `${error.code ?? ""}:${error.message?.trim() ?? ""}`;
  switch (pair) {
    case "42501:forbidden":
      return Errors.forbidden();
    case "P0001:reconcile_batch_already_undone":
    case "P0001:reconcile_subject_changed":
    case "P0001:reconcile_batch_conflict":
      return Errors.conflict(
        "reconcile_conflict",
        "Reconciliation conflicts with current state. Refresh and try again.",
      );
    default:
      return Errors.internal("Reconcile undo failed.");
  }
}
