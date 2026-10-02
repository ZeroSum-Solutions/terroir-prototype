import type { SupabaseClient } from "@supabase/supabase-js";
import {
  readInventoryCosts,
  readWineCostFlags,
} from "@/lib/staff-cost/protected-readers";
import type { Database } from "@/types/database";

const PAGE_SIZE = 1000;
const FILTER_SIZE = 500;

export type DistributorPriceRow = {
  inventoryItemId: string;
  quantity: number;
  unitCost: number;
  wine: {
    id: string;
    name: string;
    producer: string;
    vintage: number | null;
    varietal: string | null;
    retail_median: number | null;
    retail_min: number | null;
    retail_max: number | null;
    hero_image_url: string | null;
    colour: string | null;
  };
  scan: { distributor_name: string; invoice_date: string | null };
  overpaidFlag: boolean;
};

type SafeInventoryRow = {
  id: string;
  quantity: number;
  wine_id: string;
  invoice_scan_id: string | null;
  added_at: string;
  wines: DistributorPriceRow["wine"] | DistributorPriceRow["wine"][] | null;
  invoice_scans: DistributorPriceRow["scan"] | DistributorPriceRow["scan"][] | null;
};

export async function fetchDistributorPriceRows(
  supabase: SupabaseClient<Database>,
  restaurantId: string,
): Promise<DistributorPriceRow[]> {
  const safeRows: SafeInventoryRow[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from("inventory_items")
      .select(
        "id, quantity, wine_id, invoice_scan_id, added_at, wines(id, name, producer, vintage, varietal, retail_median, retail_min, retail_max, hero_image_url, colour), invoice_scans(distributor_name, invoice_date)",
      )
      .eq("restaurant_id", restaurantId)
      .order("added_at", { ascending: true })
      .order("id", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    const page = data ?? [];
    safeRows.push(...page);
    if (page.length < PAGE_SIZE) break;
  }

  const wineIds = [...new Set(safeRows.map((row) => row.wine_id))];
  const [costRows, flagChunks] = await Promise.all([
    readInventoryCosts(supabase, restaurantId),
    Promise.all(
      Array.from({ length: Math.ceil(wineIds.length / FILTER_SIZE) }, (_, index) =>
        readWineCostFlags(
          supabase,
          restaurantId,
          wineIds.slice(index * FILTER_SIZE, (index + 1) * FILTER_SIZE),
        ),
      ),
    ),
  ]);
  const flags = flagChunks.flat();
  const costById = new Map(costRows.map((row) => [row.inventory_item_id, row.unit_cost]));
  const flagByWine = new Map(flags.map((row) => [row.wine_id, row.overpaid_flag]));
  if (
    costById.size !== costRows.length ||
    safeRows.some((row) => !costById.has(row.id)) ||
    flagByWine.size !== flags.length ||
    wineIds.some((wineId) => !flagByWine.has(wineId))
  ) {
    throw new Error("Distributor pricing protected read was incomplete.");
  }

  return safeRows.flatMap((row) => {
    const wine = Array.isArray(row.wines) ? row.wines[0] : row.wines;
    const scan = Array.isArray(row.invoice_scans) ? row.invoice_scans[0] : row.invoice_scans;
    const unitCost = costById.get(row.id);
    if (!wine || !scan || unitCost == null) return [];
    return [{
      inventoryItemId: row.id,
      quantity: row.quantity,
      unitCost,
      wine,
      scan,
      overpaidFlag: flagByWine.get(row.wine_id)!,
    }];
  });
}
