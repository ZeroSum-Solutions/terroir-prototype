import { z } from "zod";

export const BOTTLE_PENDING_STORAGE_KEY = "terroir:pending-bottle-inventory-save";
const LOCK_NAME = "terroir:pending-bottle-inventory-save";

const uuid = z.string().uuid();
const boundedText = (maxBytes: number) => z.string().refine(
  (value) => new TextEncoder().encode(value).byteLength <= maxBytes,
  `Must be at most ${maxBytes} bytes.`,
);

const BottleWineSchema = z.strictObject({
  name: z.string().trim().min(1).refine(
    (value) => new TextEncoder().encode(value).byteLength <= 500,
    "Must be at most 500 bytes.",
  ),
  producer: z.string().trim().min(1).refine(
    (value) => new TextEncoder().encode(value).byteLength <= 500,
    "Must be at most 500 bytes.",
  ),
  vintage: z.number().int().nullable(),
  varietal: boundedText(500),
  region: boundedText(500),
  country: boundedText(500).nullable(),
  format: boundedText(100).nullable(),
  qty: z.number().int().min(1).max(100_000),
  unitCost: z.number().finite().min(0).max(1_000_000),
});

const BottlePendingOperationSchema = z.strictObject({
  version: z.literal(1),
  userId: uuid,
  restaurantId: uuid,
  operationId: uuid,
  payload: z.strictObject({ wine: BottleWineSchema }),
});

export type BottlePendingWine = z.infer<typeof BottleWineSchema>;
export type BottlePendingOperation = z.infer<typeof BottlePendingOperationSchema>;
export type BottlePendingFailure =
  | "collision"
  | "context_mismatch"
  | "corrupt"
  | "invalid_payload"
  | "unavailable";
export type BottlePendingReadResult =
  | { status: "empty" }
  | { status: "ready"; operation: BottlePendingOperation }
  | { status: "blocked"; reason: BottlePendingFailure };
type BottlePendingWriteResult =
  | { ok: true; value: BottlePendingOperation }
  | { ok: false; reason: BottlePendingFailure };
type BottlePendingClearResult =
  | { ok: true }
  | { ok: false; reason: BottlePendingFailure };
export type BottlePendingSendResult<T> =
  | { ok: true; value: T }
  | { ok: false; reason: BottlePendingFailure }
  | { ok: false; error: unknown };

export type BottlePendingDependencies = {
  getStorage: () => Storage | null;
  withExclusiveLock: (<T>(callback: () => Promise<T>) => Promise<T>) | null;
};

type Context = { userId: string | null; restaurantId: string };

export async function readPendingBottleOperation(
  context: Context,
  dependencies = browserDependencies(),
): Promise<BottlePendingReadResult> {
  if (!validContext(context)) return { status: "blocked", reason: "context_mismatch" };
  return withStorageLock<BottlePendingReadResult>(
    dependencies,
    { status: "blocked", reason: "unavailable" },
    async (storage) => {
      const raw = storage.getItem(BOTTLE_PENDING_STORAGE_KEY);
      if (raw === null) return { status: "empty" };
      const operation = parseCanonicalRecord(raw);
      if (!operation) return { status: "blocked", reason: "corrupt" };
      if (operation.userId !== context.userId || operation.restaurantId !== context.restaurantId) {
        return { status: "blocked", reason: "context_mismatch" };
      }
      return { status: "ready", operation };
    },
  );
}

export async function beginPendingBottleOperation(
  input: Context & { wine: unknown },
  dependencies = browserDependencies(),
  idFactory: () => string = () => globalThis.crypto.randomUUID(),
): Promise<BottlePendingWriteResult> {
  if (!validContext(input)) return { ok: false, reason: "context_mismatch" };
  const canonicalWine = BottleWineSchema.safeParse(input.wine);
  if (!canonicalWine.success) return { ok: false, reason: "invalid_payload" };

  return withStorageLock<BottlePendingWriteResult>(
    dependencies,
    { ok: false, reason: "unavailable" },
    async (storage) => {
      const existingRaw = storage.getItem(BOTTLE_PENDING_STORAGE_KEY);
      if (existingRaw !== null) {
        const existing = parseCanonicalRecord(existingRaw);
        return {
          ok: false,
          reason: !existing
            ? "corrupt"
            : existing.userId !== input.userId || existing.restaurantId !== input.restaurantId
              ? "context_mismatch"
              : "collision",
        };
      }

      const parsed = BottlePendingOperationSchema.safeParse({
        version: 1,
        userId: input.userId,
        restaurantId: input.restaurantId,
        operationId: idFactory(),
        payload: { wine: canonicalWine.data },
      });
      if (!parsed.success) return { ok: false, reason: "unavailable" };
      const raw = JSON.stringify(parsed.data);
      storage.setItem(BOTTLE_PENDING_STORAGE_KEY, raw);
      if (storage.getItem(BOTTLE_PENDING_STORAGE_KEY) !== raw) {
        return { ok: false, reason: "unavailable" };
      }
      return { ok: true, value: parsed.data };
    },
  );
}

