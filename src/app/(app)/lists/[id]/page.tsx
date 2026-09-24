import type { Metadata } from "next";
import { NextResponse } from "next/server";
import { notFound, redirect } from "next/navigation";
import { requireMembership } from "@/lib/api/auth";
import { resolveSitePricingAccess } from "@/lib/api/site-capability";
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

export const metadata: Metadata = { title: "Edit list" };

type Params = Promise<{ id: string }>;

type RawListWine = PricingWine & WineListEditorWine & {
  is_eightysixed: boolean;
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
  const pricingAccess = await resolveSitePricingAccess(supabase, restaurantId);
  const canReadPricingBasis =
    pricingAccess.canReadCost && pricingAccess.canReadMargin;

  // wines!wine_list_items_wine_id_fkey: 0080 added a second FK between
  // wine_list_items and wines (the tenant-matching composite FK), so
  // PostgREST needs the relationship named explicitly or embedding fails
  // with PGRST201 ("more than one relationship was found").
  const listQuery = canReadPricingBasis
    ? supabase
        .from("wine_lists")
        .select(
          "*, wine_list_sections(*, wine_list_items(*, wines!wine_list_items_wine_id_fkey(id, name, producer, vintage, varietal, region, drink_window_start, drink_window_end, serving_temp_min, serving_temp_max, serving_temp_label, colour, hero_image_url, is_eightysixed, rating, size_ml, retail_median, pricing_target_markup_ratio, pricing_target_pour_cost_pct)))",
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
  let pricingInputsAvailable = false;
  if (canReadPricingBasis) {
    const restaurantResult = await supabase
      .from("restaurants")
      .select("default_target_markup_ratio, default_target_pour_cost_pct")
      .eq("id", restaurantId)
      .single();
    const costResult = wineIds.length
      ? await supabase
          .from("inventory_items")
          .select("wine_id, unit_cost, added_at")
          .eq("restaurant_id", restaurantId)
          .in("wine_id", wineIds)
          .order("added_at", { ascending: false })
      : { data: [], error: null };
    if (!restaurantResult.error && !costResult.error) {
      restaurant = restaurantResult.data;
      unitCosts = latestUnitCostByWine(costResult.data ?? []);
      pricingInputsAvailable = true;
    }
  }

  const sections: WineListEditorSection[] = rawSections
    .sort((a, b) => a.position - b.position)
    .map((s) => ({
      ...s,
      wine_list_items: [...(s.wine_list_items ?? [])].map((item) => {
        const suggested = pricingInputsAvailable
          ? suggestPricesForWine(
              item.wines,
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
