import { NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { requireMembership } from "@/lib/api/auth";
import { Errors } from "@/lib/api/errors";
import { parseJson } from "@/lib/api/validation";
import { z } from "zod";

export const runtime = "nodejs";

const ParamsSchema = z.strictObject({ id: z.string().uuid() });
const BodySchema = z.strictObject({
  days: z.number().int().min(0).max(365).default(30),
}).default({ days: 30 });
const ReceiptSchema = z.strictObject({
  wineId: z.string().uuid(),
  updated: z.literal(true),
});

/**
 * BND-040 — POST /api/wines/[id]/dismiss-pricing-alert
 *
 * Dismiss the pricing-review alert for a wine. Default 30 days, mirrors
 * BND-039 snooze pattern.
 *
 * Auth: exact-site pricing.manage, enforced by the database function.
 */
export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const auth = await requireMembership();
  if (auth instanceof NextResponse) return auth;
  const { supabase, restaurantId } = auth;

  const parsedParams = ParamsSchema.safeParse(await ctx.params);
  if (!parsedParams.success) {
    return Errors.validation(parsedParams.error.issues, "Invalid wine id.");
  }
  const { id } = parsedParams.data;

  // Optional body: { days: number }. Default 30, max 365.
  // Audit-finding M2: days=0 is the unsnooze signal — clears
  // pricing_dismissed_until so the alert reappears immediately.
  const body = await parseJson(req, BodySchema, {
    allowEmpty: true,
    message: "Invalid body.",
  });
  if (!body.ok) return body.response;

  try {
    const wine = await supabase
      .from("wines")
      .select("id")
      .eq("id", id)
      .eq("restaurant_id", restaurantId)
      .maybeSingle();
    if (wine.error) return Errors.internal("Failed to dismiss alert.");
    if (!wine.data) return Errors.notFound("Wine");
  } catch {
    return Errors.internal("Failed to dismiss alert.");
  }

  const { data: receiptRaw, error: rpcError } = await supabase.rpc(
    "dismiss_pricing_alert_private",
    { p_wine_id: id, p_days: body.data.days },
  );

  if (rpcError) {
    if (rpcError.code === "42501") return Errors.forbidden();
    if (rpcError.code === "P0002") return Errors.notFound("Wine");
    Sentry.captureException(rpcError, {
      tags: { surface: "wines-dismiss-pricing", phase: "rpc" },
      extra: { wineId: id, restaurantId, days: body.data.days },
    });
    return Errors.internal("Failed to dismiss alert.");
  }
  const receipt = ReceiptSchema.safeParse(receiptRaw);
  if (!receipt.success || receipt.data.wineId !== id) {
    Sentry.captureException(new Error("Invalid pricing dismissal receipt"), {
      tags: { surface: "wines-dismiss-pricing", phase: "rpc" },
      extra: { wineId: id, restaurantId, days: body.data.days },
    });
    return Errors.internal("Failed to dismiss alert.");
  }

  return NextResponse.json(receipt.data);
}
