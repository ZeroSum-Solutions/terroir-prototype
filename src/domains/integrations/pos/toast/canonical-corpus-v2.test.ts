import { describe, expect, it } from "vitest";

import {
  compareCanonicalBytes,
  encodeInterpretationRequestFrame,
  encodeManualSourceFrame,
  encodeNormalizedSnapshotFrame,
  frameHex,
  sha256Hex,
} from "./canonical-frame";
import {
  HIGH_BIT_SNAPSHOT,
  INTERPRETATION_ACCEPTED,
  INTERPRETATION_BASE,
  MANUAL_ACCEPTED,
  MANUAL_BASE,
} from "./canonical-corpus-v2.test-helper";
import {
  HIGH_BIT_EXPECTED_V2,
  INTERPRETATION_EXPECTED_V2,
  MANUAL_EXPECTED_V2,
} from "./canonical-corpus-v2-literals.test-helper";
import { decodeCanonicalFrame } from "./canonical-frame-decoder.test-helper";
import {
  oracleArrayFrame,
  oracleCompleteFrame,
  oracleDigest,
  oracleHex,
  oracleInterpretationFieldFrames,
  oracleInterpretationFrame,
  oracleInterpretationStructure,
  oracleManualFieldFrames,
  oracleManualFrame,
  oracleManualStructure,
  oracleNullFrame,
  oracleRecord,
  oracleSnapshotFrame,
  oracleSnapshotRoot,
  oracleTextFrame,
} from "./canonical-frame-oracle.test-helper";
import { ToastContractError } from "./contracts";
import { guardNormalizedSnapshot, selectMappedContributions } from "./selections";
import { selection } from "./canonical-frame-vectors.test-helper";

function expectCode(action: () => unknown, code: string): void {
  try {
    action();
  } catch (error) {
    expect(error).toBeInstanceOf(ToastContractError);
    expect((error as ToastContractError).code).toBe(code);
    return;
  }
  throw new Error(`expected ${code}`);
}

const wrongFrame = oracleRecord(0x7f, []);

