import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ScanInventoryList } from "./scan-inventory-list";

const item = {
  id: "inventory-a",
  wineId: "wine-a",
  quantity: 2,
  unitCost: 42,
  name: "Reserve",
  producer: "House",
  vintage: 2020,
  heroImageUrl: null,
  colour: "red",
};

describe("ScanInventoryList", () => {
  it("labels hidden inventory cost as restricted without serializing the value", () => {
    const html = renderToStaticMarkup(
      <ScanInventoryList items={[item]} costRestricted />,
    );

    expect(html).toContain("Cost restricted");
    expect(html).not.toContain("$42.00");
  });

  it("renders inventory cost for an authorized protected read", () => {
    const html = renderToStaticMarkup(<ScanInventoryList items={[item]} />);

    expect(html).toContain("$42.00");
    expect(html).not.toContain("Cost restricted");
  });
});
