import { expect, test, type Locator, type Page, type TestInfo } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const devEmail = process.env.DEV_BYPASS_EMAIL;
const canUseLocalFixture = Boolean(
  supabaseUrl && serviceRoleKey && devEmail && isLoopbackUrl(supabaseUrl),
);

test.describe("discard command mobile recovery", () => {
  test.skip(
    !canUseLocalFixture,
    "Requires loopback Supabase credentials and DEV_BYPASS_EMAIL.",
  );

  const run = `${Date.now()}`;
  const wineName = `Discard Recovery ${run}`;
  const producer = `C07 Discard Fixture ${run}`;
  let restaurantId = "";
  let wineId = "";
  let inventoryId = "";
  let bottleId = "";
  let openedAt = "";

  test.beforeAll(async () => {
    restaurantId = await resolveRestaurantId();
    const admin = adminClient();

    const { data: wine, error: wineError } = await admin
      .from("wines")
      .insert({
        restaurant_id: restaurantId,
        name: wineName,
        producer,
        vintage: 2024,
        varietal: "Pinot Noir",
        region: "Willamette Valley",
        country: "United States",
        size_ml: 750,
      })
      .select("id")
      .single();
    if (wineError) throw wineError;
    wineId = wine.id;

    const { data: inventory, error: inventoryError } = await admin
      .from("inventory_items")
      .insert({
        restaurant_id: restaurantId,
        wine_id: wineId,
        quantity: 2,
        unit_cost: 29,
        added_via: "manual",
      })
      .select("id")
      .single();
    if (inventoryError) throw inventoryError;
    inventoryId = inventory.id;
  });

  test.afterAll(async () => {
    const admin = adminClient();
    if (restaurantId && wineId) {
      await checkedDelete(
        admin.from("inventory_command_receipts").delete()
          .eq("restaurant_id", restaurantId).eq("wine_id", wineId),
      );
      await checkedDelete(
        admin.from("bottle_closeouts").delete()
          .eq("restaurant_id", restaurantId).eq("wine_id", wineId),
      );
      await checkedDelete(
        admin.from("pour_events").delete()
          .eq("restaurant_id", restaurantId).eq("wine_id", wineId),
      );
      await checkedDelete(
        admin.from("open_bottles").delete()
          .eq("restaurant_id", restaurantId).eq("wine_id", wineId),
      );
    }
    if (inventoryId) {
      await checkedDelete(admin.from("inventory_items").delete().eq("id", inventoryId));
    }
    if (wineId) {
      await checkedDelete(admin.from("wines").delete().eq("id", wineId));
    }
  });

  test("replays one committed discard without duplicating its spill", async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await login(page);

    const openResponse = await page.request.post("/api/open-bottles", {
      headers: { "Idempotency-Key": crypto.randomUUID() },
      data: { wine_id: wineId, preservation_method: "none" },
    });
    expect(openResponse.status(), await openResponse.text()).toBe(201);
    const openBody = asRecord(await openResponse.json());
    const openBottle = asRecord(openBody?.open_bottle);
    expect(openBottle?.id).toEqual(expect.any(String));
    expect(openBottle?.opened_at).toEqual(expect.any(String));
    bottleId = openBottle!.id as string;
    openedAt = openBottle!.opened_at as string;

    const attempts: Array<{
      operationId: string | undefined;
      body: unknown;
      status: number;
      replayed: string | undefined;
    }> = [];
    let abortFirstResponse = true;
    await page.route(
      (url) => url.pathname === `/api/open-bottles/${bottleId}/close`,
      async (route) => {
        const request = route.request();
        const response = await route.fetch();
        attempts.push({
          operationId: request.headers()["idempotency-key"],
          body: request.postDataJSON(),
          status: response.status(),
          replayed: response.headers()["idempotency-replayed"],
        });
        if (abortFirstResponse) {
          abortFirstResponse = false;
          await route.abort("connectionreset");
          return;
        }
        await route.fulfill({ response });
      },
    );

    await page.goto("/cellar/open");
    await page.evaluate(() => localStorage.setItem("terroir-theme", "light"));
    await page.reload();
    const fixtureRow = page.getByRole("listitem").filter({ hasText: producer });
    await expect(fixtureRow).toBeVisible();
    await expectNoHorizontalOverflow(page);

    const close = fixtureRow.getByRole("button", { name: "Close bottle" });
    await expectTouchTarget(close, "close bottle");
    await close.click();
    const cancel = fixtureRow.getByRole("button", { name: "Cancel close" });
    const confirm = fixtureRow.getByRole("button", { name: /^Confirm discard / });
    await expectTouchTarget(cancel, "cancel discard");
    await expectTouchTarget(confirm, "confirm discard");
    await confirm.click();

    const retry = fixtureRow.getByRole("button", { name: "Retry prior action" });
    const warning = fixtureRow.getByRole("alert");
    const identity = fixtureRow.locator(".font-serif.text-body-lg").first();
    await expect(retry).toBeVisible();
    await expect(warning).toHaveText(
      "Discard not confirmed. This may already be recorded. Retry the prior action to check; do not discard again.",
    );
    await expect(page.getByText("Failed to fetch", { exact: true })).toHaveCount(0);
    await expect(page.getByText("Couldn't close the bottle", { exact: false }))
      .toHaveCount(0);
    await expectTouchTarget(retry, "retry prior discard");
    const warningGeometry = await expectWrappedInsideViewport(
      warning,
      "discard warning",
    );
    const identityBox = await identity.boundingBox();
    const retryBox = await retry.boundingBox();
    expect(identityBox, "wine identity has no bounding box").not.toBeNull();
    expect(retryBox, "retry prior discard has no bounding box").not.toBeNull();
    expect(warningGeometry.clientWidth, "discard warning is too narrow to read")
      .toBeGreaterThanOrEqual(300);
    expect(
      warningGeometry.top,
      "discard warning overlaps the identity/action row",
    ).toBeGreaterThanOrEqual(
      Math.max(
        identityBox!.y + identityBox!.height,
        retryBox!.y + retryBox!.height,
      ) - 1,
    );
    await expectNoHorizontalOverflow(page);
    await attachScreenshot(page, testInfo, "390px-discard-unknown-outcome");

    expect(attempts).toHaveLength(1);
    expect(attempts[0]).toMatchObject({
      status: 200,
      replayed: "false",
      body: { expected_opened_at: openedAt },
    });
    expect(attempts[0].operationId).toMatch(/^[0-9a-f-]{36}$/i);
    const committed = await discardSnapshot(attempts[0].operationId!);
    expect(committed).toEqual({
      quantity: 1,
      remainingMl: 0,
      closed: true,
      receiptCount: 1,
      receiptCommand: "discard",
      newBottleCount: 1,
      spillCount: 1,
      spilledMl: 750,
      closeoutCount: 0,
    });

    await retry.click();
    await expect(page.getByRole("status").filter({ hasText: "Already recorded" }))
      .toBeVisible();
    await expect(page.getByText("Discard not confirmed", { exact: false }))
      .toHaveCount(0);
    await expect(page.getByText("Couldn't close the bottle", { exact: false }))
      .toHaveCount(0);
    await expect(fixtureRow).toHaveCount(0);
    await expectNoHorizontalOverflow(page);
    await attachScreenshot(page, testInfo, "390px-discard-replayed");

    expect(attempts).toHaveLength(2);
    expect(attempts[1]).toEqual({ ...attempts[0], replayed: "true" });
    expect(await discardSnapshot(attempts[0].operationId!)).toEqual(committed);
    expect(
      warningGeometry.lineCount,
      `discard warning collapses into ${warningGeometry.lineCount} lines at 390px`,
    ).toBeLessThanOrEqual(6);
  });

  async function discardSnapshot(operationId: string) {
    const admin = adminClient();
    const [inventory, bottle, receipt, events, closeouts] = await Promise.all([
      admin.from("inventory_items").select("quantity").eq("id", inventoryId).single(),
      admin.from("open_bottles").select("remaining_ml, closed_at").eq("id", bottleId)
        .single(),
      admin.from("inventory_command_receipts")
        .select("request_payload")
        .eq("restaurant_id", restaurantId)
        .eq("operation_id", operationId),
      admin.from("pour_events").select("kind, ml_delta")
        .eq("restaurant_id", restaurantId).eq("wine_id", wineId),
      admin.from("bottle_closeouts").select("id", { count: "exact", head: true })
        .eq("restaurant_id", restaurantId).eq("wine_id", wineId),
    ]);
    if (inventory.error) throw inventory.error;
    if (bottle.error) throw bottle.error;
    if (receipt.error) throw receipt.error;
    if (events.error) throw events.error;
    if (closeouts.error) throw closeouts.error;
    const request = asRecord(receipt.data[0]?.request_payload);
    const newBottleEvents = events.data.filter((event) => event.kind === "new_bottle");
    const spillEvents = events.data.filter((event) => event.kind === "spill");
    return {
      quantity: inventory.data.quantity,
      remainingMl: bottle.data.remaining_ml,
      closed: bottle.data.closed_at !== null,
      receiptCount: receipt.data.length,
      receiptCommand: request?.command,
      newBottleCount: newBottleEvents.length,
      spillCount: spillEvents.length,
      spilledMl: spillEvents[0]?.ml_delta,
      closeoutCount: closeouts.count,
    };
  }
});

