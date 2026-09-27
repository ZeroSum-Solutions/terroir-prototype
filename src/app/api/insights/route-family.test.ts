import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";

const mockRequireMembership = vi.fn();
const mockCaptureException = vi.fn();
const mockFetchDrinkWindowAlerts = vi.fn();
const mockFetchPricingAlerts = vi.fn();
const mockResolveSitePricingAccess = vi.fn();
const mockResolveSiteCostReadAccess = vi.fn();
const mockResolveSitePricingReadAccess = vi.fn();
const mockResolveSiteMarginReadAccess = vi.fn();
const mockFetchSnoozedAlerts = vi.fn();
const mockFetchInsightsScans = vi.fn();
const mockFetchInsightsInventory = vi.fn();
const mockFetchInsightsStock = vi.fn();

vi.mock("@/lib/api/auth", () => ({
  requireMembership: (...args: unknown[]) => mockRequireMembership(...args),
}));
vi.mock("@sentry/nextjs", () => ({
  captureException: (...args: unknown[]) => mockCaptureException(...args),
}));
vi.mock("@/lib/drink-window/alerts", () => ({
  fetchDrinkWindowAlerts: (...args: unknown[]) =>
    mockFetchDrinkWindowAlerts(...args),
}));
vi.mock("@/lib/pricing/alerts", () => ({
  fetchPricingAlerts: (...args: unknown[]) => mockFetchPricingAlerts(...args),
}));
vi.mock("@/lib/api/site-capability", () => ({
  resolveSitePricingAccess: (...args: unknown[]) =>
    mockResolveSitePricingAccess(...args),
  resolveSiteCostReadAccess: (...args: unknown[]) =>
    mockResolveSiteCostReadAccess(...args),
  resolveSitePricingReadAccess: (...args: unknown[]) =>
    mockResolveSitePricingReadAccess(...args),
  resolveSiteMarginReadAccess: (...args: unknown[]) =>
    mockResolveSiteMarginReadAccess(...args),
}));
vi.mock("@/domains/cellar/snoozed-alerts", () => ({
  fetchSnoozedAlerts: (...args: unknown[]) => mockFetchSnoozedAlerts(...args),
}));
vi.mock("@/lib/insights/snapshot-data", () => ({
  fetchInsightsScans: (...args: unknown[]) => mockFetchInsightsScans(...args),
  fetchInsightsInventory: (...args: unknown[]) =>
    mockFetchInsightsInventory(...args),
  fetchInsightsStock: (...args: unknown[]) => mockFetchInsightsStock(...args),
}));

const { GET: getInsights } = await import("./route");
const { GET: getInsightsCsv } = await import("./csv/route");
const { GET: getDrinkWindowAlerts } =
  await import("./drink-window-alerts/route");
const { GET: getPricingReview } = await import("./pricing-review/route");
const { GET: getSnoozed } = await import("./snoozed/route");
const { GET: getToastCsv } = await import("../export/toast-csv/route");

type QueryResult = {
  data: unknown;
  error: unknown;
};

type QueryCall = {
  table: string;
  method: string;
  args: unknown[];
};

function makeSupabase(
  results: Record<string, QueryResult | QueryResult[] | Promise<QueryResult>> = {},
) {
  const calls: QueryCall[] = [];
  const queues = new Map(
    Object.entries(results).map(([table, result]) => [
      table,
      Array.isArray(result) ? [...result] : [result],
    ]),
  );
  const from = vi.fn((table: string) => {
    const result = queues.get(table)?.shift() ?? { data: [], error: null };
    const query = {
      select: (...args: unknown[]) => {
        calls.push({ table, method: "select", args });
        return query;
      },
      eq: (...args: unknown[]) => {
        calls.push({ table, method: "eq", args });
        return query;
      },
      order: (...args: unknown[]) => {
        calls.push({ table, method: "order", args });
        return query;
      },
      range: (...args: unknown[]) => {
        calls.push({ table, method: "range", args });
        return query;
      },
      or: (...args: unknown[]) => {
        calls.push({ table, method: "or", args });
        return query;
      },
      in: (...args: unknown[]) => {
        calls.push({ table, method: "in", args });
        return query;
      },
      then: (
        resolve: (value: QueryResult) => unknown,
        reject?: (reason: unknown) => unknown,
      ) => Promise.resolve(result).then(resolve, reject),
    };
    calls.push({ table, method: "from", args: [] });
    return query;
  });
  return { from, calls };
}

