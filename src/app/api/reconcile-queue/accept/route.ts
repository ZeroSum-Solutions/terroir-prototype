import { NextResponse, type NextRequest } from "next/server";
import { requireRole } from "@/lib/api/auth";
import { apiError, Errors } from "@/lib/api/errors";
import { withApiHandler } from "@/lib/api/handler";
import { isValidIdempotencyKey } from "@/lib/api/idempotency";
import {
  AcceptActionsSchema,
  AcceptReconcileReceiptSchema,
  MAX_RECONCILE_ACTION_BYTES,
  type ReconcileAction,
} from "@/lib/reconcile-ledger";

export const runtime = "nodejs";

type RpcError = { code?: string; message?: string };

export async function POST(request: NextRequest) {
  return withApiHandler(async () => {
    const auth = await requireRole(["owner", "manager"]);
    if (auth instanceof NextResponse) return auth;

    if (
      request.headers.get("X-Expected-User-Id") !== auth.user.id ||
      request.headers.get("X-Expected-Restaurant-Id") !== auth.restaurantId
    ) {
      return contextMismatch();
    }

    const key = request.headers.get("Idempotency-Key");
    if (!isValidIdempotencyKey(key)) {
      return Errors.badRequest(
        "A valid UUID Idempotency-Key header is required.",
        undefined,
        "invalid_idempotency_key",
      );
    }

    const parsed = await parseActions(request);
    if (!parsed.ok) return parsed.response;

    let result;
    try {
      result = await auth.supabase.rpc("accept_reconcile_batch", {
        p_restaurant_id: auth.restaurantId,
        p_actions: parsed.data,
        p_idempotency_key: key,
      });
    } catch {
      return Errors.internal("Reconciliation failed.");
    }
    if (result.error) return rpcFailure(result.error);

    const receipt = AcceptReconcileReceiptSchema.safeParse(result.data);
    if (
      !receipt.success ||
      receipt.data.batchId !== key ||
      receipt.data.actionCount !== parsed.data.length
    ) {
      return Errors.internal("Reconciliation failed.");
    }
    return NextResponse.json(receipt.data, { status: 201 });
  });
}

type AcceptParseResult =
  | { ok: true; data: ReconcileAction[] }
  | { ok: false; response: NextResponse };

async function parseActions(request: Request): Promise<AcceptParseResult> {
  if (declaredBodyTooLarge(request.headers.get("Content-Length"))) {
    return { ok: false, response: actionPayloadTooLarge() };
  }

  const reader = request.body?.getReader();
  if (!reader) return { ok: false, response: Errors.invalidJson() };
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const parts: string[] = [];
  let byteLength = 0;

  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      byteLength += chunk.value.byteLength;
      if (byteLength > MAX_RECONCILE_ACTION_BYTES) {
        try {
          await reader.cancel();
        } catch {
          // The fixed refusal is still safe if the upstream stream cannot cancel.
        }
        return { ok: false, response: actionPayloadTooLarge() };
      }
      parts.push(decoder.decode(chunk.value, { stream: true }));
    }
    parts.push(decoder.decode());
  } catch {
    return { ok: false, response: Errors.invalidJson() };
  } finally {
    reader.releaseLock();
  }

  const text = parts.join("");
  if (text.trim() === "") {
    return { ok: false, response: Errors.invalidJson() };
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return { ok: false, response: Errors.invalidJson() };
  }
  const parsed = AcceptActionsSchema.safeParse(value);
  return parsed.success
    ? { ok: true, data: parsed.data }
    : { ok: false, response: Errors.validation(parsed.error.issues) };
}

function declaredBodyTooLarge(value: string | null): boolean {
  const normalized = value?.trim();
  if (!normalized || !/^\d+$/.test(normalized)) return false;
  try {
    return BigInt(normalized) > BigInt(MAX_RECONCILE_ACTION_BYTES);
  } catch {
    return false;
  }
}

function actionPayloadTooLarge() {
  return Errors.tooLarge("Action payload exceeds 2 MB.");
}

function contextMismatch() {
  return apiError(
    409,
    "reconcile_context_mismatch",
    "Reconciliation context changed. No action was attempted.",
  );
}

function rpcFailure(error: RpcError) {
  const pair = `${error.code ?? ""}:${error.message?.trim() ?? ""}`;
  switch (pair) {
    case "42501:forbidden":
      return Errors.forbidden();
    case "P0001:C04_RECONCILE_BATCH_INVALID":
    case "P0001:C04_RECONCILE_ACTION_INVALID":
    case "P0001:C04_RECONCILE_DUPLICATE_SUBJECT":
      return Errors.badRequest("Invalid input.", undefined, "validation_error");
    case "P0002:reconcile_subject_not_found":
      return Errors.notFound("Reconcile subject");
    case "P0001:reconcile_subject_conflict":
    case "P0001:C04_RECONCILE_IDEMPOTENCY_CONFLICT":
    case "23505:reconcile_batch_conflict":
      return Errors.conflict(
        "reconcile_conflict",
        "Reconciliation conflicts with current state. Refresh and try again.",
      );
    default:
      return Errors.internal("Reconciliation failed.");
  }
}
