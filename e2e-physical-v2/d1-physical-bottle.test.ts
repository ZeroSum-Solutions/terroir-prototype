import {
  expect,
  test,
  type Locator,
  type Page,
  type Request,
  type Response,
} from "@playwright/test";
import type { Database } from "@/types/database";
import type { executePhysicalBottleCommand } from "@/domains/pours/physical-bottle-command";
import {
  createPhysicalV2Fixture,
  type PhysicalV2Fixture,
} from "./physical-bottle-fixture";

type BottleRow = Database["public"]["Tables"]["open_bottles"]["Row"];
type CommandBottle = Awaited<
  ReturnType<typeof executePhysicalBottleCommand>
>["openBottle"];
type CommandCapture = {
  body: Record<string, unknown>;
  operationId: string;
  payload: {
    open_bottle?: CommandBottle;
    pour_event_id?: string;
  };
  response: Response;
};

test.describe("D1 physical bottle service", () => {
  test.describe.configure({ mode: "serial" });
  let fixture: PhysicalV2Fixture;

  test.beforeAll(async () => {
    fixture = await createPhysicalV2Fixture();
  });

  test("opens two exact 750 mL siblings and pours only the selected bottle", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const login = await page.request.get("/api/dev-login");
    expect(login.ok(), await login.text()).toBeTruthy();

    await page.goto("/cellar");
    const search = page.getByPlaceholder("Search name, producer, region…");
    await expect(search).toBeVisible();
    await expect(async () => {
      await search.fill(fixture.wineName);
      await expect(search).toHaveValue(fixture.wineName);
      await expect(page.locator(`[data-cellar-row="${fixture.wineId}"]`)).toBeVisible();
    }).toPass({ timeout: 20_000 });

    const row = page.locator(`[data-cellar-row="${fixture.wineId}"]`);
    await expect(row).toContainText(fixture.binCode);
    await row.click();
    const drawer = page.getByRole("dialog").filter({ hasText: fixture.wineName });
    await expect(drawer).toBeVisible();
    await expect(drawer.getByText(`Bin D1 Disposable › ${fixture.binCode} · 2`))
      .toBeVisible();

    const inventoryBefore = await readInventoryQuantity(fixture);
    expect(inventoryBefore).toBe(2);
    const actorId = await resolveDevActorId(fixture);

    const firstOpen = await clickCommand(
      page,
      drawer.getByRole("button", { name: "Open bottle", exact: true }),
      "/api/open-bottles",
    );
    expect(firstOpen.body).toEqual({
      wine_id: fixture.wineId,
      preservation_method: "none",
    });
    const bottleA = requirePhysicalBottle(firstOpen, fixture);
    expect(bottleA).toMatchObject({
      remaining_ml: 750,
      nominal_capacity_ml: 750,
      source_inventory_item_id: fixture.inventoryId,
      identity_contract: 2,
      identity_origin: "native",
      state_version: 0,
    });
    expect(await readBottle(fixture, bottleA.id)).toMatchObject({
      id: bottleA.id,
      restaurant_id: fixture.restaurantId,
      wine_id: fixture.wineId,
      remaining_ml: 750,
      nominal_capacity_ml: 750,
      source_inventory_item_id: fixture.inventoryId,
      identity_contract: 2,
      identity_origin: "native",
      state_version: 0,
      opening_operation_id: firstOpen.operationId,
      opened_by: actorId,
    });
    expect(await readInventoryQuantity(fixture)).toBe(1);

    await expect(
      drawer.getByRole("button", { name: "Open another bottle", exact: true }),
    ).toBeVisible();
    const secondOpen = await clickCommand(
      page,
      drawer.getByRole("button", { name: "Open another bottle", exact: true }),
      "/api/open-bottles",
    );
    const bottleB = requirePhysicalBottle(secondOpen, fixture);
    expect(bottleB.id).not.toBe(bottleA.id);
    expect(bottleB).toMatchObject({
      remaining_ml: 750,
      nominal_capacity_ml: 750,
      source_inventory_item_id: fixture.inventoryId,
      identity_contract: 2,
      identity_origin: "native",
      state_version: 0,
    });
    expect(await readBottle(fixture, bottleB.id)).toMatchObject({
      id: bottleB.id,
      restaurant_id: fixture.restaurantId,
      wine_id: fixture.wineId,
      remaining_ml: 750,
      nominal_capacity_ml: 750,
      source_inventory_item_id: fixture.inventoryId,
      identity_contract: 2,
      identity_origin: "native",
      state_version: 0,
      opening_operation_id: secondOpen.operationId,
      opened_by: actorId,
    });
    expect(await readInventoryQuantity(fixture)).toBe(0);

    const beforeSibling = await readBottle(fixture, bottleB.id);
    const bottleAInput = drawer.locator(`#physical-open-bottle-${bottleA.id}`);
    const bottleBInput = drawer.locator(`#physical-open-bottle-${bottleB.id}`);
    await expect(bottleAInput).toBeVisible();
    await expect(bottleBInput).toBeVisible();
    await bottleAInput.check();
    await expect(bottleAInput).toBeChecked();
    await expect(page).toHaveURL(new RegExp(`bottle=${bottleA.id}`));

    const eventIds: string[] = [];
    const pourOperationIds: string[] = [];
    for (const expectedRemaining of [600, 450, 300, 150]) {
      const pour = await clickCommand(
        page,
        drawer.getByRole("button", { name: /^Pour 5\.1 oz$/ }),
        "/api/pour",
      );
      expect(pour.body).toEqual({
        wine_id: fixture.wineId,
        open_bottle_id: bottleA.id,
        ml: 150,
        kind: "pour",
      });
      expect(pour.payload.open_bottle).toMatchObject({
        id: bottleA.id,
        wine_id: fixture.wineId,
        remaining_ml: expectedRemaining,
        nominal_capacity_ml: 750,
        state_version: 1 + eventIds.length,
      });
      expect(pour.payload.pour_event_id).toMatch(UUID_PATTERN);
      eventIds.push(pour.payload.pour_event_id!);
      pourOperationIds.push(pour.operationId);
      expect(await readInventoryQuantity(fixture)).toBe(0);
      await expect(bottleAInput).toBeChecked();
    }

    await page.reload();
    const reloadedDrawer = page.getByRole("dialog").filter({ hasText: fixture.wineName });
    await expect(reloadedDrawer).toBeVisible();
    const reloadedA = reloadedDrawer.locator(`#physical-open-bottle-${bottleA.id}`);
    const reloadedB = reloadedDrawer.locator(`#physical-open-bottle-${bottleB.id}`);
    await expect(reloadedA).toBeChecked();
    await expect(reloadedA.locator("xpath=..")).toContainText("150 of 750 ml");
    await expect(reloadedB.locator("xpath=..")).toContainText("750 of 750 ml");

    const afterA = await readBottle(fixture, bottleA.id);
    const afterSibling = await readBottle(fixture, bottleB.id);
    expect(afterA).toMatchObject({
      id: bottleA.id,
      remaining_ml: 150,
      nominal_capacity_ml: 750,
      state_version: 4,
      closed_at: null,
    });
    // This is an exact row snapshot, not a wine-level aggregate assertion.
    // The same-wine sibling must not change by one byte of selected row data.
    expect(afterSibling).toEqual(beforeSibling);
    expect(afterSibling).toMatchObject({
      id: bottleB.id,
      remaining_ml: 750,
      nominal_capacity_ml: 750,
      state_version: 0,
      closed_at: null,
    });

    const { data: events, error: eventsError } = await fixture.admin
      .from("pour_events")
      .select("*")
      .eq("restaurant_id", fixture.restaurantId)
      .in("id", eventIds);
    expect(eventsError, eventsError?.message).toBeNull();
    expect(events).toHaveLength(4);
    expect(events).toEqual(expect.arrayContaining(eventIds.map((id) =>
      expect.objectContaining({
        id,
        wine_id: fixture.wineId,
        open_bottle_id: bottleA.id,
        event_contract: 2,
        kind: "pour",
        ml_delta: 150,
      })
    )));

    const { data: receipts, error: receiptsError } = await fixture.admin
      .from("inventory_command_receipts")
      .select("*")
      .eq("restaurant_id", fixture.restaurantId)
      .in("operation_id", pourOperationIds);
    expect(receiptsError, receiptsError?.message).toBeNull();
    expect(receipts).toHaveLength(4);
    expect(receipts).toEqual(expect.arrayContaining(pourOperationIds.map((operationId) =>
      expect.objectContaining({
        operation_id: operationId,
        wine_id: fixture.wineId,
        command_type: "pour",
        command_version: 2,
        completed_at: expect.any(String),
      })
    )));
  });
});

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function clickCommand(
  page: Page,
  control: Locator,
  pathname: string,
): Promise<CommandCapture> {
  const requestPromise = page.waitForRequest((request) =>
    request.url().endsWith(pathname) && request.method() === "POST"
  );
  const responsePromise = page.waitForResponse((response) =>
    response.url().endsWith(pathname) && response.request().method() === "POST"
  );
  await control.click();
  const [request, response] = await Promise.all([requestPromise, responsePromise]);
  const payload = await response.json().catch(() => null) as CommandCapture["payload"] | null;
  expect(response.ok(), JSON.stringify(payload)).toBeTruthy();
  expect(payload).not.toBeNull();
  const operationId = readOperationId(request);
  return {
    body: request.postDataJSON() as Record<string, unknown>,
    operationId,
    payload: payload!,
    response,
  };
}

