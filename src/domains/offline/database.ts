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
export const DEVICE_ACCESS_FENCE_USER_ID = "__terroir_device_access_fence__";
export const DEVICE_ACCESS_FENCE_RESTAURANT_ID = "__v1__";

type RandomUUID = () => string;
export type OfflineDatabaseOptions = IndexedDbOptions & { randomUUID?: RandomUUID };
export type OfflineLockReason = "sign_out" | "access_changed";
export type OfflineLockResult = {
  locked: boolean;
  denialFenceCommitted: boolean;
  projectionsDeleted: boolean;
};
type UnavailableReason = "invalid_response" | "storage_failure" | "no_usable_context" |
  "ambiguous_context" | "corrupt_state" | "before_issued" | "expired" |
  "clock_rollback" | "authorization_mismatch" | "fence_changed" | "stale_response";
type Unavailable = { status: "unavailable"; reason: UnavailableReason; lockPersisted?: boolean };
export type OfflineReadResult = { status: "ready"; value: OfflineContextResponse } | Unavailable;

const Id = z.string().uuid();
const Timestamp = z.string().datetime({ offset: true });
const LockReason = z.enum([
  "sign_out", "access_changed", "expired", "clock_rollback", "before_issued", "reprovisioned",
]);
const LegacyContextRecordSchema = z.strictObject({
  schemaVersion: z.literal(OFFLINE_SCHEMA_VERSION), contextId: Id, userId: Id,
  restaurantId: Id, issuedAt: Timestamp, expiresAt: Timestamp,
  lastObservedWallClock: Timestamp, lockedAt: Timestamp.nullable(),
  lockReason: LockReason.nullable(), projectionVersion: z.literal(CELLAR_LOOKUP_VERSION),
}).refine((record) => (record.lockedAt === null) === (record.lockReason === null));
const CurrentContextRecordSchema = z.strictObject({
  schemaVersion: z.literal(OFFLINE_SCHEMA_VERSION), eligibilityVersion: z.literal(1),
  authorizationGeneration: Id, contextId: Id, userId: Id, restaurantId: Id,
  issuedAt: Timestamp, expiresAt: Timestamp, lastObservedWallClock: Timestamp,
  lockedAt: Timestamp.nullable(), lockReason: LockReason.nullable(),
  projectionVersion: z.literal(CELLAR_LOOKUP_VERSION),
}).refine((record) => (record.lockedAt === null) === (record.lockReason === null));
const LegacyProjectionRecordSchema = z.strictObject({
  userId: Id, restaurantId: Id, projectionKind: z.literal("cellar_lookup"),
  version: z.literal(CELLAR_LOOKUP_VERSION), asOf: Timestamp,
  rows: z.array(OfflineCellarRowSchema),
});
const CurrentProjectionRecordSchema = z.strictObject({
  userId: Id, restaurantId: Id, contextId: Id,
  projectionKind: z.literal("cellar_lookup"), version: z.literal(CELLAR_LOOKUP_VERSION),
  asOf: Timestamp, rows: z.array(OfflineCellarRowSchema),
});
export const DeviceAccessFenceSchema = z.strictObject({
  userId: z.literal(DEVICE_ACCESS_FENCE_USER_ID),
  restaurantId: z.literal(DEVICE_ACCESS_FENCE_RESTAURANT_ID),
  recordType: z.literal("device_access_fence"), fenceVersion: z.literal(1), revision: Id,
  state: z.enum(["denied", "eligible"]), authorizationGeneration: Id.nullable(),
  eligibleUserId: Id.nullable(), eligibleRestaurantId: Id.nullable(),
  eligibleContextId: Id.nullable(), changedAt: Timestamp,
  reason: z.enum(["sign_out", "access_changed", "provisioned"]),
}).superRefine((fence, context) => {
  const bindings = [fence.eligibleUserId, fence.eligibleRestaurantId, fence.eligibleContextId];
  const eligible = fence.state === "eligible";
  if (bindings.some((value) => (value !== null) !== eligible) ||
    (eligible && (fence.authorizationGeneration === null || fence.reason !== "provisioned")) ||
    (!eligible && fence.reason === "provisioned")) {
    context.addIssue({ code: "custom", message: "Fence state and bindings disagree" });
  }
});
export type DeviceAccessFence = z.infer<typeof DeviceAccessFenceSchema>;
type CurrentContextRecord = z.infer<typeof CurrentContextRecordSchema>;
type LegacyContextRecord = z.infer<typeof LegacyContextRecordSchema>;
type CurrentProjectionRecord = z.infer<typeof CurrentProjectionRecordSchema>;
type AnyContext = CurrentContextRecord | LegacyContextRecord;
export type FenceCapture = { status: "captured"; fence: DeviceAccessFence | null } | Unavailable;
export type ProvisionResult = { status: "stored"; replayed: boolean } | Unavailable;
type DenialCommitResult = Pick<OfflineLockResult, "locked" | "denialFenceCommitted">;

