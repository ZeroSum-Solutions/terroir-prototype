import {
  expect,
  test,
  type APIRequest,
  type APIRequestContext,
  type APIResponse,
  type Browser,
  type BrowserContext,
  type Page,
  type TestInfo,
} from "@playwright/test";
import {
  createClient,
  type AuthUser,
  type SupabaseClient,
} from "@supabase/supabase-js";
import {
  OFFLINE_DATABASE_NAME,
  OFFLINE_DATABASE_VERSION,
  OFFLINE_STORES,
  STORE_KEY_PATHS,
} from "../src/domains/offline/indexeddb";
import {
  DEVICE_LOCK_COOKIE_NAME,
  HARD_DEVICE_LOCK,
  REPROVISION_REQUIRED,
} from "../src/domains/offline/device-lock";
import { __ACTIVE_RESTAURANT_COOKIE_NAME__ } from "../src/lib/api/active-restaurant";
import { LiveDbFixtureIdentityTracker } from "../src/test/live-db-fixture-identities";
import type { Database } from "../src/types/database";
import { extractAuthEmailLink, waitForMailpitEmail } from "./auth-e2e-config";
import {
  assertRetrySurface,
  assertVisualSafety,
  observeDuplicateCookieNavigation,
} from "./helpers/offline-session-boundary";

const APP_ORIGIN = "http://127.0.0.1:3000";
const PRIVATE_DISPLAY_NAME = "C03 private actor A wine";
const PRIVATE_RESTAURANT_NAME = "C03 private actor A restaurant";
const PRIVATE_COUNT_LABEL = "42 bottles";
const FIXTURE_USER_ID = "c0300000-0000-4000-8000-000000000001";
const FIXTURE_RESTAURANT_ID = "c0300000-0000-4000-8000-000000000002";
const FIXTURE_CONTEXT_ID = "c0300000-0000-4000-8000-000000000003";
const FIXTURE_WINE_ID = "c0300000-0000-4000-8000-000000000004";
const FIXTURE_BIN_ID = "c0300000-0000-4000-8000-000000000005";
const PASSWORD = "Terroir-C03-browser-123!";
const AUTH_USER_PAGE_SIZE = 1_000;
const AUTH_USER_PAGE_LIMIT = 100;
const ISOLATED_SIGNOUT_TIMEOUT_MS = 10_000;
const VIEWPORTS = [
  { width: 320, height: 740 },
  { width: 390, height: 844 },
] as const;

type ForwardedSignOut = { forwardedSetCookieCount: number; responseSetCookieCount: number; status: number };

const driverContract = {
  name: OFFLINE_DATABASE_NAME,
  version: OFFLINE_DATABASE_VERSION,
  stores: [...OFFLINE_STORES],
  keyPaths: {
    contexts: [...STORE_KEY_PATHS.contexts],
    projections: [...STORE_KEY_PATHS.projections],
  },
};

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const devEmail = process.env.DEV_BYPASS_EMAIL;
const canUseLocalFixture = Boolean(
  supabaseUrl &&
    publishableKey &&
    serviceRoleKey &&
    devEmail &&
    isLoopbackUrl(supabaseUrl) &&
    process.env.PLAYWRIGHT_BASE_URL === APP_ORIGIN &&
    process.env.AUTH_E2E_ENABLED !== "1",
);
const runId = `${Date.now()}-${process.pid}`;
const identities = new LiveDbFixtureIdentityTracker();
const uiSignupEmails = new Set<string>();

