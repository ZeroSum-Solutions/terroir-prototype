import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/api/auth";
import { Errors } from "@/lib/api/errors";
import { runCellarHealthRecompute } from "@/lib/cellar-health/recompute";
import { parseRecomputeReceipt } from "@/lib/staff-cost/recompute-receipt";
import type { Database } from "@/types/database";

export const runtime = "nodejs";

const ServiceConfigSchema = z.object({
  url: z.url(),
  serviceKey: z.string().trim().min(1),
});

export async function POST() {
  const auth = await requireRole(["owner", "manager"]);
  if (auth instanceof NextResponse) return auth;

  const config = ServiceConfigSchema.safeParse({
    url: process.env.NEXT_PUBLIC_SUPABASE_URL,
    serviceKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
  });
  if (!config.success) {
    console.error("cellar health service-role configuration is missing or invalid");
    return Errors.internal("Cellar health recompute is unavailable.");
  }

  const admin = createSupabaseClient<Database>(
    config.data.url,
    config.data.serviceKey,
    { auth: { persistSession: false } },
  );
  try {
    const result = await runCellarHealthRecompute(
      admin,
      auth.restaurantId,
      auth.user.id,
    );
    const receipt = parseRecomputeReceipt(result, "cellar_health_recompute");
    if (!receipt) {
      console.error("cellar health recompute returned an invalid receipt");
      return Errors.internal("Cellar health recompute failed.");
    }
    return NextResponse.json(receipt);
  } catch {
    console.error("cellar health recompute failed");
    return Errors.internal("Cellar health recompute failed.");
  }
}