const unavailable = (reason: UnavailableReason, lockPersisted?: boolean): Unavailable => ({
  status: "unavailable", reason,
  ...(lockPersisted === undefined ? {} : { lockPersisted }),
});
const randomUUID = (options: OfflineDatabaseOptions) => {
  try {
    const value = (options.randomUUID ?? globalThis.crypto?.randomUUID.bind(globalThis.crypto))?.();
    return Id.safeParse(value).success ? value! : null;
  } catch { return null; }
};
async function withDatabase<T>(
  options: OfflineDatabaseOptions,
  operation: (database: IDBDatabase, clock: OfflineClock) => Promise<{ ok: true; value: T } | { ok: false }>,
) {
  const { factory, clock } = resolveIndexedDbOptions(options);
  const opened = await openOfflineDatabase(factory, clock);
  if (!opened.ok) return { ok: false } as const;
  try { return await operation(opened.value, clock); } finally { opened.value.close(); }
}
async function getAll<T>(transaction: IDBTransaction, store: "contexts" | "projections", clock: OfflineClock) {
  return requestValue(transaction.objectStore(store).getAll() as IDBRequest<T[]>, transaction, clock);
}
async function put(transaction: IDBTransaction, store: "contexts" | "projections", value: unknown, clock: OfflineClock) {
  return requestValue(transaction.objectStore(store).put(value), transaction, clock);
}
function classifyContexts(rows: unknown[]) {
  const current: CurrentContextRecord[] = [];
  const legacy: LegacyContextRecord[] = [];
  const fences: DeviceAccessFence[] = [];
  for (const row of rows) {
    const fence = DeviceAccessFenceSchema.safeParse(row);
    if (fence.success) { fences.push(fence.data); continue; }
    const next = CurrentContextRecordSchema.safeParse(row);
    if (next.success) { current.push(next.data); continue; }
    const old = LegacyContextRecordSchema.safeParse(row);
    if (old.success) { legacy.push(old.data); continue; }
    return null;
  }
  return fences.length <= 1 ? { current, legacy, fence: fences[0] ?? null } : null;
}
function classifyProjections(rows: unknown[]) {
  const current: CurrentProjectionRecord[] = [];
  for (const row of rows) {
    const next = CurrentProjectionRecordSchema.safeParse(row);
    if (next.success) { current.push(next.data); continue; }
    if (LegacyProjectionRecordSchema.safeParse(row).success) continue;
    return null;
  }
  return current;
}
function reconstruct(context: CurrentContextRecord, projection: CurrentProjectionRecord) {
  return OfflineContextResponseSchema.safeParse({
    schemaVersion: context.schemaVersion,
    context: {
      contextId: context.contextId, userId: context.userId, restaurantId: context.restaurantId,
      issuedAt: context.issuedAt, expiresAt: context.expiresAt,
    },
    projection: {
      kind: projection.projectionKind, version: projection.version,
      asOf: projection.asOf, rows: projection.rows,
    },
  });
}
function recordsFrom(response: OfflineContextResponse, generation: string, now: number) {
  const context: CurrentContextRecord = {
    ...response.context, schemaVersion: response.schemaVersion, eligibilityVersion: 1,
    authorizationGeneration: generation, lastObservedWallClock: new Date(now).toISOString(),
    lockedAt: null, lockReason: null, projectionVersion: response.projection.version,
  };
  const projection: CurrentProjectionRecord = {
    userId: context.userId, restaurantId: context.restaurantId, contextId: context.contextId,
    projectionKind: response.projection.kind, version: response.projection.version,
    asOf: response.projection.asOf, rows: response.projection.rows,
  };
  return { context, projection };
}

