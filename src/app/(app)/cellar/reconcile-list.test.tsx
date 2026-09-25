import { act } from "react";
import Link from "next/link";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ML_PER_OZ } from "@/lib/units";
import type { OpenBottleRow } from "@/lib/wine-list/shapes";
import { readReconcileDraft, reconcileDraftKey, writeReconcileDraft } from "@/lib/reconcile-draft/draft-storage";
import { formatPhysicalBottleId } from "@/domains/pours/physical-bottle-command";
import type { PhysicalReconcileItem } from "@/domains/cellar/reconcile-contract";

vi.mock("next/navigation", () => ({
  // `push` is exercised by ReconcileNavigationGuard's discard-confirm flow.
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

const { ReconcileList } = await import("./reconcile-list");

const RESTAURANT_ID = "restaurant-1";
const USER_ID = "user-1";
// Every render in this file uses the same (restaurant, user) identity unless
// a test explicitly says otherwise — draft-storage.test.ts owns the
// exhaustive tenant-isolation coverage.
const ids = { restaurantId: RESTAURANT_ID, userId: USER_ID };

const item: OpenBottleRow = {
  wine_id: "wine-1",
  wine_list_item_id: "item-1",
  producer: "Test Producer",
  name: "Test Wine",
  vintage: 2022,
  size_ml: 750,
  sealed_count: 0,
  opened_at: "2026-08-20T12:00:00.000Z",
  open_remaining_ml: 110,
  glass_pour_ml: 148,
  pour_size_mode: "fixed",
};
const BOTTLE_A = "00000000-0000-4000-8000-00000000000f";
const BOTTLE_B = "00000000-0000-4000-8000-000000000010";
const OPERATION_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const physicalItems: PhysicalReconcileItem[] = [BOTTLE_A, BOTTLE_B].map((id, index) => ({
  openBottleId: id,
  wineId: "11111111-1111-4111-8111-111111111111",
  producer: "Test Producer",
  name: "Sibling Wine",
  vintage: 2022,
  nominalCapacityMl: 750,
  remainingMl: index === 0 ? 500 : 400,
  openedAt: "2026-09-24T12:00:00.000Z",
  preservationMethod: "none",
  sourceProvenance: "known",
  sourceBinLocation: index === 0 ? "A1" : "A2",
  stateVersion: index + 3,
}));

let container: HTMLDivElement;
let root: Root;

function mockSessionStorage(overrides: Partial<Storage>) {
  const actual = window.sessionStorage;
  const storage: Storage = {
    get length() { return actual.length; },
    clear: actual.clear.bind(actual),
    getItem: actual.getItem.bind(actual),
    key: actual.key.bind(actual),
    removeItem: actual.removeItem.bind(actual),
    setItem: actual.setItem.bind(actual),
    ...overrides,
  };
  return vi.spyOn(window, "sessionStorage", "get").mockReturnValue(storage);
}

beforeEach(() => {
  sessionStorage.clear();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function setInputValueOn(container: HTMLElement, ml: number) {
  const input = container.querySelector<HTMLInputElement>(
    'input[aria-label="Actual remaining volume in ml"]',
  )!;
  setInputValue(input, ml);
}

describe("ReconcileList variance presentation", () => {
  it("keeps reconciliation form controls at least 44px tall", async () => {
    await act(async () => root.render(<ReconcileList initialItems={[item]} {...ids} />));
    const actual = container.querySelector<HTMLInputElement>(
      'input[aria-label="Actual remaining volume in ml"]',
    )!;
    const note = container.querySelector<HTMLInputElement>(
      'input[placeholder="spill, miscount, etc."]',
    )!;

    expect(actual.className).toContain("h-11");
    expect(note.className).toContain("h-11");
  });

  it("opens the wine from the row's name", async () => {
    await act(async () => root.render(<ReconcileList initialItems={[item]} {...ids} />));
    const link = container.querySelector<HTMLAnchorElement>(
      'a[href="/cellar?wine=wine-1"]',
    );
    expect(link).not.toBeNull();
    expect(link?.textContent).toContain("Test Producer");
    expect(link?.className).toContain("min-h-11");
  });

  it.each([
    {
      name: "subthreshold over",
      expected: 110,
      actual: 130,
      copy: varianceCopy(20, "over expected"),
      badgeTone: "bg-ready-wash",
      rowClasses: [],
    },
    {
      name: "subthreshold under",
      expected: 110,
      actual: 90,
      copy: varianceCopy(-20, "under expected"),
      badgeTone: "bg-risk-wash",
      rowClasses: [],
    },
    {
      name: "exact",
      expected: 110,
      actual: 110,
      copy: varianceCopy(0, "exact"),
      badgeTone: "bg-wash",
      rowClasses: [],
    },
    {
      name: "zero expected without a flagged card",
      expected: 0,
      actual: 20,
      copy: varianceCopy(20, "over expected"),
      badgeTone: "bg-ready-wash",
      rowClasses: [],
    },
    {
      name: "flagged over",
      expected: 110,
      actual: 170,
      copy: varianceCopy(60, "over expected"),
      badgeTone: "bg-ready-wash",
      rowClasses: ["border-l-2", "border-ready-ink", "bg-ready-wash"],
    },
    {
      name: "flagged under",
      expected: 110,
      actual: 50,
      copy: varianceCopy(-60, "under expected"),
      badgeTone: "bg-risk-wash",
      rowClasses: ["border-l-2", "border-risk-ink", "bg-risk-wash"],
    },
  ])("renders $name truthfully", async ({ expected, actual, copy, badgeTone, rowClasses }) => {
    const fixture = { ...item, open_remaining_ml: expected };
    await act(async () => root.render(<ReconcileList initialItems={[fixture]} {...ids} />));
    const input = container.querySelector<HTMLInputElement>(
      'input[aria-label="Actual remaining volume in ml"]',
    )!;
    // Enter a distinct value first so exact state has pending input to present.
    if (actual === expected) setInputValue(input, expected + 1);
    setInputValue(input, actual);
    const badge = findElementByText(container, copy);
    expect(badge.className).toContain(badgeTone);
    const row = badge.closest("li")!;
    for (const className of rowClasses) expect(row.className).toContain(className);
    // The rows are hairline-divided index entries now, not cards, so the left
    // margin flag is the ONLY thing separating a flagged row from an ordinary
    // one. Assert its absence explicitly: without this, the four subthreshold
    // cases would pass just as happily against a row that shouted.
    if (rowClasses.length === 0) expect(row.className).not.toContain("border-l-2");
  });
});

describe("ReconcileList draft persistence (Back/Forward safety net)", () => {
  it("persists a draft across an unmount/remount cycle — the Back/Forward simulation", async () => {
    await act(async () => root.render(<ReconcileList initialItems={[item]} {...ids} />));
    setInputValueOn(container, 200);

    // Unmounting and remounting IS what Back/Forward does to this component.
    act(() => root.unmount());
    container.remove();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => root.render(<ReconcileList initialItems={[item]} {...ids} />));

    const input = container.querySelector<HTMLInputElement>(
      'input[aria-label="Actual remaining volume in ml"]',
    )!;
    expect(input.value).toBe("200");
    expect(container.textContent).toContain("Restored 1 unsaved count");
  });

  it("clears the persisted draft on a successful save", async () => {
    let finish!: (response: unknown) => void;
    vi.stubGlobal("fetch", vi.fn(() => new Promise((resolve) => { finish = resolve; })));
    await act(async () => root.render(<ReconcileList initialItems={[item]} {...ids} />));
    setInputValueOn(container, 200);
    expect(readReconcileDraft(RESTAURANT_ID, USER_ID).kind).toBe("restored");

    const saveButton = [...container.querySelectorAll("button")].find((b) => b.textContent?.startsWith("Save"))!;
    act(() => saveButton.click());
    await act(async () => finish({ ok: true }));

    expect(readReconcileDraft(RESTAURANT_ID, USER_ID)).toEqual({ kind: "none" });
  });

  it("keeps the persisted draft when a save fails", async () => {
    let finish!: (response: unknown) => void;
    vi.stubGlobal("fetch", vi.fn(() => new Promise((resolve) => { finish = resolve; })));
    await act(async () => root.render(<ReconcileList initialItems={[item]} {...ids} />));
    setInputValueOn(container, 200);

    const saveButton = [...container.querySelectorAll("button")].find((b) => b.textContent?.startsWith("Save"))!;
    act(() => saveButton.click());
    await act(async () => finish({ ok: false, status: 500, json: async () => ({}) }));

    expect(readReconcileDraft(RESTAURANT_ID, USER_ID).kind).toBe("restored");
  });

  it("clears the persisted draft when ReconcileNavigationGuard's discard is confirmed", async () => {
    function Wrapper() {
      return (
        <>
          <Link href="/cellar">Back</Link>
          <ReconcileList initialItems={[item]} {...ids} />
        </>
      );
    }
    await act(async () => root.render(<Wrapper />));
    setInputValueOn(container, 200);
    expect(readReconcileDraft(RESTAURANT_ID, USER_ID).kind).toBe("restored");

    act(() =>
      container.querySelector("a")!.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true }),
      ),
    );
    const discardButton = [...container.querySelectorAll("button")].find(
      (b) => b.textContent === "Discard and leave",
    )!;
    act(() => discardButton.click());

    expect(readReconcileDraft(RESTAURANT_ID, USER_ID)).toEqual({ kind: "none" });
  });

  it("renders and stays usable when sessionStorage throws on every access", async () => {
    const getSpy = vi
      .spyOn(Storage.prototype, "getItem")
      .mockImplementation(() => { throw new Error("SecurityError"); });
    const setSpy = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => { throw new Error("SecurityError"); });

    await act(async () => root.render(<ReconcileList initialItems={[item]} {...ids} />));
    setInputValueOn(container, 200);
    const input = container.querySelector<HTMLInputElement>(
      'input[aria-label="Actual remaining volume in ml"]',
    )!;
    expect(input.value).toBe("200");

    getSpy.mockRestore();
    setSpy.mockRestore();
  });
});

