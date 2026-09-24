import { describe, expect, it } from "vitest";
import type { OfflineContextResponse } from "./contract";
import {
  DEVICE_ACCESS_FENCE_RESTAURANT_ID,
  DEVICE_ACCESS_FENCE_USER_ID,
  captureDeviceAccessFence,
  provisionOfflineContext,
  type OfflineDatabaseOptions,
} from "./database";
import {
  AUTHORIZATION_GENERATION_COOKIE_NAME,
  DEVICE_LOCK_COOKIE_NAME,
  HARD_DEVICE_LOCK,
  REPROVISION_REQUIRED,
} from "./device-lock";
import { readEligibleOfflineContext } from "./eligibility";
import { asIdbFactory, MemoryIdbFactory } from "./indexeddb.test-helper";

const NOW = Date.parse("2026-09-23T12:00:00.000Z");
const USER_A = "10000000-0000-4000-8000-000000000001";
const SITE_A = "10000000-0000-4000-8000-000000000002";
const CONTEXT_A = "10000000-0000-4000-8000-000000000003";
const GENERATION_A = "10000000-0000-4000-8000-000000000010";
const FENCE_A = "10000000-0000-4000-8000-000000000011";

const response = (): OfflineContextResponse => ({
  schemaVersion: 1,
  context: {
    contextId: CONTEXT_A,
    userId: USER_A,
    restaurantId: SITE_A,
    issuedAt: "2026-09-23T11:00:00.000Z",
    expiresAt: "2026-09-23T23:00:00.000Z",
  },
  projection: {
    kind: "cellar_lookup",
    version: 1,
    asOf: "2026-09-23T11:00:00.000Z",
    rows: [],
  },
});

const databaseOptions = (factory: MemoryIdbFactory): OfflineDatabaseOptions => ({
  indexedDB: asIdbFactory(factory),
  clock: {
    now: () => NOW,
    setTimeout(callback, delay) {
      const handle = setTimeout(callback, delay);
      return () => clearTimeout(handle);
    },
  },
  randomUUID: () => FENCE_A,
});

const cookie = (generation = GENERATION_A, marker?: string) =>
  `${AUTHORIZATION_GENERATION_COOKIE_NAME}=${generation}` +
  (marker ? `; ${DEVICE_LOCK_COOKIE_NAME}=${marker}` : "");

async function provision(factory: MemoryIdbFactory) {
  const options = databaseOptions(factory);
  const captured = await captureDeviceAccessFence(options);
  expect(captured).toEqual({ status: "captured", fence: null });
  expect(await provisionOfflineContext(response(), {
    userId: USER_A,
    restaurantId: SITE_A,
    authorizationGeneration: GENERATION_A,
    marker: REPROVISION_REQUIRED,
    capturedFence: null,
  }, options)).toEqual({ status: "stored", replayed: false });
}

