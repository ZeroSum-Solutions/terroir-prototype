import { NextResponse, type NextRequest } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { Errors } from "@/lib/api/errors";
import { z } from "zod";
import { requireRole } from "@/lib/api/auth";
import { enrichWine } from "@/lib/wine-intelligence/enrich";

export const runtime = "nodejs";

const AddWineSchema = z.object({
  name: z.string().trim().min(1).max(200),
  producer: z.string().trim().min(1).max(200),
  vintage: z.number().int().min(1900).max(2100).nullable().optional(),
  varietal: z.string().trim().max(100).nullable().optional(),
  region: z.string().trim().max(100).nullable().optional(),
  country: z.string().trim().max(100).nullable().optional(),
  quantity: z.number().int().min(1).default(1),
  unit_cost: z.number().min(0).optional(),
});

const InventoryCreateReceiptSchema = z.strictObject({
  inventoryItemId: z.string().uuid(),
  quantity: z.number().int().min(0),
  updated: z.literal(true),
});

function buildEnrichmentMetadata(result: ReturnType<typeof enrichWine>) {
  const fields: string[] = [];
  if (result.drinkWindowStart != null || result.drinkWindowEnd != null) fields.push("drink_window");
  if (result.servingTempMin != null || result.servingTempMax != null || result.servingTempLabel != null) fields.push("serving_temp");
  if (result.decantMinutes != null) fields.push("decant");
  if (result.peakYear != null) fields.push("peak_year");
  if (result.ratingSource != null) fields.push("rating_source");
  if (result.reviewExcerpt != null) fields.push("review_excerpt");
  return {
    source: "rule_engine",
    fields_enriched: fields,
    enriched_at: new Date().toISOString(),
  };
}

/**
 * POST /api/cellar — add a wine to the cellar inventory.
 *
 * Role-gated to owner/manager.
 * Creates the wine via find_or_create_wines_batch, inserts an
 * inventory_items row with added_via = "manual", and triggers
 * rule-engine enrichment for the new wine.
 */
export async function POST(request: NextRequest) {
  const auth = await requireRole(["owner", "manager"]);
  if (auth instanceof NextResponse) return auth;
  const { supabase, restaurantId } = auth;

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return Errors.badRequest("Invalid JSON.");
  }

  const parsed = AddWineSchema.safeParse(raw);
  if (!parsed.success) {
    return Errors.validation(parsed.error.issues, "Invalid input.");
  }

  const { name, producer, vintage, varietal, region, country, quantity, unit_cost } =
    parsed.data;

  // Create the wine via the DB function
  const { data: wineIdArray, error: batchError } = await supabase.rpc(
    "find_or_create_wines_batch",
    {
      p_restaurant_id: restaurantId,
      p_wines: [
        {
          name,
          producer,
          vintage: vintage ?? null,
          varietal: varietal ?? null,
          region: region ?? null,
          country: country ?? null,
          size_ml: 750,
        },
      ],
    },
  );

  if (batchError || !wineIdArray?.[0]) {
    console.error("find_or_create_wines_batch failed:", batchError);
    Sentry.captureException(
      batchError ?? new Error("find_or_create_wines_batch returned empty"),
      {
        tags: { surface: "cellar", phase: "add-wine-batch" },
        extra: { restaurantId, name, producer },
      },
    );
    return Errors.internal("Failed to create wine.");
  }

  const wineId = (wineIdArray as string[])[0];

  // The closed definer owns the protected cost-bearing insert. Omission maps
  // to zero here; AddWineSchema rejects an explicit null before this call.
  const { data: inventoryReceiptRaw, error: inventoryError } = await supabase.rpc(
    "create_inventory_item_private",
    {
      p_restaurant_id: restaurantId,
      p_wine_id: wineId,
      p_quantity: quantity,
      p_unit_cost: unit_cost ?? 0,
      p_currency: null,
      p_bin_id: null,
      p_bin_location: null,
      p_section: null,
      p_format: null,
      p_invoice_scan_id: null,
      p_added_via: "manual",
    },
  );
  const inventoryReceipt = InventoryCreateReceiptSchema.safeParse(
    inventoryReceiptRaw,
  );

  if (inventoryError || !inventoryReceipt.success) {
    console.error("create_inventory_item_private failed:", inventoryError);
    Sentry.captureException(
      inventoryError ?? new Error("Invalid inventory create receipt"),
      {
        tags: { surface: "cellar", phase: "add-wine-inventory" },
        extra: { restaurantId, wineId },
      },
    );
    return Errors.internal("Failed to add wine to inventory.");
  }

  // BND-261: trigger rule-engine enrichment for the newly imported wine.
  // Fire-and-forget best-effort — enrichment failures do not block the
  // response (the wine is already safely created).
  try {
    const result = enrichWine({ varietal: varietal ?? null, region: region ?? null, country: country ?? null, vintage: vintage ?? null });
    if (result.drinkWindowStart != null || result.servingTempMin != null) {
      const metadata = buildEnrichmentMetadata(result);
      await supabase.rpc("enrich_wines_batch", {
        p_restaurant_id: restaurantId,
        p_enrichments: [{
          id: wineId,
          drink_window_start: result.drinkWindowStart,
          drink_window_end: result.drinkWindowEnd,
          peak_year: result.peakYear,
          rating: null,
          rating_source: result.ratingSource ?? null,
          review_excerpt: result.reviewExcerpt ?? null,
          serving_temp_min: result.servingTempMin,
          serving_temp_max: result.servingTempMax,
          serving_temp_label: result.servingTempLabel ?? null,
          decant_minutes: result.decantMinutes ?? null,
          enrichment_metadata: metadata,
        }],
      });
    }
  } catch {
    // Best-effort: don't fail the request if enrichment fails.
  }

  // BND-093: match new wines against LWIN catalog
  try {
    await supabase.rpc("match_lwin_batch", {
      p_wine_ids: [wineId],
    });
  } catch {
    // Best-effort: don't fail the request if LWIN matching fails.
  }

  return NextResponse.json({
    wineId,
    inventoryId: inventoryReceipt.data.inventoryItemId,
    quantity: inventoryReceipt.data.quantity,
    updated: true,
  });
}
