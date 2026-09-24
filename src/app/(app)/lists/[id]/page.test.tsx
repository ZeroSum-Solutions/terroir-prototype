import { NextResponse } from "next/server";
import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireMembership: vi.fn(),
  resolveSitePricingAccess: vi.fn(),
  latestUnitCostByWine: vi.fn(),
  suggestPricesForWine: vi.fn(),
  redirect: vi.fn(),
  notFound: vi.fn(),
}));

vi.mock("@/lib/api/auth", () => ({
  requireMembership: mocks.requireMembership,
}));
vi.mock("@/lib/api/site-capability", () => ({
  resolveSitePricingAccess: mocks.resolveSitePricingAccess,
}));
vi.mock("@/domains/wine-lists/list-item-pricing", () => ({
  latestUnitCostByWine: mocks.latestUnitCostByWine,
  suggestPricesForWine: mocks.suggestPricesForWine,
}));

vi.mock("next/navigation", () => ({
  redirect: mocks.redirect,
  notFound: mocks.notFound,
}));

vi.mock("./wine-list-editor", () => ({
  WineListEditor: () => null,
}));

const { default: WineListEditorPage } = await import("./page");

const WINE = {
  id: "wine-1",
  name: "Volnay",
  producer: "Maison Example",
  vintage: 2022,
  varietal: "Pinot Noir",
  region: "Burgundy",
  drink_window_start: 2025,
  drink_window_end: 2032,
  serving_temp_min: 55,
  serving_temp_max: 60,
  serving_temp_label: "Cellar cool",
  colour: "red",
  hero_image_url: "https://example.test/wine.jpg",
  is_eightysixed: false,
  rating: 92,
  size_ml: 750,
  retail_median: 80,
  pricing_target_markup_ratio: 2.5,
  pricing_target_pour_cost_pct: 0.22,
  unit_cost: 999,
  private_strategy: "never serialize",
};

const LIST = {
  id: "list-1",
  restaurant_id: "restaurant-1",
  name: "Dinner",
  wine_list_sections: [{
    id: "section-1",
    name: "Reds",
    position: 0,
    wine_list_id: "list-1",
    wine_list_items: [{
      id: "item-1",
      section_id: "section-1",
      wine_id: "wine-1",
      position: 0,
      glass_price: 18,
      bottle_price: 72,
      glass_pour_ml: 150,
      pour_size_mode: "fixed",
      tasting_note: null,
      name_override: null,
      blurb: null,
      hidden: false,
      is_available: true,
      wines: WINE,
    }],
  }],
};

function supabaseReturning(options: {
  inventoryError?: unknown;
  restaurantError?: unknown;
} = {}) {
  const selections: Array<{ table: string; columns: string }> = [];
  const tables: Record<string, { data: unknown; error: unknown }> = {
    wine_lists: { data: LIST, error: null },
    brand_kits: { data: null, error: null },
    restaurants: {
      data: {
        default_target_markup_ratio: 2.7,
        default_target_pour_cost_pct: 0.24,
      },
      error: options.restaurantError ?? null,
    },
    inventory_items: {
      data: [{ wine_id: "wine-1", unit_cost: 40, added_at: "2026-09-01" }],
      error: options.inventoryError ?? null,
    },
  };
  return {
    selections,
    client: {
      from: (table: string) => {
        const query = {
          select: (columns: string) => {
            selections.push({ table, columns });
            return query;
          },
          eq: () => query,
          in: () => query,
          order: () => query,
          single: () => Promise.resolve(tables[table]),
          maybeSingle: () => Promise.resolve(tables[table]),
          then: (resolve: (value: unknown) => unknown) =>
            Promise.resolve(tables[table]).then(resolve),
        };
        return query;
      },
    },
  };
}

function editorProps(element: Awaited<ReturnType<typeof WineListEditorPage>>) {
  return element.props as {
    sections: Array<{
      wine_list_items: Array<Record<string, unknown> & { wines: Record<string, unknown> }>;
    }>;
    canManage: boolean;
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.resolveSitePricingAccess.mockResolvedValue({
    canReadCost: false,
    canReadMargin: false,
    canManagePricing: false,
  });
  mocks.latestUnitCostByWine.mockReturnValue(new Map([["wine-1", 40]]));
  mocks.suggestPricesForWine.mockReturnValue({
    suggestedGlass: 22,
    suggestedBottle: 175,
  });
});

it("returns unauthenticated users to the canonical list editor URL", async () => {
  mocks.requireMembership.mockResolvedValue(
    NextResponse.json({}, { status: 401 }),
  );
  mocks.redirect.mockImplementation((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  });

  await expect(
    WineListEditorPage({ params: Promise.resolve({ id: "list-1" }) }),
  ).rejects.toThrow("NEXT_REDIRECT:/login?next=/lists/list-1");
  expect(mocks.redirect).toHaveBeenCalledWith("/login?next=/lists/list-1");
});

