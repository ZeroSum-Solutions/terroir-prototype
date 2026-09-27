import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  BIN_ID,
  RESTAURANT_ID,
  USER_ID,
  getRequest,
  makeSupabase,
  subjectSeed,
} from "./route.test-helpers";

const mockRequireMembership = vi.fn();
const mockResolveSiteCostReadAccess = vi.fn();
const mockReadInventoryCosts = vi.fn();
const mockReadInvoiceScanPrivate = vi.fn();
vi.mock("@/lib/api/auth", () => ({
  requireMembership: (...args: unknown[]) => mockRequireMembership(...args),
}));
vi.mock("@/lib/api/site-capability", () => ({
  resolveSiteCostReadAccess: (...args: unknown[]) =>
    mockResolveSiteCostReadAccess(...args),
}));
vi.mock("@/lib/staff-cost/protected-readers", () => ({
  readInventoryCosts: (...args: unknown[]) => mockReadInventoryCosts(...args),
  readInvoiceScanPrivate: (...args: unknown[]) =>
    mockReadInvoiceScanPrivate(...args),
}));

const { GET } = await import("./route");
type TestSupabase = ReturnType<typeof makeSupabase>;

function allow(supabase: TestSupabase) {
  mockRequireMembership.mockResolvedValue({
    supabase,
    restaurantId: RESTAURANT_ID,
    user: { id: USER_ID },
    role: "manager",
  });
  mockReadInventoryCosts.mockImplementation(async () =>
    supabase.tables.inventory_items.map((row) => ({
      inventory_item_id: row.id,
      unit_cost: row.unit_cost,
    })),
  );
  mockReadInvoiceScanPrivate.mockImplementation(async (_client: unknown, scanId: string) => {
    const row = supabase.tables.invoice_scans.find((scan) => scan.id === scanId);
    return row ? {
      scan_id: row.id,
      restaurant_id: row.restaurant_id,
      final_line_items: row.final_line_items,
    } : null;
  });
}

async function expectOpaque500(response: Response, secrets: string[] = []) {
  const body = await response.json();
  expect(response.status).toBe(500);
  expect(body).toEqual({
    error: {
      code: "internal_error",
      message: "Internal server error.",
    },
  });
  const serialized = JSON.stringify(body);
  for (const secret of secrets) expect(serialized).not.toContain(secret);
}

function ranges(supabase: TestSupabase, table: string) {
  return supabase.operations[table].filter((operation) => operation[0] === "range");
}

