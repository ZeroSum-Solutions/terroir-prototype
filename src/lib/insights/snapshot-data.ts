import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

type Client = SupabaseClient<Database>;
type InvoiceScan = Database["public"]["Tables"]["invoice_scans"]["Row"];
type SafeScan = Pick<
  InvoiceScan,
  "id" | "distributor_name" | "item_count" | "accuracy_score" | "created_at"
>;
export type InsightsScan = SafeScan & Pick<InvoiceScan, "final_line_items">;
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

export function fetchInsightsStock(client: Client, restaurantId: string) {
  return readInsightsPages((from, to) => client
    .from("inventory_items")
    .select("quantity, wine_id")
    .eq("restaurant_id", restaurantId)
    .order("id")
    .range(from, to));
}

export async function fetchInsightsScans(
  client: Client,
  restaurantId: string,
  options: {
    includeCost: boolean;
    since: Date | null;
    until: Date | null;
  },
) {
  if (options.includeCost) {
    return readInsightsPages<InsightsScan>((from, to) => {
      let query = client
        .from("invoice_scans")
        .select("id, distributor_name, item_count, accuracy_score, created_at, final_line_items")
        .eq("restaurant_id", restaurantId)
        .order("created_at", { ascending: false })
        .order("id");
      if (options.since) query = query.gte("created_at", options.since.toISOString());
      if (options.until) query = query.lte("created_at", options.until.toISOString());
      return query.range(from, to);
    });
  }

  const rows = await readInsightsPages<SafeScan>((from, to) => {
    let query = client
      .from("invoice_scans")
      .select("id, distributor_name, item_count, accuracy_score, created_at")
      .eq("restaurant_id", restaurantId)
      .order("created_at", { ascending: false })
      .order("id");
    if (options.since) query = query.gte("created_at", options.since.toISOString());
    if (options.until) query = query.lte("created_at", options.until.toISOString());
    return query.range(from, to);
  });
  return rows.map((row): InsightsScan => ({ ...row, final_line_items: null }));
}

export function fetchInsightsHealth(client: Client, restaurantId: string) {
  return readInsightsPages((from, to) => client
    .from("cellar_health")
    .select("wine_id, segment")
    .eq("restaurant_id", restaurantId)
    .order("wine_id")
    .range(from, to));
}
