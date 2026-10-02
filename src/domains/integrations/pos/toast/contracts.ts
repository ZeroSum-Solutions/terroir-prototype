export const TOAST_BODY_LIMIT_BYTES = 2 * 1024 * 1024;
export const TOAST_CANONICAL_COLLECTION_LIMIT = 10_000;
export const TOAST_CANONICAL_TEXT_LIMIT_BYTES = 64 * 1024;
export const TOAST_MODIFIER_DEPTH_LIMIT = 8;
export const TOAST_NUMBER_TOKEN_LIMIT = 128;
export const TOAST_NUMBER_TOKEN_PATTERN = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/;
export const TOAST_TIMESTAMP_TOKEN_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})$/;

export class LosslessNumber {
  readonly kind = "number";

  constructor(readonly raw: string) {}
}

export type LosslessJson =
  | null
  | boolean
  | string
  | LosslessNumber
  | LosslessJson[]
  | { [key: string]: LosslessJson };

export type ToastProvenance =
  | Readonly<{
      kind: "manual";
      actorId: string;
      siteId: string;
      signatureState: "not_applicable";
    }>
  | Readonly<{
      kind: "fixture";
      fixtureId: string;
      signatureState: "synthetic_verified" | "not_verified";
      liveEvidence: false;
    }>;

export class ToastContractError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ToastContractError";
  }
}

const canonicalTextEncoder = new TextEncoder();

export function toastCanonicalTextBytes(value: string): Uint8Array {
  if (value.includes("\0")) {
    throw new ToastContractError("invalid_canonical_text", "NUL is not canonical text");
  }
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) {
        throw new ToastContractError("invalid_canonical_text", "unpaired high surrogate");
      }
      index += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      throw new ToastContractError("invalid_canonical_text", "unpaired low surrogate");
    }
  }
  if (value.length > TOAST_CANONICAL_TEXT_LIMIT_BYTES) {
    throw new ToastContractError("canonical_text_too_large", "text exceeds byte limit");
  }
  const bytes = canonicalTextEncoder.encode(value);
  if (bytes.length > TOAST_CANONICAL_TEXT_LIMIT_BYTES) {
    throw new ToastContractError("canonical_text_too_large", "text exceeds byte limit");
  }
  return bytes;
}

export function isJsonObject(
  value: LosslessJson,
): value is { [key: string]: LosslessJson } {
  return value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    !(value instanceof LosslessNumber);
}

export function isLosslessNumber(value: LosslessJson): value is LosslessNumber {
  return value instanceof LosslessNumber;
}

export function isToastNumberToken(value: string): boolean {
  return value.length <= TOAST_NUMBER_TOKEN_LIMIT &&
    TOAST_NUMBER_TOKEN_PATTERN.test(value);
}

export function isToastTimestampToken(value: string): boolean {
  const match = TOAST_TIMESTAMP_TOKEN_PATTERN.exec(value);
  if (!match || !Number.isFinite(Date.parse(value))) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1];
}
