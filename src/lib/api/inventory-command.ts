import { NextResponse, type NextRequest } from "next/server";
import { InventoryCommandError } from "@/domains/pours/inventory-command";
import { apiError, Errors } from "@/lib/api/errors";
import { isValidIdempotencyKey } from "@/lib/api/idempotency";

export function requireInventoryOperationId(
  request: NextRequest,
): string | NextResponse {
  const operationId = request.headers.get("Idempotency-Key");
  if (!isValidIdempotencyKey(operationId)) {
    return Errors.badRequest(
      "A valid UUID Idempotency-Key header is required.",
      undefined,
      "invalid_idempotency_key",
    );
  }
  return operationId;
}

export function inventoryResponse(
  body: unknown,
  status: number,
  operationId: string,
  replayed: boolean,
) {
  return NextResponse.json(body, {
    status,
    headers: inventoryHeaders(operationId, replayed),
  });
}

export function withInventoryHeaders(
  response: NextResponse,
  operationId: string,
  replayed = false,
) {
  response.headers.set("Idempotency-Key", operationId);
  response.headers.set("Idempotency-Replayed", String(replayed));
  return response;
}

export function inventoryCommandErrorResponse(
  error: unknown,
  operationId: string,
): NextResponse | null {
  if (!(error instanceof InventoryCommandError)) return null;

  const message = error.message.trim();
  let response: NextResponse;
  if (error.databaseCode === "42501" || message === "forbidden") {
    response = Errors.forbidden(
      "This inventory command is not allowed for the active restaurant.",
    );
  } else {
    response = mappedMessage(message);
  }
  return withInventoryHeaders(response, operationId);
}

function mappedMessage(message: string): NextResponse {
  switch (message) {
    case "wine_not_found":
      return apiError(404, "wine_not_found", "Wine not found.");
    case "open_bottle_not_found":
      return apiError(404, "open_bottle_not_found", "Open bottle not found.");
    case "no_inventory":
      return Errors.conflict("no_inventory", "No inventory available.");
    case "open_bottle_already_open":
      return Errors.conflict(
        "open_bottle_already_open",
        "A bottle is already open for this wine.",
      );
    case "open_bottle_changed":
      return Errors.conflict(
        "open_bottle_changed",
        "The open bottle changed. Refresh and try again.",
      );
    case "open_bottle_already_closed":
      return Errors.conflict("already_closed", "Bottle is already closed.");
    case "inventory_operation_actor_conflict":
    case "inventory_operation_payload_conflict":
      return Errors.conflict(
        "idempotency_conflict",
        "This Idempotency-Key was already used for a different inventory command.",
      );
    case "wine_size_unknown":
      return Errors.unprocessable("wine_size_unknown", "Wine bottle size is unknown.");
    case "invalid_actual_remaining":
      return Errors.unprocessable(
        "invalid_actual_remaining",
        "Actual remaining volume is outside the bottle's capacity.",
      );
    case "invalid_writeoff_amount":
      return Errors.unprocessable(
        "invalid_writeoff_amount",
        "Write-off must not exceed the actual remaining volume.",
      );
    case "writeoff_reason_required":
      return Errors.unprocessable(
        "writeoff_reason_required",
        "A reason code is required for a write-off.",
      );
    case "invalid_reason_code":
      return Errors.unprocessable(
        "invalid_reason_code",
        "Reason code must be an active spoilage or adjustment reason.",
      );
    case "invalid_inventory_command":
      return Errors.unprocessable(
        "invalid_inventory_command",
        "The inventory command is invalid.",
      );
    default:
      return Errors.internal("Inventory command failed.");
  }
}

function inventoryHeaders(operationId: string, replayed: boolean) {
  return {
    "Idempotency-Key": operationId,
    "Idempotency-Replayed": String(replayed),
  };
}
