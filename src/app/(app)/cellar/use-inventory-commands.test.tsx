import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { baseRow } from "./test-row";
import type { CellarWineRow } from "./types";
import { useInventoryCommands } from "./use-inventory-commands";
import type { LastPourReceipt } from "./use-inventory-commands";

let container: HTMLDivElement;
let root: Root;
const holder: { current: ReturnType<typeof useInventoryCommands> | null } = {
  current: null,
};
const setBusy = vi.fn();
const setErrorMsg = vi.fn();
const setLastPour = vi.fn();
const refresh = vi.fn();
const toast = { success: vi.fn(), error: vi.fn() };
const onBottleOpened = vi.fn();
const onBottleStale = vi.fn();
const WINE_ID = "55555555-5555-4555-8555-555555555555";
const BOTTLE_A = "66666666-6666-4666-8666-666666666666";
const BOTTLE_B = "77777777-7777-4777-8777-777777777777";
const POUR_EVENT = "88888888-8888-4888-8888-888888888888";

function Harness({
  row,
  contractVersion = 1,
  selectedBottleId = null,
  lastPour = null,
}: {
  row: CellarWineRow;
  contractVersion?: 1 | 2;
  selectedBottleId?: string | null;
  lastPour?: LastPourReceipt | null;
}) {
  const commands = useInventoryCommands({
    row,
    contractVersion,
    selectedBottleId,
    preservationMethod: "coravin",
    setBusy,
    setErrorMsg,
    lastPour,
    setLastPour,
    refresh,
    toast,
    onBottleOpened,
    onBottleStale,
  });
  useEffect(() => {
    holder.current = commands;
  });
  return null;
}

beforeEach(async () => {
  vi.clearAllMocks();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(
    <Harness row={baseRow({ wine_id: WINE_ID, glass_pour_ml: 150 })} />,
  ));
});

afterEach(async () => {
  await act(async () => root.unmount());
  holder.current = null;
  container.remove();
  vi.unstubAllGlobals();
});

