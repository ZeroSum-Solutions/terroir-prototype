import {
  INTERPRETATION_FIELDS,
  INTERPRETATION_APPROVAL_STATES,
  INTERPRETATION_DECISIONS,
  MANUAL_SOURCE_FIELDS,
  SELECTION_FIELDS,
  SNAPSHOT_FIELDS,
  TOAST_FRAME_DOMAINS,
  TOAST_FRAME_TAGS,
  TOAST_FRAME_VERSION,
  compareCanonicalBytes,
} from "./canonical-frame";
import {
  isToastNumberToken,
  isToastTimestampToken,
  TOAST_CANONICAL_COLLECTION_LIMIT,
  TOAST_CANONICAL_TEXT_LIMIT_BYTES,
} from "./contracts";

type Schema =
  | Readonly<{ kind: "scalar"; tag: number | "boolean"; nullable: boolean }>
  | Readonly<{ kind: "array"; element: Schema; nullable: boolean; ordered?: boolean }>
  | Readonly<{ kind: "record"; tag: number; fields: readonly Schema[]; nullable: boolean }>;

type Decoded = null | boolean | number | string | Decoded[];
type Parsed = Readonly<{ value: Decoded; frame: Uint8Array }>;

const prefix = new TextEncoder().encode("TERROIR_TOAST");
const decoder = new TextDecoder("utf-8", { fatal: true });
const normalizedUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const scalar = (tag: number | "boolean", nullable: boolean): Schema => ({
  kind: "scalar",
  tag,
  nullable,
});
const record = (tag: number, fields: readonly Schema[]): Schema => ({
  kind: "record",
  tag,
  fields,
  nullable: false,
});

const tagByName = {
  text: TOAST_FRAME_TAGS.text,
  guid: TOAST_FRAME_TAGS.guid,
  number: TOAST_FRAME_TAGS.number,
  timestamp: TOAST_FRAME_TAGS.timestamp,
  uint: TOAST_FRAME_TAGS.uint,
  boolean: "boolean",
} as const;

const selectionSchema = record(
  TOAST_FRAME_TAGS.selection,
  SELECTION_FIELDS.map((field) => scalar(tagByName[field.tag], field.nullable)),
);
const snapshotSchema = record(TOAST_FRAME_TAGS.snapshot, [
  scalar(TOAST_FRAME_TAGS.guid, SNAPSHOT_FIELDS[0].nullable),
  scalar("boolean", SNAPSHOT_FIELDS[1].nullable),
  { kind: "array", element: selectionSchema, nullable: SNAPSHOT_FIELDS[2].nullable, ordered: true },
]);
const manualSchema = record(TOAST_FRAME_TAGS.manualSource, [
  scalar(TOAST_FRAME_TAGS.guid, MANUAL_SOURCE_FIELDS[0].nullable),
  scalar(TOAST_FRAME_TAGS.timestamp, MANUAL_SOURCE_FIELDS[1].nullable),
  scalar(TOAST_FRAME_TAGS.guid, MANUAL_SOURCE_FIELDS[2].nullable),
  scalar(TOAST_FRAME_TAGS.timestamp, MANUAL_SOURCE_FIELDS[3].nullable),
  snapshotSchema,
]);
const interpretationSchema = record(TOAST_FRAME_TAGS.interpretation, [
  scalar(TOAST_FRAME_TAGS.guid, INTERPRETATION_FIELDS[0].nullable),
  scalar(TOAST_FRAME_TAGS.guid, INTERPRETATION_FIELDS[1].nullable),
  scalar(TOAST_FRAME_TAGS.guid, INTERPRETATION_FIELDS[2].nullable),
  scalar(TOAST_FRAME_TAGS.guid, INTERPRETATION_FIELDS[3].nullable),
  scalar(TOAST_FRAME_TAGS.text, INTERPRETATION_FIELDS[4].nullable),
  {
    kind: "array",
    element: scalar(TOAST_FRAME_TAGS.text, false),
    nullable: INTERPRETATION_FIELDS[5].nullable,
    ordered: true,
  },
  ...INTERPRETATION_FIELDS.slice(6).map((field) => (
    scalar(tagByName[field.tag as keyof typeof tagByName], field.nullable)
  )),
]);

const rootByDomain = new Map<number, Schema>([
  [TOAST_FRAME_DOMAINS.normalizedSnapshot, snapshotSchema],
  [TOAST_FRAME_DOMAINS.manualSource, manualSchema],
  [TOAST_FRAME_DOMAINS.interpretationRequest, interpretationSchema],
]);

