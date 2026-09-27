import { z } from "zod";
import {
  BottleLocationBinUnavailableSchema,
  BottleLocationWineUnavailableSchema,
  decodeBottleLocationReceiveReceipt,
  type BottleLocationReceiveReceipt,
} from "@/lib/api/bottle-location-receive-contract";

export const BOTTLE_LOCATION_PENDING_STORAGE_KEY = "terroir:pending-bottle-location-receive";
const uuid = z.string().uuid();
const PayloadSchema = z.strictObject({
  wine_id: uuid,
  section: z.string().trim().min(1).max(200),
  bin_id: uuid,
});
const OperationSchema = z.strictObject({
  version: z.literal(1),
  kind: z.literal("bottle_location_receive"),
  userId: uuid,
  restaurantId: uuid,
  operationId: uuid,
  sendState: z.enum(["prepared", "attempted"]),
  payload: PayloadSchema,
});

export type BottleLocationOperation = z.infer<typeof OperationSchema>;
export type BottleLocationPayload = z.infer<typeof PayloadSchema>;
export type BottleLocationContext = { userId: string | null; restaurantId: string };
export type BottleLocationFailure = "context_mismatch" | "collision" | "corrupt" | "invalid_payload" | "unavailable" | "resolved_elsewhere" | "forbidden" | "operation_conflict";
type StorageAccess = Pick<Storage, "getItem" | "setItem" | "removeItem">;
export type BottleLocationDependencies = {
  getStorage: () => StorageAccess | null;
  withExclusiveLock: (<T>(callback: () => Promise<T>) => Promise<T>) | null;
};
export type BottleLocationReadResult =
  | { status: "empty" }
  | { status: "ready"; operation: BottleLocationOperation }
  | { status: "blocked"; reason: BottleLocationFailure };
type BeginResult =
  | { ok: true; operation: BottleLocationOperation }
  | { ok: false; reason: BottleLocationFailure };
export type BottleLocationSendResult =
  | { status: "committed"; receipt: BottleLocationReceiveReceipt }
  | { status: "reselect"; intent: Pick<BottleLocationPayload, "wine_id" | "section"> }
  | { status: "reselect_wine"; section: string }
  | { status: "pending" }
  | { status: "blocked"; reason: BottleLocationFailure };
type ResolvedReceive = Extract<BottleLocationSendResult, { status: "committed" | "reselect" | "reselect_wine" }>;
const RefusalSchema = z.strictObject({ error: z.strictObject({ code: z.string(), message: z.string() }) });

export async function readBottleLocationReceive(
  context: BottleLocationContext,
  dependencies = browserDependencies(),
): Promise<BottleLocationReadResult> {
  if (!validContext(context)) return { status: "blocked", reason: "context_mismatch" };
  return locked<BottleLocationReadResult>(dependencies, { status: "blocked", reason: "unavailable" }, async (storage) => {
    const raw = storage.getItem(BOTTLE_LOCATION_PENDING_STORAGE_KEY);
    if (raw === null) return { status: "empty" };
    const operation = parseRecord(raw);
    if (!operation) return { status: "blocked", reason: "corrupt" };
    return sameContext(operation, context)
      ? { status: "ready", operation }
      : { status: "blocked", reason: "context_mismatch" };
  });
}

export async function beginBottleLocationReceive(
  context: BottleLocationContext,
  payload: unknown,
  dependencies = browserDependencies(),
  idFactory: () => string = () => globalThis.crypto.randomUUID(),
): Promise<BeginResult> {
  if (!validContext(context)) return { ok: false, reason: "context_mismatch" };
  const parsedPayload = PayloadSchema.safeParse(payload);
  if (!parsedPayload.success) return { ok: false, reason: "invalid_payload" };
  return locked<BeginResult>(dependencies, { ok: false, reason: "unavailable" }, async (storage) => {
    const raw = storage.getItem(BOTTLE_LOCATION_PENDING_STORAGE_KEY);
    if (raw !== null) {
      const existing = parseRecord(raw);
      return { ok: false, reason: !existing ? "corrupt"
        : sameContext(existing, context) ? "collision" : "context_mismatch" };
    }
    const result = OperationSchema.safeParse({
      version: 1, kind: "bottle_location_receive", ...context,
      operationId: idFactory(), sendState: "prepared", payload: parsedPayload.data,
    });
    if (!result.success) return { ok: false, reason: "unavailable" };
    const canonical = JSON.stringify(result.data);
    storage.setItem(BOTTLE_LOCATION_PENDING_STORAGE_KEY, canonical);
    if (storage.getItem(BOTTLE_LOCATION_PENDING_STORAGE_KEY) !== canonical) {
      return { ok: false, reason: "unavailable" };
    }
    return { ok: true, operation: result.data };
  });
}

