import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { readWinePricingStrategy } from "@/lib/staff-cost/protected-readers";

export type SnoozedRow = {
  wine_id: string;
  name: string;
  producer: string;
  vintage: number | null;
  drinkWindowSnoozedUntil: string | null;
  pricingDismissedUntil: string | null;
};

export async function fetchSnoozedAlerts(
  supabase: SupabaseClient<Database>,
  restaurantId: string,
): Promise<SnoozedRow[]> {
  const wines: Array<{
    id: string;
    name: string;
    producer: string;
    vintage: number | null;
    alert_snoozed_until: string | null;
  }> = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from("wines")
      .select("id, name, producer, vintage, alert_snoozed_until")
      .eq("restaurant_id", restaurantId)
      .order("id", { ascending: true })
      .range(from, from + 999);
    if (error) throw error;
    const page = data ?? [];
    wines.push(...page);
    if (page.length < 1000) break;
  }
  if (wines.length === 0) return [];

  const strategies = (
    await Promise.all(
      Array.from({ length: Math.ceil(wines.length / 500) }, (_, index) =>
        readWinePricingStrategy(
          supabase,
          restaurantId,
          wines.slice(index * 500, (index + 1) * 500).map((wine) => wine.id),
        ),
      ),
    )
  ).flat();
  const strategyByWine = new Map(strategies.map((row) => [row.wine_id, row]));
  if (
    strategyByWine.size !== strategies.length ||
    wines.some((wine) => !strategyByWine.has(wine.id))
  ) {
    throw new Error("Wine pricing strategy protected read was incomplete.");
  }

  return toSnoozedRows(
    wines.map((wine) => ({
      ...wine,
      pricing_dismissed_until:
        strategyByWine.get(wine.id)!.pricing_dismissed_until,
    })),
    true,
  );
}

export async function fetchDrinkWindowSnoozedAlerts(
  supabase: SupabaseClient<Database>,
  restaurantId: string,
): Promise<SnoozedRow[]> {
  const nowIso = new Date().toISOString();
  const { data: wines, error } = await supabase
    .from("wines")
    .select("id, name, producer, vintage, alert_snoozed_until")
    .eq("restaurant_id", restaurantId)
    .gt("alert_snoozed_until", nowIso);
  if (error) throw error;

  return toSnoozedRows(wines ?? [], false);
}

function toSnoozedRows(
  wines: Array<{
    id: string;
    name: string;
    producer: string;
    vintage: number | null;
    alert_snoozed_until: string | null;
    pricing_dismissed_until?: string | null;
  }>,
  includePricing: boolean,
): SnoozedRow[] {
  const rows: SnoozedRow[] = (wines ?? [])
    .map(function (w) {
      const dw = w.alert_snoozed_until;
      const pr = includePricing ? w.pricing_dismissed_until ?? null : null;
      const dwActive = dw && new Date(dw).getTime() > Date.now();
      const prActive = pr && new Date(pr).getTime() > Date.now();
      if (!dwActive && !prActive) return null;
      return {
        wine_id: w.id,
        name: w.name,
        producer: w.producer,
        vintage: w.vintage,
        drinkWindowSnoozedUntil: dwActive ? dw : null,
        pricingDismissedUntil: prActive ? pr : null,
      };
    })
    .filter(function (r): r is SnoozedRow { return r !== null; });

  rows.sort(function (a, b) {
    const aSoon = Math.min(
      a.drinkWindowSnoozedUntil
        ? new Date(a.drinkWindowSnoozedUntil).getTime()
        : Infinity,
      a.pricingDismissedUntil
        ? new Date(a.pricingDismissedUntil).getTime()
        : Infinity,
    );
    const bSoon = Math.min(
      b.drinkWindowSnoozedUntil
        ? new Date(b.drinkWindowSnoozedUntil).getTime()
        : Infinity,
      b.pricingDismissedUntil
        ? new Date(b.pricingDismissedUntil).getTime()
        : Infinity,
    );
    if (aSoon !== bSoon) return aSoon - bSoon;
    return a.producer.localeCompare(b.producer);
  });
  return rows;
}
