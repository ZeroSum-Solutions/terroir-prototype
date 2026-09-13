import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { OperationsLauncher } from "./operations-launcher";

describe("OperationsLauncher", () => {
  it("maps the demo operations to real application routes", () => {
    const html = renderToStaticMarkup(<OperationsLauncher userRole="manager" />);
    for (const href of [
      "/cellar",
      "/atlas",
      "/cellar/open",
      "/bins",
      "/scan",
      "/reconcile-queue",
      "/import",
      "/lists",
      "/price-comparison",
      "/insights",
      "/team",
    ]) expect(html).toContain(`href="${href}"`);
    expect(html).not.toContain('href="#');
  });

  it("keeps management workflows out of the staff launcher", () => {
    const html = renderToStaticMarkup(<OperationsLauncher userRole="staff" />);
    expect(html).not.toContain('href="/import"');
    expect(html).not.toContain('href="/bins"');
    expect(html).not.toContain('href="/reconcile-queue"');
    expect(html).toContain('href="/cellar"');
    expect(html).toContain('href="/scan?mode=bottle"');
    expect(html).toContain('href="/lists"');
    expect(html).toContain('href="/team"');
  });
});