function allow(supabase = makeSupabase()) {
  mockRequireMembership.mockResolvedValue({
    supabase,
    restaurantId: "restaurant-a",
    user: { id: "user-a" },
    role: "staff",
  });
  return supabase;
}

async function expectNested500(
  response: Response,
  message = "Internal server error.",
) {
  const text = await response.text();
  expect(response.status).toBe(500);
  expect(JSON.parse(text)).toEqual({
    error: { code: "internal_error", message },
  });
  expect(text).not.toContain("super-secret");
}

const routes = [
  { name: "insights", invoke: getInsights },
  { name: "insights CSV", invoke: getInsightsCsv },
  { name: "drink-window alerts", invoke: getDrinkWindowAlerts },
  { name: "pricing review", invoke: getPricingReview },
  { name: "snoozed alerts", invoke: getSnoozed },
  { name: "Toast CSV", invoke: getToastCsv },
] as const;

beforeEach(() => {
  mockResolveSitePricingAccess.mockResolvedValue({
    canReadCost: true,
    canReadMargin: false,
    canManagePricing: false,
  });
  mockResolveSiteCostReadAccess.mockResolvedValue(true);
  mockFetchInsightsScans.mockResolvedValue([]);
  mockFetchInsightsInventory.mockResolvedValue([]);
  mockFetchInsightsStock.mockResolvedValue([]);
  mockResolveSitePricingReadAccess.mockResolvedValue(true);
  mockResolveSiteMarginReadAccess.mockResolvedValue(true);
  mockFetchSnoozedAlerts.mockResolvedValue([]);
});

describe("insights and Toast route-family boundaries", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each(routes)(
    "redacts an unexpected auth failure for $name",
    async ({ invoke }) => {
      mockRequireMembership.mockRejectedValue(
        new Error("super-secret auth failure"),
      );

      const response = await invoke();

      await expectNested500(response);
      expect(mockFetchDrinkWindowAlerts).not.toHaveBeenCalled();
      expect(mockFetchPricingAlerts).not.toHaveBeenCalled();
    },
  );

  it.each(routes)(
    "preserves auth-response identity before work for $name",
    async ({ invoke }) => {
      const denial = NextResponse.json(
        { error: { code: "unauthorized", message: "Unauthorized" } },
        { status: 401 },
      );
      mockRequireMembership.mockResolvedValue(denial);

      const response = await invoke();

      expect(response).toBe(denial);
      expect(mockFetchDrinkWindowAlerts).not.toHaveBeenCalled();
      expect(mockFetchPricingAlerts).not.toHaveBeenCalled();
    },
  );
});

