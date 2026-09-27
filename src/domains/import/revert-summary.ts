export type RevertResult = {
  revertedCount: number;
  orphanWinesDeleted: 0;
  lwinStampsCleared: number;
};

export function parseRevertResult(value: unknown): RevertResult | null {
  if (!isRecord(value) || !hasExactKeys(value, [
    "revertedCount",
    "orphanWinesDeleted",
    "lwinStampsCleared",
  ])) return null;
  if (
    !isCount(value.revertedCount) ||
    value.orphanWinesDeleted !== 0 ||
    !isCount(value.lwinStampsCleared)
  ) return null;
  return {
    revertedCount: value.revertedCount,
    orphanWinesDeleted: 0,
    lwinStampsCleared: value.lwinStampsCleared,
  };
}

export function summarizeRevertResult(result: RevertResult): string {
  return `Removed ${result.revertedCount} inventory row(s) this import created and cleared ` +
    `${result.lwinStampsCleared} eligible wine-catalog (LWIN) link(s). ` +
    "Wine catalog entries and import history were retained.";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, expected: string[]): boolean {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return actual.length === sortedExpected.length &&
    actual.every((key, index) => key === sortedExpected[index]);
}

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}