export function decodeCanonicalFrame(frame: Uint8Array): {
  domain: number;
  root: Decoded;
} {
  let offset = 0;
  const take = (length: number): Uint8Array => {
    if (!Number.isSafeInteger(length) || length < 0 || offset + length > frame.length) {
      throw new Error("truncated canonical frame");
    }
    const value = frame.slice(offset, offset + length);
    offset += length;
    return value;
  };
  const byte = (): number => take(1)[0];
  const u32 = (): number => {
    const bytes = take(4);
    return bytes[0] * 0x1000000 + bytes[1] * 0x10000 + bytes[2] * 0x100 + bytes[3];
  };
  const text = (): string => {
    const length = u32();
    if (length > TOAST_CANONICAL_TEXT_LIMIT_BYTES) {
      throw new Error("oversized canonical text");
    }
    const value = decoder.decode(take(length));
    if (value.includes("\0")) throw new Error("noncanonical NUL text");
    return value;
  };
  const parse = (schema: Schema): Parsed => {
    const start = offset;
    const tag = byte();
    if (tag === TOAST_FRAME_TAGS.null) {
      if (!schema.nullable) throw new Error("null in non-null field");
      return { value: null, frame: frame.slice(start, offset) };
    }
    if (schema.kind === "scalar") {
      if (schema.tag === "boolean") {
        if (tag !== TOAST_FRAME_TAGS.false && tag !== TOAST_FRAME_TAGS.true) {
          throw new Error("wrong boolean tag");
        }
        return {
          value: tag === TOAST_FRAME_TAGS.true,
          frame: frame.slice(start, offset),
        };
      }
      if (tag !== schema.tag) throw new Error("wrong scalar tag");
      const value = tag === TOAST_FRAME_TAGS.uint ? u32() : text();
      if (tag === TOAST_FRAME_TAGS.number && !isToastNumberToken(value as string)) {
        throw new Error("invalid canonical number");
      }
      if (tag === TOAST_FRAME_TAGS.timestamp && !isToastTimestampToken(value as string)) {
        throw new Error("invalid canonical timestamp");
      }
      return { value, frame: frame.slice(start, offset) };
    }
    if (schema.kind === "array") {
      if (tag !== TOAST_FRAME_TAGS.array) throw new Error("wrong array tag");
      const count = u32();
      if (count > TOAST_CANONICAL_COLLECTION_LIMIT) {
        throw new Error("oversized canonical array");
      }
      const parsed = Array.from({ length: count }, () => parse(schema.element));
      if (schema.ordered) {
        for (let index = 1; index < parsed.length; index += 1) {
          const comparison = compareCanonicalBytes(parsed[index - 1].frame, parsed[index].frame);
          if (comparison > 0) throw new Error("unsorted canonical array");
          if (comparison === 0 && schema.element.kind === "scalar") {
            throw new Error("duplicate canonical scalar");
          }
        }
      }
      return {
        value: parsed.map(({ value }) => value),
        frame: frame.slice(start, offset),
      };
    }
    if (tag !== schema.tag) throw new Error("domain root or record tag mismatch");
    if (u32() !== schema.fields.length) throw new Error("wrong record field count");
    const fields = schema.fields.map((field) => parse(field).value);
    return { value: fields, frame: frame.slice(start, offset) };
  };

  if (compareCanonicalBytes(take(prefix.length), prefix) !== 0) {
    throw new Error("wrong canonical prefix");
  }
  if (byte() !== TOAST_FRAME_VERSION) throw new Error("wrong canonical version");
  const domain = byte();
  const schema = rootByDomain.get(domain);
  if (!schema) throw new Error("unknown canonical domain");
  const root = parse(schema).value;
  if (offset !== frame.length) throw new Error("trailing canonical bytes");
  if (domain === TOAST_FRAME_DOMAINS.manualSource) {
    const fields = root as Decoded[];
    if (typeof fields[0] !== "string" || !normalizedUuid.test(fields[0])) {
      throw new Error("noncanonical application UUID");
    }
  }
  if (domain === TOAST_FRAME_DOMAINS.interpretationRequest) {
    const fields = root as Decoded[];
    const requiredApplicationIds = [fields[0], fields[1]];
    const optionalApplicationIds = [fields[2], fields[3], fields[9]];
    const providerSelectors = [fields[6], fields[7]];
    if (requiredApplicationIds.some((value) => (
      typeof value !== "string" || !normalizedUuid.test(value)
    )) || [...optionalApplicationIds, ...providerSelectors].some((value) => (
      value !== null && (typeof value !== "string" || !normalizedUuid.test(value))
    ))) {
      throw new Error("noncanonical UUID selector");
    }
    if (!INTERPRETATION_DECISIONS.includes(fields[4] as never)) {
      throw new Error("unknown interpretation decision");
    }
    if (!INTERPRETATION_APPROVAL_STATES.includes(fields[12] as never)) {
      throw new Error("unknown interpretation approval");
    }
    if (!Array.isArray(fields[5]) || fields[5].length !== 0) {
      throw new Error("unknown caller reason");
    }
    if (fields[4] !== "mapping_review" && (
      fields[12] !== "approved" || fields[6] === null ||
      [fields[7], fields[8], fields[9], fields[10], fields[11], fields[13], fields[14]]
        .some((value) => value !== null)
    )) {
      throw new Error("invalid service classification");
    }
  }
  return { domain, root };
}
