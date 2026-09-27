import type { Metadata } from "next";
import { NextResponse } from "next/server";
import { notFound, redirect } from "next/navigation";
import { requireMembership } from "@/lib/api/auth";
import { resolveSitePricingReadAccess } from "@/lib/api/site-capability";
import {
  WineListEditor,
  type WineListEditorSection,
  type WineListEditorWine,
} from "./wine-list-editor";
import type { WineList } from "@/lib/wine-list/types";
import {
  BrandKitPaletteSchema,
  parseStoredProposals,
} from "@/lib/branding/theme";
import type { BrandKitView } from "./components/brand-kit-panel";
import {
  latestUnitCostByWine,
  suggestPricesForWine,
  type PricingWine,
} from "@/domains/wine-lists/list-item-pricing";
import {
  readInventoryCosts,
  readRestaurantPricingDefaults,
  readWinePricingStrategy,
} from "@/lib/staff-cost/protected-readers";

export const metadata: Metadata = { title: "Edit list" };

type Params = Promise<{ id: string }>;

type RawListWine = WineListEditorWine & {
  is_eightysixed: boolean;
  rating?: number | null;
  size_ml?: number | null;
  retail_median?: number | null;
  [key: string]: unknown;
};

function toSafeListWine(wine: RawListWine): WineListEditorWine & {
  is_eightysixed: boolean;
} {
  return {
    id: wine.id,
    name: wine.name,
    producer: wine.producer,
    vintage: wine.vintage,
    varietal: wine.varietal,
    region: wine.region,
    drink_window_start: wine.drink_window_start,
    drink_window_end: wine.drink_window_end,
    serving_temp_min: wine.serving_temp_min,
    serving_temp_max: wine.serving_temp_max,
    serving_temp_label: wine.serving_temp_label,
    colour: wine.colour,
    hero_image_url: wine.hero_image_url,
    is_eightysixed: wine.is_eightysixed,
  };
}