export async function captureDeviceAccessFence(options: OfflineDatabaseOptions = {}): Promise<FenceCapture> {
  const result = await withDatabase<FenceCapture>(options, (database, clock) =>
    runTransaction<FenceCapture>(database, ["contexts"], "readonly", clock, async (transaction) => {
      const rows = await getAll<unknown>(transaction, "contexts", clock);
      if (!rows.ok) return { ok: false };
      const classified = classifyContexts(rows.value);
      return classified
        ? { ok: true, value: { status: "captured" as const, fence: classified.fence } }
        : { ok: true, value: unavailable("corrupt_state") };
    }));
  return result.ok ? result.value : unavailable("storage_failure");
}

const ProvisionAuthorizationSchema = z.strictObject({
  userId: Id, restaurantId: Id, authorizationGeneration: Id,
  marker: z.literal("reprovision_required"),
  capturedFence: DeviceAccessFenceSchema.nullable(),
});
export type ProvisionAuthorization = z.infer<typeof ProvisionAuthorizationSchema>;

export async function provisionOfflineContext(
  input: unknown,
  authorization: ProvisionAuthorization,
  options: OfflineDatabaseOptions = {},
): Promise<ProvisionResult> {
  const parsed = OfflineContextResponseSchema.safeParse(input);
  const auth = ProvisionAuthorizationSchema.safeParse(authorization);
  if (!parsed.success || !auth.success ||
    parsed.data.context.userId !== auth.data.userId ||
    parsed.data.context.restaurantId !== auth.data.restaurantId) {
    return unavailable("invalid_response");
  }
  let now: number;
  try { now = resolveIndexedDbOptions(options).clock.now(); } catch {
    return unavailable("storage_failure");
  }
  const revision = randomUUID(options);
  if (!Number.isFinite(now) || revision === null) return unavailable("storage_failure");
  if (now < Date.parse(parsed.data.context.issuedAt) ||
    now >= Date.parse(parsed.data.context.expiresAt)) {
    return unavailable("stale_response");
  }
  const records = recordsFrom(parsed.data, auth.data.authorizationGeneration, now);
  const result = await withDatabase<ProvisionResult>(options, (database, clock) =>
    runTransaction<ProvisionResult>(
      database,
      ["contexts", "projections"],
      "readwrite",
      clock,
      async (transaction) => {
      const rawContexts = await getAll<unknown>(transaction, "contexts", clock);
      const rawProjections = await getAll<unknown>(transaction, "projections", clock);
      if (!rawContexts.ok || !rawProjections.ok) return { ok: false };
      const contexts = classifyContexts(rawContexts.value);
      const projections = classifyProjections(rawProjections.value);
      if (!contexts || !projections) return { ok: false };
      const observed = contexts.fence;
      if ((observed === null) !== (auth.data.capturedFence === null) ||
        (observed && observed.revision !== auth.data.capturedFence?.revision)) {
        return { ok: true, value: unavailable("fence_changed") };
      }
      if (observed?.state === "denied" &&
        observed.authorizationGeneration === auth.data.authorizationGeneration) {
        return { ok: true, value: unavailable("authorization_mismatch") };
      }
      const prior = contexts.current.find((row) =>
        row.userId === auth.data.userId && row.restaurantId === auth.data.restaurantId &&
        row.authorizationGeneration === auth.data.authorizationGeneration);
      if (prior) {
        const order = Date.parse(records.context.issuedAt) - Date.parse(prior.issuedAt);
        if (order < 0) return { ok: true, value: unavailable("stale_response") };
        const priorProjection = projections.find((row) =>
          row.userId === prior.userId && row.restaurantId === prior.restaurantId &&
          row.contextId === prior.contextId);
        const existing = priorProjection && reconstruct(prior, priorProjection);
        const exact = order === 0 && prior.contextId === records.context.contextId &&
          existing?.success && JSON.stringify(existing.data) === JSON.stringify(parsed.data) &&
          observed?.state === "eligible" && observed.eligibleContextId === prior.contextId &&
          observed.authorizationGeneration === auth.data.authorizationGeneration;
        if (exact) return { ok: true, value: { status: "stored" as const, replayed: true } };
        if (order === 0) return { ok: true, value: unavailable("ambiguous_context") };
      }
      for (const row of [...contexts.current, ...contexts.legacy] as AnyContext[]) {
        const sameKey = row.userId === records.context.userId &&
          row.restaurantId === records.context.restaurantId;
        if (!sameKey && !(await put(transaction, "contexts", {
          ...row, lockedAt: new Date(now).toISOString(), lockReason: "reprovisioned",
        }, clock)).ok) return { ok: false };
      }
      const fence: DeviceAccessFence = {
        userId: DEVICE_ACCESS_FENCE_USER_ID, restaurantId: DEVICE_ACCESS_FENCE_RESTAURANT_ID,
        recordType: "device_access_fence", fenceVersion: 1, revision, state: "eligible",
        authorizationGeneration: auth.data.authorizationGeneration,
        eligibleUserId: auth.data.userId, eligibleRestaurantId: auth.data.restaurantId,
        eligibleContextId: records.context.contextId, changedAt: new Date(now).toISOString(),
        reason: "provisioned",
      };
      if (!(await put(transaction, "contexts", records.context, clock)).ok ||
        !(await put(transaction, "projections", records.projection, clock)).ok ||
        !(await put(transaction, "contexts", fence, clock)).ok) return { ok: false };
      return { ok: true, value: { status: "stored" as const, replayed: false } };
      },
    ));
  return result.ok ? result.value : unavailable("storage_failure");
}

