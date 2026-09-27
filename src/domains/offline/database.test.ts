import { describe, expect, it, vi } from "vitest";
import type { OfflineContextResponse } from "./contract";
import {
  DEVICE_ACCESS_FENCE_RESTAURANT_ID,
  DEVICE_ACCESS_FENCE_USER_ID,
  captureDeviceAccessFence,
  lockAllContexts,
  provisionOfflineContext,
  readSoleUsableProjection,
  type DeviceAccessFence,
  type OfflineClock,
  type OfflineDatabaseOptions,
} from "./database";
import { REPROVISION_REQUIRED } from "./device-lock";
import { asIdbFactory, MemoryIdbFactory } from "./indexeddb.test-helper";

const NOW = Date.parse("2026-09-23T12:00:00.000Z");
const USER_A = "10000000-0000-4000-8000-000000000001";
const SITE_A = "10000000-0000-4000-8000-000000000002";
const USER_B = "20000000-0000-4000-8000-000000000001";
const SITE_B = "20000000-0000-4000-8000-000000000002";
const GENERATION_A = "10000000-0000-4000-8000-000000000010";
const GENERATION_B = "20000000-0000-4000-8000-000000000010";

const response = (
  userId = USER_A,
  restaurantId = SITE_A,
  overrides: Partial<OfflineContextResponse["context"]> = {},
): OfflineContextResponse => ({
  schemaVersion: 1,
  context: {
    contextId: `${userId.slice(0, 8)}-0000-4000-8000-000000000003`,
    userId,
    restaurantId,
    issuedAt: "2026-09-23T11:00:00.000Z",
    expiresAt: "2026-09-23T23:00:00.000Z",
    ...overrides,
  },
  projection: {
    kind: "cellar_lookup",
    version: 1,
    asOf: "2026-09-23T11:00:00.000Z",
    rows: [],
  },
});

const systemClock: OfflineClock = {
  now: () => NOW,
  setTimeout(callback, delay) {
    const handle = setTimeout(callback, delay);
    return () => clearTimeout(handle);
  },
};
const immediateClock: OfflineClock = {
  now: () => NOW,
  setTimeout(callback) {
    queueMicrotask(callback);
    return () => undefined;
  },
};
class ControlledClock implements OfflineClock {
  private readonly deadlines: Array<{ callback: () => void; cancelled: boolean }> = [];
  now = () => NOW;
  setTimeout = (callback: () => void) => {
    const deadline = { callback, cancelled: false };
    this.deadlines.push(deadline);
    return () => { deadline.cancelled = true; };
  };
  activeCount() {
    return this.deadlines.filter((deadline) => !deadline.cancelled).length;
  }
  fireLastActive() {
    const deadline = this.deadlines.findLast((candidate) => !candidate.cancelled);
    expect(deadline).toBeDefined();
    deadline!.cancelled = true;
    deadline!.callback();
  }
}
async function waitForObservation(predicate: () => boolean) {
  for (let attempts = 0; attempts < 20 && !predicate(); attempts += 1) {
    await Promise.resolve();
  }
  expect(predicate()).toBe(true);
}
const counters = new WeakMap<MemoryIdbFactory, number>();
const options = (factory: MemoryIdbFactory, clock: OfflineClock = systemClock): OfflineDatabaseOptions => ({
  indexedDB: asIdbFactory(factory),
  clock,
  randomUUID: () => {
    const next = (counters.get(factory) ?? 0) + 1;
    counters.set(factory, next);
    return `f0000000-0000-4000-8000-${String(next).padStart(12, "0")}`;
  },
});
const auth = (
  value: OfflineContextResponse,
  capturedFence: DeviceAccessFence | null,
  authorizationGeneration = GENERATION_A,
) => ({
  userId: value.context.userId,
  restaurantId: value.context.restaurantId,
  authorizationGeneration,
  marker: REPROVISION_REQUIRED,
  capturedFence,
} as const);
async function captured(factory: MemoryIdbFactory) {
  const result = await captureDeviceAccessFence(options(factory));
  expect(result.status).toBe("captured");
  return result.status === "captured" ? result.fence : null;
}
async function provision(
  factory: MemoryIdbFactory,
  value = response(),
  generation = GENERATION_A,
  fence?: DeviceAccessFence | null,
) {
  const snapshot = fence === undefined ? await captured(factory) : fence;
  return provisionOfflineContext(value, auth(value, snapshot, generation), options(factory));
}
const read = (factory: MemoryIdbFactory, now = NOW, generation = GENERATION_A) =>
  readSoleUsableProjection({
    userId: USER_A,
    restaurantId: SITE_A,
    authorizationGeneration: generation,
    now,
  }, options(factory));