test.describe("offline session boundary", () => {
  test.skip(
    !canUseLocalFixture,
    "Requires guarded loopback Supabase credentials, DEV_BYPASS_EMAIL, PLAYWRIGHT_BASE_URL=http://127.0.0.1:3000, and AUTH_E2E_ENABLED unset.",
  );

  test.beforeEach(({ baseURL }) => {
    expect(baseURL).toBe(APP_ORIGIN);
  });

  test.afterAll(async () => {
    if (!canUseLocalFixture) return;
    const admin = localAdminClient();
    const failures: unknown[] = [];
    try {
      await identities.cleanup(admin);
    } catch (error) {
      failures.push(error);
    }
    for (const email of uiSignupEmails) {
      try {
        await cleanupUiSignup(admin, email);
      } catch (error) {
        failures.push(error);
      }
    }
    if (failures.length > 0) {
      throw new AggregateError(failures, "C03 browser fixture cleanup failed");
    }
  });

  for (const viewport of VIEWPORTS) {
    test(`${viewport.width}px: blanks private UI before held work and shows the durable-lock warning`, async ({
      page,
    }, testInfo) => {
      await page.setViewportSize(viewport);
      await openSignedInCellar(page);
      await seedOfflineFixture(page);
      const requestStarted = deferred<void>();
      const releaseRequest = deferred<void>();
      await page.route("**/auth/signout", async (route) => {
        requestStarted.resolve();
        await releaseRequest.promise;
        await route.abort("failed");
      });

      try {
        await beginSignOut(page);
        await requestStarted.promise;
        await expect(page.getByRole("heading", { name: "Signing out" })).toBeVisible();
        await expect(page.getByText("Locking this device and confirming online sign-out.")).toBeVisible();
        await assertPrivateUiRemoved(page);
        await assertVisualSafety(page);
        await attachScreenshot(page, testInfo, `${viewport.width}px-signout-pending-private-blanked`);
      } finally {
        releaseRequest.resolve();
      }

      await expect(page.getByText("Locked on this device. Server sign-out is not confirmed.")).toBeVisible();
      await assertRetrySurface(page);
      await assertPrivateUiRemoved(page);
      await assertVisualSafety(page);
      await attachScreenshot(page, testInfo, `${viewport.width}px-locked-server-unconfirmed`);
      await expectLockedFixture(page, { projections: 0 });
      await expectRootMarker(page.context(), HARD_DEVICE_LOCK);
    });

    test(`${viewport.width}px: shows truthful copy when neither local lock nor server sign-out persists`, async ({
      page,
    }, testInfo) => {
      await page.setViewportSize(viewport);
      await openSignedInCellar(page);
      await seedOfflineFixture(page);
      await installCookieWriteFailure(page);
      await installIndexedDbOpenFailures(page, "all");
      await page.route("**/auth/signout", (route) => route.abort("failed"));

      await beginSignOut(page);

      await expect(page.getByText(
        "This device lock could not be saved. Server sign-out is not confirmed.",
      )).toBeVisible();
      await assertRetrySurface(page);
      await assertPrivateUiRemoved(page);
      await assertVisualSafety(page);
      await attachScreenshot(page, testInfo, `${viewport.width}px-unlocked-server-unconfirmed`);
      await expectRootMarker(page.context(), REPROVISION_REQUIRED);
      await restoreIndexedDb(page);
      await expectUnlockedFixture(page, { projections: 1 });
    });

    test(`${viewport.width}px: warns against handoff when the server confirms but no local marker persists`, async ({
      page,
      playwright,
    }, testInfo) => {
      await page.setViewportSize(viewport);
      await openSignedInCellar(page);
      await seedOfflineFixture(page);
      await installCookieWriteFailure(page);
      await installIndexedDbOpenFailures(page, "all");
      const authCookiesBefore = await authCookieSnapshot(page.context());
      await expectRootMarker(page.context(), REPROVISION_REQUIRED);
      const forwarding = await installIsolatedSignOutForwarding(
        page,
        playwright.request,
      );

      await beginSignOut(page);
      const forwarded = await forwarding.result;
      expect(forwarded.status).toBe(204);
      expect(forwarded.responseSetCookieCount).toBeGreaterThan(0);
      expect(forwarded.forwardedSetCookieCount).toBe(0);

      await expect(page.getByText(
        "Online sign-out completed, but this device lock was not verified. Do not hand this device to another person until retry or recovery succeeds.",
      )).toBeVisible();
      await assertRetrySurface(page);
      await assertPrivateUiRemoved(page);
      await assertVisualSafety(page);
      await attachScreenshot(page, testInfo, `${viewport.width}px-server-confirmed-lock-unverified`);
      await expectRootMarker(page.context(), REPROVISION_REQUIRED);
      expect(await authCookieSnapshot(page.context())).toEqual(authCookiesBefore);
    });

    test(`${viewport.width}px: confirmed server and durable lock navigate to login without a loop`, async ({
      page,
    }, testInfo) => {
      await page.setViewportSize(viewport);
      await openSignedInCellar(page);
      await seedOfflineFixture(page);
      await page.context().addCookies([{
        name: __ACTIVE_RESTAURANT_COOKIE_NAME__,
        value: "fixture.active.restaurant",
        url: APP_ORIGIN,
      }]);

      await beginSignOut(page);

      await expect(page).toHaveURL(/\/login(?:\?|$)/);
      await expect(page.getByRole("heading", { name: /sign in/i })).toBeVisible();
      await assertPrivateUiRemoved(page);
      await assertVisualSafety(page);
      await attachScreenshot(page, testInfo, `${viewport.width}px-confirmed-durable-login`);
      expect(
        (await page.context().cookies()).some(
          (cookie) => cookie.name === __ACTIVE_RESTAURANT_COOKIE_NAME__,
        ),
      ).toBe(false);
      await expectRootMarker(page.context(), HARD_DEVICE_LOCK);
    });
  }

  test("distinguishes cookie-only, IndexedDB-only, zero-context, and projection-delete failure results", async ({
    browser,
    baseURL,
  }) => {
    await withPage(browser, baseURL, async (page) => {
      await openSignedInCellar(page);
      await seedOfflineFixture(page);
      await installIndexedDbOpenFailures(page, "all");
      await page.route("**/auth/signout", (route) => route.abort("failed"));
      await beginSignOut(page);
      await expect(page.getByText("Locked on this device. Server sign-out is not confirmed.")).toBeVisible();
      await expectRootMarker(page.context(), HARD_DEVICE_LOCK);
      await restoreIndexedDb(page);
      await expectUnlockedFixture(page, { projections: 1 });
    });

    await withPage(browser, baseURL, async (page) => {
      await openSignedInCellar(page);
      await seedOfflineFixture(page);
      await installCookieWriteFailure(page);
      await page.route("**/auth/signout", (route) => route.abort("failed"));
      await beginSignOut(page);
      await expect(page.getByText("Locked on this device. Server sign-out is not confirmed.")).toBeVisible();
      await expectRootMarker(page.context(), REPROVISION_REQUIRED);
      await expectLockedFixture(page, { projections: 0 });
    });

    await withPage(browser, baseURL, async (page) => {
      await openSignedInCellar(page);
      await seedOfflineFixture(page, { context: false, projection: false });
      await installCookieWriteFailure(page);
      await page.route("**/auth/signout", (route) => route.abort("failed"));
      await beginSignOut(page);
      await expect(page.getByText(
        "This device lock could not be saved. Server sign-out is not confirmed.",
      )).toBeVisible();
      await expectStoredFixture(page, { contexts: 0, projections: 0 });
    });

    await withPage(browser, baseURL, async (page) => {
      await openSignedInCellar(page);
      await seedOfflineFixture(page);
      await installCookieWriteFailure(page);
      // lockAllContexts opens once to lock contexts and a second time to
      // delete projections; fail only that second open.
      await installIndexedDbOpenFailures(page, [2]);
      await page.route("**/auth/signout", (route) => route.abort("failed"));
      await beginSignOut(page);
      await expect(page.getByText("Locked on this device. Server sign-out is not confirmed.")).toBeVisible();
      await restoreIndexedDb(page);
      await expectLockedFixture(page, { projections: 1 });
    });
  });

  test("retries after a real offline transition without remounting private UI", async ({ page }) => {
    await openSignedInCellar(page);
    await seedOfflineFixture(page);
    await page.context().setOffline(true);
    try {
      await beginSignOut(page);
      await expect(page.getByText("Locked on this device. Server sign-out is not confirmed.")).toBeVisible();
      await assertPrivateUiRemoved(page);
      await page.context().setOffline(false);
      await expect(page).toHaveURL(/\/login(?:\?|$)/);
      await expect(page.getByRole("heading", { name: /sign in/i })).toBeVisible();
      await assertPrivateUiRemoved(page);
    } finally {
      await page.context().setOffline(false);
    }
  });

  test("keeps the native same-origin form usable when JavaScript is disabled", async ({
    browser,
    baseURL,
  }) => {
    const context = await browser.newContext({ javaScriptEnabled: false, baseURL });
    try {
      const page = await context.newPage();
      await devLogin(page);
      await page.goto("/");
      await page.getByRole("button", { name: "Sign out" }).click();
      await expect(page).toHaveURL(/\/login(?:\?|$)/);
      await expectRootMarker(context, HARD_DEVICE_LOCK);
    } finally {
      await context.close();
    }
  });

  test("hard marker denial preserves auth cookies for browser RSC and prefetch requests", async ({ page }) => {
    await openSignedInCellar(page);
    await setRootMarker(page.context(), HARD_DEVICE_LOCK);
    const authBefore = await authCookieSnapshot(page.context());
    expect(authBefore).not.toEqual([]);
    const routerState = encodeURIComponent(JSON.stringify(["", { children: ["cellar", {}] }]));
    const requestCases: Array<Record<string, string>> = [
      { RSC: "1", "Next-Router-State-Tree": routerState },
      { RSC: "1", "Next-Router-Prefetch": "1", "Next-Router-Segment-Prefetch": "/_tree" },
    ];

    for (const headers of requestCases) {
      const [response] = await Promise.all([
        page.waitForResponse((candidate) => (
          new URL(candidate.url()).pathname === "/cellar" && candidate.status() === 307
        )),
        page.evaluate(async (signalHeaders) => {
          await fetch("/cellar", {
            credentials: "same-origin",
            headers: signalHeaders,
            redirect: "manual",
          });
        }, headers),
      ]);
      const actualHeaders = await response.request().allHeaders();
      for (const [name, value] of Object.entries(headers)) {
        expect(actualHeaders[name.toLowerCase()]).toBe(value);
      }
      expect(await response.headerValues("set-cookie")).toEqual([]);
    }

    expect(await authCookieSnapshot(page.context())).toEqual(authBefore);
    await expectRootMarker(page.context(), HARD_DEVICE_LOCK);
  });

  test("Chromium duplicate path cookies keep the strongest hard denial in both value orders", async ({
    browser,
    baseURL,
  }) => {
    if (!devEmail) throw new Error("The guarded dev-login actor email is unavailable.");
    for (const [rootValue, cellarValue] of [
      [HARD_DEVICE_LOCK, REPROVISION_REQUIRED],
      [REPROVISION_REQUIRED, HARD_DEVICE_LOCK],
    ] as const) {
      await withPage(browser, baseURL, async (page) => {
        await devLogin(page);
        await page.context().addCookies([
          browserCookie(rootValue, "/"),
          browserCookie(cellarValue, "/cellar"),
        ]);

        const observed = await observeDuplicateCookieNavigation(page, DEVICE_LOCK_COOKIE_NAME);
        expect(observed.markerValues).toEqual([cellarValue, rootValue]);
        expect(observed.status).toBe(307);
        expect(observed.location).toBe("/login?next=%2Fcellar");
        expect(observed.responseSetCookieCount).toBe(0);
        expect(observed.markerCookiesAfter).toEqual(observed.markerCookiesBefore);
        await expectRootMarker(page.context(), rootValue);
        if (rootValue === HARD_DEVICE_LOCK) {
          await expect(page).toHaveURL(`${APP_ORIGIN}/login?next=%2Fcellar`);
          await expect(page.getByRole("heading", { name: /sign in/i })).toBeVisible();
        } else {
          await expectAuthenticatedSurface(page, devEmail);
        }
      });
    }
  });

  test("dev login and password login write transition state while failed auth preserves hard denial", async ({
    page,
  }) => {
    await devLogin(page);
    await expectRootMarker(page.context(), REPROVISION_REQUIRED);

    const email = `c03-password-${runId}@terroir.test`;
    await identities.createUser(localAdminClient(), {
      email,
      password: PASSWORD,
      email_confirm: true,
    });
    await page.context().clearCookies();
    await setRootMarker(page.context(), HARD_DEVICE_LOCK);
    await page.goto("/login?mode=password");
    await page.getByLabel("Work email").fill(email);
    await page.getByLabel("Password", { exact: true }).fill(`${PASSWORD}-wrong`);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page).toHaveURL(/error=invalid_credentials/);
    await expectRootMarker(page.context(), HARD_DEVICE_LOCK);

    await page.getByLabel("Work email").fill(email);
    await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expectAuthenticatedSurface(page, email);
    await expectRootMarker(page.context(), REPROVISION_REQUIRED);
  });

  test("session-returning signup changes hard denial to transition state", async ({ page }) => {
    const email = `c03-signup-${runId}@terroir.test`;
    uiSignupEmails.add(email);
    await setRootMarker(page.context(), HARD_DEVICE_LOCK);
    await page.goto("/login?mode=signup");
    await page.getByLabel("Work email").fill(email);
    await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
    await page.getByLabel("Confirm password").fill(PASSWORD);
    await page.getByRole("button", { name: "Create account" }).click();

    await expectAuthenticatedSurface(page, email);
    await expectRootMarker(page.context(), REPROVISION_REQUIRED);
    expect(await authCookieSnapshot(page.context())).not.toEqual([]);
  });

  test("recovery confirmation remains reachable through a hard marker and writes transition state", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const email = `c03-recovery-${runId}@terroir.test`;
    await identities.createUser(localAdminClient(), {
      email,
      password: PASSWORD,
      email_confirm: true,
    });
    await setRootMarker(page.context(), HARD_DEVICE_LOCK);
    await page.goto("/login?forgot=1");
    await page.getByLabel("Work email").fill(email);
    await page.getByRole("button", { name: "Send reset link" }).click();
    await expect(page.getByText(/If that email is registered/i)).toBeVisible();
    const mail = await waitForMailpitEmail(localMailpitConfig(), email);

    await page.goto(extractAuthEmailLink(mail));

    await expect(page).toHaveURL(`${APP_ORIGIN}/auth/reset-password`);
    await expect(page.getByRole("heading", { name: "Set new password" })).toBeVisible();
    await expectRootMarker(page.context(), REPROVISION_REQUIRED);
  });

  test("actor B login leaves actor A stores untouched after both local denial writes fail", async ({ page }) => {
    const email = `c03-actor-b-${runId}@terroir.test`;
    await identities.createUser(localAdminClient(), {
      email,
      password: PASSWORD,
      email_confirm: true,
    });
    await openSignedInCellar(page);
    await seedOfflineFixture(page);
    const actorAStoreBefore = await expectUnlockedFixture(page, { projections: 1 });
    await installCookieWriteFailure(page);
    await installIndexedDbOpenFailures(page, "all");
    await page.route("**/auth/signout", (route) => route.abort("failed"));
    await beginSignOut(page);
    await expect(page.getByText(
      "This device lock could not be saved. Server sign-out is not confirmed.",
    )).toBeVisible();
    await restoreIndexedDb(page);
    await page.unroute("**/auth/signout");
    await expectRootMarker(page.context(), REPROVISION_REQUIRED);
    expect(await authCookieSnapshot(page.context())).not.toEqual([]);
    expect(await readOfflineFixture(page)).toEqual(actorAStoreBefore);

    const serverSignOut = await page.request.post("/auth/signout", {
      headers: { Origin: APP_ORIGIN, "sec-fetch-site": "same-origin" },
      maxRedirects: 0,
    });
    expect(serverSignOut.status()).toBe(303);
    expect(new URL(serverSignOut.headers().location ?? APP_ORIGIN).pathname).toBe("/login");
    await expect.poll(() => authCookieSnapshot(page.context())).toEqual([]);
    await expectRootMarker(page.context(), HARD_DEVICE_LOCK);
    expect(await readOfflineFixture(page)).toEqual(actorAStoreBefore);

    await page.goto("/login?mode=password");
    await page.getByLabel("Work email").fill(email);
    await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expectAuthenticatedSurface(page, email);
    await expectRootMarker(page.context(), REPROVISION_REQUIRED);
    expect(await authCookieSnapshot(page.context())).not.toEqual([]);
    expect(await readOfflineFixture(page)).toEqual(actorAStoreBefore);
  });
});

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((accept, decline) => {
    resolve = accept;
    reject = decline;
  });
  return { promise, reject, resolve };
}