export type PositiveReadRequest = {
  userId: string; restaurantId: string; authorizationGeneration: string; now: number;
};
export async function readSoleUsableProjection(
  request: PositiveReadRequest,
  options: OfflineDatabaseOptions = {},
): Promise<OfflineReadResult> {
  if (!Id.safeParse(request.userId).success || !Id.safeParse(request.restaurantId).success ||
    !Id.safeParse(request.authorizationGeneration).success || !Number.isFinite(request.now)) {
    return unavailable("authorization_mismatch");
  }
  let timeFailure: "before_issued" | "expired" | "clock_rollback" | null = null;
  const result = await withDatabase(options, (database, clock) =>
    runTransaction<OfflineReadResult>(database, ["contexts", "projections"], "readwrite", clock,
      async (transaction) => {
        const rawContexts = await getAll<unknown>(transaction, "contexts", clock);
        const rawProjections = await getAll<unknown>(transaction, "projections", clock);
        if (!rawContexts.ok || !rawProjections.ok) return { ok: false };
        const contexts = classifyContexts(rawContexts.value);
        const projections = classifyProjections(rawProjections.value);
        if (!contexts || !projections || contexts.fence?.state !== "eligible") {
          return { ok: true, value: unavailable("corrupt_state") };
        }
        const fence = contexts.fence;
        const eligible = contexts.current.filter((row) => row.lockedAt === null);
        if (eligible.length === 0) return { ok: true, value: unavailable("no_usable_context") };
        if (eligible.length !== 1) return { ok: true, value: unavailable("ambiguous_context") };
        const context = eligible[0];
        if (context.userId !== request.userId || context.restaurantId !== request.restaurantId ||
          context.authorizationGeneration !== request.authorizationGeneration ||
          fence.authorizationGeneration !== request.authorizationGeneration ||
          fence.eligibleUserId !== request.userId ||
          fence.eligibleRestaurantId !== request.restaurantId ||
          fence.eligibleContextId !== context.contextId) {
          return { ok: true, value: unavailable("authorization_mismatch") };
        }
        const matches = projections.filter((projection) =>
          projection.userId === context.userId && projection.restaurantId === context.restaurantId &&
          projection.contextId === context.contextId &&
          projection.projectionKind === "cellar_lookup" &&
          projection.version === context.projectionVersion);
        if (matches.length !== 1) return { ok: true, value: unavailable("corrupt_state") };
        const reconstructed = reconstruct(context, matches[0]);
        if (!reconstructed.success) return { ok: true, value: unavailable("corrupt_state") };
        if (request.now < Date.parse(context.issuedAt)) timeFailure = "before_issued";
        else if (request.now >= Date.parse(context.expiresAt)) timeFailure = "expired";
        else if (request.now < Date.parse(context.lastObservedWallClock)) timeFailure = "clock_rollback";
        const next = timeFailure
          ? { ...context, lockedAt: new Date(request.now).toISOString(), lockReason: timeFailure }
          : { ...context, lastObservedWallClock: new Date(request.now).toISOString() };
        if (!(await put(transaction, "contexts", next, clock)).ok) return { ok: false };
        return { ok: true, value: timeFailure
          ? unavailable(timeFailure, true)
          : { status: "ready" as const, value: reconstructed.data } };
      }));
  return result.ok ? result.value : timeFailure
    ? unavailable(timeFailure, false)
    : unavailable("storage_failure");
}

