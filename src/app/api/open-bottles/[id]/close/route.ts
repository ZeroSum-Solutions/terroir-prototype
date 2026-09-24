import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import {
  discardOpenBottle,
  PourForbiddenError,
  PourNotFoundError,
} from "@/domains/pours/pour-service";
import { requireMembership } from "@/lib/api/auth";
import { Errors } from "@/lib/api/errors";
import { withApiHandler } from "@/lib/api/handler";
import {
  inventoryCommandErrorResponse,
  inventoryResponse,
  requireInventoryOperationId,
  withInventoryHeaders,
} from "@/lib/api/inventory-command";
import { parseJson, parseParams } from "@/lib/api/validation";
import { getInventoryContractVersion } from "@/domains/pours/physical-bottle-command";

export const runtime = "nodejs";

const ParamsSchema = z.strictObject({ id: z.string().uuid() });
const LegacyBodySchema = z.strictObject({
  expected_opened_at: z.string().datetime({ offset: true }),
});
const PhysicalBodySchema = z.strictObject({ wine_id: z.string().uuid() });

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  return withApiHandler(() => postCloseBottle(request, params));
}

async function postCloseBottle(
  request: NextRequest,
  params: Promise<{ id: string }>,
) {
  const auth = await requireMembership();
  if (auth instanceof NextResponse) return auth;

  const operationId = requireInventoryOperationId(request);
  if (operationId instanceof NextResponse) return operationId;

  const parsedParams = await parseParams(params, ParamsSchema);
  if (!parsedParams.ok) {
    return withInventoryHeaders(parsedParams.response, operationId);
  }
  let contractVersion: 1 | 2;
  try {
    contractVersion = await getInventoryContractVersion(auth.supabase);
  } catch (error) {
    const response = inventoryCommandErrorResponse(error, operationId);
    if (response) return response;
    throw error;
  }
  const parsedBody = await parseJson(
    request,
    contractVersion === 2 ? PhysicalBodySchema : LegacyBodySchema,
    { message: "Invalid body." },
  );
  if (!parsedBody.ok) return withInventoryHeaders(parsedBody.response, operationId);

  try {
    const outcome = await discardOpenBottle({
      supabase: auth.supabase,
      operationId,
      restaurantId: auth.restaurantId,
      bottleId: parsedParams.data.id,
      wineId: "wine_id" in parsedBody.data ? parsedBody.data.wine_id : undefined,
      contractVersion,
      expectedOpenedAt: "expected_opened_at" in parsedBody.data
        ? parsedBody.data.expected_opened_at
        : undefined,
    });
    return inventoryResponse(
      {
        closed: outcome.closed,
        ...(outcome.eventId ? { discard_event_id: outcome.eventId } : {}),
      },
      200,
      operationId,
      outcome.replayed,
    );
  } catch (error) {
    const response = inventoryCommandErrorResponse(error, operationId);
    if (response) return response;
    if (error instanceof PourNotFoundError) {
      return withInventoryHeaders(Errors.notFound("Bottle"), operationId);
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
}