function isLoopbackUrl(value: string): boolean {
  try {
    return ["127.0.0.1", "localhost", "::1"].includes(new URL(value).hostname);
  } catch {
    return false;
  }
}

function localAdminClient(): SupabaseClient<Database> {
  if (!supabaseUrl || !serviceRoleKey || !isLoopbackUrl(supabaseUrl)) {
    throw new Error("Refusing to create C03 fixtures outside local Supabase.");
  }
  return createClient<Database>(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });
}

function localMailpitConfig() {
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Local recovery fixture credentials are unavailable.");
  }
  return {
    baseUrl: APP_ORIGIN,
    emailDomain: "terroir.test",
    mailboxUrl: process.env.E2E_MAILBOX_URL ?? "http://127.0.0.1:57324",
    runId,
    supabaseUrl,
    serviceRoleKey,
  };
}

async function cleanupUiSignup(admin: SupabaseClient<Database>, email: string) {
  const deletedRestaurantIds = new Set<string>();
  const deletedWorkspaceIds = new Set<string>();
  const users = await listUsersByExactEmail(admin, email);
  for (const user of users) {
    const { data: memberships, error: membershipError } = await admin
      .from("memberships")
      .select("restaurant_id")
      .eq("user_id", user.id);
    if (membershipError) throw membershipError;
    const restaurantIds = (memberships ?? []).map(({ restaurant_id }) => restaurant_id);
    restaurantIds.forEach((id) => deletedRestaurantIds.add(id));
    let workspaceIds: string[] = [];
    if (restaurantIds.length > 0) {
      const { data: restaurants, error: restaurantError } = await admin
        .from("restaurants")
        .select("workspace_id")
        .in("id", restaurantIds);
      if (restaurantError) throw restaurantError;
      workspaceIds = [...new Set((restaurants ?? []).map(({ workspace_id }) => workspace_id))];
      workspaceIds.forEach((id) => deletedWorkspaceIds.add(id));
      const { error } = await admin.from("restaurants").delete().in("id", restaurantIds);
      if (error) throw error;
    }
    const { error: userError } = await admin.auth.admin.deleteUser(user.id);
    if (userError) throw userError;
    if (workspaceIds.length > 0) {
      const { data: referencedRestaurants, error: restaurantReferenceError } = await admin
        .from("restaurants")
        .select("workspace_id")
        .in("workspace_id", workspaceIds);
      if (restaurantReferenceError) throw restaurantReferenceError;
      const { data: referencedMemberships, error: membershipReferenceError } = await admin
        .from("workspace_memberships")
        .select("workspace_id")
        .in("workspace_id", workspaceIds);
      if (membershipReferenceError) throw membershipReferenceError;
      const referenced = new Set([
        ...(referencedRestaurants ?? []).map(({ workspace_id }) => workspace_id),
        ...(referencedMemberships ?? []).map(({ workspace_id }) => workspace_id),
      ]);
      const orphaned = workspaceIds.filter((id) => !referenced.has(id));
      if (orphaned.length > 0) {
        const { error } = await admin.from("workspaces").delete().in("id", orphaned);
        if (error) throw error;
      }
    }
  }
  if ((await listUsersByExactEmail(admin, email)).length > 0) {
    throw new Error(`C03 signup fixture remains for ${email}`);
  }
  if (deletedRestaurantIds.size > 0) {
    const { data, error } = await admin
      .from("restaurants")
      .select("id")
      .in("id", [...deletedRestaurantIds]);
    if (error) throw error;
    if ((data ?? []).length > 0) {
      throw new Error(`C03 signup restaurant fixtures remain for ${email}`);
    }
  }
  if (deletedWorkspaceIds.size > 0) {
    const { data, error } = await admin
      .from("workspaces")
      .select("id")
      .in("id", [...deletedWorkspaceIds]);
    if (error) throw error;
    if ((data ?? []).length > 0) {
      throw new Error(`C03 signup workspace fixtures remain for ${email}`);
    }
  }
}

