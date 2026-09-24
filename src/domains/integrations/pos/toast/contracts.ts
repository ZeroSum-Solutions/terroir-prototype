export const TOAST_BODY_LIMIT_BYTES = 2 * 1024 * 1024;
export const TOAST_MODIFIER_DEPTH_LIMIT = 8;

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
