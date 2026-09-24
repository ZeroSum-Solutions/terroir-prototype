const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})$/;

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
  const selections = input.selections
    .map((selection) => ({
      guid: selection.guid,
      itemGuid: selection.itemGuid,
      checkGuid: selection.checkGuid,
      parentGuid: selection.parentGuid,
      depth: selection.depth,
      quantityToken: selection.quantityToken,
      unit: selection.unit,
      createdDate: selection.createdDate,
      modifiedDate: selection.modifiedDate,
      fulfillmentStatus: selection.fulfillmentStatus,
      selectionType: selection.selectionType,
      splitOriginGuid: selection.splitOriginGuid,
      deferred: selection.deferred,
      voided: selection.voided,
      deleted: selection.deleted,
      refunded: selection.refunded,
      excludedReason: selection.excludedReason,
    }))
    .sort((left, right) =>
      (left.guid ?? "").localeCompare(right.guid ?? "") ||
      (left.parentGuid ?? "").localeCompare(right.parentGuid ?? ""));
  return createHash("sha256")
    .update(JSON.stringify({
      orderGuid: input.orderGuid,
      orderVoided: input.orderVoided,
      selections,
    }))
    .digest("hex");
}

function instant(value: string | null) {
  if (!value || !ISO_INSTANT.test(value)) return null;
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
import { createHash } from "node:crypto";

import { SelectionObservation } from "./selections";
