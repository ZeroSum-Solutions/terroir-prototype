type StoreName = "contexts" | "projections";
type MethodName = "getAll" | "put" | "clear";

type Faults = {
  open?: "blocked" | "denied" | "hang";
  extraStore?: string;
  hangRequest?: `${StoreName}.${MethodName}`;
  failRequest?: `${StoreName}.${MethodName}`;
  failPut?: (store: StoreName, value: unknown) => boolean;
  hangTransaction?: boolean;
  versionChangeOn?: `${StoreName}.${MethodName}`;
};

class FakeRequest<T> {
  result!: T;
  error: DOMException | null = null;
  onsuccess: ((event: Event) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
}

const keyFor = (keyPath: string | string[], value: Record<string, unknown>) =>
  JSON.stringify(
    (Array.isArray(keyPath) ? keyPath : [keyPath]).map((key) => value[key]),
  );

class FakeTransaction {
  error: DOMException | null = null;
  onabort: ((event: Event) => void) | null = null;
  oncomplete: ((event: Event) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  private active = true;
  private pending = 0;
  private completionQueued = false;
  private readonly working: Map<StoreName, Map<string, unknown>>;

  constructor(
    private readonly database: FakeDatabase,
    private readonly names: StoreName[],
    private readonly mode: IDBTransactionMode,
  ) {
    this.working = new Map(
      names.map((name) => [name, new Map(database.data.get(name) ?? [])]),
    );
  }

  objectStore(name: string) {
    if (!this.names.includes(name as StoreName)) throw new DOMException("Missing store", "NotFoundError");
    const store = name as StoreName;
    return new FakeObjectStore(this, store, this.database.keyPaths.get(store) ?? null);
  }

  request<T>(store: StoreName, method: MethodName, action: () => T, value?: unknown) {
    const request = new FakeRequest<T>();
    if (!this.active) throw new DOMException("Inactive transaction", "TransactionInactiveError");
    this.pending += 1;
    const operation = `${store}.${method}` as const;
    if (this.database.factory.faults.hangRequest === operation) {
      this.database.factory.observations.hungRequests.push(operation);
      return request;
    }

    queueMicrotask(() => {
      if (!this.active) return;
      if (this.database.factory.faults.versionChangeOn === operation) {
        this.database.factory.observations.versionChanges.push(operation);
        this.database.onversionchange?.({} as IDBVersionChangeEvent);
        return;
      }
      if (
        this.database.factory.faults.failRequest === operation ||
        (method === "put" && this.database.factory.faults.failPut?.(store, value))
      ) {
        request.error = new DOMException("Injected request failure", "QuotaExceededError");
        request.onerror?.({ preventDefault() {} } as unknown as Event);
        this.abort();
        return;
      }
      try {
        request.result = action();
        this.database.factory.observations.successfulRequests.push(operation);
        request.onsuccess?.({} as Event);
        this.pending -= 1;
        this.queueCompletion();
      } catch (error) {
        request.error = error instanceof DOMException
          ? error
          : new DOMException("Request failed", "UnknownError");
        request.onerror?.({ preventDefault() {} } as unknown as Event);
        this.abort();
      }
    });
    return request;
  }

  records(name: StoreName) {
    return this.working.get(name)!;
  }

  abort() {
    if (!this.active) return;
    this.active = false;
    this.database.factory.observations.abortedTransactions += 1;
    this.error = new DOMException("Transaction aborted", "AbortError");
    queueMicrotask(() => this.onabort?.({} as Event));
  }

  private queueCompletion() {
    if (this.completionQueued) return;
    if (this.database.factory.faults.hangTransaction) {
      this.database.factory.observations.suppressedCompletions += 1;
      return;
    }
    this.completionQueued = true;
    setTimeout(() => {
      this.completionQueued = false;
      if (!this.active || this.pending > 0) return;
      this.active = false;
      if (this.mode === "readwrite") {
        for (const name of this.names) {
          this.database.data.set(name, new Map(this.working.get(name)!));
        }
      }
      this.oncomplete?.({} as Event);
    }, 0);
  }
}

class FakeObjectStore {
  constructor(
    private readonly transaction: FakeTransaction,
    private readonly name: StoreName,
    readonly keyPath: string | string[] | null,
  ) {}