describe("useInventoryCommands retry state", () => {
  it("freezes the exact contract-2 bottle across an uncertain retry", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response("Bad gateway", { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        open_bottle: {
          id: BOTTLE_A,
          wine_id: WINE_ID,
          opened_at: "2026-09-23T12:00:00.000Z",
          remaining_ml: 350,
        },
      }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    const physicalRow = baseRow({
      wine_id: WINE_ID,
      glass_pour_ml: 150,
      activeBottleCount: 2,
      activeOpenMl: 900,
      activeBottles: [],
    });
    await act(async () => root.render(
      <Harness row={physicalRow} contractVersion={2} selectedBottleId={BOTTLE_A} />,
    ));
    await act(async () => api().doPour(90));
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(api().pourNeedsReview).toBe(true);
    await act(async () => root.render(
      <Harness row={physicalRow} contractVersion={2} selectedBottleId={BOTTLE_B} />,
    ));
    await act(async () => api().retryPriorPour());

    for (const call of fetchMock.mock.calls) {
      expect(JSON.parse(String(call[1]?.body))).toEqual({
        wine_id: WINE_ID,
        open_bottle_id: BOTTLE_A,
        ml: 90,
        kind: "pour",
      });
    }
    expect(new Headers(fetchMock.mock.calls[1][1]?.headers).get("Idempotency-Key"))
      .toBe(new Headers(fetchMock.mock.calls[0][1]?.headers).get("Idempotency-Key"));
  });

  it("retains the exact physical pour receipt for Undo", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      pour_event_id: "88888888-8888-4888-8888-888888888888",
      open_bottle: {
        id: BOTTLE_A,
        wine_id: WINE_ID,
        opened_at: "2026-09-23T12:00:00.000Z",
        remaining_ml: 510,
      },
    }), { status: 200, headers: { "content-type": "application/json" } })));
    await act(async () => root.render(
      <Harness row={baseRow({ wine_id: WINE_ID, glass_pour_ml: 150 })}
        contractVersion={2} selectedBottleId={BOTTLE_A} />,
    ));

    await act(async () => api().doPour(90));

    expect(setLastPour).toHaveBeenLastCalledWith({
      contractVersion: 2,
      wineId: WINE_ID,
      bottleId: BOTTLE_A,
      eventId: "88888888-8888-4888-8888-888888888888",
      ml: 90,
    });
  });

  it.each([
    ["missing", {}],
    ["wrong", { pour_event_id: "not-an-event" }],
    ["hyphen-only", { pour_event_id: "------------------------------------" }],
    ["ungrouped", { pour_event_id: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" }],
    ["extra", {
      pour_event_id: POUR_EVENT,
      pour_event_ids: [POUR_EVENT],
    }],
  ])("fails closed for %s physical pour event identity", async (_case, event) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      ...event,
      open_bottle: {
        id: BOTTLE_A,
        wine_id: WINE_ID,
        opened_at: "2026-09-23T12:00:00.000Z",
        remaining_ml: 510,
      },
    }), { status: 200, headers: { "content-type": "application/json" } })));
    await act(async () => root.render(
      <Harness row={baseRow({ wine_id: WINE_ID, glass_pour_ml: 150 })}
        contractVersion={2} selectedBottleId={BOTTLE_A} />,
    ));
    await act(async () => api().doPour(90));
    expect(setLastPour).not.toHaveBeenCalledWith(expect.objectContaining({
      contractVersion: 2,
    }));
    expect(setErrorMsg).toHaveBeenLastCalledWith(expect.stringContaining(
      "Pour not confirmed",
    ));
  });

  it("freezes the receipt and UUID for an unresolved physical Undo", async () => {
    const receipt = {
      contractVersion: 2 as const,
      wineId: WINE_ID,
      bottleId: BOTTLE_A,
      eventId: POUR_EVENT,
      ml: 90,
    };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response("Bad gateway", { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        undo_event_id: "99999999-9999-4999-8999-999999999999",
        open_bottle: {
          id: BOTTLE_A,
          wine_id: WINE_ID,
          opened_at: "2026-09-23T12:00:00.000Z",
          remaining_ml: 600,
        },
      }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    await act(async () => root.render(
      <Harness row={baseRow({ wine_id: WINE_ID })} contractVersion={2}
        selectedBottleId={BOTTLE_A} lastPour={receipt} />,
    ));
    await act(async () => api().doUndo());
    expect(api().undoNeedsReview).toBe(true);

    await act(async () => root.render(
      <Harness row={baseRow({
        wine_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      })} contractVersion={2} selectedBottleId={BOTTLE_B} lastPour={receipt} />,
    ));
    await act(async () => api().retryPriorUndo());

    expect(fetchMock.mock.calls.map((call) => JSON.parse(String(call[1]?.body))))
      .toEqual([{
        wine_id: WINE_ID,
        open_bottle_id: BOTTLE_A,
        reversal_of_event_id: POUR_EVENT,
      }, {
        wine_id: WINE_ID,
        open_bottle_id: BOTTLE_A,
        reversal_of_event_id: POUR_EVENT,
      }]);
    expect(new Headers(fetchMock.mock.calls[1][1]?.headers).get("Idempotency-Key"))
      .toBe(new Headers(fetchMock.mock.calls[0][1]?.headers).get("Idempotency-Key"));
    expect(setLastPour).toHaveBeenLastCalledWith(null);
  });

  it("keeps the receipt after a definitive physical Undo refusal", async () => {
    const receipt = {
      contractVersion: 2 as const, wineId: WINE_ID, bottleId: BOTTLE_A,
      eventId: POUR_EVENT, ml: 90,
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      error: { code: "undo_requires_review", message: "Ask a manager to reconcile." },
    }), { status: 409, headers: { "content-type": "application/json" } })));
    await act(async () => root.render(
      <Harness row={baseRow({ wine_id: WINE_ID })} contractVersion={2}
        selectedBottleId={BOTTLE_A} lastPour={receipt} />,
    ));
    await act(async () => api().doUndo());
    expect(setLastPour).not.toHaveBeenCalled();
    expect(api().undoNeedsReview).toBe(false);
    expect(setErrorMsg).toHaveBeenLastCalledWith("Ask a manager to reconcile.");
  });

  it.each([
    ["malformed", "------------------------------------"],
    ["same reversal", POUR_EVENT],
  ])("retains uncertain retry for a %s Undo event result", async (_case, undoEventId) => {
    const receipt = {
      contractVersion: 2 as const, wineId: WINE_ID, bottleId: BOTTLE_A,
      eventId: POUR_EVENT, ml: 90,
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      undo_event_id: undoEventId,
      open_bottle: {
        id: BOTTLE_A, wine_id: WINE_ID,
        opened_at: "2026-09-23T12:00:00.000Z", remaining_ml: 600,
      },
    }), { status: 200, headers: { "content-type": "application/json" } })));
    await act(async () => root.render(
      <Harness row={baseRow({ wine_id: WINE_ID })} contractVersion={2}
        selectedBottleId={BOTTLE_A} lastPour={receipt} />,
    ));
    await act(async () => api().doUndo());
    expect(api().undoNeedsReview).toBe(true);
    expect(setLastPour).not.toHaveBeenCalled();
  });

  it("selects only the exact bottle returned by a valid contract-2 open", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      open_bottle: {
        id: BOTTLE_B,
        wine_id: WINE_ID,
        opened_at: "2026-09-23T12:00:00.000Z",
        remaining_ml: 750,
      },
    }), { status: 201, headers: { "content-type": "application/json" } })));
    await act(async () => root.render(
      <Harness row={baseRow({ wine_id: WINE_ID })} contractVersion={2} />,
    ));
    await act(async () => api().doOpenBottle());
    expect(onBottleOpened).toHaveBeenCalledExactlyOnceWith(BOTTLE_B);
  });

  it("retries the stored custom pour through 403 and catalog changes", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response("Bad gateway", { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        error: { code: "forbidden", message: "Membership changed." },
      }), { status: 403, headers: { "content-type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        open_bottle: {
          id: "66666666-6666-4666-8666-666666666666",
          wine_id: WINE_ID,
          opened_at: "2026-09-23T12:00:00.000Z",
          remaining_ml: 350,
        },
      }), {
        status: 200,
        headers: {
          "content-type": "application/json",
          "Idempotency-Replayed": "true",
        },
      }));
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => api().doPour(90));
    expect(api().pourNeedsReview).toBe(true);
    expect(setErrorMsg).toHaveBeenLastCalledWith(
      "Pour not confirmed. This may already be recorded. Retry the prior action to check; do not pour again.",
    );
    expect(toast.error).not.toHaveBeenCalled();

    await act(async () => api().doPour(250));
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(setErrorMsg).toHaveBeenLastCalledWith(
      "Retry the prior pour before recording another one.",
    );

    await act(async () => api().retryPriorPour());
    expect(api().pourNeedsReview).toBe(true);
    expect(setErrorMsg).toHaveBeenLastCalledWith(
      "Pour not confirmed. This may already be recorded. Retry the prior action to check; do not pour again. Latest response: Membership changed.",
    );
    expect(toast.error).not.toHaveBeenCalled();

    await act(async () => root.render(
      <Harness row={baseRow({
        wine_id: WINE_ID,
        sealed_count: 0,
        glass_pour_ml: null,
        open_bottle_id: null,
        open_remaining_ml: null,
      })} />,
    ));
    await act(async () => api().retryPriorPour());

    const firstHeaders = new Headers(fetchMock.mock.calls[0][1]?.headers);
    for (const call of fetchMock.mock.calls.slice(1)) {
      expect(new Headers(call[1]?.headers).get("Idempotency-Key")).toBe(
        firstHeaders.get("Idempotency-Key"),
      );
    }
    expect(JSON.parse(String(fetchMock.mock.calls[2][1]?.body))).toMatchObject({
      ml: 90,
      preservation_method: "coravin",
    });
    expect(toast.success).toHaveBeenCalledWith("Already recorded");
    expect(toast.error).not.toHaveBeenCalled();
    expect(setErrorMsg).toHaveBeenLastCalledWith(null);
    expect(api().pourNeedsReview).toBe(false);
  });

  it("retries an unresolved open with its original payload after row changes", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response("Unavailable", { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        error: { code: "forbidden", message: "Membership changed." },
      }), { status: 403, headers: { "content-type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        open_bottle: {
          id: "66666666-6666-4666-8666-666666666666",
          wine_id: WINE_ID,
          opened_at: "2026-09-23T12:00:00.000Z",
          remaining_ml: 750,
        },
      }), {
        status: 201,
        headers: {
          "content-type": "application/json",
          "Idempotency-Replayed": "true",
        },
      }));
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => api().doOpenBottle());
    expect(api().openNeedsReview).toBe(true);
    expect(setErrorMsg).toHaveBeenLastCalledWith(
      "Open not confirmed. This may already be recorded. Retry the prior action to check; do not open again.",
    );
    expect(toast.error).not.toHaveBeenCalled();

    await act(async () => api().retryPriorOpen());
    expect(api().openNeedsReview).toBe(true);
    expect(setErrorMsg).toHaveBeenLastCalledWith(
      "Open not confirmed. This may already be recorded. Retry the prior action to check; do not open again. Latest response: Membership changed.",
    );
    expect(toast.error).not.toHaveBeenCalled();

    await act(async () => root.render(
      <Harness row={baseRow({
        wine_id: "88888888-8888-4888-8888-888888888888",
        sealed_count: 0,
        open_bottle_id: "99999999-9999-4999-8999-999999999999",
      })} />,
    ));
    await act(async () => api().retryPriorOpen());

    expect(JSON.parse(String(fetchMock.mock.calls[2][1]?.body))).toEqual({
      wine_id: WINE_ID,
      preservation_method: "coravin",
    });
    expect(new Headers(fetchMock.mock.calls[2][1]?.headers).get(
      "Idempotency-Key",
    )).toBe(new Headers(fetchMock.mock.calls[0][1]?.headers).get(
      "Idempotency-Key",
    ));
    expect(toast.success).toHaveBeenCalledWith("Already recorded");
    expect(toast.error).not.toHaveBeenCalled();
    expect(setErrorMsg).toHaveBeenLastCalledWith(null);
  });

  it("preserves specific definitive server errors without creating retry state", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      error: { code: "already_closed", message: "Bottle is already closed." },
    }), { status: 409, headers: { "content-type": "application/json" } })));

    await act(async () => api().doPour(90));

    expect(setErrorMsg).toHaveBeenLastCalledWith("Bottle is already closed.");
    expect(toast.error).toHaveBeenCalledWith("Pour failed");
    expect(api().pourNeedsReview).toBe(false);
  });

  it("preserves a definitive open refusal without calling it uncertain", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      error: { code: "active_bottle", message: "A bottle is already open." },
    }), { status: 409, headers: { "content-type": "application/json" } })));

    await act(async () => api().doOpenBottle());

    expect(setErrorMsg).toHaveBeenLastCalledWith("A bottle is already open.");
    expect(toast.error).toHaveBeenCalledWith("Open bottle failed");
    expect(api().openNeedsReview).toBe(false);
  });
});

function api() {
  if (!holder.current) throw new Error("Harness not rendered");
  return holder.current;
}
