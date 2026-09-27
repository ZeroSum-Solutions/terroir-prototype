import { NextResponse, type NextRequest } from "next/server";
import { requireRole } from "@/lib/api/auth";
import { z } from "zod";
import { Errors } from "@/lib/api/errors";
import { withApiHandler } from "@/lib/api/handler";
import { parseWineSectionAssignmentReceipt } from "@/lib/staff-cost/wine-section-assignment";

export const runtime = "nodejs";

const BatchSectionSchema = z.object({
  wine_ids: z.array(z.string().uuid()).min(1).max(200),
  section: z.string().trim().min(1).max(100),
});

/**
 * POST /api/cellar/batch-section — bulk-assign wines to a cellar section.
 *
 * Role-gated to owner | manager. Updates all inventory_items for the
 * given wines within the caller's restaurant in a single operation.
 * BND-064 — bulk-assign wines to a section.
 */
export async function POST(request: NextRequest) {
  return withApiHandler(async () => {
    const auth = await requireRole(["owner", "manager"]);
    if (auth instanceof NextResponse) return auth;
    const { supabase, restaurantId } = auth;

    let raw: unknown;
    try {
      raw = await request.json();
    } catch {
      return Errors.badRequest("Invalid JSON.");
    }

    const parsed = BatchSectionSchema.safeParse(raw);
    if (!parsed.success) {
      return Errors.validation(parsed.error.issues, "Invalid input.");
    }

    const { wine_ids, section } = parsed.data;

    let result;
    try {
      result = await supabase.rpc("assign_wine_sections_private", {
        p_restaurant_id: restaurantId,
        p_wine_ids: wine_ids,
        p_section: section,
      });
    } catch {
      throw new Error("Batch wine section assignment call failed.");
    }
    const { data, error } = result;

    if (error) {
      if (error.code === "P04W1") {
        return Errors.badRequest(
          "One or more wines not found in your restaurant.",
        );
      }
      if (error.code === "42501") return Errors.forbidden();
      throw new Error("Batch wine section assignment failed.");
    }

    const receipt = parseWineSectionAssignmentReceipt(
      data,
      wine_ids.length,
      section,
    );
    if (!receipt) {
      throw new Error(
        "Batch wine section assignment returned an invalid receipt.",
      );
    }

    return NextResponse.json({
      updated: receipt.requestedWineCount,
      section: receipt.section,
    });
  });
}