  getAll() {
    return this.transaction.request(this.name, "getAll", () =>
      [...this.transaction.records(this.name).values()].map((value) => structuredClone(value)),
    );
  }

  put(value: unknown) {
    return this.transaction.request(this.name, "put", () => {
      const record = structuredClone(value) as Record<string, unknown>;
      if (this.keyPath === null) throw new DOMException("Missing key path", "DataError");
      const keyPath = this.keyPath;
      this.transaction.records(this.name).set(keyFor(keyPath, record), record);
      return keyFor(keyPath, record);
    }, value);
  }

  clear() {
    return this.transaction.request(this.name, "clear", () => {
      this.transaction.records(this.name).clear();
      return undefined;
    });
  }
}

class FakeDatabase {
  version = 1;
  onversionchange: ((event: IDBVersionChangeEvent) => void) | null = null;
  readonly data = new Map<StoreName, Map<string, unknown>>();
  readonly keyPaths = new Map<StoreName, string | string[]>();

  constructor(readonly factory: MemoryIdbFactory) {}

  get objectStoreNames() {
    const names = [...this.data.keys(), ...(this.factory.faults.extraStore
      ? [this.factory.faults.extraStore]
      : [])];
    return {
      length: names.length,
      contains: (name: string) => names.includes(name as StoreName),
      item: (index: number) => names[index] ?? null,
      [Symbol.iterator]: () => names[Symbol.iterator](),
    } as unknown as DOMStringList;
  }

  createObjectStore(name: string, options?: IDBObjectStoreParameters) {
    this.data.set(name as StoreName, new Map());
    if (options?.keyPath) this.keyPaths.set(name as StoreName, options.keyPath);
    return {} as IDBObjectStore;
  }

  transaction(names: string | string[], mode: IDBTransactionMode = "readonly") {
    return new FakeTransaction(
      this,
      (Array.isArray(names) ? names : [names]) as StoreName[],
      mode,
    ) as unknown as IDBTransaction;
  }

  close() {}
}

export class MemoryIdbFactory {
  readonly faults: Faults = {};
  readonly observations = {
    abortedTransactions: 0,
    hungRequests: [] as string[],
    suppressedCompletions: 0,
    successfulRequests: [] as string[],
    versionChanges: [] as string[],
  };
  readonly database = new FakeDatabase(this);

  open(_name: string, version?: number) {
    const request = new FakeRequest<IDBDatabase>() as FakeRequest<IDBDatabase> & {
      onblocked: ((event: Event) => void) | null;
      onupgradeneeded: ((event: IDBVersionChangeEvent) => void) | null;
    };
    request.onblocked = null;
    request.onupgradeneeded = null;

    if (this.faults.open === "hang") return request as unknown as IDBOpenDBRequest;
    queueMicrotask(() => {
      if (this.faults.open === "blocked") {
        request.onblocked?.({} as Event);
        return;
      }
      if (this.faults.open === "denied" || (version && version < this.database.version)) {
        request.error = new DOMException("Open denied", "NotAllowedError");
        request.onerror?.({} as Event);
        return;
      }
      if (this.database.data.size === 0) {
        this.database.version = version ?? 1;
        request.result = this.database as unknown as IDBDatabase;
        request.onupgradeneeded?.({ oldVersion: 0, newVersion: version ?? 1 } as IDBVersionChangeEvent);
      }
      request.result = this.database as unknown as IDBDatabase;
      request.onsuccess?.({} as Event);
    });
    return request as unknown as IDBOpenDBRequest;
  }

  seed(store: StoreName, value: Record<string, unknown>) {
    if (!this.database.data.has(store)) this.database.data.set(store, new Map());
    const keyPath = store === "contexts"
      ? ["userId", "restaurantId"]
      : ["userId", "restaurantId", "projectionKind"];
    this.database.data.get(store)!.set(keyFor(keyPath, value), structuredClone(value));
  }

  rows(store: StoreName) {
    return [...(this.database.data.get(store)?.values() ?? [])].map((value) => structuredClone(value));
  }
}

export const asIdbFactory = (factory: MemoryIdbFactory) => factory as unknown as IDBFactory;