describe("ReconcileList physical bottle mode", () => {
  it("renders identical-wine siblings as separate stable bottle rows", async () => {
    await act(async () => root.render(
      <ReconcileList initialItems={physicalItems} inventoryContractVersion={2} {...ids} />,
    ));

    expect(container.querySelectorAll("li")).toHaveLength(2);
    for (const bottle of physicalItems) {
      const identity = container.querySelector(`[data-physical-bottle-id="${bottle.openBottleId}"]`);
      expect(identity?.textContent).toBe(formatPhysicalBottleId(bottle.openBottleId));
      expect(identity?.closest("li")?.textContent).toContain(bottle.sourceBinLocation);
    }
  });

  it("retries one frozen UUID and byte-identical payload after loss, reorder, and remount", async () => {
    vi.spyOn(globalThis.crypto, "randomUUID").mockReturnValue(OPERATION_ID);
    const fetcher = vi.fn()
      .mockRejectedValueOnce(new Error("response lost"))
      .mockImplementationOnce(async (_url: string, init: RequestInit) => {
        const operationId = new Headers(init.headers).get("Idempotency-Key")!;
        const body = JSON.parse(String(init.body)) as { entries: Array<{
          open_bottle_id: string;
          expected_state_version: number;
          target_remaining_ml: number;
        }> };
        return {
          ok: true,
          headers: new Headers({
            "Idempotency-Key": operationId,
            "Idempotency-Replayed": "true",
          }),
          json: async () => ({
            operation_id: operationId,
            command: "reconcile_batch",
            entries: body.entries.map((entry, index) => ({
              entry_ordinal: index,
              open_bottle_id: entry.open_bottle_id,
              wine_id: physicalItems[0].wineId,
              pour_event_id: `${index + 3}3333333-3333-4333-8333-333333333333`,
              remaining_ml: entry.target_remaining_ml,
              state_version: entry.expected_state_version + 1,
            })),
          }),
        };
      });
    vi.stubGlobal("fetch", fetcher);
    await act(async () => root.render(
      <ReconcileList initialItems={physicalItems} inventoryContractVersion={2} {...ids} />,
    ));
    const rowA = container.querySelector(`[data-physical-bottle-id="${BOTTLE_A}"]`)!.closest("li")!;
    const rowB = container.querySelector(`[data-physical-bottle-id="${BOTTLE_B}"]`)!.closest("li")!;
    setInputValue(rowA.querySelector('input[type="number"]')!, 111);
    setInputValue(rowB.querySelector('input[type="number"]')!, 222);
    const save = [...container.querySelectorAll("button")].find((button) => button.textContent === "Save 2 changes")!;
    await act(async () => save.click());

    const firstInit = fetcher.mock.calls[0][1] as RequestInit;
    const firstPayload = String(firstInit.body);
    expect(new Headers(firstInit.headers).get("Idempotency-Key")).toBe(OPERATION_ID);
    expect(readReconcileDraft(RESTAURANT_ID, USER_ID, 2)).toMatchObject({
      kind: "restored-physical",
      draft: { frozenOperation: { operationId: OPERATION_ID, payload: firstPayload } },
    });

    act(() => root.unmount());
    container.remove();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    const refreshed = [...physicalItems].reverse().map((bottle) => ({ ...bottle, stateVersion: 99 }));
    await act(async () => root.render(
      <ReconcileList initialItems={refreshed} inventoryContractVersion={2} {...ids} />,
    ));
    const actualStorage = window.sessionStorage;
    const setItem = vi.fn((key: string, value: string) => actualStorage.setItem(key, value));
    mockSessionStorage({ setItem });
    await act(async () => root.render(
      <ReconcileList initialItems={[]} inventoryContractVersion={2} {...ids} />,
    ));
    const retry = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "Retry prior reconciliation",
    )!;
    expect(container.querySelector("fieldset")?.hasAttribute("disabled")).toBe(true);
    await act(async () => retry.click());

    const retryInit = fetcher.mock.calls[1][1] as RequestInit;
    expect(String(retryInit.body)).toBe(firstPayload);
    expect(new Headers(retryInit.headers).get("Idempotency-Key")).toBe(OPERATION_ID);
    expect(setItem).toHaveBeenCalledWith(reconcileDraftKey(RESTAURANT_ID, USER_ID), expect.any(String));
    expect(JSON.parse(setItem.mock.calls[0][1]).frozenOperation).toEqual({
      operationId: OPERATION_ID,
      payload: firstPayload,
    });
    expect(readReconcileDraft(RESTAURANT_ID, USER_ID, 2)).toEqual({ kind: "none" });
    await act(async () => root.render(
      <ReconcileList initialItems={refreshed} inventoryContractVersion={2} {...ids} />,
    ));
    expect(container.querySelector('[role="status"]')?.textContent).toContain("2 bottles reconciled");
    expect(container.textContent).not.toContain("Retry prior reconciliation");
  });

  it("retains the frozen draft when a successful HTTP response is incomplete", async () => {
    vi.spyOn(globalThis.crypto, "randomUUID").mockReturnValue(OPERATION_ID);
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      headers: new Headers({
        "Idempotency-Key": OPERATION_ID,
        "Idempotency-Replayed": "false",
      }),
      json: async () => ({ operation_id: OPERATION_ID, command: "reconcile_batch", entries: [] }),
    })));
    await act(async () => root.render(
      <ReconcileList initialItems={[physicalItems[0]]} inventoryContractVersion={2} {...ids} />,
    ));
    setInputValueOn(container, 123);
    const save = [...container.querySelectorAll("button")].find((button) => button.textContent === "Save 1 change")!;
    await act(async () => save.click());

    expect(container.querySelector('[role="alert"]')?.textContent).toContain("could not be verified");
    expect(readReconcileDraft(RESTAURANT_ID, USER_ID, 2)).toMatchObject({
      kind: "restored-physical",
      draft: { frozenOperation: { operationId: OPERATION_ID } },
    });
  });

  it("removes a restored Undo exit as soon as an operation becomes unresolved", async () => {
    vi.spyOn(globalThis.crypto, "randomUUID").mockReturnValue(OPERATION_ID);
    writeReconcileDraft(RESTAURANT_ID, USER_ID, {
      version: 2,
      entries: { [BOTTLE_A]: {
        expectedStateVersion: physicalItems[0].stateVersion,
        targetRemainingMl: 123,
        note: null,
      } },
      frozenOperation: null,
    });
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("response lost")));
    await act(async () => root.render(
      <ReconcileList initialItems={[physicalItems[0]]} inventoryContractVersion={2} {...ids} />,
    ));
    expect(container.textContent).toContain("Restored 1 unsaved count");
    expect(container.textContent).toContain("Undo");
    const save = [...container.querySelectorAll("button")].find((button) => button.textContent === "Save 1 change")!;
    await act(async () => save.click());

    expect(container.textContent).toContain("Retry prior reconciliation");
    expect(container.textContent).not.toContain("Undo");
    expect(readReconcileDraft(RESTAURANT_ID, USER_ID, 2)).toMatchObject({
      kind: "restored-physical",
      draft: { frozenOperation: { operationId: OPERATION_ID } },
    });
  });

  it.each(["setItem", "getItem"] as const)(
    "does not POST when retry-safe %s persistence fails",
    async (method) => {
      const fetcher = vi.fn();
      vi.stubGlobal("fetch", fetcher);
      await act(async () => root.render(
        <ReconcileList initialItems={[physicalItems[0]]} inventoryContractVersion={2} {...ids} />,
      ));
      setInputValueOn(container, 123);
      const storage = mockSessionStorage({ [method]: () => {
        throw new Error("storage unavailable");
      } });
      const save = [...container.querySelectorAll("button")].find((button) => button.textContent === "Save 1 change")!;
      await act(async () => save.click());

      expect(fetcher).not.toHaveBeenCalled();
      expect(container.querySelector('[role="alert"]')?.textContent).toContain("was not sent");
      expect(container.textContent).not.toContain("Retry prior reconciliation");
      expect(container.querySelector("fieldset")?.hasAttribute("disabled")).toBe(false);
      storage.mockRestore();
    },
  );

  it("keeps a frozen retry and sends nothing when re-persistence fails", async () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    const payload = JSON.stringify({ entries: [{
      open_bottle_id: BOTTLE_A,
      expected_state_version: physicalItems[0].stateVersion,
      target_remaining_ml: 123,
      note: null,
    }] });
    writeReconcileDraft(RESTAURANT_ID, USER_ID, {
      version: 2,
      entries: { [BOTTLE_A]: {
        expectedStateVersion: physicalItems[0].stateVersion,
        targetRemainingMl: 123,
        note: null,
      } },
      frozenOperation: { operationId: OPERATION_ID, payload },
    });
    await act(async () => root.render(
      <ReconcileList initialItems={[]} inventoryContractVersion={2} {...ids} />,
    ));
    const setItem = mockSessionStorage({ setItem: () => {
      throw new Error("storage unavailable");
    } });
    const retry = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "Retry prior reconciliation",
    )!;
    await act(async () => retry.click());

    expect(fetcher).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Retry prior reconciliation");
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("was not sent");
    setItem.mockRestore();
  });

  it("does not freeze or POST a fractional physical volume", async () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    await act(async () => root.render(
      <ReconcileList initialItems={[physicalItems[0]]} inventoryContractVersion={2} {...ids} />,
    ));
    const input = container.querySelector<HTMLInputElement>('input[type="number"]')!;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    act(() => { setter?.call(input, "100.5"); input.dispatchEvent(new Event("input", { bubbles: true })); });
    const save = [...container.querySelectorAll("button")].find((button) => button.textContent === "Save 1 change")!;
    await act(async () => save.click());

    expect(fetcher).not.toHaveBeenCalled();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("Check each bottle");
    expect(container.textContent).not.toContain("Retry prior reconciliation");
    expect(container.querySelector("fieldset")?.hasAttribute("disabled")).toBe(false);
  });
});

function setInputValue(input: HTMLInputElement, value: number) {
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  if (!setValue) throw new Error("Native input value setter is unavailable");
  act(() => {
    setValue.call(input, String(value));
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function findElementByText(container: HTMLElement, copy: RegExp): HTMLElement {
  const match = [...container.querySelectorAll<HTMLElement>("*")].find(
    (element) =>
      copy.test(element.textContent ?? "") &&
      ![...element.children].some((child) => copy.test(child.textContent ?? "")),
  );
  if (!match) throw new Error(`Could not find element matching ${copy}`);
  return match;
}

function varianceCopy(deltaMl: number, label: string): RegExp {
  const sign = deltaMl > 0 ? "\\+" : deltaMl < 0 ? "−" : "";
  const ounces = Math.abs(deltaMl / ML_PER_OZ).toFixed(1);
  return new RegExp(`${sign}${ounces} oz · ${label}`, "i");
}
