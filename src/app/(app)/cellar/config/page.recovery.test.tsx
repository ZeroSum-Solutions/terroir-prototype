import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ back: vi.fn(), refresh: vi.fn() }) }));
const { default: Page } = await import("./page");
const sections = [{ id: "red", name: "Reds" }, { id: "white", name: "Whites" }];
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const environment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
let previousAct: boolean | undefined;
let root: Root;
let container: HTMLDivElement;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  previousAct = environment.IS_REACT_ACT_ENVIRONMENT;
  environment.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  fetchMock = vi.fn().mockImplementation(async (_url, options) => options?.method === "PATCH"
    ? response({ error: { message: "Could not save sections." } }, 500)
    : response({ labels: { sections } }));
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  environment.IS_REACT_ACT_ENVIRONMENT = previousAct;
  vi.unstubAllGlobals();
});
const mount = () => act(async () => root.render(<Page />));
const button = (label: string) => container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
const textButton = (text: string) => [...container.querySelectorAll<HTMLButtonElement>("button")]
  .find((b) => b.textContent?.trim() === text)!;
async function type(input: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
const names = () => [...container.querySelectorAll("li span")].map((n) => n.textContent);

describe("section save recovery", () => {
  it("disables editing after load failure and lets staff retry loading first", async () => {
    fetchMock.mockResolvedValueOnce(response({}, 500));
    await mount();
    expect(container.querySelector<HTMLInputElement>('input[placeholder^="New section"]')!.disabled).toBe(true);
    expect(textButton("Add").disabled).toBe(true);
    await act(async () => textButton("Retry loading sections").click());
    expect(names()).toEqual(["Reds", "Whites"]);
    expect(fetchMock.mock.calls.filter(([, options]) => options?.method === "PATCH")).toHaveLength(0);
  });

  it("retains an unsaved new section name, then clears it only after success", async () => {
    await mount();
    const input = container.querySelector<HTMLInputElement>('input[placeholder^="New section"]')!;
    await type(input, "Reserve");
    await act(async () => textButton("Add").click());
    expect(input.value).toBe("Reserve");
    expect(names()).toEqual(["Reds", "Whites"]);
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("Could not save sections.");
    fetchMock.mockResolvedValueOnce(response({}));
    await act(async () => textButton("Add").click());
    expect(input.value).toBe("");
    expect(names()).toEqual(["Reds", "Whites", "Reserve"]);
  });

  it("retains a failed rename draft instead of closing the editor", async () => {
    await mount();
    await act(async () => button("Rename Reds").click());
    await type(container.querySelector<HTMLInputElement>("li input")!, "Red cellar");
    await act(async () => button("Save rename").click());
    expect(container.querySelector<HTMLInputElement>("li input")?.value).toBe("Red cellar");
    fetchMock.mockResolvedValueOnce(response({}));
    await act(async () => button("Save rename").click());
    expect(container.querySelector("li input")).toBeNull();
    expect(names()).toEqual(["Red cellar", "Whites"]);
  });

  it("keeps the saved order when keyboard reordering fails", async () => {
    await mount();
    await act(async () => button("Drag to reorder Reds").dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
    ));
    expect(names()).toEqual(["Reds", "Whites"]);
    expect(fetchMock.mock.calls[1][1].body).toContain('"section_order":["white","red"]');
  });

  it("keeps a failed deletion open with its error and original section intact", async () => {
    await mount();
    await act(async () => button("Delete Reds").click());
    await act(async () => textButton("Delete").click());
    expect(container.querySelector('[role="dialog"] [role="alert"]')?.textContent).toContain("Could not save sections.");
    expect(names()).toEqual(["Reds", "Whites"]);
  });

  it("blocks overlapping rename, reorder and cancel actions while saving", async () => {
    await mount();
    await act(async () => button("Rename Reds").click());
    await type(container.querySelector<HTMLInputElement>("li input")!, "Red cellar");
    let resolve!: (value: Response) => void;
    fetchMock.mockImplementationOnce(() => new Promise<Response>((done) => { resolve = done; }));
    await act(async () => button("Save rename").click());
    expect(button("Save rename").disabled).toBe(true);
    expect(button("Cancel rename").disabled).toBe(true);
    expect(button("Drag to reorder Whites").disabled).toBe(true);
    expect(container.querySelector<HTMLInputElement>("li input")!.disabled).toBe(true);
    await act(async () => button("Drag to reorder Whites").dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }),
    ));
    expect(fetchMock.mock.calls.filter(([, options]) => options?.method === "PATCH")).toHaveLength(1);
    await act(async () => resolve(response({})));
    expect(names()).toEqual(["Red cellar", "Whites"]);
  });
});
