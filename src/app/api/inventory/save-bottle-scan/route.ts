import { NextResponse, type NextRequest } from "next/server";
import { requireMembership } from "@/lib/api/auth";
import {
  invalidIdempotencyKeyResult,
  isValidIdempotencyKey,
} from "@/lib/api/idempotency";
import { withApiHandler } from "@/lib/api/handler";
import { apiResultResponse } from "@/lib/api/result-response";
import { parseJson } from "@/lib/api/validation";
import {
  BottleInventorySaveReceiptSchema,
  decodeScanIdempotencyClaimResult,
  scanIdempotencyFailureHttpResult,
} from "@/lib/api/scan-idempotency-contract";
import { SaveBottleScanBodySchema } from "@/lib/scanner/request-schemas";

export const runtime = "nodejs";

type SaveBottleBody = {
  wine: {
    name: string;
    producer: string;
    vintage: number | null;
    varietal: string;
    region: string;
    country: string | null;
    format?: string | null;
    qty: number;
    unitCost: number;
  };
};

export async function POST(request: NextRequest) {
  return withApiHandler(() => postBottleInventorySave(request));
}

async function postBottleInventorySave(request: NextRequest) {
  const auth = await requireMembership();
  if (auth instanceof NextResponse) return auth;
  const { supabase, restaurantId, user } = auth;

  if (
    request.headers.get("X-Expected-User-Id") !== user.id ||
    request.headers.get("X-Expected-Restaurant-Id") !== restaurantId
  ) {
    return NextResponse.json({
      error: {
        code: "bottle_context_mismatch",
        message: "Bottle save context changed. No save was attempted.",
      },
    }, { status: 409 });
  }

  const rawKey = request.headers.get("Idempotency-Key");
  if (!isValidIdempotencyKey(rawKey)) {
    return apiResultResponse(invalidIdempotencyKeyResult());
  }

  const parsed = await parseJson(request, SaveBottleScanBodySchema, {
    message: "Invalid body.",
  });
  if (!parsed.ok) return parsed.response;
  const body: SaveBottleBody = parsed.data;

  let claimResponse;
  try {
    claimResponse = await supabase.rpc("claim_scan_idempotency", {
      p_restaurant_id: restaurantId,
      p_key: rawKey,
      p_kind: "bottle_inventory_save",
    });
  } catch {
    return apiResultResponse(scanIdempotencyFailureHttpResult("error"));
  }
  if (claimResponse.error) {
    const conflict = claimResponse.error.code === "P0001" &&
      claimResponse.error.message.trim() === "C04_IDEMPOTENCY_CONFLICT";
    return apiResultResponse(scanIdempotencyFailureHttpResult(
      conflict ? "conflict" : "error",
    ));
  }

  let claim;
  try {
    if (!Array.isArray(claimResponse.data) || claimResponse.data.length !== 1) {
      throw new Error("Unexpected bottle transport claim");
    }
    claim = decodeScanIdempotencyClaimResult(
      "bottle_inventory_save",
      claimResponse.data[0],
    );
  } catch {
    return apiResultResponse(scanIdempotencyFailureHttpResult("error"));
  }
  if (claim.disposition !== "claimed" && claim.disposition !== "replay") {
    return apiResultResponse(scanIdempotencyFailureHttpResult(claim.disposition));
  }

  const { wine } = body;
  const saved = await supabase.rpc("save_bottle_inventory_private", {
    p_restaurant_id: restaurantId,
    p_key: rawKey,
    p_name: wine.name,
    p_producer: wine.producer,
    p_vintage: wine.vintage,
    p_varietal: wine.varietal,
    p_region: wine.region,
    p_country: wine.country,
    p_format: wine.format ?? null,
    p_quantity: wine.qty,
    p_unit_cost: wine.unitCost,
  });
  if (saved.error) {
    if (
      saved.error.code === "P0001" &&
      saved.error.message.trim() === "C04_BOTTLE_OPERATION_CONFLICT"
    ) {
      return apiResultResponse(scanIdempotencyFailureHttpResult("conflict"));
    }
    throw new Error("Atomic bottle save failed");
  }
  const receipt = BottleInventorySaveReceiptSchema.safeParse(saved.data);
  if (!receipt.success) {
    throw new Error("Atomic bottle save returned an invalid receipt");
  }

  return NextResponse.json(receipt.data, { status: 200 });
}
