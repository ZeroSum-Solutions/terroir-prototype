import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import {
  closeOpenBottle,
  PourForbiddenError,
  PourNotFoundError,
} from "@/domains/pours/pour-service";
import { requireMembership } from "@/lib/api/auth";
import { apiError, Errors } from "@/lib/api/errors";
import { withApiHandler } from "@/lib/api/handler";
import {
  inventoryCommandErrorResponse,
  inventoryResponse,
  requireInventoryOperationId,
  withInventoryHeaders,
} from "@/lib/api/inventory-command";
import { parseJson } from "@/lib/api/validation";
import { getInventoryContractVersion } from "@/domains/pours/physical-bottle-command";

export const runtime = "nodejs";

const LegacyBodySchema = z.strictObject({
  open_bottle_id: z.string().uuid(),
  expected_opened_at: z.string().datetime({ offset: true }),
  actual_remaining_ml: z.number().int().nonnegative().max(2_147_483_647),
  written_off_ml: z.number().int().nonnegative().max(2_147_483_647).default(0),
  reason_code_id: z.string().uuid().optional(),
});
const PhysicalBodySchema = z.strictObject({
  wine_id: z.string().uuid(),
  open_bottle_id: z.string().uuid(),
  actual_remaining_ml: z.number().int().nonnegative().max(2_147_483_647),
  written_off_ml: z.number().int().nonnegative().max(2_147_483_647).default(0),
  reason_code_id: z.string().uuid().optional(),
});

export async function POST(request: NextRequest) {
  return withApiHandler(() => postCloseout(request));
}

async function postCloseout(request: NextRequest) {
  const auth = await requireMembership();
  if (auth instanceof NextResponse) return auth;

  const operationId = requireInventoryOperationId(request);
  if (operationId instanceof NextResponse) return operationId;

  let contractVersion: 1 | 2;
  try {
    contractVersion = await getInventoryContractVersion(auth.supabase);
  } catch (error) {
    const response = inventoryCommandErrorResponse(error, operationId);
    if (response) return response;
    throw error;
  }
  const parsed = await parseJson(
    request,
    contractVersion === 2 ? PhysicalBodySchema : LegacyBodySchema,
    { message: "Invalid body." },
  );
  if (!parsed.ok) return withInventoryHeaders(parsed.response, operationId);
  const body = parsed.data;

  if (body.written_off_ml > 0 && !body.reason_code_id) {
    return withInventoryHeaders(
      apiError(
        422,
        "writeoff_reason_required",
        "A reason code is required for a write-off.",
      ),
      operationId,
    );
  }

  try {
    const outcome = await closeOpenBottle({
      supabase: auth.supabase,
      operationId,
      restaurantId: auth.restaurantId,
      bottleId: body.open_bottle_id,
      wineId: "wine_id" in body ? body.wine_id : undefined,
      contractVersion,
      expectedOpenedAt: "expected_opened_at" in body
        ? body.expected_opened_at
        : undefined,
      actualRemainingMl: body.actual_remaining_ml,
      writtenOffMl: body.written_off_ml,
      reasonCodeId: body.reason_code_id,
    });
    return inventoryResponse(
      { closeout: outcome.closeout },
      201,
      operationId,
      outcome.replayed,
    );
  } catch (error) {
    const response = inventoryCommandErrorResponse(error, operationId);
    if (response) return response;
    return closeLookupError(error, operationId);
  }
}

function closeLookupError(error: unknown, operationId: string): NextResponse {
  if (error instanceof PourNotFoundError) {
    return withInventoryHeaders(
      apiError(404, "open_bottle_not_found", "Open bottle not found."),
      operationId,
    );
  }
  if (error instanceof PourForbiddenError) {
    return withInventoryHeaders(
      Errors.forbidden(
        "This bottle isn't in your restaurant. Refresh the page and try again.",
      ),
      operationId,
    );
  }
  throw error;
}
