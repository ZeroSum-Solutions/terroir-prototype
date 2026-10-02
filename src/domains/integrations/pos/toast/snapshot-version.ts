import { encodeNormalizedSnapshotFrame, sha256Hex } from "./canonical-frame";
import { isToastTimestampToken } from "./contracts";
import { guardNormalizedSnapshot } from "./normalized-snapshot";
import type { SelectionObservation } from "./selections";

export type SnapshotVersion = Readonly<{
  eventTimestamp: string | null;
  maxModifiedTimestamp: string | null;
  normalizedContentDigest: string;
}>;

export type SnapshotComparison =
  | "supersedes"
  | "older"
  | "equivalent"
  | "conflict"
  | "needs_review";

export function digestNormalizedSnapshot(input: {
  orderGuid: string;
  orderVoided: boolean;
  selections: SelectionObservation[];
}) {
  return sha256Hex(encodeNormalizedSnapshotFrame(guardNormalizedSnapshot(input)));
}

function instant(value: string | null) {
  if (!value || !isToastTimestampToken(value)) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function compareSnapshotVersions(
  current: SnapshotVersion,
  candidate: SnapshotVersion,
): SnapshotComparison {
  const currentEvent = instant(current.eventTimestamp);
  const candidateEvent = instant(candidate.eventTimestamp);
  const currentModified = instant(current.maxModifiedTimestamp);
  const candidateModified = instant(candidate.maxModifiedTimestamp);
  if (
    currentEvent === null ||
    candidateEvent === null ||
    currentModified === null ||
    candidateModified === null
  ) {
    return "needs_review";
  }

  const eventDirection = Math.sign(candidateEvent - currentEvent);
  const modifiedDirection = Math.sign(candidateModified - currentModified);
  if (eventDirection === 0 && modifiedDirection === 0) {
    return candidate.normalizedContentDigest === current.normalizedContentDigest
      ? "equivalent"
      : "conflict";
  }
  if (eventDirection >= 0 && modifiedDirection >= 0) return "supersedes";
  if (eventDirection <= 0 && modifiedDirection <= 0) return "older";
  return "needs_review";
}

export function maximumModifiedTimestamp(input: {
  orderModifiedDate: string | null;
  checkModifiedDates: Array<string | null>;
  selectionModifiedDates: Array<string | null>;
}) {
  if (instant(input.orderModifiedDate) === null) return null;
  const candidates = [
    input.orderModifiedDate,
    ...input.checkModifiedDates,
    ...input.selectionModifiedDates,
  ].filter((value): value is string => value !== null && instant(value) !== null);
  return candidates.reduce((latest, value) =>
    instant(value)! > instant(latest)! ? value : latest,
  );
}
