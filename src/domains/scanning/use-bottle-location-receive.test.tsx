import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BottleLocationOperation } from "./bottle-location-pending-operation";
import { useBottleLocationReceive } from "./use-bottle-location-receive";

const mocks = vi.hoisted(() => ({ read: vi.fn(), begin: vi.fn(), send: vi.fn() }));
vi.mock("./bottle-location-pending-operation", () => ({
  readBottleLocationReceive: mocks.read,
  beginBottleLocationReceive: mocks.begin,
  sendBottleLocationReceive: mocks.send,
}));

const context = {
  userId: "11111111-1111-4111-8111-111111111111",
  restaurantId: "22222222-2222-4222-8222-222222222222",
};
const operation: BottleLocationOperation = {
  version: 1, kind: "bottle_location_receive", ...context,
  operationId: "33333333-3333-4333-8333-333333333333", sendState: "prepared",
  payload: { wine_id: "44444444-4444-4444-8444-444444444444", section: "Cellar", bin_id: "55555555-5555-4555-8555-555555555555" },
};
const receipt = {
  version: 1, kind: "bottle_location_receive", status: "committed", quantity: 1,
  operationId: operation.operationId, inventoryItemId: "66666666-6666-4666-8666-666666666666",
  wineId: operation.payload.wine_id, section: "Cellar", binId: operation.payload.bin_id, binCode: "A-1",
};
function callbacks() { return { onCommitted: vi.fn(), onReselect: vi.fn(), onWineReselect: vi.fn(), onRecoveryCleared: vi.fn() }; }

const mountedRoots: Array<{ root: Root; container: HTMLDivElement }> = [];
function renderHook<T, P = undefined>(callback: (props: P) => T, options?: { initialProps: P }) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  mountedRoots.push({ root, container });
  let current!: T;
  function Harness({ props }: { props: P }) { current = callback(props); return null; }
  const result = { get current() { return current; } };
  const rerender = (props: P) => { act(() => root.render(<Harness props={props} />)); };
  rerender(options?.initialProps as P);
  return { result, rerender };
}

async function waitFor(assertion: () => void) {
  for (let attempt = 0; attempt < 30; attempt++) {
    await act(async () => { await Promise.resolve(); });
    try { assertion(); return; } catch (error) { if (attempt === 29) throw error; }
  }
}

afterEach(() => {
  for (const { root, container } of mountedRoots.splice(0)) {
    act(() => root.unmount());
    container.remove();
  }
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  mocks.read.mockResolvedValue({ status: "empty" });
  mocks.begin.mockResolvedValue({ ok: true, operation });
  mocks.send.mockImplementation(async (_op, _latest, _transport, _dependencies, onResolved) => {
    const result = { status: "committed", receipt };
    onResolved(result);
    return result;
  });
});

