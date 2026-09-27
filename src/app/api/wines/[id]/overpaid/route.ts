import { NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { requireMembership } from "@/lib/api/auth";
import { Errors } from "@/lib/api/errors";
import { z } from "zod";

export const runtime = "nodejs";

const ParamsSchema = z.strictObject({ id: z.string().uuid() });
const BodySchema = z.strictObject({ flag: z.boolean() });
const ReceiptSchema = z.strictObject({
  wineId: z.string().uuid(),
  updated: z.literal(true),
});

/**
 * BND-139 — POST /api/wines/[id]/overpaid
 *
 * Set the overpaid_flag on a wine for follow-up.
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

  const bodyRaw = await req.json().catch(() => null);
  const body = BodySchema.safeParse(bodyRaw);
  if (!body.success) return Errors.validation(body.error.issues, "Invalid body.");

  const { data: receiptRaw, error: updateErr } = await supabase.rpc(
    "set_wine_overpaid_flag",
    {
      p_restaurant_id: restaurantId,
      p_wine_id: id,
      p_flag: body.data.flag,
    },
  );

  if (updateErr) {
    if (updateErr.code === "42501") return Errors.forbidden();
    if (updateErr.code === "P0002") return Errors.notFound("Wine");
    Sentry.captureException(updateErr, {
      tags: { surface: "wines-overpaid", phase: "update" },
      extra: { wineId: id, restaurantId },
    });
    return Errors.internal("Failed to update flag.");
  }
  const receipt = ReceiptSchema.safeParse(receiptRaw);
  if (!receipt.success || receipt.data.wineId !== id) {
    Sentry.captureException(new Error("Invalid overpaid flag receipt"), {
      tags: { surface: "wines-overpaid", phase: "update" },
      extra: { wineId: id, restaurantId },
    });
    return Errors.internal("Failed to update flag.");
  }

  return NextResponse.json(receipt.data);
}