async function listUsersByExactEmail(
  admin: SupabaseClient<Database>,
  email: string,
): Promise<AuthUser[]> {
  const matches: AuthUser[] = [];
  for (let page = 1; page <= AUTH_USER_PAGE_LIMIT; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({
      page,
      perPage: AUTH_USER_PAGE_SIZE,
    });
    if (error) throw error;
    matches.push(...data.users.filter((user) => user.email === email));
    if (data.users.length < AUTH_USER_PAGE_SIZE) return matches;
  }
  throw new Error(
    `C03 signup lookup exceeded ${AUTH_USER_PAGE_LIMIT} auth-user pages for ${email}`,
  );
}

async function withPage(
  browser: Browser,
  baseURL: string | undefined,
  operation: (page: Page) => Promise<void>,
) {
  const context = await browser.newContext({ baseURL });
  try {
    await operation(await context.newPage());
  } finally {
    await context.close();
  }
}

async function devLogin(page: Page) {
  const response = await page.request.get("/api/dev-login");
  expect(response.ok(), await response.text()).toBeTruthy();
}

async function openSignedInCellar(page: Page) {
  await devLogin(page);
  await page.goto("/cellar");
  await expect(page.getByLabel("Settings")).toBeVisible();
}

async function expectAuthenticatedSurface(page: Page, email: string) {
  await expect(page).toHaveURL(/^http:\/\/127\.0\.0\.1:3000\/(?:insights|cellar)(?:\?.*)?$/);
  await expect(page.getByLabel("Settings")).toBeVisible();
  await expect(page.getByText(email, { exact: true })).toBeAttached();
}

