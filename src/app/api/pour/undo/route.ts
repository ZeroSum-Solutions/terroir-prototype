import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { InventoryCommandError } from "@/domains/pours/inventory-command";
import {
  PourForbiddenError,
  PourNotFoundError,
  PourNotReversibleError,
  PourRpcError,
  undoLastPour,
} from "@/domains/pours/pour-service";
import { getInventoryContractVersion } from "@/domains/pours/physical-bottle-command";
import { requireMembership } from "@/lib/api/auth";
import { Errors } from "@/lib/api/errors";
import { withApiHandler } from "@/lib/api/handler";
import {
  inventoryCommandErrorResponse,
  inventoryResponse,
  requireInventoryOperationId,
  withInventoryHeaders,
} from "@/lib/api/inventory-command";
import { parseJson } from "@/lib/api/validation";

export const runtime = "nodejs";

const LegacyBodySchema = z.object({ wine_id: z.string().uuid() });
const PhysicalBodySchema = z.strictObject({
  wine_id: z.string().uuid(),
  open_bottle_id: z.string().uuid(),
  reversal_of_event_id: z.string().uuid(),
  correction_reason: z.literal("mistaken_report").optional(),
  operator_confirms_same_bottle_present: z.literal(true).optional(),
}).superRefine((body, context) => {
  if ((body.correction_reason === undefined) !==
    (body.operator_confirms_same_bottle_present === undefined)) {
    context.addIssue({
      code: "custom",
      message: "Discard correction requires both affirmations.",
    });
  }
});

export async function POST(request: NextRequest) {
  return withApiHandler(() => postUndo(request));
}

async function postUndo(request: NextRequest) {
  const auth = await requireMembership();
  if (auth instanceof NextResponse) return auth;
  const { supabase, restaurantId } = auth;

  let contractVersion: 1 | 2;
  try {
    contractVersion = await getInventoryContractVersion(supabase);
  } catch (error) {
    const providedOperationId = requireInventoryOperationId(request);
    if (typeof providedOperationId === "string") {
      const response = inventoryCommandErrorResponse(error, providedOperationId);
      if (response) return response;
    }
    if (error instanceof InventoryCommandError) {
      return Errors.internal("Inventory command failed.");
    }
    throw error;
  }
  const operationId = contractVersion === 2
    ? requireInventoryOperationId(request)
    : null;
  if (operationId instanceof NextResponse) return operationId;

  const parsed = await parseJson(
    request,
    contractVersion === 2 ? PhysicalBodySchema : LegacyBodySchema,
    { message: "Invalid body." },
  );
  if (!parsed.ok) {
    return operationId
      ? withInventoryHeaders(parsed.response, operationId)
      : parsed.response;
  }

  try {
    const physicalData = contractVersion === 2
      ? PhysicalBodySchema.parse(parsed.data)
      : null;
    const outcome = await undoLastPour({
      supabase, restaurantId, wineId: parsed.data.wine_id, contractVersion,
      ...(physicalData ? {
        operationId: operationId!,
        expectedOpenBottleId: physicalData.open_bottle_id,
        reversalOfEventId: physicalData.reversal_of_event_id,
        correctionReason: physicalData.correction_reason,
        operatorConfirmsSameBottlePresent:
          physicalData.operator_confirms_same_bottle_present,
      } : {}),
    });
    return operationId
      ? inventoryResponse({
          open_bottle: outcome.openBottle,
          undo_event_id: outcome.eventId,
        }, 200, operationId, outcome.replayed)
      : NextResponse.json({ open_bottle: outcome.openBottle });
  } catch (error) {
    if (operationId && error instanceof InventoryCommandError) {
      const undoResponse = physicalUndoError(error.message);
      if (undoResponse) return withInventoryHeaders(undoResponse, operationId);
      const response = inventoryCommandErrorResponse(error, operationId);
      if (response) return response;
    }
    if (error instanceof PourNotFoundError) {
      return Errors.notFound("Pour to undo");
    }
    if (error instanceof PourForbiddenError) {
      return Errors.forbidden(
        "This wine isn't in your restaurant. Refresh the page and try again.",
      );
    }
    if (error instanceof PourNotReversibleError) {
      return Errors.conflict(
        "undo_not_reversible",
        "Cannot safely undo this pour; ask a manager to reconcile.",
      );
    }
    if (error instanceof PourRpcError) {
      return Errors.internal("Undo failed.");
    }
    throw error;
  }
}

function physicalUndoError(message: string): NextResponse | null {
  switch (message.trim()) {
    case "undo_window_expired":
      return Errors.conflict(
        "undo_window_expired",
        "The 15-minute Undo window has expired. Ask a manager to reconcile.",
      );
    case "undo_already_applied":
      return Errors.conflict(
        "undo_already_applied",
        "This event was already undone.",
      );
    case "undo_requires_review":
      return Errors.conflict(
        "undo_requires_review",
        "This event cannot be undone safely. Ask a manager to reconcile.",
      );
    default:
      return null;
  }
}
