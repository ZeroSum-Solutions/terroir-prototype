import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  BOTTLE_PENDING_STORAGE_KEY,
  beginPendingBottleOperation,
} from "@/domains/scanning/bottle-pending-operation";
import { bottleResult } from "./scanner.test-fixtures";

const USER_A = "11111111-1111-4111-8111-111111111111";
const USER_B = "22222222-2222-4222-8222-222222222222";
const SITE_A = "33333333-3333-4333-8333-333333333333";
const SITE_B = "44444444-4444-4444-8444-444444444444";
const OPERATION = "55555555-5555-4555-8555-555555555555";

const context = vi.hoisted(() => ({
  restaurantId: "33333333-3333-4333-8333-333333333333",
}));
vi.mock("@/lib/context/restaurant", () => ({
  useRestaurant: () => ({ restaurantId: context.restaurantId }),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

const { Scanner } = await import("./scanner");
let container: HTMLDivElement;
let root: Root | null;

beforeEach(() => {
  context.restaurantId = SITE_A;
  vi.stubGlobal("Storage", MemoryStorage);
  vi.stubGlobal("localStorage", new MemoryStorage());
  vi.stubGlobal("navigator", navigatorWithSerializedLocks());
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  if (root) act(() => root?.unmount());
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Scanner pending bottle recovery", () => {
  it("persists before POST, remounts, then retries the exact header and payload", async () => {
    const firstSave = deferred<Response>();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response(bottleResult))
      .mockReturnValueOnce(firstSave.promise);
    vi.stubGlobal("fetch", fetchMock);
    await mount(USER_A, "bottle");

    await selectFile(new File(["label"], "label.jpg", { type: "image/jpeg" }));
    const confirmed = click("Confirm & save");
    await waitFor(() => fetchMock.mock.calls.length === 2);
    const storedBeforeResponse = localStorage.getItem(BOTTLE_PENDING_STORAGE_KEY);
    const firstRequest = fetchMock.mock.calls[1]![1] as RequestInit;
    expect(storedBeforeResponse).not.toBeNull();
    expect(JSON.parse(storedBeforeResponse!)).toMatchObject({
      userId: USER_A,
      restaurantId: SITE_A,
      payload: { wine: { name: "Test Pinot Noir", qty: 1, unitCost: 0 } },
    });
    expect(firstRequest.headers).toMatchObject({
      "Idempotency-Key": JSON.parse(storedBeforeResponse!).operationId,
      "X-Expected-User-Id": USER_A,
      "X-Expected-Restaurant-Id": SITE_A,
    });
    expect(firstRequest.body).toBe(JSON.stringify(JSON.parse(storedBeforeResponse!).payload));

    await act(async () => {
      firstSave.reject(new Error("connection dropped"));
      await confirmed;
    });
    expect(localStorage.getItem(BOTTLE_PENDING_STORAGE_KEY)).toBe(storedBeforeResponse);

    await unmountAndMount(USER_A);
    expect(container.textContent).toContain("Bottle save needs recovery");
    expect(container.textContent).not.toContain("Test Pinot Noir");
    expect(container.textContent).not.toContain("24.5");

    fetchMock.mockResolvedValueOnce(response(validReceipt()));
    await click("Retry pending save");
    const retryRequest = fetchMock.mock.calls[2]![1] as RequestInit;
    expect(retryRequest.headers).toEqual(firstRequest.headers);
    expect(retryRequest.body).toBe(firstRequest.body);
    expect(localStorage.getItem(BOTTLE_PENDING_STORAGE_KEY)).toBeNull();
  });

  it.each([
    ["actor switch", async () => { await mount(USER_B, "bottle"); }],
    ["site switch", async () => {
      context.restaurantId = SITE_B;
      await mount(USER_A, "bottle");
    }],
    ["sign-out", async () => { await mount(null, "bottle"); }],
    ["unmount", async () => {
      await act(async () => root?.unmount());
      root = null;
    }],
  ])("retains pending bytes and sends zero save POSTs after a delayed-lock %s", async (
    _label,
    changeContext,
  ) => {
    const fetchMock = vi.fn().mockResolvedValueOnce(response(bottleResult));
    vi.stubGlobal("fetch", fetchMock);
    await mount(USER_A, "bottle");
    await selectFile(new File(["label"], "label.jpg", { type: "image/jpeg" }));

    const held = heldNavigatorLock();
    vi.stubGlobal("navigator", held.navigator);
    await held.started;
    await click("Confirm & save");
    expect(localStorage.getItem(BOTTLE_PENDING_STORAGE_KEY)).toBeNull();

    await changeContext();
    held.release();
    await waitFor(() => localStorage.getItem(BOTTLE_PENDING_STORAGE_KEY) !== null);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    await held.drain();

    const stored = localStorage.getItem(BOTTLE_PENDING_STORAGE_KEY);
    expect(stored).not.toBeNull();
    expect(JSON.parse(stored!)).toMatchObject({
      userId: USER_A,
      restaurantId: SITE_A,
      payload: { wine: { unitCost: 0 } },
    });
    expect(fetchMock.mock.calls.filter(([url]) =>
      url === "/api/inventory/save-bottle-scan"
    )).toHaveLength(0);
  });

  it.each([
    ["409 conflict", () => Promise.resolve(response({ error: { code: "idempotency_in_progress", message: "Pending." } }, 409))],
    ["400 rejection", () => Promise.resolve(response({ error: { code: "bad_request", message: "Invalid." } }, 400))],
    ["5xx", () => Promise.resolve(response({ error: { code: "internal_error", message: "Internal server error." } }, 503))],
    ["network failure", () => Promise.reject(new Error("offline"))],
    ["malformed 2xx", () => Promise.resolve(response({ wineId: "not-a-receipt" }))],
  ])("retains the exact operation after %s", async (_label, saveResult) => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response(bottleResult))
      .mockImplementationOnce(saveResult);
    vi.stubGlobal("fetch", fetchMock);
    await mount(USER_A, "bottle");

    await selectFile(new File(["label"], "label.jpg", { type: "image/jpeg" }));
    await click("Confirm & save");

    expect(localStorage.getItem(BOTTLE_PENDING_STORAGE_KEY)).not.toBeNull();
    expect(container.textContent).toContain("Bottle save needs recovery");
  });

  it("bounds a hung save request, releases busy state, and retains recovery", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response(bottleResult))
      .mockImplementationOnce((_url: string, init?: RequestInit) => new Promise<Response>(
        (_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new Error("save timed out")), {
            once: true,
          });
        },
      ));
    vi.stubGlobal("fetch", fetchMock);
    await mount(USER_A, "bottle");
    await selectFile(new File(["label"], "label.jpg", { type: "image/jpeg" }));
    await click("Confirm & save");
    const stored = localStorage.getItem(BOTTLE_PENDING_STORAGE_KEY);
    expect(stored).not.toBeNull();

    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });

    expect(localStorage.getItem(BOTTLE_PENDING_STORAGE_KEY)).toBe(stored);
    expect(container.textContent).toContain("Bottle save needs recovery");
    const retry = [...container.querySelectorAll<HTMLButtonElement>("button")].find(
      (candidate) => candidate.textContent?.trim() === "Retry pending save",
    );
    expect(retry?.disabled).toBe(false);
  });

  it("bounds a hung receipt body while retaining the exact recovery", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response(bottleResult))
      .mockImplementationOnce((_url: string, init?: RequestInit) => Promise.resolve({
        ok: true,
        status: 200,
        json: () => new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new Error("body timed out")), {
            once: true,
          });
        }),
      } as Response));
    vi.stubGlobal("fetch", fetchMock);
    await mount(USER_A, "bottle");
    await selectFile(new File(["label"], "label.jpg", { type: "image/jpeg" }));
    await click("Confirm & save");
    const stored = localStorage.getItem(BOTTLE_PENDING_STORAGE_KEY);
    expect(stored).not.toBeNull();

    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });

    expect(localStorage.getItem(BOTTLE_PENDING_STORAGE_KEY)).toBe(stored);
    expect(container.textContent).toContain("Bottle save needs recovery");
    const retry = [...container.querySelectorAll<HTMLButtonElement>("button")].find(
      (candidate) => candidate.textContent?.trim() === "Retry pending save",
    );
    expect(retry?.disabled).toBe(false);
  });

  it("clears only after a strictly valid receipt", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response(bottleResult))
      .mockResolvedValueOnce(response(validReceipt()));
    vi.stubGlobal("fetch", fetchMock);
    await mount(USER_A, "bottle");

    await selectFile(new File(["label"], "label.jpg", { type: "image/jpeg" }));
    await click("Confirm & save");

    expect(localStorage.getItem(BOTTLE_PENDING_STORAGE_KEY)).toBeNull();
    expect(container.textContent).toContain("Scan a bottle label");
  });

  it("requires explicit confirmed abandonment and explains it cannot undo inventory", async () => {
    await seedPending();
    await mount(USER_A);

    await click("Abandon retry");
    expect(container.textContent).toContain("does not undo inventory");
    expect(localStorage.getItem(BOTTLE_PENDING_STORAGE_KEY)).not.toBeNull();

    await click("Abandon recovery data");
    expect(localStorage.getItem(BOTTLE_PENDING_STORAGE_KEY)).toBeNull();
    expect(container.textContent).toContain("server may already have committed");
  });

  it.each([
    ["switched user", USER_B, SITE_A],
    ["switched site", USER_A, SITE_B],
    ["signed out", null, SITE_A],
  ])("does not expose captured fields for a %s context", async (_label, userId, restaurantId) => {
    await seedPending();
    context.restaurantId = restaurantId;
    await mount(userId);
    await click("Bottle");

    expect(container.textContent).toContain("Bottle recovery unavailable");
    expect(container.textContent).not.toContain("Test Pinot Noir");
    expect(container.textContent).not.toContain("24.5");
    expect(container.textContent).not.toContain("Retry pending save");
  });

  it("preserves corrupt storage and refuses bottle work", async () => {
    localStorage.setItem(BOTTLE_PENDING_STORAGE_KEY, "{corrupt");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await mount(USER_A, "bottle");

    expect(container.textContent).toContain("cannot be verified");
    expect(localStorage.getItem(BOTTLE_PENDING_STORAGE_KEY)).toBe("{corrupt");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses bottle work when cross-tab locking is unavailable", async () => {
    vi.stubGlobal("navigator", new Proxy(globalThis.navigator, {
      get(target, property) {
        if (property === "locks") return undefined;
        return Reflect.get(target, property, target);
      },
    }));
    await mount(USER_A, "bottle");

    expect(container.textContent).toContain("cannot safely lock durable recovery storage");
    expect(container.textContent).not.toContain("Confirm & save");
  });

  it("refuses bottle work when durable storage throws", async () => {
    vi.stubGlobal("localStorage", {
      getItem: () => { throw new Error("storage unavailable"); },
    } as unknown as Storage);
    await mount(USER_A, "bottle");

    expect(container.textContent).toContain("Bottle recovery unavailable");
    expect(container.textContent).not.toContain("Confirm & save");
  });
});

