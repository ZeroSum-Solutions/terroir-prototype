import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import Link from "next/link";
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

  it("retains a truthful unknown-outcome explanation when the response is lost", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Network down")));

    const container = await mount();
    await click(container, "Close bottle");
    await click(container, "Confirm discard 4.2 oz");

    expect(document.body.querySelector('[role="alert"]')?.textContent).toContain(
      "Discard not confirmed. This may already be recorded. Retry the prior action to check; do not discard again.",
    );
    expect(document.body.textContent).not.toContain("Network down");
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
    expect(document.body.querySelector('[role="alert"]')?.textContent).toContain(
      "Discard not confirmed",
    );
    await click(container, "Retry prior action");

    const first = new Headers(fetchMock.mock.calls[0][1]?.headers);
    const retry = new Headers(fetchMock.mock.calls[1][1]?.headers);
    expect(retry.get("Idempotency-Key")).toBe(first.get("Idempotency-Key"));
    expect(refresh).toHaveBeenCalledOnce();
    expect(document.body.querySelector('[role="status"]')?.textContent).toContain(
      "Already recorded",
    );
    expect(document.body.textContent).not.toContain("Discard not confirmed");
    expect(document.body.textContent).not.toContain("Couldn't close");
  });

  it("keeps an earlier unknown outcome visible after a retry is refused", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("Bad gateway", { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        error: { message: "Membership changed." },
      }), { status: 403, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    const container = await mount();
    await click(container, "Close bottle");
    await click(container, "Confirm discard 4.2 oz");
    await click(container, "Retry prior action");

    expect(document.body.querySelector('[role="alert"]')?.textContent).toContain(
      "Discard not confirmed. This may already be recorded. Retry the prior action to check; do not discard again. Latest response: Membership changed.",
    );
    expect(container.textContent).toContain("Retry prior action");
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
      "Discard not confirmed. This may already be recorded. Retry the prior action to check; do not discard again.",
    );
    await click(container, "Retry prior action");

    const first = new Headers(fetchMock.mock.calls[0][1]?.headers);
    const retry = new Headers(fetchMock.mock.calls[1][1]?.headers);
    expect(retry.get("Idempotency-Key")).toBe(first.get("Idempotency-Key"));
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("freezes the physical wine and bottle payload across an uncertain retry", async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new Error("Network down"))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        closed: { id: "66666666-6666-4666-8666-666666666666",
          wine_id: "55555555-5555-4555-8555-555555555555",
          closed_at: "2026-09-23T13:00:00.000Z" },
      }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);
    const render = (bottleId: string, wineId: string) => act(async () => root.render(
      <ToastProvider><CloseBottleButton bottleId={bottleId} wineId={wineId}
        identityContract={2} openedAt="2026-09-23T12:00:00.000Z" remainingOz={4.2} /></ToastProvider>,
    ));
    await render("66666666-6666-4666-8666-666666666666", "55555555-5555-4555-8555-555555555555");
    await click(container, "Close bottle");
    await click(container, "Confirm discard 4.2 oz");
    await render("77777777-7777-4777-8777-777777777777", "88888888-8888-4888-8888-888888888888");
    await click(container, "Retry prior action");
    expect(fetchMock.mock.calls[1][0]).toContain("66666666-6666-4666-8666-666666666666");
    expect(fetchMock.mock.calls[1][1]?.body).toBe(fetchMock.mock.calls[0][1]?.body);
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({
      wine_id: "55555555-5555-4555-8555-555555555555",
    });
    expect(new Headers(fetchMock.mock.calls[1][1]?.headers).get("Idempotency-Key"))
      .toBe(new Headers(fetchMock.mock.calls[0][1]?.headers).get("Idempotency-Key"));
  });

  it("offers a receipt-bound mistaken-discard correction without refreshing first", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      discard_event_id: "77777777-7777-4777-8777-777777777777",
      closed: {
        id: "66666666-6666-4666-8666-666666666666",
        wine_id: "55555555-5555-4555-8555-555555555555",
        closed_at: "2026-09-23T13:00:00.000Z",
      },
    }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);
    await act(async () => root.render(
      <ToastProvider><CloseBottleButton
        bottleId="66666666-6666-4666-8666-666666666666"
        wineId="55555555-5555-4555-8555-555555555555"
        identityContract={2}
        openedAt="2026-09-23T12:00:00.000Z"
        remainingOz={4.2}
      /></ToastProvider>,
    ));

    await click(container, "Close bottle");
    await click(container, "Confirm discard 4.2 oz");

    expect(refresh).not.toHaveBeenCalled();
    expect(container.querySelector(
      'button[aria-label="Mistaken report — same bottle is here"]',
    )).not.toBeNull();
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("sends both discard-correction attestations and freezes its retry", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(physicalDiscardResponse())
      .mockResolvedValueOnce(new Response("Bad gateway", { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        undo_event_id: "88888888-8888-4888-8888-888888888888",
        open_bottle: {
          id: "66666666-6666-4666-8666-666666666666",
          wine_id: "55555555-5555-4555-8555-555555555555",
          opened_at: "2026-09-23T12:00:00.000Z",
          remaining_ml: 125,
        },
      }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    const container = await mountPhysical();
    await click(container, "Close bottle");
    await click(container, "Confirm discard 4.2 oz");
    await click(container, "Mistaken report — same bottle is here");
    expect(document.body.querySelector('[role="alert"]')?.textContent).toContain(
      "Correction not confirmed",
    );
    await click(container, "Mistaken report — same bottle is here");

    const first = fetchMock.mock.calls[1];
    const retry = fetchMock.mock.calls[2];
    expect(first[0]).toBe("/api/pour/undo");
    expect(JSON.parse(String(first[1]?.body))).toEqual({
      wine_id: "55555555-5555-4555-8555-555555555555",
      open_bottle_id: "66666666-6666-4666-8666-666666666666",
      reversal_of_event_id: "77777777-7777-4777-8777-777777777777",
      correction_reason: "mistaken_report",
      operator_confirms_same_bottle_present: true,
    });
    expect(retry[1]?.body).toBe(first[1]?.body);
    expect(new Headers(retry[1]?.headers).get("Idempotency-Key"))
      .toBe(new Headers(first[1]?.headers).get("Idempotency-Key"));
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("keeps alternate discard decisions from abandoning an unresolved correction", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(physicalDiscardResponse())
      .mockResolvedValueOnce(new Response("Bad gateway", { status: 503 })));
    const container = await mountPhysical();
    await click(container, "Close bottle");
    await click(container, "Confirm discard 4.2 oz");
    await click(container, "Mistaken report — same bottle is here");

    expect(container.textContent).toContain("Retry mistaken-discard correction");
    expect(container.querySelector<HTMLButtonElement>(
      'button[aria-label="Discard was correct"]',
    )?.disabled).toBe(true);
    expect(container.querySelector<HTMLButtonElement>(
      'button[aria-label="Bottle status uncertain"]',
    )?.disabled).toBe(true);
  });

  it("returns to the Close action after a confirmed correction", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(physicalDiscardResponse())
      .mockResolvedValueOnce(new Response(JSON.stringify({
        undo_event_id: "88888888-8888-4888-8888-888888888888",
        open_bottle: {
          id: "66666666-6666-4666-8666-666666666666",
          wine_id: "55555555-5555-4555-8555-555555555555",
          opened_at: "2026-09-23T12:00:00.000Z",
          remaining_ml: 125,
        },
      }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    const container = await mountPhysical();
    await click(container, "Close bottle");
    await click(container, "Confirm discard 4.2 oz");
    await click(container, "Mistaken report — same bottle is here");
    expect(container.querySelector(
      'button[aria-label="Mistaken report — same bottle is here"]',
    )).toBeNull();
    expect(container.querySelector('button[aria-label="Close bottle"]')).not.toBeNull();
  });

  it.each([
    ["malformed", "------------------------------------", true],
    ["same reversal", "77777777-7777-4777-8777-777777777777", true],
    ["incomplete bottle", "88888888-8888-4888-8888-888888888888", false],
  ])("retains correction retry for a %s Undo result", async (
    _case, undoEventId, completeBottle,
  ) => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(physicalDiscardResponse())
      .mockResolvedValueOnce(new Response(JSON.stringify({
        undo_event_id: undoEventId,
        open_bottle: {
          id: "66666666-6666-4666-8666-666666666666",
          wine_id: "55555555-5555-4555-8555-555555555555",
          ...(completeBottle ? {
            opened_at: "2026-09-23T12:00:00.000Z",
            remaining_ml: 125,
          } : {}),
        },
      }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    const container = await mountPhysical();
    await click(container, "Close bottle");
    await click(container, "Confirm discard 4.2 oz");
    await click(container, "Mistaken report — same bottle is here");
    expect(document.body.querySelector('[role="alert"]')?.textContent)
      .toContain("Correction not confirmed");
    expect(container.textContent).toContain("Retry mistaken-discard correction");
  });

  it.each([
    ["correction", "Mistaken report — same bottle is here"],
    ["accepted discard", "Discard was correct"],
    ["uncertain discard", "Bottle status uncertain"],
  ])("prevents the row link for the %s decision", async (_case, decision) => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(physicalDiscardResponse())
      .mockResolvedValueOnce(new Response("Bad gateway", { status: 503 }));
    vi.stubGlobal("fetch", fetchMock);
    const rowLink = vi.fn();
    const container = await mountPhysical(rowLink);
    await click(container, "Close bottle");
    await click(container, "Confirm discard 4.2 oz");
    rowLink.mockClear();
    await click(container, decision);
    expect(rowLink).not.toHaveBeenCalled();
    if (decision === "Bottle status uncertain") {
      await click(container, "Refresh bottle list");
      expect(rowLink).not.toHaveBeenCalled();
    }
  });

  it.each(["Discard was correct", "Bottle status uncertain"])(
    "%s sends no correction mutation",
    async (decision) => {
      const fetchMock = vi.fn().mockResolvedValue(physicalDiscardResponse());
      vi.stubGlobal("fetch", fetchMock);
      const container = await mountPhysical();
      await click(container, "Close bottle");
      await click(container, "Confirm discard 4.2 oz");
      await click(container, decision);
      expect(fetchMock).toHaveBeenCalledOnce();
      if (decision === "Bottle status uncertain") {
        expect(document.body.querySelector('[role="alert"]')?.textContent)
          .toContain("Bottle status needs review");
      }
    },
  );

  it.each([
    ["missing", {}],
    ["wrong", { discard_event_id: "not-an-event" }],
    ["hyphen-only", { discard_event_id: "------------------------------------" }],
    ["ungrouped", { discard_event_id: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" }],
    ["extra", {
      discard_event_id: "77777777-7777-4777-8777-777777777777",
      spill_event_id: "88888888-8888-4888-8888-888888888888",
    }],
  ])("exposes no correction for %s discard event identity", async (_case, event) => {
    const base = await physicalDiscardResponse().json();
    const { discard_event_id: _discardEventId, ...withoutEvent } = base;
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ ...withoutEvent, ...event }),
      { status: 200, headers: { "content-type": "application/json" } },
    )));
    const container = await mountPhysical();
    await click(container, "Close bottle");
    await click(container, "Confirm discard 4.2 oz");
    expect(container.querySelector(
      'button[aria-label="Mistaken report — same bottle is here"]',
    )).toBeNull();
  });
});

function physicalDiscardResponse() {
  return new Response(JSON.stringify({
    discard_event_id: "77777777-7777-4777-8777-777777777777",
    closed: {
      id: "66666666-6666-4666-8666-666666666666",
      wine_id: "55555555-5555-4555-8555-555555555555",
      closed_at: "2026-09-23T13:00:00.000Z",
    },
  }), { status: 200, headers: { "content-type": "application/json" } });
}

async function mountPhysical(rowLink?: () => void): Promise<HTMLElement> {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  const button = <CloseBottleButton
    bottleId="66666666-6666-4666-8666-666666666666"
    wineId="55555555-5555-4555-8555-555555555555"
    identityContract={2}
    openedAt="2026-09-23T12:00:00.000Z"
    remainingOz={4.2}
  />;
  await act(async () => root.render(<ToastProvider>
    {rowLink ? <Link href="/cellar" onClick={rowLink}>{button}</Link> : button}
  </ToastProvider>));
  return container;
}

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
