import { z } from "zod";

export const BOTTLE_LOCATION_BIN_UNAVAILABLE_MESSAGE =
  "This bin is unavailable. Select an active bin and try again.";
export const BOTTLE_LOCATION_WINE_UNAVAILABLE_MESSAGE = "Wine not found or not in your restaurant.";
export const BottleLocationWineUnavailableSchema = z.strictObject({
  error: z.strictObject({
    code: z.literal("wine_not_found"),
    message: z.literal(BOTTLE_LOCATION_WINE_UNAVAILABLE_MESSAGE),
  }),
});

export const BottleLocationBinUnavailableSchema = z.strictObject({
  error: z.strictObject({
    code: z.literal("bin_unavailable"),
    message: z.literal(BOTTLE_LOCATION_BIN_UNAVAILABLE_MESSAGE),
  }),
});

export const BottleLocationReceiveReceiptSchema = z.strictObject({
  version: z.literal(1),
  kind: z.literal("bottle_location_receive"),
  status: z.literal("committed"),
  operationId: z.string().uuid(),
  inventoryItemId: z.string().uuid(),
  wineId: z.string().uuid(),
  section: z.string().min(1).max(200).refine((value) => value === value.trim()),
  binId: z.string().uuid(),
  binCode: z.string().min(1),
  quantity: z.literal(1),
});

export const BottleLocationReceiveRpcResultSchema =
  BottleLocationReceiveReceiptSchema.extend({ replayed: z.boolean() });

export type BottleLocationReceiveReceipt = z.infer<
  typeof BottleLocationReceiveReceiptSchema
>;

export type BottleLocationReceiveRpcResult = z.infer<
  typeof BottleLocationReceiveRpcResultSchema
>;

export type BottleLocationReceiveExpected = Pick<
  BottleLocationReceiveReceipt,
  "operationId" | "wineId" | "section" | "binId"
>;

function matchesOperation(
  expected: BottleLocationReceiveExpected,
  receipt: BottleLocationReceiveReceipt,
): boolean {
  return receipt.operationId.toLowerCase() === expected.operationId.toLowerCase() &&
    receipt.wineId.toLowerCase() === expected.wineId.toLowerCase() &&
    receipt.section === expected.section &&
    receipt.binId.toLowerCase() === expected.binId.toLowerCase();
}

export function decodeBottleLocationReceiveReceipt(
  expected: BottleLocationReceiveExpected,
  value: unknown,
): BottleLocationReceiveReceipt {
  return BottleLocationReceiveReceiptSchema.refine(
    (receipt) => matchesOperation(expected, receipt),
    { message: "Receiving receipt does not match the requested operation." },
  ).parse(value);
}

export function decodeBottleLocationReceiveRpcResult(
  expected: BottleLocationReceiveExpected,
  value: unknown,
): BottleLocationReceiveRpcResult {
  return BottleLocationReceiveRpcResultSchema.refine(
    (receipt) => matchesOperation(expected, receipt),
    { message: "Receiving receipt does not match the requested operation." },
  ).parse(value);
}
