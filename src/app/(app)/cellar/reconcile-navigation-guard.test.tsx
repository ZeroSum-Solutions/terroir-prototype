import { act } from "react";
import Link from "next/link";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ReconcileNavigationGuard } from "./reconcile-navigation-guard";

const router = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
let root: Root;
let container: HTMLDivElement;
const discard = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); });
async function render(busy: boolean) {
  await act(async () => root.render(<><Link href="/cellar">Back</Link><ReconcileNavigationGuard dirty busy={busy} onDiscard={discard} /></>));
}
function navigate() {
  const event = new MouseEvent("click", { bubbles: true, cancelable: true });
  act(() => container.querySelector("a")!.dispatchEvent(event));
  return event;
}
it("requires confirmation before discarding through an in-app link", async () => {
  await render(false);
  expect(navigate().defaultPrevented).toBe(true);
  expect(discard).not.toHaveBeenCalled();
  const buttons = [...container.querySelectorAll("button")];
  act(() => buttons.find((b) => b.textContent === "Keep counting")!.click());
  expect(discard).not.toHaveBeenCalled();
  navigate();
  act(() => [...container.querySelectorAll("button")].find((b) => b.textContent === "Discard and leave")!.click());
  expect(discard).toHaveBeenCalledOnce();
  expect(router.push).toHaveBeenCalledWith("/cellar");
});
it("blocks in-app navigation during an active save without offering discard", async () => {
  await render(true);
  expect(navigate().defaultPrevented).toBe(true);
  expect(container.querySelector('[role="dialog"]')).toBeNull();
  expect(discard).not.toHaveBeenCalled();
});
it("warns before unloading a dirty modal and removes the warning after save", async () => {
  await act(async () => root.render(<ReconcileNavigationGuard dirty busy={false} interceptLinks={false} onDiscard={discard} />));
  const dirtyEvent = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(dirtyEvent);
  expect(dirtyEvent.defaultPrevented).toBe(true);
  await act(async () => root.render(<ReconcileNavigationGuard dirty={false} busy={false} interceptLinks={false} onDiscard={discard} />));
  const cleanEvent = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(cleanEvent);
  expect(cleanEvent.defaultPrevented).toBe(false);
});
