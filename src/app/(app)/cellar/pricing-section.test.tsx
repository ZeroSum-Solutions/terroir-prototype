import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

const { PricingSection } = await import("./pricing-section");
const { baseRow } = await import("./test-row");

describe("PricingSection", () => {
  it("renders the lightweight fallback line when there are no list prices", () => {
    const html = renderToStaticMarkup(
      <PricingSection
        row={baseRow({ retail_median: 40, current_bottle_price: null, current_glass_price: null })}
        canManage={false}
      />,
    );
    expect(html).toContain("no list prices set");
    expect(html).not.toContain("card-surface");
  });

  it("renders the full card with glass and bottle rows when prices exist", () => {
    const html = renderToStaticMarkup(
      <PricingSection
        row={baseRow({
          retail_median: 40,
          current_bottle_price: 65,
          current_glass_price: 14,
          glass_pour_ml: 150,
        })}
        canManage={false}
      />,
    );
    expect(html).toContain("$14.00");
    expect(html).toContain("$65.00");
    expect(html).toContain("/ bottle");
  });

  it("does not render cost-derived margin cues without both cost.read and margin.read", () => {
    const row = baseRow({
      retail_median: 40,
      current_bottle_price: 65,
      current_glass_price: 10,
      glass_pour_ml: 150,
      current_unit_cost: 100,
    });
    const withoutCost = renderToStaticMarkup(
      <PricingSection
        row={row}
        canManage={true}
        canReadCost={false}
        canReadMargin={true}
      />,
    );
    const withoutMargin = renderToStaticMarkup(
      <PricingSection
        row={row}
        canManage={true}
        canReadCost={true}
        canReadMargin={false}
      />,
    );
    const withBoth = renderToStaticMarkup(
      <PricingSection
        row={row}
        canManage={false}
        canReadCost={true}
        canReadMargin={true}
      />,
    );

    expect(withoutCost).not.toContain("Outlier");
    expect(withoutCost).not.toContain("aria-label=\"Pricing position\"");
    expect(withoutCost).not.toContain("linear-gradient");
    expect(withoutMargin).not.toContain("Outlier");
    expect(withoutMargin).not.toContain("aria-label=\"Pricing position\"");
    expect(withoutMargin).not.toContain("linear-gradient");
    expect(withBoth).toContain("Outlier");
    expect(withBoth).toContain("linear-gradient");
  });

  it("requires legacy mutation eligibility plus margin.read and pricing.manage during cutover", () => {
    const row = baseRow({ retail_median: 40, current_bottle_price: 65 });
    const legacyManagerOnly = renderToStaticMarkup(
      <PricingSection row={row} canManage={true} canManagePricing={false} />,
    );
    const delegatedStaff = renderToStaticMarkup(
      <PricingSection
        row={row}
        canManage={false}
        canReadMargin={true}
        canManagePricing={true}
      />,
    );
    const managerWithoutMarginRead = renderToStaticMarkup(
      <PricingSection row={row} canManage={true} canManagePricing={true} />,
    );
    const authorizedManager = renderToStaticMarkup(
      <PricingSection
        row={row}
        canManage={true}
        canReadMargin={true}
        canManagePricing={true}
      />,
    );

    expect(delegatedStaff).toBe(legacyManagerOnly);
    expect(managerWithoutMarginRead).toBe(legacyManagerOnly);
    expect(authorizedManager.length).toBeGreaterThan(legacyManagerOnly.length);
  });
});
