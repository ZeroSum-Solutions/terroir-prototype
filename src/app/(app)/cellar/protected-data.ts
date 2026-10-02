import type { SupabaseClient } from "@supabase/supabase-js";
import type { SitePricingAccess } from "@/lib/api/site-capability";
import {
  readCellarHealthPrivate,
  readInventoryCosts,
  readRestaurantPricingDefaults,
  readWinePricingStrategy,
} from "@/lib/staff-cost/protected-readers";
import type { Database } from "@/types/database";

const PAGE_SIZE = 1000;

async function readHealthIdentities(
  supabase: SupabaseClient<Database>,
  restaurantId: string,
) {
  const rows: Array<{ id: string; wine_id: string; computed_at: string }> = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from("cellar_health")
      .select("id, wine_id, computed_at")
      .eq("restaurant_id", restaurantId)
      .order("wine_id", { ascending: true })
      .order("id", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    const page = data ?? [];
    rows.push(...page);
    if (page.length < PAGE_SIZE) return rows;
  }
}

export async function fetchCellarProtectedData(
  supabase: SupabaseClient<Database>,
  restaurantId: string,
  access: SitePricingAccess,
) {
  const [inventoryCosts, pricingStrategies, pricingDefaults, healthIdentities, healthRows] =
    await Promise.all([
      access.canReadCost ? readInventoryCosts(supabase, restaurantId) : Promise.resolve([]),
      access.canReadMargin
        ? readWinePricingStrategy(supabase, restaurantId)
        : Promise.resolve([]),
      access.canReadMargin
        ? readRestaurantPricingDefaults(supabase, restaurantId)
        : Promise.resolve(null),
      access.canReadCost ? readHealthIdentities(supabase, restaurantId) : Promise.resolve([]),
      access.canReadCost
        ? readCellarHealthPrivate(supabase, restaurantId)
        : Promise.resolve([]),
    ]);
  return { inventoryCosts, pricingStrategies, pricingDefaults, healthIdentities, healthRows };
}

function assertComplete(label: string, expectedIds: string[], receivedIds: string[]) {
  const received = new Set(receivedIds);
  if (received.size !== receivedIds.length || expectedIds.some((id) => !received.has(id))) {
    throw new Error(`${label} protected read was incomplete.`);
  }
}

export function reconcileCellarProtectedData(
  data: Awaited<ReturnType<typeof fetchCellarProtectedData>>,
  access: SitePricingAccess,
  restaurantId: string,
  wineIds: string[],
  inventoryIds: string[],
) {
  if (access.canReadCost) {
    assertComplete(
      "Inventory cost",
      inventoryIds,
      data.inventoryCosts.map((row) => row.inventory_item_id),
    );
    assertComplete(
      "Cellar health",
      data.healthIdentities.map((row) => row.id),
      data.healthRows.map((row) => row.health_id),
    );
  }
  if (access.canReadMargin) {
    assertComplete(
      "Wine pricing strategy",
      wineIds,
      data.pricingStrategies.map((row) => row.wine_id),
    );
    if (data.pricingDefaults?.restaurant_id !== restaurantId) {
      throw new Error("Restaurant pricing defaults protected read was incomplete.");
    }
  }
  return {
    inventoryCostById: new Map(
      data.inventoryCosts.map((row) => [row.inventory_item_id, row.unit_cost]),
    ),
    pricingStrategyByWine: new Map(
      data.pricingStrategies.map((row) => [row.wine_id, row]),
    ),
    pricingDefaults: data.pricingDefaults,
    healthByWine: new Map(data.healthRows.map((row) => [row.wine_id, row.segment] as const)),
  };
}
