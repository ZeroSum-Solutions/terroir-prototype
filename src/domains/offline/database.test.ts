import { describe, expect, it, vi } from "vitest";
import type { OfflineContextResponse } from "./contract";
import {
  lockAllContexts,
  provisionOfflineContext,
  readSoleUsableProjection,
  type OfflineClock,
} from "./database";
import { asIdbFactory, MemoryIdbFactory } from "./indexeddb.test-helper";

const NOW = Date.parse("2026-09-23T12:00:00.000Z");
const USER_A = "10000000-0000-4000-8000-000000000001";
const SITE_A = "10000000-0000-4000-8000-000000000002";
const USER_B = "20000000-0000-4000-8000-000000000001";
const SITE_B = "20000000-0000-4000-8000-000000000002";

const response = (userId = USER_A, restaurantId = SITE_A): OfflineContextResponse => ({
  schemaVersion: 1,
  context: {
    contextId: `${userId.slice(0, 8)}-0000-4000-8000-000000000003`,
    userId,
    restaurantId,
    issuedAt: "2026-09-23T11:00:00.000Z",
    expiresAt: "2026-09-23T23:00:00.000Z",
  },
  projection: {
    kind: "cellar_lookup",
    version: 1,
    asOf: "2026-09-23T11:00:00.000Z",
    rows: [{
      wineId: `${userId.slice(0, 8)}-0000-4000-8000-000000000004`,
      displayName: "Volnay",
      producer: "Maison Example",
      vintage: 2022,
      format: "750ml",
      sealedQuantity: 4,
      placements: [{
        binId: `${userId.slice(0, 8)}-0000-4000-8000-000000000005`,
        label: "A-01",
        sealedQuantity: 4,
      }],
      activeOpenBottleId: null,
      openedAt: null,
      remainingMl: null,
    }],
  },
});

const immediateClock: OfflineClock = {
  now: () => NOW,
  setTimeout: (callback) => {
    queueMicrotask(callback);
    return () => undefined;
  },
};

