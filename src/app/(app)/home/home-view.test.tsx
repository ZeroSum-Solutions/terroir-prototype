import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { HomeView, type HomeRole } from "./home-view";

const snapshot = {
  bottleCount: 1284,
  openBottleCount: 4,
  reviewCount: 5,
  unbinnedBottleCount: 12,
  eightysixedCount: 7,
};

function render(role: HomeRole) {
  document.body.innerHTML = renderToStaticMarkup(
    <HomeView restaurantName="Osteria Scala" role={role} snapshot={snapshot} />,
  );
}

describe("HomeView", () => {
  it("renders live summary values with the authenticated restaurant", () => {
    render("manager");

    expect(document.body.textContent).toContain("Osteria Scala");
    expect(document.body.textContent).toContain("1,284");
    expect(document.body.textContent).toContain("Awaiting a bin12");
  });

  it.each([
    ["owner", "Read insights", "/insights"],
    ["manager", "Receive an invoice", "/scan"],
    ["staff", "Open bottles", "/cellar/open"],
  ] as const)("uses real, role-appropriate destinations for %s", (role, label, href) => {
    render(role);
    const link = [...document.querySelectorAll("a")].find((item) => item.textContent?.includes(label));
    expect(link?.getAttribute("href")).toBe(href);
  });

  it("does not present the view perspective as authorization", () => {
    render("staff");
    expect(document.body.textContent).toContain("without changing your access");
    expect(document.body.textContent).not.toContain("Director view");
  });
});
