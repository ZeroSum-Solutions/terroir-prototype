import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

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
  const nowIso = new Date().toISOString();
  const { data: wines, error } = await supabase
    .from("wines")
    .select(
      "id, name, producer, vintage, alert_snoozed_until, pricing_dismissed_until",
    )
    .eq("restaurant_id", restaurantId)
    .or(
      `alert_snoozed_until.gt.${nowIso},pricing_dismissed_until.gt.${nowIso}`,
    );
  if (error) throw error;

  return toSnoozedRows(wines ?? [], true);
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
