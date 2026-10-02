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
      guid: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      itemGuid: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      checkGuid: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
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
    const input = {
      orderGuid: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      orderVoided: false,
      selections: [selection],
    };
    const first = digestNormalizedSnapshot(input);
    expect(first).toBe("84188dc294007ccaaaafca7ea9d6d5b41ceb98148299b0a6c4cb5c87f154121a");
    const quantityChanged = digestNormalizedSnapshot({
      orderGuid: input.orderGuid,
      orderVoided: false,
      selections: [{ ...selection, quantityToken: "1.0" }],
    });
    const checkChanged = digestNormalizedSnapshot({
      orderGuid: input.orderGuid,
      orderVoided: false,
      selections: [{
        ...selection,
        checkGuid: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
      }],
    });
    expect(quantityChanged).not.toBe(first);
    expect(checkChanged).not.toBe(first);
    expect(quantityChanged).not.toBe(checkChanged);

    const second = { ...selection, guid: "ffffffff-ffff-4fff-8fff-ffffffffffff" };
    expect(digestNormalizedSnapshot({ ...input, selections: [selection, second] }))
      .toBe(digestNormalizedSnapshot({ ...input, selections: [second, selection] }));
    expect(digestNormalizedSnapshot({ ...input, selections: [selection, selection] }))
      .not.toBe(first);
  });
});
