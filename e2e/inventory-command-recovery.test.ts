import { expect, test, type Locator, type Page, type TestInfo } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { ML_PER_OZ } from "@/lib/units";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const devEmail = process.env.DEV_BYPASS_EMAIL;
const canUseLocalFixture = Boolean(
  supabaseUrl && serviceRoleKey && devEmail && isLoopbackUrl(supabaseUrl),
);
const CUSTOM_OZ = 2.7;
const CUSTOM_ML = Math.round(CUSTOM_OZ * ML_PER_OZ);

test.describe("inventory command recovery", () => {
  test.skip(
    !canUseLocalFixture,
    "Requires loopback Supabase credentials and DEV_BYPASS_EMAIL.",
  );

  const run = `${Date.now()}`;
  const wineName = `C02 Recovery ${run}`;
  const producer = `C02 Fixture ${run}`;
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
        vintage: 2023,
        varietal: "Chardonnay",
        region: "Sonoma Coast",
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
        unit_cost: 31,
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
        name: `C02 Recovery List ${run}`,
        template: "classic",
        slug: `c02-recovery-${run}`,
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
        pour_size_mode: "picker",
        is_available: true,
      })
      .select("id")
      .single();
    if (itemError) throw itemError;
    listItemId = item.id;
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
    if (listItemId) {
      await checkedDelete(admin.from("wine_list_items").delete().eq("id", listItemId));
    }
    if (sectionId) {
      await checkedDelete(admin.from("wine_list_sections").delete().eq("id", sectionId));
    }
    if (listId) {
      await checkedDelete(admin.from("wine_lists").delete().eq("id", listId));
    }
    if (inventoryId) {
      await checkedDelete(admin.from("inventory_items").delete().eq("id", inventoryId));
    }
    if (wineId) {
      await checkedDelete(admin.from("wines").delete().eq("id", wineId));
    }
  });

  test("retries a committed custom pour with the same operation and records it once", async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const attempts: Array<{
      operationId: string | undefined;
      body: unknown;
      status: number;
      replayed: string | undefined;
    }> = [];
    let abortFirstResponse = true;

    await page.route(
      (url) => url.pathname === "/api/pour",
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

    await login(page);
    await page.goto("/cellar");
    await page.evaluate(() => localStorage.setItem("terroir-theme", "light"));
    await page.reload();
    await openFixtureDrawer(page, wineName, wineId);

    const drawer = wineDrawer(page);
    const pickerButton = drawer.getByRole("button", {
      name: "Pick a custom pour size",
    });
    await expectTouchTarget(pickerButton, "custom-pour picker");
    await pickerButton.click();

    const picker = page.getByRole("dialog").filter({ hasText: "Pick a pour size" });
    await expect(picker).toContainText(wineName);
    const custom = picker.getByLabel("Custom (oz)");
    const pour = picker.getByRole("button", { name: "Pour", exact: true });
    await expectTouchTarget(custom, "custom-pour input");
    await expectTouchTarget(pour, "custom-pour submit");
    await custom.fill(String(CUSTOM_OZ));
    await pour.click();

    const retry = drawer.getByRole("button", { name: "Retry prior pour" });
    await expect(retry).toBeVisible();
    await expect(drawer.getByRole("alert")).toContainText(
      "Pour not confirmed. This may already be recorded. Retry the prior action to check; do not pour again.",
    );
    await expect(page.getByText("Failed to fetch", { exact: true })).toHaveCount(0);
    await expect(page.getByText("Pour failed", { exact: true })).toHaveCount(0);
    await expectTouchTarget(retry, "retry prior pour");
    await attachScreenshot(page, testInfo, "390px-pour-unknown-outcome");

    expect(attempts).toHaveLength(1);
    expect(attempts[0]).toMatchObject({
      status: 200,
      replayed: "false",
      body: {
        wine_id: wineId,
        ml: CUSTOM_ML,
        kind: "pour",
        preservation_method: "none",
      },
    });
    expect(attempts[0].operationId).toMatch(/^[0-9a-f-]{36}$/i);
    const committed = await inventorySnapshot(attempts[0].operationId!);
    expect(committed).toEqual({
      quantity: 1,
      remainingMl: 750 - CUSTOM_ML,
      receiptCount: 1,
      receiptMl: CUSTOM_ML,
      eventCount: 2,
      pouredMl: CUSTOM_ML,
    });

    await retry.click();
    await expect(page.getByRole("status").filter({ hasText: "Already recorded" }))
      .toBeVisible();
    await expect(page.getByText("Pour not confirmed", { exact: false })).toHaveCount(0);
    await expect(page.getByText("Pour failed", { exact: true })).toHaveCount(0);
    await expectTouchTarget(
      drawer.getByRole("button", { name: /^Pour / }),
      "replayed pour action",
    );
    await expectTouchTarget(
      drawer.getByRole("button", { name: "Bottle already open" }),
      "replayed open action",
    );
    await attachScreenshot(page, testInfo, "390px-pour-replayed");

    expect(attempts).toHaveLength(2);
    expect(attempts[1]).toEqual({
      ...attempts[0],
      replayed: "true",
    });
    expect(await inventorySnapshot(attempts[0].operationId!)).toEqual(committed);
  });

  async function inventorySnapshot(operationId: string) {
    const admin = adminClient();
    const [inventory, bottle, receipt] = await Promise.all([
      admin.from("inventory_items").select("quantity").eq("id", inventoryId).single(),
      admin.from("open_bottles").select("remaining_ml").eq("restaurant_id", restaurantId)
        .eq("wine_id", wineId).single(),
      admin.from("inventory_command_receipts")
        .select("request_payload, result_payload")
        .eq("restaurant_id", restaurantId)
        .eq("operation_id", operationId),
    ]);
    if (inventory.error) throw inventory.error;
    if (bottle.error) throw bottle.error;
    if (receipt.error) throw receipt.error;
    const stored = receipt.data[0];
    const request = asRecord(stored?.request_payload);
    const result = asRecord(stored?.result_payload);
    const eventIds = Array.isArray(result?.pour_event_ids)
      ? result.pour_event_ids.filter((id): id is string => typeof id === "string")
      : [];
    const events = eventIds.length
      ? await admin.from("pour_events").select("kind, ml_delta").in("id", eventIds)
      : { data: [], error: null };
    if (events.error) throw events.error;
    return {
      quantity: inventory.data.quantity,
      remainingMl: bottle.data.remaining_ml,
      receiptCount: receipt.data.length,
      receiptMl: request?.ml,
      eventCount: events.data?.length ?? 0,
      pouredMl: events.data?.find((event) => event.kind === "pour")?.ml_delta,
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
    throw new Error("Refusing to create the recovery fixture outside local Supabase.");
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

async function openFixtureDrawer(page: Page, name: string, id: string) {
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "auto" }));
  const search = page.getByPlaceholder("Search name, producer, region…").first();
  await expect(search).toBeVisible();
  await search.fill(name);
  const row = page.locator(`[data-cellar-row="${id}"]`);
  await expect(row).toBeVisible({ timeout: 20_000 });
  const rowButton = row.locator(":scope > button").last();
  await rowButton.focus();
  await page.keyboard.press("Enter");
  await expect(wineDrawer(page)).toBeVisible();
}

function wineDrawer(page: Page) {
  return page.getByRole("dialog").filter({ has: page.locator("#wine-detail-heading") });
}

async function expectTouchTarget(control: Locator, label: string) {
  const box = await control.boundingBox();
  expect(box, `${label} has no bounding box`).not.toBeNull();
  expect(box!.width, `${label} is narrower than 44px`).toBeGreaterThanOrEqual(44);
  expect(box!.height, `${label} is shorter than 44px`).toBeGreaterThanOrEqual(44);
  expect(box!.x, `${label} clips left`).toBeGreaterThanOrEqual(-1);
  expect(box!.x + box!.width, `${label} clips right`).toBeLessThanOrEqual(391);
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
