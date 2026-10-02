import { NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { requireMembership } from "@/lib/api/auth";
import { Errors } from "@/lib/api/errors";
import { resolveSiteCostReadAccess } from "@/lib/api/site-capability";
import { fetchDistributorPriceRows } from "@/lib/pricing/price-comparison-data";
import type { DistributorPriceRow } from "@/lib/pricing/price-comparison-data";

export const runtime = "nodejs";

export async function GET() {
  const auth = await requireMembership();
  if (auth instanceof NextResponse) return auth;
  const { supabase, restaurantId } = auth;
  const canReadCost = await resolveSiteCostReadAccess(supabase, restaurantId);
  if (!canReadCost) {
    return Errors.forbidden(
      "Cost access is required to compare distributor prices.",
    );
  }

  let items: DistributorPriceRow[];
  try {
    items = await fetchDistributorPriceRows(supabase, restaurantId);
  } catch (error) {
    console.error("price-comparison query failed:", error);
    Sentry.captureException(error, {
      tags: { surface: "wines-price-comparison", phase: "fetch" },
      extra: { restaurantId },
    });
    return NextResponse.json(
      { error: "Failed to fetch price data." },
      { status: 500 },
    );
  }

  // Group by wine, then by distributor
  const wineMap = new Map<
    string,
    {
      wine: { id: string; name: string; producer: string; vintage: number | null; varietal: string | null };
      prices: Array<{
        distributor: string;
        unitCost: number;
        quantity: number;
        invoiceDate: string | null;
      }>;
    }
  >();

  for (const item of items) {
    const { wine, scan } = item;

    let entry = wineMap.get(wine.id);
    if (!entry) {
      entry = { wine, prices: [] };
      wineMap.set(wine.id, entry);
    }

    entry.prices.push({
      distributor: scan.distributor_name,
      unitCost: item.unitCost,
      quantity: item.quantity,
      invoiceDate: scan.invoice_date,
    });
  }

  // Convert to array, sort by producer then name
  const result = [...wineMap.values()]
    .map((entry) => {
      const sorted = entry.prices.sort((a, b) => a.unitCost - b.unitCost);
      const cheapest = sorted[0]?.unitCost ?? 0;
      const mostExpensive = sorted[sorted.length - 1]?.unitCost ?? 0;
      const spread =
        cheapest > 0 ? (mostExpensive - cheapest) / cheapest : 0;
      const distributorCount = new Set(sorted.map((p) => p.distributor)).size;

      return {
        ...entry,
        cheapest,
        mostExpensive,
        spread,
        distributorCount,
      };
    })
    .sort((a, b) => {
      const cmp = a.wine.producer.localeCompare(b.wine.producer);
      return cmp !== 0 ? cmp : a.wine.name.localeCompare(b.wine.name);
    });

  return NextResponse.json(result);
}
