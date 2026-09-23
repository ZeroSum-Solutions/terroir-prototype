import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "@/lib/toast";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh }),
}));

const { CloseBottleButton } = await import("./close-button");

const reactTestEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};
const previousActEnvironment = reactTestEnvironment.IS_REACT_ACT_ENVIRONMENT;
const roots: Root[] = [];

beforeAll(() => {
  reactTestEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
});

afterAll(() => {
  reactTestEnvironment.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
});

afterEach(async () => {
  for (const root of roots.splice(0)) await act(async () => root.unmount());
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  refresh.mockClear();
  document.body.innerHTML = "";
});

describe("CloseBottleButton mobile target", () => {
  it("keeps the close action at least 44px tall", () => {
    const html = renderToStaticMarkup(
      <ToastProvider>
        <CloseBottleButton
          bottleId="bottle-1"
          openedAt="2026-09-23T12:00:00.000Z"
          remainingOz={4.2}
        />
      </ToastProvider>,
    );

    expect(html).toContain("min-h-11");
  });
});

/**
 * SD-06 — a non-ok response from POST /api/open-bottles/{id}/close was
 * `console.error`'d and the confirm state reset. The bottle stayed open, the
 * page did not change, and nothing told the operator the discard had not
 * happened. Every other mutation in the app surfaces a toast or a
 * `role="alert"`; this one now does too.
 */
describe("CloseBottleButton failure reporting", () => {
  it("tells the operator when the close is refused, and does not refresh", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({ error: { message: "Bottle is already closed." } }),
          { status: 409, headers: { "Content-Type": "application/json" } },
        ),
      ),
    );

    const container = await mount();
    await click(container, "Close bottle");
    await click(container, "Confirm discard 4.2 oz");

    const alert = document.body.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain("Bottle is already closed.");
    expect(refresh).not.toHaveBeenCalled();
  });

  it("tells the operator when the request never reaches the server", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Network down")));

    const container = await mount();
    await click(container, "Close bottle");
    await click(container, "Confirm discard 4.2 oz");

    expect(document.body.querySelector('[role="alert"]')?.textContent).toContain(
      "Network down",
    );
    expect(refresh).not.toHaveBeenCalled();
  });

  it("stays silent and refreshes when the close succeeds", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({
        closed: {
          id: "66666666-6666-4666-8666-666666666666",
          wine_id: "55555555-5555-4555-8555-555555555555",
          closed_at: "2026-09-23T13:00:00.000Z",
        },
      }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal(
      "fetch",
      fetchMock,
    );

    const container = await mount();
    await click(container, "Close bottle");
    await click(container, "Confirm discard 4.2 oz");

    expect(document.body.querySelector('[role="alert"]')).toBeNull();
    expect(refresh).toHaveBeenCalledOnce();
    const [, init] = fetchMock.mock.calls[0];
    const headers = new Headers(init?.headers);
    expect(headers.get("Idempotency-Key")).toMatch(/^[0-9a-f-]{36}$/i);
    expect(JSON.parse(String(init?.body))).toEqual({
      expected_opened_at: "2026-09-23T12:00:00.000Z",
    });
  });

  it("reuses the UUID when a proxy 503 makes the first response uncertain", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("Bad gateway", { status: 503 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({
          closed: {
            id: "66666666-6666-4666-8666-666666666666",
            wine_id: "55555555-5555-4555-8555-555555555555",
            closed_at: "2026-09-23T13:00:00.000Z",
          },
        }), {
          status: 200,
          headers: {
            "content-type": "application/json",
            "Idempotency-Replayed": "true",
          },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const container = await mount();
    await click(container, "Close bottle");
    await click(container, "Confirm discard 4.2 oz");
    await click(container, "Retry prior action");

    const first = new Headers(fetchMock.mock.calls[0][1]?.headers);
    const retry = new Headers(fetchMock.mock.calls[1][1]?.headers);
    expect(retry.get("Idempotency-Key")).toBe(first.get("Idempotency-Key"));
    expect(refresh).toHaveBeenCalledOnce();
    expect(document.body.querySelector('[role="status"]')?.textContent).toContain(
      "Already recorded",
    );
  });

  it("reuses the UUID after a wrong-typed 200 response", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        closed: {
          id: 123,
          wine_id: "55555555-5555-4555-8555-555555555555",
          closed_at: "not-a-date",
        },
      }), { status: 200 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({
          closed: {
            id: "66666666-6666-4666-8666-666666666666",
            wine_id: "55555555-5555-4555-8555-555555555555",
            closed_at: "2026-09-23T13:00:00.000Z",
          },
        }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const container = await mount();
    await click(container, "Close bottle");
    await click(container, "Confirm discard 4.2 oz");
    expect(document.body.querySelector('[role="alert"]')?.textContent).toContain(
      "Couldn't confirm the bottle was closed",
    );
    await click(container, "Retry prior action");

    const first = new Headers(fetchMock.mock.calls[0][1]?.headers);
    const retry = new Headers(fetchMock.mock.calls[1][1]?.headers);
    expect(retry.get("Idempotency-Key")).toBe(first.get("Idempotency-Key"));
    expect(refresh).toHaveBeenCalledOnce();
  });
});

async function mount(): Promise<HTMLElement> {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  await act(async () =>
    root.render(
      <ToastProvider>
        <CloseBottleButton
          bottleId="bottle-1"
          openedAt="2026-09-23T12:00:00.000Z"
          remainingOz={4.2}
        />
      </ToastProvider>,
    ),
  );
  return container;
}

async function click(container: HTMLElement, label: string): Promise<void> {
  const button = container.querySelector<HTMLButtonElement>(
    `button[aria-label="${label}"]`,
  );
  if (!button) throw new Error(`No control labelled "${label}"`);
  await act(async () => {
    button.click();
  });
}
