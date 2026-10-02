#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CONTAINER_ID = /^[0-9a-f]{64}$/;

export function parseJourneyArgs(argv) {
  const values = new Map();
  let headed = false;
  for (const raw of argv) {
    if (raw === "--headed") { headed = true; continue; }
    const match = raw.match(/^--([^=]+)=(.+)$/);
    assert(match, `invalid argument: ${raw}`);
    assert(!values.has(match[1]), `duplicate argument: --${match[1]}`);
    values.set(match[1], match[2]);
  }
  const required = ["ready-json", "project-root", "evidence-dir"];
  for (const key of values.keys()) assert([...required, "viewport-width"].includes(key), `unknown argument: --${key}`);
  for (const key of required) assert(values.has(key), `missing argument: --${key}=...`);
  const result = Object.fromEntries(values);
  for (const key of required) assert(path.isAbsolute(result[key]), `${key} must be absolute`);
  const viewportWidth = Number(result["viewport-width"] ?? 390);
  assert([390, 1200].includes(viewportWidth), "journey viewport must be 390 or 1200");
  return { readyJson: result["ready-json"], projectRoot: result["project-root"], evidenceDir: result["evidence-dir"], headed, viewportWidth };
}

export function safeErrorKind(error) {
  return error instanceof Error && /^[A-Za-z][A-Za-z0-9]*Error$/.test(error.name) ? error.name : "JourneyError";
}

function exactKeys(value, keys, label) {
  assert(value && typeof value === "object" && !Array.isArray(value), `${label} must be an object`);
  assert.deepEqual(Object.keys(value).sort(), [...keys].sort(), `${label} keys changed`);
}

function operationId(request) {
  const value = request.headers()["idempotency-key"];
  assert(UUID.test(value ?? ""), "missing valid Idempotency-Key");
  return value;
}

function validateReady(value) {
  assert.equal(value?.version, 1);
  assert.equal(value?.result, "READY_FOR_PORTABLE_JOURNEY");
  assert(/^terroir-demo-/.test(value.projectId), "READY project is not disposable");
  assert.equal(value.database, "postgres");
  assert(CONTAINER_ID.test(value.databaseContainerId ?? ""), "READY database container is invalid");
  const base = new URL(value.baseURL);
  assert.equal(base.protocol, "http:");
  assert.equal(base.hostname, "127.0.0.1");
  assert(base.port, "READY app port missing");
  const api = new URL(value.apiURL);
  assert.equal(api.protocol, "http:");
  assert.equal(api.hostname, "127.0.0.1");
  for (const key of ["restaurantId", "ownerId", "staffId", "wineId", "staffWineId", "otherRestaurantId", "binId"]) {
    assert(UUID.test(value[key] ?? ""), `READY ${key} is invalid`);
  }
  assert.equal(value.inventorySeedCount, 0);
  assert.equal(value.commandReceiptSeedCount, 0);
  assert.equal(value.glassPourMl, 150);
  assert.equal(value.staffRole, "staff");
  return value;
}

