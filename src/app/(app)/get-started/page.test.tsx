import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import GetStartedPage from "./page";

const mocks = vi.hoisted(() => ({ getAuthContext: vi.fn() }));
vi.mock("@/lib/auth-context", () => mocks);
vi.mock("../restaurant-name-form", () => ({ RestaurantNameForm: () => <div>Rename restaurant control</div> }));

it.each(["owner", "manager", "staff"])("gives %s appropriate setup and service destinations", async (userRole) => {
  mocks.getAuthContext.mockResolvedValue({ userRole, restaurantId: "restaurant-1", restaurantName: "Scala" });
  const html = renderToStaticMarkup(await GetStartedPage());
  expect(html).toContain('/cellar?mode=pour');
  expect(html).toContain('/cellar?mode=eightysix');
  expect(html).toContain('/cellar/open');
  expect(html).toContain('not a full count of sealed stock');
  if (userRole === "staff") {
    expect(html).not.toContain('href="/import"');
    expect(html).not.toContain('href="/cellar/reconcile"');
  } else {
    expect(html).toContain('href="/import"');
    expect(html).toContain('href="/cellar/reconcile"');
    expect(html).toContain('href="/bins"');
  }
  expect(html.includes('href="/team"')).toBe(userRole === "owner");
  expect(html.includes('Rename restaurant control')).toBe(userRole === "owner");
});