function isLoopbackUrl(value: string): boolean {
  try {
    return ["127.0.0.1", "localhost", "::1"].includes(new URL(value).hostname);
  } catch {
    return false;
  }
}

function adminClient() {
  if (!supabaseUrl || !serviceRoleKey || !isLoopbackUrl(supabaseUrl)) {
    throw new Error("Refusing to create the discard fixture outside local Supabase.");
  }
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });
}

async function resolveRestaurantId(): Promise<string> {
  if (!devEmail) throw new Error("DEV_BYPASS_EMAIL is unavailable.");
  const admin = adminClient();
  const { data: users, error: userError } = await admin.auth.admin.listUsers({
    perPage: 200,
  });
  if (userError) throw userError;
  const user = users.users.find((candidate) => candidate.email === devEmail);
  if (!user) throw new Error(`Local dev user ${devEmail} was not found.`);
  const { data, error } = await admin.from("memberships")
    .select("restaurant_id, created_at")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .single();
  if (error) throw error;
  return data.restaurant_id;
}

async function login(page: Page) {
  const response = await page.request.get("/api/dev-login");
  expect(response.ok(), await response.text()).toBeTruthy();
}

async function expectTouchTarget(control: Locator, label: string) {
  const box = await control.boundingBox();
  expect(box, `${label} has no bounding box`).not.toBeNull();
  expect(box!.width, `${label} is narrower than 44px`).toBeGreaterThanOrEqual(44);
  expect(box!.height, `${label} is shorter than 44px`).toBeGreaterThanOrEqual(44);
  expect(box!.x, `${label} clips left`).toBeGreaterThanOrEqual(-1);
  expect(box!.x + box!.width, `${label} clips right`).toBeLessThanOrEqual(391);
}