describe("GET /api/insights", () => {
  beforeEach(() => vi.clearAllMocks());

  it("preserves safe staff metrics without requesting cost when cost.read is unavailable", async () => {
    const supabase = allow();
    mockFetchInsightsScans.mockResolvedValue([{
      id: "scan-safe",
      distributor_name: "Safe Distributor",
      item_count: 3,
      accuracy_score: 0.8,
      created_at: new Date().toISOString(),
      final_line_items: null,
    }]);
    mockFetchInsightsStock.mockResolvedValue([
      { quantity: 7, wine_id: "wine-safe" },
    ]);
    mockResolveSiteCostReadAccess.mockResolvedValue(false);

    const response = await getInsights();
    const text = await response.text();
    const body = JSON.parse(text);

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      costDataAvailable: false,
      inventoryValue: null,
      varietalBreakdown: null,
      totalBottles: 7,
      totalScans: 1,
    });
    expect(mockFetchInsightsScans).toHaveBeenCalledWith(
      supabase,
      "restaurant-a",
      {
        includeCost: false,
        since: null,
        until: null,
      },
    );
    expect(mockFetchInsightsStock).toHaveBeenCalledWith(
      supabase,
      "restaurant-a",
    );
    expect(mockFetchInsightsInventory).not.toHaveBeenCalled();
    expect(mockResolveSiteCostReadAccess).toHaveBeenCalledWith(
      supabase,
      "restaurant-a",
    );
    expect(mockResolveSitePricingAccess).not.toHaveBeenCalled();
  });

  it("keeps an authorized protected-read failure as a redacted route error", async () => {
    allow();
    mockFetchInsightsInventory.mockRejectedValue(
      new Error("unit_cost 777 provider failure"),
    );

    const response = await getInsights();
    const text = await response.clone().text();

    await expectNested500(response, "Failed to load insights data.");
    expect(text).not.toContain("777");
    expect(mockFetchInsightsStock).not.toHaveBeenCalled();
  });

  it("attaches the scan rejection handler while the cost read is still pending", async () => {
    const scanError = new Error("super-secret scan failure");
    let resolveCost!: (rows: unknown[]) => void;
    const costPending = new Promise<unknown[]>((resolve) => {
      resolveCost = resolve;
    });
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => {
      if (reason === scanError) unhandled.push(reason);
    };
    process.on("unhandledRejection", onUnhandled);

    try {
      allow();
      mockFetchInsightsScans.mockRejectedValue(scanError);
      mockFetchInsightsInventory.mockReturnValue(costPending);

      const responsePromise = getInsights();
      await new Promise<void>((resolve) => setImmediate(resolve));

      expect(unhandled).toEqual([]);
      resolveCost([]);
      await expectNested500(await responsePromise, "Failed to load insights data.");
    } finally {
      process.off("unhandledRejection", onUnhandled);
      resolveCost?.([]);
    }
  });

  it("aggregates the complete protected inventory snapshot", async () => {
    allow();
    mockFetchInsightsInventory.mockResolvedValue([
      ...Array.from({ length: 1000 }, () => ({
        quantity: 1,
        unit_cost: 2,
        wines: { varietal: "Merlot" },
      })),
      { quantity: 17, unit_cost: 31, wines: { varietal: "Merlot" } },
    ]);
    const response = await getInsights();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ totalBottles: 1017, inventoryValue: 2527 });
  });

  it("does not turn a safe scan read error into empty metrics", async () => {
    allow();
    mockFetchInsightsScans.mockRejectedValue(
      new Error("super-secret query failure"),
    );

    await expectNested500(await getInsights(), "Failed to load insights data.");
  });

  it("preserves staff access, helper arguments, and response fields", async () => {
    const createdAt = new Date().toISOString();
    const supabase = allow();
    mockFetchInsightsScans.mockResolvedValue([{
      id: "scan-a",
      distributor_name: "Acme",
      item_count: 2,
      accuracy_score: 0.9,
      created_at: createdAt,
      final_line_items: null,
    }]);
    mockFetchInsightsInventory.mockResolvedValue([{
      quantity: 2,
      unit_cost: 30,
      wine_id: "wine-a",
      wines: { varietal: "Cabernet" },
    }]);

    const response = await getInsights();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      costDataAvailable: true,
      inventoryValue: 60,
      totalBottles: 2,
      scanCount: 1,
      totalScans: 1,
      avgAccuracy: 0.9,
      varietalBreakdown: [{ name: "Cabernet", value: 60 }],
      recentScans: [
        {
          id: "scan-a",
          distributor_name: "Acme",
          item_count: 2,
          accuracy_score: 0.9,
          created_at: createdAt,
        },
      ],
    });
    expect(mockFetchInsightsInventory).toHaveBeenCalledWith(
      supabase,
      "restaurant-a",
    );
  });
});

