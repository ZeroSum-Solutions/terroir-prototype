import type { SupabaseClient } from "@supabase/supabase-js";
import type { OfflineCellarRow } from "./contract";
import type { Database } from "@/types/database";

const PAGE_SIZE = 1_000;
const MAX_ROWS_PER_RELATION = 50_000;

export const OFFLINE_LOOKUP_SELECTS = {
  wines: "id, name, producer, vintage, size_ml",
  inventory_items: "id, wine_id, bin_id, quantity",
  bins: "id, code",
  open_bottles: "id, wine_id, opened_at, remaining_ml",
} as const;

export type OfflineWineRecord = {
  id: string;
  name: string;
  producer: string;
  vintage: number | null;
  size_ml: number;
};

export type OfflineInventoryRecord = {
  id: string;
  wine_id: string;
  bin_id: string | null;
  quantity: number;
};

export type OfflineBinRecord = { id: string; code: string };

export type OfflineOpenBottleRecord = {
  id: string;
  wine_id: string;
  opened_at: string;
  remaining_ml: number;
};

type PageResult<T> = {
  data: T[] | null;
  error: unknown;
};

export async function fetchKeysetPages<T extends { id: string }>(
  loadPage: (afterId: string | null, limit: number) => Promise<PageResult<T>>,
  options: { pageSize?: number; maxRows?: number } = {},
): Promise<T[]> {
  const pageSize = options.pageSize ?? PAGE_SIZE;
  const maxRows = options.maxRows ?? MAX_ROWS_PER_RELATION;
  const rows: T[] = [];
  let afterId: string | null = null;

  for (;;) {
    const result = await loadPage(afterId, pageSize);
    if (result.error !== null || !Array.isArray(result.data)) {
      throw new Error("Offline cellar lookup read failed.");
    }
    const page = result.data;
    let priorId = afterId;
    for (const row of page) {
      if (priorId !== null && row.id <= priorId) {
        throw new Error("Offline cellar lookup pagination did not advance.");
      }
      priorId = row.id;
    }
    if (rows.length + page.length > maxRows) {
      throw new Error("Offline cellar lookup exceeds its safe row limit.");
    }
    rows.push(...page);
    // PostgREST may enforce a server-side cap below the requested limit. Only
    // an empty page proves the keyset is exhausted; a short non-empty page
    // must advance and continue or the offline projection silently truncates.
    if (page.length === 0) return rows;
    const nextId = page.at(-1)?.id;
    if (!nextId || nextId === afterId) {
      throw new Error("Offline cellar lookup pagination did not advance.");
    }
    afterId = nextId;
  }
}

export async function loadOfflineCellarRows(
  supabase: SupabaseClient<Database>,
  restaurantId: string,
): Promise<OfflineCellarRow[]> {
  // Every page of every relation is a separate snapshot, not one transaction.
  // The route's read-start `asOf` is advisory projection age only. Inventory
  // and bottles with an unobserved wine fail closed; absent active bins are
  // intentionally omitted, while a wine with no observed lots reports an
  // advisory zero rather than fabricating a placement or atomic view.
  const [wines, inventory, bins, openBottles] = await Promise.all([
    fetchKeysetPages<OfflineWineRecord>(async (afterId, limit) => {
      let query = supabase.from("wines")
        .select(OFFLINE_LOOKUP_SELECTS.wines)
        .eq("restaurant_id", restaurantId)
        .order("id")
        .limit(limit);
      if (afterId) query = query.gt("id", afterId);
      return query;
    }),
    fetchKeysetPages<OfflineInventoryRecord>(async (afterId, limit) => {
      let query = supabase.from("inventory_items")
        .select(OFFLINE_LOOKUP_SELECTS.inventory_items)
        .eq("restaurant_id", restaurantId)
        .order("id")
        .limit(limit);
      if (afterId) query = query.gt("id", afterId);
      return query;
    }),
    fetchKeysetPages<OfflineBinRecord>(async (afterId, limit) => {
      let query = supabase.from("bins")
        .select(OFFLINE_LOOKUP_SELECTS.bins)
        .eq("restaurant_id", restaurantId)
        .is("retired_at", null)
        .order("id")
        .limit(limit);
      if (afterId) query = query.gt("id", afterId);
      return query;
    }),
    fetchKeysetPages<OfflineOpenBottleRecord>(async (afterId, limit) => {
      let query = supabase.from("open_bottles")
        .select(OFFLINE_LOOKUP_SELECTS.open_bottles)
        .eq("restaurant_id", restaurantId)
        .is("closed_at", null)
        .order("id")
        .limit(limit);
      if (afterId) query = query.gt("id", afterId);
      return query;
    }),
  ]);

  return mapOfflineCellarRows({ wines, inventory, bins, openBottles });
}

export function mapOfflineCellarRows(input: {
  wines: OfflineWineRecord[];
  inventory: OfflineInventoryRecord[];
  bins: OfflineBinRecord[];
  openBottles: OfflineOpenBottleRecord[];
}): OfflineCellarRow[] {
  const wineIds = new Set(input.wines.map((wine) => wine.id));
  const activeBins = new Map(input.bins.map((bin) => [bin.id, bin.code]));
  const sealedByWine = new Map<string, number>();
  const placements = new Map<string, Map<string, number>>();

  for (const item of input.inventory) {
    if (!wineIds.has(item.wine_id)) throw new Error("Offline inventory has no wine.");
    sealedByWine.set(
      item.wine_id,
      (sealedByWine.get(item.wine_id) ?? 0) + item.quantity,
    );
    if (!item.bin_id || !activeBins.has(item.bin_id)) continue;
    const byBin = placements.get(item.wine_id) ?? new Map<string, number>();
    byBin.set(item.bin_id, (byBin.get(item.bin_id) ?? 0) + item.quantity);
    placements.set(item.wine_id, byBin);
  }

  const openByWine = new Map<string, OfflineOpenBottleRecord>();
  for (const bottle of input.openBottles) {
    if (!wineIds.has(bottle.wine_id)) throw new Error("Offline bottle has no wine.");
    if (openByWine.has(bottle.wine_id)) {
      throw new Error("Offline lookup found multiple active bottles for one wine.");
    }
    openByWine.set(bottle.wine_id, bottle);
  }

  return input.wines.map((wine) => {
    const openBottle = openByWine.get(wine.id);
    const winePlacements = [...(placements.get(wine.id) ?? [])]
      .filter(([, quantity]) => quantity > 0)
      .map(([binId, sealedQuantity]) => ({
        binId,
        label: activeBins.get(binId)!,
        sealedQuantity,
      }))
      .sort((left, right) => (
        compareText(left.label, right.label) || compareText(left.binId, right.binId)
      ));

    return {
      wineId: wine.id,
      displayName: wine.name,
      producer: wine.producer,
      vintage: wine.vintage,
      format: `${wine.size_ml}ml`,
      sealedQuantity: sealedByWine.get(wine.id) ?? 0,
      placements: winePlacements,
      activeOpenBottleId: openBottle?.id ?? null,
      openedAt: openBottle?.opened_at ?? null,
      remainingMl: openBottle?.remaining_ml ?? null,
    };
  });
}

function compareText(left: string, right: string) {
  return left < right ? -1 : left > right ? 1 : 0;
}
