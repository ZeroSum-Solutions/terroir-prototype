import {
  parsePhysicalReconcileDraftSnapshot,
  type PhysicalReconcileDraftSnapshot,
} from "./draft-storage";

const RETAINED_PREFIX = "terroir:reconcile-retained";
const CONFIRMATION_PREFIX = "terroir:reconcile-retained-confirmation";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export type RetainedReconciliationRecord = {
  version: 1;
  restaurantId: string;
  userId: string;
  operationId: string;
  failedDraftRaw: string;
  outcome: {
    status: 409;
    code: "reconciliation_batch_stale";
    idempotencyKey: string;
    idempotencyReplayed: false;
    observedAt: number;
  };
};

export type RetainedReconciliationSnapshot = {
  raw: string;
  record: RetainedReconciliationRecord;
  failedDraft: PhysicalReconcileDraftSnapshot;
};

export type RetainedReconciliationConfirmation = {
  version: 1;
  restaurantId: string;
  userId: string;
  operationId: string;
  retainedRecordRaw: string;
  confirmedAt: number;
  freshLoadedAt: number | null;
};

export type RetainedConfirmationSnapshot = {
  raw: string;
  confirmation: RetainedReconciliationConfirmation;
};

type StorageFailure = "unavailable" | "missing" | "corrupt" | "collision" | "readback";
export type StorageResult<T> = { ok: true; value: T } | { ok: false; reason: StorageFailure };

export function retainedReconciliationKey(
  restaurantId: string,
  userId: string,
  operationId: string,
): string {
  return `${RETAINED_PREFIX}:${restaurantId}:${userId}:${operationId}`;
}

function confirmationKey(restaurantId: string, userId: string, operationId: string): string {
  return `${CONFIRMATION_PREFIX}:${restaurantId}:${userId}:${operationId}`;
}

export function isDefinitiveStaleReconciliation(
  status: number,
  headers: Headers,
  body: unknown,
  operationId: string,
): boolean {
  return status === 409 &&
    headers.get("Idempotency-Key") === operationId &&
    headers.get("Idempotency-Replayed") === "false" &&
    isRecord(body) && isRecord(body.error) &&
    body.error.code === "reconciliation_batch_stale";
}

export function retainStaleReconciliation(input: {
  restaurantId: string;
  userId: string;
  activeDraft: PhysicalReconcileDraftSnapshot;
  observedAt?: number;
}): StorageResult<RetainedReconciliationSnapshot> {
  const verifiedActiveDraft = parsePhysicalReconcileDraftSnapshot(input.activeDraft.raw);
  const operation = verifiedActiveDraft?.draft.frozenOperation;
  if (!operation || !UUID.test(operation.operationId)) return { ok: false, reason: "corrupt" };
  const record: RetainedReconciliationRecord = {
    version: 1,
    restaurantId: input.restaurantId,
    userId: input.userId,
    operationId: operation.operationId,
    failedDraftRaw: verifiedActiveDraft.raw,
    outcome: {
      status: 409,
      code: "reconciliation_batch_stale",
      idempotencyKey: operation.operationId,
      idempotencyReplayed: false,
      observedAt: input.observedAt ?? Date.now(),
    },
  };
  const storage = getStorage();
  if (!storage) return { ok: false, reason: "unavailable" };
  try {
    const key = retainedReconciliationKey(input.restaurantId, input.userId, operation.operationId);
    const existingRaw = storage.getItem(key);
    if (existingRaw) {
      const existing = parseRetainedSnapshot(existingRaw, input.restaurantId, input.userId);
      if (!existing) return { ok: false, reason: "corrupt" };
      return existing.record.failedDraftRaw === verifiedActiveDraft.raw
        ? { ok: true, value: existing }
        : { ok: false, reason: "collision" };
    }
    const raw = JSON.stringify(record);
    storage.setItem(key, raw);
    if (storage.getItem(key) !== raw) return { ok: false, reason: "readback" };
    const value = parseRetainedSnapshot(raw, input.restaurantId, input.userId);
    return value ? { ok: true, value } : { ok: false, reason: "corrupt" };
  } catch {
    return { ok: false, reason: "unavailable" };
  }
}

export function readRetainedReconciliations(
  restaurantId: string,
  userId: string,
): StorageResult<RetainedReconciliationSnapshot[]> {
  const storage = getStorage();
  if (!storage) return { ok: false, reason: "unavailable" };
  try {
    const prefix = `${RETAINED_PREFIX}:${restaurantId}:${userId}:`;
    const value: RetainedReconciliationSnapshot[] = [];
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (!key?.startsWith(prefix)) continue;
      const raw = storage.getItem(key);
      if (!raw) return { ok: false, reason: "missing" };
      const snapshot = parseRetainedSnapshot(raw, restaurantId, userId);
      if (!snapshot || key !== retainedReconciliationKey(
        restaurantId, userId, snapshot.record.operationId,
      )) return { ok: false, reason: "corrupt" };
      value.push(snapshot);
    }
    value.sort((left, right) =>
      right.record.outcome.observedAt - left.record.outcome.observedAt ||
      left.record.operationId.localeCompare(right.record.operationId));
    return { ok: true, value };
  } catch {
    return { ok: false, reason: "unavailable" };
  }
}

