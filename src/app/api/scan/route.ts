/**
 * POST /api/scan — store an invoice upload and enqueue extraction.
 *
 * The request-user client uploads the private objects. One closed database
 * function validates the complete object set, creates the scan, and enqueues
 * the tenant-filtered worker. No provider or protected scan payload is
 * returned from this request.
 */
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireMembership } from "@/lib/api/auth";
import { Errors } from "@/lib/api/errors";
import { withApiHandler } from "@/lib/api/handler";
import {
  invalidIdempotencyKeyResult,
  isValidIdempotencyKey,
  withIdempotency,
} from "@/lib/api/idempotency";
import { rateLimit } from "@/lib/api/rate-limit";
import { apiResultResponse } from "@/lib/api/result-response";
import { fileField, parseJson, parseMultipart } from "@/lib/api/validation";
import { InvoicePathBodySchema } from "@/lib/scanner/request-schemas";

export const runtime = "nodejs";
export const maxDuration = 120;

const SCAN_RATE_LIMIT = 10;
const SCAN_RATE_WINDOW_MS = 60 * 1000;
const MAX_BYTES = 10 * 1024 * 1024;
const MAX_INVOICE_PAGES = 8;
const MIME_EXTENSIONS = new Map([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/heic", "heic"],
  ["image/heif", "heif"],
  ["application/pdf", "pdf"],
]);
const ALLOWED_MIME = new Set(MIME_EXTENSIONS.keys());
const UUID_PATTERN =
  "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}";

const InvoiceFilesSchema = z.object({
  file: z
    .union([fileField, z.array(fileField).min(1)])
    .transform((value) => (Array.isArray(value) ? value : [value])),
});

const UploadResultSchema = z.strictObject({
  scanId: z.string().uuid(),
  status: z.literal("queued"),
});

function clientIp(request: NextRequest): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return request.headers.get("x-real-ip")?.trim() || "unknown";
}

function uploadPathParts(
  objectName: string,
  restaurantId: string,
): { scanId: string; extension: string } | null {
  const match = objectName.match(
    new RegExp(
      `^${restaurantId}/(${UUID_PATTERN})(?:_page[1-8])?[.](jpg|jpeg|png|heic|heif|pdf)$`,
    ),
  );
  if (!match) return null;
  return { scanId: match[1], extension: match[2].toLowerCase() };
}

function completeUploadReceipt(scanId: string) {
  return {
    version: 1 as const,
    kind: "invoice_scan_upload" as const,
    scanId,
    status: "queued" as const,
    itemCount: 0 as const,
  };
}

function abandonedInternalError() {
  return {
    outcome: "abandon" as const,
    response: {
      status: 500,
      body: {
        error: { code: "internal_error", message: "Internal server error." },
      },
    },
  };
}

export async function POST(request: NextRequest) {
  return withApiHandler(() => postInvoiceScan(request));
}

