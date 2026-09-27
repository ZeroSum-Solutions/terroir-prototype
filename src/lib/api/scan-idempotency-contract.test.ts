import { describe, expect, it } from "vitest";
import {
  ScanIdempotencyClaimResultSchema,
  ScanIdempotencyKeySchema,
  ScanIdempotencyReceiptSchema,
  decodeScanIdempotencyClaimResult,
  scanIdempotencyFailureHttpResult,
  scanIdempotencySuccessStatus,
} from "./scan-idempotency-contract";

const SCAN_ID = "11111111-1111-4111-8111-111111111111";
const WINE_ID = "22222222-2222-4222-8222-222222222222";

const uploadReceipt = {
  version: 1,
  kind: "invoice_scan_upload",
  scanId: SCAN_ID,
  status: "queued",
  itemCount: 0,
} as const;

const invoiceSaveReceipt = {
  version: 1,
  kind: "invoice_inventory_save",
  scanId: SCAN_ID,
  status: "committed",
  itemCount: 4,
  wineCount: 3,
} as const;

const bottleSaveReceipt = {
  version: 1,
  kind: "bottle_inventory_save",
  wineId: WINE_ID,
  status: "committed",
  itemCount: 1,
} as const;

describe("scan idempotency receipt contract", () => {
  it.each([uploadReceipt, invoiceSaveReceipt, bottleSaveReceipt])(
    "accepts the exact $kind receipt",
    (receipt) => {
      expect(ScanIdempotencyReceiptSchema.parse(receipt)).toEqual(receipt);
    },
  );

  it("rejects protected payloads and every unexpected key", () => {
    expect(
      ScanIdempotencyReceiptSchema.safeParse({
        ...invoiceSaveReceipt,
        unitCost: 125,
      }).success,
    ).toBe(false);
    expect(
      ScanIdempotencyReceiptSchema.safeParse({
        ...uploadReceipt,
        rawText: "protected OCR",
      }).success,
    ).toBe(false);
  });

  it("rejects malformed and legacy response bodies", () => {
    const invalid = [
      null,
      {},
      { scanId: SCAN_ID, itemCount: 2, wineCount: 1 },
      { version: 1, kind: "invoice_scan_upload", status: "claimed" },
      { error: "legacy error text" },
    ];

    for (const value of invalid) {
      expect(ScanIdempotencyReceiptSchema.safeParse(value).success).toBe(false);
    }
  });

  it("rejects invalid IDs, status mismatches, and kind-specific field drift", () => {
    const invalid = [
      { ...uploadReceipt, scanId: "not-a-uuid" },
      { ...uploadReceipt, status: "committed" },
      { ...invoiceSaveReceipt, status: "queued" },
      { ...bottleSaveReceipt, wineId: "not-a-uuid" },
      { ...bottleSaveReceipt, scanId: SCAN_ID },
      { ...invoiceSaveReceipt, wineId: WINE_ID },
    ];

    for (const value of invalid) {
      expect(ScanIdempotencyReceiptSchema.safeParse(value).success).toBe(false);
    }
  });

  it("enforces exact safe count bounds and wineCount <= itemCount", () => {
    const invalid = [
      { ...invoiceSaveReceipt, itemCount: -1 },
      { ...invoiceSaveReceipt, itemCount: 501 },
      { ...invoiceSaveReceipt, itemCount: 1.5 },
      { ...invoiceSaveReceipt, wineCount: -1 },
      { ...invoiceSaveReceipt, wineCount: 501 },
      { ...invoiceSaveReceipt, wineCount: 5 },
      { ...uploadReceipt, itemCount: 1 },
      { ...bottleSaveReceipt, itemCount: 0 },
      { ...bottleSaveReceipt, itemCount: 2 },
    ];

    for (const value of invalid) {
      expect(ScanIdempotencyReceiptSchema.safeParse(value).success).toBe(false);
    }
  });
});

describe("scan idempotency claim contract", () => {
  it.each(["claimed", "in_progress", "expired"] as const)(
    "accepts %s only with a null receipt",
    (disposition) => {
      const result = { disposition, receipt: null };
      expect(ScanIdempotencyClaimResultSchema.parse(result)).toEqual(result);
      expect(
        ScanIdempotencyClaimResultSchema.safeParse({
          disposition,
          receipt: uploadReceipt,
        }).success,
      ).toBe(false);
    },
  );

  it("accepts replay only with a valid receipt", () => {
    expect(
      ScanIdempotencyClaimResultSchema.parse({
        disposition: "replay",
        receipt: invoiceSaveReceipt,
      }),
    ).toEqual({ disposition: "replay", receipt: invoiceSaveReceipt });
    expect(
      ScanIdempotencyClaimResultSchema.safeParse({
        disposition: "replay",
        receipt: null,
      }).success,
    ).toBe(false);
  });

  it("rejects actor data and other unexpected result fields", () => {
    expect(
      ScanIdempotencyClaimResultSchema.safeParse({
        disposition: "claimed",
        receipt: null,
        claimedByUserId: WINE_ID,
      }).success,
    ).toBe(false);
  });

  it("rejects replay when the receipt kind differs from the requested operation", () => {
    expect(() =>
      decodeScanIdempotencyClaimResult(
        "bottle_inventory_save",
        { disposition: "replay", receipt: invoiceSaveReceipt },
      ),
    ).toThrow();
    expect(
      decodeScanIdempotencyClaimResult(
        "invoice_inventory_save",
        { disposition: "replay", receipt: invoiceSaveReceipt },
      ),
    ).toEqual({ disposition: "replay", receipt: invoiceSaveReceipt });
  });
});

describe("scan idempotency HTTP contract", () => {
  it("requires a canonical UUID idempotency key", () => {
    expect(ScanIdempotencyKeySchema.parse(SCAN_ID)).toBe(SCAN_ID);
    for (const value of [undefined, null, "", "not-a-uuid", WINE_ID + " "]) {
      expect(ScanIdempotencyKeySchema.safeParse(value).success).toBe(false);
    }
  });

  it("maps upload to 202 and both inventory receipts to 200", () => {
    expect(scanIdempotencySuccessStatus(uploadReceipt)).toBe(202);
    expect(scanIdempotencySuccessStatus(invoiceSaveReceipt)).toBe(200);
    expect(scanIdempotencySuccessStatus(bottleSaveReceipt)).toBe(200);
  });

  it.each([
    [
      "in_progress",
      409,
      "idempotency_in_progress",
      "A request with this Idempotency-Key is already in progress.",
    ],
    [
      "expired",
      409,
      "idempotency_expired",
      "Idempotency key expired; please generate a new one.",
    ],
    [
      "conflict",
      409,
      "idempotency_conflict",
      "Idempotency key conflicts with this request.",
    ],
    ["error", 500, "internal_error", "Internal server error."],
  ] as const)(
    "maps %s to a closed, redacted error",
    (failure, status, code, message) => {
      expect(scanIdempotencyFailureHttpResult(failure)).toEqual({
        status,
        body: { error: { code, message } },
      });
    },
  );
});
