import { describe, expect, it } from "vitest";

import { classifyServiceFacts } from "./service-facts";

describe("financial, KDS, and physical service facts", () => {
  it.each([
    ["NEW", "pre_fire"],
    ["HOLD", "pre_fire"],
    ["SENT", "post_fire"],
    ["READY", "post_fire"],
    ["UNKNOWN", "unknown"],
    [null, "unknown"],
  ])("keeps %s as KDS evidence only", (fulfillmentStatus, kdsState) => {
    expect(classifyServiceFacts({
      fulfillmentStatus,
      voided: false,
      deleted: false,
      refunded: false,
    })).toMatchObject({
      kdsState,
      physicalService: "unknown",
      restoresPhysicalInventory: false,
    });
  });

  it("does not infer restoration or service from void, delete, or refund", () => {
    expect(classifyServiceFacts({
      fulfillmentStatus: "SENT",
      voided: true,
      deleted: true,
      refunded: true,
    })).toEqual({
      financial: { voided: true, deleted: true, refunded: true },
      posFulfillment: "SENT",
      kdsState: "post_fire",
      physicalService: "unknown",
      physicalEvidenceSource: null,
      restoresPhysicalInventory: false,
    });
  });

  it("classifies physical service only from a qualifying explicit decision", () => {
    expect(classifyServiceFacts({
      fulfillmentStatus: "NEW",
      voided: true,
      deleted: false,
      refunded: false,
    }, {
      source: "authorized_operator",
      state: "after_service",
    })).toMatchObject({
      kdsState: "pre_fire",
      physicalService: "after_service",
      physicalEvidenceSource: "authorized_operator",
      restoresPhysicalInventory: false,
    });
  });
});