async function expectWrappedInsideViewport(control: Locator, label: string) {
  const geometry = await control.evaluate((element) => {
    const style = window.getComputedStyle(element);
    const lineHeight = Number.parseFloat(style.lineHeight);
    const rect = element.getBoundingClientRect();
    return {
      height: rect.height,
      lineHeight,
      left: rect.left,
      right: rect.right,
      scrollWidth: element.scrollWidth,
      clientWidth: element.clientWidth,
      lineCount: rect.height / lineHeight,
      top: rect.top,
    };
  });
  expect(geometry.left, `${label} clips left`).toBeGreaterThanOrEqual(-1);
  expect(geometry.right, `${label} clips right`).toBeLessThanOrEqual(391);
  expect(geometry.scrollWidth, `${label} text overflows horizontally`)
    .toBeLessThanOrEqual(geometry.clientWidth + 1);
  expect(geometry.height, `${label} did not wrap onto multiple lines`)
    .toBeGreaterThan(geometry.lineHeight * 1.5);
  return geometry;
}

async function expectNoHorizontalOverflow(page: Page) {
  const widths = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(widths.scrollWidth).toBeLessThanOrEqual(widths.clientWidth + 1);
}

async function attachScreenshot(page: Page, testInfo: TestInfo, name: string) {
  const path = testInfo.outputPath(`${name}.png`);
  await page.screenshot({ animations: "disabled", path });
  await testInfo.attach(name, { path, contentType: "image/png" });
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

async function checkedDelete(query: PromiseLike<{ error: { message: string } | null }>) {
  const { error } = await query;
  if (error) throw error;
}
