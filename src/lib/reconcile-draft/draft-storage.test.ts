import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearReconcileDraft,
  readReconcileDraft,
  reconcileDraftKey,
  writeReconcileDraft,
  type ReconcileDraftEntries,
} from "./draft-storage";

const entries: ReconcileDraftEntries = {
  "wine-1": { newRemainingMl: 200 },
  "wine-2": { newRemainingMl: 50, note: "spill" },
};

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
