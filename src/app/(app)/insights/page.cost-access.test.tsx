import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getAuthContext: vi.fn(),
  resolveSitePricingAccess: vi.fn(),
  captureException: vi.fn(),
  fetchDrinkWindowAlerts: vi.fn(),
  fetchPricingAlerts: vi.fn(),
  fetchSnoozedAlerts: vi.fn(),
  fetchDrinkWindowSnoozedAlerts: vi.fn(),
  fetchPastDrinkWindow: vi.fn(),
  fetchPricingRecommendations: vi.fn(),
  fetchInsightsScans: vi.fn(),
  fetchInsightsInventory: vi.fn(),
  fetchInsightsStock: vi.fn(),
  fetchInsightsHealth: vi.fn(),
  fetchYieldGroups: vi.fn(),
}));

vi.mock("@/lib/auth-context", () => ({
  getAuthContext: (...args: unknown[]) => mocks.getAuthContext(...args),
}));
vi.mock("@/lib/api/site-capability", () => ({
  resolveSitePricingAccess: (...args: unknown[]) =>
    mocks.resolveSitePricingAccess(...args),
}));
vi.mock("@sentry/nextjs", () => ({
  captureException: (...args: unknown[]) => mocks.captureException(...args),
}));
vi.mock("@/lib/drink-window/alerts", () => ({
  fetchDrinkWindowAlerts: (...args: unknown[]) =>
    mocks.fetchDrinkWindowAlerts(...args),
}));
vi.mock("@/lib/pricing/alerts", () => ({
  fetchPricingAlerts: (...args: unknown[]) => mocks.fetchPricingAlerts(...args),
}));
vi.mock("@/domains/cellar/snoozed-alerts", () => ({
  fetchSnoozedAlerts: (...args: unknown[]) => mocks.fetchSnoozedAlerts(...args),
  fetchDrinkWindowSnoozedAlerts: (...args: unknown[]) =>
    mocks.fetchDrinkWindowSnoozedAlerts(...args),
}));
vi.mock("@/domains/cellar/past-drink-window", () => ({
  fetchPastDrinkWindow: (...args: unknown[]) =>
    mocks.fetchPastDrinkWindow(...args),
}));
vi.mock("@/lib/pricing-recommendations/fetch", () => ({
  fetchPricingRecommendations: (...args: unknown[]) =>
    mocks.fetchPricingRecommendations(...args),
}));
vi.mock("@/lib/insights/snapshot-data", () => ({
  fetchInsightsScans: (...args: unknown[]) => mocks.fetchInsightsScans(...args),
  fetchInsightsInventory: (...args: unknown[]) =>
    mocks.fetchInsightsInventory(...args),
  fetchInsightsStock: (...args: unknown[]) => mocks.fetchInsightsStock(...args),
  fetchInsightsHealth: (...args: unknown[]) => mocks.fetchInsightsHealth(...args),
}));
vi.mock("./yield-report-section", () => ({
  fetchYieldGroups: (...args: unknown[]) => mocks.fetchYieldGroups(...args),
  YieldReportSection: () => <div>Safe yield activity</div>,
}));
vi.mock("./date-range-selector", () => ({ default: () => <div>Date range</div> }));
vi.mock("./insights-drilldown", () => ({
  TodayStrip: () => <div>Today activity</div>,
  selectTodayExceptions: (rows: unknown[]) => rows,
}));
vi.mock("./reconcile-queue-metric", () => ({
  ReconcileQueueMetric: () => <div>Reconcile state</div>,
}));
vi.mock("./pour-analytics-section", () => ({
  default: () => <div>Safe pour analytics</div>,
}));
vi.mock("./cellar-health-panel", () => ({
  CellarHealthPanel: () => <div>Cost cellar health</div>,
}));
vi.mock("./pricing-plays-section", () => ({
  PricingPlaysSection: () => <div>Pricing plays loaded</div>,
}));
vi.mock("./pricing-review-card", () => ({
  PricingReviewCard: () => <div>Pricing review loaded</div>,
}));
vi.mock("./snoozed-alerts-card", () => ({
  SnoozedAlertsCard: () => <div>Snoozed alerts loaded</div>,
}));
vi.mock("@/components/charts/sparkline", () => ({
  Sparkline: () => <div>Scan trend</div>,
}));
vi.mock("@/components/charts/throughput-bar-chart", () => ({
  ThroughputBarChart: () => <div>Scan throughput chart</div>,
}));

