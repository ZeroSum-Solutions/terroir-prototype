import { z } from "zod";
import {
  CELLAR_LOOKUP_VERSION,
  OFFLINE_SCHEMA_VERSION,
  OfflineCellarRowSchema,
  OfflineContextResponseSchema,
  type OfflineContextResponse,
} from "./contract";
import {
  openOfflineDatabase,
  requestValue,
  resolveIndexedDbOptions,
  runTransaction,
  type IndexedDbOptions,
  type OfflineClock,
} from "./indexeddb";

export type { OfflineClock } from "./indexeddb";
export type OfflineDatabaseOptions = IndexedDbOptions;
export type OfflineLockReason = z.infer<typeof LockReason>;
type UnavailableReason = "invalid_response" | "storage_failure" | "no_usable_context" |
  "ambiguous_context" | "corrupt_state" | "before_issued" | "expired" | "clock_rollback";
type Unavailable = {
  status: "unavailable";
  reason: UnavailableReason;
  lockPersisted?: boolean;
};
export type OfflineReadResult = { status: "ready"; value: OfflineContextResponse } | Unavailable;

const Timestamp = z.string().datetime({ offset: true });
const LockReason = z.enum([
  "sign_out", "access_changed", "expired", "clock_rollback", "before_issued", "reprovisioned",
]);
const ContextRecordSchema = z.strictObject({
  schemaVersion: z.literal(OFFLINE_SCHEMA_VERSION),
  contextId: z.string().uuid(),
  userId: z.string().uuid(),
  restaurantId: z.string().uuid(),
  issuedAt: Timestamp,
  expiresAt: Timestamp,
  lastObservedWallClock: Timestamp,
  lockedAt: Timestamp.nullable(),
  lockReason: LockReason.nullable(),
  projectionVersion: z.literal(CELLAR_LOOKUP_VERSION),
}).refine((record) => (record.lockedAt === null) === (record.lockReason === null), {
  message: "Lock timestamp and reason must both be present or both be absent",
});
const ProjectionRecordSchema = z.strictObject({
  userId: z.string().uuid(),
  restaurantId: z.string().uuid(),
  projectionKind: z.literal("cellar_lookup"),
  version: z.literal(CELLAR_LOOKUP_VERSION),
  asOf: Timestamp,
  rows: z.array(OfflineCellarRowSchema),
});
type ContextRecord = z.infer<typeof ContextRecordSchema>;
type ProjectionRecord = z.infer<typeof ProjectionRecordSchema>;
const unavailable = (reason: UnavailableReason, lockPersisted?: boolean): Unavailable => ({
  status: "unavailable",
  reason,
  ...(lockPersisted === undefined ? {} : { lockPersisted }),
});
async function withDatabase<T>(
  options: OfflineDatabaseOptions,
  operation: (database: IDBDatabase, clock: OfflineClock) => Promise<{ ok: true; value: T } | { ok: false }>,
) {
  const { factory, clock } = resolveIndexedDbOptions(options);
  const opened = await openOfflineDatabase(factory, clock);
  if (!opened.ok) return { ok: false } as const;
  try {
    return await operation(opened.value, clock);
  } finally {
    opened.value.close();
  }
}
async function getAll<T>(transaction: IDBTransaction, store: "contexts" | "projections", clock: OfflineClock) {
  const request = transaction.objectStore(store).getAll() as IDBRequest<T[]>;
  return requestValue(request, transaction, clock);
}
async function put(transaction: IDBTransaction, store: "contexts" | "projections", value: unknown, clock: OfflineClock) {
  return requestValue(transaction.objectStore(store).put(value), transaction, clock);
}
function recordsFrom(response: OfflineContextResponse, now: number) {
  const context: ContextRecord = {
    ...response.context,
    schemaVersion: response.schemaVersion,
    lastObservedWallClock: new Date(now).toISOString(),
    lockedAt: null,
    lockReason: null,
    projectionVersion: response.projection.version,
  };
  const projection: ProjectionRecord = {
    userId: response.context.userId,
    restaurantId: response.context.restaurantId,
    projectionKind: response.projection.kind,
    version: response.projection.version,
    asOf: response.projection.asOf,
    rows: response.projection.rows,
  };
  return { context, projection };
}

export async function provisionOfflineContext(
  input: unknown,
  options: OfflineDatabaseOptions = {},
) {
  const parsed = OfflineContextResponseSchema.safeParse(input);
  if (!parsed.success) return unavailable("invalid_response");
  const dependencies = resolveIndexedDbOptions(options);
  const now = dependencies.clock.now();
  if (!Number.isFinite(now)) return unavailable("storage_failure");
  const { context, projection } = recordsFrom(parsed.data, now);
  const result = await withDatabase(options, (database, clock) =>
    runTransaction(database, ["contexts", "projections"], "readwrite", clock, async (transaction) => {
      const existing = await getAll<unknown>(transaction, "contexts", clock);
      if (!existing.ok) return { ok: false };
      const contexts = z.array(ContextRecordSchema).safeParse(existing.value);
      if (!contexts.success) return { ok: false };
      for (const item of contexts.data) {
        const isCurrent = item.userId === context.userId && item.restaurantId === context.restaurantId;
        if (!isCurrent) {
          const written = await put(transaction, "contexts", {
            ...item,
            lockedAt: new Date(now).toISOString(),
            lockReason: "reprovisioned",
          }, clock);
          if (!written.ok) return { ok: false };
        }
      }
      if (!(await put(transaction, "contexts", context, clock)).ok) return { ok: false };
      if (!(await put(transaction, "projections", projection, clock)).ok) return { ok: false };
      return { ok: true, value: undefined };
    }));
  return result.ok ? { status: "stored" as const } : unavailable("storage_failure");
}
function reconstruct(context: ContextRecord, projection: ProjectionRecord) {
  return OfflineContextResponseSchema.safeParse({
    schemaVersion: context.schemaVersion,
    context: {
      contextId: context.contextId,
      userId: context.userId,
      restaurantId: context.restaurantId,
      issuedAt: context.issuedAt,
      expiresAt: context.expiresAt,
    },
    projection: {
      kind: projection.projectionKind,
      version: projection.version,
      asOf: projection.asOf,
      rows: projection.rows,
    },
  });
}

