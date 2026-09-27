import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearReconcileDraft,
  parsePhysicalReconcileDraftSnapshot,
  writeReconcileDraft,
  type PhysicalReconcileDraftSnapshot,
} from "./draft-storage";
import {
  confirmRetainedReconciliation,
  isDefinitiveStaleReconciliation,
  markRetainedReconciliationFreshLoaded,
  readRetainedReconciliationConfirmation,
  readRetainedReconciliations,
  retainStaleReconciliation,
  retainedReconciliationKey,
} from "./retained-reconciliation-storage";

const RESTAURANT = "restaurant-a";
const USER = "user-a";
const OPERATION = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const BOTTLE = "00000000-0000-4000-8000-00000000000f";

function activeSnapshot(
  targetRemainingMl = 120,
  savedAt = Date.parse("2026-09-25T08:00:00Z"),
): PhysicalReconcileDraftSnapshot {
  const payload = JSON.stringify({ entries: [{
    open_bottle_id: BOTTLE,
    expected_state_version: 3,
    target_remaining_ml: targetRemainingMl,
    note: "counted",
  }] });
  return parsePhysicalReconcileDraftSnapshot(JSON.stringify({
    savedAt,
    version: 2,
    entries: { [BOTTLE]: {
      expectedStateVersion: 3,
      targetRemainingMl,
      note: "counted",
    } },
    frozenOperation: { operationId: OPERATION, payload },
  }))!;
}

function retain(snapshot = activeSnapshot(), observedAt = 1_790_323_260_000) {
  return retainStaleReconciliation({
    restaurantId: RESTAURANT,
    userId: USER,
    activeDraft: snapshot,
    observedAt,
  });
}

function mockSessionStorage(overrides: Partial<Storage>) {
  const actual = window.sessionStorage;
  const storage: Storage = {
    get length() { return actual.length; },
    clear: actual.clear.bind(actual),
    getItem: actual.getItem.bind(actual),
    key: actual.key.bind(actual),
    removeItem: actual.removeItem.bind(actual),
    setItem: actual.setItem.bind(actual),
    ...overrides,
  };
  return vi.spyOn(window, "sessionStorage", "get").mockReturnValue(storage);
}

beforeEach(() => {
  sessionStorage.clear();
  vi.restoreAllMocks();
});

describe("definitive stale classification", () => {
  it("requires the exact nested code, operation header, and replay false", () => {
    const headers = new Headers({
      "Idempotency-Key": OPERATION,
      "Idempotency-Replayed": "false",
    });
    expect(isDefinitiveStaleReconciliation(
      409, headers, { error: { code: "reconciliation_batch_stale" } }, OPERATION,
    )).toBe(true);
    expect(isDefinitiveStaleReconciliation(
      409, headers, { code: "reconciliation_batch_stale" }, OPERATION,
    )).toBe(false);
    expect(isDefinitiveStaleReconciliation(
      409, new Headers({ ...Object.fromEntries(headers), "Idempotency-Replayed": "true" }),
      { error: { code: "reconciliation_batch_stale" } }, OPERATION,
    )).toBe(false);
    expect(isDefinitiveStaleReconciliation(
      409, new Headers({ "Idempotency-Key": crypto.randomUUID(), "Idempotency-Replayed": "false" }),
      { error: { code: "reconciliation_batch_stale" } }, OPERATION,
    )).toBe(false);
  });
});

