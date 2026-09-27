import * as Sentry from "@sentry/nextjs";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/api/auth";
import { Errors } from "@/lib/api/errors";
import { withApiHandler } from "@/lib/api/handler";
import { parseJson, parseParams } from "@/lib/api/validation";

export const runtime = "nodejs";

type Params = Promise<{ id: string }>;

const ParamsSchema = z.strictObject({ id: z.string().uuid() });
const PatchSchema = z.strictObject({
  code: z.string().trim().min(1).max(50).optional(),
  zone: z.string().trim().max(100)
    .transform((value) => (value === "" ? null : value))
    .nullable().optional(),
  capacity: z.number().int().positive().nullable().optional(),
  priority: z.number().int().optional(),
  retired_at: z.string().datetime({ offset: true }).nullable().optional(),
});
const BIN_FIELDS =
  "id, code, zone, capacity, priority, sort_order, retired_at";

function reportFailure(restaurantId: string, binId: string) {
  const safeError = new Error("Bin update failed.");
  console.error(safeError.message);
  Sentry.captureException(safeError, {
    tags: { surface: "bins", phase: "update" },
    extra: { restaurantId, binId },
  });
}

function updateErrorResponse(
  error: { code?: string } | null,
  restaurantId: string,
  binId: string,
) {
  if (error?.code === "23505") {
    return Errors.conflict(
      "duplicate_bin_code",
      "A bin with that code already exists.",
    );
  }
  if (!error) return null;
  reportFailure(restaurantId, binId);
  return Errors.internal("Failed to update bin.");
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Params },
) {
  return withApiHandler(async () => {
    const auth = await requireRole(["owner", "manager"]);
    if (auth instanceof NextResponse) return auth;
    const { supabase, restaurantId } = auth;

    const parsedParams = await parseParams(params, ParamsSchema);
    if (!parsedParams.ok) return parsedParams.response;
    const { id: binId } = parsedParams.data;

    const parsed = await parseJson(request, PatchSchema);
    if (!parsed.ok) return parsed.response;
    if (Object.keys(parsed.data).length === 0) {
      return Errors.badRequest("No valid fields to update.");
    }

    const { data, error } = await supabase
      .from("bins")
      .update(parsed.data)
      .eq("id", binId)
      .eq("restaurant_id", restaurantId)
      .select(BIN_FIELDS)
      .maybeSingle();

    const errorResponse = updateErrorResponse(error, restaurantId, binId);
    if (errorResponse) return errorResponse;
    if (!data) return Errors.notFound("Bin");
    return NextResponse.json(data);
  });
}
