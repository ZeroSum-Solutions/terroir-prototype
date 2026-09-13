import type { HomeSnapshot } from "./home-view";

type InventoryCountRow = { quantity: number; bin_id: string | null };

export function buildHomeSnapshot(
  inventoryRows: InventoryCountRow[],
  counts: Pick<HomeSnapshot, "openBottleCount" | "reviewCount" | "eightysixedCount">,
): HomeSnapshot {
  return {
    bottleCount: inventoryRows.reduce((sum, row) => sum + row.quantity, 0),
    unbinnedBottleCount: inventoryRows.reduce(
      (sum, row) => sum + (row.bin_id == null ? row.quantity : 0),
      0,
    ),
    ...counts,
  };
}