describe("GET /api/insights/csv", () => {
  beforeEach(() => vi.clearAllMocks());

  it("denies before every cost-bearing CSV query without cost.read", async () => {
    const supabase = allow();
    mockResolveSiteCostReadAccess.mockResolvedValue(false);

    const response = await getInsightsCsv();
    const text = await response.text();

    expect(response.status).toBe(403);
    expect(JSON.parse(text)).toEqual({
      error: {
        code: "forbidden",
        message: "Cost access is required to export insights.",
      },
    });
    expect(supabase.from).not.toHaveBeenCalled();
    expect(mockFetchInsightsScans).not.toHaveBeenCalled();
    expect(mockFetchInsightsInventory).not.toHaveBeenCalled();
    expect(mockResolveSiteCostReadAccess).toHaveBeenCalledWith(
      supabase,
      "restaurant-a",
    );
    expect(mockResolveSitePricingAccess).not.toHaveBeenCalled();
    expect(text).not.toContain("999");
  });

  it("exports all inventory and keeps thousands separators in one CSV cell", async () => {
    allow();
    mockFetchInsightsInventory.mockResolvedValue([
      ...Array.from({ length: 1000 }, () => ({ quantity: 1, unit_cost: 2, wines: { varietal: "Merlot" } })),
      { quantity: 17, unit_cost: 31, wines: { varietal: "Merlot" } },
    ]);
    const response = await getInsightsCsv();
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('Merlot,"$2,527",100%');
  });

  it("neutralizes formula-leading names and quotes carriage returns", async () => {
    allow();
    mockFetchInsightsInventory.mockResolvedValue([
      { quantity: 1, unit_cost: 2, wines: { varietal: "=1+1" } },
      { quantity: 1, unit_cost: 2, wines: { varietal: "Red\rBlend" } },
    ]);
    const response = await getInsightsCsv();
    const csv = await response.text();
    expect(csv).toContain("'=1+1,$2,50%");
    expect(csv).toContain('"Red\rBlend",$2,50%');
  });

  it.each(["scans", "inventory"])(
    "does not turn a protected $s read failure into an empty export",
    async (source) => {
      const error = new Error("super-secret CSV query failure");
      allow();
      if (source === "scans") mockFetchInsightsScans.mockRejectedValue(error);
      if (source === "inventory") mockFetchInsightsInventory.mockRejectedValue(error);

      await expectNested500(
        await getInsightsCsv(),
        "Failed to generate CSV export.",
      );
    },
  );

  it("preserves the exact CSV sections, filename, and protected helper arguments", async () => {
    const supabase = allow();
    mockFetchInsightsScans.mockResolvedValue([{
      id: "scan-a",
      distributor_name: "Acme",
      item_count: 2,
      accuracy_score: 0.9,
      created_at: "2026-01-02T00:00:00.000Z",
      final_line_items: [{ qty: 2, unitCost: 10 }],
    }]);
    mockFetchInsightsInventory.mockResolvedValue([{
      quantity: 2,
      unit_cost: 15,
      wine_id: "wine-a",
      invoice_scan_id: "scan-a",
      wines: { varietal: "Cabernet" },
    }]);

    const response = await getInsightsCsv();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    expect(response.headers.get("content-disposition")).toBe(
      'attachment; filename="insights-export.csv"',
    );
    expect(await response.text()).toBe(
      [
        "=== SCAN ACTIVITY ===",
        "Date,Distributor,Items Scanned,Accuracy,Value",
        "2026-01-02,Acme,2,90%,$20",
        "",
        "=== DISTRIBUTOR BREAKDOWN ===",
        "Distributor,Scans,Spend,Share",
        "Acme,1,$30,100%",
        "",
        "=== VARIETAL BREAKDOWN ===",
        "Varietal,Value,Share",
        "Cabernet,$30,100%",
      ].join("\n"),
    );
    expect(mockFetchInsightsScans).toHaveBeenCalledWith(
      supabase,
      "restaurant-a",
      { includeCost: true, since: null, until: null },
    );
    expect(mockFetchInsightsInventory).toHaveBeenCalledWith(
      supabase,
      "restaurant-a",
    );
  });
});

describe("alert insight routes", () => {
  beforeEach(() => vi.clearAllMocks());

  it("denies pricing review before its helper without both protected reads", async () => {
    const supabase = allow();
    mockResolveSitePricingReadAccess.mockResolvedValue(false);

    const response = await getPricingReview();

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: {
        code: "forbidden",
        message: "Cost and margin access are required to view pricing alerts.",
      },
    });
    expect(mockResolveSitePricingReadAccess).toHaveBeenCalledWith(
      supabase,
      "restaurant-a",
    );
    expect(mockFetchPricingAlerts).not.toHaveBeenCalled();
  });

  it.each([
    {
      name: "drink-window",
      invoke: getDrinkWindowAlerts,
      helper: mockFetchDrinkWindowAlerts,
      message: "Failed to fetch alerts.",
    },
    {
      name: "pricing",
      invoke: getPricingReview,
      helper: mockFetchPricingAlerts,
      message: "Failed to fetch pricing alerts.",
    },
  ])(
    "redacts $name helper failures and preserves helper arguments",
    async ({ invoke, helper, message }) => {
      const supabase = allow();
      helper.mockRejectedValue(new Error("super-secret helper failure"));

      await expectNested500(await invoke(), message);
      expect(helper).toHaveBeenCalledWith(supabase, "restaurant-a");
    },
  );

  it.each([
    {
      name: "drink-window",
      invoke: getDrinkWindowAlerts,
      helper: mockFetchDrinkWindowAlerts,
      envelope: "alerts",
    },
    {
      name: "pricing",
      invoke: getPricingReview,
      helper: mockFetchPricingAlerts,
      envelope: "alerts",
    },
  ])(
    "preserves the $name success envelope",
    async ({ invoke, helper, envelope }) => {
      const supabase = allow();
      const alerts = [{ wine_id: "wine-a" }];
      helper.mockResolvedValue(alerts);

      const response = await invoke();

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ [envelope]: alerts });
      expect(helper).toHaveBeenCalledWith(supabase, "restaurant-a");
    },
  );
});

