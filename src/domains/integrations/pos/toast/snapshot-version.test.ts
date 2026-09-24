import { describe, expect, it } from "vitest";

import {
  compareSnapshotVersions,
  digestNormalizedSnapshot,
  maximumModifiedTimestamp,
} from "./snapshot-version";
import { SelectionObservation } from "./selections";

const version = (
  eventTimestamp: string | null,
  maxModifiedTimestamp: string | null,
  normalizedContentDigest = "same",
) => ({ eventTimestamp, maxModifiedTimestamp, normalizedContentDigest });

describe("Toast snapshot partial order", () => {
  it.each([
    ["supersedes", version("2024-01-02T00:00:00Z", "2024-01-02T00:00:00Z")],
    ["older", version("2023-12-31T00:00:00Z", "2023-12-31T00:00:00Z")],
    ["equivalent", version("2024-01-01T00:00:00Z", "2024-01-01T00:00:00Z")],
    ["conflict", version("2024-01-01T00:00:00Z", "2024-01-01T00:00:00Z", "changed")],
    ["needs_review", version("2024-01-02T00:00:00Z", "2023-12-31T00:00:00Z")],
  ])("returns %s without a receipt-order tie-break", (expected, candidate) => {
    expect(compareSnapshotVersions(
      version("2024-01-01T00:00:00Z", "2024-01-01T00:00:00Z"),
      candidate,
    )).toBe(expected);
  });

  it("requires both source clocks and requires the order modification clock", () => {
    expect(compareSnapshotVersions(
      version("2024-01-01T00:00:00Z", null),
      version("2024-01-02T00:00:00Z", "2024-01-02T00:00:00Z"),
    )).toBe("needs_review");
    expect(maximumModifiedTimestamp({
      orderModifiedDate: null,
      checkModifiedDates: ["2024-01-03T00:00:00Z"],
      selectionModifiedDates: [],
    })).toBeNull();
  });

  it("uses the maximum valid order, check, or selection modification time", () => {
    expect(maximumModifiedTimestamp({
      orderModifiedDate: "2024-01-01T00:00:00Z",
      checkModifiedDates: ["2024-01-03T00:00:00Z", "invalid"],
      selectionModifiedDates: ["2024-01-02T00:00:00Z"],
    })).toBe("2024-01-03T00:00:00Z");
  });

  it("digests allowlisted normalized content and preserves exact quantity/check provenance", () => {
    const selection: SelectionObservation = {
      guid: "selection-1",
      itemGuid: "item-1",
      checkGuid: "check-1",
      parentGuid: null,
      depth: 0,
      quantityToken: "1.00",
      unit: "ML",
      createdDate: "2024-01-01T00:00:00Z",
      modifiedDate: "2024-01-01T00:00:00Z",
      fulfillmentStatus: "SENT",
      selectionType: "NONE",
      splitOriginGuid: null,
      deferred: false,
      voided: false,
      deleted: false,
      refunded: false,
      excludedReason: null,
    };
    const first = digestNormalizedSnapshot({
      orderGuid: "order-1",
      orderVoided: false,
      selections: [selection],
    });
    expect(digestNormalizedSnapshot({
      orderGuid: "order-1",
      orderVoided: false,
      selections: [{ ...selection, quantityToken: "1.0" }],
    })).not.toBe(first);
    expect(digestNormalizedSnapshot({
      orderGuid: "order-1",
      orderVoided: false,
      selections: [{ ...selection, checkGuid: "check-2" }],
    })).not.toBe(first);
  });
});
