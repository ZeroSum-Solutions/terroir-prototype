import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { validateLineItemsArithmetic } from "@/domains/scanning/invoice-arithmetic";
import { requireRole } from "@/lib/api/auth";
import { Errors } from "@/lib/api/errors";
import { withApiHandler } from "@/lib/api/handler";
import {
  invalidIdempotencyKeyResult,
  isValidIdempotencyKey,
  withIdempotency,
} from "@/lib/api/idempotency";
import { apiResultResponse } from "@/lib/api/result-response";
import { fileField, parseJson, parseMultipart } from "@/lib/api/validation";
import { SaveInvoiceScanBodySchema } from "@/lib/scanner/request-schemas";
import { readInvoiceScanPrivate } from "@/lib/staff-cost/protected-readers";

export const runtime = "nodejs";

const SaveScanMultipartSchema = z.object({
  data: z.string(),
  // Retained only so an in-flight old client gets a deterministic migration
  // path. Images are uploaded by POST /api/scan and are never written here.
  file: fileField.optional(),
});

const ReviewReceiptSchema = z.strictObject({
  scanId: z.string().uuid(),
  status: z.literal("complete"),
  itemCount: z.number().int().min(1).max(500),
  updated: z.literal(true),
});

const CommitReceiptSchema = z
  .strictObject({
    scanId: z.string().uuid(),
    itemCount: z.number().int().min(1).max(500),
    wineCount: z.number().int().min(1).max(500),
  })
  .refine(({ itemCount, wineCount }) => wineCount <= itemCount);

function safeAbandon(status: number, body: unknown) {
  return {
    outcome: "abandon" as const,
    response: { status, body },
  };
}

function internalFailure() {
  return safeAbandon(500, {
    error: { code: "internal_error", message: "Internal server error." },
  });
}

function normalizeInvoiceDate(value: string): string | null {
  if (!value || value === "—" || value === "-") return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
}

export async function POST(request: NextRequest) {
  return withApiHandler(() => postInvoiceInventorySave(request));
}

async function postInvoiceInventorySave(request: NextRequest) {
  const auth = await requireRole(["owner", "manager"]);
  if (auth instanceof NextResponse) return auth;
  const { supabase, restaurantId } = auth;

  const rawKey = request.headers.get("Idempotency-Key");
  if (!isValidIdempotencyKey(rawKey)) {
    return apiResultResponse(invalidIdempotencyKeyResult());
  }

  const contentType = request.headers.get("content-type") ?? "";
  let parsedBody;
  if (contentType.includes("multipart/form-data")) {
    const parsedMultipart = await parseMultipart(
      request,
      SaveScanMultipartSchema,
      { message: "Invalid body." },
    );
    if (!parsedMultipart.ok) return parsedMultipart.response;
    const parsed = await parseJson(
      new Request("http://localhost/api/inventory/save-scan/data", {
        method: "POST",
        body: parsedMultipart.data.data,
      }),
      SaveInvoiceScanBodySchema,
      { message: "Invalid body." },
    );
    if (!parsed.ok) return parsed.response;
    parsedBody = parsed.data;
  } else {
    const parsed = await parseJson(request, SaveInvoiceScanBodySchema, {
      message: "Invalid body.",
    });
    if (!parsed.ok) return parsed.response;
    parsedBody = parsed.data;
  }

  const { scan } = parsedBody;
  const scanId = scan.scanId;
  if (!scanId) {
    return Errors.unprocessable(
      "scan_upload_required",
      "Upload this invoice before saving it to inventory.",
    );
  }

  const arithmetic = validateLineItemsArithmetic(scan.items);
  if (!arithmetic.ok) {
    return Errors.unprocessable(
      "arithmetic_mismatch",
      "These numbers don't add up — review and correct the flagged wines before saving.",
    );
  }

  const result = await withIdempotency({
    supabase,
    restaurantId,
    key: rawKey,
    kind: "invoice_inventory_save",
    handler: async () => {
      let privateScan;
      try {
        privateScan = await readInvoiceScanPrivate(supabase, scanId);
      } catch {
        return internalFailure();
      }
      if (!privateScan || privateScan.restaurant_id !== restaurantId) {
        return safeAbandon(403, {
          error: {
            code: "forbidden",
            message: "Only a manager with cost access can save this scan.",
          },
        });
      }

      // A different transport key may legitimately retry after the commit
      // succeeded but cache completion was lost. The business RPC is itself
      // durable/idempotent, so skip review once committed and replay it.
      if (privateScan.committed_at === null) {
        const { data: reviewRaw, error: reviewError } = await supabase.rpc(
          "review_invoice_scan",
          {
            p_scan_id: scanId,
            p_expected_updated_at: privateScan.updated_at,
            p_distributor_name: scan.source.distributor,
            p_invoice_number:
              scan.source.invoiceNo === "—" ? null : scan.source.invoiceNo,
            p_invoice_date: normalizeInvoiceDate(scan.source.invoiceDate),
            p_final_line_items: scan.items,
            p_edits: scan.edits,
          } as never,
        );
        if (reviewError) {
          if (reviewError.code === "42501") {
            return safeAbandon(403, {
              error: {
                code: "forbidden",
                message: "Only a manager with cost access can save this scan.",
              },
            });
          }
          if (reviewError.message?.trim() === "scan_superseded") {
            return safeAbandon(409, {
              error: {
                code: "scan_superseded",
                message: "This scan changed before it was saved. Refresh and try again.",
              },
            });
          }
          return internalFailure();
        }
        const review = ReviewReceiptSchema.safeParse(reviewRaw);
        if (
          !review.success ||
          review.data.scanId !== scanId ||
          review.data.itemCount !== scan.items.length
        ) {
          // The review may have committed even though its returned shape is
          // unusable. Preserve the cache claim rather than authorizing retry.
          throw new Error("review_invoice_scan returned an unexpected receipt");
        }
      }

      const { data: commitRaw, error: commitError } = await supabase.rpc(
        "commit_invoice_scan",
        { p_scan_id: scanId },
      );
      if (commitError) {
        if (commitError.code === "42501") {
          return safeAbandon(403, {
            error: {
              code: "forbidden",
              message: "Only a manager with cost access can save this scan.",
            },
          });
        }
        return internalFailure();
      }
      const commit = CommitReceiptSchema.safeParse(commitRaw);
      if (!commit.success || commit.data.scanId !== scanId) {
        // The atomic commit may already be durable. Keep the claim in progress
        // and surface an uncertain outcome rather than abandoning/retrying.
        throw new Error("commit_invoice_scan returned an unexpected receipt");
      }
      return {
        outcome: "complete",
        receipt: {
          version: 1 as const,
          kind: "invoice_inventory_save" as const,
          scanId: commit.data.scanId,
          status: "committed" as const,
          itemCount: commit.data.itemCount,
          wineCount: commit.data.wineCount,
        },
      };
    },
  });

  return apiResultResponse(result);
}