async function beginSignOut(page: Page) {
  await page.getByLabel("Settings").click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await expect(page.getByRole("heading", { name: "Signing out" })).toBeVisible();
}

async function assertPrivateUiRemoved(page: Page) {
  await expect(page.getByLabel("Settings")).toHaveCount(0);
}

async function attachScreenshot(page: Page, testInfo: TestInfo, name: string) {
  const path = testInfo.outputPath(`${name}.png`);
  await page.screenshot({ animations: "disabled", path });
  await testInfo.attach(name, { path, contentType: "image/png" });
}

function browserCookie(value: string, path: string) {
  return {
    name: DEVICE_LOCK_COOKIE_NAME,
    value,
    domain: "127.0.0.1",
    path,
    httpOnly: false,
    secure: false,
    sameSite: "Lax" as const,
  };
}

async function setRootMarker(context: BrowserContext, value: string) {
  await context.addCookies([browserCookie(value, "/")]);
}

async function expectRootMarker(context: BrowserContext, expected: string) {
  const marker = (await context.cookies()).find(
    (cookie) => cookie.name === DEVICE_LOCK_COOKIE_NAME && cookie.path === "/",
  );
  expect(marker?.value).toBe(expected);
}

async function authCookieSnapshot(context: BrowserContext) {
  return (await context.cookies())
    .filter((cookie) => cookie.name.includes("auth-token"))
    .map(({ name, value, domain, path }) => ({ name, value, domain, path }))
    .sort((left, right) => `${left.name}:${left.path}`.localeCompare(`${right.name}:${right.path}`));
}

