import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireAuth, requireMembership, requireOwner } from "@/lib/api/auth";
import { Errors } from "@/lib/api/errors";
import { withApiHandler } from "@/lib/api/handler";
import { parseJson, parseParams } from "@/lib/api/validation";
import { setActiveRestaurant } from "@/lib/api/active-restaurant";

export const runtime = "nodejs";

type Params = Promise<{ id: string }>;
const ParamsSchema = z.object({ id: z.string().uuid() });

export async function GET(
  _request: NextRequest,
  { params }: { params: Params },
) {
  return withApiHandler(async () => {
    const auth = await requireAuth();
    if (auth instanceof NextResponse) return auth;
    const { supabase, user } = auth;
    const parsedParams = await parseParams(params, ParamsSchema);
    if (!parsedParams.ok) return parsedParams.response;
    const { id } = parsedParams.data;

    const { data: membership, error } = await supabase
      .from("memberships")
      .select("role, restaurants(name)")
      .eq("user_id", user.id)
      .eq("restaurant_id", id)
      .maybeSingle();
    if (error) throw error;
    if (!membership) {
      return Errors.forbidden("Not a member of this restaurant.");
    }

    const restaurant = membership.restaurants as { name: string } | null;
    return NextResponse.json({
      id,
      name: restaurant?.name ?? "My Restaurant",
      role: membership.role,
    });
  });
}

export async function PUT(
  _request: NextRequest,
  { params }: { params: Params },
) {
  return withApiHandler(async () => {
    const auth = await requireAuth();
    if (auth instanceof NextResponse) return auth;
    const { supabase, user } = auth;
    const parsedParams = await parseParams(params, ParamsSchema);
    if (!parsedParams.ok) return parsedParams.response;
    const { id } = parsedParams.data;

    const result = await setActiveRestaurant(supabase, user.id, id);
    if (!result.ok) {
      if (result.reason === "not_member") {
        return Errors.forbidden("Not a member of this restaurant.");
      }
      throw result.cause;
    }
    return NextResponse.json({ ok: true, restaurantId: id });
  });
}

// BND-037b + BND-040: PATCH accepts auto-86 columns AND pricing target
// columns. BND-173: added eightysix_strategy for hide-vs-mark on /list/[slug].
const PatchSchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    auto_eightysix_from_inventory: z.boolean().optional(),
    eightysix_ml_threshold: z.number().int().min(0).max(5000).optional(),
    default_target_pour_cost_pct: z.number().gt(0).lt(100).optional(),
    default_target_markup_ratio: z.number().gte(1).lte(10).optional(),
    // BND-173 — how 86'd wines appear on public lists
    eightysix_strategy: z.enum(["hide", "mark"]).optional(),
  })
  .strict();

const PricingDefaultsReceiptSchema = z.strictObject({
  restaurantId: z.string().uuid(),
  updated: z.literal(true),
});

export async function PATCH(
  request: NextRequest,
  { params }: { params: Params },
) {
  return withApiHandler(async () => {
    const auth = await requireMembership();
    if (auth instanceof NextResponse) return auth;
    const { supabase, restaurantId, role } = auth;
    const parsedParams = await parseParams(params, ParamsSchema);
    if (!parsedParams.ok) return parsedParams.response;
    const { id } = parsedParams.data;
    if (id !== restaurantId)
      return Errors.forbidden(
        "This restaurant doesn't match your account. Refresh the page and try again.",
      );

    const parsed = await parseJson(request, PatchSchema, {
      message: "Invalid body.",
    });
    if (!parsed.ok) return parsed.response;
    if (Object.keys(parsed.data).length === 0) {
      return Errors.badRequest("No valid fields.");
    }

    const hasPricingPour = Object.prototype.hasOwnProperty.call(
      parsed.data,
      "default_target_pour_cost_pct",
    );
    const hasPricingMarkup = Object.prototype.hasOwnProperty.call(
      parsed.data,
      "default_target_markup_ratio",
    );
    const hasPricing = hasPricingPour || hasPricingMarkup;
    const safeFields = {
      ...(parsed.data.name === undefined ? {} : { name: parsed.data.name }),
      ...(parsed.data.auto_eightysix_from_inventory === undefined
        ? {}
        : { auto_eightysix_from_inventory: parsed.data.auto_eightysix_from_inventory }),
      ...(parsed.data.eightysix_ml_threshold === undefined
        ? {}
        : { eightysix_ml_threshold: parsed.data.eightysix_ml_threshold }),
      ...(parsed.data.eightysix_strategy === undefined
        ? {}
        : { eightysix_strategy: parsed.data.eightysix_strategy }),
    };

    if (hasPricing && Object.keys(safeFields).length > 0) {
      return Errors.badRequest("Pricing defaults must be updated separately.");
    }

    if (hasPricing) {
      if (parsed.data.default_target_pour_cost_pct === undefined ||
          parsed.data.default_target_markup_ratio === undefined) {
        return Errors.badRequest("Both pricing defaults are required.");
      }
      const { data: receiptRaw, error } = await supabase.rpc(
        "set_restaurant_pricing_defaults",
        {
          p_restaurant_id: restaurantId,
          p_target_pour_cost_pct: parsed.data.default_target_pour_cost_pct,
          p_target_markup_ratio: parsed.data.default_target_markup_ratio,
        },
      );
      if (error) {
        if (error.code === "42501") return Errors.forbidden();
        if (error.code === "P0002") return Errors.notFound("Restaurant");
        throw error;
      }
      const receipt = PricingDefaultsReceiptSchema.safeParse(receiptRaw);
      if (!receipt.success || receipt.data.restaurantId !== restaurantId) {
        throw new Error("Invalid restaurant pricing defaults receipt");
      }
      return NextResponse.json({ ok: true });
    }

    if (role !== "owner") {
      return Errors.forbidden("Updating restaurant settings requires owner role.");
    }

    const { error } = await supabase
      .from("restaurants")
      .update(safeFields)
      .eq("id", id);
    if (error) throw error;

    return NextResponse.json({ ok: true });
  });
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Params },
) {
  return withApiHandler(async () => {
    const auth = await requireOwner();
    if (auth instanceof NextResponse) return auth;
    const { supabase, restaurantId } = auth;
    const parsedParams = await parseParams(params, ParamsSchema);
    if (!parsedParams.ok) return parsedParams.response;
    const { id } = parsedParams.data;
    if (id !== restaurantId)
      return Errors.forbidden(
        "This restaurant doesn't match your account. Refresh the page and try again.",
      );

    const { error } = await supabase
      .from("restaurants")
      .delete()
      .eq("id", restaurantId);
    if (error) throw error;

    return NextResponse.json({ ok: true });
  });
}
