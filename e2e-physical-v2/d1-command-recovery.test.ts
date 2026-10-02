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
type CommandPayload = {
  open_bottle?: CommandBottle;
  pour_event_id?: string;
};
type CommandCapture = {
  body: Record<string, unknown>;
  operationId: string;
  payload: CommandPayload;
  response: Response;
};
type PourAttempt = {
  body: Record<string, unknown>;
  operationId: string;
  payload: CommandPayload;
  rawBody: string;
  replayed: string | undefined;
  responseOperationId: string | undefined;
  status: number;
};

test.describe("D1 physical bottle command recovery", () => {
  test.describe.configure({ mode: "serial" });
  let fixture: PhysicalV2Fixture;

  test.beforeAll(async () => {
    fixture = await createPhysicalV2Fixture();
  });

  test("replays a committed lost-response pour against its original bottle exactly once", async ({
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
      await expect(page.locator(`[data-cellar-row="${fixture.wineId}"]`)).toBeVisible();
    }).toPass({ timeout: 20_000 });

    await page.locator(`[data-cellar-row="${fixture.wineId}"]`).click();
    const drawer = page.getByRole("dialog").filter({ hasText: fixture.wineName });
    await expect(drawer).toBeVisible();

    const firstOpen = await clickCommand(
      page,
      drawer.getByRole("button", { name: "Open bottle", exact: true }),
      "/api/open-bottles",
    );
    const bottleA = requireOpenedBottle(firstOpen, fixture);
    const secondOpen = await clickCommand(
      page,
      drawer.getByRole("button", { name: "Open another bottle", exact: true }),
      "/api/open-bottles",
    );
    const bottleB = requireOpenedBottle(secondOpen, fixture);
    expect(bottleB.id).not.toBe(bottleA.id);

    const bottleAInput = drawer.locator(`#physical-open-bottle-${bottleA.id}`);
    const bottleBInput = drawer.locator(`#physical-open-bottle-${bottleB.id}`);
    await expect(bottleAInput).toBeVisible();
    await expect(bottleBInput).toBeVisible();
    await bottleAInput.check();
    await expect(bottleAInput).toBeChecked();
    await expect(page).toHaveURL(new RegExp(`bottle=${bottleA.id}`));

    const beforeA = await readBottle(fixture, bottleA.id);
    const beforeB = await readBottle(fixture, bottleB.id);
    expect(beforeA).toMatchObject({
      remaining_ml: 750,
      state_version: 0,
      opening_operation_id: firstOpen.operationId,
    });
    expect(beforeB).toMatchObject({
      remaining_ml: 750,
      state_version: 0,
      opening_operation_id: secondOpen.operationId,
    });
    expect(firstOpen.payload.open_bottle).not.toHaveProperty("opening_operation_id");
    expect(secondOpen.payload.open_bottle).not.toHaveProperty("opening_operation_id");
    const sealedAfterOpen = await readInventoryQuantity(fixture);
    expect(sealedAfterOpen).toBe(0);

    const attempts: PourAttempt[] = [];
    await page.route(
      (url) => url.pathname === "/api/pour",
      async (route) => {
        const request = route.request();
        const rawBody = request.postData();
        if (!rawBody) throw new Error("physical pour request body is missing");
        const response = await route.fetch();
        attempts.push({
          body: request.postDataJSON() as Record<string, unknown>,
          operationId: readOperationId(request),
          payload: await response.json() as CommandPayload,
          rawBody,
          replayed: response.headers()["idempotency-replayed"],
          responseOperationId: response.headers()["idempotency-key"],
          status: response.status(),
        });
        if (attempts.length === 1) {
          await route.abort("connectionreset");
          return;
        }
        await route.fulfill({ response });
      },
    );

    await drawer.getByRole("button", { name: /^Pour 5\.1 oz$/ }).click();
    const retry = drawer.getByRole("button", { name: "Retry prior pour" });
    await expect(retry).toBeVisible();
    await expect(drawer.getByRole("alert")).toContainText(
      "Pour not confirmed. This may already be recorded. " +
        "Retry the prior action to check; do not pour again.",
    );
    await expect(page.getByText("Glass poured", { exact: true })).toHaveCount(0);
    await expect(page.getByText("Pour failed", { exact: true })).toHaveCount(0);

    expect(attempts).toHaveLength(1);
    const committedAttempt = attempts[0];
    expect(committedAttempt).toMatchObject({
      body: {
        wine_id: fixture.wineId,
        open_bottle_id: bottleA.id,
        ml: 150,
        kind: "pour",
      },
      replayed: "false",
      responseOperationId: committedAttempt.operationId,
      status: 200,
    });
    expect(committedAttempt.payload.open_bottle).toMatchObject({
      id: bottleA.id,
      wine_id: fixture.wineId,
      remaining_ml: 600,
      state_version: beforeA.state_version + 1,
    });
    expect(committedAttempt.payload.open_bottle).not.toHaveProperty("opening_operation_id");
    expect(committedAttempt.payload.pour_event_id).toMatch(UUID_PATTERN);

    const committedA = await readBottle(fixture, bottleA.id);
    expect(committedA).toMatchObject({
      id: bottleA.id,
      remaining_ml: 600,
      state_version: committedAttempt.payload.open_bottle!.state_version,
      opening_operation_id: firstOpen.operationId,
    });
    expect(await readBottle(fixture, bottleB.id)).toEqual(beforeB);
    expect(await readInventoryQuantity(fixture)).toBe(sealedAfterOpen);

    // The visible selection may change while the outcome is unresolved. The
    // retained retry must still use A's frozen UUID and payload, not current B.
    await bottleBInput.check();
    await expect(bottleBInput).toBeChecked();
    await expect(bottleAInput).not.toBeChecked();
    await expect(page).toHaveURL(new RegExp(`bottle=${bottleB.id}`));

    await retry.click();
    await expect(page.getByRole("status").filter({ hasText: "Already recorded" }))
      .toBeVisible();
    await expect.poll(() => attempts.length).toBe(2);

    const replayAttempt = attempts[1];
    expect(replayAttempt.operationId).toBe(committedAttempt.operationId);
    expect(replayAttempt.responseOperationId).toBe(committedAttempt.operationId);
    expect(replayAttempt.rawBody).toBe(committedAttempt.rawBody);
    expect(replayAttempt.body).toEqual(committedAttempt.body);
    expect(replayAttempt.payload).toEqual(committedAttempt.payload);
    expect(replayAttempt.status).toBe(200);
    expect(replayAttempt.replayed).toBe("true");

    const finalA = await readBottle(fixture, bottleA.id);
    const finalB = await readBottle(fixture, bottleB.id);
    expect(finalA).toEqual(committedA);
    expect(finalA).toMatchObject({ remaining_ml: 600, closed_at: null });
    expect(finalB).toEqual(beforeB);
    expect(finalB).toMatchObject({ remaining_ml: 750, state_version: 0, closed_at: null });
    expect(await readInventoryQuantity(fixture)).toBe(sealedAfterOpen);

    const [receipts, events, effects] = await Promise.all([
      fixture.admin.from("inventory_command_receipts").select("*")
        .eq("restaurant_id", fixture.restaurantId)
        .eq("operation_id", committedAttempt.operationId),
      fixture.admin.from("pour_events").select("*")
        .eq("restaurant_id", fixture.restaurantId)
        .eq("operation_id", committedAttempt.operationId),
      fixture.admin.from("inventory_command_bottle_effects").select("*")
        .eq("restaurant_id", fixture.restaurantId)
        .eq("operation_id", committedAttempt.operationId),
    ]);
    expect(receipts.error, receipts.error?.message).toBeNull();
    expect(events.error, events.error?.message).toBeNull();
    expect(effects.error, effects.error?.message).toBeNull();
    expect(receipts.data).toHaveLength(1);
    expect(events.data).toHaveLength(1);
    expect(effects.data).toHaveLength(1);
    expect(receipts.data![0]).toMatchObject({
      command_type: "pour",
      command_version: 2,
      operation_id: committedAttempt.operationId,
      restaurant_id: fixture.restaurantId,
      wine_id: fixture.wineId,
      completed_at: expect.any(String),
      request_payload: expect.objectContaining({
        command: "pour",
        ml: 150,
        open_bottle_id: bottleA.id,
        wine_id: fixture.wineId,
      }),
      result_payload: expect.objectContaining({
        command: "pour",
        operation_id: committedAttempt.operationId,
        open_bottle: committedAttempt.payload.open_bottle,
        pour_event_ids: [committedAttempt.payload.pour_event_id],
      }),
    });
    expect(events.data![0]).toMatchObject({
      id: committedAttempt.payload.pour_event_id,
      event_contract: 2,
      kind: "pour",
      ml_delta: 150,
      open_bottle_id: bottleA.id,
      operation_entry_ordinal: 0,
      operation_id: committedAttempt.operationId,
      wine_id: fixture.wineId,
    });
    expect(effects.data![0]).toEqual({
      effect_type: "pour",
      entry_ordinal: 0,
      open_bottle_id: bottleA.id,
      operation_id: committedAttempt.operationId,
      restaurant_id: fixture.restaurantId,
      wine_id: fixture.wineId,
    });

    await page.reload();
    const reloadedDrawer = page.getByRole("dialog").filter({ hasText: fixture.wineName });
    await expect(reloadedDrawer).toBeVisible();
    await expect(reloadedDrawer.locator(`#physical-open-bottle-${bottleA.id}`).locator("xpath=.."))
      .toContainText("600 of 750 ml");
    await expect(reloadedDrawer.locator(`#physical-open-bottle-${bottleB.id}`).locator("xpath=.."))
      .toContainText("750 of 750 ml");
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
  const payload = await response.json().catch(() => null) as CommandPayload | null;
  expect(response.ok(), JSON.stringify(payload)).toBeTruthy();
  expect(payload).not.toBeNull();
  return {
    body: request.postDataJSON() as Record<string, unknown>,
    operationId: readOperationId(request),
    payload: payload!,
    response,
  };
}

function readOperationId(request: Request): string {
  const operationId = request.headers()["idempotency-key"];
  expect(operationId).toMatch(UUID_PATTERN);
  return operationId;
}

function requireOpenedBottle(
  command: CommandCapture,
  fixture: PhysicalV2Fixture,
): CommandBottle {
  expect(command.response.status()).toBe(201);
  expect(command.body).toEqual({
    wine_id: fixture.wineId,
    preservation_method: "none",
  });
  const bottle = command.payload.open_bottle;
  expect(bottle).toMatchObject({
    restaurant_id: fixture.restaurantId,
    wine_id: fixture.wineId,
    remaining_ml: 750,
    nominal_capacity_ml: 750,
    state_version: 0,
  });
  expect(bottle?.id).toMatch(UUID_PATTERN);
  return bottle!;
}

async function readInventoryQuantity(fixture: PhysicalV2Fixture): Promise<number> {
  const { data, error } = await fixture.admin.from("inventory_items").select("quantity")
    .eq("id", fixture.inventoryId).single();
  expect(error, error?.message).toBeNull();
  return data!.quantity;
}

async function readBottle(
  fixture: PhysicalV2Fixture,
  bottleId: string,
): Promise<BottleRow> {
  const { data, error } = await fixture.admin.from("open_bottles").select("*")
    .eq("restaurant_id", fixture.restaurantId).eq("id", bottleId).single();
  expect(error, error?.message).toBeNull();
  return data!;
}
