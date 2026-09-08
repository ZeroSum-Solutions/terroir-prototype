import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ReconcileModal } from "./reconcile-modal";
import type { OpenBottleRow } from "@/lib/wine-list/shapes";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
const item: OpenBottleRow = { wine_id: "wine-1", wine_list_item_id: "item-1", producer: "Producer", name: "Wine", vintage: 2020, size_ml: 750, sealed_count: 2, opened_at: "2026-09-08T12:00:00Z", open_remaining_ml: 500, glass_pour_ml: 150, pour_size_mode: "fixed" };
let container: HTMLDivElement;
let root: Root;
const close = vi.fn();
beforeEach(async () => {
  close.mockClear();
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  await act(async () => root.render(<ReconcileModal open items={[item]} onClose={close} />));
});
afterEach(() => { act(() => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
function click(label: string) {
  const button = [...container.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.getAttribute("aria-label") === label || b.textContent === label);
  if (!button) throw new Error(`Missing ${label}`);
  act(() => button.click());
}

it("requires a discard decision for dirty counts and keeps edits when cancelled", () => {
  click("Half"); click("Close reconcile mode");
  expect(close).not.toHaveBeenCalled();
  expect(container.textContent).toContain("Discard unsaved counts?");
  click("Keep counting");
  expect(container.querySelector<HTMLInputElement>('input[type="number"]')!.value).toBe("375");
  click("Close reconcile mode"); click("Discard changes");
  expect(close).toHaveBeenCalledTimes(1);
});

it("blocks closing and editing while saving; retains failed counts and reports successful retry", async () => {
  let finish!: (response: unknown) => void;
  const fetcher = vi.fn(() => new Promise((resolve) => { finish = resolve; }));
  vi.stubGlobal("fetch", fetcher);
  click("Half"); click("Save 1 change");
  expect(container.querySelector("fieldset")!.disabled).toBe(true);
  click("Close reconcile mode");
  expect(close).not.toHaveBeenCalled();
  expect(fetcher).toHaveBeenCalledTimes(1);
  await act(async () => finish({ ok: false, status: 503, json: async () => ({ error: { message: "Try again" } }) }));
  expect(container.querySelector('[role="alert"]')?.textContent).toBe("Try again");
  expect(container.querySelector<HTMLInputElement>('input[type="number"]')!.value).toBe("375");
  click("Save 1 change");
  await act(async () => finish({ ok: true }));
  expect(container.querySelector('[role="status"]')?.textContent).toContain("1 bottle reconciled");
  click("Close reconcile mode");
  expect(close).toHaveBeenCalledTimes(1);
});
