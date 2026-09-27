import { act, createElement, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  isCloseoutSuccess,
  isDefinitiveCommandResponse,
  isOpenBottleSuccess,
  useIdempotentCommand,
} from "./use-idempotent-command";

let container: HTMLDivElement;
let root: Root;
const holder: { current: ReturnType<typeof useIdempotentCommand> | null } = {
  current: null,
};

function Harness() {
  const value = useIdempotentCommand();
  useEffect(() => {
    holder.current = value;
  });
  return null;
}

beforeEach(async () => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(createElement(Harness)));
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  holder.current = null;
  vi.restoreAllMocks();
});

describe("useIdempotentCommand", () => {
  it("reuses a UUID after an uncertain failure", () => {
    const first = api().begin("pour:wine-1:150", { ml: 150 });
    api().finish("pour:wine-1:150", false);
    const retry = api().retry();

    expect(retry).toMatchObject({
      operationId: first,
      payload: { ml: 150 },
    });
  });

  it("creates a new UUID after a definitive response", () => {
    const first = api().begin("pour:wine-1:150", { ml: 150 });
    api().finish("pour:wine-1:150", true);
    const next = api().begin("pour:wine-1:150", { ml: 150 });

    expect(next).not.toBe(first);
  });

  it("blocks a different action until the unresolved operation is reviewed", async () => {
    let first: string | null = null;
    let changed: string | null = null;
    await act(async () => {
      first = api().begin("pour:wine-1:150", { ml: 150 });
      api().finish("pour:wine-1:150", false);
      changed = api().begin("pour:wine-1:250", { ml: 250 });
    });

    expect(first).toMatch(/^[0-9a-f-]{36}$/i);
    expect(changed).toBeNull();
    expect(api().pending).toMatchObject({
      fingerprint: "pour:wine-1:150",
      payload: { ml: 150 },
      state: "unresolved",
    });
  });

  it("retains action A when B is blocked, then retries A explicitly", () => {
    const firstA = api().begin("pour:wine-1:150", { ml: 150 });
    api().finish("pour:wine-1:150", false);
    const actionB = api().begin("pour:wine-1:250", { ml: 250 });
    const retryA = api().retry();

    expect(actionB).toBeNull();
    expect(retryA?.operationId).toBe(firstA);
    expect(retryA?.payload).toEqual({ ml: 150 });
  });

  it("keeps an uncertain UUID after a retry 403 until a valid success resolves it", async () => {
    let operationId: string | null = null;
    await act(async () => {
      operationId = api().begin("pour:wine-1:150", { ml: 150 });
      api().finish("pour:wine-1:150", false);
    });

    const forbiddenRetry = api().retry();
    await act(async () => {
      api().finish("pour:wine-1:150", true, false);
    });
    expect(api().pending?.state).toBe("unresolved");

    const allowedRetry = api().retry();
    expect(forbiddenRetry?.operationId).toBe(operationId);
    expect(allowedRetry?.operationId).toBe(operationId);
    await act(async () => {
      api().finish("pour:wine-1:150", true, true);
    });
    expect(api().pending).toBeNull();
  });

  it("refuses a concurrent duplicate intent", () => {
    expect(api().begin("open:wine-1:none", {})).toMatch(/^[0-9a-f-]{36}$/i);
    expect(api().begin("open:wine-1:none", {})).toBeNull();
  });
});

describe("isDefinitiveCommandResponse", () => {
  it("treats a valid success envelope and a client rejection as definitive", () => {
    expect(isDefinitiveCommandResponse(
      new Response(null, { status: 201 }),
      { closeout: { id: "closeout-1" } },
      () => true,
    )).toBe(true);
    expect(isDefinitiveCommandResponse(
      new Response(null, { status: 409 }),
      { error: { code: "idempotency_conflict" } },
      () => false,
    )).toBe(true);
  });

  it.each([408, 425, 429, 500, 502, 503, 504])(
    "treats status %s as uncertain",
    (status) => {
      expect(isDefinitiveCommandResponse(
        new Response(null, { status }),
        null,
        () => false,
      )).toBe(false);
    },
  );

  it("treats malformed success payloads as uncertain", () => {
    expect(isDefinitiveCommandResponse(
      new Response(null, { status: 201 }),
      {},
      () => false,
    )).toBe(false);
  });

  it("requires operation-specific success fields before releasing a UUID", () => {
    expect(isOpenBottleSuccess({ open_bottle: {} })).toBe(false);
    expect(isOpenBottleSuccess({
      open_bottle: {
        id: "66666666-6666-4666-8666-666666666666",
        wine_id: "55555555-5555-4555-8555-555555555555",
        opened_at: "2026-09-23T12:00:00.000Z",
        remaining_ml: 600,
      },
    })).toBe(true);
    expect(isOpenBottleSuccess({
      open_bottle: {
        id: 123,
        wine_id: "55555555-5555-4555-8555-555555555555",
        opened_at: "not-a-date",
        remaining_ml: "bad",
      },
    })).toBe(false);
    expect(isCloseoutSuccess({ closeout: { id: "closeout-1" } })).toBe(false);
  });
});

function api() {
  if (!holder.current) throw new Error("Harness not rendered");
  return holder.current;
}
