import type { Metadata } from "next";
import { getAuthContext } from "@/lib/auth-context";
import type { BottleInventoryRow } from "@/lib/bins";
import { BinManager } from "./bin-manager";
import { buildBinViewModels } from "./bin-view-model";

export const metadata: Metadata = { title: "Bins" };

type JoinedWine = {
  id: string;
  lineage_id: string | null;
  name: string;
  producer: string;
  colour: string | null;
  hero_image_url: string | null;
};

type JoinedInventory = {
  wine_id: string;
  quantity: number;
  wines: JoinedWine | JoinedWine[] | null;
};

type JoinedBin = {
  id: string;
  code: string;
  zone: string | null;
  capacity: number | null;
  priority: number;
  inventory_items: JoinedInventory[];
};

export default async function BinsPage() {
  const auth = (await getAuthContext())!;
  const { supabase, restaurantId, userRole } = auth;
  const [binResult, unplacedResult] = await Promise.all([
    supabase
      .from("bins")
      .select("id, code, zone, capacity, priority, inventory_items(wine_id, quantity, wines(id, lineage_id, name, producer, colour, hero_image_url))")
      .eq("restaurant_id", restaurantId)
      .eq("inventory_items.restaurant_id", restaurantId)
      .is("retired_at", null)
      .order("priority", { ascending: false })
      .order("code", { ascending: true }),
    supabase
      .from("inventory_items")
      .select("quantity")
      .eq("restaurant_id", restaurantId)
      .is("bin_id", null),
  ]);
  if (binResult.error) throw binResult.error;
  if (unplacedResult.error) throw unplacedResult.error;

  // Postgres orders `code` lexicographically, which puts A10 and A11 between
  // A1 and A2. Bin codes are a letter and a number, not a word, so they sort
  // the way a rack is read: by row, then numerically down the row. Re-sorted
  // here rather than in the query because the fix belongs to how a code is
  // READ, and SQL has no natural-order collation to ask for. `priority` stays
  // the primary key -- a pinned bin still comes first.
  const bins = ([...((binResult.data ?? []) as unknown as JoinedBin[])]).sort(
    (a, b) =>
      (b.priority ?? 0) - (a.priority ?? 0) ||
      a.code.localeCompare(b.code, undefined, { numeric: true, sensitivity: "base" }),
  );
  const inventory = flattenInventory(bins);
  const viewModels = buildBinViewModels(
    bins.map(({ id, code, zone, capacity, priority }) => ({ id, code, zone, capacity, priority })),
    inventory,
  );
  const unplacedCount = (unplacedResult.data ?? []).reduce(
    (total, item) => total + item.quantity,
    0,
  );

  return (
    <section>
      {/* Masthead, matching /cellar: the page names itself and then counts
          what is on it. The grey eyebrow above the title used to repeat the
          restaurant name, which the app header already carries on every
          route -- the same string twice on one 390px screen, the second time
          in the position a subtitle would occupy. */}
      <header className="mb-lg md:mb-xl">
        <h1 className="font-serif text-heading-sm font-normal leading-[1.05] tracking-[-0.02em] text-ink md:text-heading">
          Bins
        </h1>
        <p className="mt-2xs text-body-sm font-medium tabular text-grey">
          {viewModels.length} bin{viewModels.length === 1 ? "" : "s"}
          {unplacedCount > 0 ? ` · ${unplacedCount} unplaced` : ""}
        </p>
      </header>
      <BinManager
        bins={viewModels}
        inventory={inventory}
        canManage={userRole === "owner" || userRole === "manager"}
        unplacedCount={unplacedCount}
      />
    </section>
  );
}

/**
 * One row per WINE per BIN, not one per inventory line.
 *
 * A wine can hold several inventory_items rows in the same bin — separate
 * purchase lots, different unit costs, same bottle on the same shelf — and
 * this used to emit one row for each. Every consumer keys off
 * `${wineId}:${binId}` (bin-manager.tsx three times, bin-mobile-list.tsx
 * once), so those duplicates became duplicate React keys: "Encountered two
 * children with the same key", which React documents as unsupported and free
 * to duplicate or OMIT a child. A bottle silently missing from a bin list is
 * the one failure this screen must not have.
 *
 * Summing is also the right answer for the reader. The bin card answers "what
 * is on this shelf and how much of it", and two lots of the same wine in one
 * bin are one entry with the total, not the same label printed twice — which
 * is exactly what /cellar already does for the same data (bin-data.ts's
 * groupWineStock). This makes the two screens agree.
 */
function flattenInventory(bins: readonly JoinedBin[]): BottleInventoryRow[] {
  const byWineAndBin = new Map<string, BottleInventoryRow>();
  for (const bin of bins) {
    for (const item of bin.inventory_items) {
      const wine = Array.isArray(item.wines) ? item.wines[0] : item.wines;
      if (!wine) continue;
      const key = `${wine.id}:${bin.id}`;
      const existing = byWineAndBin.get(key);
      if (existing) {
        existing.quantity += item.quantity;
        continue;
      }
      byWineAndBin.set(key, {
        wineId: wine.id,
        lineageId: wine.lineage_id,
        name: wine.name,
        producer: wine.producer,
        colour: wine.colour,
        heroImageUrl: wine.hero_image_url,
        binId: bin.id,
        binCode: bin.code,
        binZone: bin.zone,
        quantity: item.quantity,
      });
    }
  }
  return [...byWineAndBin.values()];
}
