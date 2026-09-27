import { describe, expect, it } from "vitest";
import {
  parseRevertResult,
  summarizeRevertResult,
  type RevertResult,
} from "./revert-summary";

const result: RevertResult = {
  revertedCount: 3,
  orphanWinesDeleted: 0,
  lwinStampsCleared: 2,
};

describe("parseRevertResult", () => {
  it("accepts the exact compatible retained-catalog response", () => {
    expect(parseRevertResult(result)).toEqual(result);
  });

  it.each([
    null,
    { ...result, extra: true },
    { ...result, revertedCount: -1 },
    { ...result, orphanWinesDeleted: 1 },
    { ...result, lwinStampsCleared: 0.5 },
  ])("rejects malformed or partial-success response %#", (value) => {
    expect(parseRevertResult(value)).toBeNull();
  });
});

describe("summarizeRevertResult", () => {
  it("reports committed counts and makes catalog retention explicit", () => {
    const copy = summarizeRevertResult(result);
    expect(copy).toContain("Removed 3 inventory row(s)");
    expect(copy).toContain("cleared 2 eligible wine-catalog (LWIN) link(s)");
    expect(copy).toContain("Wine catalog entries and import history were retained");
    expect(copy).not.toContain("deleted");
    expect(copy).not.toContain("partial");
    expect(copy).not.toContain("runbook");
  });
});
