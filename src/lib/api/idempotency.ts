import type { SupabaseClient } from "@supabase/supabase-js";
import {
  ScanIdempotencyKeySchema,
  ScanIdempotencyReceiptSchema,
  decodeScanIdempotencyClaimResult,
  scanIdempotencyFailureHttpResult,
  scanIdempotencySuccessStatus,
  type ScanIdempotencyKind,
  type ScanIdempotencyReceipt,
} from "@/lib/api/scan-idempotency-contract";
import type { Database } from "@/types/database";

export type IdempotencyHttpResult = {
  status: number;
  body: unknown;
  replayed: boolean;
};

export type IdempotencyHandlerResult<TReceipt extends ScanIdempotencyReceipt> =
  | { outcome: "complete"; receipt: TReceipt }
  | {
      outcome: "abandon";
      response: { status: number; body: unknown };
    };

type ReceiptForKind<TKind extends ScanIdempotencyKind> = Extract<
  ScanIdempotencyReceipt,
  { kind: TKind }
>;

type RpcError = { code?: string; message?: string } | null;

export function isValidIdempotencyKey(raw: string | null): raw is string {
  return ScanIdempotencyKeySchema.safeParse(raw).success;
}

export function invalidIdempotencyKeyResult(): IdempotencyHttpResult {
  return {
    status: 400,
    body: {
      error: {
        code: "idempotency_key_required",
        message: "A valid Idempotency-Key UUID is required.",
      },
    },
    replayed: false,
  };
}

function isConflict(error: RpcError): boolean {
  return (
    error?.code === "P0001" &&
    error.message?.trim() === "C04_IDEMPOTENCY_CONFLICT"
  );
}

function singletonClaimRow(value: unknown): unknown {
  if (!Array.isArray(value) || value.length !== 1) {
    throw new Error("claim_scan_idempotency returned an unexpected result");
  }
  return value[0];
}

function receiptMatches(
  actual: ScanIdempotencyReceipt,
  expected: ScanIdempotencyReceipt,
): boolean {
  if (actual.kind !== expected.kind) return false;
  if (actual.version !== 1 || expected.version !== 1) return false;
  if (actual.status !== expected.status) return false;
  if (actual.itemCount !== expected.itemCount) return false;
  if (actual.kind === "invoice_scan_upload") {
    return (
      expected.kind === "invoice_scan_upload" &&
      actual.scanId === expected.scanId
    );
  }
  if (actual.kind === "invoice_inventory_save") {
    return (
      expected.kind === "invoice_inventory_save" &&
      actual.scanId === expected.scanId &&
      actual.wineCount === expected.wineCount
    );
  }
  return (
    expected.kind === "bottle_inventory_save" &&
    actual.wineId === expected.wineId
  );
}

function completionArgs(receipt: ScanIdempotencyReceipt) {
  if (receipt.kind === "invoice_scan_upload") {
    return {
      p_scan_id: receipt.scanId,
      p_item_count: 0,
      p_wine_count: null,
      p_wine_id: null,
    };
  }
  if (receipt.kind === "invoice_inventory_save") {
    return {
      p_scan_id: receipt.scanId,
      p_item_count: receipt.itemCount,
      p_wine_count: receipt.wineCount,
      p_wine_id: null,
    };
  }
  return {
    p_scan_id: null,
    p_item_count: 1,
    p_wine_count: null,
    p_wine_id: receipt.wineId,
  };
}

/**
 * Execute one of the three scan mutations under the actor/site/kind-bound
 * 24-hour transport cache.
 *
 * The handler explicitly distinguishes a known rolled-back/refused result
 * (`abandon`) from a successful business receipt (`complete`). An exception
 * is intentionally not abandoned: a thrown transport error can happen after
 * the database committed, so clearing the claim would invite an unsafe retry.
 * Likewise, completion failures leave the claim in progress and return a
 * fixed error rather than acknowledging an uncached mutation as successful.
 */
export async function withIdempotency<
  TKind extends ScanIdempotencyKind,
>(opts: {
  supabase: SupabaseClient<Database>;
  restaurantId: string;
  key: string;
  kind: TKind;
  handler: () => Promise<IdempotencyHandlerResult<ReceiptForKind<TKind>>>;
}): Promise<IdempotencyHttpResult> {
  const { supabase, restaurantId, key, kind, handler } = opts;
  if (!isValidIdempotencyKey(key)) return invalidIdempotencyKeyResult();

  let claimData: unknown;
  let claimError: RpcError;
  try {
    const claim = await supabase.rpc("claim_scan_idempotency", {
      p_restaurant_id: restaurantId,
      p_key: key,
      p_kind: kind,
    });
    claimData = claim.data;
    claimError = claim.error;
  } catch {
    return { ...scanIdempotencyFailureHttpResult("error"), replayed: false };
  }

  if (claimError) {
    return {
      ...scanIdempotencyFailureHttpResult(
        isConflict(claimError) ? "conflict" : "error",
      ),
      replayed: false,
    };
  }

  let claim;
  try {
    claim = decodeScanIdempotencyClaimResult(
      kind,
      singletonClaimRow(claimData),
    );
  } catch {
    return { ...scanIdempotencyFailureHttpResult("error"), replayed: false };
  }

  if (claim.disposition === "replay") {
    return {
      status: scanIdempotencySuccessStatus(claim.receipt),
      body: claim.receipt,
      replayed: true,
    };
  }
  if (claim.disposition !== "claimed") {
    return {
      ...scanIdempotencyFailureHttpResult(claim.disposition),
      replayed: false,
    };
  }

  // Do not catch handler exceptions. The outcome is uncertain until a caller
  // explicitly returns `abandon`, so the claim must remain in progress.
  const result = await handler();
  if (result.outcome === "abandon") {
    try {
      // Supabase 2.103 models scalar RPCs as a filter builder even though
      // awaiting the request yields the ordinary `{data,error}` envelope.
      const abandoned = await (supabase.rpc("abandon_scan_idempotency", {
        p_restaurant_id: restaurantId,
        p_key: key,
        p_kind: kind,
      }) as unknown as PromiseLike<{ data: boolean | null; error: RpcError }>);
      if (abandoned.error || abandoned.data !== true) {
        return { ...scanIdempotencyFailureHttpResult("error"), replayed: false };
      }
    } catch {
      return { ...scanIdempotencyFailureHttpResult("error"), replayed: false };
    }
    return { ...result.response, replayed: false };
  }

  let expectedReceipt: ReceiptForKind<TKind>;
  try {
    const parsed = ScanIdempotencyReceiptSchema.parse(result.receipt);
    if (parsed.kind !== kind) throw new Error("receipt kind mismatch");
    expectedReceipt = parsed as ReceiptForKind<TKind>;
  } catch {
    return { ...scanIdempotencyFailureHttpResult("error"), replayed: false };
  }

  try {
    const completed = await supabase.rpc("complete_scan_idempotency", {
      p_restaurant_id: restaurantId,
      p_key: key,
      p_kind: kind,
      ...completionArgs(expectedReceipt),
    } as never);
    if (completed.error) {
      return { ...scanIdempotencyFailureHttpResult("error"), replayed: false };
    }
    const storedReceipt = ScanIdempotencyReceiptSchema.parse(completed.data);
    if (!receiptMatches(storedReceipt, expectedReceipt)) {
      return { ...scanIdempotencyFailureHttpResult("error"), replayed: false };
    }
  } catch {
    return { ...scanIdempotencyFailureHttpResult("error"), replayed: false };
  }

  return {
    status: scanIdempotencySuccessStatus(expectedReceipt),
    body: expectedReceipt,
    replayed: false,
  };
}
