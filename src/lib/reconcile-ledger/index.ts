import { z } from "zod";

export const MAX_RECONCILE_ACTION_BYTES = 2 * 1024 * 1024;

const Id = z.string().uuid();
const utf8 = new TextEncoder();

function boundedUtf8(maxBytes: number, minBytes = 0) {
  return z.string().refine((value) => {
    const bytes = utf8.encode(value).byteLength;
    return bytes >= minBytes && bytes <= maxBytes;
  }, `Must be between ${minBytes} and ${maxBytes} UTF-8 bytes.`);
}

const LineItemFieldSchema = z.enum([
  "name",
  "producer",
  "vintage",
  "varietal",
  "region",
  "qty",
  "unitCost",
  "currency",
  "format",
]);

const LowFieldsSchema = z.array(LineItemFieldSchema).max(9).superRefine(
  (fields, context) => {
    if (new Set(fields).size !== fields.length) {
      context.addIssue({ code: "custom", message: "lowFields must be unique." });
    }
  },
);

/** Exact TypeScript mirror of 0157's admitted invoice_line_items_valid item. */
export const ReconcileExpectedLineSchema = z.strictObject({
  id: boundedUtf8(500, 1),
  name: boundedUtf8(500, 1),
  producer: boundedUtf8(500, 1),
  vintage: z.number().int().min(0).max(2100).nullable(),
  varietal: boundedUtf8(500),
  region: boundedUtf8(500),
  qty: z.number().int().min(1).max(100_000),
  unitCost: z.number().finite().min(0).max(1_000_000),
  lineTotal: z.number().finite().min(0).max(100_000_000_000).nullable().optional(),
  currency: boundedUtf8(16).nullable().optional(),
  format: boundedUtf8(100).nullable().optional(),
  confidence: z.number().finite().min(0).max(1),
  lowFields: LowFieldsSchema.optional(),
  wine_id: Id.optional(),
});

export const ReconcileActionSchema = z.discriminatedUnion("action_type", [
  z.strictObject({
    action_type: z.literal("place_bin"),
    subject_table: z.literal("inventory_items"),
    subject_id: Id,
    patch: z.strictObject({ bin_id: Id }),
  }),
  z.strictObject({
    action_type: z.literal("match_scan"),
    subject_table: z.literal("invoice_scans"),
    subject_id: Id,
    patch: z.strictObject({
      line_index: z.number().int().min(0).max(499),
      wine_id: Id,
      expected_line: ReconcileExpectedLineSchema,
    }),
  }),
  z.strictObject({
    action_type: z.literal("link_lineage"),
    subject_table: z.literal("wines"),
    subject_id: Id,
    patch: z.strictObject({ lineage_id: Id }),
  }),
  z.strictObject({
    action_type: z.literal("dismiss"),
    subject_table: z.enum(["inventory_items", "invoice_scans", "wines"]),
    subject_id: Id,
    patch: z.strictObject({}),
  }),
]);

export const AcceptActionsSchema = z.array(ReconcileActionSchema).min(1).max(100)
  .superRefine((items, context) => {
    if (utf8.encode(JSON.stringify(items)).byteLength > MAX_RECONCILE_ACTION_BYTES) {
      context.addIssue({ code: "custom", message: "Action payload is too large." });
    }

    const seen = new Set<string>();
    for (const [index, item] of items.entries()) {
      const suffix = item.action_type === "match_scan"
        ? `:${item.patch.line_index}`
        : "";
      const key = `${item.subject_table}:${item.subject_id}${suffix}`;
      if (seen.has(key)) {
        context.addIssue({
          code: "custom",
          message: "Each subject may appear only once per batch.",
          path: [index, "subject_id"],
        });
      }
      seen.add(key);
    }
  });

export const AcceptReconcileReceiptSchema = z.strictObject({
  batchId: Id,
  actionCount: z.number().int().min(1).max(100),
  status: z.literal("accepted"),
});

export const UndoReconcileReceiptSchema = z.strictObject({
  batchId: Id,
  actionCount: z.number().int().min(1).max(100),
  status: z.literal("undone"),
  undoneAt: z.iso.datetime({ offset: true }),
});

export type ReconcileAction = z.infer<typeof ReconcileActionSchema>;
export type AcceptReconcileReceipt = z.infer<typeof AcceptReconcileReceiptSchema>;
export type UndoReconcileReceipt = z.infer<typeof UndoReconcileReceiptSchema>;
