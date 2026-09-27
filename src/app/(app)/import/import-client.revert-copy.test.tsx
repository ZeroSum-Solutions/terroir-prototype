import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const { ImportClient } = await import("./import-client");

const reactTestEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};
const previousActEnvironment = reactTestEnvironment.IS_REACT_ACT_ENVIRONMENT;

beforeAll(() => {
  reactTestEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
});

afterAll(() => {
  reactTestEnvironment.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
});

const BATCH_ID = "batch-1";
const BATCH_SUMMARY = {
  id: BATCH_ID,
  filename: "cellar.csv",
  status: "completed" as const,
  total_rows: 3,
  created_at: "2026-08-27T00:00:00.000Z",
  reverted_at: null,
};
const BATCH_ROW = {
  id: "row-1",
  row_number: 1,
  producer: "Domaine A",
  name: "Cuvee One",
  row_state: "valid" as const,
  lwin_status: "matched" as const,
  lwin_id: "LWIN-1",
  lwin_score: 0.9,
  cost_status: "present" as const,
  resolution: "auto" as const,
  apply_status: "applied" as const,
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function stubFetch(revertBody: unknown) {
  const fetchMock = vi.fn((input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith("/api/import/batches")) {
      return Promise.resolve(jsonResponse({ batches: [BATCH_SUMMARY] }));
    }
    if (url.endsWith(`/api/import/batches/${BATCH_ID}`)) {
      return Promise.resolve(jsonResponse({ batch: BATCH_SUMMARY, rows: [BATCH_ROW] }));
    }
    if (url.endsWith(`/api/import/batches/${BATCH_ID}/revert`)) {
      return Promise.resolve(jsonResponse(revertBody));
    }
    throw new Error(`unexpected fetch: ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
}

describe("ImportClient retained-catalog revert copy", () => {
  const roots: Root[] = [];

  beforeEach(() => {
    const store = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value);
      },
      removeItem: (key: string) => {
        store.delete(key);
      },
    });
  });

  afterEach(async () => {
    for (const root of roots.splice(0)) {
      await act(async () => root.unmount());
    }
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    document.body.innerHTML = "";
    document.body.style.overflow = "";
  });

  async function mount(element: ReactElement) {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);
    await act(async () => root.render(element));
    return container;
  }

  async function openBatchWithRevertDialog(container: HTMLElement) {
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    const openButton = [...container.querySelectorAll<HTMLButtonElement>("button")].find((button) =>
      button.textContent?.includes("cellar.csv"),
    )!;
    await act(async () => openButton.click());
    const revertButton = [...container.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent?.trim() === "Revert this import",
    )!;
    await act(async () => revertButton.click());
  }

  it("explains that catalog wines and history are retained and the mutation is atomic", async () => {
    stubFetch({});
    const container = await mount(<ImportClient />);
    await openBatchWithRevertDialog(container);

    const copy = container.querySelector('[role="dialog"]')?.textContent ?? "";
    expect(copy).toContain("Wine catalog entries and import history stay in place");
    expect(copy).toContain("entire revert succeeds together or makes no changes");
    expect(copy).not.toContain("deletes wines");
    expect(copy).not.toContain("best-effort");
  });

  it("shows only committed inventory/LWIN counts and retained-catalog wording", async () => {
    stubFetch({
      revertedCount: 1,
      orphanWinesDeleted: 0,
      lwinStampsCleared: 2,
    });
    const container = await mount(<ImportClient />);
    await openBatchWithRevertDialog(container);

    const confirmButton = [...container.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent?.trim() === "Revert import",
    )!;
    await act(async () => confirmButton.click());

    expect(container.querySelector("h2")?.textContent).toBe("Import reverted");
    const copy = container.textContent ?? "";
    expect(copy).toContain("Removed 1 inventory row(s)");
    expect(copy).toContain("cleared 2 eligible wine-catalog (LWIN) link(s)");
    expect(copy).toContain("Wine catalog entries and import history were retained");
    expect(copy).not.toContain("deleted");
    expect(copy).not.toContain("partial");
  });

  it("does not report success for a malformed partial-success response", async () => {
    stubFetch({
      revertedCount: 1,
      orphanWinesDeleted: 1,
      lwinStampsCleared: 2,
    });
    const container = await mount(<ImportClient />);
    await openBatchWithRevertDialog(container);

    const confirmButton = [...container.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent?.trim() === "Revert import",
    )!;
    await act(async () => confirmButton.click());

    expect(container.querySelector("h2")?.textContent).not.toBe("Import reverted");
    expect(container.textContent).toContain("Revert finished with an invalid response");
  });
});