async function installIsolatedSignOutForwarding(page: Page, apiRequest: APIRequest) {
  const outcome = deferred<ForwardedSignOut>();
  const timeout = setTimeout(() => {
    outcome.reject(new Error("Timed out waiting for isolated sign-out forwarding."));
  }, ISOLATED_SIGNOUT_TIMEOUT_MS);

  try {
    await page.route("**/auth/signout", async (route) => {
      let failure: unknown;
      let isolatedContext: APIRequestContext | undefined;
      let isolatedResponse: APIResponse | undefined;
      let result: ForwardedSignOut | undefined;

      try {
        const request = route.request();
        const requestUrl = new URL(request.url());
        if (requestUrl.origin !== APP_ORIGIN || requestUrl.pathname !== "/auth/signout") {
          throw new Error(`Refusing isolated sign-out forwarding to ${request.url()}`);
        }
        isolatedContext = await apiRequest.newContext({
          baseURL: APP_ORIGIN,
          storageState: {
            cookies: await page.context().cookies(APP_ORIGIN),
            origins: [],
          },
          timeout: ISOLATED_SIGNOUT_TIMEOUT_MS,
        });
        isolatedResponse = await isolatedContext.fetch(request, {
          headers: await request.allHeaders(),
          maxRedirects: 0,
          timeout: ISOLATED_SIGNOUT_TIMEOUT_MS,
        });
        const body = await isolatedResponse.body();
        const headers = { ...isolatedResponse.headers() };
        const responseSetCookieCount = isolatedResponse.headersArray()
          .filter(({ name }) => name.toLowerCase() === "set-cookie").length;
        for (const name of Object.keys(headers)) {
          if (name.toLowerCase() === "set-cookie") delete headers[name];
        }
        await route.fulfill({
          body,
          headers,
          status: isolatedResponse.status(),
        });
        result = {
          forwardedSetCookieCount: Object.keys(headers)
            .filter((name) => name.toLowerCase() === "set-cookie").length,
          responseSetCookieCount,
          status: isolatedResponse.status(),
        };
      } catch (error) {
        failure = error;
        try {
          await route.abort("failed");
        } catch {
          // Preserve the original forwarding failure if the route already closed.
        }
      } finally {
        for (const resource of [isolatedResponse, isolatedContext]) {
          try {
            await resource?.dispose();
          } catch (error) {
            failure ??= error;
          }
        }
        clearTimeout(timeout);
        if (failure) outcome.reject(failure);
        else if (result) outcome.resolve(result);
        else outcome.reject(new Error("Isolated sign-out forwarding produced no result."));
      }
    });
  } catch (error) {
    clearTimeout(timeout);
    outcome.reject(error);
    throw error;
  }
  void outcome.promise.catch(() => undefined);
  return { result: outcome.promise };
}