describe("positive offline eligibility", () => {
  it.each([
    ["hard marker", cookie(GENERATION_A, HARD_DEVICE_LOCK)],
    ["transition marker", cookie(GENERATION_A, REPROVISION_REQUIRED)],
    ["missing generation", ""],
    ["malformed generation", cookie("not-a-uuid")],
    ["duplicate generation", `${cookie()}; ${cookie()}`],
  ])("refuses %s before opening IndexedDB", async (_label, cookieHeader) => {
    const factory = new MemoryIdbFactory();
    const result = await readEligibleOfflineContext(USER_A, SITE_A, {
      cookieHeader,
      now: NOW,
      database: databaseOptions(factory),
    });

    expect(result.status).toBe("unavailable");
    expect(result).not.toHaveProperty("value");
    expect(factory.database.data.size).toBe(0);
  });

  it("returns the exact response only for the matching actor, site, generation, fence, context and projection", async () => {
    const factory = new MemoryIdbFactory();
    await provision(factory);

    expect(await readEligibleOfflineContext(USER_A, SITE_A, {
      cookieHeader: cookie(),
      now: NOW,
      database: databaseOptions(factory),
    })).toEqual({ status: "ready", value: response() });

    for (const [userId, restaurantId, generation] of [
      ["20000000-0000-4000-8000-000000000001", SITE_A, GENERATION_A],
      [USER_A, "20000000-0000-4000-8000-000000000002", GENERATION_A],
      [USER_A, SITE_A, "20000000-0000-4000-8000-000000000010"],
    ] as const) {
      const result = await readEligibleOfflineContext(userId, restaurantId, {
        cookieHeader: cookie(generation),
        now: NOW,
        database: databaseOptions(factory),
      });
      expect(result.status).toBe("unavailable");
      expect(result).not.toHaveProperty("value");
    }
  });

  it("ignores well-formed legacy rows but refuses unknown rows and corrupt current rows", async () => {
    const factory = new MemoryIdbFactory();
    await provision(factory);
    factory.seed("contexts", {
      schemaVersion: 1,
      contextId: "20000000-0000-4000-8000-000000000003",
      userId: "20000000-0000-4000-8000-000000000001",
      restaurantId: "20000000-0000-4000-8000-000000000002",
      issuedAt: "2026-09-23T11:00:00.000Z",
      expiresAt: "2026-09-23T23:00:00.000Z",
      lastObservedWallClock: "2026-09-23T11:00:00.000Z",
      lockedAt: null,
      lockReason: null,
      projectionVersion: 1,
    });
    factory.seed("projections", {
      userId: "20000000-0000-4000-8000-000000000001",
      restaurantId: "20000000-0000-4000-8000-000000000002",
      projectionKind: "cellar_lookup",
      version: 1,
      asOf: "2026-09-23T11:00:00.000Z",
      rows: [],
    });

    expect((await readEligibleOfflineContext(USER_A, SITE_A, {
      cookieHeader: cookie(), now: NOW, database: databaseOptions(factory),
    })).status).toBe("ready");

    factory.seed("contexts", {
      userId: "30000000-0000-4000-8000-000000000001",
      restaurantId: "30000000-0000-4000-8000-000000000002",
      unexpected: true,
    });
    const refused = await readEligibleOfflineContext(USER_A, SITE_A, {
      cookieHeader: cookie(), now: NOW, database: databaseOptions(factory),
    });
    expect(refused.status).toBe("unavailable");
    expect(refused).not.toHaveProperty("value");
  });

  it.each([
    ["fence binding", "contexts", (row: Record<string, unknown>) => ({
      ...row,
      eligibleContextId: "20000000-0000-4000-8000-000000000003",
    })],
    ["context generation", "contexts", (row: Record<string, unknown>) => ({
      ...row,
      authorizationGeneration: "20000000-0000-4000-8000-000000000010",
    })],
    ["projection context", "projections", (row: Record<string, unknown>) => ({
      ...row,
      contextId: "20000000-0000-4000-8000-000000000003",
    })],
  ] as const)("refuses a mismatched %s without returning private data", async (_label, store, mutate) => {
    const factory = new MemoryIdbFactory();
    await provision(factory);
    const rows = factory.rows(store);
    const index = store === "contexts"
      ? rows.findIndex((row) => (row as { recordType?: string }).recordType === "device_access_fence")
      : 0;
    factory.seed(store, mutate(rows[index] as Record<string, unknown>));

    const result = await readEligibleOfflineContext(USER_A, SITE_A, {
      cookieHeader: cookie(), now: NOW, database: databaseOptions(factory),
    });
    expect(result.status).toBe("unavailable");
    expect(result).not.toHaveProperty("value");
  });

  it("uses only the reserved compound key for the tagged fence", async () => {
    const factory = new MemoryIdbFactory();
    await provision(factory);
    const fence = factory.rows("contexts").find(
      (row) => (row as { recordType?: string }).recordType === "device_access_fence",
    );
    expect(fence).toMatchObject({
      userId: DEVICE_ACCESS_FENCE_USER_ID,
      restaurantId: DEVICE_ACCESS_FENCE_RESTAURANT_ID,
      state: "eligible",
    });
  });
});
