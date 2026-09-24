import { expect, type Locator, type Page } from "@playwright/test";

const STATUS_MAX_WIDTH_PX = 32 * 16;
const STATUS_SIDE_PADDING_PX = 24 * 2;
const MIN_READABLE_STATUS_WIDTH_PX = 240;

export async function observeDuplicateCookieNavigation(page: Page, cookieName: string) {
  const markerCookiesBefore = await markerCookieSnapshot(page, cookieName);
  const navigationPromise = page.waitForRequest((request) => (
    request.isNavigationRequest() && new URL(request.url()).pathname === "/cellar"
  ));
  const [, navigationRequest] = await Promise.all([page.goto("/cellar"), navigationPromise]);
  const response = await navigationRequest.response();
  if (!response) throw new Error("The original /cellar navigation produced no response.");
  const cookieHeader = (await navigationRequest.allHeaders()).cookie ?? "";
  return {
    location: await response.headerValue("location"),
    markerCookiesAfter: await markerCookieSnapshot(page, cookieName),
    markerCookiesBefore,
    markerValues: cookieHeader
      .split(/;\s*/)
      .filter((pair) => pair.startsWith(`${cookieName}=`))
      .map((pair) => pair.slice(cookieName.length + 1)),
    responseSetCookieCount: (await response.headerValues("set-cookie")).length,
    status: response.status(),
  };
}

export async function assertRetrySurface(page: Page): Promise<void> {
  const retry = page.getByRole("button", { name: "Retry sign-out" });
  await expect(retry).toBeVisible();
  const box = await retry.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.height).toBeGreaterThanOrEqual(44);
  expect(box!.width).toBeGreaterThanOrEqual(44);
  await expectSingleLine(retry);
  await retry.focus();
  await expect(retry).toBeFocused();
}

export async function assertVisualSafety(page: Page): Promise<void> {
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
  ).toBe(true);

  const status = page.getByRole("status");
  if (!(await status.isVisible())) return;
  const viewport = page.viewportSize();
  const mainBox = await page.locator("main").boundingBox();
  const statusBox = await status.boundingBox();
  expect(viewport).not.toBeNull();
  expect(mainBox).not.toBeNull();
  expect(statusBox).not.toBeNull();
  expect(mainBox!.width).toBeGreaterThanOrEqual(
    Math.min(viewport!.width, STATUS_MAX_WIDTH_PX) - 1,
  );
  expect(statusBox!.width).toBeGreaterThanOrEqual(
    Math.min(MIN_READABLE_STATUS_WIDTH_PX, mainBox!.width - STATUS_SIDE_PADDING_PX),
  );
  await expectSingleLine(page.getByRole("heading", { name: "Signing out" }));
}

async function expectSingleLine(locator: Locator): Promise<void> {
  expect(await locator.evaluate((element) => {
    const range = document.createRange();
    range.selectNodeContents(element);
    return range.getClientRects().length;
  })).toBe(1);
}

async function markerCookieSnapshot(page: Page, cookieName: string) {
  return (await page.context().cookies())
    .filter((cookie) => cookie.name === cookieName)
    .map(({ domain, name, path, value }) => ({ domain, name, path, value }))
    .sort((left, right) => left.path.localeCompare(right.path));
}
