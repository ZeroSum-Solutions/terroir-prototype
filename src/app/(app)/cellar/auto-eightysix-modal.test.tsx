import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

const { AutoEightysixModal } = await import("./auto-eightysix-modal");

function render(canManagePricingTargets: boolean) {
  return renderToStaticMarkup(
    <AutoEightysixModal
      open
      restaurantId="restaurant-1"
      enabled={false}
      thresholdMl={148}
      eightysixStrategy="hide"
      defaultTargetPourCostPct={null}
      defaultTargetMarkupRatio={null}
      canManagePricingTargets={canManagePricingTargets}
      onClose={vi.fn()}
    />,
  );
}

describe("AutoEightysixModal pricing privacy", () => {
  it("keeps non-pricing settings but omits synthetic target controls without authority", () => {
    const html = render(false);
    expect(html).toContain("Auto-86");
    expect(html).not.toContain("House pricing targets");
  });

  it("renders target controls after the caller proves readable management authority", () => {
    expect(render(true)).toContain("House pricing targets");
  });
});
