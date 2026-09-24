import { describe, expect, it } from "vitest";

import {
  isVerifiedProviderProvenance,
  parseSignedProviderEvent,
} from "./raw-event";
import { computeToastSignature, verifyToastSignature } from "./signature";

const secret = "fixture-secret";
const restaurantGuid = "0cd990c9-fd74-461d-8468-de2a0919ccbb";
const timestamp = "2024-03-28T15:11:01.050Z";
const raw = `{
  "timestamp":"${timestamp}",
  "guid":"534bf25a-b657-45aa-9a63-47f8f35400d6",
  "eventCategory":"order_updated",
  "eventType":"order_updated",
  "details":{"restaurantGuid":"${restaurantGuid}","order":{"guid":"f6d98b95-2816-4f54-b1ab-7a5d71e83769","quantity":1.00}}
}`;
const body = new TextEncoder().encode(raw);
const signature = computeToastSignature(body, timestamp, secret);

describe("Toast raw-byte verification", () => {
  it("verifies the preserved body plus its body timestamp", () => {
    expect(verifyToastSignature({ body, timestamp, secret, signature })).toBe(true);
    const changedWhitespace = new TextEncoder().encode(raw.replace("{\n", "{"));
    expect(verifyToastSignature({ body: changedWhitespace, timestamp, secret, signature }))
      .toBe(false);
    expect(verifyToastSignature({ body, timestamp, secret, signature: "not-base64" }))
      .toBe(false);
  });

  it("binds the site only from the verified body allowlist", () => {
    const event = parseSignedProviderEvent({
      body,
      signature,
      secret,
      connectionId: "connection-1",
      allowedRestaurantGuids: new Set([restaurantGuid]),
    });
    expect(event).toMatchObject({
      restaurantGuid,
      provenance: {
        kind: "signed_provider",
        signatureState: "verified",
        connectionId: "connection-1",
      },
    });
    expect(isVerifiedProviderProvenance(event.provenance)).toBe(true);
    expect(isVerifiedProviderProvenance({ ...event.provenance })).toBe(false);
  });

  it("requires the selected connection identity before minting provenance", () => {
    expect(() => parseSignedProviderEvent({
      body,
      signature,
      secret,
      connectionId: "",
      allowedRestaurantGuids: new Set([restaurantGuid]),
    })).toThrowError(expect.objectContaining({ code: "invalid_provenance" }));
  });

  it("rejects a validly signed restaurant outside the selected connection", () => {
    expect(() => parseSignedProviderEvent({
      body,
      signature,
      secret,
      connectionId: "connection-1",
      allowedRestaurantGuids: new Set(),
    })).toThrowError(expect.objectContaining({ code: "restaurant_not_allowlisted" }));
  });

  it("rejects tampering before using signed business fields", () => {
    const tampered = new TextEncoder().encode(raw.replace("1.00", "2.00"));
    expect(() => parseSignedProviderEvent({
      body: tampered,
      signature,
      secret,
      connectionId: "connection-1",
      allowedRestaurantGuids: new Set([restaurantGuid]),
    })).toThrowError(expect.objectContaining({ code: "invalid_signature" }));
  });
});
