import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearReconcileDraft,
  describeReconcileDraft,
  persistPhysicalReconcileDraft,
  readReconcileDraft,
  reconcileDraftKey,
  writeReconcileDraft,
  type PhysicalReconcileDraft,
  type ReconcileDraftEntries,
} from "./draft-storage";

const entries: ReconcileDraftEntries = {
  "wine-1": { newRemainingMl: 200 },
  "wine-2": { newRemainingMl: 50, note: "spill" },
};

function mockSessionStorage(overrides: Partial<Storage>) {
  const actual = window.sessionStorage;
  const storage: Storage = {
    get length() { return actual.length; },
    clear: actual.clear.bind(actual),
    getItem: actual.getItem.bind(actual),
    key: actual.key.bind(actual),
    removeItem: actual.removeItem.bind(actual),
    setItem: actual.setItem.bind(actual),
    ...overrides,
  };
  return vi.spyOn(window, "sessionStorage", "get").mockReturnValue(storage);
}

beforeEach(() => {
  sessionStorage.clear();
  vi.useRealTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("reconcileDraftKey", () => {
  it("namespaces by both restaurantId and userId", () => {
    expect(reconcileDraftKey("r1", "u1")).toBe("terroir:reconcile-draft:r1:u1");
    expect(reconcileDraftKey("r1", "u1")).not.toBe(reconcileDraftKey("r1", "u2"));
    expect(reconcileDraftKey("r1", "u1")).not.toBe(reconcileDraftKey("r2", "u1"));
  });
});

describe("write/read round trip", () => {
  it("restores exactly what was written", () => {
    writeReconcileDraft("r1", "u1", entries);
    const result = readReconcileDraft("r1", "u1");
    expect(result).toEqual({ kind: "restored", entries, count: 2 });
  });

  it("reads as none when nothing was ever written", () => {
    expect(readReconcileDraft("r1", "u1")).toEqual({ kind: "none" });
  });

  it("writing an empty object clears any existing draft", () => {
    writeReconcileDraft("r1", "u1", entries);
    writeReconcileDraft("r1", "u1", {});
    expect(readReconcileDraft("r1", "u1")).toEqual({ kind: "none" });
  });

  it("clearReconcileDraft removes the draft outright", () => {
    writeReconcileDraft("r1", "u1", entries);
    clearReconcileDraft("r1", "u1");
    expect(readReconcileDraft("r1", "u1")).toEqual({ kind: "none" });
  });
});

describe("physical reconciliation drafts", () => {
  const bottleA = "00000000-0000-4000-8000-00000000000f";
  const bottleB = "00000000-0000-4000-8000-000000000010";
  const operationId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const draft: PhysicalReconcileDraft = {
    version: 2,
    entries: {
      [bottleA]: { expectedStateVersion: 3, targetRemainingMl: 120, note: null },
      [bottleB]: { expectedStateVersion: 8, targetRemainingMl: 240, note: "counted" },
    },
    frozenOperation: {
      operationId,
      payload: JSON.stringify({ entries: [
        { open_bottle_id: bottleA, expected_state_version: 3, target_remaining_ml: 120, note: null },
        { open_bottle_id: bottleB, expected_state_version: 8, target_remaining_ml: 240, note: "counted" },
      ] }),
    },
  };

  it("restores the exact bottle versions and frozen operation payload", () => {
    writeReconcileDraft("r1", "u1", draft);
    const restored = readReconcileDraft("r1", "u1", 2);
    expect(restored).toEqual({
      kind: "restored-physical",
      draft,
      count: 2,
    });
    expect(describeReconcileDraft(restored)).toMatchObject({ canUndo: false });
  });

  it("clears old wine-keyed and malformed physical drafts at the v2 boundary", () => {
    writeReconcileDraft("r1", "u1", entries);
    expect(readReconcileDraft("r1", "u1", 2)).toEqual({ kind: "none" });
    expect(sessionStorage.getItem(reconcileDraftKey("r1", "u1"))).toBeNull();

    sessionStorage.setItem(reconcileDraftKey("r1", "u1"), JSON.stringify({
      savedAt: Date.now(),
      version: 2,
      entries: draft.entries,
      frozenOperation: { operationId, payload: "{\"entries\":[]}" },
    }));
    expect(readReconcileDraft("r1", "u1", 2)).toEqual({ kind: "none" });
    expect(sessionStorage.getItem(reconcileDraftKey("r1", "u1"))).toBeNull();
  });

  it("does not restore a v2 bottle draft into the legacy wine-keyed UI", () => {
    writeReconcileDraft("r1", "u1", draft);
    expect(readReconcileDraft("r1", "u1", 1)).toEqual({ kind: "none" });
  });

  it("never expires an unresolved frozen physical operation", () => {
    const now = Date.parse("2026-09-24T00:00:00Z");
    vi.useFakeTimers();
    vi.setSystemTime(now);
    writeReconcileDraft("r1", "u1", draft);
    vi.setSystemTime(now + 13 * 60 * 60 * 1000);
    expect(readReconcileDraft("r1", "u1", 2)).toMatchObject({
      kind: "restored-physical",
      draft: { frozenOperation: { operationId } },
    });
  });

  it("reports synchronous persistence failure when storage cannot write or verify", () => {
    const setSpy = mockSessionStorage({ setItem: () => {
      throw new Error("QuotaExceededError");
    } });
    expect(persistPhysicalReconcileDraft("r1", "u1", draft)).toBe(false);
    setSpy.mockRestore();

    const getSpy = mockSessionStorage({ getItem: () => {
      throw new Error("SecurityError");
    } });
    expect(persistPhysicalReconcileDraft("r1", "u1", draft)).toBe(false);
    getSpy.mockRestore();
  });
});

describe("tenant isolation", () => {
  it("a draft written under (restaurantA, userA) is invisible under (restaurantB, userA)", () => {
    writeReconcileDraft("restaurantA", "userA", entries);
    expect(readReconcileDraft("restaurantB", "userA")).toEqual({ kind: "none" });
    // and remains readable under its own identity
    expect(readReconcileDraft("restaurantA", "userA").kind).toBe("restored");
  });

  it("a draft written under (restaurantA, userA) is invisible under (restaurantA, userB)", () => {
    writeReconcileDraft("restaurantA", "userA", entries);
    expect(readReconcileDraft("restaurantA", "userB")).toEqual({ kind: "none" });
  });
});

describe("freshness (TTL)", () => {
  it("a draft older than the TTL reads as expired and is cleared", () => {
    const now = Date.parse("2026-09-08T12:00:00Z");
    vi.useFakeTimers();
    vi.setSystemTime(now);
    writeReconcileDraft("r1", "u1", entries);

    // 13 hours later — past the 12h TTL.
    vi.setSystemTime(now + 13 * 60 * 60 * 1000);
    expect(readReconcileDraft("r1", "u1")).toEqual({ kind: "expired", count: 2 });
    // Expiry clears it — a second read is just "none", not "expired" again.
    expect(readReconcileDraft("r1", "u1")).toEqual({ kind: "none" });
  });

  it("a draft just under the TTL still restores", () => {
    const now = Date.parse("2026-09-08T12:00:00Z");
    vi.useFakeTimers();
    vi.setSystemTime(now);
    writeReconcileDraft("r1", "u1", entries);

    vi.setSystemTime(now + 11 * 60 * 60 * 1000);
    expect(readReconcileDraft("r1", "u1").kind).toBe("restored");
  });
});

describe("storage failures degrade harmlessly", () => {
  it("a throwing getItem makes read report no draft instead of throwing", () => {
    const spy = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("SecurityError: storage disabled");
    });
    expect(() => readReconcileDraft("r1", "u1")).not.toThrow();
    expect(readReconcileDraft("r1", "u1")).toEqual({ kind: "none" });
    spy.mockRestore();
  });

  it("a throwing setItem makes write a no-op instead of throwing", () => {
    const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    expect(() => writeReconcileDraft("r1", "u1", entries)).not.toThrow();
    spy.mockRestore();
  });

  it("a throwing removeItem makes clear a no-op instead of throwing", () => {
    writeReconcileDraft("r1", "u1", entries);
    const spy = vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    expect(() => clearReconcileDraft("r1", "u1")).not.toThrow();
    spy.mockRestore();
  });

  it("corrupt JSON in storage reads as none rather than throwing", () => {
    sessionStorage.setItem(reconcileDraftKey("r1", "u1"), "{not json");
    expect(readReconcileDraft("r1", "u1")).toEqual({ kind: "none" });
  });

  it("well-formed but shape-invalid JSON reads as none", () => {
    sessionStorage.setItem(reconcileDraftKey("r1", "u1"), JSON.stringify({ foo: "bar" }));
    expect(readReconcileDraft("r1", "u1")).toEqual({ kind: "none" });
  });
});