async function postInvoiceScan(request: NextRequest) {
  const auth = await requireMembership();
  if (auth instanceof NextResponse) return auth;
  const { supabase, restaurantId } = auth;

  const rawKey = request.headers.get("Idempotency-Key");
  if (!isValidIdempotencyKey(rawKey)) {
    return apiResultResponse(invalidIdempotencyKeyResult());
  }

  const limit = rateLimit(
    `scan:${restaurantId}:${clientIp(request)}`,
    SCAN_RATE_LIMIT,
    SCAN_RATE_WINDOW_MS,
  );
  if (!limit.ok) {
    return Errors.rateLimited(
      "Too many scan requests. Please wait before scanning again.",
      { headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }

  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    const parsed = await parseJson(request, InvoicePathBodySchema, {
      message: "Invalid body.",
    });
    if (!parsed.ok) return parsed.response;

    const target = uploadPathParts(parsed.data.imagePath, restaurantId);
    if (!target) return Errors.notFound("Image");

    const result = await withIdempotency({
      supabase,
      restaurantId,
      key: rawKey,
      kind: "invoice_scan_upload",
      handler: async () => {
        const { data, error } = await supabase.rpc(
          "create_invoice_scan_upload",
          {
            p_restaurant_id: restaurantId,
            p_scan_id: target.scanId,
            p_object_name: parsed.data.imagePath,
            p_distributor_name: "Unknown",
            p_invoice_number: null,
            p_invoice_date: null,
          } as never,
        );
        if (error) return abandonedInternalError();
        const upload = UploadResultSchema.safeParse(data);
        if (!upload.success || upload.data.scanId !== target.scanId) {
          return abandonedInternalError();
        }
        return {
          outcome: "complete",
          receipt: completeUploadReceipt(upload.data.scanId),
        };
      },
    });
    return apiResultResponse(result);
  }

  const parsed = await parseMultipart(request, InvoiceFilesSchema, {
    message: "Invalid body.",
  });
  if (!parsed.ok) return parsed.response;
  const files = parsed.data.file;

  if (files.length > MAX_INVOICE_PAGES) {
    return Errors.badRequest(
      `Select up to ${MAX_INVOICE_PAGES} pages per invoice scan. You selected ${files.length}.`,
    );
  }
  for (const file of files) {
    if (file.size === 0) return Errors.badRequest("Empty file.");
    if (file.size > MAX_BYTES) return Errors.tooLarge("File exceeds 10 MB.");
    if (!ALLOWED_MIME.has(file.type)) {
      return Errors.unsupportedMediaType(
        `Unsupported file type: ${file.type || "unknown"}.`,
      );
    }
  }
  const pdfCount = files.filter(
    (file) => file.type === "application/pdf",
  ).length;
  if (pdfCount > 0 && files.length > 1) {
    return Errors.badRequest(
      pdfCount > 1
        ? `Upload one PDF per invoice. You selected ${pdfCount} PDFs — scan each invoice separately, or take a photo of each page for a multi-page paper invoice.`
        : "A PDF is a complete invoice on its own. Upload it by itself, or upload photos without a PDF.",
      undefined,
      "mixed_pdf_batch",
    );
  }

  // The transport key is already a UUID and remains stable across retries.
  // Reusing it as the upload scan id gives partial storage uploads a stable,
  // tenant-scoped upsert target without another persistence mechanism.
  const scanId = rawKey;
  const paths = files.map((file, index) => {
    const extension = MIME_EXTENSIONS.get(file.type) ?? "jpg";
    const page = files.length > 1 ? `_page${index + 1}` : "";
    return `${restaurantId}/${scanId}${page}.${extension}`;
  });

  const result = await withIdempotency({
    supabase,
    restaurantId,
    key: rawKey,
    kind: "invoice_scan_upload",
    handler: async () => {
      try {
        for (let index = 0; index < files.length; index += 1) {
          const file = files[index];
          const bytes = Buffer.from(new Uint8Array(await file.arrayBuffer()));
          const { error } = await supabase.storage
            .from("invoice-images")
            .upload(paths[index], bytes, {
              contentType: file.type,
              upsert: true,
            });
          if (error) return abandonedInternalError();
        }
      } catch {
        // Storage objects use deterministic upsert paths, so a partial upload
        // is safe to retry after abandoning the database cache claim.
        return abandonedInternalError();
      }

      const { data, error } = await supabase.rpc(
        "create_invoice_scan_upload",
        {
          p_restaurant_id: restaurantId,
          p_scan_id: scanId,
          p_object_name: paths[0],
          p_distributor_name: "Unknown",
          p_invoice_number: null,
          p_invoice_date: null,
        } as never,
      );
      if (error) return abandonedInternalError();
      const upload = UploadResultSchema.safeParse(data);
      if (!upload.success || upload.data.scanId !== scanId) {
        return abandonedInternalError();
      }
      return {
        outcome: "complete",
        receipt: completeUploadReceipt(upload.data.scanId),
      };
    },
  });

  return apiResultResponse(result);
}