export async function clearPendingBottleOperation(
  input: Context & { operationId: string },
  dependencies = browserDependencies(),
): Promise<BottlePendingClearResult> {
  if (!validContext(input) || !uuid.safeParse(input.operationId).success) {
    return { ok: false, reason: "context_mismatch" };
  }
  return withStorageLock<BottlePendingClearResult>(
    dependencies,
    { ok: false, reason: "unavailable" },
    async (storage) => {
      const raw = storage.getItem(BOTTLE_PENDING_STORAGE_KEY);
      if (raw === null) return { ok: true };
      const operation = parseCanonicalRecord(raw);
      if (!operation) return { ok: false, reason: "corrupt" };
      if (
        operation.userId !== input.userId ||
        operation.restaurantId !== input.restaurantId ||
        operation.operationId !== input.operationId
      ) {
        return { ok: false, reason: "context_mismatch" };
      }
      storage.removeItem(BOTTLE_PENDING_STORAGE_KEY);
      return storage.getItem(BOTTLE_PENDING_STORAGE_KEY) === null
        ? { ok: true }
        : { ok: false, reason: "unavailable" };
    },
  );
}

export async function sendPendingBottleOperation<T>(
  expected: BottlePendingOperation,
  getLatestContext: () => Context | null,
  send: (operation: BottlePendingOperation) => Promise<T>,
  dependencies = browserDependencies(),
): Promise<BottlePendingSendResult<T>> {
  const parsedExpected = BottlePendingOperationSchema.safeParse(expected);
  if (!parsedExpected.success) return { ok: false, reason: "corrupt" };
  const expectedRaw = JSON.stringify(parsedExpected.data);

  return withStorageLock<BottlePendingSendResult<T>>(
    dependencies,
    { ok: false, reason: "unavailable" },
    async (storage) => {
      const raw = storage.getItem(BOTTLE_PENDING_STORAGE_KEY);
      if (raw === null) return { ok: false, reason: "corrupt" };
      const operation = parseCanonicalRecord(raw);
      if (!operation) return { ok: false, reason: "corrupt" };
      if (raw !== expectedRaw) return { ok: false, reason: "collision" };

      const context = getLatestContext();
      if (
        !context ||
        !validContext(context) ||
        operation.userId !== context.userId ||
        operation.restaurantId !== context.restaurantId
      ) {
        return { ok: false, reason: "context_mismatch" };
      }

      try {
        return { ok: true, value: await send(operation) };
      } catch (error) {
        return { ok: false, error };
      }
    },
  );
}

function validContext(context: Context): context is { userId: string; restaurantId: string } {
  return uuid.safeParse(context.userId).success && uuid.safeParse(context.restaurantId).success;
}

function parseCanonicalRecord(raw: string): BottlePendingOperation | null {
  try {
    const parsed = BottlePendingOperationSchema.safeParse(JSON.parse(raw));
    if (!parsed.success || JSON.stringify(parsed.data) !== raw) return null;
    return parsed.data;
  } catch {
    return null;
  }
}

async function withStorageLock<T>(
  dependencies: BottlePendingDependencies,
  unavailable: T,
  callback: (storage: Storage) => Promise<T>,
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

function browserDependencies(): BottlePendingDependencies {
  const lockManager = typeof navigator === "undefined" ? null : navigator.locks;
  return {
    getStorage: () => {
      try {
        return typeof window === "undefined" ? null : window.localStorage;
      } catch {
        return null;
      }
    },
    withExclusiveLock: lockManager
      ? async <T>(callback: () => Promise<T>): Promise<T> => {
        const nested = lockManager.request<Promise<T>>(
          LOCK_NAME,
          { mode: "exclusive" },
          () => callback(),
        );
        return await nested;
      }
      : null,
  };
}
