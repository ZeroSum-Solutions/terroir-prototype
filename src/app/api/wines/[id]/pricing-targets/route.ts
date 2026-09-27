import { NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { z } from "zod";
import { requireMembership } from "@/lib/api/auth";
import { Errors } from "@/lib/api/errors";

export const runtime = "nodejs";

/**
 * BND-040 follow-up — PATCH /api/wines/[id]/pricing-targets
 *
 * Sets per-wine overrides for pour cost % target and markup × target.
 * Allocation wines (Krug, DRC) typically need lower markup than the
 * house default, and this endpoint is the only way to set that.
 *
 * Body: { pour_cost_pct: number | null, markup_ratio: number | null }
 *   • Numbers: set the override.
 *   • null:     clear the override (revert to restaurant default).
 * Both values are required so pricing.manage never needs margin.read to
 * discover and preserve an omitted protected value.
 *
 * Range mirrors the DB CHECK constraints from migration 0026:
 *   pour_cost_pct: > 0 AND < 100
 *   markup_ratio:  >= 1 AND <= 10
 *
 * Auth: exact-site pricing.manage, enforced by the database function.
 */
const PatchSchema = z
  .object({
    pour_cost_pct: z.number().gt(0).lt(100).nullable(),
    markup_ratio: z.number().gte(1).lte(10).nullable(),
  })
  .strict();

const ParamsSchema = z.strictObject({ id: z.string().uuid() });
const ReceiptSchema = z.strictObject({
  wineId: z.string().uuid(),
  updated: z.literal(true),
});

export async function PATCH(
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

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return Errors.badRequest("Invalid JSON.");
  }

  const parsed = PatchSchema.safeParse(raw);
  if (!parsed.success) {
    return Errors.validation(parsed.error.issues, "Invalid body.");
  }

  // Both values are explicit because pricing.manage does not grant the
  // margin.read capability needed to discover and preserve a hidden peer.
  const { error: updateErr, data: receiptRaw } = await supabase.rpc(
    "set_wine_pricing_strategy",
    {
      p_restaurant_id: restaurantId,
      p_wine_id: id,
      p_target_pour_cost_pct: parsed.data.pour_cost_pct,
      p_target_markup_ratio: parsed.data.markup_ratio,
    },
  );

  if (updateErr) {
    if (updateErr.code === "42501") return Errors.forbidden();
    if (updateErr.code === "P0002") return Errors.notFound("Wine");
    Sentry.captureException(updateErr, {
      tags: { surface: "wines-pricing-targets", phase: "update" },
      extra: { wineId: id, restaurantId },
    });
    return Errors.internal("Update failed.");
  }
  const receipt = ReceiptSchema.safeParse(receiptRaw);
  if (!receipt.success || receipt.data.wineId !== id) {
    Sentry.captureException(new Error("Invalid pricing strategy receipt"), {
      tags: { surface: "wines-pricing-targets", phase: "update" },
      extra: { wineId: id, restaurantId },
    });
    return Errors.internal("Update failed.");
  }

  return NextResponse.json(receipt.data);
}
