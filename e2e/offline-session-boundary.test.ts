import { expect, test, type Page } from "@playwright/test";
import {
  OFFLINE_DATABASE_NAME,
  OFFLINE_DATABASE_VERSION,
  OFFLINE_STORES,
  STORE_KEY_PATHS,
} from "../src/domains/offline/indexeddb";
import {
  DEVICE_LOCK_COOKIE_NAME,
  HARD_DEVICE_LOCK,
} from "../src/domains/offline/device-lock";

const driverContract = {
  name: OFFLINE_DATABASE_NAME,
  version: OFFLINE_DATABASE_VERSION,
  stores: [...OFFLINE_STORES],
  keyPaths: {
    contexts: [...STORE_KEY_PATHS.contexts],
    projections: [...STORE_KEY_PATHS.projections],
  },
};

test.describe("offline session boundary", () => {
  test("unmounts private UI and locks the seeded fixture when the response is lost", async ({
    page,
  }) => {
    await devLoginOrSkip(page);
    await page.goto("/cellar");
    await seedOfflineFixture(page);
    await page.route("**/auth/signout", (route) => route.abort("failed"));

    await expect(page.getByLabel("Settings")).toBeVisible();
    await page.getByLabel("Settings").click();
    await page.getByRole("menuitem", { name: "Sign out" }).click();

    await expect(page.getByRole("heading", { name: "Signing out" })).toBeVisible();
    await expect(page.getByLabel("Settings")).toHaveCount(0);
    await expect(
      page.getByText("Locked on this device. Server sign-out is not confirmed."),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Retry sign-out" })).toBeVisible();

    const stored = await page.evaluate(async (contract) => {
      const database = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(contract.name, contract.version);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const transaction = database.transaction(contract.stores, "readonly");
      const contexts = await new Promise<unknown[]>((resolve, reject) => {
        const request = transaction.objectStore("contexts").getAll();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const projections = await new Promise<unknown[]>((resolve, reject) => {
        const request = transaction.objectStore("projections").getAll();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      database.close();
      return { contexts, projections };
    }, driverContract);
    expect(stored.contexts).toEqual([
      expect.objectContaining({ lockedAt: expect.any(String), lockReason: "sign_out" }),
    ]);
    expect(stored.projections).toEqual([]);
    expect(
      (await page.context().cookies()).find(
        (cookie) => cookie.name === DEVICE_LOCK_COOKIE_NAME,
      )?.value,
    ).toBe(HARD_DEVICE_LOCK);
  });

  test("keeps the native form usable when JavaScript is disabled", async ({
    browser,
    baseURL,
  }) => {
    const context = await browser.newContext({ javaScriptEnabled: false, baseURL });
    const noScriptPage = await context.newPage();
    await devLoginOrSkip(noScriptPage);
    await noScriptPage.goto("/");

    await noScriptPage.getByRole("button", { name: "Sign out" }).click();

    await expect(noScriptPage).toHaveURL(/\/login(?:\?|$)/);
    expect(
      (await context.cookies()).find(
        (cookie) => cookie.name === DEVICE_LOCK_COOKIE_NAME,
      )?.value,
    ).toBe(HARD_DEVICE_LOCK);
    await context.close();
  });

  test("a hard marker denies private documents without looping on login", async ({ page }) => {
    await devLoginOrSkip(page);
    await page.goto("/");
    await page.context().addCookies([
      {
        name: DEVICE_LOCK_COOKIE_NAME,
        value: HARD_DEVICE_LOCK,
        url: new URL(page.url()).origin,
        sameSite: "Lax",
      },
    ]);

    await page.goto("/cellar");

    await expect(page).toHaveURL(/\/login(?:\?|$)/);
    await expect(page.getByRole("heading", { name: /welcome/i })).toBeVisible();
  });
});

async function devLoginOrSkip(page: Page) {
  const response = await page.request.get("/api/dev-login");
  test.skip(
    !response.ok(),
    "Requires the guarded local stack and configured dev-login fixture.",
  );
}

async function seedOfflineFixture(page: Page) {
  const now = Date.now();
  await page.evaluate(
    async ({ contract, issuedAt, expiresAt }) => {
      const database = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(contract.name, contract.version);
        request.onupgradeneeded = () => {
          request.result.createObjectStore("contexts", {
            keyPath: contract.keyPaths.contexts,
          });
          request.result.createObjectStore("projections", {
            keyPath: contract.keyPaths.projections,
          });
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const userId = "c0300000-0000-4000-8000-000000000001";
      const restaurantId = "c0300000-0000-4000-8000-000000000002";
      const transaction = database.transaction(contract.stores, "readwrite");
      transaction.objectStore("contexts").put({
        schemaVersion: 1,
        contextId: "c0300000-0000-4000-8000-000000000003",
        userId,
        restaurantId,
        issuedAt,
        expiresAt,
        lastObservedWallClock: issuedAt,
        lockedAt: null,
        lockReason: null,
        projectionVersion: 1,
      });
      transaction.objectStore("projections").put({
        userId,
        restaurantId,
        projectionKind: "cellar_lookup",
        version: 1,
        asOf: issuedAt,
        rows: [],
      });
      await new Promise<void>((resolve, reject) => {
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error);
      });
      database.close();
    },
    {
      contract: driverContract,
      issuedAt: new Date(now - 1_000).toISOString(),
      expiresAt: new Date(now + 60_000).toISOString(),
    },
  );
}