describe("GET /api/insights/snoozed", () => {
  beforeEach(() => vi.clearAllMocks());

  it("denies before the protected helper without margin.read", async () => {
    const supabase = allow();
    mockResolveSiteMarginReadAccess.mockResolvedValue(false);

    const response = await getSnoozed();

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: {
        code: "forbidden",
        message: "Margin access is required to view pricing snoozes.",
      },
    });
    expect(mockResolveSiteMarginReadAccess).toHaveBeenCalledWith(
      supabase,
      "restaurant-a",
    );
    expect(mockFetchSnoozedAlerts).not.toHaveBeenCalled();
  });

  it("returns a nested redacted protected-reader failure", async () => {
    allow();
    mockFetchSnoozedAlerts.mockRejectedValue(
      new Error("super-secret snoozed failure"),
    );

    await expectNested500(
      await getSnoozed(),
      "Failed to fetch snoozed alerts.",
    );
  });

  it("preserves active-only ordering and the snoozed envelope", async () => {
    const supabase = allow();
    mockFetchSnoozedAlerts.mockResolvedValue([
      {
        wine_id: "wine-sooner",
        name: "Sooner",
        producer: "Alpha",
        vintage: null,
        drinkWindowSnoozedUntil: null,
        pricingDismissedUntil: "2999-01-01T00:00:00.000Z",
      },
      {
        wine_id: "wine-later",
        name: "Later",
        producer: "Beta",
        vintage: 2020,
        drinkWindowSnoozedUntil: "2999-02-01T00:00:00.000Z",
        pricingDismissedUntil: null,
      },
    ]);

    const response = await getSnoozed();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      snoozed: [
        {
          wine_id: "wine-sooner",
          name: "Sooner",
          producer: "Alpha",
          vintage: null,
          drinkWindowSnoozedUntil: null,
          pricingDismissedUntil: "2999-01-01T00:00:00.000Z",
        },
        {
          wine_id: "wine-later",
          name: "Later",
          producer: "Beta",
          vintage: 2020,
          drinkWindowSnoozedUntil: "2999-02-01T00:00:00.000Z",
          pricingDismissedUntil: null,
        },
      ],
    });
    expect(mockFetchSnoozedAlerts).toHaveBeenCalledWith(
      supabase,
      "restaurant-a",
    );
  });
});

describe("GET /api/export/toast-csv", () => {
  beforeEach(() => vi.clearAllMocks());

  it.each(["wines", "wine_list_items"])(
    "does not turn a %s query error into a CSV",
    async (failedTable) => {
      const error = { message: "super-secret Toast query failure" };
      allow(
        makeSupabase({
          wines: {
            data: [
              {
                id: "wine-a",
                name: "Reserve",
                producer: "Acme",
                vintage: 2020,
                varietal: "Cabernet",
              },
            ],
            error: failedTable === "wines" ? error : null,
          },
          wine_list_items: {
            data: [],
            error: failedTable === "wine_list_items" ? error : null,
          },
        }),
      );

      await expectNested500(await getToastCsv());
    },
  );

  it("preserves Toast content, filename, tenant scope, and price lookup", async () => {
    const supabase = allow(
      makeSupabase({
        wines: {
          data: [
            {
              id: "wine-a",
              name: "Reserve",
              producer: "Acme",
              vintage: 2020,
              varietal: "Cabernet",
            },
          ],
          error: null,
        },
        wine_list_items: {
          data: [
            { wine_id: "wine-a", bottle_price: 75 },
            { wine_id: "wine-a", bottle_price: 80 },
          ],
          error: null,
        },
      }),
    );

    const response = await getToastCsv();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    expect(response.headers.get("content-disposition")).toBe(
      'attachment; filename="toast-import.csv"',
    );
    expect(await response.text()).toBe(
      [
        "Name,Menu Group,Menu Subgroup,Price,POS Name,SKU,Item Type",
        "Acme Reserve 2020,Wine,Cabernet,80.00,Reserve 2020,,Item",
      ].join("\n"),
    );
    expect(supabase.calls).toContainEqual({
      table: "wines",
      method: "eq",
      args: ["restaurant_id", "restaurant-a"],
    });
    expect(supabase.calls).toContainEqual({
      table: "wine_list_items",
      method: "in",
      args: ["wine_id", ["wine-a"]],
    });
  });
});
