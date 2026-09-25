import { NextResponse, type NextRequest } from "next/server";
import { Errors } from "@/lib/api/errors";
import { z } from "zod";
import {
  ReconcileExceedsSizeError,
  ReconcileForbiddenError,
  ReconcileRpcError,
  reconcileOpenBottles,
  reconcilePhysicalBottles,
} from "@/domains/cellar/reconcile-service";
import { normalizePostgresUuid } from "@/domains/cellar/reconcile-contract";
import { InventoryCommandError } from "@/domains/pours/inventory-command";
import { getInventoryContractVersion } from "@/domains/pours/physical-bottle-command";
import { requireRole } from "@/lib/api/auth";
import { withApiHandler } from "@/lib/api/handler";
import {
  inventoryCommandErrorResponse,
  inventoryResponse,
  requireInventoryOperationId,
  withInventoryHeaders,
} from "@/lib/api/inventory-command";
import { parseJson } from "@/lib/api/validation";

export const runtime = "nodejs";

const EntrySchema = z.strictObject({
  wine_id: z.string().uuid(),
  // Upper bound is a sanity check against garbage (20L = larger than any
  // real bottle — Imperial is 6L). The per-wine size_ml check lives in
  // the RPC and raises P0002 → 400 EXCEEDS_SIZE.
  new_remaining_ml: z.number().int().min(0).max(20000),
  note: z.string().trim().max(500).optional(),
});

const BodySchema = z.object({
  entries: z.array(EntrySchema).min(1).max(100),
});
const PhysicalEntrySchema = z.strictObject({
  open_bottle_id: z.string().uuid(),
  expected_state_version: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER - 1),
  target_remaining_ml: z.number().int().nonnegative().max(2_147_483_647),
  note: z.string().trim().max(500).nullable(),
});
const PhysicalBodySchema = z.strictObject({
  entries: z.array(PhysicalEntrySchema).min(1).max(100),
}).superRefine((body, context) => {
  const ids = body.entries.map((entry) => entry.open_bottle_id.toLowerCase());
  if (new Set(ids).size !== ids.length) {
    context.addIssue({ code: "custom", path: ["entries"], message: "Duplicate bottle ID." });
  }
});

/**
 * POST /api/reconcile
 *
 * Version 1 preserves the wine-keyed legacy batch. Version 2 requires one
 * caller-owned operation UUID and dispatches one exact-bottle atomic batch.
 *
 * Role-gated to owner | manager via requireRole (endpoint-level 403 for staff).
 * The RPC also enforces role as defense-in-depth.
 *
 * 200: { updated: N }
 * 400: invalid key/body / empty entries / > 100 entries
 * 401: unauthenticated (from requireRole)
 * 403: role mismatch (staff rejected at endpoint; manager/owner required)
 * 500: unhandled RPC failure
 */
export async function POST(request: NextRequest) {
  return withApiHandler(() => postReconcile(request));
}

async function postReconcile(request: NextRequest) {
  const auth = await requireRole(["owner", "manager"]);
  if (auth instanceof NextResponse) return auth;
  const { supabase, restaurantId } = auth;

  let contractVersion: 1 | 2;
  try {
    contractVersion = await getInventoryContractVersion(supabase);
  } catch (error) {
    const supplied = requireInventoryOperationId(request);
    if (typeof supplied === "string") {
      const response = inventoryCommandErrorResponse(error, supplied);
      if (response) return response;
    }
    if (error instanceof InventoryCommandError) {
      return Errors.internal("Inventory command failed.");
    }
    throw error;
  }

  const suppliedOperationId = contractVersion === 2
    ? requireInventoryOperationId(request)
    : null;
  if (suppliedOperationId instanceof NextResponse) return suppliedOperationId;
  const operationId = suppliedOperationId
    ? normalizePostgresUuid(suppliedOperationId)
    : null;

  const parsed = await parseJson(
    request,
    contractVersion === 2 ? PhysicalBodySchema : BodySchema,
    {
    message: "Invalid body.",
    },
  );
  if (!parsed.ok) {
    return operationId ? withInventoryHeaders(parsed.response, operationId) : parsed.response;
  }

  try {
    if (contractVersion === 2) {
      const physicalBody = PhysicalBodySchema.parse(parsed.data);
      const outcome = await reconcilePhysicalBottles({
        supabase,
        operationId: operationId!,
        restaurantId,
        entries: physicalBody.entries,
      });
      return inventoryResponse({
        operation_id: outcome.operationId,
        command: "reconcile_batch",
        entries: outcome.entries.map((entry) => ({
          entry_ordinal: entry.entryOrdinal,
          open_bottle_id: entry.openBottleId,
          wine_id: entry.wineId,
          pour_event_id: entry.pourEventId,
          remaining_ml: entry.remainingMl,
          state_version: entry.stateVersion,
        })),
      }, 200, operationId!, outcome.replayed);
    }
    const updated = await reconcileOpenBottles({
      supabase,
      restaurantId,
      entries: BodySchema.parse(parsed.data).entries,
    });
    return NextResponse.json({ updated });
  } catch (error) {
    if (operationId) {
      if (error instanceof InventoryCommandError &&
        error.message === "reconciliation_batch_stale") {
        return withInventoryHeaders(Errors.conflict(
          "reconciliation_batch_stale",
          "One or more bottles changed. Refresh before starting a new reconciliation.",
        ), operationId);
      }
      const response = inventoryCommandErrorResponse(error, operationId);
      if (response) return response;
    }
    if (error instanceof ReconcileForbiddenError) {
      return Errors.forbidden(
        "One or more of these wines aren't in your restaurant. Refresh the page and try again.",
      );
    }
    if (error instanceof ReconcileExceedsSizeError) {
      // "new_remaining_ml exceeds bottle size" — caller sent a bad
      // value. Surface as 400 so the UI can show "that's more than a
      // 750ml bottle can hold."
      return Errors.badRequest("new_remaining_ml exceeds bottle size.", undefined, "EXCEEDS_SIZE");
    }
    if (error instanceof ReconcileRpcError) {
      return Errors.internal("Reconcile failed.");
    }
    throw error;
  }
}
