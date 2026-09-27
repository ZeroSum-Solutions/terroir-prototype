import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import type { OfflineContextResponse } from "../src/domains/offline/contract";
import {
  AUTHORIZATION_GENERATION_COOKIE_NAME,
  DEVICE_LOCK_COOKIE_NAME,
  HARD_DEVICE_LOCK,
  REPROVISION_REQUIRED,
} from "../src/domains/offline/device-lock";
import {
  OFFLINE_DATABASE_NAME,
  OFFLINE_DATABASE_VERSION,
  STORE_KEY_PATHS,
} from "../src/domains/offline/indexeddb";

const APP_ORIGIN = "http://127.0.0.1:3000";
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const devEmail = process.env.DEV_BYPASS_EMAIL;
const canUseGuardedFixture = Boolean(
  supabaseUrl &&
  publishableKey &&
  serviceRoleKey &&
  devEmail &&
  isLoopbackUrl(supabaseUrl) &&
  process.env.PLAYWRIGHT_BASE_URL === APP_ORIGIN &&
  process.env.AUTH_E2E_ENABLED !== "1",
);
const OLD_ACTOR = "c0310000-0000-4000-8000-000000000001";
const OLD_SITE = "c0310000-0000-4000-8000-000000000002";
const OLD_CONTEXT = "c0310000-0000-4000-8000-000000000003";
const OLD_GENERATION = "c0310000-0000-4000-8000-000000000010";

type SilentSiteReadProbe = {
  starts: number;
  completes: number;
  errors: number;
  aborts: number;
  barriers: number;
  trace: string[];
};

