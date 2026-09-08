import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { fetchInsightsHealth, fetchInsightsInventory } from "./snapshot-data";

function fixture(rows: unknown[], failedPage?: number) {
  const range = vi.fn(async (from: number, to: number) => ({
    data: from === failedPage ? null : rows.slice(from, to + 1),
    error: from === failedPage ? { message: "Page unavailable" } : null,
  }));
  const query = { select: vi.fn(), eq: vi.fn(), order: vi.fn(), range };
  query.select.mockReturnValue(query);
  query.eq.mockReturnValue(query);
  query.order.mockReturnValue(query);
  const from = vi.fn(() => query);
  return { client: { from } as unknown as SupabaseClient<Database>, from, ...query };
}

describe("Insights snapshot pagination", () => {
  it("includes stock and value beyond the first 1000 records", async () => {
    const row = { quantity: 1, unit_cost: 2, wine_id: "wine", wines: { varietal: "Merlot" } };
    const db = fixture([...Array.from({ length: 1000 }, () => row), { ...row, quantity: 17, unit_cost: 31 }]);
    const items = await fetchInsightsInventory(db.client, "restaurant-a");
    expect(items).toHaveLength(1001);
    expect(items.reduce((sum, item) => sum + item.quantity, 0)).toBe(1017);
    expect(items.reduce((sum, item) => sum + item.quantity * item.unit_cost, 0)).toBe(2527);
    expect(db.range.mock.calls).toEqual([[0, 999], [1000, 1999]]);
    expect(db.eq.mock.calls).toEqual([["restaurant_id", "restaurant-a"], ["restaurant_id", "restaurant-a"]]);
    expect(db.order.mock.calls).toEqual([["id"], ["id"]]);
  });

  it("includes health classifications beyond the first page", async () => {
    const db = fixture(Array.from({ length: 1001 }, (_, i) => ({ wine_id: String(i), segment: "ready" })));
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
    expect(await fetchInsightsInventory(fixture([]).client, "restaurant-a")).toEqual([]);
    const db = fixture(Array.from({ length: 1000 }, () => ({})));
    expect(await fetchInsightsHealth(db.client, "restaurant-a")).toHaveLength(1000);
    expect(db.range.mock.calls).toEqual([[0, 999], [1000, 1999]]);
  });
});
