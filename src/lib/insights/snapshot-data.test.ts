import { describe, expect, it, vi } from "vitest";
const protectedReaders = vi.hoisted(() => ({
  readCellarHealthPrivate: vi.fn(),
  readInventoryCosts: vi.fn(),
  readInvoiceScanPrivate: vi.fn(),
}));
vi.mock("@/lib/staff-cost/protected-readers", () => protectedReaders);
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import {
  fetchInsightsHealth,
  fetchInsightsInventory,
  fetchInsightsScans,
  fetchInsightsStock,
} from "./snapshot-data";

function fixture(rows: unknown[], failedPage?: number) {
  const range = vi.fn(async (from: number, to: number) => ({
    data: from === failedPage ? null : rows.slice(from, to + 1),
    error: from === failedPage ? { message: "Page unavailable" } : null,
  }));
  const query = {
    select: vi.fn(),
    eq: vi.fn(),
    order: vi.fn(),
    gte: vi.fn(),
    lte: vi.fn(),
    range,
  };
  query.select.mockReturnValue(query);
  query.eq.mockReturnValue(query);
  query.order.mockReturnValue(query);
  query.gte.mockReturnValue(query);
  query.lte.mockReturnValue(query);
  const from = vi.fn(() => query);
  return { client: { from } as unknown as SupabaseClient<Database>, from, ...query };
}

