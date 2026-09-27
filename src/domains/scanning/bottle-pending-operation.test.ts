import { describe, expect, it, vi } from "vitest";
import {
  BOTTLE_PENDING_STORAGE_KEY,
  beginPendingBottleOperation,
  clearPendingBottleOperation,
  readPendingBottleOperation,
  sendPendingBottleOperation,
  type BottlePendingDependencies,
} from "./bottle-pending-operation";

const USER_A = "11111111-1111-4111-8111-111111111111";
const USER_B = "22222222-2222-4222-8222-222222222222";
const SITE_A = "33333333-3333-4333-8333-333333333333";
const SITE_B = "44444444-4444-4444-8444-444444444444";
const OPERATION_A = "55555555-5555-4555-8555-555555555555";
const OPERATION_B = "66666666-6666-4666-8666-666666666666";

const wine = {
  name: "  Test Pinot Noir  ",
  producer: "  Test Producer  ",
  vintage: 2022,
  varietal: "Pinot Noir",
  region: "Willamette Valley",
  country: "United States",
  format: null,
  qty: 2,
  unitCost: 24.5,
};

describe("pending bottle operation persistence", () => {
  it("persists the exact scoped canonical operation before returning it", async () => {
    const storage = new MemoryStorage();
    const idFactory = vi.fn(() => OPERATION_A);
    const result = await beginPendingBottleOperation(
      { userId: USER_A, restaurantId: SITE_A, wine },
      dependencies(storage),
      idFactory,
    );

    expect(result).toEqual({
      ok: true,
      value: {
        version: 1,
        userId: USER_A,
        restaurantId: SITE_A,
        operationId: OPERATION_A,
        payload: { wine: { ...wine, name: "Test Pinot Noir", producer: "Test Producer" } },
      },
    });
    expect(JSON.parse(storage.getItem(BOTTLE_PENDING_STORAGE_KEY)!)).toEqual(result.ok && result.value);
    expect(idFactory).toHaveBeenCalledOnce();
  });

  it("restores only for the exact user and site without disclosing another context payload", async () => {
    const storage = new MemoryStorage();
    await beginPendingBottleOperation(
      { userId: USER_A, restaurantId: SITE_A, wine },
      dependencies(storage),
      () => OPERATION_A,
    );

    const own = await readPendingBottleOperation(
      { userId: USER_A, restaurantId: SITE_A },
      dependencies(storage),
    );
    expect(own.status).toBe("ready");

    for (const context of [
      { userId: USER_B, restaurantId: SITE_A },
      { userId: USER_A, restaurantId: SITE_B },
      { userId: null, restaurantId: SITE_A },
    ]) {
      const refused = await readPendingBottleOperation(context, dependencies(storage));
      expect(refused).toEqual({ status: "blocked", reason: "context_mismatch" });
      expect(JSON.stringify(refused)).not.toContain("24.5");
      expect(JSON.stringify(refused)).not.toContain("Test Pinot Noir");
    }
  });

  it("preserves malformed or extra-key records and fails closed", async () => {
    const storage = new MemoryStorage();
    for (const raw of [
      "{broken",
      JSON.stringify({
        version: 1,
        userId: USER_A,
        restaurantId: SITE_A,
        operationId: OPERATION_A,
        payload: { wine },
        unexpected: true,
      }),
    ]) {
      storage.setItem(BOTTLE_PENDING_STORAGE_KEY, raw);
      expect(await readPendingBottleOperation(
        { userId: USER_A, restaurantId: SITE_A },
        dependencies(storage),
      )).toEqual({ status: "blocked", reason: "corrupt" });
      expect(storage.getItem(BOTTLE_PENDING_STORAGE_KEY)).toBe(raw);
    }
  });

  it("does not overwrite an unresolved operation or mint a second key", async () => {
    const storage = new MemoryStorage();
    await beginPendingBottleOperation(
      { userId: USER_A, restaurantId: SITE_A, wine },
      dependencies(storage),
      () => OPERATION_A,
    );
    const before = storage.getItem(BOTTLE_PENDING_STORAGE_KEY);
    const secondId = vi.fn(() => OPERATION_B);

    expect(await beginPendingBottleOperation(
      { userId: USER_A, restaurantId: SITE_A, wine: { ...wine, qty: 3 } },
      dependencies(storage),
      secondId,
    )).toEqual({ ok: false, reason: "collision" });
    expect(secondId).not.toHaveBeenCalled();
    expect(storage.getItem(BOTTLE_PENDING_STORAGE_KEY)).toBe(before);

    expect(await beginPendingBottleOperation(
      { userId: USER_B, restaurantId: SITE_A, wine },
      dependencies(storage),
      secondId,
    )).toEqual({ ok: false, reason: "context_mismatch" });
    expect(secondId).not.toHaveBeenCalled();
    expect(storage.getItem(BOTTLE_PENDING_STORAGE_KEY)).toBe(before);
  });

  it("serializes simultaneous tabs so exactly one operation wins", async () => {
    const storage = new MemoryStorage();
    const lock = serializedLock();
    const firstId = vi.fn(() => OPERATION_A);
    const secondId = vi.fn(() => OPERATION_B);
    const [first, second] = await Promise.all([
      beginPendingBottleOperation(
        { userId: USER_A, restaurantId: SITE_A, wine },
        dependencies(storage, lock),
        firstId,
      ),
      beginPendingBottleOperation(
        { userId: USER_A, restaurantId: SITE_A, wine },
        dependencies(storage, lock),
        secondId,
      ),
    ]);

    expect(first).toMatchObject({ ok: true, value: { operationId: OPERATION_A } });
    expect(second).toEqual({ ok: false, reason: "collision" });
    expect(firstId).toHaveBeenCalledOnce();
    expect(secondId).not.toHaveBeenCalled();
  });

  it("refuses unavailable storage, unavailable locking, and failed readback", async () => {
    const unavailable = dependencies(null);
    const noLock: BottlePendingDependencies = {
      getStorage: () => new MemoryStorage(),
      withExclusiveLock: null,
    };
    const brokenReadback = new MemoryStorage();
    vi.spyOn(brokenReadback, "getItem").mockReturnValue(null);

    for (const deps of [unavailable, noLock, dependencies(brokenReadback)]) {
      expect(await beginPendingBottleOperation(
        { userId: USER_A, restaurantId: SITE_A, wine },
        deps,
        () => OPERATION_A,
      )).toEqual({ ok: false, reason: "unavailable" });
    }
  });

  it("clears only the exact valid operation and permits a new operation afterward", async () => {
    const storage = new MemoryStorage();
    await beginPendingBottleOperation(
      { userId: USER_A, restaurantId: SITE_A, wine },
      dependencies(storage),
      () => OPERATION_A,
    );

    expect(await clearPendingBottleOperation(
      { userId: USER_B, restaurantId: SITE_A, operationId: OPERATION_A },
      dependencies(storage),
    )).toEqual({ ok: false, reason: "context_mismatch" });
    expect(storage.getItem(BOTTLE_PENDING_STORAGE_KEY)).not.toBeNull();

    expect(await clearPendingBottleOperation(
      { userId: USER_A, restaurantId: SITE_A, operationId: OPERATION_A },
      dependencies(storage),
    )).toEqual({ ok: true });
    expect(storage.getItem(BOTTLE_PENDING_STORAGE_KEY)).toBeNull();

    expect(await beginPendingBottleOperation(
      { userId: USER_A, restaurantId: SITE_A, wine },
      dependencies(storage),
      () => OPERATION_B,
    )).toMatchObject({ ok: true, value: { operationId: OPERATION_B } });
  });

  it("re-reads the exact operation and latest context under the send lock", async () => {
    const storage = new MemoryStorage();
    const created = await beginPendingBottleOperation(
      { userId: USER_A, restaurantId: SITE_A, wine },
      dependencies(storage),
      () => OPERATION_A,
    );
    if (!created.ok) throw new Error("fixture operation was not created");
    const send = vi.fn(async () => "sent");

    expect(await sendPendingBottleOperation(
      created.value,
      () => ({ userId: USER_B, restaurantId: SITE_A }),
      send,
      dependencies(storage),
    )).toEqual({ ok: false, reason: "context_mismatch" });
    expect(send).not.toHaveBeenCalled();

    const replacementRaw = JSON.stringify({
      ...created.value,
      operationId: OPERATION_B,
    });
    storage.setItem(BOTTLE_PENDING_STORAGE_KEY, replacementRaw);
    expect(await sendPendingBottleOperation(
      created.value,
      () => ({ userId: USER_A, restaurantId: SITE_A }),
      send,
      dependencies(storage),
    )).toEqual({ ok: false, reason: "collision" });
    expect(storage.getItem(BOTTLE_PENDING_STORAGE_KEY)).toBe(replacementRaw);
    expect(send).not.toHaveBeenCalled();
  });
});

function dependencies(
  storage: Storage | null,
  withExclusiveLock = serializedLock(),
): BottlePendingDependencies {
  return { getStorage: () => storage, withExclusiveLock };
}

function serializedLock(): NonNullable<BottlePendingDependencies["withExclusiveLock"]> {
  let tail = Promise.resolve();
  return async <T>(callback: () => Promise<T>) => {
    const prior = tail;
    let release!: () => void;
    tail = new Promise<void>((resolve) => { release = resolve; });
    await prior;
    try {
      return await callback();
    } finally {
      release();
    }
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
