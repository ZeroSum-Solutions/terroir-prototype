import { z } from "zod";

export const ScanIdempotencyKindSchema = z.enum([
  "invoice_scan_upload",
  "invoice_inventory_save",
  "bottle_inventory_save",
]);

export type ScanIdempotencyKind = z.infer<
  typeof ScanIdempotencyKindSchema
>;

export const ScanIdempotencyKeySchema = z.string().uuid();

const ReceiptVersionSchema = z.literal(1);
const ReceiptIdSchema = z.string().uuid();
const ReceiptCountSchema = z.number().int().min(0).max(500);

export const InvoiceScanUploadReceiptSchema = z.strictObject({
  version: ReceiptVersionSchema,
  kind: z.literal("invoice_scan_upload"),
  scanId: ReceiptIdSchema,
  status: z.literal("queued"),
  itemCount: z.literal(0),
});

export const InvoiceInventorySaveReceiptSchema = z
  .strictObject({
    version: ReceiptVersionSchema,
    kind: z.literal("invoice_inventory_save"),
    scanId: ReceiptIdSchema,
    status: z.literal("committed"),
    itemCount: ReceiptCountSchema,
    wineCount: ReceiptCountSchema,
  })
  .refine((receipt) => receipt.wineCount <= receipt.itemCount, {
    message: "wineCount must not exceed itemCount.",
    path: ["wineCount"],
  });

export const BottleInventorySaveReceiptSchema = z.strictObject({
  version: ReceiptVersionSchema,
  kind: z.literal("bottle_inventory_save"),
  wineId: ReceiptIdSchema,
  status: z.literal("committed"),
  itemCount: z.literal(1),
});

export const ScanIdempotencyReceiptSchema = z.discriminatedUnion("kind", [
  InvoiceScanUploadReceiptSchema,
  InvoiceInventorySaveReceiptSchema,
  BottleInventorySaveReceiptSchema,
]);

export type ScanIdempotencyReceipt = z.infer<
  typeof ScanIdempotencyReceiptSchema
>;

const EmptyClaimResultSchema = z.discriminatedUnion("disposition", [
  z.strictObject({ disposition: z.literal("claimed"), receipt: z.null() }),
  z.strictObject({ disposition: z.literal("in_progress"), receipt: z.null() }),
  z.strictObject({ disposition: z.literal("expired"), receipt: z.null() }),
]);

const ReplayClaimResultSchema = z.strictObject({
  disposition: z.literal("replay"),
  receipt: ScanIdempotencyReceiptSchema,
});

export const ScanIdempotencyClaimResultSchema = z.discriminatedUnion(
  "disposition",
  [
    ...EmptyClaimResultSchema.options,
    ReplayClaimResultSchema,
  ],
);

export type ScanIdempotencyClaimResult = z.infer<
  typeof ScanIdempotencyClaimResultSchema
>;

export function decodeScanIdempotencyClaimResult(
  expectedKind: ScanIdempotencyKind,
  value: unknown,
): ScanIdempotencyClaimResult {
  return ScanIdempotencyClaimResultSchema.refine(
    (result) =>
      result.disposition !== "replay" || result.receipt.kind === expectedKind,
    { message: "Replay receipt kind does not match the requested operation." },
  ).parse(value);
}

export function scanIdempotencySuccessStatus(
  receipt: ScanIdempotencyReceipt,
): 200 | 202 {
  return receipt.kind === "invoice_scan_upload" ? 202 : 200;
}

export type ScanIdempotencyFailure =
  | "in_progress"
  | "expired"
  | "conflict"
  | "error";

export interface ScanIdempotencyFailureHttpResult {
  status: 409 | 500;
  body: {
    error: {
      code:
        | "idempotency_in_progress"
        | "idempotency_expired"
        | "idempotency_conflict"
        | "internal_error";
      message: string;
    };
  };
}

export function scanIdempotencyFailureHttpResult(
  failure: ScanIdempotencyFailure,
): ScanIdempotencyFailureHttpResult {
  switch (failure) {
    case "in_progress":
      return {
        status: 409,
        body: {
          error: {
            code: "idempotency_in_progress",
            message:
              "A request with this Idempotency-Key is already in progress.",
          },
        },
      };
    case "expired":
      return {
        status: 409,
        body: {
          error: {
            code: "idempotency_expired",
            message: "Idempotency key expired; please generate a new one.",
          },
        },
      };
    case "conflict":
      return {
        status: 409,
        body: {
          error: {
            code: "idempotency_conflict",
            message: "Idempotency key conflicts with this request.",
          },
        },
      };
    case "error":
      return {
        status: 500,
        body: {
          error: {
            code: "internal_error",
            message: "Internal server error.",
          },
        },
      };
  }
}
