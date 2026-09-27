import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PhysicalBottleSummary } from "@/lib/wine-list/shapes";
import { applyCellarQueryFilter } from "@/lib/cellar-facets/query-filter";
import type { CellarWineRow } from "./types";
import { pickRowChip } from "./row-chip";

const mocks = vi.hoisted(() => ({
  getAuthContext: vi.fn(),
  activePhysicalBottles: [] as PhysicalBottleSummary[],
  compatibilityOpenRows: [] as Array<Record<string, unknown>>,
}));

vi.mock("@/lib/auth-context", () => ({
  getAuthContext: (...args: unknown[]) => mocks.getAuthContext(...args),
}));
vi.mock("@/lib/api/site-capability", () => ({
  resolveSitePricingAccess: vi.fn(async () => ({
    canReadCost: false,
    canReadMargin: false,
    canManagePricing: false,
  })),
}));
vi.mock("./inventory-data", () => ({
  fetchCellarInventoryRows: vi.fn(async () => []),
}));
vi.mock("@/domains/pours/physical-bottle-command", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@/domains/pours/physical-bottle-command")
  >();
  return {
    ...actual,
    getInventoryContractVersion: vi.fn(async () => 1),
    listActivePhysicalBottles: vi.fn(async () => mocks.activePhysicalBottles),
  };
});

const { default: CellarPage } = await import("./page");

const WINE_ID = "11111111-1111-4111-8111-111111111111";
const RESTAURANT_ID = "22222222-2222-4222-8222-222222222222";

function wine() {
  return {
    id: WINE_ID,
    name: "Snapshot Wine",
    producer: "Producer",
    vintage: 2020,
    varietal: null,
    region: null,
    country: null,
    lineage_id: null,
    size_ml: 750,
    is_eightysixed: false,
    eightysixed_at: null,
    drink_window_start: null,
    drink_window_end: null,
    peak_year: null,
    rating: null,
    rating_source: null,
    review_excerpt: null,
    serving_temp_min: null,
    serving_temp_max: null,
    serving_temp_label: null,
    decant_minutes: null,
    retail_min: null,
    retail_max: null,
    retail_median: null,
    retail_retailer_count: null,
    retail_refreshed_at: null,
    pricing_target_pour_cost_pct: null,
    pricing_target_markup_ratio: null,
    pricing_dismissed_until: null,
    tasting_notes: null,
    hero_image_url: null,
    manual_overrides: [],
    colour: null,
  };
}

function compatibilityRow(openRemainingMl: number) {
  return {
    wine_id: WINE_ID,
    wine_list_item_id: "list-item-1",
    producer: "Producer",
    name: "Snapshot Wine",
    vintage: 2020,
    size_ml: 750,
    sealed_count: 0,
    opened_at: "2026-09-25T09:00:00.000Z",
    open_remaining_ml: openRemainingMl,
    glass_pour_ml: 150,
    pour_size_mode: "fixed",
  };
}

function physicalBottle(
  id: string,
  remainingMl: number,
  overrides: Partial<PhysicalBottleSummary> = {},
): PhysicalBottleSummary {
  return {
    id,
    wineId: WINE_ID,
    remainingMl,
    nominalCapacityMl: null,
    openedAt: "2026-09-25T09:00:00.000Z",
    preservationMethod: "none",
    sourceProvenance: "legacy_unknown",
    sourceBinLocation: null,
    identityContract: 1,
    identityOrigin: "legacy_slot",
    stateVersion: 0,
    ...overrides,
  };
}