function readOperationId(request: Request): string {
  const operationId = request.headers()["idempotency-key"];
  expect(operationId).toMatch(UUID_PATTERN);
  return operationId;
}

function requirePhysicalBottle(
  command: CommandCapture,
  fixture: PhysicalV2Fixture,
): CommandBottle {
  expect(command.response.status()).toBe(201);
  const bottle = command.payload.open_bottle;
  expect(bottle).toMatchObject({
    restaurant_id: fixture.restaurantId,
    wine_id: fixture.wineId,
  });
  expect(bottle?.id).toMatch(UUID_PATTERN);
  return bottle!;
}

async function resolveDevActorId(fixture: PhysicalV2Fixture): Promise<string> {
  const email = process.env.DEV_BYPASS_EMAIL;
  expect(email).toBeTruthy();
  const { data, error } = await fixture.admin.auth.admin.listUsers({ perPage: 200 });
  expect(error, error?.message).toBeNull();
  const actor = data.users.find((user) => user.email === email);
  expect(actor, `physical-v2 dev actor ${email} is missing`).toBeTruthy();
  return actor!.id;
}

async function readInventoryQuantity(fixture: PhysicalV2Fixture): Promise<number> {
  const { data, error } = await fixture.admin
    .from("inventory_items")
    .select("quantity")
    .eq("id", fixture.inventoryId)
    .single();
  expect(error, error?.message).toBeNull();
  return data!.quantity;
}

async function readBottle(
  fixture: PhysicalV2Fixture,
  bottleId: string,
): Promise<BottleRow> {
  const { data, error } = await fixture.admin
    .from("open_bottles")
    .select("*")
    .eq("restaurant_id", fixture.restaurantId)
    .eq("id", bottleId)
    .single();
  expect(error, error?.message).toBeNull();
  return data!;
}