describe("retained stale reconciliation storage", () => {
  it("preserves exact active bytes, scopes records, and keeps multiple operations", () => {
    const first = retain();
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.value.record.failedDraftRaw).toBe(activeSnapshot().raw);
    expect(first.value.record.outcome).toEqual({
      status: 409,
      code: "reconciliation_batch_stale",
      idempotencyKey: OPERATION,
      idempotencyReplayed: false,
      observedAt: 1_790_323_260_000,
    });

    const otherOperation = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const other = activeSnapshot();
    other.draft.frozenOperation = {
      operationId: otherOperation,
      payload: other.draft.frozenOperation!.payload,
    };
    other.raw = JSON.stringify({
      savedAt: other.savedAt,
      ...other.draft,
    });
    expect(retainStaleReconciliation({
      restaurantId: RESTAURANT, userId: USER, activeDraft: other, observedAt: 2,
    }).ok).toBe(true);

    const own = readRetainedReconciliations(RESTAURANT, USER);
    expect(own.ok && own.value).toHaveLength(2);
    expect(readRetainedReconciliations("restaurant-b", USER)).toEqual({ ok: true, value: [] });
    expect(readRetainedReconciliations(RESTAURANT, "user-b")).toEqual({ ok: true, value: [] });
  });

  it("makes same-operation retention byte-idempotent, including first observation time", () => {
    const first = retain();
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const actual = window.sessionStorage;
    const setItem = vi.fn((key: string, value: string) => actual.setItem(key, value));
    const storage = mockSessionStorage({ setItem });
    const repeated = retain(activeSnapshot(), first.value.record.outcome.observedAt + 60_000);
    expect(repeated).toEqual(first);
    expect(setItem).not.toHaveBeenCalled();
    storage.mockRestore();
  });

  it("rejects a different snapshot for the same operation without overwriting", () => {
    const first = retain();
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const before = sessionStorage.getItem(retainedReconciliationKey(RESTAURANT, USER, OPERATION));
    expect(retain(activeSnapshot(121))).toEqual({ ok: false, reason: "collision" });
    expect(sessionStorage.getItem(retainedReconciliationKey(RESTAURANT, USER, OPERATION))).toBe(before);
  });

  it("validates the exact failed-draft bytes before retaining them", () => {
    const corrupt = activeSnapshot();
    corrupt.raw = "{corrupt";
    expect(retain(corrupt)).toEqual({ ok: false, reason: "corrupt" });
    expect(sessionStorage.length).toBe(0);
  });

  it.each(["setItem", "getItem"] as const)("fails closed on %s failure", (method) => {
    mockSessionStorage({ [method]: () => {
      throw new Error("storage unavailable");
    } });
    expect(retain()).toMatchObject({ ok: false });
  });

  it("reports corrupt retained evidence without deleting it", () => {
    const key = retainedReconciliationKey(RESTAURANT, USER, OPERATION);
    sessionStorage.setItem(key, "{corrupt");
    expect(readRetainedReconciliations(RESTAURANT, USER)).toEqual({ ok: false, reason: "corrupt" });
    expect(sessionStorage.getItem(key)).toBe("{corrupt");
  });

  it("is unchanged by ordinary active-draft success or discard cleanup", () => {
    const retained = retain();
    expect(retained.ok).toBe(true);
    if (!retained.ok) return;
    const key = retainedReconciliationKey(RESTAURANT, USER, OPERATION);
    const exactRaw = sessionStorage.getItem(key);

    writeReconcileDraft(RESTAURANT, USER, { wine: { newRemainingMl: 1 } });
    clearReconcileDraft(RESTAURANT, USER);
    writeReconcileDraft(RESTAURANT, USER, { wine: { newRemainingMl: 2 } });
    clearReconcileDraft(RESTAURANT, USER);

    expect(sessionStorage.getItem(key)).toBe(exactRaw);
    expect(readRetainedReconciliations(RESTAURANT, USER)).toEqual({
      ok: true,
      value: [retained.value],
    });
  });
});

describe("separate handoff confirmation", () => {
  it("confirms by exact retained bytes and records fresh-load completion separately", () => {
    const retained = retain();
    expect(retained.ok).toBe(true);
    if (!retained.ok) return;
    const confirmed = confirmRetainedReconciliation(retained.value, 1_790_323_320_000);
    expect(confirmed.ok).toBe(true);
    if (!confirmed.ok) return;
    expect(confirmed.value.confirmation).toMatchObject({
      retainedRecordRaw: retained.value.raw,
      confirmedAt: 1_790_323_320_000,
      freshLoadedAt: null,
    });
    expect(readRetainedReconciliationConfirmation(retained.value)).toEqual(confirmed);

    const loaded = markRetainedReconciliationFreshLoaded(
      retained.value, 1_790_323_380_000,
    );
    expect(loaded.ok && loaded.value.confirmation.freshLoadedAt).toBe(1_790_323_380_000);
    expect(sessionStorage.getItem(retainedReconciliationKey(RESTAURANT, USER, OPERATION)))
      .toBe(retained.value.raw);
  });
});
