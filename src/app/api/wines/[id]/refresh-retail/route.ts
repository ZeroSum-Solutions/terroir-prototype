import { NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { requireMembership } from "@/lib/api/auth";
import { Errors } from "@/lib/api/errors";
import { resolveSiteCostReadAccess } from "@/lib/api/site-capability";
import { readInventoryCosts } from "@/lib/staff-cost/protected-readers";
import { isRetailPlausible } from "@/lib/pricing/status";
import {
  fetchRetailPrices,
  formatRetailPriceBasis,
} from "@/lib/wine-intelligence/wine-searcher";

export const runtime = "nodejs";

/**
 * BND-040 — POST /api/wines/[id]/refresh-retail
 *
 * Single-wine retail-cache refresh. Calls Wine-Searcher (LWIN-keyed),
 * writes true-median results to wines.retail_* columns, and returns
 * average-only results with an explicit non-persisted label.
 *
 * Auth: owner+manager only — pricing intelligence burns Wine-Searcher
 * trial-tier quota fast under staff misuse (architect finding 8).
 */
export async function POST(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const auth = await requireMembership();
  if (auth instanceof NextResponse) return auth;
  const { supabase, restaurantId, role } = auth;

  if (role !== "owner" && role !== "manager") {
    return Errors.forbidden("Refreshing retail data requires owner or manager role.");
  }

  const { id } = await ctx.params;
  if (!id) {
    return Errors.badRequest("wine id required");
  }

  // LWIN and the persisted retail observations are cost-free wine fields.
  const { data: wine, error: fetchErr } = await supabase
    .from("wines")
    .select("id, lwin_id")
    .eq("id", id)
    .eq("restaurant_id", restaurantId)
    .single();

  if (fetchErr || !wine) {
    return Errors.notFound("Wine");
  }

  if (!wine.lwin_id) {
    return NextResponse.json(
      {
        wineId: wine.id,
        refreshed: false,
        reason: "no_lwin",
        costSanityCheck: "not_applicable",
        message: "This wine isn't matched to LWIN yet. Run cellar enrichment to attempt a match.",
      },
      { status: 200 },
    );
  }

  let canReadCost: boolean;
  try {
    canReadCost = await resolveSiteCostReadAccess(supabase, restaurantId);
  } catch {
    Sentry.captureMessage("Retail refresh cost authorization check failed", {
      level: "error",
      tags: { surface: "wines-refresh-retail", phase: "cost-authorization" },
      extra: { wineId: id, restaurantId },
    });
    return Errors.internal("Cost authorization check failed.");
  }

  let invoiceCost: number | null = null;
  if (canReadCost) {
    try {
      const costRows = await readInventoryCosts(supabase, restaurantId, [id]);
      invoiceCost = costRows.at(-1)?.unit_cost ?? null;
    } catch {
      Sentry.captureMessage("Retail refresh private cost lookup failed", {
        level: "error",
        tags: { surface: "wines-refresh-retail", phase: "cost-read" },
        extra: { wineId: id, restaurantId },
      });
      return Errors.internal("Cost lookup failed.");
    }
  }

  const costSanityCheck = !canReadCost
    ? "restricted"
    : invoiceCost == null
      ? "unavailable"
      : "applied";

  // Never pass acquisition cost to the provider wrapper: its failure telemetry
  // is intentionally general-purpose. Apply the optional cost check locally so
  // a pricing operator without cost.read can still refresh public observations.
  const result = await fetchRetailPrices({ lwinId: wine.lwin_id });
  const failedCostSanity =
    result != null &&
    invoiceCost != null &&
    !isRetailPlausible(result.retailMedian, invoiceCost);

  if (failedCostSanity) {
    Sentry.captureMessage("Wine-Searcher response failed cost sanity filter", {
      level: "warning",
      tags: { surface: "wines-refresh-retail", phase: "cost-sanity-filter" },
      extra: { wineId: id, restaurantId },
    });
  }

  if (!result || failedCostSanity) {
    // Provider/config/schema failures are logged by wine-searcher.ts; a local
    // cost rejection is logged above without exporting its protected inputs.
    return NextResponse.json(
      {
        wineId: wine.id,
        refreshed: false,
        reason: "unavailable",
        costSanityCheck,
        message: "Pricing data unavailable for this wine. Try again later.",
      },
      { status: 200 },
    );
  }

  if (result.retailMedianBasis === "average") {
    // The frozen schema has no basis column, so never persist an average in
    // retail_median. Return the value under an honest, non-persisted label.
    return NextResponse.json({
      wineId: wine.id,
      refreshed: false,
      reason: "average_only",
      costSanityCheck,
      message: "Only an avg-based retail price was available; it was not saved as a median.",
      retail: {
        min: result.retailMin,
        max: result.retailMax,
        referencePrice: result.retailMedian,
        referencePriceBasis: result.retailMedianBasis,
        referencePriceLabel: formatRetailPriceBasis(result.retailMedianBasis),
        retailerCount: result.retailerCount,
        refreshedAt: result.refreshedAt.toISOString(),
      },
    });
  }

  const { error: writeErr } = await supabase
    .from("wines")
    .update({
      retail_min: result.retailMin,
      retail_max: result.retailMax,
      retail_median: result.retailMedian,
      retail_retailer_count: result.retailerCount,
      retail_refreshed_at: result.refreshedAt.toISOString(),
    })
    .eq("id", id)
    .eq("restaurant_id", restaurantId);

  if (writeErr) {
    Sentry.captureException(writeErr, {
      tags: { surface: "wines-refresh-retail", phase: "db-write" },
      extra: { wineId: id, restaurantId },
    });
    return Errors.internal("Failed to write retail data.");
  }

  return NextResponse.json({
    wineId: wine.id,
    refreshed: true,
    costSanityCheck,
    retail: {
      min: result.retailMin,
      max: result.retailMax,
      median: result.retailMedian,
      medianBasis: result.retailMedianBasis,
      medianLabel: formatRetailPriceBasis(result.retailMedianBasis),
      retailerCount: result.retailerCount,
      refreshedAt: result.refreshedAt.toISOString(),
    },
  });
}
