import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import {
  readCellarHealthPrivate,
  readInventoryCosts,
  readInvoiceScanPrivate,
} from "@/lib/staff-cost/protected-readers";

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

export async function fetchInsightsInventory(client: Client, restaurantId: string) {
  const items = await readInsightsPages((from, to) => client
    .from("inventory_items")
    .select("id, quantity, wine_id, invoice_scan_id, wines(varietal)")
    .eq("restaurant_id", restaurantId)
    .order("id")
    .range(from, to));
  const costs = await readInventoryCosts(client, restaurantId);
  const costById = new Map(costs.map((row) => [row.inventory_item_id, row]));
  if (
    costById.size !== costs.length ||
    items.some((item) => !costById.has(item.id))
  ) {
    throw new Error("Insights inventory cost protected read was incomplete.");
  }
  return items.map((item) => ({
    ...item,
    unit_cost: costById.get(item.id)!.unit_cost,
  }));
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
): Promise<InsightsScan[]> {
  if (options.includeCost) {
    const safeRows = await fetchInsightsScans(client, restaurantId, {
      ...options,
      includeCost: false,
    });
    const privateRows = await mapConcurrent(safeRows, 10, (row) =>
      readInvoiceScanPrivate(client, row.id));
    return safeRows.map((row, index): InsightsScan => {
      const privateRow = privateRows[index];
      if (
        !privateRow || privateRow.scan_id !== row.id ||
        privateRow.restaurant_id !== restaurantId
      ) {
        throw new Error("Insights scan protected read was incomplete.");
      }
      return { ...row, final_line_items: privateRow.final_line_items };
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

export async function fetchInsightsHealth(client: Client, restaurantId: string) {
  const identities = await readInsightsPages((from, to) => client
    .from("cellar_health")
    .select("id, wine_id, computed_at")
    .eq("restaurant_id", restaurantId)
    .order("wine_id")
    .range(from, to));
  const privateRows = await readCellarHealthPrivate(client, restaurantId);
  const privateById = new Map(privateRows.map((row) => [row.health_id, row]));
  if (
    privateById.size !== privateRows.length ||
    identities.some((row) => !privateById.has(row.id))
  ) {
    throw new Error("Insights health protected read was incomplete.");
  }
  return identities.map((row) => ({
    wine_id: row.wine_id,
    segment: privateById.get(row.id)!.segment,
  }));
}

async function mapConcurrent<T, R>(
  rows: readonly T[],
  concurrency: number,
  read: (row: T) => Promise<R>,
): Promise<R[]> {
  const output = new Array<R>(rows.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, rows.length) }, async () => {
      for (;;) {
        const index = next++;
        if (index >= rows.length) return;
        output[index] = await read(rows[index]!);
      }
    }),
  );
  return output;
}
