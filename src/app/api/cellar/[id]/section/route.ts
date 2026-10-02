import { NextResponse, type NextRequest } from "next/server";
import { requireRole } from "@/lib/api/auth";
import { z } from "zod";
import { Errors } from "@/lib/api/errors";
import { withApiHandler } from "@/lib/api/handler";
import { parseJson, parseParams } from "@/lib/api/validation";
import { parseWineSectionAssignmentReceipt } from "@/lib/staff-cost/wine-section-assignment";

export const runtime = "nodejs";

type Params = Promise<{ id: string }>;

const ParamsSchema = z.strictObject({ id: z.string().uuid() });

// A wine can legitimately be moved BACK to "no section" — that is what the
// Uncategorized group in the cellar list is. The old `.min(1)` rejected the
// empty string the client sends for that drop with a 400, so every drag into
// Uncategorized was rolled back and read as "the move did not stick"
// (CELLAR-04). `null` and `""` both mean "clear it".
const SectionSchema = z.object({
  section: z.string().trim().max(100).nullable(),
});

/**
 * PATCH /api/cellar/[id]/section — reassign a wine to a different cellar section.
 *
 * Role-gated to owner | manager. Updates all inventory_items for the
 * wine within the caller's restaurant.
 * BND-063 — drag-and-drop wine between sections.
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
    const { id: wineId } = parsedParams.data;

    const parsed = await parseJson(request, SectionSchema);
    if (!parsed.ok) return parsed.response;
    const section = parsed.data.section === "" ? null : parsed.data.section;

    let result;
    try {
      result = await supabase.rpc("assign_wine_sections_private", {
        p_restaurant_id: restaurantId,
        p_wine_ids: [wineId],
        p_section: section,
      });
    } catch {
      throw new Error("Wine section assignment call failed.");
    }
    const { data, error } = result;

    if (error) {
      if (error.code === "P04W1") return Errors.notFound("Wine");
      if (error.code === "42501") return Errors.forbidden();
      throw new Error("Wine section assignment failed.");
    }

    const receipt = parseWineSectionAssignmentReceipt(data, 1, section);
    if (!receipt) {
      throw new Error("Wine section assignment returned an invalid receipt.");
    }

    return NextResponse.json({ wine_id: wineId, section: receipt.section });
  });
}