describe("reconcile queue GET source regressions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    mockResolveSiteCostReadAccess.mockResolvedValue(true);
  });

  afterEach(() => {
    vi.mocked(console.error).mockRestore();
  });

  it("reads complete second pages with exact inclusive ranges", async () => {
    const ids = Array.from({ length: 1_001 }, (_, index) =>
      String(index).padStart(4, "0"));
    const supabase = makeSupabase({
      bins: [{
        id: BIN_ID,
        restaurant_id: RESTAURANT_ID,
        code: "A-01",
        zone: null,
        retired_at: null,
        priority: 1,
      }],
      inventory_items: ids.map((id) => ({
        id: `inventory-${id}`,
        restaurant_id: RESTAURANT_ID,
        wine_id: `wine-${id}`,
        invoice_scan_id: null,
        bin_id: BIN_ID,
        quantity: 1,
        unit_cost: 1,
        format: "750ml",
        added_at: "2026-01-01",
      })),
      wines: ids.map((id) => ({
        id: `wine-${id}`,
        restaurant_id: RESTAURANT_ID,
        lineage_id: null,
        producer: `Producer ${id}`,
        name: `Wine ${id}`,
        vintage: 2020,
        size_ml: 750,
        lwin_id: null,
      })),
      invoice_scans: ids.map((id, index) => ({
        id: `scan-${id}`,
        restaurant_id: RESTAURANT_ID,
        distributor_name: "Supplier",
        final_line_items: index === ids.length - 1
          ? [{ id: "last-page-line", qty: 1, unitCost: 4 }]
          : [],
      })),
    });
    allow(supabase);

    const response = await GET(getRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    for (const table of ["inventory_items", "invoice_scans", "wines"]) {
      expect(ranges(supabase, table)).toEqual([
        ["range", 0, 999],
        ["range", 1_000, 1_999],
      ]);
    }
    expect(mockReadInvoiceScanPrivate).toHaveBeenCalledTimes(ids.length);
    expect(new Set(mockReadInvoiceScanPrivate.mock.calls.map((call) => call[1])))
      .toEqual(new Set(ids.map((id) => `scan-${id}`)));
    expect(body.issues.filter((issue: { kind: string }) =>
      issue.kind === "ambiguous_lineage")).toHaveLength(ids.length);
    expect(body.issues).toContainEqual(expect.objectContaining({
      kind: "unmatched_scan",
      subjectId: "scan-1000:0:last-page-line",
    }));
  });

  it("redacts a rejected capability lookup before any source read", async () => {
    const supabase = makeSupabase(subjectSeed());
    allow(supabase);
    mockResolveSiteCostReadAccess.mockRejectedValue(
      new Error("capability timeout private-marker"),
    );

    const response = await GET(getRequest());

    await expectOpaque500(response, ["capability", "private-marker"]);
    expect(supabase.from).not.toHaveBeenCalled();
    expect(mockReadInventoryCosts).not.toHaveBeenCalled();
    expect(mockReadInvoiceScanPrivate).not.toHaveBeenCalled();
  });

  it.each([
    ["inventory_items"],
    ["invoice_scans"],
    ["wines"],
    ["bins"],
    ["reconcile_batches"],
  ])("redacts a direct %s query failure without partial success", async (table) => {
    const supabase = makeSupabase(subjectSeed());
    allow(supabase);
    supabase.failNext(table, "select");

    const response = await GET(getRequest());

    await expectOpaque500(response, ["TEST_FAILURE"]);
  });

  it("redacts an inventory-cost reader rejection without partial success", async () => {
    const supabase = makeSupabase(subjectSeed());
    allow(supabase);
    mockReadInventoryCosts.mockRejectedValue(
      new Error("raw inventory cost private-marker"),
    );

    const response = await GET(getRequest());

    await expectOpaque500(response, ["raw inventory", "private-marker"]);
  });

  it.each([
    ["missing", []],
    ["duplicate", [
      { inventory_item_id: subjectSeed().inventory_items[0].id, unit_cost: 45 },
      { inventory_item_id: subjectSeed().inventory_items[0].id, unit_cost: 46 },
    ]],
  ])("redacts %s inventory-cost joins without partial success", async (_case, costs) => {
    const supabase = makeSupabase(subjectSeed());
    allow(supabase);
    mockReadInventoryCosts.mockResolvedValue(costs);

    const response = await GET(getRequest());

    await expectOpaque500(response);
  });

  it("redacts an invoice-private reader rejection without partial success", async () => {
    const supabase = makeSupabase(subjectSeed());
    allow(supabase);
    mockReadInvoiceScanPrivate.mockRejectedValue(
      new Error("raw invoice private-marker"),
    );

    const response = await GET(getRequest());

    await expectOpaque500(response, ["raw invoice", "private-marker"]);
  });

  it("redacts a missing invoice-private join without partial success", async () => {
    const supabase = makeSupabase(subjectSeed());
    allow(supabase);
    mockReadInvoiceScanPrivate.mockResolvedValue(null);

    const response = await GET(getRequest());

    await expectOpaque500(response);
  });

  it("redacts duplicate invoice-private joins without partial success", async () => {
    const seed = subjectSeed();
    seed.invoice_scans.push({
      ...seed.invoice_scans[0],
      id: "44444444-4444-4444-8444-444444444445",
    });
    const supabase = makeSupabase(seed);
    allow(supabase);
    mockReadInvoiceScanPrivate.mockImplementation(async () => ({
      scan_id: seed.invoice_scans[0].id,
      restaurant_id: RESTAURANT_ID,
      final_line_items: [],
    }));

    const response = await GET(getRequest());

    await expectOpaque500(response);
  });

  it("redacts a wrong-site invoice-private join without partial success", async () => {
    const supabase = makeSupabase(subjectSeed());
    allow(supabase);
    mockReadInvoiceScanPrivate.mockResolvedValue({
      scan_id: subjectSeed().invoice_scans[0].id,
      restaurant_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      final_line_items: [],
    });

    const response = await GET(getRequest());

    await expectOpaque500(response);
  });

  it("bounds a large scan fixture at ten concurrent protected reads", async () => {
    const scanIds = Array.from({ length: 25 }, (_, index) =>
      `scan-${String(index).padStart(2, "0")}`);
    const supabase = makeSupabase({
      invoice_scans: scanIds.map((id) => ({
        id,
        restaurant_id: RESTAURANT_ID,
        distributor_name: "Supplier",
        final_line_items: [],
      })),
    });
    allow(supabase);
    let active = 0;
    let maxActive = 0;
    const started: string[] = [];
    const pending = new Map<string, () => void>();
    mockReadInvoiceScanPrivate.mockImplementation(async (_client: unknown, scanId: string) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      started.push(scanId);
      await new Promise<void>((resolve) => pending.set(scanId, resolve));
      pending.delete(scanId);
      active -= 1;
      return { scan_id: scanId, restaurant_id: RESTAURANT_ID, final_line_items: [] };
    });
    const releasePending = () => {
      for (const release of [...pending.values()]) release();
    };

    const responsePromise = GET(getRequest());
    await vi.waitFor(() => expect(started).toHaveLength(10));
    expect(active).toBe(10);
    releasePending();
    await vi.waitFor(() => expect(started).toHaveLength(20));
    releasePending();
    await vi.waitFor(() => expect(started).toHaveLength(25));
    releasePending();

    const response = await responsePromise;
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(maxActive).toBe(10);
    expect(new Set(started)).toEqual(new Set(scanIds));
    expect(body).toEqual({
      issues: [],
      summary: { itemCount: 0, unitCount: 0, atRisk: 0 },
      latest_batch: null,
      bins: [],
    });
  });
});