async function commitDenialFence(
  reason: OfflineLockReason,
  authorizationGeneration: string | null,
  options: OfflineDatabaseOptions,
): Promise<DenialCommitResult> {
  let now: number;
  try { now = resolveIndexedDbOptions(options).clock.now(); } catch {
    return { locked: false, denialFenceCommitted: false };
  }
  const revision = randomUUID(options);
  const generation = Id.safeParse(authorizationGeneration).success ? authorizationGeneration : null;
  if (!Number.isFinite(now) || revision === null) return { locked: false, denialFenceCommitted: false };
  const result = await withDatabase<DenialCommitResult>(options, (database, clock) =>
    runTransaction<DenialCommitResult>(
      database,
      ["contexts"],
      "readwrite",
      clock,
      async (transaction) => {
      const rows = await getAll<unknown>(transaction, "contexts", clock);
      if (!rows.ok) return { ok: false };
      const contexts = classifyContexts(rows.value);
      if (!contexts) return { ok: false };
      const all = [...contexts.current, ...contexts.legacy] as AnyContext[];
      for (const context of all) {
        if (!(await put(transaction, "contexts", {
          ...context, lockedAt: new Date(now).toISOString(), lockReason: reason,
        }, clock)).ok) return { ok: false };
      }
      const fence: DeviceAccessFence = {
        userId: DEVICE_ACCESS_FENCE_USER_ID, restaurantId: DEVICE_ACCESS_FENCE_RESTAURANT_ID,
        recordType: "device_access_fence", fenceVersion: 1, revision, state: "denied",
        authorizationGeneration: generation, eligibleUserId: null, eligibleRestaurantId: null,
        eligibleContextId: null, changedAt: new Date(now).toISOString(), reason,
      };
      if (!(await put(transaction, "contexts", fence, clock)).ok) return { ok: false };
      return { ok: true, value: { locked: all.length > 0, denialFenceCommitted: true } };
      },
    ));
  return result.ok ? result.value : { locked: false, denialFenceCommitted: false };
}
async function deleteProjections(options: OfflineDatabaseOptions) {
  const result = await withDatabase(options, (database, clock) =>
    runTransaction(database, ["projections"], "readwrite", clock, async (transaction) => {
      const cleared = await requestValue(transaction.objectStore("projections").clear(), transaction, clock);
      return cleared.ok ? { ok: true, value: undefined } : { ok: false };
    }));
  return result.ok;
}
export async function lockAllContexts(
  reason: OfflineLockReason,
  authorizationGeneration: string | null,
  clearMemory: () => void,
  options: OfflineDatabaseOptions = {},
): Promise<OfflineLockResult> {
  const denial = await commitDenialFence(reason, authorizationGeneration, options);
  try { clearMemory(); } catch { /* projection deletion must still be attempted */ }
  const projectionsDeleted = await deleteProjections(options);
  return { ...denial, projectionsDeleted };
}
