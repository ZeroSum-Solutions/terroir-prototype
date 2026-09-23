import {
  expect,
  test,
  type Locator,
  type Page,
  type TestInfo,
} from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

const VIEWPORTS = [
  { width: 320, height: 740 },
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
  { width: 1200, height: 900 },
] as const;

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const devEmail = process.env.DEV_BYPASS_EMAIL;
const canUseLocalFixture = Boolean(
  supabaseUrl &&
    serviceRoleKey &&
    devEmail &&
    isLoopbackUrl(supabaseUrl),
);

test.describe("C07 mobile service readiness", () => {
  test.skip(
    !canUseLocalFixture,
    "Requires loopback Supabase credentials and DEV_BYPASS_EMAIL.",
  );

  const run = `${Date.now()}`;
  const wineName = `C07 Service Readiness ${run}`;
  const producer = `C07 Fixture ${run}`;
  let restaurantId = "";
  let wineId = "";
  let inventoryId = "";
  let listId = "";
  let sectionId = "";
  let listItemId = "";

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
        unit_cost: 28,
        added_via: "manual",
      })
      .select("id")
      .single();
    if (inventoryError) throw inventoryError;
    inventoryId = inventory.id;

    const { data: list, error: listError } = await admin
      .from("wine_lists")
      .insert({
        restaurant_id: restaurantId,
        name: `C07 Fixture List ${run}`,
        template: "classic",
        slug: `c07-mobile-${run}`,
        is_published: false,
        archived: false,
      })
      .select("id")
      .single();
    if (listError) throw listError;
    listId = list.id;

    const { data: section, error: sectionError } = await admin
      .from("wine_list_sections")
      .insert({ wine_list_id: listId, name: "By the glass", position: 0 })
      .select("id")
      .single();
    if (sectionError) throw sectionError;
    sectionId = section.id;

    const { data: item, error: itemError } = await admin
      .from("wine_list_items")
      .insert({
        section_id: sectionId,
        restaurant_id: restaurantId,
        wine_id: wineId,
        position: 0,
        glass_pour_ml: 150,
        pour_size_mode: "fixed",
        is_available: true,
      })
      .select("id")
      .single();
    if (itemError) throw itemError;
    listItemId = item.id;
  });

  test.afterAll(async () => {
    const admin = adminClient();
    if (listItemId) {
      const { error } = await admin
        .from("wine_list_items")
        .delete()
        .eq("id", listItemId);
      if (error) throw error;
    }
    if (sectionId) {
      const { error } = await admin
        .from("wine_list_sections")
        .delete()
        .eq("id", sectionId);
      if (error) throw error;
    }
    if (listId) {
      const { error } = await admin.from("wine_lists").delete().eq("id", listId);
      if (error) throw error;
    }
    if (inventoryId) {
      const { error } = await admin
        .from("inventory_items")
        .delete()
        .eq("id", inventoryId);
      if (error) throw error;
    }
    if (wineId) {
      const { error } = await admin.from("wines").delete().eq("id", wineId);
      if (error) throw error;
    }
  });

  for (const viewport of VIEWPORTS) {
    test(`${viewport.width}px: populated cellar lookup and bottle controls remain operable`, async ({
      page,
    }, testInfo) => {
      await page.setViewportSize(viewport);
      await login(page);
      await page.goto("/cellar");
      await page.evaluate(() => {
        localStorage.setItem("terroir-theme", "light");
      });
      await page.reload();
      await expect(page.locator("html")).toHaveAttribute("data-theme", "light");

      await openFixtureDrawer(page, wineName, wineId, viewport.width);
      await assertServiceSurface(page, wineId, viewport.width, testInfo);
      await attachScreenshot(page, testInfo, `${viewport.width}px-light`);
      await wineDrawer(page).getByRole("button", {
        name: "Close",
        exact: true,
      }).click();
      await expect(wineDrawer(page)).toBeHidden();

      await page.evaluate(() => {
        localStorage.setItem("terroir-theme", "dark");
      });
      await page.reload();
      await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
      await openFixtureDrawer(page, wineName, wineId, viewport.width);
      await assertServiceSurface(page, wineId, viewport.width, testInfo);
      await attachScreenshot(page, testInfo, `${viewport.width}px-dark`);
      await assertKeyboardDialogCycle(
        page,
        wineId,
        viewport.width,
        testInfo,
      );
    });
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
    throw new Error("Refusing to create the C07 fixture outside local Supabase.");
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

  const { data, error } = await admin
    .from("memberships")
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

async function openFixtureDrawer(
  page: Page,
  name: string,
  id: string,
  viewportWidth: number,
) {
  if (!page.url().includes("/cellar")) await page.goto("/cellar");
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "auto" }));
  const search = page.getByPlaceholder("Search name, producer, region…").first();
  await expect(search).toBeVisible();
  await search.fill("");
  await expect(search).toHaveValue("");

  const row = page.locator(`[data-cellar-row="${id}"]`);
  await expect(async () => {
    await search.fill(name);
    await expect(search).toHaveValue(name);
    await expect(row).toHaveCount(1);
    await expect(row).toBeVisible();
  }).toPass({ timeout: 20_000 });
  await expect(row).toContainText(name);

  const rowButton = wineRowButton(row);
  await expectTouchTarget(search, "cellar search", viewportWidth);
  await expectInsideViewport(search, "cellar search", viewportWidth);
  await expectTouchTarget(rowButton, "populated wine row", viewportWidth);
  await expectInsideViewport(rowButton, "populated wine row", viewportWidth);
  await rowButton.focus();
  await expect(rowButton).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(wineDrawer(page)).toBeVisible();
}