const { default: InsightsPage } = await import("./page");

const scan = {
  id: "scan-1",
  distributor_name: "Safe Distributor",
  item_count: 3,
  accuracy_score: 0.9,
  created_at: "2026-09-20T00:00:00.000Z",
  final_line_items: [{ qty: 2, unitCost: 40 }],
};

function makeSupabase() {
  return {
    from: vi.fn(() => {
      const query = {
        select: vi.fn(),
        eq: vi.fn(),
        lte: vi.fn(),
        then: (resolve: (value: { count: number; data: null; error: null }) => unknown) =>
          Promise.resolve({ count: 0, data: null, error: null }).then(resolve),
      };
      query.select.mockReturnValue(query);
      query.eq.mockReturnValue(query);
      query.lte.mockReturnValue(query);
      return query;
    }),
  };
}

function renderPage(node: React.ReactNode) {
  const container = document.createElement("div");
  container.innerHTML = renderToStaticMarkup(node);
  return container;
}

function setAccess(overrides: Partial<{
  canReadCost: boolean;
  canReadMargin: boolean;
  canManagePricing: boolean;
}>) {
  mocks.resolveSitePricingAccess.mockResolvedValue({
    canReadCost: false,
    canReadMargin: false,
    canManagePricing: false,
    ...overrides,
  });
}