function run(command, args, options = {}) {
  try {
    return execFileSync(command, args, {
      encoding: "utf8", input: options.input, timeout: options.timeout ?? 30_000,
      maxBuffer: 20_000_000,
      stdio: [options.input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
    }).trim();
  } catch { throw new Error(`${path.basename(command)} admission command failed`); }
}

function admitContainer(ready) {
  const inspected = JSON.parse(run("docker", ["inspect", ready.databaseContainerId]));
  assert(Array.isArray(inspected) && inspected.length === 1, "database container identity is ambiguous");
  const container = inspected[0];
  assert.equal(container.Id, ready.databaseContainerId);
  assert.equal(container.Name, `/supabase_db_${ready.projectId}`);
  assert.equal(container.State?.Running, true);
  assert.equal(container.Config?.Labels?.["com.supabase.cli.project"], ready.projectId);
}

function databaseState(ready, operationId = "00000000-0000-4000-8000-000000000000") {
  const args = [
    "exec", "-i", "-e", "PGOPTIONS=-c default_transaction_read_only=on -c statement_timeout=15000 -c lock_timeout=3000",
    ready.databaseContainerId, "psql", "-X", "-qAt", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "postgres",
    "-v", `restaurant_id=${ready.restaurantId}`, "-v", `owner_id=${ready.ownerId}`,
    "-v", `staff_id=${ready.staffId}`, "-v", `wine_id=${ready.wineId}`,
    "-v", `staff_wine_id=${ready.staffWineId}`, "-v", `operation_id=${operationId}`,
  ];
  const output = run("docker", args, { input: String.raw`
select jsonb_build_object(
  'database', current_database(),
  'contractVersion', public.current_inventory_contract_version(),
  'ownerRole', (select role from public.memberships where restaurant_id=:'restaurant_id'::uuid and user_id=:'owner_id'::uuid and status='active'),
  'staffRole', (select role from public.memberships where restaurant_id=:'restaurant_id'::uuid and user_id=:'staff_id'::uuid and status='active'),
  'mainInventory', (select coalesce(jsonb_agg(jsonb_build_object('id',id,'quantity',quantity) order by id),'[]'::jsonb) from public.inventory_items where restaurant_id=:'restaurant_id'::uuid and wine_id=:'wine_id'::uuid),
  'staffInventory', (select coalesce(jsonb_agg(jsonb_build_object('id',id,'quantity',quantity) order by id),'[]'::jsonb) from public.inventory_items where restaurant_id=:'restaurant_id'::uuid and wine_id=:'staff_wine_id'::uuid),
  'mainBottles', (select coalesce(jsonb_agg(jsonb_build_object('id',id,'remainingMl',remaining_ml,'stateVersion',state_version,'closedAt',closed_at) order by id),'[]'::jsonb) from public.open_bottles where restaurant_id=:'restaurant_id'::uuid and wine_id=:'wine_id'::uuid),
  'staffBottles', (select coalesce(jsonb_agg(jsonb_build_object('id',id,'remainingMl',remaining_ml,'stateVersion',state_version,'closedAt',closed_at) order by id),'[]'::jsonb) from public.open_bottles where restaurant_id=:'restaurant_id'::uuid and wine_id=:'staff_wine_id'::uuid),
  'mainEvents', (select count(*) from public.pour_events where restaurant_id=:'restaurant_id'::uuid and wine_id=:'wine_id'::uuid),
  'staffEvents', (select count(*) from public.pour_events where restaurant_id=:'restaurant_id'::uuid and wine_id=:'staff_wine_id'::uuid),
  'receiptCount', (select count(*) from public.inventory_command_receipts where restaurant_id=:'restaurant_id'::uuid),
  'operationReceiptCount', (select count(*) from public.inventory_command_receipts where restaurant_id=:'restaurant_id'::uuid and operation_id=:'operation_id'::uuid)
);` });
  return JSON.parse(output);
}

async function persist(resultPath, result) {
  await writeFile(resultPath, `${JSON.stringify(result, null, 2)}\n`, { mode: 0o600 });
}

async function capturePost(page, pathname, click) {
  const requestPromise = page.waitForRequest((request) => new URL(request.url()).pathname === pathname && request.method() === "POST");
  const responsePromise = page.waitForResponse((response) => new URL(response.url()).pathname === pathname && response.request().method() === "POST");
  const [request, response] = await Promise.all([requestPromise, responsePromise, Promise.resolve().then(click)]);
  return { request, response, body: request.postDataJSON(), payload: await response.json().catch(() => null), operationId: operationId(request) };
}

async function verifyCommittedReplay(page, ready, command) {
  const before = databaseState(ready, command.operationId);
  const headers = { "Idempotency-Key": command.operationId };
  for (const key of ["x-expected-user-id", "x-expected-restaurant-id"]) {
    const value = command.request.headers()[key];
    if (value) headers[key] = value;
  }
  const replay = await page.context().request.post(command.request.url(), { headers, data: command.body });
  assert.equal(replay.status(), command.response.status());
  assert.equal(replay.headers()["idempotency-key"], command.operationId);
  assert.equal(replay.headers()["idempotency-replayed"], "true");
  assert.deepEqual(await replay.json(), command.payload);
  assert.deepEqual(databaseState(ready, command.operationId), before, "replay changed committed inventory or history");
}

async function passwordLogin(page, expect, ready, email, password, expectedActor) {
  await page.goto(`${ready.baseURL}/login?mode=password&next=/cellar`);
  await page.locator("#login-email").fill(email);
  await page.locator("#login-password").fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(`${ready.baseURL}/cellar`);
  const offline = await page.context().request.get(`${ready.baseURL}/api/offline-context`);
  assert.equal(offline.status(), 200);
  const body = await offline.json();
  assert.equal(body?.context?.userId, expectedActor);
  assert.equal(body?.context?.restaurantId, ready.restaurantId);
}

async function receiveBottle(page, expect, ready, wineId, wineName) {
  await page.goto(`${ready.baseURL}/scan-bottle`);
  await page.getByRole("button", { name: "Find wine by name", exact: true }).click();
  await page.locator("#correct-search").fill(wineName);
  const choice = page.getByRole("button").filter({ hasText: wineName }).first();
  await expect(choice).toBeVisible();
  await choice.click();
  await page.getByRole("button", { name: "Confirm", exact: true }).click();
  await page.locator("#bottle-section").fill(ready.section);
  await page.locator("#bottle-bin").selectOption(ready.binId);
  const command = await capturePost(page, "/api/scan-bottle/confirm", () => page.getByRole("button", { name: "Receive 1 bottle", exact: true }).click());
  assert.equal(command.response.status(), 201);
  assert.equal(command.request.headers()["x-expected-user-id"], ready.ownerId);
  assert.equal(command.request.headers()["x-expected-restaurant-id"], ready.restaurantId);
  exactKeys(command.payload, ["version", "kind", "status", "operationId", "inventoryItemId", "wineId", "section", "binId", "binCode", "quantity"], "receive receipt");
  assert.deepEqual(command.payload, { version: 1, kind: "bottle_location_receive", status: "committed", operationId: command.operationId, inventoryItemId: command.payload.inventoryItemId, wineId, section: ready.section, binId: ready.binId, binCode: ready.binCode, quantity: 1 });
  assert(UUID.test(command.payload.inventoryItemId));
  await expect(page.getByRole("heading", { name: "Bottle confirmed", exact: true })).toBeVisible();
  return command;
}

async function selectWine(page, expect, ready, wineId, wineName) {
  await page.goto(`${ready.baseURL}/cellar`);
  const search = page.getByPlaceholder("Search name, producer, region…");
  await expect(search).toBeVisible();
  await search.fill(wineName);
  const row = page.locator(`[data-cellar-row="${wineId}"]`);
  await expect(row).toBeVisible();
  await row.click();
  const drawer = page.getByRole("dialog").filter({ hasText: wineName });
  await expect(drawer).toBeVisible();
  return { row, drawer };
}

async function tabTo(page, target, width) {
  for (let index = 0; index < 60; index += 1) {
    await page.keyboard.press("Tab");
    if (await target.evaluate((element) => document.activeElement === element)) {
      assert(await target.evaluate((element) => element.matches(":focus-visible")), `${width}: focus-visible missing`);
      return index + 1;
    }
  }
  throw new Error(`${width}: keyboard navigation did not reach primary action`);
}

async function main() {
  const args = parseJourneyArgs(process.argv.slice(2));
  const ready = validateReady(JSON.parse(await readFile(args.readyJson, "utf8")));
  const ownerPassword = process.env.TERROIR_DEMO_OWNER_PASSWORD;
  const staffPassword = process.env.TERROIR_DEMO_STAFF_PASSWORD;
  assert(typeof ownerPassword === "string" && ownerPassword.length >= 20, "synthetic owner password missing");
  assert(typeof staffPassword === "string" && staffPassword.length >= 20, "synthetic staff password missing");
  await mkdir(args.evidenceDir, { mode: 0o700 });
  const resultPath = path.join(args.evidenceDir, "journey-result.json");
  const latchPath = path.join(args.evidenceDir, "mutation-latch.json");
  const result = { status: "failed", lastCompletedStep: "source-admission", inFlightMutation: null, projectId: ready.projectId, restaurantId: ready.restaurantId, viewportWidth: args.viewportWidth, screenshots: [] };
  await writeFile(resultPath, `${JSON.stringify(result, null, 2)}\n`, { flag: "wx", mode: 0o600 });
  let browser;
  let page;
  try {
    admitContainer(ready);
    const zero = databaseState(ready);
    assert.deepEqual({ database: zero.database, contractVersion: zero.contractVersion, ownerRole: zero.ownerRole, staffRole: zero.staffRole, mainInventory: zero.mainInventory, staffInventory: zero.staffInventory, mainBottles: zero.mainBottles, staffBottles: zero.staffBottles, mainEvents: zero.mainEvents, staffEvents: zero.staffEvents, receiptCount: zero.receiptCount }, { database: "postgres", contractVersion: 2, ownerRole: "owner", staffRole: "staff", mainInventory: [], staffInventory: [], mainBottles: [], staffBottles: [], mainEvents: 0, staffEvents: 0, receiptCount: 0 });
    const latch = await open(latchPath, "wx", 0o600);
    await latch.writeFile(`${JSON.stringify({ version: 1, status: "armed-from-zero-stock", projectId: ready.projectId, databaseContainerId: ready.databaseContainerId, restaurantId: ready.restaurantId, zeroState: zero }, null, 2)}\n`);
    await latch.close();
    result.lastCompletedStep = "zero-stock-admitted-and-latch-armed";
    await persist(resultPath, result);

    const require = createRequire(path.join(args.projectRoot, "package.json"));
    const { chromium, expect: rawExpect } = require("@playwright/test");
    const expect = rawExpect.configure({ timeout: 20_000 });
    browser = await chromium.launch({ headless: !args.headed });
    const journeyViewport = { viewport: { width: args.viewportWidth, height: 844 }, isMobile: args.viewportWidth < 768, hasTouch: args.viewportWidth < 768 };
    const ownerContext = await browser.newContext(journeyViewport);
    page = await ownerContext.newPage();
    page.setDefaultTimeout(20_000);
    await passwordLogin(page, expect, ready, ready.ownerEmail, ownerPassword, ready.ownerId);
    result.lastCompletedStep = "owner-password-login";

    const mainReceives = [];
    for (let index = 0; index < 2; index += 1) {
      result.inFlightMutation = `receive-main-${index + 1}-of-2`; await persist(resultPath, result);
      mainReceives.push(await receiveBottle(page, expect, ready, ready.wineId, ready.wineName));
      result.inFlightMutation = null; result.lastCompletedStep = `received-main-${index + 1}-of-2`; await persist(resultPath, result);
    }
    assert.notEqual(mainReceives[0].payload.inventoryItemId, mainReceives[1].payload.inventoryItemId);
    result.mainReceiveOperationIds = mainReceives.map((item) => item.operationId);
    result.mainInventoryItemIds = mainReceives.map((item) => item.payload.inventoryItemId);
    await verifyCommittedReplay(page, ready, mainReceives[0]);
    result.receiveReplayVerified = true;
    const mainSurface = await selectWine(page, expect, ready, ready.wineId, ready.wineName);
    result.inFlightMutation = "open-main-bottle"; await persist(resultPath, result);
    const opened = await capturePost(page, "/api/open-bottles", () => mainSurface.drawer.getByRole("button", { name: "Open bottle", exact: true }).click());
    assert.equal(opened.response.status(), 201);
    const mainBottle = opened.payload?.open_bottle;
    assert(UUID.test(mainBottle?.id ?? ""));
    assert.deepEqual({ wineId: mainBottle.wine_id, restaurantId: mainBottle.restaurant_id, remainingMl: mainBottle.remaining_ml, capacityMl: mainBottle.nominal_capacity_ml, stateVersion: mainBottle.state_version, identityContract: mainBottle.identity_contract }, { wineId: ready.wineId, restaurantId: ready.restaurantId, remainingMl: 750, capacityMl: 750, stateVersion: 0, identityContract: 2 });
    assert(mainReceives.some((item) => item.payload.inventoryItemId === mainBottle.source_inventory_item_id));
    result.mainOpenOperationId = opened.operationId; result.openBottleId = mainBottle.id; result.inFlightMutation = null; result.lastCompletedStep = "opened-main-bottle"; await persist(resultPath, result);
    const bottleInput = mainSurface.drawer.locator(`#physical-open-bottle-${mainBottle.id}`);
    await expect(bottleInput).toBeChecked();
    const pourButton = mainSurface.drawer.getByRole("button", { name: /^Pour 5\.1 oz$/ });
    const mainPourOperationIds = [];
    for (const [index, remaining] of [600, 450, 300, 150].entries()) {
      result.inFlightMutation = `pour-main-${index + 1}-of-4`; await persist(resultPath, result);
      const poured = await capturePost(page, "/api/pour", () => pourButton.click());
      assert.equal(poured.response.status(), 200);
      assert.deepEqual(poured.body, { wine_id: ready.wineId, open_bottle_id: mainBottle.id, ml: 150, kind: "pour" });
      assert.equal(poured.payload?.open_bottle?.remaining_ml, remaining);
      assert.equal(poured.payload?.open_bottle?.state_version, index + 1);
      assert(UUID.test(poured.payload?.pour_event_id ?? ""));
      mainPourOperationIds.push(poured.operationId);
      result.mainPourOperationIds = mainPourOperationIds;
      result.inFlightMutation = null; result.lastCompletedStep = `poured-main-${index + 1}-of-4`; await persist(resultPath, result);
      if (index === 0) {
        await verifyCommittedReplay(page, ready, poured);
        result.pourReplayVerified = true;
      }
    }
    await expect(bottleInput.locator("xpath=..")).toContainText("150 of 750 ml");
    const counted = databaseState(ready);
    assert.equal(counted.mainInventory.reduce((sum, item) => sum + item.quantity, 0), 1);
    assert.deepEqual(counted.mainBottles, [{ id: mainBottle.id, remainingMl: 150, stateVersion: 4, closedAt: null }]);
    assert.equal(counted.mainEvents, 5);
    result.countedStock = { sealedBottles: 1, openBottles: 1, measuredRemainingMl: 150 };
    result.lastCompletedStep = "counted-sealed-and-exact-open-stock"; await persist(resultPath, result);
    await mainSurface.drawer.getByRole("button", { name: /^close$/i }).click();
    await page.getByRole("button", { name: "More cellar actions", exact: true }).click();
    await page.getByRole("menu", { name: "More cellar actions", exact: true }).getByRole("menuitem", { name: /^Reconcile 1 open bottle$/ }).click();
    const reconcile = page.getByRole("dialog", { name: /Reconcile open bottles/i });
    const actualVolume = reconcile.locator("li").filter({ hasText: ready.wineName }).first().getByLabel("Actual remaining volume in ml");
    await actualVolume.fill("120");
    await expect(actualVolume).toHaveValue("120");
    await page.screenshot({ path: path.join(args.evidenceDir, "measured-count-before-manager-save.png"), fullPage: true });
    result.screenshots.push("measured-count-before-manager-save.png");
    result.measuredCountMl = 120;
    result.lastCompletedStep = "entered-measured-open-bottle-count"; await persist(resultPath, result);
    result.inFlightMutation = "reconcile-main-to-120"; await persist(resultPath, result);
    const reconciled = await capturePost(page, "/api/reconcile", () => reconcile.getByRole("button", { name: "Save 1 change", exact: true }).click());
    assert.equal(reconciled.response.status(), 200);
    assert.deepEqual(reconciled.body, { entries: [{ open_bottle_id: mainBottle.id, expected_state_version: 4, target_remaining_ml: 120, note: null }] });
    assert.equal(reconciled.payload?.entries?.[0]?.remaining_ml, 120);
    assert.equal(reconciled.payload?.entries?.[0]?.state_version, 5);
    result.reconcileOperationId = reconciled.operationId;
    result.inFlightMutation = null; result.lastCompletedStep = "reconciled-main-to-120"; await persist(resultPath, result);
    await page.goto(`${ready.baseURL}/cellar?wine=${ready.wineId}&bottle=${mainBottle.id}`);
    await page.reload();
    await expect(page.locator(`#physical-open-bottle-${mainBottle.id}`).locator("xpath=..")).toContainText("120 of 750 ml");
    result.lastCompletedStep = "reload-verified-main-120";

    const staffReceives = [];
    for (let index = 0; index < 2; index += 1) {
      result.inFlightMutation = `receive-staff-${index + 1}-of-2`; await persist(resultPath, result);
      staffReceives.push(await receiveBottle(page, expect, ready, ready.staffWineId, ready.staffWineName));
      result.inFlightMutation = null; result.lastCompletedStep = `received-staff-${index + 1}-of-2`; await persist(resultPath, result);
    }
    assert.notEqual(staffReceives[0].payload.inventoryItemId, staffReceives[1].payload.inventoryItemId);
    result.staffReceiveOperationIds = staffReceives.map((item) => item.operationId);
    result.staffInventoryItemIds = staffReceives.map((item) => item.payload.inventoryItemId);
    const staffSurface = await selectWine(page, expect, ready, ready.staffWineId, ready.staffWineName);
    result.inFlightMutation = "open-staff-bottle"; await persist(resultPath, result);
    const staffOpened = await capturePost(page, "/api/open-bottles", () => staffSurface.drawer.getByRole("button", { name: "Open bottle", exact: true }).click());
    const staffBottle = staffOpened.payload?.open_bottle;
    assert(UUID.test(staffBottle?.id ?? ""));
    assert.equal(staffBottle?.remaining_ml, 750);
    assert.equal(staffBottle?.state_version, 0);
    result.staffOpenOperationId = staffOpened.operationId; result.staffBottleId = staffBottle.id; result.inFlightMutation = null; result.lastCompletedStep = "opened-staff-bottle"; await persist(resultPath, result);

    const crossBefore = databaseState(ready);
    const deniedCrossSite = await ownerContext.request.patch(`${ready.baseURL}/api/restaurant/${ready.otherRestaurantId}`, { data: { name: "Cross-site refusal probe" } });
    assert.equal(deniedCrossSite.status(), 403);
    assert.equal((await deniedCrossSite.json())?.error?.code, "forbidden");
    assert.deepEqual(databaseState(ready), crossBefore);
    result.lastCompletedStep = "owner-cross-site-denied-with-conservation"; await persist(resultPath, result);
    await ownerContext.close();

    const freshOwnerContext = await browser.newContext(journeyViewport);
    page = await freshOwnerContext.newPage(); page.setDefaultTimeout(20_000);
    await passwordLogin(page, expect, ready, ready.ownerEmail, ownerPassword, ready.ownerId);
    await page.goto(`${ready.baseURL}/cellar?wine=${ready.wineId}&bottle=${mainBottle.id}`);
    const freshMainBottle = page.locator(`#physical-open-bottle-${mainBottle.id}`);
    await expect(freshMainBottle).toBeChecked();
    await expect(freshMainBottle.locator("xpath=..")).toContainText("120 of 750 ml");
    result.lastCompletedStep = "fresh-owner-login-verified-main-120"; await persist(resultPath, result);
    await freshOwnerContext.close();

    const staffContext = await browser.newContext(journeyViewport);
    page = await staffContext.newPage(); page.setDefaultTimeout(20_000);
    await passwordLogin(page, expect, ready, ready.staffEmail, staffPassword, ready.staffId);
    const staffDrawer = (await selectWine(page, expect, ready, ready.staffWineId, ready.staffWineName)).drawer;
    await staffDrawer.locator(`#physical-open-bottle-${staffBottle.id}`).check();
    result.inFlightMutation = "staff-authorized-pour"; await persist(resultPath, result);
    const staffPour = await capturePost(page, "/api/pour", () => staffDrawer.getByRole("button", { name: /^Pour 5\.1 oz$/ }).click());
    assert.equal(staffPour.response.status(), 200);
    assert.equal(staffPour.payload?.open_bottle?.remaining_ml, 600);
    assert.equal(staffPour.payload?.open_bottle?.state_version, 1);
    result.staffPourOperationId = staffPour.operationId;
    result.inFlightMutation = null; result.lastCompletedStep = "staff-authorized-pour-to-600"; await persist(resultPath, result);
    await page.goto(`${ready.baseURL}/cellar/reconcile`, { waitUntil: "networkidle" });
    assert.equal(new URL(page.url()).pathname, "/cellar");
    const denialOperation = randomUUID();
    const beforeDenial = databaseState(ready, denialOperation);
    const denied = await staffContext.request.post(`${ready.baseURL}/api/reconcile`, { headers: { "Idempotency-Key": denialOperation }, data: { entries: [{ open_bottle_id: mainBottle.id, expected_state_version: 5, target_remaining_ml: 110, note: null }] } });
    assert.equal(denied.status(), 403);
    const afterDenial = databaseState(ready, denialOperation);
    assert.deepEqual(afterDenial, beforeDenial);
    assert.equal(afterDenial.operationReceiptCount, 0);
    result.deniedReconcileOperationId = denialOperation;
    await page.goto(`${ready.baseURL}/cellar?wine=${ready.wineId}&bottle=${mainBottle.id}`);
    const roleDrawer = page.getByRole("dialog").filter({ hasText: ready.wineName });
    await expect(roleDrawer.getByLabel("Per-wine pour cost target")).toHaveCount(0);
    await expect(roleDrawer.getByLabel("Per-wine markup ratio target")).toHaveCount(0);
    result.lastCompletedStep = "staff-reconcile-and-cost-controls-denied"; await persist(resultPath, result);
    await staffContext.close();

    const viewportObservations = [];
    for (const width of [320, 390, 768, 1200]) {
      const context = await browser.newContext({ viewport: { width, height: 900 }, isMobile: width < 768, hasTouch: width < 768 });
      page = await context.newPage(); page.setDefaultTimeout(20_000);
      await passwordLogin(page, expect, ready, ready.ownerEmail, ownerPassword, ready.ownerId);
      await page.goto(`${ready.baseURL}/cellar?wine=${ready.staffWineId}&bottle=${staffBottle.id}`, { waitUntil: "networkidle" });
      await expect(page.locator(`#physical-open-bottle-${staffBottle.id}`)).toBeChecked();
      const drawer = page.getByRole("dialog").filter({ has: page.locator("#wine-detail-heading") });
      await expect(drawer.locator("#wine-detail-heading")).toContainText(ready.staffWineName);
      const buttons = [];
      for (const label of ["Open another bottle", "Pour 5.1 oz"]) {
        const button = drawer.getByRole("button", { name: label, exact: true });
        await expect(button).toBeVisible(); await expect(button).toBeEnabled();
        const box = await button.boundingBox(); assert(box && box.width >= 44 && box.height >= 44);
        assert(box.x >= 0 && box.x + box.width <= width + 1);
        buttons.push({ label, width: box.width, height: box.height });
      }
      const primary = drawer.getByRole("button", { name: "Open another bottle", exact: true });
      const tabCount = await tabTo(page, primary, width);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
      assert.equal(overflow, false);
      const site = page.locator('[data-active-site-context="true"]');
      await expect(site).toHaveAttribute("aria-label", "Active restaurant: Portable Restaurant Demo");
      await expect(site.getByText("Local", { exact: true })).toBeVisible();
      if (width === 320) await expect(page.getByRole("button", { name: "Ask about your cellar" })).toBeHidden();
      if (width === 768) {
        await expect(page.locator('nav[aria-label="Primary"]')).toBeHidden();
        await expect(page.getByRole("navigation", { name: "Primary mobile", exact: true })).toBeVisible();
      }
      if (width === 1200) {
        await expect(page.locator('nav[aria-label="Primary"]')).toBeVisible();
        await expect(page.locator('nav[aria-label="Primary mobile"]')).toBeHidden();
      }
      const screenshot = `viewport-${width}.png`;
      await page.screenshot({ path: path.join(args.evidenceDir, screenshot), fullPage: true });
      result.screenshots.push(screenshot);
      viewportObservations.push({ width, overflow, tabCount, buttons });
      await context.close();
    }
    result.viewportObservations = viewportObservations;
    result.lastCompletedStep = "all-viewports-captured";
    result.status = "passed";
  } catch (error) {
    result.error = `${safeErrorKind(error)} at ${result.lastCompletedStep}${result.inFlightMutation ? ` with ${result.inFlightMutation} in flight` : ""}`;
    if (page && !page.isClosed()) await page.screenshot({ path: path.join(args.evidenceDir, "failure.png"), fullPage: true }).catch(() => {});
    process.exitCode = 1;
  } finally {
    if (browser) await browser.close().catch(() => { result.status = "failed"; result.error = "BrowserCleanupError"; process.exitCode = 1; });
    await persist(resultPath, result);
    process.stdout.write(`${JSON.stringify(result)}\n`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(() => {
    process.stderr.write("portable journey refused before an owned result could be reserved\n");
    process.exitCode = 1;
  });
}