export function confirmRetainedReconciliation(
  retained: RetainedReconciliationSnapshot,
  confirmedAt = Date.now(),
): StorageResult<RetainedConfirmationSnapshot> {
  const { restaurantId, userId, operationId } = retained.record;
  const storage = getStorage();
  if (!storage) return { ok: false, reason: "unavailable" };
  try {
    const key = confirmationKey(restaurantId, userId, operationId);
    const existingRaw = storage.getItem(key);
    if (existingRaw) {
      const existing = parseConfirmation(existingRaw, retained);
      return existing
        ? { ok: true, value: existing }
        : { ok: false, reason: "collision" };
    }
    const confirmation: RetainedReconciliationConfirmation = {
      version: 1,
      restaurantId,
      userId,
      operationId,
      retainedRecordRaw: retained.raw,
      confirmedAt,
      freshLoadedAt: null,
    };
    return writeConfirmation(storage, key, confirmation, retained);
  } catch {
    return { ok: false, reason: "unavailable" };
  }
}

export function readRetainedReconciliationConfirmation(
  retained: RetainedReconciliationSnapshot,
): StorageResult<RetainedConfirmationSnapshot> {
  const { restaurantId, userId, operationId } = retained.record;
  const storage = getStorage();
  if (!storage) return { ok: false, reason: "unavailable" };
  try {
    const raw = storage.getItem(confirmationKey(restaurantId, userId, operationId));
    if (!raw) return { ok: false, reason: "missing" };
    const value = parseConfirmation(raw, retained);
    return value ? { ok: true, value } : { ok: false, reason: "corrupt" };
  } catch {
    return { ok: false, reason: "unavailable" };
  }
}

export function markRetainedReconciliationFreshLoaded(
  retained: RetainedReconciliationSnapshot,
  freshLoadedAt = Date.now(),
): StorageResult<RetainedConfirmationSnapshot> {
  const existing = readRetainedReconciliationConfirmation(retained);
  if (!existing.ok) return existing;
  if (existing.value.confirmation.freshLoadedAt !== null) return existing;
  const storage = getStorage();
  if (!storage) return { ok: false, reason: "unavailable" };
  try {
    return writeConfirmation(
      storage,
      confirmationKey(
        retained.record.restaurantId,
        retained.record.userId,
        retained.record.operationId,
      ),
      { ...existing.value.confirmation, freshLoadedAt },
      retained,
    );
  } catch {
    return { ok: false, reason: "unavailable" };
  }
}

function writeConfirmation(
  storage: Storage,
  key: string,
  confirmation: RetainedReconciliationConfirmation,
  retained: RetainedReconciliationSnapshot,
): StorageResult<RetainedConfirmationSnapshot> {
  const raw = JSON.stringify(confirmation);
  storage.setItem(key, raw);
  if (storage.getItem(key) !== raw) return { ok: false, reason: "readback" };
  const value = parseConfirmation(raw, retained);
  return value ? { ok: true, value } : { ok: false, reason: "corrupt" };
}

function parseRetainedSnapshot(
  raw: string,
  restaurantId: string,
  userId: string,
): RetainedReconciliationSnapshot | null {
  try {
    const record = JSON.parse(raw) as Partial<RetainedReconciliationRecord> | null;
    if (!record || record.version !== 1 || record.restaurantId !== restaurantId ||
      record.userId !== userId || typeof record.operationId !== "string" ||
      !UUID.test(record.operationId) || typeof record.failedDraftRaw !== "string" ||
      !isRecord(record.outcome) || record.outcome.status !== 409 ||
      record.outcome.code !== "reconciliation_batch_stale" ||
      record.outcome.idempotencyKey !== record.operationId ||
      record.outcome.idempotencyReplayed !== false ||
      typeof record.outcome.observedAt !== "number" || !Number.isFinite(record.outcome.observedAt)) {
      return null;
    }
    const failedDraft = parsePhysicalReconcileDraftSnapshot(record.failedDraftRaw);
    if (!failedDraft?.draft.frozenOperation ||
      failedDraft.draft.frozenOperation.operationId !== record.operationId) return null;
    return { raw, record: record as RetainedReconciliationRecord, failedDraft };
  } catch {
    return null;
  }
}

function parseConfirmation(
  raw: string,
  retained: RetainedReconciliationSnapshot,
): RetainedConfirmationSnapshot | null {
  try {
    const value = JSON.parse(raw) as Partial<RetainedReconciliationConfirmation> | null;
    if (!value || value.version !== 1 ||
      value.restaurantId !== retained.record.restaurantId ||
      value.userId !== retained.record.userId ||
      value.operationId !== retained.record.operationId ||
      value.retainedRecordRaw !== retained.raw ||
      typeof value.confirmedAt !== "number" || !Number.isFinite(value.confirmedAt) ||
      (value.freshLoadedAt !== null &&
        (typeof value.freshLoadedAt !== "number" || !Number.isFinite(value.freshLoadedAt)))) {
      return null;
    }
    return { raw, confirmation: value as RetainedReconciliationConfirmation };
  } catch {
    return null;
  }
}

function getStorage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
