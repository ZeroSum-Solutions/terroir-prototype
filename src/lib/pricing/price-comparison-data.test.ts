import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import type { Database } from "@/types/database";

const readers = vi.hoisted(() => ({
  readInventoryCosts: vi.fn(),
  readWineCostFlags: vi.fn(),
}));
vi.mock("@/lib/staff-cost/protected-readers", () => readers);

import { fetchDistributorPriceRows } from "./price-comparison-data";

function fixture(rows: unknown[]) {
  const query = {
    select: vi.fn(),
    eq: vi.fn(),
    order: vi.fn(),
    range: vi.fn(async (from: number, to: number) => ({
      data: rows.slice(from, to + 1),
      error: null,
    })),
  };
  query.select.mockReturnValue(query);
  query.eq.mockReturnValue(query);
  query.order.mockReturnValue(query);
  const from = vi.fn(() => query);
  return {
    client: { from } as unknown as SupabaseClient<Database>,
    from,
    ...query,
  };
}

describe("fetchDistributorPriceRows", () => {
  it("joins typed costs and flags onto an exact cost-free direct projection", async () => {
    const row = {
      id: "inventory-a",
      quantity: 2,
      wine_id: "wine-a",
      invoice_scan_id: "scan-a",
      added_at: "2026-09-26T12:00:00+00:00",
      wines: {
        id: "wine-a",
        name: "Reserve",
        producer: "House",
        vintage: 2020,
        varietal: "Cabernet",
        retail_median: 50,
        retail_min: 40,
        retail_max: 60,
        hero_image_url: null,
        colour: "red",
      },
      invoice_scans: {
        distributor_name: "Supplier",
        invoice_date: "2026-09-20",
      },
    };
    const db = fixture([row]);
    readers.readInventoryCosts.mockResolvedValue([
      { inventory_item_id: "inventory-a", unit_cost: 18 },
    ]);
    readers.readWineCostFlags.mockResolvedValue([
      { wine_id: "wine-a", overpaid_flag: true },
    ]);

    await expect(fetchDistributorPriceRows(db.client, "restaurant-a"))
      .resolves.toEqual([expect.objectContaining({
        inventoryItemId: "inventory-a",
        unitCost: 18,
        overpaidFlag: true,
      })]);
    const projection = db.select.mock.calls[0]?.[0] as string;
    expect(projection).not.toContain("unit_cost");
    expect(projection).not.toContain("overpaid_flag");
    expect(projection).not.toContain("*");
  });

  it("rejects incomplete protected results instead of dropping price rows", async () => {
    const db = fixture([{
      id: "inventory-a",
      quantity: 2,
      wine_id: "wine-a",
      invoice_scan_id: "scan-a",
      added_at: "2026-09-26T12:00:00+00:00",
      wines: {},
      invoice_scans: {},
    }]);
    readers.readInventoryCosts.mockResolvedValue([]);
    readers.readWineCostFlags.mockResolvedValue([
      { wine_id: "wine-a", overpaid_flag: false },
    ]);

    await expect(fetchDistributorPriceRows(db.client, "restaurant-a"))
      .rejects.toThrow("protected read was incomplete");
  });
});