// No public clear/abandon operation: only validated success or proven-zero-effect
// bin/wine refusal may clear an attempted receive, while holding this same lock.
export async function sendBottleLocationReceive(
  expected: BottleLocationOperation,
  getCurrentContext: () => BottleLocationContext | null,
  transport: (operation: BottleLocationOperation) => Promise<Response>,
  dependencies = browserDependencies(),
  onResolved?: (result: ResolvedReceive) => void,
): Promise<BottleLocationSendResult> {
  const parsedExpected = OperationSchema.safeParse(expected);
  if (!parsedExpected.success) return { status: "blocked", reason: "corrupt" };
  return locked<BottleLocationSendResult>(dependencies, { status: "blocked", reason: "unavailable" }, async (storage) => {
    const raw = storage.getItem(BOTTLE_LOCATION_PENDING_STORAGE_KEY);
    if (raw === null) return { status: "blocked", reason: "resolved_elsewhere" };
    const operation = parseRecord(raw);
    if (!operation) return { status: "blocked", reason: "corrupt" };
    if (operationIdentity(operation) !== operationIdentity(parsedExpected.data)) {
      return { status: "blocked", reason: "collision" };
    }
    if (!sameContext(operation, getCurrentContext())) {
      return { status: "blocked", reason: "context_mismatch" };
    }
    const attempted: BottleLocationOperation = { ...operation, sendState: "attempted" };
    const attemptedRaw = JSON.stringify(attempted);
    storage.setItem(BOTTLE_LOCATION_PENDING_STORAGE_KEY, attemptedRaw);
    if (storage.getItem(BOTTLE_LOCATION_PENDING_STORAGE_KEY) !== attemptedRaw) {
      return { status: "blocked", reason: "unavailable" };
    }
    let response: Response;
    let body: unknown;
    try {
      response = await transport(attempted);
      body = await response.json();
    } catch {
      return { status: "pending" };
    }
    if (!sameContext(operation, getCurrentContext())) {
      return { status: "blocked", reason: "context_mismatch" };
    }
    let result: BottleLocationSendResult;
    const refusal = RefusalSchema.safeParse(body);
    if ((response.status === 401 || response.status === 403) && refusal.success &&
      ["unauthorized", "forbidden"].includes(refusal.data.error.code)) {
      return { status: "blocked", reason: "forbidden" };
    }
    if (response.status === 409 && refusal.success && refusal.data.error.code === "bottle_context_mismatch") {
      return { status: "blocked", reason: "context_mismatch" };
    }
    if (response.status === 409 && refusal.success && refusal.data.error.code === "bottle_location_operation_conflict") {
      return { status: "blocked", reason: "operation_conflict" };
    }
    if (response.status === 404 && BottleLocationWineUnavailableSchema.safeParse(body).success) {
      result = { status: "reselect_wine", section: operation.payload.section };
    } else if (response.status === 409 && BottleLocationBinUnavailableSchema.safeParse(body).success) {
      result = { status: "reselect", intent: {
        wine_id: operation.payload.wine_id, section: operation.payload.section,
      } };
    } else {
      if (response.status !== 201 || response.headers.get("Idempotency-Key") !== operation.operationId ||
        !["true", "false"].includes(response.headers.get("Idempotency-Replayed") ?? "")) {
        return { status: "pending" };
      }
      try {
        result = { status: "committed", receipt: decodeBottleLocationReceiveReceipt({
          operationId: operation.operationId, wineId: operation.payload.wine_id,
          section: operation.payload.section, binId: operation.payload.bin_id,
        }, body) };
      } catch {
        return { status: "pending" };
      }
    }
    if (storage.getItem(BOTTLE_LOCATION_PENDING_STORAGE_KEY) !== attemptedRaw) {
      return { status: "blocked", reason: "collision" };
    }
    storage.removeItem(BOTTLE_LOCATION_PENDING_STORAGE_KEY);
    if (storage.getItem(BOTTLE_LOCATION_PENDING_STORAGE_KEY) !== null) {
      return { status: "blocked", reason: "unavailable" };
    }
    // Deliver within the same synchronous turn as clearing the record. Waiting
    // for the browser lock promise first lets unmount discard a cleared receipt.
    onResolved?.(result);
    return result;
  });
}

function validContext(context: BottleLocationContext): boolean {
  return uuid.safeParse(context.userId).success && uuid.safeParse(context.restaurantId).success;
}

function sameContext(operation: BottleLocationOperation, context: BottleLocationContext | null): boolean {
  return context !== null && validContext(context) &&
    operation.userId === context.userId && operation.restaurantId === context.restaurantId;
}

function operationIdentity(operation: BottleLocationOperation): string {
  return JSON.stringify({ ...operation, sendState: "attempted" });
}

function parseRecord(raw: string): BottleLocationOperation | null {
  try {
    const result = OperationSchema.safeParse(JSON.parse(raw));
    return result.success && JSON.stringify(result.data) === raw ? result.data : null;
  } catch {
    return null;
  }
}

async function locked<T>(
  dependencies: BottleLocationDependencies,
  unavailable: T,
  callback: (storage: StorageAccess) => Promise<T>,
): Promise<T> {
  if (!dependencies.withExclusiveLock) return unavailable;
  try {
    const storage = dependencies.getStorage();
    if (!storage) return unavailable;
    return await dependencies.withExclusiveLock(() => callback(storage));
  } catch {
    return unavailable;
  }
}

function browserDependencies(): BottleLocationDependencies {
  const locks = typeof navigator === "undefined" ? null : navigator.locks;
  return {
    getStorage: () => typeof window === "undefined" ? null : window.localStorage,
    withExclusiveLock: locks
      ? async <T>(callback: () => Promise<T>): Promise<T> => await locks.request<Promise<T>>(
        BOTTLE_LOCATION_PENDING_STORAGE_KEY, { mode: "exclusive" }, callback,
      )
      : null,
  };
}
