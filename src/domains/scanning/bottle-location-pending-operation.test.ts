import { describe, expect, it, vi } from "vitest";
import { BOTTLE_LOCATION_BIN_UNAVAILABLE_MESSAGE, BOTTLE_LOCATION_WINE_UNAVAILABLE_MESSAGE } from "@/lib/api/bottle-location-receive-contract";
import {
  BOTTLE_LOCATION_PENDING_STORAGE_KEY,
  beginBottleLocationReceive,
  readBottleLocationReceive,
  sendBottleLocationReceive,
  type BottleLocationDependencies,
  type BottleLocationOperation,
} from "./bottle-location-pending-operation";

const context = {
  userId: "11111111-1111-4111-8111-111111111111",
  restaurantId: "22222222-2222-4222-8222-222222222222",
};
const operationId = "33333333-3333-4333-8333-333333333333";
const payload = {
  wine_id: "44444444-4444-4444-8444-444444444444",
  section: "Main cellar",
  bin_id: "55555555-5555-4555-8555-555555555555",
};
const receipt = {
  version: 1, kind: "bottle_location_receive", status: "committed",
  operationId, wineId: payload.wine_id, section: payload.section,
  binId: payload.bin_id, binCode: "A-1", quantity: 1,
  inventoryItemId: "66666666-6666-4666-8666-666666666666",
};

function fixture() {
  const values = new Map<string, string>();
  const storage = {
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => { values.set(key, value); }),
    removeItem: vi.fn((key: string) => { values.delete(key); }),
  };
  let locked = false;
  const dependencies: BottleLocationDependencies = {
    getStorage: () => storage,
    withExclusiveLock: async (callback) => {
      expect(locked).toBe(false);
      locked = true;
      try { return await callback(); } finally { locked = false; }
    },
  };
  const begin = () => beginBottleLocationReceive(context, payload, dependencies, () => operationId);
  return { values, storage, dependencies, begin, isLocked: () => locked };
}

async function prepare(f: ReturnType<typeof fixture>): Promise<BottleLocationOperation> {
  const result = await f.begin();
  if (!result.ok) throw new Error("Fixture preparation failed");
  return result.operation;
}

function success(body: unknown = receipt, headers: HeadersInit = {
  "Idempotency-Key": operationId, "Idempotency-Replayed": "false",
}) {
  return new Response(JSON.stringify(body), { status: 201, headers });
}

function binUnavailable(body: unknown = {
  error: { code: "bin_unavailable", message: BOTTLE_LOCATION_BIN_UNAVAILABLE_MESSAGE },
}) {
  return new Response(JSON.stringify(body), { status: 409 });
}

