import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { openBottle } from "@/domains/pours/pour-service";
import { requireMembership } from "@/lib/api/auth";
import { withApiHandler } from "@/lib/api/handler";
import {
  inventoryCommandErrorResponse,
  inventoryResponse,
  requireInventoryOperationId,
  withInventoryHeaders,
} from "@/lib/api/inventory-command";
import { parseJson } from "@/lib/api/validation";
import { PRESERVATION_METHODS } from "@/lib/partial-bottles/math";

export const runtime = "nodejs";

const BodySchema = z.strictObject({
  wine_id: z.string().uuid(),
  preservation_method: z.enum(PRESERVATION_METHODS).default("none"),
});

/**
 * Opens one sealed bottle through the atomic inventory-command RPC.
 * The caller owns the operation UUID so a lost response can be replayed.
 */
export async function POST(request: NextRequest) {
  return withApiHandler(() => postOpenBottle(request));
}

async function postOpenBottle(request: NextRequest) {
  const auth = await requireMembership();
  if (auth instanceof NextResponse) return auth;

  const operationId = requireInventoryOperationId(request);
  if (operationId instanceof NextResponse) return operationId;

  const parsed = await parseJson(request, BodySchema, {
    message: "Invalid body.",
  });
  if (!parsed.ok) return withInventoryHeaders(parsed.response, operationId);

  try {
    const outcome = await openBottle({
      supabase: auth.supabase,
      operationId,
      restaurantId: auth.restaurantId,
      wineId: parsed.data.wine_id,
      preservationMethod: parsed.data.preservation_method,
    });
    return inventoryResponse(
      { open_bottle: outcome.openBottle },
      201,
      operationId,
      outcome.replayed,
    );
  } catch (error) {
    const response = inventoryCommandErrorResponse(error, operationId);
    if (response) return response;
    throw error;
  }
}