function wineDrawer(page: Page) {
  return page
    .getByRole("dialog")
    .filter({ has: page.locator("#wine-detail-heading") });
}

async function assertServiceSurface(
  page: Page,
  wineId: string,
  viewportWidth: number,
  testInfo: TestInfo,
) {
  const drawer = wineDrawer(page);
  const close = drawer.getByRole("button", { name: "Close", exact: true });
  const openBottle = drawer.getByRole("button", {
    name: "Open bottle",
    exact: true,
  });
  const pour = drawer.getByRole("button", { name: /^Pour / });

  await expect(drawer).toContainText("C07 Fixture");
  await expect(drawer).toContainText("Willamette Valley");
  await expect(openBottle).toBeVisible();
  await expect(pour).toBeVisible();

  expect(
    await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
    `document overflow at ${viewportWidth}px`,
  ).toBeLessThanOrEqual(1);
  expect(
    await drawer.evaluate((node) => node.scrollWidth - node.clientWidth),
    `drawer overflow at ${viewportWidth}px`,
  ).toBeLessThanOrEqual(1);

  for (const [label, control] of [
    ["drawer close", close],
    ["open bottle", openBottle],
    ["pour", pour],
  ] as const) {
    await expectTouchTarget(control, label, viewportWidth);
    await expectInsideViewport(control, label, viewportWidth);
  }
  await assertDrawerInteractiveTargets(drawer, viewportWidth, testInfo);
  await expect(page.locator(`[data-cellar-row="${wineId}"]`)).toHaveCount(1);
}

async function assertDrawerInteractiveTargets(
  drawer: Locator,
  viewportWidth: number,
  testInfo: TestInfo,
) {
  const controls = drawer.locator(
    'a[href]:visible, button:not([disabled]):visible, input:not([disabled]):visible, select:not([disabled]):visible, textarea:not([disabled]):visible, [tabindex]:not([tabindex="-1"]):visible',
  );
  const snapshot = [];
  for (let index = 0; index < (await controls.count()); index += 1) {
    const control = controls.nth(index);
    const box = await control.boundingBox();
    snapshot.push({
      index,
      tag: await control.evaluate((node) => node.tagName.toLowerCase()),
      text: (await control.textContent())?.trim().replace(/\s+/g, " ") ?? "",
      ariaLabel: await control.getAttribute("aria-label"),
      href: await control.getAttribute("href"),
      box,
    });
  }

  await testInfo.attach(`${viewportWidth}px-drawer-targets`, {
    body: Buffer.from(JSON.stringify(snapshot, null, 2)),
    contentType: "application/json",
  });

  const violations = snapshot.filter(
    ({ box }) =>
      !box ||
      box.width < 44 ||
      box.height < 44 ||
      box.x < -1 ||
      box.x + box.width > viewportWidth + 1,
  );
  expect(
    violations,
    `drawer focus targets must be at least 44px and horizontally unclipped at ${viewportWidth}px`,
  ).toEqual([]);
}

async function assertKeyboardDialogCycle(
  page: Page,
  wineId: string,
  viewportWidth: number,
  testInfo: TestInfo,
) {
  const rowButton = wineRowButton(
    page.locator(`[data-cellar-row="${wineId}"]`),
  );
  const drawer = wineDrawer(page);
  const openBottle = drawer.getByRole("button", {
    name: "Open bottle",
    exact: true,
  });
  await openBottle.focus();
  await expect(openBottle).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(drawer).toBeHidden();
  const focusState = await page.evaluate(() => {
    const active = document.activeElement as HTMLElement | null;
    return {
      activeTag: active?.tagName ?? null,
      activeText: active?.textContent?.trim().slice(0, 120) ?? null,
      activeAriaLabel: active?.getAttribute("aria-label") ?? null,
      activeRow: active?.closest("[data-cellar-row]")?.getAttribute(
        "data-cellar-row",
      ) ?? null,
      activeConnected: active?.isConnected ?? false,
    };
  });
  await testInfo.attach(`${viewportWidth}px-focus-restoration`, {
    body: Buffer.from(JSON.stringify(focusState, null, 2)),
    contentType: "application/json",
  });
  await expect(rowButton).toBeFocused();

  await page.keyboard.press("Enter");
  await expect(wineDrawer(page)).toBeVisible();
}

function wineRowButton(row: Locator) {
  return row.locator(":scope > button").last();
}

async function expectTouchTarget(
  control: Locator,
  label: string,
  viewportWidth: number,
) {
  const box = await control.boundingBox();
  expect(box, `${label} has no box at ${viewportWidth}px`).not.toBeNull();
  expect(box!.height, `${label} is shorter than 44px at ${viewportWidth}px`).toBeGreaterThanOrEqual(44);
  expect(box!.width, `${label} is narrower than 44px at ${viewportWidth}px`).toBeGreaterThanOrEqual(44);
}

async function expectInsideViewport(
  control: Locator,
  label: string,
  viewportWidth: number,
) {
  const box = await control.boundingBox();
  expect(box, `${label} has no box at ${viewportWidth}px`).not.toBeNull();
  expect(box!.x, `${label} clips left at ${viewportWidth}px`).toBeGreaterThanOrEqual(-1);
  expect(
    box!.x + box!.width,
    `${label} clips right at ${viewportWidth}px`,
  ).toBeLessThanOrEqual(viewportWidth + 1);
}

async function attachScreenshot(
  page: Page,
  testInfo: TestInfo,
  name: string,
) {
  const path = testInfo.outputPath(`${name}.png`);
  await page.screenshot({ animations: "disabled", path });
  await testInfo.attach(name, {
    path,
    contentType: "image/png",
  });
}
