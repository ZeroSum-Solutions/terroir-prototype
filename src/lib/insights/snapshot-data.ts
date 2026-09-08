import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

type Client = SupabaseClient<Database>;
const PAGE_SIZE = 1000;

export async function readInsightsPages<T>(
  query: (from: number, to: number) => PromiseLike<{
    data: T[] | null;
    error: { message: string } | null;
  }>,
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await query(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    const page = data ?? [];
    rows.push(...page);
    if (page.length < PAGE_SIZE) return rows;
  }
}

export function fetchInsightsInventory(client: Client, restaurantId: string) {
  return readInsightsPages((from, to) => client
    .from("inventory_items")
    .select("quantity, unit_cost, wine_id, wines(varietal)")
    .eq("restaurant_id", restaurantId)
    .order("id")
    .range(from, to));
}

export function fetchInsightsHealth(client: Client, restaurantId: string) {
  return readInsightsPages((from, to) => client
    .from("cellar_health")
    .select("wine_id, segment")
    .eq("restaurant_id", restaurantId)
    .order("wine_id")
    .range(from, to));
}
