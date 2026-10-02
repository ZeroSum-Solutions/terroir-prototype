import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, click, mount } from "@/test/render";
import type { useBottleLocationReceive } from "@/domains/scanning/use-bottle-location-receive";
import ScanBottleClient from "./scan-bottle-client";

const mocks = vi.hoisted(() => ({ restaurantId: "22222222-2222-4222-8222-222222222222", scanner: vi.fn(), receive: vi.fn(), bins: vi.fn() }));
vi.mock("@/lib/context/restaurant", () => ({ useRestaurant: () => ({ restaurantId: mocks.restaurantId }) }));
vi.mock("./use-qr-scanner", () => ({ useQrScanner: (...args: unknown[]) => mocks.scanner(...args) }));
vi.mock("./use-active-bins", () => ({ useActiveBins: () => mocks.bins() }));
vi.mock("@/domains/scanning/use-bottle-location-receive", () => ({ useBottleLocationReceive: (input: unknown) => mocks.receive(input) }));
const wine = { id: "33333333-3333-4333-8333-333333333333", producer: "Producer", name: "Wine", vintage: 2022, varietal: null, region: null, country: null };
const binId = "44444444-4444-4444-8444-444444444444";
const userId = "11111111-1111-4111-8111-111111111111";
let hook: ReturnType<typeof useBottleLocationReceive>;
let input: Parameters<typeof useBottleLocationReceive>[0];
beforeEach(() => {
  vi.clearAllMocks();
  hook = { state: { phase: "empty" }, isSaving: false, save: vi.fn(), retry: vi.fn(), recheck: vi.fn(), message: null };
  mocks.receive.mockImplementation((value) => { input = value; return hook; });
  mocks.bins.mockReturnValue({ status: "ready", bins: [{ id: binId, code: "A-1" }], reload: vi.fn() });
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(wine)));
});
afterEach(async () => { await cleanup(); vi.unstubAllGlobals(); });
async function lookup() { await act(async () => { await mocks.scanner.mock.calls.at(-1)![2](wine.id); }); }
function button(view: HTMLElement, label: string) { return [...view.querySelectorAll("button")].find((entry) => entry.textContent?.trim() === label)!; }
async function field(view: HTMLElement, selector: string, value: string) {
  await act(async () => {
    const element = view.querySelector<HTMLInputElement | HTMLSelectElement>(selector)!;
    const prototype = element instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(element, value);
    element.dispatchEvent(new Event(element instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
  });
}
describe("receiving screen integration", () => {
  it("binds receiving to the signed-in user and active restaurant", async () => {
    await mount(<ScanBottleClient userId={userId} />);
    expect(input).toMatchObject({ userId, restaurantId: mocks.restaurantId });
  });
  it.each(["checking", "blocked"] as const)("gates the entire form while recovery is %s", async (phase) => {
    hook.state = phase === "checking" ? { phase } : { phase, reason: "corrupt" };
    const view = await mount(<ScanBottleClient userId={userId} />);
    expect(view.querySelector("form")).toBeNull();
    expect(view.textContent).not.toContain("Find wine by name");
    expect(mocks.scanner.mock.calls.at(-1)![1]).toBe(false);
    expect(view.textContent).not.toMatch(/abandon|discard/i);
  });
  it("offers wine-name discovery without requiring a QR code", async () => {
    const view = await mount(<ScanBottleClient userId={userId} />);
    await click(button(view, "Find wine by name"));
    expect(view.querySelector('input[type="search"]')).not.toBeNull();
    expect(hook.save).not.toHaveBeenCalled();
  });
  it("sends only wine ID, normalized section and explicitly selected bin ID", async () => {
    const view = await mount(<ScanBottleClient userId={userId} />); await lookup();
    const matchedButton = [...view.querySelectorAll("button")].find((entry) => /confirm/i.test(entry.textContent ?? ""))!;
    await click(matchedButton);
    await field(view, "#bottle-section", " Main Cellar "); await field(view, "#bottle-bin", binId);
    await act(async () => { view.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
    expect(hook.save).toHaveBeenCalledExactlyOnceWith({ wine_id: wine.id, section: "Main Cellar", bin_id: binId });
  });
  it("counts a validated recovered receipt once and displays its actual saved bin", async () => {
    const view = await mount(<ScanBottleClient userId={userId} />);
    const receipt = { version: 1, kind: "bottle_location_receive", status: "committed", operationId: "55555555-5555-4555-8555-555555555555", inventoryItemId: "66666666-6666-4666-8666-666666666666", wineId: wine.id, section: "Cellar", binId, binCode: "A-1", quantity: 1 } as const;
    await act(async () => { input.onCommitted(receipt); input.onCommitted(receipt); });
    expect(view.textContent).toContain("1 bottle received");
    expect(view.textContent).toContain("Recovered bottle receipt");
    expect(view.textContent).toContain("A-1");
    expect(view.querySelector("a")?.getAttribute("href")).toBe(`/cellar/${wine.id}`);
  });
  it("preserves recovery intent but requires a new explicit bin choice", async () => {
    const view = await mount(<ScanBottleClient userId={userId} />);
    await act(async () => input.onReselect({ wine_id: wine.id, section: "Cellar" }));
    expect(view.querySelector<HTMLInputElement>("#bottle-section")?.value).toBe("Cellar");
    expect(view.querySelector<HTMLSelectElement>("#bottle-bin")?.value).toBe("");
    expect(view.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(true);
    expect(hook.save).not.toHaveBeenCalled();
  });
  it("returns a missing wine to explicit search without losing the section or sending another receipt", async () => {
    const view = await mount(<ScanBottleClient userId={userId} />);
    await act(async () => input.onWineReselect("Cellar"));
    expect(view.textContent).toContain("Nothing was received");
    expect(view.querySelector('input[type="search"]')).not.toBeNull();
    expect(hook.save).not.toHaveBeenCalled();
    await lookup();
    const confirm = [...view.querySelectorAll("button")].find((entry) => /confirm/i.test(entry.textContent ?? ""))!;
    await click(confirm);
    expect(view.querySelector<HTMLInputElement>("#bottle-section")?.value).toBe("Cellar");
    expect(view.querySelector<HTMLSelectElement>("#bottle-bin")?.value).toBe("");
  });
  it("clears the submittable receiving form when recovery disappears in another tab", async () => {
    const view = await mount(<ScanBottleClient userId={userId} />);
    await act(async () => input.onReselect({ wine_id: wine.id, section: "Cellar" }));
    await field(view, "#bottle-bin", binId);
    expect(view.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(false);
    await act(async () => input.onRecoveryCleared());
    expect(view.querySelector("#bottle-bin")).toBeNull();
    expect(view.querySelector('button[type="submit"]')).toBeNull();
    expect(hook.save).not.toHaveBeenCalled();
  });
});
