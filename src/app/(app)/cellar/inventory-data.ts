import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

const FETCH_PAGE_SIZE = 1000;

export type CellarInventoryRow = {
  wine_id: string;
  bin_id: string | null;
  bin_location: string | null;
  quantity: number;
  added_at: string;
  section: string | null;
  unit_cost?: number | null;
};

async function fetchAll(
  makeQuery: (from: number, to: number) => PromiseLike<{
    data: CellarInventoryRow[] | null;
    error: { message: string } | null;
  }>,
): Promise<CellarInventoryRow[]> {
  const rows: CellarInventoryRow[] = [];
  for (let from = 0; ; from += FETCH_PAGE_SIZE) {
    const { data, error } = await makeQuery(from, from + FETCH_PAGE_SIZE - 1);
    if (error) throw error;
    const page = data ?? [];
    rows.push(...page);
    if (page.length < FETCH_PAGE_SIZE) return rows;
  }
}

/** Selects raw invoice cost only after this request proves cost.read. */
export function fetchCellarInventoryRows(
  supabase: SupabaseClient<Database>,
  restaurantId: string,
  canReadCost: boolean,
): Promise<CellarInventoryRow[]> {
  if (canReadCost) {
    return fetchAll((from, to) =>
      supabase
        .from("inventory_items")
        .select("wine_id, bin_id, bin_location, quantity, unit_cost, added_at, section")
        .eq("restaurant_id", restaurantId)
        .order("added_at", { ascending: false })
        .order("id", { ascending: true })
        .range(from, to),
    );
  }

  return fetchAll((from, to) =>
    supabase
      .from("inventory_items")
      .select("wine_id, bin_id, bin_location, quantity, added_at, section")
      .eq("restaurant_id", restaurantId)
      .order("added_at", { ascending: false })
      .order("id", { ascending: true })
      .range(from, to),
  );
}