describe("durable bottle-location receiving", () => {
  it("uses a dedicated namespace and persists/readbacks the exact prepared record", async () => {
    const f = fixture();
    const operation = await prepare(f);
    expect(BOTTLE_LOCATION_PENDING_STORAGE_KEY).toBe("terroir:pending-bottle-location-receive");
    expect(operation).toEqual({ version: 1, kind: "bottle_location_receive", ...context, operationId, sendState: "prepared", payload });
    expect(f.values.get(BOTTLE_LOCATION_PENDING_STORAGE_KEY)).toBe(JSON.stringify(operation));
    expect(await readBottleLocationReceive(context, f.dependencies)).toEqual({ status: "ready", operation });
  });

  it("normalizes section before persistence and rejects additional payload fields", async () => {
    const f = fixture();
    const input = { ...payload, section: "  Main cellar  " };
    const result = await beginBottleLocationReceive(context, input, f.dependencies, () => operationId);
    expect(result.ok && result.operation.payload.section).toBe("Main cellar");
    const other = fixture();
    expect(await beginBottleLocationReceive(context, { ...payload, quantity: 2 }, other.dependencies))
      .toEqual({ ok: false, reason: "invalid_payload" });
    expect(other.storage.setItem).not.toHaveBeenCalled();
  });

  it.each(["userId", "restaurantId"] as const)("blocks wrong %s without disclosing a pending payload", async (field) => {
    const f = fixture();
    await prepare(f);
    const changed = { ...context, [field]: "77777777-7777-4777-8777-777777777777" };
    expect(await readBottleLocationReceive(changed, f.dependencies)).toEqual({ status: "blocked", reason: "context_mismatch" });
    expect(await beginBottleLocationReceive(changed, payload, f.dependencies)).toEqual({ ok: false, reason: "context_mismatch" });
  });

  it("does not overwrite any existing operation", async () => {
    const f = fixture();
    const operation = await prepare(f);
    expect(await f.begin()).toEqual({ ok: false, reason: "collision" });
    expect(f.values.get(BOTTLE_LOCATION_PENDING_STORAGE_KEY)).toBe(JSON.stringify(operation));
  });

  it("treats corrupt or noncanonical storage as blocked", async () => {
    const f = fixture();
    const operation = await prepare(f);
    for (const raw of ["broken", JSON.stringify({ ...operation, cost: 50 }), JSON.stringify(operation, null, 2)]) {
      f.values.set(BOTTLE_LOCATION_PENDING_STORAGE_KEY, raw);
      expect(await readBottleLocationReceive(context, f.dependencies)).toEqual({ status: "blocked", reason: "corrupt" });
      expect(await f.begin()).toEqual({ ok: false, reason: "corrupt" });
    }
  });

  it("persists attempted state before sending while holding the exclusive lock", async () => {
    const f = fixture();
    const operation = await prepare(f);
    const transport = vi.fn(async (sent: BottleLocationOperation) => {
      expect(f.isLocked()).toBe(true);
      expect(sent.sendState).toBe("attempted");
      expect(f.values.get(BOTTLE_LOCATION_PENDING_STORAGE_KEY)).toBe(JSON.stringify(sent));
      return success();
    });
    expect(await sendBottleLocationReceive(operation, () => context, transport, f.dependencies))
      .toEqual({ status: "committed", receipt });
    expect(transport).toHaveBeenCalledOnce();
    expect(f.values.has(BOTTLE_LOCATION_PENDING_STORAGE_KEY)).toBe(false);
  });

  it("retries the exact operation after network failure without a replacement UUID", async () => {
    const f = fixture();
    const operation = await prepare(f);
    const first = vi.fn(async () => { throw new Error("offline"); });
    expect(await sendBottleLocationReceive(operation, () => context, first, f.dependencies)).toEqual({ status: "pending" });
    const pending = await readBottleLocationReceive(context, f.dependencies);
    expect(pending.status === "ready" && pending.operation.sendState).toBe("attempted");
    const retry = vi.fn(async (sent: BottleLocationOperation) => {
      expect(sent).toEqual({ ...operation, sendState: "attempted" });
      return success(receipt, { "Idempotency-Key": operationId, "Idempotency-Replayed": "true" });
    });
    expect(await sendBottleLocationReceive(operation, () => context, retry, f.dependencies)).toEqual({ status: "committed", receipt });
  });

  it.each(["no-lock", "storage", "lock", "attempt-write", "attempt-readback", "context", "collision"])(
    "sends nothing on %s failure",
    async (failure) => {
      const f = fixture();
      const operation = await prepare(f);
      let current: typeof context | null = context;
      if (failure === "no-lock") f.dependencies.withExclusiveLock = null;
      if (failure === "storage") f.dependencies.getStorage = () => null;
      if (failure === "lock") f.dependencies.withExclusiveLock = async () => { throw new Error("lock unavailable"); };
      if (failure === "attempt-write") f.storage.setItem.mockImplementation(() => { throw new Error("quota"); });
      if (failure === "attempt-readback") f.storage.setItem.mockImplementation(() => {});
      if (failure === "context") current = null;
      if (failure === "collision") f.values.set(BOTTLE_LOCATION_PENDING_STORAGE_KEY, JSON.stringify({ ...operation, payload: { ...payload, section: "Elsewhere" } }));
      const transport = vi.fn(async () => success());
      const result = await sendBottleLocationReceive(operation, () => current, transport, f.dependencies);
      expect(result.status).toBe("blocked");
      expect(transport).not.toHaveBeenCalled();
    },
  );

  it.each([
    () => new Response("unreadable", { status: 201 }),
    () => success({ ...receipt, quantity: 2 }),
    () => success({ ...receipt, wineId: context.userId }),
    () => success({ ...receipt, unit_cost: 40 }),
    () => success(receipt, {}),
    () => success(receipt, { "Idempotency-Key": context.userId, "Idempotency-Replayed": "false" }),
    () => success(receipt, { "Idempotency-Key": operationId, "Idempotency-Replayed": "maybe" }),
    () => new Response(JSON.stringify(receipt), { status: 200 }),
    () => new Response("{}", { status: 500 }),
    () => binUnavailable({ error: { code: "bin_unavailable", message: "unexpected message" } }),
    () => binUnavailable({ error: { code: "bin_unavailable", message: BOTTLE_LOCATION_BIN_UNAVAILABLE_MESSAGE, details: "extra" } }),
  ])("retains the original attempted record for every uncertain response", async (response) => {
    const f = fixture();
    const operation = await prepare(f);
    expect(await sendBottleLocationReceive(operation, () => context, async () => response(), f.dependencies)).toEqual({ status: "pending" });
    expect(JSON.parse(f.values.get(BOTTLE_LOCATION_PENDING_STORAGE_KEY)!)).toEqual({ ...operation, sendState: "attempted" });
    expect(f.storage.removeItem).not.toHaveBeenCalled();
  });

  it("only a strict bin-unavailable refusal clears and requests explicit reselection", async () => {
    const f = fixture();
    const operation = await prepare(f);
    expect(await sendBottleLocationReceive(operation, () => context, async () => binUnavailable(), f.dependencies))
      .toEqual({ status: "reselect", intent: { wine_id: payload.wine_id, section: payload.section } });
    expect(await readBottleLocationReceive(context, f.dependencies)).toEqual({ status: "empty" });
    const newId = "88888888-8888-4888-8888-888888888888";
    const next = await beginBottleLocationReceive(context, { ...payload, bin_id: context.userId }, f.dependencies, () => newId);
    expect(next.ok && next.operation.operationId).toBe(newId);
    expect(next.ok && next.operation.sendState).toBe("prepared");
  });

  it("clears only the exact proven-zero-effect wine refusal and requests explicit wine reselection", async () => {
    const f = fixture();
    const operation = await prepare(f);
    const onResolved = vi.fn();
    const response = Response.json({ error: { code: "wine_not_found", message: BOTTLE_LOCATION_WINE_UNAVAILABLE_MESSAGE } }, { status: 404 });
    expect(await sendBottleLocationReceive(operation, () => context, async () => response, f.dependencies, onResolved))
      .toEqual({ status: "reselect_wine", section: payload.section });
    expect(onResolved).toHaveBeenCalledExactlyOnceWith({ status: "reselect_wine", section: payload.section });
    expect(await readBottleLocationReceive(context, f.dependencies)).toEqual({ status: "empty" });
  });

  it.each([
    { status: 500, body: { error: { code: "wine_not_found", message: BOTTLE_LOCATION_WINE_UNAVAILABLE_MESSAGE } } },
    { status: 404, body: { error: { code: "wine_not_found", message: "not found" } } },
    { status: 404, body: { error: { code: "wine_not_found", message: BOTTLE_LOCATION_WINE_UNAVAILABLE_MESSAGE, details: {} } } },
  ])("retains an unproven wine refusal", async ({ status, body }) => {
    const f = fixture();
    const operation = await prepare(f);
    expect(await sendBottleLocationReceive(operation, () => context, async () => Response.json(body, { status }), f.dependencies))
      .toEqual({ status: "pending" });
    expect(f.storage.removeItem).not.toHaveBeenCalled();
  });

  it.each([
    [401, "unauthorized", "forbidden"],
    [403, "forbidden", "forbidden"],
    [409, "bottle_context_mismatch", "context_mismatch"],
    [409, "bottle_location_operation_conflict", "operation_conflict"],
  ])("retains refusal %s/%s with actionable recovery reason %s", async (status, code, reason) => {
    const f = fixture();
    const operation = await prepare(f);
    expect(await sendBottleLocationReceive(operation, () => context,
      async () => Response.json({ error: { code, message: "Refused" } }, { status: Number(status) }), f.dependencies))
      .toEqual({ status: "blocked", reason });
    expect(f.storage.removeItem).not.toHaveBeenCalled();
  });

  it.each(["committed", "reselect"])("does not report %s when clearing fails", async (kind) => {
    const f = fixture();
    const operation = await prepare(f);
    f.storage.removeItem.mockImplementation(() => {});
    const result = await sendBottleLocationReceive(operation, () => context,
      async () => kind === "committed" ? success() : binUnavailable(), f.dependencies);
    expect(result).toEqual({ status: "blocked", reason: "unavailable" });
    expect(f.values.has(BOTTLE_LOCATION_PENDING_STORAGE_KEY)).toBe(true);
  });

  it("retains the attempt when context switches during a successful response", async () => {
    const f = fixture();
    const operation = await prepare(f);
    let current = context;
    const result = await sendBottleLocationReceive(operation, () => current, async () => {
      current = { ...context, restaurantId: context.userId };
      return success();
    }, f.dependencies);
    expect(result).toEqual({ status: "blocked", reason: "context_mismatch" });
    expect(f.storage.removeItem).not.toHaveBeenCalled();
  });

  it.each(["no-lock", "storage", "lock", "write", "readback"])("cannot prepare a new receive on %s failure", async (failure) => {
    const f = fixture();
    if (failure === "no-lock") f.dependencies.withExclusiveLock = null;
    if (failure === "storage") f.dependencies.getStorage = () => null;
    if (failure === "lock") f.dependencies.withExclusiveLock = async () => { throw new Error("locked"); };
    if (failure === "write") f.storage.setItem.mockImplementation(() => { throw new Error("quota"); });
    if (failure === "readback") f.storage.setItem.mockImplementation(() => {});
    expect(await f.begin()).toEqual({ ok: false, reason: "unavailable" });
  });

  it("serializes two concurrent begins and retains exactly one operation", async () => {
    const f = fixture();
    f.dependencies.withExclusiveLock = queuedLock();
    const results = await Promise.all([f.begin(), f.begin()]);
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.filter((result) => !result.ok)).toEqual([{ ok: false, reason: "collision" }]);
    expect(f.storage.setItem).toHaveBeenCalledOnce();
  });

  it("serializes two concurrent sends and the second sends nothing after success", async () => {
    const f = fixture();
    f.dependencies.withExclusiveLock = queuedLock();
    const operation = await prepare(f);
    const transport = vi.fn(async () => success());
    const results = await Promise.all([
      sendBottleLocationReceive(operation, () => context, transport, f.dependencies),
      sendBottleLocationReceive(operation, () => context, transport, f.dependencies),
    ]);
    expect(transport).toHaveBeenCalledOnce();
    expect(results).toEqual([{ status: "committed", receipt }, { status: "blocked", reason: "resolved_elsewhere" }]);
  });

  it("delivers a validated receipt after clearing but before releasing the browser lock", async () => {
    const f = fixture();
    const operation = await prepare(f);
    const onResolved = vi.fn((result) => {
      expect(f.isLocked()).toBe(true);
      expect(f.values.has(BOTTLE_LOCATION_PENDING_STORAGE_KEY)).toBe(false);
      expect(result).toEqual({ status: "committed", receipt });
    });
    await sendBottleLocationReceive(operation, () => context, async () => success(), f.dependencies, onResolved);
    expect(onResolved).toHaveBeenCalledOnce();
  });

  it("does not deliver completion when context changes or durable removal fails", async () => {
    const f = fixture();
    const operation = await prepare(f);
    const onResolved = vi.fn();
    f.storage.removeItem.mockImplementation(() => {});
    await sendBottleLocationReceive(operation, () => context, async () => success(), f.dependencies, onResolved);
    expect(onResolved).not.toHaveBeenCalled();
    await sendBottleLocationReceive(operation, () => null, async () => success(), f.dependencies, onResolved);
    expect(onResolved).not.toHaveBeenCalled();
  });
});

function queuedLock(): NonNullable<BottleLocationDependencies["withExclusiveLock"]> {
  let queue: Promise<unknown> = Promise.resolve();
  return <T,>(callback: () => Promise<T>): Promise<T> => {
    const result = queue.then(callback);
    queue = result.catch(() => {});
    return result;
  };
}