it("keeps a staff list safe and usable without exact-site cost authority", async () => {
  const { client, selections } = supabaseReturning();
  mocks.requireMembership.mockResolvedValue({
    supabase: client,
    restaurantId: "restaurant-1",
    role: "staff",
  });

  const props = editorProps(await WineListEditorPage({
    params: Promise.resolve({ id: "list-1" }),
  }));
  const item = props.sections[0].wine_list_items[0];
  const serialized = JSON.stringify(props);

  expect(mocks.resolveSitePricingAccess).toHaveBeenCalledWith(client, "restaurant-1");
  const wineListProjection = selections.find(
    (selection) => selection.table === "wine_lists",
  )?.columns;
  expect(wineListProjection).not.toContain("wines!wine_list_items_wine_id_fkey(*)");
  expect(wineListProjection).not.toMatch(
    /rating|retail_median|pricing_target_markup_ratio|pricing_target_pour_cost_pct/,
  );
  expect(wineListProjection).toMatch(/is_eightysixed/);
  expect(selections.some((selection) => selection.table === "restaurants")).toBe(false);
  expect(selections.some((selection) => selection.table === "inventory_items")).toBe(false);
  expect(mocks.latestUnitCostByWine).not.toHaveBeenCalled();
  expect(mocks.suggestPricesForWine).not.toHaveBeenCalled();
  expect(item.glass_price).toBe(18);
  expect(item.bottle_price).toBe(72);
  expect(item.hidden).toBe(false);
  expect(item.is_available).toBe(true);
  expect(item.suggested_glass_price).toBeNull();
  expect(item.suggested_bottle_price).toBeNull();
  expect(item.wines).toMatchObject({
    id: "wine-1",
    name: "Volnay",
    is_eightysixed: false,
  });
  expect(serialized).not.toMatch(
    /unit_cost|pricing_target_markup_ratio|pricing_target_pour_cost_pct|private_strategy/,
  );
  expect(props.canManage).toBe(false);
});

it("does not turn a legacy manager or one read grant into cost authority", async () => {
  const { client, selections } = supabaseReturning();
  mocks.requireMembership.mockResolvedValue({
    supabase: client,
    restaurantId: "restaurant-1",
    role: "manager",
  });
  mocks.resolveSitePricingAccess.mockResolvedValue({
    canReadCost: true,
    canReadMargin: false,
    canManagePricing: true,
  });

  const props = editorProps(await WineListEditorPage({
    params: Promise.resolve({ id: "list-1" }),
  }));

  expect(selections.some((selection) => selection.table === "restaurants")).toBe(false);
  expect(selections.some((selection) => selection.table === "inventory_items")).toBe(false);
  expect(mocks.suggestPricesForWine).not.toHaveBeenCalled();
  expect(props.sections[0].wine_list_items[0].suggested_bottle_price).toBeNull();
  expect(props.canManage).toBe(true);
});

it("retains suggestions with both read grants without requiring pricing manage", async () => {
  const { client, selections } = supabaseReturning();
  mocks.requireMembership.mockResolvedValue({
    supabase: client,
    restaurantId: "restaurant-1",
    role: "staff",
  });
  mocks.resolveSitePricingAccess.mockResolvedValue({
    canReadCost: true,
    canReadMargin: true,
    canManagePricing: false,
  });

  const props = editorProps(await WineListEditorPage({
    params: Promise.resolve({ id: "list-1" }),
  }));
  const item = props.sections[0].wine_list_items[0];

  expect(selections.find((selection) => selection.table === "wine_lists")?.columns)
    .toMatch(/pricing_target_markup_ratio, pricing_target_pour_cost_pct/);
  expect(selections.some((selection) => selection.table === "restaurants")).toBe(true);
  expect(selections.some((selection) => selection.table === "inventory_items")).toBe(true);
  expect(mocks.latestUnitCostByWine).toHaveBeenCalledWith([
    { wine_id: "wine-1", unit_cost: 40, added_at: "2026-09-01" },
  ]);
  expect(mocks.suggestPricesForWine).toHaveBeenCalledWith(
    expect.objectContaining({
      pricing_target_markup_ratio: 2.5,
      pricing_target_pour_cost_pct: 0.22,
    }),
    {
      default_target_markup_ratio: 2.7,
      default_target_pour_cost_pct: 0.24,
    },
    40,
    150,
    72,
  );
  expect(item.suggested_glass_price).toBe(22);
  expect(item.suggested_bottle_price).toBe(175);
  expect(JSON.stringify(item.wines)).not.toMatch(
    /unit_cost|pricing_target_markup_ratio|pricing_target_pour_cost_pct|private_strategy/,
  );
  expect(props.canManage).toBe(false);
});

it("does not assess margin when an authorized protected read fails", async () => {
  const { client } = supabaseReturning({ inventoryError: { message: "permission denied" } });
  mocks.requireMembership.mockResolvedValue({
    supabase: client,
    restaurantId: "restaurant-1",
    role: "owner",
  });
  mocks.resolveSitePricingAccess.mockResolvedValue({
    canReadCost: true,
    canReadMargin: true,
    canManagePricing: true,
  });

  const props = editorProps(await WineListEditorPage({
    params: Promise.resolve({ id: "list-1" }),
  }));
  const item = props.sections[0].wine_list_items[0];

  expect(mocks.latestUnitCostByWine).not.toHaveBeenCalled();
  expect(mocks.suggestPricesForWine).not.toHaveBeenCalled();
  expect(item.suggested_glass_price).toBeNull();
  expect(item.suggested_bottle_price).toBeNull();
  expect(props.canManage).toBe(true);
});