describe("C08 v2 independent canonical corpus", () => {
  it.each(MANUAL_ACCEPTED)("pins literal frame and digest for $name", ({ name, input }) => {
    const expected = MANUAL_EXPECTED_V2[name];
    const oracle = oracleManualFrame(input);
    const production = encodeManualSourceFrame(input).frame;
    expect(oracleHex(oracle)).toBe(expected.frameHex);
    expect(oracleDigest(oracle)).toBe(expected.digestHex);
    expect(frameHex(production)).toBe(expected.frameHex);
    expect(sha256Hex(production)).toBe(expected.digestHex);
    const decoded = decodeCanonicalFrame(production);
    expect(decoded.domain).toBe(0x02);
    expect(decoded.root).toEqual(oracleManualStructure(input));
  });

  it.each(INTERPRETATION_ACCEPTED)(
    "pins literal frame and digest for $name",
    ({ name, input }) => {
      const expected = INTERPRETATION_EXPECTED_V2[name];
      const oracle = oracleInterpretationFrame(input);
      const production = encodeInterpretationRequestFrame(input);
      expect(oracleHex(oracle)).toBe(expected.frameHex);
      expect(oracleDigest(oracle)).toBe(expected.digestHex);
      expect(frameHex(production)).toBe(expected.frameHex);
      expect(sha256Hex(production)).toBe(expected.digestHex);
      const decoded = decodeCanonicalFrame(production);
      expect(decoded.domain).toBe(0x03);
      expect(decoded.root).toEqual(oracleInterpretationStructure(input));
    },
  );

  it("keeps every accepted corpus frame distinct", () => {
    const frames = [
      ...Object.values(MANUAL_EXPECTED_V2).map(({ frameHex: value }) => value),
      ...Object.values(INTERPRETATION_EXPECTED_V2).map(({ frameHex: value }) => value),
      HIGH_BIT_EXPECTED_V2.frameHex,
    ];
    expect(new Set(frames)).toHaveLength(frames.length);
  });

  it("preserves opaque provider GUID evidence byte-for-byte", () => {
    const entry = MANUAL_ACCEPTED.find(({ name }) => name === "manual_opaque_provider_changed");
    if (!entry) throw new Error("missing opaque provider corpus entry");
    const decoded = decodeCanonicalFrame(encodeManualSourceFrame(entry.input).frame);
    expect((decoded.root as unknown[])[2]).toBe("opaque-provider-guid");
  });

  it("sorts a high-bit UTF-8 discriminator using unsigned bytes", () => {
    const oracle = oracleSnapshotFrame(HIGH_BIT_SNAPSHOT);
    const production = encodeNormalizedSnapshotFrame(guardNormalizedSnapshot(HIGH_BIT_SNAPSHOT));
    expect(oracleHex(oracle)).toBe(HIGH_BIT_EXPECTED_V2.frameHex);
    expect(oracleDigest(oracle)).toBe(HIGH_BIT_EXPECTED_V2.digestHex);
    expect(frameHex(production)).toBe(HIGH_BIT_EXPECTED_V2.frameHex);
    expect(sha256Hex(production)).toBe(HIGH_BIT_EXPECTED_V2.digestHex);
    expect(compareCanonicalBytes(Uint8Array.of(0x7f), Uint8Array.of(0x80))).toBeLessThan(0);
    const selections = (decodeCanonicalFrame(production).root as unknown[])[2] as unknown[][];
    expect(selections.map((value) => value[9])).toEqual(["zz", "é"]);
  });

  it.each([0, 1, 2, 3, 4])("decoder rejects manual wrong tag at field %i", (index) => {
    const fields = [...oracleManualFieldFrames(MANUAL_BASE)];
    fields[index] = wrongFrame;
    const frame = oracleCompleteFrame(0x02, oracleRecord(0x22, fields));
    expect(() => decodeCanonicalFrame(frame)).toThrow(
      index === 4 ? "domain root or record tag mismatch" : "wrong scalar tag",
    );
  });

  it.each([0, 1, 4])("decoder rejects manual null at non-null field %i", (index) => {
    const fields = [...oracleManualFieldFrames(MANUAL_BASE)];
    fields[index] = oracleNullFrame();
    expect(() => decodeCanonicalFrame(
      oracleCompleteFrame(0x02, oracleRecord(0x22, fields)),
    )).toThrow("null in non-null field");
  });

  it.each([
    ["wrong_root", oracleRecord(0x7f, [])],
    ["wrong_count", oracleRecord(0x20, [oracleNullFrame(), oracleNullFrame()])],
    ["incomplete", oracleSnapshotRoot({
      orderGuid: MANUAL_BASE.normalizedSnapshotRecord.orderGuid,
      orderVoided: false,
      selections: MANUAL_BASE.normalizedSnapshotRecord.orderedSelections,
    }).slice(0, -1)],
  ] as const)("decoder rejects nested snapshot defect %s", (_name, nested) => {
    const fields = [...oracleManualFieldFrames(MANUAL_BASE)];
    fields[4] = nested;
    expect(() => decodeCanonicalFrame(
      oracleCompleteFrame(0x02, oracleRecord(0x22, fields)),
    )).toThrow();
  });

  it.each(Array.from({ length: 15 }, (_value, index) => index))(
    "decoder rejects interpretation wrong tag at field %i",
    (index) => {
      const fields = [...oracleInterpretationFieldFrames(INTERPRETATION_BASE)];
      fields[index] = wrongFrame;
      expect(() => decodeCanonicalFrame(
        oracleCompleteFrame(0x03, oracleRecord(0x23, fields)),
      )).toThrow(index === 5 ? "wrong array tag" : "wrong scalar tag");
    },
  );

  it.each([0, 1, 4, 5, 12])(
    "decoder rejects interpretation null at non-null field %i",
    (index) => {
      const fields = [...oracleInterpretationFieldFrames(INTERPRETATION_BASE)];
      fields[index] = oracleNullFrame();
      expect(() => decodeCanonicalFrame(
        oracleCompleteFrame(0x03, oracleRecord(0x23, fields)),
      )).toThrow("null in non-null field");
    },
  );

  it.each([
    ["null_element", oracleArrayFrame([oracleNullFrame()]), "null in non-null field"],
    ["wrong_element_tag", oracleArrayFrame([wrongFrame]), "wrong scalar tag"],
    ["unsorted", oracleArrayFrame([oracleTextFrame("bb"), oracleTextFrame("a")]),
      "unsorted canonical array"],
    ["duplicate", oracleArrayFrame([oracleTextFrame("a"), oracleTextFrame("a")]),
      "duplicate canonical scalar"],
  ] as const)("decoder rejects reason-array defect %s", (_name, reasons, message) => {
    const fields = [...oracleInterpretationFieldFrames(INTERPRETATION_BASE)];
    fields[5] = reasons;
    expect(() => decodeCanonicalFrame(
      oracleCompleteFrame(0x03, oracleRecord(0x23, fields)),
    )).toThrow(message);
  });

  it("records non-empty caller reasons as a named rejection", () => {
    expectCode(
      () => encodeInterpretationRequestFrame({
        ...INTERPRETATION_BASE,
        sortedReasonCodeArray: ["reason_coded_manual_review"],
      }),
      "unknown_caller_reason",
    );
  });

  it.each([
    ["manual_nul", { ...MANUAL_BASE, providerRestaurantGuid: "a\0b" }],
    ["manual_lone_high_surrogate", {
      ...MANUAL_BASE,
      normalizedSnapshotRecord: {
        ...MANUAL_BASE.normalizedSnapshotRecord,
        orderedSelections: [selection("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", {
          unit: "\ud800",
        })],
      },
    }],
    ["manual_lone_low_surrogate", {
      ...MANUAL_BASE,
      normalizedSnapshotRecord: {
        ...MANUAL_BASE.normalizedSnapshotRecord,
        orderedSelections: [selection("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", {
          unit: "\udc00",
        })],
      },
    }],
  ] as const)("records invalid Unicode %s as a named rejection", (_name, input) => {
    expectCode(() => encodeManualSourceFrame(input), "invalid_canonical_text");
  });

  it.each([
    ["missing_selector", { sourceSelectionGuid: null }],
    ["unreviewed", { approvalState: "unreviewed" }],
    ["mapping_field", { sourceUnit: "ML" }],
  ] as const)("records invalid service tuple %s as a named rejection", (_name, change) => {
    const service = INTERPRETATION_ACCEPTED.find(
      ({ name }) => name === "interpretation_decision_service_alternative",
    );
    if (!service) throw new Error("missing service corpus entry");
    expectCode(
      () => encodeInterpretationRequestFrame({ ...service.input, ...change } as never),
      "invalid_service_classification",
    );
  });

  it("rejects mapping fields on after_service classification", () => {
    const before = INTERPRETATION_ACCEPTED.find(
      ({ name }) => name === "interpretation_decision_service_alternative",
    );
    const service = INTERPRETATION_ACCEPTED.find(
      ({ name }) => name === "interpretation_decision_after_service",
    );
    if (!before || !service) throw new Error("missing service decision corpus entry");
    expect(Object.keys(service.input).filter(
      (field) => service.input[field as keyof typeof service.input] !==
        before.input[field as keyof typeof before.input],
    )).toEqual(["decision"]);
    expectCode(
      () => encodeInterpretationRequestFrame({ ...service.input, sourceUnit: "ML" }),
      "invalid_service_classification",
    );
  });

  it("proves manual framing cannot bypass shared normalization", () => {
    const upper = "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA";
    const lower = upper.toLowerCase();
    const manual = encodeManualSourceFrame({
      ...MANUAL_BASE,
      normalizedSnapshotRecord: {
        ...MANUAL_BASE.normalizedSnapshotRecord,
        orderedSelections: [selection(upper), selection(lower)],
      },
    });
    expect(manual).toMatchObject({
      incomplete: true,
      issues: ["duplicate_selection_guid"],
    });
    expect(selectMappedContributions(manual.normalizedSnapshot, new Map([
      ["cccccccc-cccc-4ccc-8ccc-cccccccccccc", "liquid-1"],
    ]))).toEqual({ contributions: [], issues: ["duplicate_selection_guid"] });

    if (false) {
      // @ts-expect-error raw snapshots cannot bypass the module-private guard brand
      encodeNormalizedSnapshotFrame({ orderGuid: lower, orderVoided: false, selections: [] });
    }
  });
});