test.describe("positive offline eligibility", () => {
  test.skip(
    !canUseGuardedFixture,
    "Requires guarded loopback Supabase credentials, DEV_BYPASS_EMAIL, fixed app origin, and AUTH_E2E_ENABLED unset.",
  );
  test.beforeEach(({ baseURL }) => expect(baseURL).toBe(APP_ORIGIN));

  test("fresh transition provisions an absent partition before deleting the exact marker", async ({ page }) => {
    const loginPayload = await loginAndReadPayload(page);
    const generation = await generationCookie(page.context());
    const payload = await gotoCellarAndReadProvisioningPayload(page);
    expect(payload.context.contextId).not.toBe(loginPayload.context.contextId);
    expect(payload.context).toMatchObject({
      userId: loginPayload.context.userId,
      restaurantId: loginPayload.context.restaurantId,
    });
    await waitForAcknowledgement(page);

    const stored = await readOfflineState(page);
    expect(stored.userContexts).toEqual([
      expect.objectContaining({
        contextId: payload.context.contextId,
        userId: payload.context.userId,
        restaurantId: payload.context.restaurantId,
        eligibilityVersion: 1,
        authorizationGeneration: generation,
        lockedAt: null,
      }),
    ]);
    expect(stored.projections).toEqual([
      expect.objectContaining({ contextId: payload.context.contextId }),
    ]);
    expect(stored.fences).toEqual([
      expect.objectContaining({
        state: "eligible",
        authorizationGeneration: generation,
        eligibleUserId: payload.context.userId,
        eligibleRestaurantId: payload.context.restaurantId,
        eligibleContextId: payload.context.contextId,
      }),
    ]);
  });

  test("an existing session without one exact generation never opens IndexedDB", async ({ page }) => {
    await installIndexedDbOpenCounter(page);
    await loginAndReadPayload(page);
    await page.context().clearCookies({ name: AUTHORIZATION_GENERATION_COOKIE_NAME });
    await page.goto("/cellar");
    await expect(page.getByLabel("Settings")).toBeVisible();
    expect(await page.evaluate(() => (globalThis as typeof globalThis & { __c03OpenCount?: number }).__c03OpenCount))
      .toBe(0);
    await expectRootMarker(page.context(), REPROVISION_REQUIRED);
  });

  test("a reload before successful marker acknowledgement remains unavailable", async ({ page }) => {
    await refuseMarkerDeletion(page);
    await loginAndReadPayload(page);
    await page.goto("/api/health");
    expect(await readOfflineState(page)).toEqual({
      state: "not_initialized",
      stores: [],
      userContexts: [],
      fences: [],
      projections: [],
    });
    expect(await offlineDatabaseExists(page)).toBe(false);
    await page.goto("/cellar");
    await expectRootMarker(page.context(), REPROVISION_REQUIRED);
    await expect.poll(async () => {
      const stored = await readOfflineState(page);
      return { state: stored.state, stores: stored.stores, fence: stored.fences[0]?.state };
    }).toEqual({ state: "ready", stores: ["contexts", "projections"], fence: "eligible" });
    await page.reload();
    await expectRootMarker(page.context(), REPROVISION_REQUIRED);
  });

  test("a transaction abort preserves the transition marker and publishes no eligible fence", async ({ page }) => {
    await installProvisionTransactionCounter(page);
    await rejectEligibleFencePut(page);
    await loginAndReadPayload(page);
    await page.goto("/cellar");
    await expect(page.getByLabel("Settings")).toBeVisible();
    await expectRootMarker(page.context(), REPROVISION_REQUIRED);
    await expect.poll(() => page.evaluate(
      () => (globalThis as typeof globalThis & { __c03ProvisionTransactions?: number })
        .__c03ProvisionTransactions ?? 0,
    )).toBe(1);
    expect((await readOfflineState(page)).fences).toEqual([]);
  });

  test("actor B replaces actor A only through a fresh generation-bound transaction", async ({ page }) => {
    const payload = await loginAndReadPayload(page);
    const generation = await generationCookie(page.context());
    await page.goto("/api/health");
    await seedPartition(page, {
      ...payload,
      context: {
        ...payload.context,
        contextId: OLD_CONTEXT,
        userId: OLD_ACTOR,
        restaurantId: OLD_SITE,
      },
    }, OLD_GENERATION, "eligible");
    await page.goto("/cellar");
    await waitForAcknowledgement(page);

    const stored = await readOfflineState(page);
    expect(stored.userContexts).toEqual(expect.arrayContaining([
      expect.objectContaining({ userId: OLD_ACTOR, lockedAt: expect.any(String) }),
      expect.objectContaining({
        userId: payload.context.userId,
        authorizationGeneration: generation,
        lockedAt: null,
      }),
    ]));
    expect(stored.fences).toEqual([
      expect.objectContaining({ state: "eligible", eligibleUserId: payload.context.userId }),
    ]);
  });

  test("explicit site selection rotates generation; silent site mismatch does not fetch", async ({ page }) => {
    const payload = await loginAndReadPayload(page);
    await page.goto("/cellar");
    await waitForAcknowledgement(page);
    const before = await generationCookie(page.context());

    const selected = await page.request.put(`/api/restaurant/${payload.context.restaurantId}`);
    expect(selected.ok(), await selected.text()).toBeTruthy();
    const rotated = await generationCookie(page.context());
    expect(rotated).not.toBe(before);
    await page.reload();
    await waitForAcknowledgement(page);
    expect((await readOfflineState(page)).fences).toEqual([
      expect.objectContaining({ authorizationGeneration: rotated }),
    ]);

    await page.request.get("/api/dev-login");
    await page.context().clearCookies({ name: DEVICE_LOCK_COOKIE_NAME });
    await page.goto("/api/health");
    await lockUnlockedContexts(page);
    await seedPartition(page, {
      ...payload,
      context: { ...payload.context, restaurantId: OLD_SITE, contextId: OLD_CONTEXT },
    }, await generationCookie(page.context()), "eligible");
    const fixture = await readOfflineState(page);
    expect(fixture.userContexts.filter((row) => row.lockedAt === null)).toEqual([
      expect.objectContaining({ restaurantId: OLD_SITE, contextId: OLD_CONTEXT }),
    ]);
    await installSilentSiteReadProbe(page);
    let fetched = false;
    await page.route("**/api/offline-context", (route) => { fetched = true; return route.abort("failed"); });
    await page.goto("/cellar");
    await expect.poll(() => readSilentSiteReadProbe(page)).toEqual({
      starts: 1,
      completes: 1,
      errors: 0,
      aborts: 0,
      barriers: 1,
      trace: ["start", "complete", "task-barrier"],
    });
    expect(fetched).toBe(false);
  });

  test("sign-out during a delayed fetch commits denial and the late response cannot acknowledge", async ({ page }) => {
    await page.request.get("/api/dev-login");
    const payloadResponse = await page.request.get("/api/offline-context");
    const payload = await payloadResponse.json() as OfflineContextResponse;
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    let signalStarted!: () => void;
    const started = new Promise<void>((resolve) => { signalStarted = resolve; });
    await page.route("**/api/offline-context", async (route) => {
      signalStarted();
      await held;
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(payload) });
    });
    await page.goto("/cellar");
    await started;
    await page.getByLabel("Settings").click();
    await page.getByRole("menuitem", { name: "Sign out" }).click();
    release();
    await expectRootMarker(page.context(), HARD_DEVICE_LOCK);
    await expect.poll(async () => (await readOfflineState(page)).fences[0]?.state)
      .toBe("denied");
    expect((await readOfflineState(page)).fences[0])
      .toEqual(expect.objectContaining({ state: "denied", reason: "sign_out" }));
  });

  test("a denial transaction inserted after precheck wins the fence CAS", async ({ page }) => {
    await installPostPrecheckDenial(page);
    await loginAndReadPayload(page);
    await page.goto("/cellar");
    await expectRootMarker(page.context(), REPROVISION_REQUIRED);
    await expect.poll(async () => {
      const stored = await readOfflineState(page);
      return { state: stored.state, stores: stored.stores, fence: stored.fences[0]?.state };
    }).toEqual({ state: "ready", stores: ["contexts", "projections"], fence: "denied" });
  });

  test("legacy and unrelated locked rows never become eligible", async ({ page }) => {
    const loginPayload = await loginAndReadPayload(page);
    const generation = await generationCookie(page.context());
    await page.goto("/api/health");
    await seedLegacyAndLockedRows(page, loginPayload);
    const payload = await gotoCellarAndReadProvisioningPayload(page);
    expect(payload.context.contextId).not.toBe(loginPayload.context.contextId);
    expect(payload.context).toMatchObject({
      userId: loginPayload.context.userId,
      restaurantId: loginPayload.context.restaurantId,
    });
    await waitForAcknowledgement(page);
    const stored = await readOfflineState(page);
    expect(stored.userContexts.filter((row) => row.lockedAt === null)).toEqual([
      expect.objectContaining({
        contextId: payload.context.contextId,
        userId: payload.context.userId,
        restaurantId: payload.context.restaurantId,
        authorizationGeneration: generation,
      }),
    ]);
    expect(stored.userContexts.filter((row) => row.userId !== payload.context.userId))
      .toEqual(expect.arrayContaining([expect.objectContaining({ lockedAt: expect.any(String) })]));
    expect(stored.projections).toEqual([
      expect.objectContaining({ contextId: payload.context.contextId }),
    ]);
    expect(stored.fences).toEqual([
      expect.objectContaining({
        state: "eligible",
        authorizationGeneration: generation,
        eligibleUserId: payload.context.userId,
        eligibleRestaurantId: payload.context.restaurantId,
        eligibleContextId: payload.context.contextId,
      }),
    ]);
  });

  test("a delayed older tab loses to the newer response through the fence revision", async ({ browser, baseURL }) => {
    const context = await browser.newContext({ baseURL });
    try {
      const first = await context.newPage();
      const payload = await loginAndReadPayload(first);
      const second = await context.newPage();
      await Promise.all([refuseMarkerDeletion(first), refuseMarkerDeletion(second)]);
      await installProvisionTransactionCounter(first);
      const now = Date.now();
      const older = {
        ...payload,
        context: {
          ...payload.context,
          contextId: "c0320000-0000-4000-8000-000000000001",
          issuedAt: new Date(now - 2_000).toISOString(),
          expiresAt: new Date(now + 60_000).toISOString(),
        },
      };
      const newer = {
        ...payload,
        context: {
          ...payload.context,
          contextId: "c0320000-0000-4000-8000-000000000002",
          issuedAt: new Date(now - 1_000).toISOString(),
          expiresAt: new Date(now + 60_000).toISOString(),
        },
      };
      let signalOlderStarted!: () => void;
      let releaseOlder!: () => void;
      let signalOlderServed!: () => void;
      const olderStarted = new Promise<void>((resolve) => { signalOlderStarted = resolve; });
      const olderHeld = new Promise<void>((resolve) => { releaseOlder = resolve; });
      const olderServed = new Promise<void>((resolve) => { signalOlderServed = resolve; });
      await first.route("**/api/offline-context", async (route) => {
        signalOlderStarted();
        await olderHeld;
        await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(older) });
        signalOlderServed();
      });
      await second.route("**/api/offline-context", (route) => route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(newer),
      }));

      const firstNavigation = first.goto("/cellar");
      await olderStarted;
      await second.goto("/cellar");
      await expect.poll(async () => (await readOfflineState(second)).fences[0]?.eligibleContextId)
        .toBe(newer.context.contextId);
      releaseOlder();
      await Promise.all([firstNavigation, olderServed]);
      await expect.poll(() => first.evaluate(
        () => (globalThis as typeof globalThis & { __c03ProvisionTransactions?: number })
          .__c03ProvisionTransactions ?? 0,
      )).toBe(1);

      const stored = await readOfflineState(first);
      expect(stored.fences).toHaveLength(1);
      expect(stored.fences[0]).toMatchObject({
        state: "eligible",
        eligibleContextId: newer.context.contextId,
      });
      expect(stored.userContexts.filter((row) => row.lockedAt === null)).toHaveLength(1);
      expect(stored.userContexts.filter((row) => row.lockedAt === null)[0])
        .toMatchObject({ contextId: newer.context.contextId });
      await expectRootMarker(context, REPROVISION_REQUIRED);
    } finally {
      await context.close();
    }
  });
});