async function installCookieWriteFailure(page: Page) {
  await page.evaluate((markerName) => {
    const descriptor = Object.getOwnPropertyDescriptor(Document.prototype, "cookie");
    if (!descriptor?.get || !descriptor.set) throw new Error("Document.cookie is unavailable");
    Object.defineProperty(document, "cookie", {
      configurable: true,
      get() {
        return descriptor.get!.call(document) as string;
      },
      set(value: string) {
        if (!value.startsWith(`${markerName}=`)) descriptor.set!.call(document, value);
      },
    });
  }, DEVICE_LOCK_COOKIE_NAME);
}

async function installIndexedDbOpenFailures(page: Page, failedCalls: "all" | number[]) {
  await page.evaluate((calls) => {
    const state = globalThis as typeof globalThis & { __c03OriginalIndexedDb?: IDBFactory };
    const original = indexedDB;
    state.__c03OriginalIndexedDb = original;
    let call = 0;
    const replacement = new Proxy(original, {
      get(target, property) {
        if (property === "open") {
          return (name: string, version?: number) => {
            call += 1;
            if (calls === "all" || calls.includes(call)) {
              throw new DOMException("C03 injected IndexedDB open failure", "UnknownError");
            }
            return version === undefined ? target.open(name) : target.open(name, version);
          };
        }
        const value = Reflect.get(target, property, target) as unknown;
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    Object.defineProperty(globalThis, "indexedDB", {
      configurable: true,
      value: replacement,
    });
  }, failedCalls);
}

async function restoreIndexedDb(page: Page) {
  await page.evaluate(() => {
    const state = globalThis as typeof globalThis & { __c03OriginalIndexedDb?: IDBFactory };
    if (!state.__c03OriginalIndexedDb) throw new Error("C03 IndexedDB fixture was not installed");
    Object.defineProperty(globalThis, "indexedDB", {
      configurable: true,
      value: state.__c03OriginalIndexedDb,
    });
    delete state.__c03OriginalIndexedDb;
  });
}

async function seedOfflineFixture(
  page: Page,
  options: { context?: boolean; projection?: boolean } = {},
) {
  const now = Date.now();
  await page.evaluate(
    async ({
      contract,
      fixture: {
        binId,
        contextId,
        countLabel,
        displayName,
        restaurantId,
        restaurantName,
        userId,
        wineId,
      },
      issuedAt,
      expiresAt,
      includeContext,
      includeProjection,
    }) => {
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
      const transaction = database.transaction(contract.stores, "readwrite");
      if (includeContext) {
        transaction.objectStore("contexts").put({
          schemaVersion: 1,
          contextId,
          userId,
          restaurantId,
          issuedAt,
          expiresAt,
          lastObservedWallClock: issuedAt,
          lockedAt: null,
          lockReason: null,
          projectionVersion: 1,
        });
      }
      if (includeProjection) {
        transaction.objectStore("projections").put({
          userId,
          restaurantId,
          projectionKind: "cellar_lookup",
          version: 1,
          asOf: issuedAt,
          rows: [{
            wineId,
            displayName,
            producer: restaurantName,
            vintage: 2024,
            format: "750ml",
            sealedQuantity: 42,
            placements: [{
              binId,
              label: countLabel,
              sealedQuantity: 42,
            }],
            activeOpenBottleId: null,
            openedAt: null,
            remainingMl: null,
          }],
        });
      }
      await new Promise<void>((resolve, reject) => {
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error);
      });
      database.close();
    },
    {
      contract: driverContract,
      fixture: {
        binId: FIXTURE_BIN_ID,
        contextId: FIXTURE_CONTEXT_ID,
        countLabel: PRIVATE_COUNT_LABEL,
        displayName: PRIVATE_DISPLAY_NAME,
        restaurantId: FIXTURE_RESTAURANT_ID,
        restaurantName: PRIVATE_RESTAURANT_NAME,
        userId: FIXTURE_USER_ID,
        wineId: FIXTURE_WINE_ID,
      },
      issuedAt: new Date(now - 1_000).toISOString(),
      expiresAt: new Date(now + 60_000).toISOString(),
      includeContext: options.context ?? true,
      includeProjection: options.projection ?? true,
    },
  );
}

async function readOfflineFixture(page: Page) {
  return page.evaluate(async (contract) => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(contract.name, contract.version);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const transaction = database.transaction(contract.stores, "readonly");
    const readAll = (store: string) => new Promise<unknown[]>((resolve, reject) => {
      const request = transaction.objectStore(store).getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const [contexts, projections] = await Promise.all([
      readAll("contexts"),
      readAll("projections"),
    ]);
    database.close();
    return { contexts, projections };
  }, driverContract);
}

async function expectStoredFixture(
  page: Page,
  expected: { contexts: number; projections: number },
) {
  const stored = await readOfflineFixture(page);
  expect(stored.contexts).toHaveLength(expected.contexts);
  expect(stored.projections).toHaveLength(expected.projections);
  return stored;
}

async function expectLockedFixture(page: Page, expected: { projections: number }) {
  const stored = await expectStoredFixture(page, { contexts: 1, projections: expected.projections });
  expect(stored.contexts).toEqual([
    expect.objectContaining({ lockedAt: expect.any(String), lockReason: "sign_out" }),
  ]);
}

async function expectUnlockedFixture(page: Page, expected: { projections: number }) {
  const stored = await expectStoredFixture(page, { contexts: 1, projections: expected.projections });
  expect(stored.contexts).toEqual([
    expect.objectContaining({ lockedAt: null, lockReason: null }),
  ]);
  return stored;
}
