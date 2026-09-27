import { act, type ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, click, mount } from "@/test/render";
import { LocationView } from "./location-view";

afterEach(cleanup);
const binId = "11111111-1111-4111-8111-111111111111";
const props: ComponentProps<typeof LocationView> = {
  wine: { id: "wine-1", producer: "Producer", name: "Wine", vintage: 2022, varietal: null, region: null, country: null },
  section: "Red Room", binId, bins: { status: "ready", bins: [{ id: binId, code: "A-1" }] },
  onReloadBins: vi.fn(), locationError: null, onSectionChange: vi.fn(), onBinSelect: vi.fn(),
  onSubmit: vi.fn(), onBack: vi.fn(), confirming: false,
};
describe("LocationView", () => {
  it("requires an explicit active bin ID and a section", async () => {
    for (const change of [{ section: "" }, { binId: "" }, { binId: "A-1" }]) {
      const view = await mount(<LocationView {...props} {...change} />);
      expect(view.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(true);
    }
  });
  it("receives one bottle only when a real active bin is selected", async () => {
    const view = await mount(<LocationView {...props} />);
    const submit = view.querySelector<HTMLButtonElement>('button[type="submit"]');
    expect(submit?.disabled).toBe(false);
    expect(submit?.textContent).toContain("Receive 1 bottle");
    expect(view.querySelector<HTMLSelectElement>("#bottle-bin")?.value).toBe(binId);
    expect([...view.querySelectorAll<HTMLOptionElement>("#bottle-bin option")].find((option) => option.selected)?.textContent).toBe("A-1");
  });
  it("shows refused saves beside preserved section and selection", async () => {
    const view = await mount(<LocationView {...props} locationError="Bin unavailable." />);
    expect(view.querySelector('[role="alert"]')?.textContent).toBe("Bin unavailable.");
    expect(view.querySelector<HTMLInputElement>("#bottle-section")?.value).toBe("Red Room");
    expect(view.querySelector<HTMLSelectElement>("#bottle-bin")?.value).toBe(binId);
    expect(view.textContent).not.toContain("Lookup failed");
  });
  it("does not force the mobile keyboard open and uses 48px primary controls", async () => {
    const view = await mount(<LocationView {...props} />);
    expect(view.querySelector("[autofocus]")).toBeNull();
    for (const selector of ["#bottle-section", "#bottle-bin", 'button[type="submit"]']) {
      expect(view.querySelector(selector)?.className).toContain("h-12");
    }
  });
  it("disables navigation and editing while saving", async () => {
    const view = await mount(<LocationView {...props} confirming />);
    expect(view.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(true);
    expect(view.querySelector("#bottle-section")).toHaveProperty("disabled", true);
    expect(view.querySelector("#bottle-bin")).toHaveProperty("disabled", true);
    expect([...view.querySelectorAll("button")].every((button) => button.disabled)).toBe(true);
    expect(view.textContent).toContain("Saving...");
  });
  it.each(["loading", "error", "ready"] as const)("blocks receiving with %s bin state and no options", async (status) => {
    const view = await mount(<LocationView {...props} bins={{ status, bins: [] }} binId="" />);
    expect(view.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(true);
    expect(view.textContent).toContain(status === "loading" ? "Loading active bins" : status === "error" ? "could not be loaded" : "No active bins");
  });
  it("refreshes bins without submitting a receipt", async () => {
    const onReloadBins = vi.fn(), onSubmit = vi.fn();
    const view = await mount(<LocationView {...props} onReloadBins={onReloadBins} onSubmit={onSubmit} />);
    await click([...view.querySelectorAll("button")].find((button) => button.textContent === "Refresh bins")!);
    expect(onReloadBins).toHaveBeenCalledOnce();
    expect(onSubmit).not.toHaveBeenCalled();
  });
  it("selecting a bin does not submit", async () => {
    const onBinSelect = vi.fn(), onSubmit = vi.fn();
    const view = await mount(<LocationView {...props} binId="" onBinSelect={onBinSelect} onSubmit={onSubmit} />);
    const select = view.querySelector<HTMLSelectElement>("#bottle-bin")!;
    await act(async () => { select.value = binId; select.dispatchEvent(new Event("change", { bubbles: true })); });
    expect(onBinSelect).toHaveBeenCalledWith(binId);
    expect(onSubmit).not.toHaveBeenCalled();
  });
  it("shows honest recovery context when wine metadata is unavailable", async () => {
    const view = await mount(<LocationView {...props} wine={null} />);
    expect(view.textContent).toContain("Pending wine selection retained");
  });
});
