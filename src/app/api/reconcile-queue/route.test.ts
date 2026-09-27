import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";
import {
  BIN_ID,
  RESTAURANT_ID,
  SCAN_ID,
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

function allow(supabase: ReturnType<typeof makeSupabase>) {
  const auth = {
    supabase,
    restaurantId: RESTAURANT_ID,
    user: { id: USER_ID },
    role: "manager",
  };
  mockRequireMembership.mockResolvedValue(auth);
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

describe("reconcile queue routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResolveSiteCostReadAccess.mockResolvedValue(true);
  });

  it("GET uses the membership gate and performs no query when denied", async () => {
    const supabase = makeSupabase({});
    mockRequireMembership.mockResolvedValue(
      NextResponse.json({ error: "denied" }, { status: 401 }),
    );

    const response = await GET(getRequest());

    expect(response.status).toBe(401);
    expect(mockRequireMembership).toHaveBeenCalledOnce();
    expect(mockResolveSiteCostReadAccess).not.toHaveBeenCalled();
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it("GET denies a manager without exact-site cost.read before protected source queries", async () => {
    const supabase = makeSupabase(subjectSeed());
    allow(supabase);
    mockResolveSiteCostReadAccess.mockResolvedValue(false);

    const response = await GET(getRequest());
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body).toEqual({
      error: {
        code: "forbidden",
        message: "Cost access is required to view the reconciliation queue.",
      },
    });
    expect(mockResolveSiteCostReadAccess).toHaveBeenCalledWith(
      supabase,
      RESTAURANT_ID,
    );
    expect(supabase.from).not.toHaveBeenCalled();
    expect(JSON.stringify(body)).not.toContain("unit_cost");
  });

  it("GET consumes scan inventory once and partitions duplicate, ambiguous, then unplaced stock", async () => {
    const scanId = SCAN_ID;
    const wines = [
      { id: "d-1", restaurant_id: RESTAURANT_ID, producer: "D", name: "Red", vintage: 2020, size_ml: 750, lineage_id: "lineage-d", lwin_id: null },
      { id: "d-2", restaurant_id: RESTAURANT_ID, producer: "D", name: "Red", vintage: 2020, size_ml: 750, lineage_id: "lineage-d", lwin_id: null },
      { id: "amb", restaurant_id: RESTAURANT_ID, producer: "A", name: "Amber", vintage: 2021, size_ml: 750, lineage_id: null, lwin_id: null },
      { id: "plain", restaurant_id: RESTAURANT_ID, producer: "P", name: "Plain", vintage: 2019, size_ml: 750, lineage_id: "lineage-p", lwin_id: null },
      { id: "scan-wine", restaurant_id: RESTAURANT_ID, producer: "S", name: "Scan", vintage: 2022, size_ml: 750, lineage_id: "lineage-s", lwin_id: null },
    ];
    const inventory = [
      { id: "d-old", restaurant_id: RESTAURANT_ID, wine_id: "d-1", invoice_scan_id: null, bin_id: null, quantity: 1, unit_cost: 9, format: "750ml", added_at: "2026-01-01" },
      { id: "d-new", restaurant_id: RESTAURANT_ID, wine_id: "d-1", invoice_scan_id: null, bin_id: null, quantity: 1, unit_cost: 11, format: "750ml", added_at: "2026-02-01" },
      { id: "d-two", restaurant_id: RESTAURANT_ID, wine_id: "d-2", invoice_scan_id: null, bin_id: BIN_ID, quantity: 3, unit_cost: 20, format: "750ml", added_at: "2026-01-01" },
      { id: "amb-i", restaurant_id: RESTAURANT_ID, wine_id: "amb", invoice_scan_id: null, bin_id: null, quantity: 4, unit_cost: 30, format: "750ml", added_at: "2026-01-01" },
      { id: "plain-i", restaurant_id: RESTAURANT_ID, wine_id: "plain", invoice_scan_id: null, bin_id: null, quantity: 1, unit_cost: 50, format: "750ml", added_at: "2026-01-01" },
      { id: "scan-i", restaurant_id: RESTAURANT_ID, wine_id: "scan-wine", invoice_scan_id: scanId, bin_id: BIN_ID, quantity: 2, unit_cost: 15, format: "750ml", added_at: "2026-01-01" },
    ];
    const line = { producer: "S", name: "Scan", vintage: 2022, qty: 2, unitCost: 15, format: "750ml" };
    const supabase = makeSupabase({
      wines,
      inventory_items: inventory,
      invoice_scans: [{
        id: scanId,
        restaurant_id: RESTAURANT_ID,
        distributor_name: "Supplier",
        final_line_items: [
          { id: "line-1", ...line },
          { id: "line-2", ...line },
          { id: "line-3", ...line, wine_id: "scan-wine" },
        ],
      }],
      bins: [
        { id: BIN_ID, restaurant_id: RESTAURANT_ID, code: "A-01", retired_at: null, priority: 1 },
        { id: "retired", restaurant_id: RESTAURANT_ID, code: "OLD", retired_at: "2026-01-01", priority: 9 },
      ],
      reconcile_batches: [{
        id: "99999999-9999-4999-8999-999999999999",
        restaurant_id: RESTAURANT_ID,
        action_count: 1,
        created_at: "2026-08-19",
        undone_at: null,
      }],
      reconcile_actions: [],
    });
    allow(supabase);

    const response = await GET(getRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mockResolveSiteCostReadAccess).toHaveBeenCalledWith(
      supabase,
      RESTAURANT_ID,
    );
    expect(supabase.operations.inventory_items).toContainEqual([
      "select",
      "id, wine_id, invoice_scan_id, bin_id, quantity, format, added_at",
    ]);
    expect(supabase.operations.invoice_scans).toContainEqual([
      "select",
      "id, distributor_name",
    ]);
    expect(supabase.operations.wines).toContainEqual([
      "select",
      "id, lineage_id, producer, name, vintage, size_ml, lwin_id",
    ]);
    expect(JSON.stringify(supabase.operations)).not.toContain('["select","*"]');
    expect(mockReadInventoryCosts).toHaveBeenCalledWith(supabase, RESTAURANT_ID);
    expect(mockReadInvoiceScanPrivate).toHaveBeenCalled();
    expect(body.issues.map((issue: { kind: string }) => issue.kind).sort()).toEqual([
      "ambiguous_lineage",
      "duplicate_suspect",
      "unmatched_scan",
      "unplaced",
    ]);
    expect(body.summary).toEqual({ itemCount: 4, unitCount: 12, atRisk: 255 });
    expect(body.issues.map((issue: { kind: string }) => issue.kind)).toEqual([
      "ambiguous_lineage",
      "duplicate_suspect",
      "unplaced",
      "unmatched_scan",
    ]);
    const duplicate = body.issues.find((issue: { kind: string }) => issue.kind === "duplicate_suspect");
    expect(duplicate).toMatchObject({
      atRisk: 55,
      units: 5,
      deepLink: "/cellar?wine=d-1",
    });
    expect(duplicate.action).toBeUndefined();
    expect(body.issues.find((issue: { kind: string }) =>
      issue.kind === "ambiguous_lineage").action).toBeUndefined();
    const unmatched = body.issues.find((issue: { kind: string }) => issue.kind === "unmatched_scan");
    expect(unmatched).toMatchObject({
      subjectId: `${SCAN_ID}:1:line-2`,
      units: 2,
      atRisk: 30,
      suggestion: {
        wineId: "scan-wine",
        basis: {
          kind: "field_match",
          fields: ["producer", "cuvee", "vintage", "format"],
        },
      },
      action: {
        type: "match_scan",
        targetId: SCAN_ID,
        payload: {
          line_index: 1,
          wine_id: "scan-wine",
          expected_line: { id: "line-2", ...line },
        },
      },
    });
    expect(body.issues.filter((issue: { kind: string }) => issue.kind === "unplaced")
      .map((issue: { subjectId: string }) => issue.subjectId)).toEqual(["plain-i"]);
    expect(body.bins.map((bin: { code: string }) => bin.code)).toEqual(["A-01"]);
    expect(body.latest_batch.id).toBe("99999999-9999-4999-8999-999999999999");
  });

  it("gives duplicate scan line ids collision-proof subject ids while retaining display metadata", async () => {
    const seed = subjectSeed();
    const duplicateLines = [
      { id: "duplicate", lwin: "1000001", qty: 1 },
      { id: "duplicate", lwin: "1000001", qty: 1 },
    ];
    seed.inventory_items = [];
    const supabase = makeSupabase({
      ...seed,
      invoice_scans: [{
        ...seed.invoice_scans[0],
        distributor_name: "Supplier",
        final_line_items: duplicateLines,
      }],
    });
    allow(supabase);

    const response = await GET(getRequest());
    const body = await response.json();

    expect(body.issues.map((issue: { subjectId: string }) => issue.subjectId)).toEqual([
      `${SCAN_ID}:0:duplicate`,
      `${SCAN_ID}:1:duplicate`,
    ]);
    expect(body.issues.map((issue: { action: { payload: { expected_line: unknown } } }) =>
      issue.action.payload.expected_line)).toEqual(duplicateLines);
  });

});