function makeSupabase() {
  const immediate: Record<string, unknown[]> = {
    bins: [],
    reason_codes: [],
    cellar_health: [],
    wine_list_items: [],
    pour_events: [],
  };

  function chain(table: string) {
    const self: Record<string, unknown> = {};
    for (const method of ["select", "eq", "order", "is", "limit", "in", "gte"]) {
      self[method] = () => self;
    }
    self.range = async (from: number) => ({
      data: table === "wines" && from === 0 ? [wine()] : [],
      error: null,
    });
    self.maybeSingle = async () => ({ data: null, error: null });
    self.single = async () => ({
      data: table === "restaurants"
        ? {
            auto_eightysix_from_inventory: false,
            eightysix_ml_threshold: 148,
            eightysix_strategy: "hide",
            default_target_pour_cost_pct: null,
            default_target_markup_ratio: null,
          }
        : null,
      error: null,
    });
    self.then = (resolveResult: (result: { data: unknown[]; error: null }) => unknown) =>
      resolveResult({ data: immediate[table] ?? [], error: null });
    return self;
  }

  return {
    from: vi.fn((table: string) => chain(table)),
    rpc: vi.fn(async (name: string) => ({
      data: name === "list_open_bottle_items" ? mocks.compatibilityOpenRows : [],
      error: null,
    })),
  };
}

async function assembledRow(): Promise<CellarWineRow> {
  const supabase = makeSupabase();
  mocks.getAuthContext.mockResolvedValue({
    supabase,
    restaurantId: RESTAURANT_ID,
    restaurantName: "House",
    userRole: "owner",
    user: { id: "user-1" },
  });
  const element = await CellarPage();
  return (element.props as { rows: CellarWineRow[] }).rows[0]!;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.activePhysicalBottles = [];
  mocks.compatibilityOpenRows = [];
});

describe("Cellar physical-reader snapshot assembly", () => {
  it("does not restore stale compatibility volume when the exact snapshot is empty", async () => {
    mocks.compatibilityOpenRows = [compatibilityRow(600)];

    const row = await assembledRow();

    expect(row).toMatchObject({
      open_remaining_ml: 0,
      activeBottleCount: 0,
      activeOpenMl: 0,
      activeBottles: [],
    });
    expect(applyCellarQueryFilter([row], "", "open")).toEqual([]);
    expect(pickRowChip(row, 3, 2026)?.label).not.toBe("Low stock");
  });

  it("keeps a positive contract-1 identity from the exact reader", async () => {
    mocks.compatibilityOpenRows = [compatibilityRow(600)];
    mocks.activePhysicalBottles = [
      physicalBottle("33333333-3333-4333-8333-333333333333", 600),
    ];

    const row = await assembledRow();

    expect(row.open_remaining_ml).toBe(600);
    expect(row.activeOpenMl).toBe(600);
    expect(row.activeBottleCount).toBe(1);
    expect(row.activeBottles).toHaveLength(1);
  });

  it("keeps sibling count and summed volume on the same exact snapshot", async () => {
    mocks.compatibilityOpenRows = [compatibilityRow(400)];
    mocks.activePhysicalBottles = [
      physicalBottle("33333333-3333-4333-8333-333333333333", 600),
      physicalBottle("44444444-4444-4444-8444-444444444444", 400, {
        nominalCapacityMl: 750,
        identityContract: 2,
        identityOrigin: "native",
        sourceProvenance: "known",
        stateVersion: 2,
      }),
    ];

    const row = await assembledRow();

    expect(row.open_remaining_ml).toBe(1_000);
    expect(row.activeOpenMl).toBe(1_000);
    expect(row.activeBottleCount).toBe(2);
    expect(row.activeBottles).toHaveLength(2);
  });

  it("keeps stored aggregate remainder separate from theoretical remainder", () => {
    const source = readFileSync(resolve("src/app/(app)/cellar/page.tsx"), "utf8");

    expect(source).toMatch(/open_remaining_ml:\s*activeOpenMl/);
    expect(source).toMatch(/theoretical_remaining_ml:\s*directOpen\s*\?\s*theoreticalRemaining\(/);
    expect(source).toContain("buildPhysicalReconcileItems(activePhysicalBottles, wineRows ?? [])");
  });
});
