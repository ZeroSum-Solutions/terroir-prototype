import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireMembership } from "@/lib/api/auth";
import { Errors } from "@/lib/api/errors";
import { resolveSitePricingAccess } from "@/lib/api/site-capability";
import { runPricingRecommendationsRecompute } from "@/lib/pricing-recommendations/recompute";
import { parseRecomputeReceipt } from "@/lib/staff-cost/recompute-receipt";
import type { Database } from "@/types/database";

export const runtime = "nodejs";

const ServiceConfigSchema = z.object({
  url: z.url(),
  serviceKey: z.string().trim().min(1),
});

export async function POST() {
  const auth = await requireMembership();
  if (auth instanceof NextResponse) return auth;

  try {
    const access = await resolveSitePricingAccess(
      auth.supabase,
      auth.restaurantId,
    );
    if (access.canManagePricing !== true) {
      return Errors.forbidden("Pricing management access is required.");
    }
  } catch {
    return Errors.forbidden("Pricing management access is required.");
  }

  const config = ServiceConfigSchema.safeParse({
    url: process.env.NEXT_PUBLIC_SUPABASE_URL,
    serviceKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
  });
  if (!config.success) {
    console.error("pricing recommendations service-role configuration is invalid");
    return Errors.internal("Pricing recommendations recompute is unavailable.");
  }

  const admin = createSupabaseClient<Database>(
    config.data.url,
    config.data.serviceKey,
    { auth: { persistSession: false } },
  );
  try {
    const result = await runPricingRecommendationsRecompute(
      admin,
      auth.restaurantId,
      auth.user.id,
    );
    const receipt = parseRecomputeReceipt(
      result,
      "pricing_recommendations_recompute",
    );
    if (!receipt) {
      console.error("pricing recommendations recompute returned an invalid receipt");
      return Errors.internal("Pricing recommendations recompute failed.");
    }
    return NextResponse.json(receipt);
  } catch {
    console.error("pricing recommendations recompute failed");
    return Errors.internal("Pricing recommendations recompute failed.");
  }
}
