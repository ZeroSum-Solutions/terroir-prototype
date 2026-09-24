import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { recordPour } from "@/domains/pours/pour-service";
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
  open_bottle_id: z.string().uuid().optional(),
  ml: z.number().int().positive().max(2000),
  kind: z.enum(["pour", "spill"]).default("pour"),
  note: z.string().trim().max(500).optional(),
  preservation_method: z.enum(PRESERVATION_METHODS).optional(),
});

export async function POST(request: NextRequest) {
  return withApiHandler(() => postPour(request));
}

async function postPour(request: NextRequest) {
  const auth = await requireMembership();
  if (auth instanceof NextResponse) return auth;

  const operationId = requireInventoryOperationId(request);
  if (operationId instanceof NextResponse) return operationId;

  const parsed = await parseJson(request, BodySchema, {
    message: "Invalid body.",
  });
  if (!parsed.ok) return withInventoryHeaders(parsed.response, operationId);

  try {
    const outcome = await recordPour({
      supabase: auth.supabase,
      operationId,
      restaurantId: auth.restaurantId,
      wineId: parsed.data.wine_id,
      openBottleId: parsed.data.open_bottle_id,
      ml: parsed.data.ml,
      kind: parsed.data.kind,
      note: parsed.data.note,
      preservationMethod: parsed.data.preservation_method,
    });
    return inventoryResponse(
      { open_bottle: outcome.openBottle },
      200,
      operationId,
      outcome.replayed,
    );
  } catch (error) {
    const response = inventoryCommandErrorResponse(error, operationId);
    if (response) return response;
    throw error;
  }
}
