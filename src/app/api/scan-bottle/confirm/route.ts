import { NextResponse, type NextRequest } from "next/server";
import { requireMembership } from "@/lib/api/auth";
import { apiError, Errors } from "@/lib/api/errors";
import { withApiHandler } from "@/lib/api/handler";
import { parseJson } from "@/lib/api/validation";
import { isValidIdempotencyKey, invalidIdempotencyKeyResult } from "@/lib/api/idempotency";
import { apiResultResponse } from "@/lib/api/result-response";
import {
  BOTTLE_LOCATION_BIN_UNAVAILABLE_MESSAGE,
  BOTTLE_LOCATION_WINE_UNAVAILABLE_MESSAGE,
  decodeBottleLocationReceiveRpcResult,
} from "@/lib/api/bottle-location-receive-contract";
import { ConfirmBottleBodySchema } from "@/lib/scanner/request-schemas";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  return withApiHandler(() => postBottleConfirmation(request));
}

async function postBottleConfirmation(request: NextRequest) {
  const auth = await requireMembership();
  if (auth instanceof NextResponse) return auth;

  const { supabase, restaurantId, user } = auth;
  const expectedUser = request.headers.get("X-Expected-User-Id");
  const expectedSite = request.headers.get("X-Expected-Restaurant-Id");
  if (!isValidIdempotencyKey(expectedUser) || !isValidIdempotencyKey(expectedSite) ||
    expectedUser.toLowerCase() !== user.id.toLowerCase() ||
    expectedSite.toLowerCase() !== restaurantId.toLowerCase()) {
    return Errors.conflict("bottle_context_mismatch", "Bottle receiving context changed. No receipt was attempted.");
  }
  const operationId = request.headers.get("Idempotency-Key");
  if (!isValidIdempotencyKey(operationId)) return apiResultResponse(invalidIdempotencyKeyResult());

  const parsed = await parseJson(request, ConfirmBottleBodySchema, {
    message: "Invalid body.",
  });
  if (!parsed.ok) return parsed.response;
  const { wine_id, section, bin_id } = parsed.data;
  try {
    const { data, error } = await supabase.rpc("receive_bottle_at_location_private", {
      p_restaurant_id: restaurantId,
      p_operation_id: operationId,
      p_wine_id: wine_id,
      p_section: section,
      p_bin_id: bin_id,
    });
    if (error) {
      switch (error.code) {
        case "42501": return Errors.forbidden();
        case "P05W1": return apiError(404, "wine_not_found", BOTTLE_LOCATION_WINE_UNAVAILABLE_MESSAGE);
        case "P05B1": return Errors.conflict("bin_unavailable", BOTTLE_LOCATION_BIN_UNAVAILABLE_MESSAGE);
        case "P05C1": return Errors.conflict("bottle_location_operation_conflict", "This operation does not match the original bottle receipt. Keep the original recovery.");
        default: return Errors.internal();
      }
    }
    const { replayed, ...receipt } = decodeBottleLocationReceiveRpcResult({
      operationId, wineId: wine_id, section, binId: bin_id,
    }, data);
    return NextResponse.json(receipt, { status: 201, headers: {
      "Idempotency-Key": operationId,
      "Idempotency-Replayed": String(replayed),
    } });
  } catch {
    return Errors.internal();
  }
}