const systemClock: OfflineClock = {
  now: () => NOW,
  setTimeout: (callback, delay) => {
    const handle = setTimeout(callback, delay);
    return () => clearTimeout(handle);
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

const options = (factory: MemoryIdbFactory, clock?: OfflineClock) => ({
  indexedDB: asIdbFactory(factory),
  clock: clock ?? systemClock,
});

describe("offline database", () => {
  it("creates exactly the two v1 compound-key stores and round-trips the allowlist", async () => {
    const factory = new MemoryIdbFactory();

    expect(await provisionOfflineContext(response(), options(factory))).toEqual({ status: "stored" });
    expect([...factory.database.objectStoreNames]).toEqual(["contexts", "projections"]);
    expect(factory.database.keyPaths.get("contexts")).toEqual(["userId", "restaurantId"]);
    expect(factory.database.keyPaths.get("projections")).toEqual([
      "userId", "restaurantId", "projectionKind",
    ]);

    const result = await readSoleUsableProjection(NOW, options(factory));
    expect(result).toEqual({ status: "ready", value: response() });
    expect(factory.rows("contexts")[0]).toEqual(expect.objectContaining({
      lastObservedWallClock: new Date(NOW).toISOString(),
      lockedAt: null,
      lockReason: null,
    }));
  });

  it.each([
    ["forbidden response fields", (value: OfflineContextResponse) => ({ ...value, role: "owner" })],
    ["unknown schema versions", (value: OfflineContextResponse) => ({ ...value, schemaVersion: 2 })],
    ["unknown projection versions", (value: OfflineContextResponse) => ({
      ...value,
      projection: { ...value.projection, version: 2 },
    })],
  ])("validates before opening storage and rejects %s", async (_label, makeInvalid) => {
    const factory = new MemoryIdbFactory();

    expect(await provisionOfflineContext(makeInvalid(response()), options(factory))).toEqual({
      status: "unavailable",
      reason: "invalid_response",
    });
    expect(factory.database.data.size).toBe(0);
  });

  it.each(["version", "stores"] as const)("rejects an unexpected database %s without deleting it", async (shape) => {
    const factory = new MemoryIdbFactory();
    await provisionOfflineContext(response(), options(factory));
    if (shape === "version") factory.database.version = 2;
    else factory.faults.extraStore = "unexpected";

    const result = await readSoleUsableProjection(NOW, options(factory));
    expect(result).toEqual({ status: "unavailable", reason: "storage_failure" });
    expect(factory.rows("contexts")).toHaveLength(1);
    expect(factory.rows("projections")).toHaveLength(1);
  });

  it.each(["contexts", "projections"] as const)(
    "rejects an existing database with a mismatched %s key path",
    async (store) => {
      const factory = new MemoryIdbFactory();
      await provisionOfflineContext(response(), options(factory));
      factory.database.keyPaths.set(store, ["wrongKey"]);

      const result = await readSoleUsableProjection(NOW, options(factory));
      expect(result).toEqual({ status: "unavailable", reason: "storage_failure" });
      expect(factory.rows("contexts")).toHaveLength(1);
      expect(factory.rows("projections")).toHaveLength(1);
    },
  );

  it("atomically locks every old context while replacing only the current partition", async () => {
    const factory = new MemoryIdbFactory();
    await provisionOfflineContext(response(USER_B, SITE_B), options(factory));
    await provisionOfflineContext(response(), options(factory));

    const contexts = factory.rows("contexts") as Array<Record<string, unknown>>;
    expect(contexts.find((row) => row.userId === USER_B)).toMatchObject({
      lockedAt: new Date(NOW).toISOString(),
      lockReason: "reprovisioned",
    });
    expect(contexts.find((row) => row.userId === USER_A)).toMatchObject({ lockedAt: null });
    expect(factory.rows("projections")).toHaveLength(2);
  });

  it.each([
    ["projection write", (factory: MemoryIdbFactory) => {
      factory.faults.failRequest = "projections.put";
    }],
    ["non-current lock write", (factory: MemoryIdbFactory) => {
      factory.faults.failPut = (store, value) =>
        store === "contexts" && (value as { userId?: string }).userId === USER_B;
    }],
  ])("rolls back every provision write after a failed %s", async (_label, configure) => {
    const factory = new MemoryIdbFactory();
    await provisionOfflineContext(response(USER_B, SITE_B), options(factory));
    const before = structuredClone({
      contexts: factory.rows("contexts"),
      projections: factory.rows("projections"),
    });
    configure(factory);

    expect(await provisionOfflineContext(response(), options(factory))).toEqual({
      status: "unavailable",
      reason: "storage_failure",
    });
    expect({ contexts: factory.rows("contexts"), projections: factory.rows("projections") })
      .toEqual(before);
  });

  it("is idempotent and never creates another store", async () => {
    const factory = new MemoryIdbFactory();
    await provisionOfflineContext(response(), options(factory));
    await provisionOfflineContext(response(), options(factory));

    expect(factory.rows("contexts")).toHaveLength(1);
    expect(factory.rows("projections")).toHaveLength(1);
    expect(factory.database.objectStoreNames.length).toBe(2);
  });

  it.each([
    ["missing projection", (factory: MemoryIdbFactory) => factory.database.data.get("projections")!.clear()],
    ["corrupt context", (factory: MemoryIdbFactory) => {
      const corrupt = factory.rows("contexts")[0] as Record<string, unknown>;
      corrupt.role = "owner";
      factory.database.data.get("contexts")!.clear();
      factory.seed("contexts", corrupt);
    }],
    ["mismatched projection", (factory: MemoryIdbFactory) => {
      const projection = factory.rows("projections")[0] as Record<string, unknown>;
      factory.database.data.get("projections")!.clear();
      factory.seed("projections", { ...projection, version: 99 });
    }],
  ])("returns no private rows for %s", async (_label, mutate) => {
    const factory = new MemoryIdbFactory();
    await provisionOfflineContext(response(), options(factory));
    mutate(factory);

    const result = await readSoleUsableProjection(NOW, options(factory));
    expect(result.status).toBe("unavailable");
    expect(result).not.toHaveProperty("value");
  });

  it.each([
    [null, "sign_out"],
    ["2026-09-23T11:30:00.000Z", null],
  ] as const)(
    "withholds rows for an inconsistent persisted lock tuple (%s, %s)",
    async (lockedAt, lockReason) => {
      const factory = new MemoryIdbFactory();
      await provisionOfflineContext(response(), options(factory));
      const context = factoryContext(factory, USER_A);
      factory.seed("contexts", { ...context, lockedAt, lockReason });

      const result = await readSoleUsableProjection(NOW, options(factory));
      expect(result).toEqual({ status: "unavailable", reason: "corrupt_state" });
      expect(result).not.toHaveProperty("value");
    },
  );

  it("returns no private rows when zero or multiple contexts are eligible", async () => {
    const empty = new MemoryIdbFactory();
    expect((await readSoleUsableProjection(NOW, options(empty))).status).toBe("unavailable");

    const multiple = new MemoryIdbFactory();
    await provisionOfflineContext(response(USER_B, SITE_B), options(multiple));
    await provisionOfflineContext(response(), options(multiple));
    const old = factoryContext(multiple, USER_B);
    old.lockedAt = null;
    old.lockReason = null;
    multiple.seed("contexts", old);
    expect((await readSoleUsableProjection(NOW, options(multiple))).status).toBe("unavailable");
  });

  it.each([
    ["before_issued", Date.parse("2026-09-23T10:00:00.000Z")],
    ["expired", Date.parse("2026-09-24T00:00:00.000Z")],
    ["clock_rollback", Date.parse("2026-09-23T11:30:00.000Z")],
  ])("locks and withholds a %s partition", async (reason, now) => {
    const factory = new MemoryIdbFactory();
    await provisionOfflineContext(response(), options(factory));
    if (reason === "clock_rollback") {
      const context = factoryContext(factory, USER_A);
      context.lastObservedWallClock = "2026-09-23T11:45:00.000Z";
      factory.seed("contexts", context);
    }

    const result = await readSoleUsableProjection(now, options(factory));
    expect(result).toMatchObject({ status: "unavailable", reason, lockPersisted: true });
    expect(factoryContext(factory, USER_A)).toMatchObject({ lockedAt: new Date(now).toISOString() });
  });

  it("returns no data even when an expiry lock cannot persist", async () => {
    const factory = new MemoryIdbFactory();
    await provisionOfflineContext(response(), options(factory));
    factory.faults.failRequest = "contexts.put";

    expect(await readSoleUsableProjection(
      Date.parse("2026-09-24T00:00:00.000Z"),
      options(factory),
    )).toMatchObject({ status: "unavailable", reason: "expired", lockPersisted: false });
  });

  it.each(["contexts.getAll", "contexts.put"] as const)(
    "does not expose data when %s aborts",
    async (failure) => {
    const factory = new MemoryIdbFactory();
    await provisionOfflineContext(response(), options(factory));
    factory.faults.failRequest = failure;

    const result = await readSoleUsableProjection(NOW, options(factory));
    expect(result).toEqual({ status: "unavailable", reason: "storage_failure" });
    expect(result).not.toHaveProperty("value");
    },
  );

  it("commits locks before separately deleting projections", async () => {
    const factory = new MemoryIdbFactory();
    await provisionOfflineContext(response(), options(factory));
    const clearMemory = vi.fn();

    expect(await lockAllContexts("sign_out", clearMemory, options(factory))).toEqual({
      locked: true,
      projectionsDeleted: true,
    });
    expect(clearMemory).toHaveBeenCalledOnce();
    expect(factoryContext(factory, USER_A).lockedAt).toBe(new Date(NOW).toISOString());
    expect(factory.rows("projections")).toEqual([]);
  });

  it("still attempts deletion and reports independent results after lock failure", async () => {
    const factory = new MemoryIdbFactory();
    await provisionOfflineContext(response(), options(factory));
    factory.faults.failRequest = "contexts.put";
    const clearMemory = vi.fn(() => {
      factory.faults.failRequest = undefined;
    });

    expect(await lockAllContexts("sign_out", clearMemory, options(factory))).toEqual({
      locked: false,
      projectionsDeleted: true,
    });
    expect(clearMemory).toHaveBeenCalledOnce();
    expect(factory.rows("projections")).toEqual([]);
  });

  it("reports a committed lock independently when projection deletion fails", async () => {
    const factory = new MemoryIdbFactory();
    await provisionOfflineContext(response(), options(factory));
    const clearMemory = vi.fn(() => {
      factory.faults.failRequest = "projections.clear";
    });

    expect(await lockAllContexts("sign_out", clearMemory, options(factory))).toEqual({
      locked: true,
      projectionsDeleted: false,
    });
    expect(clearMemory).toHaveBeenCalledOnce();
    expect(factoryContext(factory, USER_A).lockReason).toBe("sign_out");
    expect(factory.rows("projections")).toHaveLength(1);
  });

  it("attempts projection deletion even when clearing caller memory throws", async () => {
    const factory = new MemoryIdbFactory();
    await provisionOfflineContext(response(), options(factory));

    expect(await lockAllContexts("sign_out", () => {
      throw new Error("in-memory clear failed");
    }, options(factory))).toEqual({ locked: true, projectionsDeleted: true });
    expect(factory.rows("projections")).toEqual([]);
  });

  it.each(["blocked", "denied", "hang"] as const)(
    "bounds a %s database open with a data-free result",
    async (open) => {
      const factory = new MemoryIdbFactory();
      factory.faults.open = open;
      const result = await readSoleUsableProjection(NOW, options(factory, immediateClock));
      expect(result.status).toBe("unavailable");
      expect(result).not.toHaveProperty("value");
    },
  );

  it("aborts a live transaction when a request reaches its deadline", async () => {
    const factory = new MemoryIdbFactory();
    await provisionOfflineContext(response(), options(factory));
    factory.faults.hangRequest = "contexts.getAll";
    const clock = new ControlledClock();

    const pending = readSoleUsableProjection(NOW, options(factory, clock));
    await waitForObservation(() => factory.observations.hungRequests.length === 1);
    expect(clock.activeCount()).toBe(2);
    clock.fireLastActive();
    const result = await pending;

    expect(factory.observations.abortedTransactions).toBe(1);
    expect(result).toEqual({ status: "unavailable", reason: "storage_failure" });
    expect(result).not.toHaveProperty("value");
  });

  it("withholds a successful read operation when its transaction never commits", async () => {
    const factory = new MemoryIdbFactory();
    await provisionOfflineContext(response(), options(factory));
    factory.faults.hangTransaction = true;
    factory.observations.successfulRequests.length = 0;
    const clock = new ControlledClock();

    const pending = readSoleUsableProjection(NOW, options(factory, clock));
    await waitForObservation(() =>
      factory.observations.successfulRequests.includes("contexts.put"));
    await Promise.resolve();
    expect(factory.observations.suppressedCompletions).toBeGreaterThan(0);
    expect(clock.activeCount()).toBe(1);
    clock.fireLastActive();
    const result = await pending;

    expect(result).toEqual({ status: "unavailable", reason: "storage_failure" });
    expect(result).not.toHaveProperty("value");
  });

  it("dispatches version change and withholds data from the interrupted transaction", async () => {
    const factory = new MemoryIdbFactory();
    await provisionOfflineContext(response(), options(factory));
    factory.faults.versionChangeOn = "contexts.getAll";
    const clock = new ControlledClock();

    const pending = readSoleUsableProjection(NOW, options(factory, clock));
    await waitForObservation(() => factory.observations.versionChanges.length === 1);
    expect(factory.observations.abortedTransactions).toBe(1);
    expect(clock.activeCount()).toBe(1);
    clock.fireLastActive();
    const result = await pending;

    expect(result).toEqual({ status: "unavailable", reason: "storage_failure" });
    expect(result).not.toHaveProperty("value");
  });
});

function factoryContext(factory: MemoryIdbFactory, userId: string) {
  return factory.rows("contexts").find(
    (row) => (row as { userId?: string }).userId === userId,
  ) as Record<string, unknown>;
}
