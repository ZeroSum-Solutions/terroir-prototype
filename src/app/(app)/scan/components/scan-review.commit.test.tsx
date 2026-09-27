import { renderToStaticMarkup } from "react-dom/server";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import type { LineItem } from "@/lib/scanner/types";

vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

const { ScanReview } = await import("./scan-review");

/**
 * SD-39 — a scan whose extraction produced nothing still rendered an enabled
 * "Commit to Inventory" button, and `handleCommit` early-returns on
 * `items.length === 0`. Pressing it did nothing at all: no request, no
 * message, no state change. Export CSV was already hidden for exactly this
 * condition; the primary action now says the same thing.
 */
function markup(items: LineItem[]): string {
  return renderToStaticMarkup(
    <ScanReview
      id="scan-1"
      distributor="Reliable Distribution"
      invoiceNumber="INV-1"
      invoiceDate="2026-08-21"
      expectedUpdatedAt="2026-09-26T12:00:00.000Z"
      accuracy={98}
      itemCount={items.length}
      createdAt="2026-08-21T00:00:00.000Z"
      items={items}
      hasImage={false}
    />,
  );
}

const oneItem: LineItem[] = [
  {
    id: "item-1",
    name: "Reserve Red",
    producer: "House Producer",
    vintage: 2022,
    varietal: "Cabernet Sauvignon",
    region: "Napa Valley",
    qty: 6,
    unitCost: 18,
    confidence: 0.98,
  },
];

describe("ScanReview commit affordance", () => {
  it("offers Commit to Inventory when there is something to commit", () => {
    const html = markup(oneItem);
    expect(html).toContain("Commit to Inventory");
    expect(html).toContain("Export CSV");
  });

  it("offers no Commit button on a scan with zero line items", () => {
    const html = markup([]);
    expect(html).not.toContain("Commit to Inventory");
    // The comparator the inventory named: Export CSV already hid itself for
    // the same condition, and still does.
    expect(html).not.toContain("Export CSV");
  });

  it("sends the displayed revision and invoice metadata when saving edits", async () => {
    const matchedItems = [{
      ...oneItem[0],
      wine_id: "33333333-3333-4333-8333-333333333333",
    }];
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      scanId: "11111111-1111-4111-8111-111111111111",
      status: "complete",
      itemCount: 1,
      updated: true,
    }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => root.render(
      <ScanReview
        id="11111111-1111-4111-8111-111111111111"
        distributor="Reliable Distribution"
        invoiceNumber="INV-1"
        invoiceDate="2026-08-21"
        expectedUpdatedAt="2026-09-26T12:00:00.000Z"
        accuracy={98}
        itemCount={1}
        createdAt="2026-08-21T00:00:00.000Z"
        items={matchedItems}
        hasImage={false}
      />,
    ));
    const save = [...container.querySelectorAll("button")]
      .find((button) => button.textContent?.includes("Save Edits"));
    await act(async () => save?.click());

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/scans/11111111-1111-4111-8111-111111111111",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({
          expectedUpdatedAt: "2026-09-26T12:00:00.000Z",
          distributor: "Reliable Distribution",
          invoiceNumber: "INV-1",
          invoiceDate: "2026-08-21",
          items: matchedItems,
          edits: {},
        }),
      }),
    );

    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });
});