async function seedPending() {
  const result = await beginPendingBottleOperation({
    userId: USER_A,
    restaurantId: SITE_A,
    wine: {
      name: "Test Pinot Noir",
      producer: "Test Producer",
      vintage: 2022,
      varietal: "Pinot Noir",
      region: "Willamette Valley",
      country: "United States",
      format: null,
      qty: 2,
      unitCost: 24.5,
    },
  }, undefined, () => OPERATION);
  expect(result.ok).toBe(true);
}

async function mount(userId: string | null, initialMode: "invoice" | "bottle" = "invoice") {
  await act(async () => {
    root?.render(<Scanner userId={userId} initialMode={initialMode} />);
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function unmountAndMount(userId: string | null) {
  await act(async () => root?.unmount());
  root = createRoot(container);
  await mount(userId);
}

async function selectFile(file: File) {
  const input = [...container.querySelectorAll<HTMLInputElement>('input[type="file"]')].at(-1);
  if (!input) throw new Error("Bottle file input unavailable");
  Object.defineProperty(input, "files", { configurable: true, value: [file] });
  await act(async () => input.dispatchEvent(new Event("change", { bubbles: true })));
}

async function click(name: string) {
  const button = [...container.querySelectorAll<HTMLButtonElement>("button")].find(
    (candidate) => candidate.textContent?.trim() === name,
  );
  if (!button) throw new Error(`Button not found: ${name}`);
  await act(async () => {
    button.click();
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function waitFor(predicate: () => boolean) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (predicate()) return;
    await act(async () => { await Promise.resolve(); });
  }
  throw new Error("Condition not reached");
}

function response(body: unknown, status = 200): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}

function validReceipt() {
  return {
    version: 1,
    kind: "bottle_inventory_save",
    wineId: "77777777-7777-4777-8777-777777777777",
    status: "committed",
    itemCount: 1,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((accept, decline) => { resolve = accept; reject = decline; });
  return { promise, resolve, reject };
}

function navigatorWithSerializedLocks(): Navigator {
  let tail = Promise.resolve();
  return new Proxy(globalThis.navigator, {
    get(target, property) {
      if (property !== "locks") return Reflect.get(target, property, target);
      return {
        request: async <T,>(
          _name: string,
          _options: LockOptions,
          callback: (lock: Lock | null) => T | PromiseLike<T>,
        ) => {
          const prior = tail;
          let release!: () => void;
          tail = new Promise<void>((done) => { release = done; });
          await prior;
          try { return await callback(null); } finally { release(); }
        },
      };
    },
  });
}

function heldNavigatorLock() {
  const hold = deferred<void>();
  const started = deferred<void>();
  let tail = Promise.resolve();
  const manager = {
    request: async <T,>(
      _name: string,
      _options: LockOptions,
      callback: (lock: Lock | null) => T | PromiseLike<T>,
    ) => {
      const prior = tail;
      let release!: () => void;
      tail = new Promise<void>((done) => { release = done; });
      await prior;
      try { return await callback(null); } finally { release(); }
    },
  };
  const holding = manager.request("held", { mode: "exclusive" }, async () => {
    started.resolve();
    await hold.promise;
  });
  return {
    navigator: new Proxy(globalThis.navigator, {
      get(target, property) {
        if (property === "locks") return manager;
        return Reflect.get(target, property, target);
      },
    }),
    started: started.promise,
    release: () => hold.resolve(),
    drain: async () => {
      await holding;
      await manager.request("drain", { mode: "exclusive" }, async () => undefined);
    },
  };
}

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();
  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key: string) { return this.values.get(key) ?? null; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) { this.values.set(key, value); }
}
