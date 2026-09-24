import { createHash } from "node:crypto";

import {
  isJsonObject,
  isToastTimestampToken,
  LosslessJson,
  ToastContractError,
} from "./contracts";
import { parseLosslessJson } from "./lossless-json";
import { verifyToastSignature } from "./signature";

const GUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
declare const verifiedProviderBrand: unique symbol;
const verifiedProviderValues = new WeakSet<object>();

function objectField(value: LosslessJson, field: string) {
  if (!isJsonObject(value)) {
    throw new ToastContractError("invalid_event_shape", `${field} must be an object`);
  }
  return value;
}

function stringField(value: LosslessJson | undefined, field: string) {
  if (typeof value !== "string" || !value) {
    throw new ToastContractError("invalid_event_shape", `${field} must be a string`);
  }
  return value;
}

function guidField(value: LosslessJson | undefined, field: string) {
  const guid = stringField(value, field);
  if (!GUID.test(guid)) {
    throw new ToastContractError("invalid_event_shape", `${field} must be a GUID`);
  }
  return guid;
}

export type SignedToastEvent = Readonly<{
  eventGuid: string;
  timestamp: string;
  restaurantGuid: string;
  order: { [key: string]: LosslessJson };
  bodySha256: string;
  provenance: VerifiedProviderProvenance;
}>;

export type VerifiedProviderProvenance = Readonly<{
  kind: "signed_provider";
  connectionId: string;
  restaurantGuid: string;
  signatureState: "verified";
  [verifiedProviderBrand]: true;
}>;

function verifiedProviderProvenance(input: {
  connectionId: string;
  restaurantGuid: string;
}): VerifiedProviderProvenance {
  if (!input.connectionId.trim()) {
    throw new ToastContractError("invalid_provenance", "connectionId is required");
  }
  const value = Object.freeze({
    kind: "signed_provider" as const,
    connectionId: input.connectionId,
    restaurantGuid: input.restaurantGuid,
    signatureState: "verified" as const,
  }) as VerifiedProviderProvenance;
  verifiedProviderValues.add(value);
  return value;
}

export function isVerifiedProviderProvenance(
  value: unknown,
): value is VerifiedProviderProvenance {
  return typeof value === "object" && value !== null && verifiedProviderValues.has(value);
}

export function parseSignedProviderEvent(input: {
  body: Uint8Array;
  signature: string;
  secret: string;
  connectionId: string;
  allowedRestaurantGuids: ReadonlySet<string>;
}): SignedToastEvent {
  const root = objectField(parseLosslessJson(input.body), "body");
  const timestamp = stringField(root.timestamp, "timestamp");
  if (!isToastTimestampToken(timestamp)) {
    throw new ToastContractError("invalid_event_timestamp", "timestamp must be an ISO-8601 instant");
  }
  if (!verifyToastSignature({
    body: input.body,
    timestamp,
    secret: input.secret,
    signature: input.signature,
  })) {
    throw new ToastContractError("invalid_signature", "Toast signature does not match raw body");
  }

  const details = objectField(root.details, "details");
  const eventCategory = stringField(root.eventCategory, "eventCategory");
  const eventType = stringField(root.eventType, "eventType");
  if (
    !["order_updated", "channel_order_updated"].includes(eventCategory) ||
    eventType !== eventCategory
  ) {
    throw new ToastContractError("unsupported_event", "event must be an orders update");
  }
  const restaurantGuid = guidField(details.restaurantGuid, "details.restaurantGuid");
  if (!input.allowedRestaurantGuids.has(restaurantGuid)) {
    throw new ToastContractError(
      "restaurant_not_allowlisted",
      "signed restaurant GUID is not assigned to this connection",
    );
  }

  return {
    eventGuid: guidField(root.guid, "guid"),
    timestamp,
    restaurantGuid,
    order: objectField(details.order, "details.order"),
    bodySha256: createHash("sha256").update(input.body).digest("hex"),
    provenance: verifiedProviderProvenance({
      connectionId: input.connectionId,
      restaurantGuid,
    }),
  };
}
