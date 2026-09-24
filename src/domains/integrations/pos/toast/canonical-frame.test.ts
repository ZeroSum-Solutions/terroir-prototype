import { describe, expect, it } from "vitest";

import {
  INTERPRETATION_FIELDS,
  INTERPRETATION_APPROVAL_STATES,
  INTERPRETATION_CALLER_REASON_CODES,
  INTERPRETATION_DECISIONS,
  INTERPRETATION_DERIVED_RESULT_REASONS,
  MANUAL_SOURCE_FIELDS,
  SELECTION_FIELDS,
  SNAPSHOT_FIELDS,
  type InterpretationRequestInput,
  encodeInterpretationRequestFrame,
  encodeManualSourceFrame,
  encodeNormalizedSnapshotFrame,
  frameHex,
  sha256Hex,
} from "./canonical-frame";
import { decodeCanonicalFrame } from "./canonical-frame-decoder.test-helper";
import {
  EXPECTED_V1,
  INTERPRETATION_INPUT,
  MANUAL_SOURCE_INPUT,
  SNAPSHOT_INPUT,
  selection,
} from "./canonical-frame-vectors.test-helper";
import {
  TOAST_CANONICAL_COLLECTION_LIMIT,
  TOAST_CANONICAL_TEXT_LIMIT_BYTES,
  TOAST_MODIFIER_DEPTH_LIMIT,
  TOAST_NUMBER_TOKEN_LIMIT,
  ToastContractError,
} from "./contracts";
import { guardNormalizedSnapshot, selectMappedContributions } from "./selections";
import type { SelectionObservation } from "./normalized-snapshot";

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