// ARCH-015: this server component is the primary read path for the
// wine-list editor. Before the fix it created its own supabase client
// and queried wine_lists by id only — RLS was the single enforcement
// point. Now we go through requireMembership (same pattern as
// /availability) and also filter by restaurant_id for defense-in-depth.
// A list UUID from another tenant 404s here even if RLS is ever relaxed.
export default async function WineListEditorPage({
  params,
}: {
  params: Params;
}) {
  const { id } = await params;

  const auth = await requireMembership();
  if (auth instanceof NextResponse) {
    // requireMembership returned a NextResponse (401/403). Send to login.
    redirect(`/login?next=/lists/${id}`);
  }
  const { supabase, restaurantId, role } = auth;
  const canReadPricingBasis = await resolveSitePricingReadAccess(supabase, restaurantId);

  // wines!wine_list_items_wine_id_fkey: 0080 added a second FK between
  // wine_list_items and wines (the tenant-matching composite FK), so
  // PostgREST needs the relationship named explicitly or embedding fails
  // with PGRST201 ("more than one relationship was found").
  const listQuery = canReadPricingBasis
    ? supabase
        .from("wine_lists")
        .select(
          "*, wine_list_sections(*, wine_list_items(*, wines!wine_list_items_wine_id_fkey(id, name, producer, vintage, varietal, region, drink_window_start, drink_window_end, serving_temp_min, serving_temp_max, serving_temp_label, colour, hero_image_url, is_eightysixed, rating, size_ml, retail_median)))",
        )
    : supabase
        .from("wine_lists")
        .select(
          "*, wine_list_sections(*, wine_list_items(*, wines!wine_list_items_wine_id_fkey(id, name, producer, vintage, varietal, region, drink_window_start, drink_window_end, serving_temp_min, serving_temp_max, serving_temp_label, colour, hero_image_url, is_eightysixed)))",
        );
  const { data: list, error } = await listQuery
    .eq("id", id)
    .eq("restaurant_id", restaurantId)
    .single();

  if (error || !list) notFound();

  const { data: brandKit } = await supabase
    .from("brand_kits")
    .select("logo_url, palette, proposals")
    .eq("restaurant_id", restaurantId)
    .maybeSingle();
  const parsedPalette = BrandKitPaletteSchema.safeParse(brandKit?.palette);
  const brandKitView: BrandKitView | null = brandKit
    ? {
        logoUrl: brandKit.logo_url,
        palette: parsedPalette.success ? parsedPalette.data : null,
        proposals: parseStoredProposals(brandKit.proposals),
      }
    : null;

  // Sort sections by position, items by position within each section
  const rawSections = (list.wine_list_sections ?? []) as Array<{
    id: string;
    name: string;
    position: number;
    wine_list_id: string;
    created_at: string;
    wine_list_items: Array<{
      id: string;
      section_id: string;
      wine_id: string;
      position: number;
      glass_price: number | null;
      bottle_price: number | null;
      glass_pour_ml: number | null;
      pour_size_mode: "fixed" | "picker";
      tasting_note: string | null;
      // is_available — deprecated by BND-037's wines.is_eightysixed.
      // Column still lives in the DB for read compat but isn't
      // writable via PATCH (ARCH-017). Drop from this type once the
      // read sites are migrated too.
      created_at: string;
      updated_at: string;
      name_override?: string | null;
      blurb?: string | null;
      hidden?: boolean | null;
      wines: RawListWine;
    }>;
  }>;

  // LIST-03 — one query for the whole list's invoice costs, then a suggested
  // glass + bottle price per row so a null price renders a suggestion instead
  // of a dash. Same resolution chain as /api/wines/[id]/pricing-suggestion.
  const wineIds = [
    ...new Set(
      rawSections.flatMap((section) =>
        (section.wine_list_items ?? []).map((item) => item.wine_id),
      ),
    ),
  ];
  let restaurant = null;
  let unitCosts = new Map<string, number>();
  let pricingStrategy = new Map<
    string,
    { pricing_target_markup_ratio: number | null; pricing_target_pour_cost_pct: number | null }
  >();
  let pricingInputsAvailable = false;
  if (canReadPricingBasis) {
    const inventoryIdentityRows = wineIds.length
      ? await Promise.all(
          Array.from({ length: Math.ceil(wineIds.length / 500) }, (_, index) =>
            supabase
              .from("inventory_items")
              .select("id, wine_id, added_at")
              .eq("restaurant_id", restaurantId)
              .in("wine_id", wineIds.slice(index * 500, (index + 1) * 500)),
          ),
        )
      : [];
    const identityError = inventoryIdentityRows.find((result) => result.error)?.error;
    if (identityError) throw identityError;
    const [pricingDefaults, protectedChunks] = await Promise.all([
      readRestaurantPricingDefaults(supabase, restaurantId),
      Promise.all(
        Array.from({ length: Math.ceil(wineIds.length / 500) }, (_, index) => {
          const ids = wineIds.slice(index * 500, (index + 1) * 500);
          return Promise.all([
            readInventoryCosts(supabase, restaurantId, ids),
            readWinePricingStrategy(supabase, restaurantId, ids),
          ]);
        }),
      ),
    ]);
    if (pricingDefaults?.restaurant_id !== restaurantId) {
      throw new Error("Restaurant pricing defaults protected read was incomplete.");
    }
    const inventoryCosts = protectedChunks.flatMap(([rows]) => rows);
    const strategyRows = protectedChunks.flatMap(([, rows]) => rows);
    const costByInventoryId = new Map(
      inventoryCosts.map((row) => [row.inventory_item_id, row.unit_cost]),
    );
    const identities = inventoryIdentityRows.flatMap((result) => result.data ?? []);
    if (
      costByInventoryId.size !== inventoryCosts.length ||
      identities.some((row) => !costByInventoryId.has(row.id))
    ) {
      throw new Error("Inventory cost protected read was incomplete.");
    }
    pricingStrategy = new Map(strategyRows.map((row) => [row.wine_id, row]));
    if (
      pricingStrategy.size !== strategyRows.length ||
      wineIds.some((wineId) => !pricingStrategy.has(wineId))
    ) {
      throw new Error("Wine pricing strategy protected read was incomplete.");
    }
    restaurant = pricingDefaults;
    unitCosts = latestUnitCostByWine(
      identities
        .map((row) => ({
          wine_id: row.wine_id,
          unit_cost: costByInventoryId.get(row.id) ?? null,
          added_at: row.added_at,
        }))
        .sort((a, b) => b.added_at.localeCompare(a.added_at)),
    );
    pricingInputsAvailable = true;
  }

  const sections: WineListEditorSection[] = rawSections
    .sort((a, b) => a.position - b.position)
    .map((s) => ({
      ...s,
      wine_list_items: [...(s.wine_list_items ?? [])].map((item) => {
        const suggested = pricingInputsAvailable
          ? suggestPricesForWine(
              {
                id: item.wines.id,
                varietal: item.wines.varietal,
                region: item.wines.region,
                rating: item.wines.rating ?? null,
                size_ml: item.wines.size_ml ?? null,
                retail_median: item.wines.retail_median ?? null,
                pricing_target_markup_ratio:
                  pricingStrategy.get(item.wine_id)?.pricing_target_markup_ratio ?? null,
                pricing_target_pour_cost_pct:
                  pricingStrategy.get(item.wine_id)?.pricing_target_pour_cost_pct ?? null,
              } satisfies PricingWine,
              restaurant,
              unitCosts.get(item.wine_id) ?? null,
              item.glass_pour_ml,
              item.bottle_price,
            )
          : { suggestedGlass: null, suggestedBottle: null };
        return {
          ...item,
          wines: toSafeListWine(item.wines),
          name_override: item.name_override ?? null,
          blurb: item.blurb ?? null,
          hidden: item.hidden ?? false,
          suggested_glass_price: suggested.suggestedGlass,
          suggested_bottle_price: suggested.suggestedBottle,
        };
      }).sort(
        (a, b) => a.position - b.position,
      ),
    }));

  const { wine_list_sections: _, ...listMeta } = list;

  return (
    <WineListEditor
      list={listMeta as Omit<WineList, "wine_list_sections">}
      sections={sections}
      brandKit={brandKitView}
      canManage={role === "owner" || role === "manager"}
    />
  );
}
