import { describe, expect, it } from "vitest";

import { encodeManualSourceFrame } from "./canonical-frame";
import { MANUAL_SOURCE_INPUT } from "./canonical-frame-vectors.test-helper";

const invalidBooleans = [undefined, null, 0, 1, "", "false", {}, []] as const;
const fields = ["orderVoided", "deferred", "voided", "deleted", "refunded"] as const;

describe("manual normalized-snapshot boolean boundary", () => {
  it.each(fields.flatMap((field) => invalidBooleans.map((value) => [field, value] as const)))(
    "rejects non-boolean %s=%j before framing",
    (field, value) => {
      const normalizedSnapshotRecord = field === "orderVoided"
        ? { ...MANUAL_SOURCE_INPUT.normalizedSnapshotRecord, [field]: value }
        : {
            ...MANUAL_SOURCE_INPUT.normalizedSnapshotRecord,
            orderedSelections: MANUAL_SOURCE_INPUT.normalizedSnapshotRecord.orderedSelections.map(
              (selection, index) => index === 0
                ? { ...selection, [field]: value }
                : selection,
            ),
          };

      expect(() => encodeManualSourceFrame({
        ...MANUAL_SOURCE_INPUT,
        normalizedSnapshotRecord,
      } as never)).toThrowError(expect.objectContaining({
        code: "invalid_snapshot_boolean",
      }));
    },
  );

  it.each(fields)("rejects missing boolean %s before framing", (field) => {
    const record = structuredClone(MANUAL_SOURCE_INPUT.normalizedSnapshotRecord) as unknown as {
      orderVoided?: unknown;
      orderedSelections: Array<Record<string, unknown>>;
    };
    if (field === "orderVoided") delete record.orderVoided;
    else delete record.orderedSelections[0][field];

    expect(() => encodeManualSourceFrame({
      ...MANUAL_SOURCE_INPUT,
      normalizedSnapshotRecord: record,
    } as never)).toThrowError(expect.objectContaining({
      code: field === "orderVoided"
        ? "invalid_canonical_record"
        : "invalid_snapshot_boolean",
    }));
  });
});
