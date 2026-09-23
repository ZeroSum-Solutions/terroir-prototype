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

export const runtime = "nodejs";

const ParamsSchema = z.strictObject({ id: z.string().uuid() });
const BodySchema = z.strictObject({
  expected_opened_at: z.string().datetime({ offset: true }),
});

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
  const parsedBody = await parseJson(request, BodySchema, { message: "Invalid body." });
  if (!parsedBody.ok) return withInventoryHeaders(parsedBody.response, operationId);

  try {
    const outcome = await discardOpenBottle({
      supabase: auth.supabase,
      operationId,
      restaurantId: auth.restaurantId,
      bottleId: parsedParams.data.id,
      expectedOpenedAt: parsedBody.data.expected_opened_at,
    });
    return inventoryResponse(
      { closed: outcome.closed },
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