export async function readSoleUsableProjection(
  now: number,
  options: OfflineDatabaseOptions = {},
): Promise<OfflineReadResult> {
  if (!Number.isFinite(now)) return unavailable("storage_failure");
  let timeFailure: "before_issued" | "expired" | "clock_rollback" | null = null;
  const result = await withDatabase(options, (database, clock) =>
    runTransaction<OfflineReadResult>(
      database, ["contexts", "projections"], "readwrite", clock,
      async (transaction) => {
        const contextRows = await getAll<unknown>(transaction, "contexts", clock);
        const projectionRows = await getAll<unknown>(transaction, "projections", clock);
        if (!contextRows.ok || !projectionRows.ok) return { ok: false };
        const contexts = z.array(ContextRecordSchema).safeParse(contextRows.value);
        const projections = z.array(ProjectionRecordSchema).safeParse(projectionRows.value);
        if (!contexts.success || !projections.success) {
          return { ok: true, value: unavailable("corrupt_state") };
        }
        const eligible = contexts.data.filter((context) => context.lockedAt === null);
        if (eligible.length === 0) return { ok: true, value: unavailable("no_usable_context") };
        if (eligible.length !== 1) return { ok: true, value: unavailable("ambiguous_context") };
        const context = eligible[0];
        const matches = projections.data.filter((projection) =>
          projection.userId === context.userId &&
          projection.restaurantId === context.restaurantId &&
          projection.projectionKind === "cellar_lookup" &&
          projection.version === context.projectionVersion);
        if (matches.length !== 1) return { ok: true, value: unavailable("corrupt_state") };
        const parsed = reconstruct(context, matches[0]);
        if (!parsed.success) return { ok: true, value: unavailable("corrupt_state") };
        if (now < Date.parse(context.issuedAt)) timeFailure = "before_issued";
        else if (now >= Date.parse(context.expiresAt)) timeFailure = "expired";
        else if (now < Date.parse(context.lastObservedWallClock)) timeFailure = "clock_rollback";
        if (timeFailure) {
          const locked = await put(transaction, "contexts", {
            ...context,
            lockedAt: new Date(now).toISOString(),
            lockReason: timeFailure,
          }, clock);
          if (!locked.ok) return { ok: false };
          return { ok: true, value: unavailable(timeFailure, true) };
        }
        const observed = await put(transaction, "contexts", {
          ...context,
          lastObservedWallClock: new Date(now).toISOString(),
        }, clock);
        if (!observed.ok) return { ok: false };
        return { ok: true, value: { status: "ready" as const, value: parsed.data } };
      },
    ));
  if (result.ok) return result.value;
  return timeFailure ? unavailable(timeFailure, false) : unavailable("storage_failure");
}

async function lockContexts(reason: OfflineLockReason, options: OfflineDatabaseOptions) {
  const now = resolveIndexedDbOptions(options).clock.now();
  if (!Number.isFinite(now)) return false;
  const result = await withDatabase(options, (database, clock) =>
    runTransaction(database, ["contexts"], "readwrite", clock, async (transaction) => {
      const rows = await getAll<unknown>(transaction, "contexts", clock);
      if (!rows.ok) return { ok: false };
      const contexts = z.array(ContextRecordSchema).safeParse(rows.value);
      if (!contexts.success) return { ok: false };
      for (const context of contexts.data) {
        if (!(await put(transaction, "contexts", {
          ...context,
          lockedAt: new Date(now).toISOString(),
          lockReason: reason,
        }, clock)).ok) return { ok: false };
      }
      return { ok: true, value: contexts.data.length > 0 };
    }));
  return result.ok && result.value === true;
}
async function deleteProjections(options: OfflineDatabaseOptions) {
  const result = await withDatabase(options, (database, clock) =>
    runTransaction(database, ["projections"], "readwrite", clock, async (transaction) => {
      const cleared = await requestValue(
        transaction.objectStore("projections").clear(),
        transaction,
        clock,
      );
      return cleared.ok ? { ok: true, value: undefined } : { ok: false };
    }));
  return result.ok;
}

export async function lockAllContexts(reason: OfflineLockReason, clearMemory: () => void, options: OfflineDatabaseOptions = {}) {
  const locked = await lockContexts(reason, options);
  try { clearMemory(); } catch { /* deletion must still be attempted */ }
  const projectionsDeleted = await deleteProjections(options);
  return { locked, projectionsDeleted };
}
