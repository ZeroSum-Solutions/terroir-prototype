import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/api/auth";
import { Errors } from "@/lib/api/errors";
import { withApiHandler } from "@/lib/api/handler";
import { parseJson, parseParams } from "@/lib/api/validation";
import { ScanIdParamsSchema } from "@/lib/scanner/request-schemas";

export const runtime = "nodejs";

const MAX_REVIEW_JSON_BYTES = 2 * 1024 * 1024;
function byteBoundedString(max: number, min = 0) {
  return z.string().refine((value) => {
    const length = new TextEncoder().encode(value).byteLength;
    return length >= min && length <= max;
  }, "Text field has an invalid length.");
}

const TextFieldSchema = byteBoundedString(500);
const RequiredTextFieldSchema = byteBoundedString(500, 1);
const ReviewLineItemSchema = z.strictObject({
  id: RequiredTextFieldSchema,
  name: RequiredTextFieldSchema,
  producer: RequiredTextFieldSchema,
  vintage: z.number().int().min(0).max(2100).nullable(),
  varietal: TextFieldSchema,
  region: TextFieldSchema,
  qty: z.number().int().min(1).max(100_000),
  unitCost: z.number().finite().min(0).max(1_000_000),
  lineTotal: z.number().finite().min(0).max(100_000_000_000).nullable().optional(),
  currency: byteBoundedString(16).nullable().optional(),
  format: byteBoundedString(100).nullable().optional(),
  confidence: z.number().finite().min(0).max(1),
  lowFields: z.array(z.enum([
    "name", "producer", "vintage", "varietal", "region",
    "qty", "unitCost", "currency", "format",
  ])).max(9).refine((fields) => new Set(fields).size === fields.length).optional(),
  wine_id: z.string().uuid().optional(),
});
const ReviewEditsSchema = z.record(z.string(), z.literal(true)).refine(
  (edits) => Object.keys(edits).length <= 500 && Object.keys(edits).every(
    (key) => new TextEncoder().encode(key).byteLength >= 1
      && new TextEncoder().encode(key).byteLength <= 500,
  ),
  "Edits must contain at most 500 bounded keys.",
);
const ReviewScanBodySchema = z.strictObject({
  expectedUpdatedAt: z.iso.datetime({ offset: true }),
  distributor: RequiredTextFieldSchema,
  invoiceNumber: TextFieldSchema.nullable(),
  invoiceDate: z.iso.date().nullable(),
  items: z.array(ReviewLineItemSchema).min(1).max(500),
  edits: ReviewEditsSchema,
}).refine(
  ({ items, edits }) => new TextEncoder().encode(
    JSON.stringify(items) + JSON.stringify(edits),
  ).byteLength <= MAX_REVIEW_JSON_BYTES,
  "Review payload is too large.",
);
const ReviewReceiptSchema = z.strictObject({
  scanId: z.string().uuid(),
  status: z.literal("complete"),
  itemCount: z.number().int().min(1).max(500),
  updated: z.literal(true),
});

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  return withApiHandler(async () => {
    const auth = await requireRole(["owner", "manager"]);
    if (auth instanceof NextResponse) return auth;
    const { supabase } = auth;

    const parsedParams = await parseParams(params, ScanIdParamsSchema);
    if (!parsedParams.ok) return parsedParams.response;
    const { id } = parsedParams.data;

    const parsed = await parseJson(request, ReviewScanBodySchema);
    if (!parsed.ok) return parsed.response;
    const scan = await supabase
      .from("invoice_scans")
      .select("id")
      .eq("id", id)
      .eq("restaurant_id", auth.restaurantId)
      .maybeSingle();
    if (scan.error) throw scan.error;
    if (!scan.data) return Errors.notFound("Scan");

    const { data: receiptRaw, error } = await supabase.rpc(
      "review_invoice_scan",
      {
        p_scan_id: id,
        p_expected_updated_at: parsed.data.expectedUpdatedAt,
        p_distributor_name: parsed.data.distributor,
        p_invoice_number: parsed.data.invoiceNumber,
        p_invoice_date: parsed.data.invoiceDate,
        p_final_line_items: parsed.data.items,
        p_edits: parsed.data.edits,
      },
    );
    if (error) {
      if (error.code === "42501") {
        return Errors.forbidden("Only a manager with cost access can review this scan.");
      }
      if (error.message?.trim() === "scan_superseded") {
        return Errors.conflict(
          "scan_superseded",
          "This scan changed before your edits were saved. Refresh and try again.",
        );
      }
      if (error.message?.trim() === "scan_already_committed") {
        return Errors.conflict(
          "scan_already_committed",
          "A committed scan can no longer be edited.",
        );
      }
      throw error;
    }

    const receipt = ReviewReceiptSchema.safeParse(receiptRaw);
    if (
      !receipt.success
      || receipt.data.scanId !== id
      || receipt.data.itemCount !== parsed.data.items.length
    ) {
      throw new Error("review_invoice_scan returned an unexpected receipt");
    }
    return NextResponse.json(receipt.data);
  });
}

/**
 * DELETE /api/scans/[id] — SCAN-04 / decision D6.
 *
 * The FIRST delete handler this product has had for a scan or an invoice.
 * Deleting an invoice whose lines already reached inventory reverses that
 * inventory FIRST — see `delete_invoice_scan` (migration 0143) for why
 * that is one RPC and not `revert_import_batch` (0109), which only knows
 * how to walk `import_batch_rows`.
 *
 * Manager-scoped at both layers: `requireRole` here for a clean 403, and
 * the DELETE policy + the RPC's own `is_member_with_role` check in the
 * database, because an API-level role check is not a tenancy boundary.
 */
const DeleteResultSchema = z.object({
  scanId: z.string(),
  inventoryRowsDeleted: z.number().int().nonnegative(),
  bottlesRemoved: z.number().int().nonnegative(),
});

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  return withApiHandler(async () => {
    const auth = await requireRole(["owner", "manager"]);
    if (auth instanceof NextResponse) return auth;
    const { supabase } = auth;

    const parsedParams = await parseParams(params, ScanIdParamsSchema);
    if (!parsedParams.ok) return parsedParams.response;

    const { data, error } = await supabase.rpc("delete_invoice_scan", {
      p_scan_id: parsedParams.data.id,
    });

    if (error) {
      const pgError = error as { code?: string; message?: string };
      const code = pgError.code;
      // P0002: RLS already narrowed the lookup to scans this session can
      // read, so another tenant's id is indistinguishable from a missing
      // one — which is the point.
      if (code === "P0001" && pgError.message?.trim() === "physical_bottle_dependency") {
        return Errors.conflict("physical_bottle_dependency", "Invoice cannot be deleted because physical bottles depend on its imported inventory.");
      }
      if (code === "P0002") return Errors.notFound("Scan");
      if (code === "P0003") {
        return Errors.forbidden("Only an owner or manager can delete an invoice.");
      }
      throw error;
    }

    const parsedResult = DeleteResultSchema.safeParse(data);
    if (!parsedResult.success) throw new Error("delete_invoice_scan returned an unexpected shape");

    return NextResponse.json(parsedResult.data);
  });
}
