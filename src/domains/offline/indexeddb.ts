export const OFFLINE_DATABASE_NAME = "terroir-offline";
export const OFFLINE_DATABASE_VERSION = 1;
export const OFFLINE_STORES = ["contexts", "projections"] as const;
export const STORE_KEY_PATHS = {
  contexts: ["userId", "restaurantId"],
  projections: ["userId", "restaurantId", "projectionKind"],
} as const;
const DEADLINE_MS = 1_500;
export type OfflineStoreName = (typeof OFFLINE_STORES)[number];
export type OfflineClock = { now: () => number; setTimeout: (callback: () => void, delay: number) => () => void };
export type IndexedDbOptions = { indexedDB?: IDBFactory; clock?: OfflineClock };
type DriverResult<T> = { ok: true; value: T } | { ok: false };
const defaultClock: OfflineClock = {
  now: Date.now,
  setTimeout: (callback, delay) => {
    const handle = globalThis.setTimeout(callback, delay);
    return () => globalThis.clearTimeout(handle);
  },
};
const hasKeyPath = (actual: IDBObjectStore["keyPath"], expected: readonly string[]) =>
  Array.isArray(actual) && actual.length === expected.length &&
  actual.every((part, index) => part === expected[index]);
export function resolveIndexedDbOptions(options: IndexedDbOptions = {}) {
  return {
    factory: options.indexedDB ?? globalThis.indexedDB,
    clock: options.clock ?? defaultClock,
  };
}
function bounded<T>(
  clock: OfflineClock,
  onDeadline: () => void,
  register: (resolve: (result: DriverResult<T>) => void) => void,
  disposeLateValue?: (value: T) => void,
): Promise<DriverResult<T>> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result: DriverResult<T>) => {
      if (settled) {
        if (result.ok) disposeLateValue?.(result.value);
        return;
      }
      settled = true;
      cancelDeadline();
      resolve(result);
    };
    const cancelDeadline = clock.setTimeout(() => {
      onDeadline();
      finish({ ok: false });
    }, DEADLINE_MS);
    register(finish);
  });
}
export async function openOfflineDatabase(
  factory: IDBFactory | undefined,
  clock: OfflineClock,
): Promise<DriverResult<IDBDatabase>> {
  if (!factory) return { ok: false };
  let request: IDBOpenDBRequest;
  try {
    request = factory.open(OFFLINE_DATABASE_NAME, OFFLINE_DATABASE_VERSION);
  } catch {
    return { ok: false };
  }
  return bounded(clock, () => undefined, (finish) => {
    request.onblocked = () => finish({ ok: false });
    request.onerror = () => finish({ ok: false });
    request.onupgradeneeded = (event) => {
      if (event.oldVersion !== 0 || event.newVersion !== OFFLINE_DATABASE_VERSION) {
        request.transaction?.abort();
        return;
      }
      request.result.createObjectStore("contexts", { keyPath: ["userId", "restaurantId"] });
      request.result.createObjectStore("projections", {
        keyPath: ["userId", "restaurantId", "projectionKind"],
      });
    };
    request.onsuccess = () => {
      const database = request.result;
      const names = [...database.objectStoreNames].sort();
      let keyPathsMatch = false;
      try {
        const transaction = database.transaction([...OFFLINE_STORES], "readonly");
        keyPathsMatch = OFFLINE_STORES.every((name) =>
          hasKeyPath(transaction.objectStore(name).keyPath, STORE_KEY_PATHS[name]));
      } catch { /* malformed existing database */ }
      if (!keyPathsMatch ||
        database.version !== OFFLINE_DATABASE_VERSION ||
        names.length !== OFFLINE_STORES.length ||
        OFFLINE_STORES.some((name, index) => name !== names[index])
      ) {
        database.close();
        finish({ ok: false });
        return;
      }
      finish({ ok: true, value: database });
    };
  }, (database) => database.close());
}
export function requestValue<T>(
  request: IDBRequest<T>,
  transaction: IDBTransaction,
  clock: OfflineClock,
) {
  return bounded<T>(clock, () => {
    try { transaction.abort(); } catch { /* already inactive */ }
  }, (finish) => {
    request.onsuccess = () => finish({ ok: true, value: request.result });
    request.onerror = (event) => {
      event.preventDefault();
      finish({ ok: false });
    };
  });
}

export async function runTransaction<T>(
  database: IDBDatabase,
  stores: OfflineStoreName[],
  mode: IDBTransactionMode,
  clock: OfflineClock,
  operation: (transaction: IDBTransaction) => Promise<DriverResult<T>>,
): Promise<DriverResult<T>> {
  let transaction: IDBTransaction;
  try {
    transaction = database.transaction(stores, mode);
  } catch {
    return { ok: false };
  }
  const completed = bounded<void>(clock, () => {
    try { transaction.abort(); } catch { /* already inactive */ }
  }, (finish) => {
    transaction.oncomplete = () => finish({ ok: true, value: undefined });
    transaction.onabort = () => finish({ ok: false });
    transaction.onerror = () => finish({ ok: false });
    database.onversionchange = () => {
      try { transaction.abort(); } catch { /* already inactive */ }
      database.close();
      finish({ ok: false });
    };
  });

  let value: DriverResult<T>;
  try {
    value = await operation(transaction);
  } catch {
    value = { ok: false };
  }
  if (!value.ok) {
    try { transaction.abort(); } catch { /* already inactive */ }
  }
  const committed = await completed;
  database.onversionchange = null;
  return value.ok && committed.ok ? value : { ok: false };
}
