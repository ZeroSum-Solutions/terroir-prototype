/**
 * POST /api/import/batches/[id]/revert — undo one import batch atomically.
 * The database removes only inventory created by this batch, clears eligible
 * LWIN pairs, retains catalog wines/history, and commits the status together.
 */
import { NextResponse, type NextRequest } from "next/server";
import { requireMembership } from "@/lib/api/auth";
import { withApiHandler } from "@/lib/api/handler";
import { Errors, apiError } from "@/lib/api/errors";
import { parseParams } from "@/lib/api/validation";
import { BatchIdParamsSchema } from "@/domains/import/request-schemas";
import { revertImportBatch } from "@/domains/import/batch-service";

export const runtime = "nodejs";
export const maxDuration = 30;

type Params = Promise<{ id: string }>;

export async function POST(_request: NextRequest, { params }: { params: Params }) {
  return withApiHandler(() => postRevert(params));
}

async function postRevert(params: Params) {
  const auth = await requireMembership();
  if (auth instanceof NextResponse) return auth;
  const { supabase, restaurantId } = auth;

  const parsedParams = await parseParams(params, BatchIdParamsSchema);
  if (!parsedParams.ok) return parsedParams.response;
  const { id } = parsedParams.data;

  const { data: batch, error: batchError } = await supabase
    .from("import_batches")
    .select("id")
    .eq("id", id)
    .eq("restaurant_id", restaurantId)
    .maybeSingle();
  if (batchError) throw batchError;
  if (!batch) return Errors.notFound("Import batch");

  const result = await revertImportBatch(supabase, restaurantId, id);
  if (!result.ok) {
    if (result.error.code === "not_found") return Errors.notFound("Import batch");
    if (result.error.code === "forbidden") return apiError(403, result.error.code, result.error.message);
    if (
      result.error.code === "already_reverted" ||
      result.error.code === "physical_bottle_dependency" ||
      result.error.code === "import_source_conflict"
    ) {
      return apiError(409, result.error.code === "already_reverted" ? "not_completed" : result.error.code, result.error.message);
    }
    return apiError(500, "internal_error", "Could not revert import batch.");
  }

  return NextResponse.json({
    revertedCount: result.revertedCount,
    orphanWinesDeleted: result.orphanWinesDeleted,
    lwinStampsCleared: result.lwinStampsCleared,
  });
}
