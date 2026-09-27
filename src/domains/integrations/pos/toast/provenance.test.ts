import { describe, expect, expectTypeOf, it } from "vitest";

import * as provenance from "./provenance";
import { fixtureProvenance, manualProvenance } from "./provenance";
import {
  isVerifiedProviderProvenance,
  type VerifiedProviderProvenance,
} from "./raw-event";

describe("Toast provenance lanes", () => {
  it("does not expose a factory that can mint provider verification", () => {
    expect(provenance).not.toHaveProperty("signedProviderProvenance");
  });

  it("keeps actor-authorized manual input outside provider verification", () => {
    const manual = manualProvenance({ actorId: "actor-1", siteId: "site-1" });
    expect(manual).toEqual({
      kind: "manual",
      actorId: "actor-1",
      siteId: "site-1",
      signatureState: "not_applicable",
    });
    expect(isVerifiedProviderProvenance(manual)).toBe(false);
    expectTypeOf(manual).not.toMatchTypeOf<VerifiedProviderProvenance>();
  });

  it("makes synthetic fixtures permanently ineligible as live evidence", () => {
    const fixture = fixtureProvenance({
      fixtureId: "signed-order-update",
      signatureState: "synthetic_verified",
    });
    expect(fixture).toMatchObject({
      kind: "fixture",
      signatureState: "synthetic_verified",
      liveEvidence: false,
    });
    expect(isVerifiedProviderProvenance(fixture)).toBe(false);
    expectTypeOf(fixture).not.toMatchTypeOf<VerifiedProviderProvenance>();
  });

  it("rejects a structurally fabricated verified-looking object", () => {
    expect(isVerifiedProviderProvenance({
      kind: "signed_provider",
      connectionId: "connection-1",
      restaurantGuid: "0cd990c9-fd74-461d-8468-de2a0919ccbb",
      signatureState: "verified",
    })).toBe(false);
  });
});