const positiveRequest = (now = NOW) => ({
  userId: USER_A,
  restaurantId: SITE_A,
  authorizationGeneration: GENERATION_A,
  now,
});
const fenceRow = (factory: MemoryIdbFactory) => factory.rows("contexts").find(
  (row) => (row as { recordType?: string }).recordType === "device_access_fence",
) as Record<string, unknown>;
const contextRow = (factory: MemoryIdbFactory, userId = USER_A) => factory.rows("contexts").find(
  (row) => (row as { userId?: string }).userId === userId,
) as Record<string, unknown>;

describe("offline positive-eligibility database", () => {
  it("keeps the two v1 stores while writing generation-bound current records and an eligible fence", async () => {
    const factory = new MemoryIdbFactory();
    expect(await provision(factory)).toEqual({ status: "stored", replayed: false });

    expect([...factory.database.objectStoreNames]).toEqual(["contexts", "projections"]);
    expect(factory.database.keyPaths.get("contexts")).toEqual(["userId", "restaurantId"]);
    expect(factory.database.keyPaths.get("projections")).toEqual([
      "userId", "restaurantId", "projectionKind",
    ]);
    expect(contextRow(factory)).toMatchObject({
      eligibilityVersion: 1,
      authorizationGeneration: GENERATION_A,
      lockedAt: null,
    });
    expect(factory.rows("projections")[0]).toMatchObject({
      contextId: response().context.contextId,
    });
    expect(fenceRow(factory)).toMatchObject({
      userId: DEVICE_ACCESS_FENCE_USER_ID,
      restaurantId: DEVICE_ACCESS_FENCE_RESTAURANT_ID,
      state: "eligible",
      authorizationGeneration: GENERATION_A,
    });
    expect(await read(factory)).toEqual({ status: "ready", value: response() });
  });

  it.each([
    ["unknown response field", (value: OfflineContextResponse) => ({
      input: { ...value, role: "owner" }, authorization: auth(value, null),
    })],
    ["unknown schema version", (value: OfflineContextResponse) => ({
      input: { ...value, schemaVersion: 2 }, authorization: auth(value, null),
    })],
    ["unknown projection version", (value: OfflineContextResponse) => ({
      input: { ...value, projection: { ...value.projection, version: 2 } },
      authorization: auth(value, null),
    })],
    ["actor mismatch", (value: OfflineContextResponse) => ({
      input: value,
      authorization: { ...auth(value, null), userId: USER_B },
    })],
  ])("validates %s before opening storage", async (_label, makeInvalid) => {
    const factory = new MemoryIdbFactory();
    const value = response();
    const candidate = makeInvalid(value);
    expect((await provisionOfflineContext(
      candidate.input,
      candidate.authorization,
      options(factory),
    )).status)
      .toBe("unavailable");
    expect(factory.database.data.size).toBe(0);
  });

  it("rejects an already expired lease before opening storage", async () => {
    const factory = new MemoryIdbFactory();
    const value = response(USER_A, SITE_A, {
      issuedAt: "2026-09-22T11:00:00.000Z",
      expiresAt: "2026-09-22T23:00:00.000Z",
    });
    expect(await provisionOfflineContext(value, auth(value, null), options(factory)))
      .toEqual({ status: "unavailable", reason: "stale_response" });
    expect(factory.database.data.size).toBe(0);
  });

  it.each(["version", "stores", "contexts-key", "projections-key"] as const)(
    "rejects unexpected database %s without deleting bytes",
    async (shape) => {
      const factory = new MemoryIdbFactory();
      await provision(factory);
      const before = structuredClone({
        contexts: factory.rows("contexts"), projections: factory.rows("projections"),
      });
      if (shape === "version") factory.database.version = 2;
      else if (shape === "stores") factory.faults.extraStore = "unexpected";
      else factory.database.keyPaths.set(
        shape === "contexts-key" ? "contexts" : "projections",
        ["wrongKey"],
      );

      expect((await read(factory)).status).toBe("unavailable");
      expect({ contexts: factory.rows("contexts"), projections: factory.rows("projections") })
        .toEqual(before);
    },
  );

  it("locks every other current or legacy partition in the same provision transaction", async () => {
    const factory = new MemoryIdbFactory();
    await provision(factory, response(USER_B, SITE_B), GENERATION_B);
    factory.seed("contexts", {
      schemaVersion: 1,
      contextId: "30000000-0000-4000-8000-000000000003",
      userId: "30000000-0000-4000-8000-000000000001",
      restaurantId: "30000000-0000-4000-8000-000000000002",
      issuedAt: "2026-09-23T11:00:00.000Z",
      expiresAt: "2026-09-23T23:00:00.000Z",
      lastObservedWallClock: "2026-09-23T11:00:00.000Z",
      lockedAt: null,
      lockReason: null,
      projectionVersion: 1,
    });

    expect(await provision(factory, response(), GENERATION_A)).toEqual({
      status: "stored", replayed: false,
    });
    expect(contextRow(factory, USER_B)).toMatchObject({
      lockedAt: new Date(NOW).toISOString(), lockReason: "reprovisioned",
    });
    expect(contextRow(factory, "30000000-0000-4000-8000-000000000001")).toMatchObject({
      lockedAt: new Date(NOW).toISOString(), lockReason: "reprovisioned",
    });
    expect(contextRow(factory)).toMatchObject({ lockedAt: null });
  });

  it("aborts a stale provision when a denial fence commits after capture", async () => {
    const factory = new MemoryIdbFactory();
    const staleCapture = await captured(factory);
    expect(await lockAllContexts("sign_out", GENERATION_A, () => undefined, options(factory)))
      .toEqual({ locked: false, denialFenceCommitted: true, projectionsDeleted: true });

    expect(await provision(factory, response(), GENERATION_B, staleCapture)).toEqual({
      status: "unavailable", reason: "fence_changed",
    });
    expect(fenceRow(factory)).toMatchObject({ state: "denied" });
    expect(contextRow(factory)).toBeUndefined();
  });

  it("requires a different generation after denial", async () => {
    const factory = new MemoryIdbFactory();
    await lockAllContexts("sign_out", GENERATION_A, () => undefined, options(factory));
    const denied = await captured(factory);

    expect((await provision(factory, response(), GENERATION_A, denied)).status).toBe("unavailable");
    expect(await provision(factory, response(), GENERATION_B, denied)).toEqual({
      status: "stored", replayed: false,
    });
  });

  it("orders same-generation responses and treats only an exact replay as idempotent", async () => {
    const factory = new MemoryIdbFactory();
    const original = response();
    await provision(factory, original);
    const eligible = await captured(factory);

    expect(await provision(factory, original, GENERATION_A, eligible)).toEqual({
      status: "stored", replayed: true,
    });
    const ambiguous = response(USER_A, SITE_A, {
      contextId: "10000000-0000-4000-8000-000000000099",
    });
    expect(await provision(factory, ambiguous, GENERATION_A, eligible)).toEqual({
      status: "unavailable", reason: "ambiguous_context",
    });
    const older = response(USER_A, SITE_A, {
      issuedAt: "2026-09-23T10:30:00.000Z",
      expiresAt: "2026-09-23T22:30:00.000Z",
    });
    expect(await provision(factory, older, GENERATION_A, eligible)).toEqual({
      status: "unavailable", reason: "stale_response",
    });
    const newer = response(USER_A, SITE_A, {
      contextId: "10000000-0000-4000-8000-000000000098",
      issuedAt: "2026-09-23T11:30:00.000Z",
    });
    expect(await provision(factory, newer, GENERATION_A, eligible)).toEqual({
      status: "stored", replayed: false,
    });
  });

  it("serializes two captured provisions through the fence revision", async () => {
    const factory = new MemoryIdbFactory();
    const shared = await captured(factory);
    expect((await provision(factory, response(), GENERATION_A, shared)).status).toBe("stored");
    expect(await provision(factory, response(), GENERATION_A, shared)).toEqual({
      status: "unavailable", reason: "fence_changed",
    });
  });

  it.each(["context", "projection", "fence", "other-lock"] as const)(
    "rolls back all provision writes when the %s write fails",
    async (failure) => {
      const factory = new MemoryIdbFactory();
      await provision(factory, response(USER_B, SITE_B), GENERATION_B);
      const before = structuredClone({
        contexts: factory.rows("contexts"), projections: factory.rows("projections"),
      });
      const eligible = await captured(factory);
      factory.faults.failPut = (store, value) => {
        const row = value as Record<string, unknown>;
        if (failure === "projection") return store === "projections";
        if (failure === "fence") return row.recordType === "device_access_fence";
        if (failure === "other-lock") return row.userId === USER_B;
        return row.eligibilityVersion === 1 && row.userId === USER_A;
      };

      expect((await provision(factory, response(), GENERATION_A, eligible)).status)
        .toBe("unavailable");
      expect({ contexts: factory.rows("contexts"), projections: factory.rows("projections") })
        .toEqual(before);
    },
  );

  it.each([
    ["before_issued", Date.parse("2026-09-23T10:00:00.000Z")],
    ["expired", Date.parse("2026-09-24T00:00:00.000Z")],
    ["clock_rollback", Date.parse("2026-09-23T11:30:00.000Z")],
  ] as const)("locks and withholds a %s partition", async (reason, now) => {
    const factory = new MemoryIdbFactory();
    await provision(factory);
    if (reason === "clock_rollback") {
      factory.seed("contexts", {
        ...contextRow(factory), lastObservedWallClock: "2026-09-23T11:45:00.000Z",
      });
    }
    expect(await read(factory, now)).toMatchObject({
      status: "unavailable", reason, lockPersisted: true,
    });
    expect(contextRow(factory).lockedAt).toBe(new Date(now).toISOString());
  });

  it("returns no data when an expiry lock cannot persist", async () => {
    const factory = new MemoryIdbFactory();
    await provision(factory);
    factory.faults.failRequest = "contexts.put";
    const result = await read(factory, Date.parse("2026-09-24T00:00:00.000Z"));
    expect(result).toMatchObject({ status: "unavailable", reason: "expired", lockPersisted: false });
    expect(result).not.toHaveProperty("value");
  });

  it.each([
    ["missing projection", (factory: MemoryIdbFactory) => {
      factory.database.data.get("projections")!.clear();
    }],
    ["corrupt context", (factory: MemoryIdbFactory) => {
      factory.seed("contexts", { ...contextRow(factory), role: "owner" });
    }],
    ["mismatched projection", (factory: MemoryIdbFactory) => {
      factory.seed("projections", {
        ...(factory.rows("projections")[0] as Record<string, unknown>),
        contextId: "20000000-0000-4000-8000-000000000003",
      });
    }],
  ])("returns no private rows for %s", async (_label, mutate) => {
    const factory = new MemoryIdbFactory();
    await provision(factory);
    mutate(factory);
    const result = await read(factory);
    expect(result.status).toBe("unavailable");
    expect(result).not.toHaveProperty("value");
  });

  it.each([
    [null, "sign_out"],
    ["2026-09-23T11:30:00.000Z", null],
  ] as const)("withholds rows for an inconsistent lock tuple (%s, %s)", async (lockedAt, lockReason) => {
    const factory = new MemoryIdbFactory();
    await provision(factory);
    factory.seed("contexts", { ...contextRow(factory), lockedAt, lockReason });
    const result = await read(factory);
    expect(result.status).toBe("unavailable");
    expect(result).not.toHaveProperty("value");
  });

  it("returns no private rows when zero or multiple current contexts are eligible", async () => {
    const empty = new MemoryIdbFactory();
    const emptyResult = await read(empty);
    expect(emptyResult.status).toBe("unavailable");
    expect(emptyResult).not.toHaveProperty("value");

    const multiple = new MemoryIdbFactory();
    await provision(multiple);
    multiple.seed("contexts", {
      ...contextRow(multiple),
      contextId: "20000000-0000-4000-8000-000000000003",
      userId: USER_B,
      restaurantId: SITE_B,
    });
    const ambiguous = await read(multiple);
    expect(ambiguous).toMatchObject({ status: "unavailable", reason: "ambiguous_context" });
    expect(ambiguous).not.toHaveProperty("value");
  });

  it.each(["contexts.getAll", "contexts.put"] as const)(
    "does not expose data when %s aborts",
    async (failure) => {
      const factory = new MemoryIdbFactory();
      await provision(factory);
      factory.faults.failRequest = failure;
      const result = await read(factory);
      expect(result.status).toBe("unavailable");
      expect(result).not.toHaveProperty("value");
    },
  );

  it("commits a zero-context denial fence without claiming a legacy lock", async () => {
    const factory = new MemoryIdbFactory();
    expect(await lockAllContexts("sign_out", GENERATION_A, () => undefined, options(factory)))
      .toEqual({ locked: false, denialFenceCommitted: true, projectionsDeleted: true });
    expect(factory.rows("contexts")).toHaveLength(1);
    expect(fenceRow(factory)).toMatchObject({
      state: "denied", authorizationGeneration: GENERATION_A,
      eligibleUserId: null, eligibleRestaurantId: null, eligibleContextId: null,
    });
  });

  it.each([
    ["another current context", {
      schemaVersion: 1, eligibilityVersion: 1, authorizationGeneration: GENERATION_B,
      contextId: "20000000-0000-4000-8000-000000000003", userId: USER_B,
      restaurantId: SITE_B, issuedAt: "2026-09-23T11:00:00.000Z",
      expiresAt: "2026-09-23T23:00:00.000Z",
      lastObservedWallClock: "2026-09-23T11:00:00.000Z", lockedAt: null,
      lockReason: null, projectionVersion: 1,
    }],
    ["legacy context", {
      schemaVersion: 1, contextId: "20000000-0000-4000-8000-000000000003",
      userId: USER_B, restaurantId: SITE_B, issuedAt: "2026-09-23T11:00:00.000Z",
      expiresAt: "2026-09-23T23:00:00.000Z",
      lastObservedWallClock: "2026-09-23T11:00:00.000Z", lockedAt: null,
      lockReason: null, projectionVersion: 1,
    }],
    ["already locked unrelated context", {
      schemaVersion: 1, contextId: "20000000-0000-4000-8000-000000000003",
      userId: USER_B, restaurantId: SITE_B, issuedAt: "2026-09-23T11:00:00.000Z",
      expiresAt: "2026-09-23T23:00:00.000Z",
      lastObservedWallClock: "2026-09-23T11:00:00.000Z",
      lockedAt: "2026-09-23T11:30:00.000Z", lockReason: "sign_out", projectionVersion: 1,
    }],
  ])("keeps locked truth separate from a fresh denial fence for %s", async (_label, row) => {
    const factory = new MemoryIdbFactory();
    expect(await captureDeviceAccessFence(options(factory)))
      .toEqual({ status: "captured", fence: null });
    factory.seed("contexts", row);
    expect(await lockAllContexts("access_changed", GENERATION_A, () => undefined, options(factory)))
      .toEqual({ locked: true, denialFenceCommitted: true, projectionsDeleted: true });
    expect(fenceRow(factory)).toMatchObject({ state: "denied", reason: "access_changed" });
  });

  it("locks current and legacy rows while reporting fence and projection results independently", async () => {
    const factory = new MemoryIdbFactory();
    await provision(factory);
    factory.seed("contexts", {
      schemaVersion: 1,
      contextId: "20000000-0000-4000-8000-000000000003",
      userId: USER_B,
      restaurantId: SITE_B,
      issuedAt: "2026-09-23T11:00:00.000Z",
      expiresAt: "2026-09-23T23:00:00.000Z",
      lastObservedWallClock: "2026-09-23T11:00:00.000Z",
      lockedAt: null,
      lockReason: null,
      projectionVersion: 1,
    });
    const clearMemory = vi.fn(() => { factory.faults.failRequest = "projections.clear"; });

    expect(await lockAllContexts("access_changed", GENERATION_A, clearMemory, options(factory)))
      .toEqual({ locked: true, denialFenceCommitted: true, projectionsDeleted: false });
    expect(clearMemory).toHaveBeenCalledOnce();
    expect(contextRow(factory)).toMatchObject({ lockReason: "access_changed" });
    expect(contextRow(factory, USER_B)).toMatchObject({ lockReason: "access_changed" });
    expect(fenceRow(factory)).toMatchObject({ state: "denied", reason: "access_changed" });
  });

  it("returns both denial booleans false when the fence transaction aborts", async () => {
    const factory = new MemoryIdbFactory();
    await provision(factory);
    factory.faults.failPut = (store, value) =>
      store === "contexts" && (value as { recordType?: string }).recordType === "device_access_fence";
    const clearMemory = vi.fn(() => { factory.faults.failPut = undefined; });

    expect(await lockAllContexts("sign_out", GENERATION_A, clearMemory, options(factory)))
      .toEqual({ locked: false, denialFenceCommitted: false, projectionsDeleted: true });
    expect(contextRow(factory)).toMatchObject({ lockedAt: null });
  });

  it("still deletes projections when caller memory cleanup throws", async () => {
    const factory = new MemoryIdbFactory();
    await provision(factory);
    expect(await lockAllContexts("sign_out", GENERATION_A, () => {
      throw new Error("in-memory cleanup failed");
    }, options(factory))).toEqual({
      locked: true,
      denialFenceCommitted: true,
      projectionsDeleted: true,
    });
    expect(factory.rows("projections")).toEqual([]);
  });

  it.each(["blocked", "denied", "hang"] as const)(
    "bounds a %s database open with a data-free result",
    async (open) => {
      const factory = new MemoryIdbFactory();
      factory.faults.open = open;
      const result = await readSoleUsableProjection({
        userId: USER_A,
        restaurantId: SITE_A,
        authorizationGeneration: GENERATION_A,
        now: NOW,
      }, options(factory, immediateClock));
      expect(result.status).toBe("unavailable");
      expect(result).not.toHaveProperty("value");
    },
  );

  it("aborts a live transaction when a request reaches its deadline", async () => {
    const factory = new MemoryIdbFactory();
    await provision(factory);
    factory.faults.hangRequest = "contexts.getAll";
    const clock = new ControlledClock();
    const pending = readSoleUsableProjection(positiveRequest(), options(factory, clock));
    await waitForObservation(() => factory.observations.hungRequests.length === 1);
    expect(clock.activeCount()).toBe(2);
    clock.fireLastActive();
    const result = await pending;
    expect(factory.observations.abortedTransactions).toBe(1);
    expect(result.status).toBe("unavailable");
    expect(result).not.toHaveProperty("value");
  });

  it("withholds a successful read operation when its transaction never commits", async () => {
    const factory = new MemoryIdbFactory();
    await provision(factory);
    factory.faults.hangTransaction = true;
    factory.observations.successfulRequests.length = 0;
    const clock = new ControlledClock();
    const pending = readSoleUsableProjection(positiveRequest(), options(factory, clock));
    await waitForObservation(() => factory.observations.successfulRequests.includes("contexts.put"));
    expect(clock.activeCount()).toBe(1);
    clock.fireLastActive();
    const result = await pending;
    expect(result.status).toBe("unavailable");
    expect(result).not.toHaveProperty("value");
  });

  it("dispatches version change and withholds data from the interrupted transaction", async () => {
    const factory = new MemoryIdbFactory();
    await provision(factory);
    factory.faults.versionChangeOn = "contexts.getAll";
    const clock = new ControlledClock();
    const pending = readSoleUsableProjection(positiveRequest(), options(factory, clock));
    await waitForObservation(() => factory.observations.versionChanges.length === 1);
    expect(factory.observations.abortedTransactions).toBe(1);
    clock.fireLastActive();
    const result = await pending;
    expect(result.status).toBe("unavailable");
    expect(result).not.toHaveProperty("value");
  });
});