function bytes(...parts: Uint8Array[]): Uint8Array {
  const length = parts.reduce((sum, part) => sum + part.length, 0);
  const result = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

function textFrame(value: string): Uint8Array {
  const payload = new TextEncoder().encode(value);
  return bytes(
    Uint8Array.of(0x04, 0, 0, payload.length >>> 8, payload.length),
    payload,
  );
}

function replaceNeedle(
  source: Uint8Array,
  needle: Uint8Array,
  replacement: Uint8Array,
): Uint8Array {
  const offset = source.findIndex((_value, candidate) => (
    candidate + needle.length <= source.length &&
    needle.every((value, index) => source[candidate + index] === value)
  ));
  if (offset < 0) throw new Error("needle missing");
  return bytes(source.slice(0, offset), replacement, source.slice(offset + needle.length));
}

const frameInterpretation = (
  overrides: Partial<InterpretationRequestInput> = {},
) => encodeInterpretationRequestFrame({ ...INTERPRETATION_INPUT, ...overrides });

describe("Toast canonical frame v1", () => {
  it("exports the exact ordered field/tag/nullability manifests", () => {
    expect(SNAPSHOT_FIELDS).toEqual([
      { name: "orderGuid", tag: "guid", nullable: false },
      { name: "orderVoided", tag: "boolean", nullable: false },
      { name: "orderedSelections", tag: "array", nullable: false },
    ]);
    expect(SELECTION_FIELDS).toEqual([
      { name: "guid", tag: "guid", nullable: true },
      { name: "itemGuid", tag: "guid", nullable: true },
      { name: "checkGuid", tag: "guid", nullable: true },
      { name: "parentGuid", tag: "guid", nullable: true },
      { name: "depth", tag: "uint", nullable: false },
      { name: "quantityToken", tag: "number", nullable: true },
      { name: "unit", tag: "text", nullable: true },
      { name: "createdDate", tag: "timestamp", nullable: true },
      { name: "modifiedDate", tag: "timestamp", nullable: true },
      { name: "fulfillmentStatus", tag: "text", nullable: true },
      { name: "selectionType", tag: "text", nullable: true },
      { name: "splitOriginGuid", tag: "guid", nullable: true },
      { name: "deferred", tag: "boolean", nullable: false },
      { name: "voided", tag: "boolean", nullable: false },
      { name: "deleted", tag: "boolean", nullable: false },
      { name: "refunded", tag: "boolean", nullable: false },
      { name: "excludedReason", tag: "text", nullable: true },
    ]);
    expect(MANUAL_SOURCE_FIELDS.map(({ name, tag, nullable }) => [name, tag, nullable]))
      .toEqual([
        ["operationId", "guid", false], ["eventTime", "timestamp", false],
        ["providerRestaurantGuid", "guid", true],
        ["orderModifiedDate", "timestamp", true],
        ["normalizedSnapshotRecord", "snapshot", false],
      ]);
    expect(INTERPRETATION_FIELDS).toEqual([
      { name: "operationId", tag: "guid", nullable: false },
      { name: "receiptId", tag: "guid", nullable: false },
      { name: "conflictId", tag: "guid", nullable: true },
      { name: "expectedCurrentInterpretationId", tag: "guid", nullable: true },
      { name: "decision", tag: "text", nullable: false },
      { name: "sortedReasonCodeArray", tag: "array", nullable: false },
      { name: "sourceSelectionGuid", tag: "guid", nullable: true },
      { name: "sourceItemGuid", tag: "guid", nullable: true },
      { name: "sourceUnit", tag: "text", nullable: true },
      { name: "targetVariantId", tag: "guid", nullable: true },
      { name: "targetQuantityToken", tag: "number", nullable: true },
      { name: "targetQuantityUnit", tag: "text", nullable: true },
      { name: "approvalState", tag: "text", nullable: false },
      { name: "effectiveFrom", tag: "timestamp", nullable: true },
      { name: "effectiveUntil", tag: "timestamp", nullable: true },
    ]);
    expect(INTERPRETATION_DECISIONS).toEqual([
      "after_service", "before_service", "mapping_review",
    ]);
    expect(INTERPRETATION_APPROVAL_STATES).toEqual(["approved", "unreviewed"]);
    expect(INTERPRETATION_CALLER_REASON_CODES).toEqual([]);
    expect(INTERPRETATION_DERIVED_RESULT_REASONS).toEqual([
      "missing_unit", "unknown_unit", "mapping_expired", "missing_quantity",
      "missing_item_guid", "mapping_not_approved", "mapping_item_mismatch",
      "mapping_unit_mismatch", "missing_selection_guid", "missing_occurrence_time",
      "mapping_not_yet_effective", "reason_coded_manual_review",
      "incomplete_approved_mapping", "invalid_mapping_effective_interval",
    ]);
    for (const manifest of [
      SNAPSHOT_FIELDS,
      SELECTION_FIELDS,
      MANUAL_SOURCE_FIELDS,
      INTERPRETATION_FIELDS,
    ]) {
      expect(Object.isFrozen(manifest)).toBe(true);
      expect(manifest.every((entry) => Object.isFrozen(entry))).toBe(true);
    }
    expect(Object.isFrozen(INTERPRETATION_DECISIONS)).toBe(true);
    expect(Object.isFrozen(INTERPRETATION_APPROVAL_STATES)).toBe(true);
    expect(Object.isFrozen(INTERPRETATION_DERIVED_RESULT_REASONS)).toBe(true);
  });

  it("pins exact snapshot, duplicate-manual, and interpretation frames and digests", () => {
    const snapshot = encodeNormalizedSnapshotFrame(guardNormalizedSnapshot(SNAPSHOT_INPUT));
    const manual = encodeManualSourceFrame(MANUAL_SOURCE_INPUT);
    const interpretation = frameInterpretation();

    expect(frameHex(snapshot)).toBe(EXPECTED_V1.snapshotFrameHex);
    expect(sha256Hex(snapshot)).toBe(EXPECTED_V1.snapshotDigestHex);
    expect(frameHex(manual.frame)).toBe(EXPECTED_V1.duplicateManualFrameHex);
    expect(sha256Hex(manual.frame)).toBe(EXPECTED_V1.duplicateManualDigestHex);
    expect(frameHex(interpretation)).toBe(EXPECTED_V1.interpretationFrameHex);
    expect(sha256Hex(interpretation)).toBe(EXPECTED_V1.interpretationDigestHex);
    expect(Object.values(EXPECTED_V1)).not.toContain("PENDING");
  });

  it("round-trips every domain and preserves both normalized duplicate facts", () => {
    const snapshot = encodeNormalizedSnapshotFrame(guardNormalizedSnapshot(SNAPSHOT_INPUT));
    const manual = encodeManualSourceFrame(MANUAL_SOURCE_INPUT);
    const interpretation = frameInterpretation();

    expect(decodeCanonicalFrame(snapshot).domain).toBe(0x01);
    const decodedManual = decodeCanonicalFrame(manual.frame);
    expect(decodedManual.domain).toBe(0x02);
    const manualRoot = decodedManual.root as unknown[];
    const nestedSnapshot = manualRoot[4] as unknown[];
    expect(nestedSnapshot[2]).toHaveLength(2);
    expect(manual).toMatchObject({
      incomplete: true,
      issues: ["duplicate_selection_guid"],
    });
    expect(selectMappedContributions(manual.normalizedSnapshot, new Map([
      ["cccccccc-cccc-4ccc-8ccc-cccccccccccc", "liquid-1"],
    ]))).toEqual({ contributions: [], issues: ["duplicate_selection_guid"] });
    expect(decodeCanonicalFrame(interpretation).domain).toBe(0x03);
  });

  it("normalizes manual parent and child identity through the shared guard", () => {
    const parent = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const child = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const manual = encodeManualSourceFrame({
      ...MANUAL_SOURCE_INPUT,
      normalizedSnapshotRecord: {
        ...MANUAL_SOURCE_INPUT.normalizedSnapshotRecord,
        orderedSelections: [
          selection(parent.toUpperCase()),
          selection(child.toUpperCase(), { parentGuid: parent.toUpperCase(), depth: 1 }),
        ],
      },
    });

    expect(manual.incomplete).toBe(false);
    const normalizedChild = manual.normalizedSnapshot.selections.find(
      ({ guid }) => guid === child,
    );
    expect(normalizedChild).toMatchObject({ guid: child, parentGuid: parent });
  });

  it("sorts complete selection frames by unsigned bytes and retains exact duplicates", () => {
    const first = selection(null, { fulfillmentStatus: "z" });
    const second = selection(null, { fulfillmentStatus: "a" });
    const forward = encodeNormalizedSnapshotFrame(guardNormalizedSnapshot({
      ...SNAPSHOT_INPUT,
      selections: [first, second, first],
    }));
    const reverse = encodeNormalizedSnapshotFrame(guardNormalizedSnapshot({
      ...SNAPSHOT_INPUT,
      selections: [first, first, second],
    }));

    expect(frameHex(reverse)).toBe(frameHex(forward));
    const root = decodeCanonicalFrame(forward).root as unknown[];
    expect(root[2]).toHaveLength(3);
  });

  it("is invariant to every permutation and object key insertion order", () => {
    const values = [
      selection("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"),
      selection("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", { fulfillmentStatus: "READY" }),
      selection(null, { parentGuid: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }),
    ];
    const permutations = [
      [0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0],
    ];
    const frames = permutations.map((order) => frameHex(encodeNormalizedSnapshotFrame(
      guardNormalizedSnapshot({
        ...SNAPSHOT_INPUT,
        selections: order.map((index) => values[index]),
      }),
    )));
    expect(new Set(frames)).toHaveLength(1);

    const reordered = Object.fromEntries(
      Object.entries(values[0]).reverse(),
    ) as SelectionObservation;
    expect(frameHex(encodeNormalizedSnapshotFrame(guardNormalizedSnapshot({
      ...SNAPSHOT_INPUT,
      selections: [reordered],
    })))).toBe(frameHex(encodeNormalizedSnapshotFrame(guardNormalizedSnapshot({
      ...SNAPSHOT_INPUT,
      selections: [values[0]],
    }))));
  });

  it("sorts null-GUID siblings by their complete later fields", () => {
    const parentGuid = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const first = selection(null, { parentGuid, fulfillmentStatus: "SENT" });
    const second = selection(null, { parentGuid, fulfillmentStatus: "READY" });
    const forward = encodeNormalizedSnapshotFrame(guardNormalizedSnapshot({
      ...SNAPSHOT_INPUT,
      selections: [first, second],
    }));
    const reverse = encodeNormalizedSnapshotFrame(guardNormalizedSnapshot({
      ...SNAPSHOT_INPUT,
      selections: [second, first],
    }));
    expect(frameHex(forward)).toBe(frameHex(reverse));
    expect((decodeCanonicalFrame(forward).root as unknown[])[2]).toHaveLength(2);
  });

  it("normalizes application/provider UUID selectors before framing", () => {
    const lower = frameInterpretation();
    const upper = frameInterpretation({
      operationId: INTERPRETATION_INPUT.operationId.toUpperCase(),
      receiptId: INTERPRETATION_INPUT.receiptId.toUpperCase(),
      sourceSelectionGuid: INTERPRETATION_INPUT.sourceSelectionGuid?.toUpperCase() ?? null,
      sourceItemGuid: INTERPRETATION_INPUT.sourceItemGuid?.toUpperCase() ?? null,
    });
    expect(frameHex(upper)).toBe(frameHex(lower));
    expectCode(
      () => frameInterpretation({ sourceSelectionGuid: "not-a-uuid" }),
      "invalid_provider_guid",
    );
  });

  it("keeps ambiguous old decimal-prefix collision structures distinct", () => {
    const prefix = "A".repeat(12);
    const first = encodeNormalizedSnapshotFrame(guardNormalizedSnapshot({
      ...SNAPSHOT_INPUT,
      selections: [selection(null, {
        fulfillmentStatus: "5",
        selectionType: `${prefix}\u00022XY`,
      })],
    }));
    const second = encodeNormalizedSnapshotFrame(guardNormalizedSnapshot({
      ...SNAPSHOT_INPUT,
      selections: [selection(null, {
        fulfillmentStatus: `\u000216${prefix}`,
        selectionType: "XY",
      })],
    }));
    expect(frameHex(first)).not.toBe(frameHex(second));
    expect(sha256Hex(first)).not.toBe(sha256Hex(second));
  });

  it.each([0, 1, 9, 10, 255, 256, TOAST_CANONICAL_TEXT_LIMIT_BYTES])(
    "round-trips canonical text at %i UTF-8 bytes",
    (length) => {
      const value = "x".repeat(length);
      const decoded = decodeCanonicalFrame(frameInterpretation({ sourceUnit: value }));
      expect((decoded.root as unknown[])[8]).toBe(value);
    },
  );

  it.each([0, 1, 9, 10, 255, 256, TOAST_CANONICAL_COLLECTION_LIMIT])(
    "round-trips canonical selection counts at %i",
    (count) => {
      const minimal = selection(null, {
        itemGuid: null,
        checkGuid: null,
        parentGuid: null,
        quantityToken: null,
        unit: null,
        createdDate: null,
        modifiedDate: null,
        fulfillmentStatus: null,
        selectionType: null,
        splitOriginGuid: null,
        excludedReason: null,
      });
      const decoded = decodeCanonicalFrame(encodeNormalizedSnapshotFrame(
        guardNormalizedSnapshot({
          ...SNAPSHOT_INPUT,
          selections: Array.from({ length: count }, () => minimal),
        }),
      ));
      expect((decoded.root as unknown[])[2]).toHaveLength(count);
    },
  );

  it("rejects text/count overflow and invalid exact number tokens", () => {
    expectCode(
      () => frameInterpretation({ sourceUnit: "x".repeat(TOAST_CANONICAL_TEXT_LIMIT_BYTES + 1) }),
      "canonical_text_too_large",
    );
    const tooManyReasons = Array.from(
      { length: TOAST_CANONICAL_COLLECTION_LIMIT + 1 },
      (_value, index) => `reason-${index.toString().padStart(5, "0")}`,
    );
    expectCode(
      () => frameInterpretation({ sortedReasonCodeArray: tooManyReasons }),
      "canonical_collection_too_large",
    );
    for (const token of ["01", "+1", "1.", ".1", "1e", "NaN", "Infinity"]) {
      expectCode(() => frameInterpretation({ targetQuantityToken: token }), "invalid_number_token");
    }
    const maximum = `1${"0".repeat(TOAST_NUMBER_TOKEN_LIMIT - 1)}`;
    expect(() => frameInterpretation({ targetQuantityToken: maximum })).not.toThrow();
    expectCode(
      () => frameInterpretation({ targetQuantityToken: `${maximum}0` }),
      "invalid_number_token",
    );
    expectCode(
      () => frameInterpretation({ effectiveFrom: "2024-02-30T00:00:00Z" }),
      "invalid_timestamp_token",
    );
  });

  it("round-trips exact accepted numeric and timestamp lexemes without normalization", () => {
    for (const token of ["0", "-0", "1.0", "1e0", "1E+0"]) {
      const decoded = decodeCanonicalFrame(frameInterpretation({ targetQuantityToken: token }));
      expect((decoded.root as unknown[])[10]).toBe(token);
    }
    const zulu = frameInterpretation({ effectiveUntil: "2025-01-01T00:00:00Z" });
    const offset = frameInterpretation({ effectiveUntil: "2025-01-01T00:00:00+00:00" });
    expect(frameHex(zulu)).not.toBe(frameHex(offset));
  });

  it("enforces depth bounds and preserves invalid opaque provider GUID evidence", () => {
    expect(() => encodeNormalizedSnapshotFrame(guardNormalizedSnapshot({
      ...SNAPSHOT_INPUT,
      selections: [selection(null, { depth: TOAST_MODIFIER_DEPTH_LIMIT })],
    }))).not.toThrow();
    expectCode(
      () => encodeNormalizedSnapshotFrame(guardNormalizedSnapshot({
        ...SNAPSHOT_INPUT,
        selections: [selection(null, { depth: TOAST_MODIFIER_DEPTH_LIMIT + 1 })],
      })),
      "modifier_depth_exceeded",
    );
    const manual = encodeManualSourceFrame({
      ...MANUAL_SOURCE_INPUT,
      providerRestaurantGuid: "opaque-provider-guid",
      normalizedSnapshotRecord: {
        orderGuid: SNAPSHOT_INPUT.orderGuid,
        orderVoided: SNAPSHOT_INPUT.orderVoided,
        orderedSelections: SNAPSHOT_INPUT.selections,
      },
    });
    expect(manual).toMatchObject({ incomplete: true, issues: ["invalid_provider_guid"] });
  });

  it("preserves scalar Unicode and rejects NUL or lone surrogates", () => {
    const controls = Array.from({ length: 31 }, (_value, index) => (
      String.fromCharCode(index + 1)
    )).join("");
    for (const value of [controls, "\ufffd", "wine \ud83c\udf77", "\u00e9", "e\u0301"]) {
      const decoded = decodeCanonicalFrame(frameInterpretation({ sourceUnit: value }));
      expect((decoded.root as unknown[])[8]).toBe(value);
    }
    expect(frameHex(frameInterpretation({ sourceUnit: "\u00e9" })))
      .not.toBe(frameHex(frameInterpretation({ sourceUnit: "e\u0301" })));
    for (const value of ["a\0b", "\ud800", "\udc00"]) {
      expectCode(() => frameInterpretation({ sourceUnit: value }), "invalid_canonical_text");
    }
    const tagCharacters = String.fromCharCode(1, 2, 3, 4, 5, 6, 7, 8, 0x20, 0x21, 0x22, 0x23);
    expect((decodeCanonicalFrame(frameInterpretation({ sourceUnit: tagCharacters }))
      .root as unknown[])[8]).toBe(tagCharacters);
    expectCode(
      () => frameInterpretation({ operationId: "a\0b" }),
      "invalid_canonical_text",
    );
    expectCode(
      () => frameInterpretation({ targetQuantityToken: "\ud800" }),
      "invalid_canonical_text",
    );
    expectCode(
      () => frameInterpretation({ effectiveFrom: "\udc00" }),
      "invalid_canonical_text",
    );
  });

  it("keeps null, empty text, and boolean false structurally distinct", () => {
    const absent = frameInterpretation({ sourceUnit: null });
    const empty = frameInterpretation({ sourceUnit: "" });
    expect(frameHex(absent)).not.toBe(frameHex(empty));
    const snapshot = decodeCanonicalFrame(encodeNormalizedSnapshotFrame(
      guardNormalizedSnapshot(SNAPSHOT_INPUT),
    )).root as unknown[];
    expect(snapshot[1]).toBe(false);
    expect(((snapshot[2] as unknown[][])[0])[8]).toBeNull();
  });

  it("rejects unsorted/duplicate reasons and unknown record members", () => {
    expectCode(
      () => frameInterpretation({ sortedReasonCodeArray: ["longer", "a"] }),
      "unsorted_reason_codes",
    );
    expectCode(
      () => frameInterpretation({ sortedReasonCodeArray: ["same", "same"] }),
      "duplicate_reason_code",
    );
    expectCode(
      () => frameInterpretation({ sortedReasonCodeArray: ["caller_claim"] }),
      "unknown_caller_reason",
    );
    expectCode(
      () => encodeManualSourceFrame({ ...MANUAL_SOURCE_INPUT, actorId: "forged" } as never),
      "invalid_canonical_record",
    );
    expectCode(
      () => frameInterpretation({ ...INTERPRETATION_INPUT, reviewedAt: "forged" } as never),
      "invalid_canonical_record",
    );
  });

  it("enforces closed interpretation decisions and selection-bound service fields", () => {
    expectCode(
      () => frameInterpretation({ decision: "invented" as never }),
      "unknown_interpretation_decision",
    );
    expectCode(
      () => frameInterpretation({ approvalState: "invented" as never }),
      "unknown_interpretation_approval",
    );
    const service = {
      decision: "before_service" as const,
      approvalState: "approved" as const,
      sortedReasonCodeArray: [],
      sourceSelectionGuid: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      sourceItemGuid: null,
      sourceUnit: null,
      targetVariantId: null,
      targetQuantityToken: null,
      targetQuantityUnit: null,
      effectiveFrom: null,
      effectiveUntil: null,
    };
    expect(() => frameInterpretation(service)).not.toThrow();
    expectCode(
      () => frameInterpretation({ ...service, sourceSelectionGuid: null }),
      "invalid_service_classification",
    );
    expectCode(
      () => frameInterpretation({ ...service, approvalState: "unreviewed" }),
      "invalid_service_classification",
    );
    expectCode(
      () => frameInterpretation({ ...service, sourceUnit: "ML" }),
      "invalid_service_classification",
    );
  });

  it("decoder rejects domain/root, tag, nullability, count, truncation, and trailing defects", () => {
    const source = encodeManualSourceFrame(MANUAL_SOURCE_INPUT).frame;
    const mutations = [
      Object.assign(source.slice(), { 14: 0x03 }),
      Object.assign(source.slice(), { 15: 0x7f }),
      Object.assign(source.slice(), { 19: 0x04 }),
      Object.assign(source.slice(), { 20: 0x04 }),
      Object.assign(source.slice(), { 20: 0x00 }),
      source.slice(0, -1),
      bytes(source, Uint8Array.of(0)),
    ];
    for (const mutation of mutations) {
      expect(() => decodeCanonicalFrame(mutation)).toThrow();
    }
    for (let tag = 0; tag <= 0xff; tag += 1) {
      if (tag === 0x22) continue;
      const mutation = source.slice();
      mutation[15] = tag;
      expect(() => decodeCanonicalFrame(mutation)).toThrow();
    }
  });

  it("decoder independently rejects invalid scalar grammar and oversized arrays", () => {
    const source = frameInterpretation({ sortedReasonCodeArray: [] });
    const invalidNumber = replaceNeedle(
      source,
      Uint8Array.of(0x06, 0, 0, 0, 4, ...new TextEncoder().encode("1.00")),
      Uint8Array.of(0x06, 0, 0, 0, 4, ...new TextEncoder().encode("01.0")),
    );
    expect(() => decodeCanonicalFrame(invalidNumber)).toThrow("invalid canonical number");
    const invalidTimestamp = replaceNeedle(
      source,
      Uint8Array.of(0x07, 0, 0, 0, 20, ...new TextEncoder().encode("2024-01-01T00:00:00Z")),
      Uint8Array.of(0x07, 0, 0, 0, 20, ...new TextEncoder().encode("2024-13-01T00:00:00Z")),
    );
    expect(() => decodeCanonicalFrame(invalidTimestamp)).toThrow("invalid canonical timestamp");
    const oversizedCount = replaceNeedle(
      source,
      Uint8Array.of(0x08, 0, 0, 0, 0),
      Uint8Array.of(0x08, 0, 0, 0x27, 0x11),
    );
    expect(() => decodeCanonicalFrame(oversizedCount)).toThrow("oversized canonical array");
  });

  it("decoder independently rejects unsorted and duplicate reason arrays", () => {
    const sorted = frameInterpretation({ sortedReasonCodeArray: [] });
    const arrayPrefix = Uint8Array.of(0x08, 0, 0, 0, 2);
    const emptyArray = Uint8Array.of(0x08, 0, 0, 0, 0);
    const ordered = bytes(arrayPrefix, textFrame("a"), textFrame("bb"));
    const reversed = bytes(arrayPrefix, textFrame("bb"), textFrame("a"));
    expect(() => decodeCanonicalFrame(replaceNeedle(sorted, emptyArray, reversed))).toThrow(
      "unsorted canonical array",
    );

    const duplicateArray = bytes(arrayPrefix, textFrame("aa"), textFrame("aa"));
    expect(() => decodeCanonicalFrame(
      replaceNeedle(sorted, emptyArray, duplicateArray),
    )).toThrow("duplicate canonical scalar");
    expect(() => decodeCanonicalFrame(
      replaceNeedle(sorted, emptyArray, ordered),
    )).toThrow("unknown caller reason");
  });
});
