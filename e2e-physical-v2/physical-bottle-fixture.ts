import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { admitPhysicalV2Target } from "./admission";

export type PhysicalV2Fixture = {
  admin: SupabaseClient<Database>;
  binCode: string;
  binId: string;
  inventoryId: string;
  restaurantId: string;
  wineId: string;
  wineName: string;
};

/**
 * Creates only mutable source data on the admitted disposable runtime. Physical
 * bottles, events, effects and receipts are created exclusively by first-party
 * HTTP commands in the browser test. The fixture deliberately has no teardown:
 * contract-2 history is immutable and the whole admitted runtime is disposable.
 */
export async function createPhysicalV2Fixture(): Promise<PhysicalV2Fixture> {
  // This admission is intentionally repeated immediately before the first
  // fixture write. A config-only check or a server-start check is not enough:
  // the expected database container must still be the same exact container.
  const admission = await admitPhysicalV2Target();
  const { admin, restaurantId } = admission;
  const suffix = crypto.randomUUID().replaceAll("-", "").slice(0, 12);
  const wineName = `D1 Exact Bottle ${suffix}`;
  const binCode = `D1-${suffix.slice(0, 8).toUpperCase()}`;

  const { data: bin, error: binError } = await admin
    .from("bins")
    .insert({
      restaurant_id: restaurantId,
      code: binCode,
      zone: "D1 Disposable",
      capacity: 12,
      priority: 100,
    })
    .select("id")
    .single();
  if (binError) throw new Error(`physical-v2 bin fixture failed: ${binError.message}`);

  const { data: wine, error: wineError } = await admin
    .from("wines")
    .insert({
      restaurant_id: restaurantId,
      name: wineName,
      producer: "Disposable D1 Estate",
      vintage: 2024,
      varietal: "Pinot Noir",
      region: "Synthetic Test Region",
      country: "United States",
      size_ml: 750,
    })
    .select("id")
    .single();
  if (wineError) throw new Error(`physical-v2 wine fixture failed: ${wineError.message}`);

  const { data: inventory, error: inventoryError } = await admin
    .from("inventory_items")
    .insert({
      restaurant_id: restaurantId,
      wine_id: wine.id,
      quantity: 2,
      unit_cost: 37,
      added_via: "manual",
      bin_id: bin.id,
      bin_location: binCode,
      section: "D1 synthetic fixture",
    })
    .select("id")
    .single();
  if (inventoryError) {
    throw new Error(`physical-v2 inventory fixture failed: ${inventoryError.message}`);
  }

  const { data: list, error: listError } = await admin
    .from("wine_lists")
    .insert({
      restaurant_id: restaurantId,
      name: `D1 Disposable List ${suffix}`,
      template: "classic",
      slug: `d1-disposable-${suffix}`,
      is_published: false,
      archived: false,
    })
    .select("id")
    .single();
  if (listError) throw new Error(`physical-v2 list fixture failed: ${listError.message}`);

  const { data: section, error: sectionError } = await admin
    .from("wine_list_sections")
    .insert({ wine_list_id: list.id, name: "By the glass", position: 0 })
    .select("id")
    .single();
  if (sectionError) {
    throw new Error(`physical-v2 list section fixture failed: ${sectionError.message}`);
  }

  const { error: itemError } = await admin.from("wine_list_items").insert({
    section_id: section.id,
    restaurant_id: restaurantId,
    wine_id: wine.id,
    position: 0,
    glass_pour_ml: 150,
    pour_size_mode: "fixed",
    is_available: true,
  });
  if (itemError) throw new Error(`physical-v2 list item fixture failed: ${itemError.message}`);

  return {
    admin,
    binCode,
    binId: bin.id,
    inventoryId: inventory.id,
    restaurantId,
    wineId: wine.id,
    wineName,
  };
}