async function loginAndReadPayload(page: Page): Promise<OfflineContextResponse> {
  const login = await page.request.get("/api/dev-login");
  expect(login.ok(), await login.text()).toBeTruthy();
  const response = await page.request.get("/api/offline-context");
  expect(response.ok(), await response.text()).toBeTruthy();
  return response.json() as Promise<OfflineContextResponse>;
}
async function gotoCellarAndReadProvisioningPayload(page: Page): Promise<OfflineContextResponse> {
  const responsePromise = page.waitForResponse((response) => (
    new URL(response.url()).pathname === "/api/offline-context"
      && response.request().method() === "GET"
  ));
  await page.goto("/cellar");
  const response = await responsePromise;
  expect(response.status()).toBe(200);
  return response.json() as Promise<OfflineContextResponse>;
}
async function waitForAcknowledgement(page: Page) {
  await expect(page.getByLabel("Settings")).toBeVisible();
  await expect.poll(() => rootMarker(page.context())).toBeNull();
}
async function rootMarker(context: BrowserContext) {
  return (await context.cookies()).find(
    (cookie) => cookie.name === DEVICE_LOCK_COOKIE_NAME && cookie.path === "/",
  )?.value ?? null;
}
async function expectRootMarker(context: BrowserContext, expected: string) {
  await expect.poll(() => rootMarker(context)).toBe(expected);
}
async function generationCookie(context: BrowserContext) {
  const values = (await context.cookies()).filter(
    (cookie) => cookie.name === AUTHORIZATION_GENERATION_COOKIE_NAME && cookie.path === "/",
  );
  expect(values).toHaveLength(1);
  return values[0].value;
}