describe("bottle location receiving hook", () => {
  it("checks durable recovery before accepting a new receive", async () => {
    const cb = callbacks();
    const { result } = renderHook(() => useBottleLocationReceive({ ...context, ...cb }));
    expect(result.current.state.phase).toBe("checking");
    await act(async () => { await result.current.save(operation.payload); });
    expect(mocks.begin).not.toHaveBeenCalled();
    await waitFor(() => expect(result.current.state.phase).toBe("empty"));
  });

  it("uses the prepared operation and announces a committed result once", async () => {
    const cb = callbacks();
    const { result } = renderHook(() => useBottleLocationReceive({ ...context, ...cb }));
    await waitFor(() => expect(result.current.state.phase).toBe("empty"));
    await act(async () => { await result.current.save(operation.payload); });
    expect(mocks.begin).toHaveBeenCalledWith(context, operation.payload);
    expect(mocks.send.mock.calls[0][0]).toEqual(operation);
    expect(cb.onCommitted).toHaveBeenCalledExactlyOnceWith(receipt);
    expect(result.current.state.phase).toBe("empty");
    expect(result.current.isSaving).toBe(false);
    expect("abandon" in result.current).toBe(false);
  });

  it("recovers a stored operation on reload and retries without preparing a new UUID", async () => {
    mocks.read.mockResolvedValue({ status: "ready", operation: { ...operation, sendState: "attempted" } });
    const cb = callbacks();
    const { result } = renderHook(() => useBottleLocationReceive({ ...context, ...cb }));
    await waitFor(() => expect(result.current.state.phase).toBe("ready"));
    await act(async () => { await result.current.retry(); });
    expect(mocks.begin).not.toHaveBeenCalled();
    expect(mocks.send.mock.calls[0][0].operationId).toBe(operation.operationId);
    expect(cb.onCommitted).toHaveBeenCalledOnce();
  });

  it("retains recovery and clear uncertainty guidance after a failed response", async () => {
    mocks.send.mockResolvedValue({ status: "pending" });
    const cb = callbacks();
    const { result } = renderHook(() => useBottleLocationReceive({ ...context, ...cb }));
    await waitFor(() => expect(result.current.state.phase).toBe("empty"));
    await act(async () => { await result.current.save(operation.payload); });
    expect(result.current.state.phase).toBe("ready");
    expect(result.current.message).toMatch(/not confirmed/i);
    expect(cb.onCommitted).not.toHaveBeenCalled();
    await act(async () => { await result.current.save(operation.payload); });
    expect(mocks.begin).toHaveBeenCalledOnce();
  });

  it("strict bin refusal returns preserved form intent without submitting a new operation", async () => {
    const intent = { wine_id: operation.payload.wine_id, section: "Cellar" };
    mocks.send.mockImplementation(async (_op, _latest, _transport, _dependencies, onResolved) => {
      const result = { status: "reselect", intent };
      onResolved(result);
      return result;
    });
    const cb = callbacks();
    const { result } = renderHook(() => useBottleLocationReceive({ ...context, ...cb }));
    await waitFor(() => expect(result.current.state.phase).toBe("empty"));
    await act(async () => { await result.current.save(operation.payload); });
    expect(cb.onReselect).toHaveBeenCalledExactlyOnceWith(intent);
    expect(cb.onCommitted).not.toHaveBeenCalled();
    expect(mocks.begin).toHaveBeenCalledOnce();
    expect(mocks.send).toHaveBeenCalledOnce();
  });

  it("blocks on corrupt storage and has a read-only recheck", async () => {
    mocks.read.mockResolvedValue({ status: "blocked", reason: "corrupt" });
    const { result } = renderHook(() => useBottleLocationReceive({ ...context, ...callbacks() }));
    await waitFor(() => expect(result.current.state.phase).toBe("blocked"));
    await act(async () => { await result.current.save(operation.payload); await result.current.retry(); });
    expect(mocks.begin).not.toHaveBeenCalled();
    expect(mocks.send).not.toHaveBeenCalled();
    mocks.read.mockResolvedValue({ status: "empty" });
    await act(async () => { await result.current.recheck(); });
    expect(result.current.state.phase).toBe("empty");
  });

  it("hands off missing-wine recovery without silently submitting a new receipt", async () => {
    mocks.send.mockImplementation(async (_op, _latest, _transport, _dependencies, onResolved) => {
      const result = { status: "reselect_wine", section: "Cellar" };
      onResolved(result);
      return result;
    });
    const cb = callbacks();
    const { result } = renderHook(() => useBottleLocationReceive({ ...context, ...cb }));
    await waitFor(() => expect(result.current.state.phase).toBe("empty"));
    await act(async () => { await result.current.save(operation.payload); });
    expect(cb.onWineReselect).toHaveBeenCalledExactlyOnceWith("Cellar");
    expect(cb.onCommitted).not.toHaveBeenCalled();
    expect(mocks.send).toHaveBeenCalledOnce();
    expect(result.current.state.phase).toBe("empty");
  });

  it("requires a fresh form after another tab resolves the pending receipt", async () => {
    mocks.send.mockResolvedValue({ status: "blocked", reason: "resolved_elsewhere" });
    const cb = callbacks();
    const { result } = renderHook(() => useBottleLocationReceive({ ...context, ...cb }));
    await waitFor(() => expect(result.current.state.phase).toBe("empty"));
    expect(cb.onRecoveryCleared).not.toHaveBeenCalled();
    await act(async () => { await result.current.save(operation.payload); });
    expect(result.current.state.phase).toBe("blocked");
    await act(async () => { await result.current.recheck(); });
    expect(cb.onRecoveryCleared).toHaveBeenCalledOnce();
    expect(result.current.state.phase).toBe("empty");
    expect(cb.onCommitted).not.toHaveBeenCalled();
  });

  it.each(["forbidden", "context_mismatch", "operation_conflict"])("keeps %s guidance on read-only recheck", async (reason) => {
    mocks.send.mockResolvedValue({ status: "blocked", reason });
    const cb = callbacks();
    const { result } = renderHook(() => useBottleLocationReceive({ ...context, ...cb }));
    await waitFor(() => expect(result.current.state.phase).toBe("empty"));
    await act(async () => { await result.current.save(operation.payload); });
    const refusal = result.current.message;
    mocks.read.mockResolvedValue({ status: "ready", operation });
    await act(async () => { await result.current.recheck(); });
    expect(result.current.message).toBe(refusal);
    expect(result.current.state.phase).toBe(reason === "operation_conflict" ? "blocked" : "ready");
    expect(cb.onRecoveryCleared).not.toHaveBeenCalled();
  });

  it("delivers completion inside the lock, before a context change while its promise settles", async () => {
    let finish!: (value: unknown) => void;
    mocks.send.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    const cb = callbacks();
    const { result, rerender } = renderHook((props) => useBottleLocationReceive({ ...props, ...cb }), { initialProps: context });
    await waitFor(() => expect(result.current.state.phase).toBe("empty"));
    let save!: Promise<void>;
    act(() => { save = result.current.save(operation.payload); });
    await waitFor(() => expect(mocks.send).toHaveBeenCalledOnce());
    act(() => mocks.send.mock.calls[0][4]({ status: "committed", receipt }));
    expect(cb.onCommitted).toHaveBeenCalledExactlyOnceWith(receipt);
    rerender({ ...context, restaurantId: context.userId });
    await act(async () => { finish({ status: "committed", receipt }); await save; });
    expect(cb.onCommitted).toHaveBeenCalledOnce();
  });

  it("prevents double taps and prepares no second operation while sending", async () => {
    let finish!: (value: unknown) => void;
    mocks.send.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    const cb = callbacks();
    const { result } = renderHook(() => useBottleLocationReceive({ ...context, ...cb }));
    await waitFor(() => expect(result.current.state.phase).toBe("empty"));
    let first!: Promise<void>;
    act(() => { first = result.current.save(operation.payload); });
    await waitFor(() => expect(mocks.send).toHaveBeenCalledOnce());
    await act(async () => { await result.current.save(operation.payload); await result.current.retry(); });
    expect(mocks.begin).toHaveBeenCalledOnce();
    await act(async () => {
      mocks.send.mock.calls[0][4]({ status: "committed", receipt });
      finish({ status: "committed", receipt });
      await first;
    });
    expect(cb.onCommitted).toHaveBeenCalledOnce();
  });

  it("passes the exact operation as HTTP body and expected-context headers", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}"));
    vi.stubGlobal("fetch", fetchMock);
    mocks.send.mockImplementation(async (op, latest, transport) => {
      expect(latest()).toEqual(context);
      await transport({ ...op, sendState: "attempted" });
      return { status: "pending" };
    });
    const { result } = renderHook(() => useBottleLocationReceive({ ...context, ...callbacks() }));
    await waitFor(() => expect(result.current.state.phase).toBe("empty"));
    await act(async () => { await result.current.save(operation.payload); });
    expect(fetchMock).toHaveBeenCalledWith("/api/scan-bottle/confirm", expect.objectContaining({
      method: "POST", body: JSON.stringify(operation.payload),
      headers: { "Content-Type": "application/json", "Idempotency-Key": operation.operationId,
        "X-Expected-User-Id": context.userId, "X-Expected-Restaurant-Id": context.restaurantId },
      signal: expect.any(AbortSignal),
    }));
  });

  it("bounds a hung request and keeps the same operation available for retry", async () => {
    const { result } = renderHook(() => useBottleLocationReceive({ ...context, ...callbacks() }));
    await waitFor(() => expect(result.current.state.phase).toBe("empty"));
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn((_url, init: RequestInit) => new Promise((_resolve, reject) => {
      init.signal?.addEventListener("abort", () => reject(new Error("aborted")));
    })));
    mocks.send.mockImplementation(async (op, _latest, transport) => {
      try { await transport(op); } catch { return { status: "pending" }; }
      throw new Error("Unexpected transport completion");
    });
    let save!: Promise<void>;
    act(() => { save = result.current.save(operation.payload); });
    await waitFor(() => expect(mocks.send).toHaveBeenCalledOnce());
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); await save; });
    expect(result.current.isSaving).toBe(false);
    expect(result.current.state).toMatchObject({ phase: "ready", operation: { operationId: operation.operationId } });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not deliver old-context completion to a newly selected site", async () => {
    let finish!: (value: unknown) => void;
    mocks.send.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    const cb = callbacks();
    const { result, rerender } = renderHook((props) => useBottleLocationReceive({ ...props, ...cb }), { initialProps: context });
    await waitFor(() => expect(result.current.state.phase).toBe("empty"));
    let save!: Promise<void>;
    act(() => { save = result.current.save(operation.payload); });
    await waitFor(() => expect(mocks.send).toHaveBeenCalledOnce());
    rerender({ ...context, restaurantId: context.userId });
    await act(async () => { finish({ status: "committed", receipt }); await save; });
    expect(cb.onCommitted).not.toHaveBeenCalled();
    expect(cb.onReselect).not.toHaveBeenCalled();
  });
});
