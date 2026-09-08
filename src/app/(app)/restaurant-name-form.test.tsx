import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { RestaurantNameForm } from "./restaurant-name-form";

const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.clearAllMocks();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); vi.unstubAllGlobals(); });

it.each([false, true])("keeps the restaurant name and allows retry after an HTTP or network failure (%s)", async (network) => {
  const fetcher = network ? vi.fn().mockRejectedValue(new Error("offline")) : vi.fn().mockResolvedValue({ ok: false });
  vi.stubGlobal("fetch", fetcher);
  await act(async () => root.render(<RestaurantNameForm restaurantId="restaurant-1" initialName="Osteria Scala" onboarding />));
  await act(async () => container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
  expect(container.querySelector('[role="alert"]')?.textContent).toContain("try again");
  expect(container.querySelector("input")!.value).toBe("Osteria Scala");
  expect(container.querySelector("button")!.disabled).toBe(false);
  expect(router.push).not.toHaveBeenCalled();
  fetcher.mockResolvedValue({ ok: true });
  await act(async () => container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
  expect(router.push).toHaveBeenCalledWith("/get-started");
});

it("submits once while a save is pending and sends the trimmed name", async () => {
  let finish!: (value: { ok: boolean }) => void;
  const fetcher = vi.fn(() => new Promise((resolve) => { finish = resolve; }));
  vi.stubGlobal("fetch", fetcher);
  await act(async () => root.render(<RestaurantNameForm restaurantId="restaurant-1" initialName="  Scala  " />));
  await act(async () => {
    const form = container.querySelector("form")!;
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(fetcher.mock.calls[0]).toEqual(["/api/restaurant/restaurant-1", expect.objectContaining({ body: JSON.stringify({ name: "Scala" }) })]);
  expect(container.querySelector("input")!.disabled).toBe(true);
  await act(async () => finish({ ok: true }));
  expect(container.querySelector('[role="status"]')?.textContent).toContain("saved");
  expect(router.push).not.toHaveBeenCalled();
});
