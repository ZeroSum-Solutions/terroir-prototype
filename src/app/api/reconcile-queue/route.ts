import { NextResponse, type NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireMembership } from "@/lib/api/auth";
import { Errors } from "@/lib/api/errors";
import { withApiHandler } from "@/lib/api/handler";
import { resolveSiteCostReadAccess } from "@/lib/api/site-capability";
import {
  assembleQueue,
  type ReconcileQueueInventory,
  type ReconcileQueueScan,
  type ReconcileQueueWine,
} from "@/lib/reconcile-ledger/queue-sources";
import {
  readInventoryCosts,
  readInvoiceScanPrivate,
} from "@/lib/staff-cost/protected-readers";
import type { Database } from "@/types/database";

export const runtime = "nodejs";

type Client = SupabaseClient<Database>;
const PAGE_SIZE = 1000;

type SafeInventory = Omit<ReconcileQueueInventory, "unit_cost">;
type SafeScan = Omit<ReconcileQueueScan, "final_line_items">;

async function readPages<T>(
  query: (from: number, to: number) => PromiseLike<{
    data: T[] | null;
    error: { message: string } | null;
  }>,
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await query(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    const page = data ?? [];
    rows.push(...page);
    if (page.length < PAGE_SIZE) return rows;
  }
}

async function mapConcurrent<T, R>(
  rows: readonly T[],
  concurrency: number,
  read: (row: T) => Promise<R>,
): Promise<R[]> {
  const output = new Array<R>(rows.length);
  let next = 0;
  await Promise.all(Array.from(
    { length: Math.min(concurrency, rows.length) },
    async () => {
      for (;;) {
        const index = next++;
        if (index >= rows.length) return;
        output[index] = await read(rows[index]!);
      }
    },
  ));
  return output;
}

async function querySources(client: Client, restaurantId: string) {
  const [safeInventory, safeScans, wines, costs, bins, latest] = await Promise.all([
    readPages<SafeInventory>((from, to) => client.from("inventory_items")
      .select("id, wine_id, invoice_scan_id, bin_id, quantity, format, added_at")
      .eq("restaurant_id", restaurantId).gt("quantity", 0)
      .order("id").range(from, to)),
    readPages<SafeScan>((from, to) => client.from("invoice_scans")
      .select("id, distributor_name").eq("restaurant_id", restaurantId)
      .order("id").range(from, to)),
    readPages<ReconcileQueueWine>((from, to) => client.from("wines")
      .select("id, lineage_id, producer, name, vintage, size_ml, lwin_id")
      .eq("restaurant_id", restaurantId).order("id").range(from, to)),
    readInventoryCosts(client, restaurantId),
    client.from("bins").select("id, code, zone").eq("restaurant_id", restaurantId)
      .is("retired_at", null).order("priority", { ascending: false }),
    client.from("reconcile_batches").select("id, action_count, created_at")
      .eq("restaurant_id", restaurantId)
      .is("undone_at", null).order("created_at", { ascending: false })
      .limit(1).maybeSingle(),
  ]);
  if (bins.error || latest.error) {
    throw new Error("Reconcile queue source query failed.");
  }
  const privateScans = await mapConcurrent(safeScans, 10, (scan) =>
    readInvoiceScanPrivate(client, scan.id));
  const privateByScanId = new Map(privateScans.map((row) => [row?.scan_id, row]));
  if (
    privateByScanId.size !== privateScans.length ||
    safeScans.some((scan) => {
      const row = privateByScanId.get(scan.id);
      return !row || row.restaurant_id !== restaurantId;
    })
  ) {
    throw new Error("Reconcile scan protected read was incomplete.");
  }
  const costByInventoryId = new Map(
    costs.map((row) => [row.inventory_item_id, row.unit_cost]),
  );
  if (
    costByInventoryId.size !== costs.length ||
    safeInventory.some((row) => !costByInventoryId.has(row.id))
  ) {
    throw new Error("Reconcile inventory protected read was incomplete.");
  }
  const inventory: ReconcileQueueInventory[] = safeInventory.map((row) => ({
    ...row,
    unit_cost: costByInventoryId.get(row.id)!,
  }));
  const scans: ReconcileQueueScan[] = safeScans.map((row) => ({
    ...row,
    final_line_items: privateByScanId.get(row.id)!.final_line_items,
  }));
  return {
    inventory,
    scans,
    wines,
    bins: bins.data,
    latestBatch: latest.data,
  };
}

export async function GET(_request: NextRequest) {
  return withApiHandler(async () => {
    const auth = await requireMembership();
    if (auth instanceof NextResponse) return auth;
    const canReadCost = await resolveSiteCostReadAccess(
      auth.supabase,
      auth.restaurantId,
    );
    if (!canReadCost) {
      return Errors.forbidden(
        "Cost access is required to view the reconciliation queue.",
      );
    }
    const sources = await querySources(auth.supabase, auth.restaurantId);
    const queue = assembleQueue(sources.inventory, sources.scans, sources.wines);
    return NextResponse.json({
      issues: queue.rows,
      summary: queue.summary,
      latest_batch: sources.latestBatch,
      bins: sources.bins,
    });
  });
}
