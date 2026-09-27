import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { RecentScan } from "@/lib/scanner/types";
import { readInvoiceScanPrivate } from "@/lib/staff-cost/protected-readers";
import type { Database } from "@/types/database";

const RecentLineItemsSchema = z.array(z.object({
  qty: z.number().finite().nonnegative(),
  unitCost: z.number().finite().nonnegative(),
}).passthrough());

export async function fetchRecentScans(
  supabase: SupabaseClient<Database>,
  restaurantId: string,
  canReadCost: boolean,
): Promise<RecentScan[]> {
  const { data, error } = await supabase
    .from("invoice_scans")
    .select("id, distributor_name, item_count, accuracy_score, created_at")
    .eq("restaurant_id", restaurantId)
    .order("created_at", { ascending: false })
    .limit(5);
  if (error) throw error;

  const scans = data ?? [];
  if (!canReadCost) {
    return scans.map((scan) => ({
      id: scan.id,
      parsedAt: scan.created_at,
      distributor: scan.distributor_name,
      items: scan.item_count,
      total: null,
      accuracy: Math.round((scan.accuracy_score ?? 0) * 100),
      hasImage: null,
    }));
  }

  const privateRows = await Promise.all(
    scans.map((scan) => readInvoiceScanPrivate(supabase, scan.id)),
  );
  return scans.map((scan, index) => {
    const privateRow = privateRows[index];
    if (
      !privateRow || privateRow.scan_id !== scan.id ||
      privateRow.restaurant_id !== restaurantId
    ) {
      throw new Error("Recent scan protected read was incomplete.");
    }
    const items = RecentLineItemsSchema.parse(privateRow.final_line_items);
    return {
      id: scan.id,
      parsedAt: scan.created_at,
      distributor: scan.distributor_name,
      items: scan.item_count,
      total: items.reduce(
        (sum, item) => sum + item.qty * item.unitCost,
        0,
      ),
      accuracy: Math.round((scan.accuracy_score ?? 0) * 100),
      hasImage: privateRow.has_image,
    };
  });
}
