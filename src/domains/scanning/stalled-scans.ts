import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database } from "@/types/database";

const receiptSchema = z.object({
  version: z.literal(1),
  expiredCount: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
}).strict();

/** The database owns expiry timing, worker-lease checks and site authority. */
export async function expireStalledScans(opts: {
  supabase: SupabaseClient<Database>;
  restaurantId: string;
}): Promise<number> {
  const { data, error } = await opts.supabase.rpc("expire_stalled_invoice_scans", {
    p_restaurant_id: opts.restaurantId,
  });
  if (error) throw error;
  const receipt = receiptSchema.safeParse(data);
  if (!receipt.success) throw new Error("Invalid stalled-scan expiry receipt");
  return receipt.data.expiredCount;
}
