import { describe, expect, it } from "vitest";
import {
  BottleLocationReceiveReceiptSchema,
  BottleLocationReceiveRpcResultSchema,
  decodeBottleLocationReceiveReceipt,
  decodeBottleLocationReceiveRpcResult,
} from "./bottle-location-receive-contract";

const expected = {
  operationId: "11111111-1111-4111-8111-111111111111",
  wineId: "22222222-2222-4222-8222-222222222222",
  section: "Main cellar",
  binId: "33333333-3333-4333-8333-333333333333",
};
const receipt = {
  version: 1,
  kind: "bottle_location_receive",
  status: "committed",
  ...expected,
  inventoryItemId: "44444444-4444-4444-8444-444444444444",
  binCode: "A-1",
  quantity: 1,
};

describe("bottle location receiving receipts", () => {
  it("accepts exactly the public ten-key receipt", () => {
    expect(Object.keys(receipt)).toHaveLength(10);
    expect(decodeBottleLocationReceiveReceipt(expected, receipt)).toEqual(receipt);
  });

  it.each([false, true])("accepts RPC replayed=%s without changing the receipt", (replayed) => {
    const result = { ...receipt, replayed };
    expect(Object.keys(result)).toHaveLength(11);
    expect(decodeBottleLocationReceiveRpcResult(expected, result)).toEqual(result);
  });

  it.each(Object.keys(receipt))("rejects a missing %s field", (key) => {
    const incomplete: Record<string, unknown> = { ...receipt };
    delete incomplete[key];
    expect(BottleLocationReceiveReceiptSchema.safeParse(incomplete).success).toBe(false);
  });

  it.each(["unit_cost", "currency", "rawText", "restaurantId", "replayed"])(
    "rejects unexpected public field %s rather than stripping it",
    (key) => {
      expect(BottleLocationReceiveReceiptSchema.safeParse({ ...receipt, [key]: 1 }).success).toBe(false);
    },
  );

  it.each([
    null,
    {},
    { ...receipt, version: 3 },
    { ...receipt, kind: "bottle_inventory_save" },
    { ...receipt, status: "pending" },
    { ...receipt, quantity: 0 },
    { ...receipt, quantity: 2 },
    { ...receipt, quantity: "1" },
    { ...receipt, inventoryItemId: "not-a-uuid" },
    { ...receipt, binCode: "" },
    { ...receipt, section: "" },
    { ...receipt, section: " Main cellar " },
    { ...receipt, section: "a".repeat(201) },
  ])("rejects malformed committed receipts: %j", (value) => {
    expect(BottleLocationReceiveReceiptSchema.safeParse(value).success).toBe(false);
  });

  it.each(["operationId", "wineId", "binId", "section"] as const)(
    "refuses an otherwise valid receipt for the wrong %s",
    (field) => {
      const changed = { ...receipt, [field]: field === "section" ? "Other room" : "55555555-5555-4555-8555-555555555555" };
      expect(() => decodeBottleLocationReceiveReceipt(expected, changed)).toThrow();
      expect(() => decodeBottleLocationReceiveRpcResult(expected, { ...changed, replayed: true })).toThrow();
    },
  );

  it.each([undefined, null, "true", 0, 1])("rejects non-boolean RPC replayed=%j", (replayed) => {
    expect(BottleLocationReceiveRpcResultSchema.safeParse({ ...receipt, replayed }).success).toBe(false);
  });

  it("rejects extra RPC fields including protected data", () => {
    expect(BottleLocationReceiveRpcResultSchema.safeParse({ ...receipt, replayed: false, unit_cost: 25 }).success).toBe(false);
  });

  it("preserves historical bin code and operation-time wine identity on replay", () => {
    const historical = { ...receipt, binCode: "Original bin code", replayed: true };
    expect(decodeBottleLocationReceiveRpcResult(expected, historical)).toEqual(historical);
  });

  it("matches PostgreSQL canonical UUIDs to valid uppercase request UUIDs", () => {
    const canonical = {
      ...receipt,
      operationId: "abcdefab-abcd-4abc-8abc-abcdefabcdef",
      wineId: "bbcdefab-abcd-4abc-8abc-abcdefabcdef",
      binId: "cbcdefab-abcd-4abc-8abc-abcdefabcdef",
    };
    const uppercase = {
      operationId: canonical.operationId.toUpperCase(),
      wineId: canonical.wineId.toUpperCase(),
      binId: canonical.binId.toUpperCase(),
      section: canonical.section,
    };
    expect(decodeBottleLocationReceiveReceipt(uppercase, canonical)).toEqual(canonical);
    expect(decodeBottleLocationReceiveRpcResult(uppercase, { ...canonical, replayed: true }))
      .toEqual({ ...canonical, replayed: true });
  });
});