describe("Insights snapshot pagination", () => {
  it("includes stock and value beyond the first 1000 records", async () => {
    const rows = Array.from({ length: 1001 }, (_, index) => ({
      id: `inventory-${index}`,
      quantity: index === 1000 ? 17 : 1,
      wine_id: "wine",
      invoice_scan_id: null,
      wines: { varietal: "Merlot" },
    }));
    protectedReaders.readInventoryCosts.mockResolvedValue(rows.map((row, index) => ({
      inventory_item_id: row.id,
      unit_cost: index === 1000 ? 31 : 2,
    })));
    const db = fixture(rows);
    const items = await fetchInsightsInventory(db.client, "restaurant-a");
    expect(items).toHaveLength(1001);
    expect(items.reduce((sum, item) => sum + item.quantity, 0)).toBe(1017);
    expect(items.reduce((sum, item) => sum + item.quantity * item.unit_cost, 0)).toBe(2527);
    expect(db.range.mock.calls).toEqual([[0, 999], [1000, 1999]]);
    expect(db.eq.mock.calls).toEqual([["restaurant_id", "restaurant-a"], ["restaurant_id", "restaurant-a"]]);
    expect(db.order.mock.calls).toEqual([["id"], ["id"]]);
    expect(db.select).toHaveBeenCalledWith(
      "id, quantity, wine_id, invoice_scan_id, wines(varietal)",
    );
  });

  it("includes health classifications beyond the first page", async () => {
    const rows = Array.from({ length: 1001 }, (_, i) => ({
      id: `health-${i}`,
      wine_id: String(i),
      computed_at: "2026-09-26T12:00:00+00:00",
    }));
    protectedReaders.readCellarHealthPrivate.mockResolvedValue(rows.map((row) => ({
      health_id: row.id,
      wine_id: row.wine_id,
      segment: "healthy",
    })));
    const db = fixture(rows);
    expect(await fetchInsightsHealth(db.client, "restaurant-b")).toHaveLength(1001);
    expect(db.from.mock.calls).toEqual([["cellar_health"], ["cellar_health"]]);
    expect(db.eq.mock.calls).toEqual([["restaurant_id", "restaurant-b"], ["restaurant_id", "restaurant-b"]]);
    expect(db.order.mock.calls).toEqual([["wine_id"], ["wine_id"]]);
  });

  it.each([fetchInsightsInventory, fetchInsightsHealth])("refuses partial totals when a later page fails", async (fetchSnapshot) => {
    const db = fixture(Array.from({ length: 1000 }, () => ({})), 1000);
    await expect(fetchSnapshot(db.client, "restaurant-a")).rejects.toEqual({ message: "Page unavailable" });
  });

  it("handles empty data and an exact page boundary", async () => {
    protectedReaders.readInventoryCosts.mockResolvedValue([]);
    expect(await fetchInsightsInventory(fixture([]).client, "restaurant-a")).toEqual([]);
    const rows = Array.from({ length: 1000 }, (_, index) => ({
      id: `health-${index}`,
      wine_id: `wine-${index}`,
      computed_at: "2026-09-26T12:00:00+00:00",
    }));
    protectedReaders.readCellarHealthPrivate.mockResolvedValue(rows.map((row) => ({
      health_id: row.id,
      wine_id: row.wine_id,
      segment: "healthy",
    })));
    const db = fixture(rows);
    expect(await fetchInsightsHealth(db.client, "restaurant-a")).toHaveLength(1000);
    expect(db.range.mock.calls).toEqual([[0, 999], [1000, 1999]]);
  });

  it("uses an explicit cost-free stock projection", async () => {
    const db = fixture([{ quantity: 4, wine_id: "wine-a" }]);

    await fetchInsightsStock(db.client, "restaurant-a");

    expect(db.from).toHaveBeenCalledWith("inventory_items");
    expect(db.select).toHaveBeenCalledWith("quantity, wine_id");
    expect(db.eq).toHaveBeenCalledWith("restaurant_id", "restaurant-a");
    expect(db.select.mock.calls.flat().join(" ")).not.toContain("unit_cost");
  });

  it("keeps invoice cost JSON out of safe scans and includes it only for cost reads", async () => {
    const safe = fixture([]);
    const cost = fixture([]);

    await fetchInsightsScans(safe.client, "restaurant-a", {
      includeCost: false,
      since: new Date("2026-09-01T00:00:00.000Z"),
      until: new Date("2026-09-30T23:59:59.999Z"),
    });
    await fetchInsightsScans(cost.client, "restaurant-a", {
      includeCost: true,
      since: null,
      until: null,
    });

    expect(safe.select.mock.calls.flat().join(" ")).not.toContain(
      "final_line_items",
    );
    expect(cost.select.mock.calls.flat().join(" ")).not.toContain(
      "final_line_items",
    );
    expect(safe.gte).toHaveBeenCalledWith(
      "created_at",
      "2026-09-01T00:00:00.000Z",
    );
    expect(safe.lte).toHaveBeenCalledWith(
      "created_at",
      "2026-09-30T23:59:59.999Z",
    );
  });

  it("merges private scan JSON only when the protected reader returns the exact scan and site", async () => {
    const scanId = "11111111-1111-4111-8111-111111111111";
    const restaurantId = "22222222-2222-4222-8222-222222222222";
    const safeRow = {
      id: scanId,
      distributor_name: "Safe Distributor",
      item_count: 1,
      accuracy_score: 0.9,
      created_at: "2026-09-26T12:00:00+00:00",
    };
    protectedReaders.readInvoiceScanPrivate.mockResolvedValue({
      scan_id: scanId,
      restaurant_id: restaurantId,
      final_line_items: [{ qty: 1, unitCost: 42 }],
    });

    await expect(fetchInsightsScans(fixture([safeRow]).client, restaurantId, {
      includeCost: true,
      since: null,
      until: null,
    })).resolves.toEqual([{
      ...safeRow,
      final_line_items: [{ qty: 1, unitCost: 42 }],
    }]);

    protectedReaders.readInvoiceScanPrivate.mockResolvedValue({
      scan_id: scanId,
      restaurant_id: "33333333-3333-4333-8333-333333333333",
      final_line_items: [],
    });
    await expect(fetchInsightsScans(fixture([safeRow]).client, restaurantId, {
      includeCost: true,
      since: null,
      until: null,
    })).rejects.toThrow("protected read was incomplete");
  });
});