async function readOfflineState(page: Page) {
  return page.evaluate(async ({ name, version, stores }) => {
    const notInitialized = () => ({
      state: "not_initialized" as const,
      stores: [] as string[],
      userContexts: [] as Record<string, unknown>[],
      fences: [] as Record<string, unknown>[],
      projections: [] as Record<string, unknown>[],
    });
    const existing = (await indexedDB.databases()).find((database) => database.name === name);
    if (!existing) return notInitialized();
    if (existing.version !== version) {
      throw new Error(`Unexpected ${name} version ${existing.version}; expected ${version}.`);
    }

    const database = await new Promise<IDBDatabase | null>((resolve, reject) => {
      const request = indexedDB.open(name, version);
      let upgradeDatabase: IDBDatabase | null = null;
      let upgradeOldVersion: number | null = null;
      request.onupgradeneeded = (event) => {
        upgradeDatabase = request.result;
        upgradeOldVersion = event.oldVersion;
        const transaction = request.transaction;
        if (!transaction) {
          upgradeDatabase.close();
          reject(new Error(`Observation of ${name} entered an upgrade without a transaction.`));
          return;
        }
        try {
          transaction.abort();
          upgradeDatabase.close();
        } catch (error) {
          upgradeDatabase.close();
          reject(error);
        }
      };
      request.onsuccess = () => {
        if (upgradeOldVersion !== null) {
          request.result.close();
          reject(new Error(`Observation of ${name} unexpectedly committed an upgrade.`));
          return;
        }
        resolve(request.result);
      };
      request.onerror = () => {
        upgradeDatabase?.close();
        if (upgradeOldVersion === 0 && request.error?.name === "AbortError") {
          resolve(null);
          return;
        }
        if (upgradeOldVersion !== null) {
          reject(new Error(
            `Observation of ${name} refused an unexpected upgrade from version ${upgradeOldVersion}.`,
            { cause: request.error },
          ));
          return;
        }
        reject(request.error ?? new Error(`Failed to observe ${name}.`));
      };
      request.onblocked = () => reject(new Error(`Observation of ${name} was blocked.`));
    });
    if (!database) return notInitialized();
    const actualStores = [...database.objectStoreNames].sort();
    const expectedStores = [...stores].sort();
    if (JSON.stringify(actualStores) !== JSON.stringify(expectedStores)) {
      database.close();
      throw new Error(
        `Unexpected ${name} stores ${JSON.stringify(actualStores)}; expected ${JSON.stringify(expectedStores)}.`,
      );
    }
    try {
      const transaction = database.transaction(stores, "readonly");
      const all = (store: string) => new Promise<Record<string, unknown>[]>((resolve, reject) => {
        const request = transaction.objectStore(store).getAll();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const contexts = await all("contexts");
      const projections = await all("projections");
      return {
        state: "ready" as const,
        stores: actualStores,
        userContexts: contexts.filter((row) => row.recordType !== "device_access_fence"),
        fences: contexts.filter((row) => row.recordType === "device_access_fence"),
        projections,
      };
    } finally {
      database.close();
    }
  }, {
    name: OFFLINE_DATABASE_NAME,
    version: OFFLINE_DATABASE_VERSION,
    stores: ["contexts", "projections"],
  });
}

async function offlineDatabaseExists(page: Page) {
  return page.evaluate(async (name) => (
    (await indexedDB.databases()).some((database) => database.name === name)
  ), OFFLINE_DATABASE_NAME);
}

async function lockUnlockedContexts(page: Page) {
  await page.evaluate(async ({ name, version }) => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(name, version);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const transaction = database.transaction("contexts", "readwrite");
    const store = transaction.objectStore("contexts");
    const contexts = await new Promise<Record<string, unknown>[]>((resolve, reject) => {
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    for (const context of contexts) {
      if (context.recordType !== "device_access_fence" && context.lockedAt === null) {
        store.put({
          ...context,
          lockedAt: new Date().toISOString(),
          lockReason: "access_changed",
        });
      }
    }
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
    database.close();
  }, { name: OFFLINE_DATABASE_NAME, version: OFFLINE_DATABASE_VERSION });
}

async function seedPartition(
  page: Page,
  payload: OfflineContextResponse,
  generation: string,
  fenceState: "eligible" | "none",
) {
  await page.evaluate(async ({ contract, payload, generation, fenceState }) => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(contract.name, contract.version);
      request.onupgradeneeded = () => {
        request.result.createObjectStore("contexts", { keyPath: [...contract.keyPaths.contexts] });
        request.result.createObjectStore("projections", { keyPath: [...contract.keyPaths.projections] });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const transaction = database.transaction(["contexts", "projections"], "readwrite");
    transaction.objectStore("contexts").put({
      ...payload.context,
      schemaVersion: 1,
      eligibilityVersion: 1,
      authorizationGeneration: generation,
      lastObservedWallClock: payload.context.issuedAt,
      lockedAt: null,
      lockReason: null,
      projectionVersion: 1,
    });
    transaction.objectStore("projections").put({
      userId: payload.context.userId,
      restaurantId: payload.context.restaurantId,
      contextId: payload.context.contextId,
      projectionKind: "cellar_lookup",
      version: 1,
      asOf: payload.projection.asOf,
      rows: payload.projection.rows,
    });
    if (fenceState === "eligible") transaction.objectStore("contexts").put({
      userId: "__terroir_device_access_fence__",
      restaurantId: "__v1__",
      recordType: "device_access_fence",
      fenceVersion: 1,
      revision: crypto.randomUUID(),
      state: "eligible",
      authorizationGeneration: generation,
      eligibleUserId: payload.context.userId,
      eligibleRestaurantId: payload.context.restaurantId,
      eligibleContextId: payload.context.contextId,
      changedAt: new Date().toISOString(),
      reason: "provisioned",
    });
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
    database.close();
  }, {
    contract: databaseContract(),
    payload,
    generation,
    fenceState,
  });
}

async function seedLegacyAndLockedRows(page: Page, payload: OfflineContextResponse) {
  await page.evaluate(async ({ contract, payload, actor, site, context }) => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(contract.name, contract.version);
      request.onupgradeneeded = () => {
        request.result.createObjectStore("contexts", { keyPath: [...contract.keyPaths.contexts] });
        request.result.createObjectStore("projections", { keyPath: [...contract.keyPaths.projections] });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const transaction = database.transaction("contexts", "readwrite");
    for (const [userId, restaurantId, contextId, lockedAt, lockReason] of [
      [payload.context.userId, payload.context.restaurantId, payload.context.contextId, null, null],
      [actor, site, context, new Date().toISOString(), "sign_out"],
    ]) transaction.objectStore("contexts").put({
      schemaVersion: 1, contextId, userId, restaurantId,
      issuedAt: payload.context.issuedAt, expiresAt: payload.context.expiresAt,
      lastObservedWallClock: payload.context.issuedAt, lockedAt, lockReason,
      projectionVersion: 1,
    });
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
    database.close();
  }, { contract: databaseContract(), payload, actor: OLD_ACTOR, site: OLD_SITE, context: OLD_CONTEXT });
}

async function refuseMarkerDeletion(page: Page) {
  await page.addInitScript((markerName) => {
    const descriptor = Object.getOwnPropertyDescriptor(Document.prototype, "cookie");
    if (!descriptor?.get || !descriptor.set) throw new Error("cookie primitive unavailable");
    Object.defineProperty(document, "cookie", {
      configurable: true,
      get: () => descriptor.get!.call(document) as string,
      set(value: string) {
        if (value.startsWith(`${markerName}=`) && /Max-Age=0/i.test(value)) return;
        descriptor.set!.call(document, value);
      },
    });
  }, DEVICE_LOCK_COOKIE_NAME);
}
async function rejectEligibleFencePut(page: Page) {
  await page.addInitScript(() => {
    const original = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (value: unknown, key?: IDBValidKey) {
      if ((value as { recordType?: string; state?: string }).recordType === "device_access_fence" &&
        (value as { state?: string }).state === "eligible") {
        throw new DOMException("C03 injected fence failure", "QuotaExceededError");
      }
      return key === undefined ? original.call(this, value) : original.call(this, value, key);
    };
  });
}
async function installIndexedDbOpenCounter(page: Page) {
  await page.addInitScript(() => {
    const original = indexedDB.open.bind(indexedDB);
    (globalThis as typeof globalThis & { __c03OpenCount?: number }).__c03OpenCount = 0;
    indexedDB.open = ((name: string, version?: number) => {
      (globalThis as typeof globalThis & { __c03OpenCount?: number }).__c03OpenCount! += 1;
      return version === undefined ? original(name) : original(name, version);
    }) as typeof indexedDB.open;
  });
}
async function installProvisionTransactionCounter(page: Page) {
  await page.addInitScript(() => {
    const original = IDBDatabase.prototype.transaction;
    (globalThis as typeof globalThis & { __c03ProvisionTransactions?: number })
      .__c03ProvisionTransactions = 0;
    IDBDatabase.prototype.transaction = function (stores, mode, options) {
      const names = typeof stores === "string" ? [stores] : [...stores];
      if (mode === "readwrite" && names.includes("contexts") && names.includes("projections")) {
        (globalThis as typeof globalThis & { __c03ProvisionTransactions?: number })
          .__c03ProvisionTransactions! += 1;
      }
      return original.call(this, stores, mode, options);
    };
  });
}
async function installSilentSiteReadProbe(page: Page) {
  await page.addInitScript(({ databaseName, expectedStores }) => {
    const probe: SilentSiteReadProbe = {
      starts: 0,
      completes: 0,
      errors: 0,
      aborts: 0,
      barriers: 0,
      trace: [],
    };
    (globalThis as typeof globalThis & { __c03SilentSiteReadProbe?: SilentSiteReadProbe })
      .__c03SilentSiteReadProbe = probe;
    const original = IDBDatabase.prototype.transaction;
    IDBDatabase.prototype.transaction = function (...args: Parameters<IDBDatabase["transaction"]>) {
      const [stores, mode] = args;
      const transaction = Reflect.apply(original, this, args) as IDBTransaction;
      const names = typeof stores === "string" ? [stores] : [...stores];
      const matches = this.name === databaseName && mode === "readwrite" &&
        names.length === expectedStores.length &&
        names.every((name, index) => name === expectedStores[index]);
      if (!matches) return transaction;

      probe.starts += 1;
      probe.trace.push("start");
      transaction.addEventListener("complete", () => {
        probe.completes += 1;
        probe.trace.push("complete");
        setTimeout(() => {
          probe.barriers += 1;
          probe.trace.push("task-barrier");
        }, 0);
      }, { once: true });
      transaction.addEventListener("error", () => {
        probe.errors += 1;
        probe.trace.push("error");
      }, { once: true });
      transaction.addEventListener("abort", () => {
        probe.aborts += 1;
        probe.trace.push("abort");
      }, { once: true });
      return transaction;
    };
  }, { databaseName: OFFLINE_DATABASE_NAME, expectedStores: ["contexts", "projections"] });
}
async function readSilentSiteReadProbe(page: Page): Promise<SilentSiteReadProbe | null> {
  return page.evaluate(() =>
    (globalThis as typeof globalThis & { __c03SilentSiteReadProbe?: SilentSiteReadProbe })
      .__c03SilentSiteReadProbe ?? null);
}
async function installPostPrecheckDenial(page: Page) {
  await page.addInitScript(() => {
    const original = IDBDatabase.prototype.transaction;
    let injected = false;
    IDBDatabase.prototype.transaction = function (stores, mode, options) {
      const names = typeof stores === "string" ? [stores] : [...stores];
      if (!injected && mode === "readwrite" && names.includes("contexts") && names.includes("projections")) {
        injected = true;
        const denial = original.call(this, "contexts", "readwrite");
        denial.objectStore("contexts").put({
          userId: "__terroir_device_access_fence__",
          restaurantId: "__v1__",
          recordType: "device_access_fence",
          fenceVersion: 1,
          revision: crypto.randomUUID(),
          state: "denied",
          authorizationGeneration: null,
          eligibleUserId: null,
          eligibleRestaurantId: null,
          eligibleContextId: null,
          changedAt: new Date().toISOString(),
          reason: "sign_out",
        });
      }
      return original.call(this, stores, mode, options);
    };
  });
}

function databaseContract() {
  return {
    name: OFFLINE_DATABASE_NAME,
    version: OFFLINE_DATABASE_VERSION,
    keyPaths: STORE_KEY_PATHS,
  };
}

function isLoopbackUrl(value: string): boolean {
  try {
    return ["127.0.0.1", "localhost", "::1"].includes(new URL(value).hostname);
  } catch {
    return false;
  }
}