describe("Insights page cost access", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const supabase = makeSupabase();
    mocks.getAuthContext.mockResolvedValue({
      supabase,
      restaurantId: "restaurant-a",
      restaurantName: "House",
      userRole: "staff",
    });
    setAccess({});
    mocks.fetchDrinkWindowAlerts.mockResolvedValue([]);
    mocks.fetchPricingAlerts.mockResolvedValue([]);
    mocks.fetchSnoozedAlerts.mockResolvedValue([]);
    mocks.fetchDrinkWindowSnoozedAlerts.mockResolvedValue([]);
    mocks.fetchPastDrinkWindow.mockResolvedValue([]);
    mocks.fetchPricingRecommendations.mockResolvedValue([]);
    mocks.fetchInsightsScans.mockResolvedValue([scan]);
    mocks.fetchInsightsInventory.mockResolvedValue([
      {
        quantity: 2,
        unit_cost: 30,
        wine_id: "wine-1",
        wines: { varietal: "Cabernet" },
      },
    ]);
    mocks.fetchInsightsStock.mockResolvedValue([
      { quantity: 7, wine_id: "wine-1" },
    ]);
    mocks.fetchInsightsHealth.mockResolvedValue([]);
    mocks.fetchYieldGroups.mockResolvedValue([]);
  });

  it("keeps safe staff activity while cost analytics and CSV are unavailable", async () => {
    const container = renderPage(
      await InsightsPage({ searchParams: Promise.resolve({}) }),
    );

    expect(container.textContent).toContain(
      "Cost analytics could not be loaded for this site.",
    );
    expect(container.textContent).toContain("Unavailable");
    expect(container.textContent).toContain("7");
    expect(container.textContent).toContain("Safe Distributor");
    expect(container.textContent).toContain("Safe yield activity");
    expect(container.textContent).toContain("Safe pour analytics");
    expect(container.textContent).not.toContain("Spend by varietal");
    expect(container.textContent).not.toContain("Top distributors");
    expect(container.textContent).not.toContain("$0");
    expect(container.querySelector('a[href="/api/insights/csv"]')).toBeNull();
    expect(mocks.fetchInsightsInventory).not.toHaveBeenCalled();
    expect(mocks.fetchInsightsHealth).not.toHaveBeenCalled();
    expect(mocks.fetchPricingAlerts).not.toHaveBeenCalled();
    expect(mocks.fetchPricingRecommendations).not.toHaveBeenCalled();
    expect(mocks.fetchDrinkWindowSnoozedAlerts).toHaveBeenCalled();
    expect(mocks.fetchInsightsScans).toHaveBeenCalledWith(
      expect.anything(),
      "restaurant-a",
      expect.objectContaining({ includeCost: false }),
    );
  });

  it("restores cost analytics for cost.read without exposing pricing modules", async () => {
    setAccess({ canReadCost: true });

    const container = renderPage(
      await InsightsPage({ searchParams: Promise.resolve({}) }),
    );

    expect(container.textContent).toContain("$60");
    expect(container.querySelector('a[href="/api/insights/csv"]')).not.toBeNull();
    expect(mocks.fetchInsightsInventory).toHaveBeenCalled();
    expect(mocks.fetchInsightsHealth).toHaveBeenCalled();
    expect(mocks.fetchPricingAlerts).not.toHaveBeenCalled();
    expect(mocks.fetchPricingRecommendations).not.toHaveBeenCalled();
    expect(container.textContent).toContain(
      "Pricing insights could not be loaded for this site.",
    );
  });

  it("falls back to safe projections when a protected cost read fails", async () => {
    const error = new Error("unit_cost 777 failed");
    setAccess({ canReadCost: true });
    mocks.fetchInsightsInventory.mockRejectedValue(error);

    const container = renderPage(
      await InsightsPage({ searchParams: Promise.resolve({}) }),
    );

    expect(container.textContent).toContain(
      "Cost analytics could not be loaded for this site.",
    );
    expect(container.textContent).not.toContain("777");
    expect(mocks.fetchInsightsStock).toHaveBeenCalled();
    expect(mocks.fetchInsightsScans).toHaveBeenLastCalledWith(
      expect.anything(),
      "restaurant-a",
      expect.objectContaining({ includeCost: false }),
    );
    expect(mocks.captureException).toHaveBeenCalledWith(
      error,
      expect.objectContaining({ tags: { surface: "insights-page", phase: "cost-fetch" } }),
    );
  });

  it("uses margin.read for strategy snooze timing without treating it as cost access", async () => {
    setAccess({ canReadMargin: true });

    const container = renderPage(
      await InsightsPage({ searchParams: Promise.resolve({}) }),
    );

    expect(mocks.fetchSnoozedAlerts).toHaveBeenCalled();
    expect(mocks.fetchDrinkWindowSnoozedAlerts).not.toHaveBeenCalled();
    expect(mocks.fetchInsightsInventory).not.toHaveBeenCalled();
    expect(container.querySelector('a[href="/api/insights/csv"]')).toBeNull();
  });

  it("does not present failed dual-read pricing data as a healthy empty state", async () => {
    const error = new Error("pricing provider failed");
    setAccess({ canReadCost: true, canReadMargin: true });
    mocks.fetchPricingAlerts.mockRejectedValue(error);

    const container = renderPage(
      await InsightsPage({ searchParams: Promise.resolve({}) }),
    );

    expect(mocks.fetchPricingAlerts).toHaveBeenCalled();
    expect(mocks.fetchPricingRecommendations).toHaveBeenCalled();
    expect(container.textContent).toContain(
      "Pricing insights could not be loaded for this site.",
    );
    expect(container.textContent).not.toContain("No pricing plays yet");
    expect(mocks.captureException).toHaveBeenCalledWith(
      error,
      expect.objectContaining({ tags: { surface: "insights-page", phase: "pricing-fetch" } }),
    );
  });

  it("renders successful pricing modules with both reads and pricing.manage", async () => {
    setAccess({ canReadCost: true, canReadMargin: true, canManagePricing: true });
    mocks.fetchPricingAlerts.mockResolvedValue([{
      wine_id: "wine-1",
      name: "Reserve",
      producer: "House",
      vintage: 2020,
    }]);
    mocks.fetchPricingRecommendations.mockResolvedValue([{ wineId: "wine-1" }]);

    const container = renderPage(
      await InsightsPage({ searchParams: Promise.resolve({}) }),
    );

    expect(container.textContent).toContain("Pricing plays loaded");
    expect(container.textContent).toContain("Pricing review loaded");
    expect(container.textContent).not.toContain(
      "Pricing insights could not be loaded for this site.",
    );
  });

  it("keeps a safe-source failure as a real page error", async () => {
    const error = new Error("safe stock failed");
    mocks.fetchInsightsStock.mockRejectedValue(error);

    await expect(
      InsightsPage({ searchParams: Promise.resolve({}) }),
    ).rejects.toBe(error);
  });
});
