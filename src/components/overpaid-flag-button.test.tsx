import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

const { OverpaidFlagButton } = await import("./overpaid-flag-button");

describe("OverpaidFlagButton touch target", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("is at least 44px square", () => {
    const html = renderToStaticMarkup(
      <OverpaidFlagButton wineId="wine-1" flagged={false} />,
    );

    expect(html).toContain("min-h-11");
    expect(html).toContain("min-w-11");
  });

  it("posts the explicit next flag value", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const fetch = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetch);

    await act(async () => {
      root.render(<OverpaidFlagButton wineId="wine-1" flagged={false} />);
    });
    await act(async () => {
      container.querySelector<HTMLButtonElement>("button")!.click();
    });

    expect(fetch).toHaveBeenCalledWith("/api/wines/wine-1/overpaid", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ flag: true }),
    });
    act(() => root.unmount());
    container.remove();
  });
});
