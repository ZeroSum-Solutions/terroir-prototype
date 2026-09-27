import { NextResponse, type NextRequest } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { requireRole } from "@/lib/api/auth";
import { z } from "zod";
import { Errors } from "@/lib/api/errors";
import { withApiHandler } from "@/lib/api/handler";
import { parseJson, parseParams } from "@/lib/api/validation";

export const runtime = "nodejs";

type Params = Promise<{ id: string }>;

const ParamsSchema = z.strictObject({ id: z.string().uuid() });

const EditInventorySchema = z.object({
  expected_updated_at: z.iso.datetime({ offset: true }).optional(),
  quantity: z.number().int().min(0).optional(),
  unit_cost: z.number().min(0).optional(),
  bin_location: z.string().trim().max(50).nullable().optional(),
});

const InventoryPatchReceiptSchema = z.strictObject({
  inventoryItemId: z.string().uuid(),
  quantity: z.number().int().min(0),
  updated: z.literal(true),
});

const WineDeleteReceiptSchema = z.strictObject({
  wineId: z.string().uuid(),
  deleted: z.literal(true),
});

const DeleteBodySchema = z.strictObject({
  expected_updated_at: z.iso.datetime({ offset: true }).optional(),
}).default({});

function hasOwn(object: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(object, key);
}

/**
 * PATCH /api/cellar/[id] — edit an inventory item.
 *
 * Role-gated to owner | manager. Staff receives 403.
 * Scoped by restaurant_id (defense-in-depth).
 */
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
    const { id } = parsedParams.data;

    const parsed = await parseJson(request, EditInventorySchema);
    if (!parsed.ok) return parsed.response;
    const { expected_updated_at: expectedUpdatedAt, ...updates } = parsed.data;
    if (Object.keys(updates).length === 0) {
      return Errors.badRequest("No valid fields to update.");
    }

    // Fetch only safe identity/CAS fields. The closed RPC owns the protected
    // update and rechecks the timestamp under row lock.
    const { data: current, error: currentError } = await supabase
      .from("inventory_items")
      .select("id, updated_at, bin_location")
      .eq("id", id)
      .eq("restaurant_id", restaurantId)
      .maybeSingle();

    if (currentError) {
      console.error("inventory_items CAS lookup failed:", currentError);
      Sentry.captureException(currentError, {
        tags: { surface: "cellar", phase: "edit-inventory" },
        extra: { restaurantId, inventory_item_id: id },
      });
      return Errors.internal("Update failed.");
    }
    if (!current) {
      return Errors.notFound("Inventory item");
    }

    const { data: receiptRaw, error } = await supabase.rpc(
      "patch_inventory_item_private",
      {
        p_inventory_item_id: id,
        p_expected_updated_at: expectedUpdatedAt ?? current.updated_at,
        p_set_quantity: hasOwn(updates, "quantity"),
        p_quantity: updates.quantity ?? null,
        p_set_unit_cost: hasOwn(updates, "unit_cost"),
        p_unit_cost: updates.unit_cost ?? null,
        p_set_currency: false,
        p_currency: null,
        p_set_bin_id: false,
        p_bin_id: null,
        p_set_bin_location: hasOwn(updates, "bin_location"),
        p_bin_location: updates.bin_location ?? null,
        p_set_section: false,
        p_section: null,
        p_set_format: false,
        p_format: null,
      },
    );
    if (error) {
      if (error.code === "42501") return Errors.forbidden();
      if (error.message === "inventory_item_stale") {
        return Errors.conflict(
          "inventory_item_stale",
          "Inventory changed before this update. Refresh and try again.",
        );
      }
      Sentry.captureException(error, {
        tags: { surface: "cellar", phase: "edit-inventory" },
        extra: { restaurantId, inventory_item_id: id },
      });
      return Errors.internal("Update failed.");
    }
    const receipt = InventoryPatchReceiptSchema.safeParse(receiptRaw);
    if (!receipt.success || receipt.data.inventoryItemId !== id) {
      Sentry.captureException(new Error("Invalid inventory patch receipt"), {
        tags: { surface: "cellar", phase: "edit-inventory" },
        extra: { restaurantId, inventory_item_id: id },
      });
      return Errors.internal("Update failed.");
    }

    return NextResponse.json({
      id: receipt.data.inventoryItemId,
      quantity: receipt.data.quantity,
      bin_location: hasOwn(updates, "bin_location")
        ? updates.bin_location ?? null
        : current.bin_location,
      updated: true,
    });
  });
}

/**
 * DELETE /api/cellar/[id] — delete a wine from the cellar.
 *
 * Owner-only. The closed database function locks the wine, applies the
 * expected timestamp, checks every protected dependency, and deletes atomically.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Params },
) {
  return withApiHandler(async () => {
    const auth = await requireRole(["owner"]);
    if (auth instanceof NextResponse) return auth;
    const { supabase, restaurantId } = auth;

    const parsedParams = await parseParams(params, ParamsSchema);
    if (!parsedParams.ok) return parsedParams.response;
    const { id: wineId } = parsedParams.data;
    const deleteBody = await parseJson(request, DeleteBodySchema, {
      allowEmpty: true,
      message: "Invalid body.",
    });
    if (!deleteBody.ok) return deleteBody.response;

    // Read only safe identity/CAS state. The definer performs every
    // dependency check and the delete atomically under a row lock.
    const { data: wine, error: lookupError } = await supabase
      .from("wines")
      .select("id, updated_at")
      .eq("id", wineId)
      .eq("restaurant_id", restaurantId)
      .maybeSingle();

    if (lookupError) {
      Sentry.captureException(lookupError, {
        tags: { surface: "cellar", phase: "delete-wine-lookup" },
        extra: { restaurantId, wineId },
      });
      return Errors.internal("Failed to delete wine.");
    }

    if (!wine) {
      return Errors.notFound("Wine");
    }

    const { data: receiptRaw, error: deleteErr } = await supabase.rpc(
      "delete_wine_private",
      {
        p_restaurant_id: restaurantId,
        p_wine_id: wineId,
        p_expected_updated_at:
          deleteBody.data.expected_updated_at ?? wine.updated_at,
      },
    );

    if (deleteErr) {
      if (deleteErr.code === "42501") return Errors.forbidden();
      if (deleteErr.code === "P0002") return Errors.notFound("Wine");
      if (deleteErr.message === "wine_stale") {
        return Errors.conflict(
          "wine_stale",
          "Wine changed before deletion. Refresh and try again.",
        );
      }
      if (deleteErr.message === "wine_has_dependencies") {
        return Errors.conflict(
          "wine_has_dependencies",
          "This wine is still in use and cannot be deleted.",
        );
      }
      Sentry.captureException(deleteErr, {
        tags: { surface: "cellar", phase: "delete-wine" },
        extra: { restaurantId, wineId },
      });
      return Errors.internal("Failed to delete wine.");
    }

    const receipt = WineDeleteReceiptSchema.safeParse(receiptRaw);
    if (!receipt.success || receipt.data.wineId !== wineId) {
      Sentry.captureException(new Error("Invalid wine delete receipt"), {
        tags: { surface: "cellar", phase: "delete-wine" },
        extra: { restaurantId, wineId },
      });
      return Errors.internal("Failed to delete wine.");
    }

    return NextResponse.json(receipt.data);
  });
}
