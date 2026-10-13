/**
 * POST /api/import/sessions/[id]/revert — revert every batch in a session
 * as one database transaction (P3 §3.4), in reverse chunk order.
 */
import { NextResponse, type NextRequest } from "next/server";
import { requireMembership } from "@/lib/api/auth";
import { withApiHandler } from "@/lib/api/handler";
import { Errors, apiError } from "@/lib/api/errors";
import { parseParams } from "@/lib/api/validation";
import { SessionIdParamsSchema } from "@/domains/import/request-schemas";
import { revertImportSession } from "@/domains/import/session-service";

export const runtime = "nodejs";
export const maxDuration = 60;

type Params = Promise<{ id: string }>;

export async function POST(_request: NextRequest, { params }: { params: Params }) {
  return withApiHandler(() => postRevert(params));
}

async function postRevert(params: Params) {
  const auth = await requireMembership();
  if (auth instanceof NextResponse) return auth;
  const { supabase, restaurantId } = auth;

  const parsedParams = await parseParams(params, SessionIdParamsSchema);
  if (!parsedParams.ok) return parsedParams.response;
  const { id } = parsedParams.data;

  const { data: session, error: sessionError } = await supabase
    .from("import_sessions")
    .select("id")
    .eq("id", id)
    .eq("restaurant_id", restaurantId)
    .maybeSingle();
  if (sessionError) throw sessionError;
  if (!session) return Errors.notFound("Import session");

  const result = await revertImportSession(supabase, id);
  if (!result.ok) {
    if (result.error.code === "not_found") return Errors.notFound("Import session");
    if (result.error.code === "forbidden") return apiError(403, result.error.code, result.error.message);
    if (
      result.error.code === "physical_bottle_dependency" ||
      result.error.code === "import_source_conflict"
    ) {
      return apiError(409, result.error.code, result.error.message, { batches: [] });
    }
    return apiError(500, "internal_error", "Could not revert import session.");
  }

  return NextResponse.json({ sessionId: result.sessionId, batches: result.batches });
}
