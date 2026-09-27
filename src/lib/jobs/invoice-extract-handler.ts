import type { SupabaseClient } from "@supabase/supabase-js";
import { processInvoiceScanOnce } from "@/domains/scanning/invoice-scan-service";
import {
  HEARTBEAT_INTERVAL_MS,
  INVOICE_IMAGE_BUCKET,
  SYSTEM_USER_PLACEHOLDER,
} from "@/lib/jobs/constants";
import { isStillClaimed, withClaimHeartbeat } from "@/lib/jobs/heartbeat";
import type { ClaimedInvoiceExtractJob, JobOutcome } from "@/lib/jobs/types";
import type { Database } from "@/types/database";

const EXTENSION_MIME: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  heic: "image/heic",
  heif: "image/heif",
  pdf: "application/pdf",
};

// This bounds stored objects, not the internal page count of one PDF. The
// worker deliberately does not parse PDFs; any document-page limit belongs
// at an owning upload/provider boundary.
const MAX_INVOICE_OBJECTS = 8;
const MAX_PAGE_BYTES = 10 * 1024 * 1024;
const MAX_TOTAL_BYTES = MAX_INVOICE_OBJECTS * MAX_PAGE_BYTES;

type InvoicePageTarget = {
  path: string;
  mimeType: string;
};

type InvoicePageTargetsResult =
  | { ok: true; pages: InvoicePageTarget[] }
  | { ok: false; code: string; message: string };

function pageTarget(path: string): InvoicePageTarget | null {
  const extension = path.split(".").pop()?.toLowerCase() ?? "";
  const mimeType = EXTENSION_MIME[extension];
  return mimeType ? { path, mimeType } : null;
}

function isSafeTenantObjectPath(path: string, restaurantId: string): boolean {
  if (path.length > 200 || !path.startsWith(`${restaurantId}/`)) return false;
  const relativePath = path.slice(restaurantId.length + 1);
  if (
    !relativePath ||
    relativePath.includes("\\") ||
    relativePath.includes("%") ||
    /[\u0000-\u001f\u007f]/.test(relativePath)
  ) {
    return false;
  }

  const segments = relativePath.split("/");
  return segments.every(
    (segment) => segment.length > 0 && segment !== "." && segment !== "..",
  );
}

function invoicePageTargets(params: {
  restaurantId: string;
  scanId: string;
  rawImagePath: unknown;
  extraImagePaths: unknown;
}): InvoicePageTargetsResult {
  const { restaurantId, scanId, rawImagePath, extraImagePaths } = params;
  if (typeof rawImagePath !== "string" || !isSafeTenantObjectPath(rawImagePath, restaurantId)) {
    return {
      ok: false,
      code: "missing_or_mistenanted_image_path",
      message: "raw_image_path is missing or not scoped to the job's restaurant.",
    };
  }
  if (!Array.isArray(extraImagePaths) || !extraImagePaths.every((path) => typeof path === "string")) {
    return {
      ok: false,
      code: "invalid_invoice_image_paths",
      message: "The stored additional invoice image paths are invalid.",
    };
  }

  const paths = [rawImagePath, ...extraImagePaths];
  if (paths.length > MAX_INVOICE_OBJECTS) {
    return {
      ok: false,
      code: "invalid_invoice_page_count",
      message: `An invoice scan may contain at most ${MAX_INVOICE_OBJECTS} stored objects.`,
    };
  }
  if (new Set(paths).size !== paths.length) {
    return {
      ok: false,
      code: "invalid_invoice_image_paths",
      message: "Invoice image paths must be unique.",
    };
  }

  const pages = paths.map(pageTarget);
  if (pages.some((page) => page === null)) {
    return {
      ok: false,
      code: "unsupported_extension",
      message: "An invoice image has an unsupported file extension.",
    };
  }

  if (paths.length > 1) {
    const prefix = `${restaurantId}/${scanId}_page`;
    for (let index = 0; index < paths.length; index += 1) {
      const page = pages[index];
      if (
        !page ||
        !isSafeTenantObjectPath(page.path, restaurantId) ||
        page.mimeType === "application/pdf" ||
        page.path.slice(0, page.path.lastIndexOf(".")) !== `${prefix}${index + 1}`
      ) {
        return {
          ok: false,
          code: "invalid_invoice_image_paths",
          message: "Multi-page invoice image paths are invalid or out of order.",
        };
      }
    }
  }

  return { ok: true, pages: pages.filter((page) => page !== null) };
}

/** Error codes worth retrying: transient/upstream, not a data problem. */
const RETRYABLE_CODES = new Set(["upstream_error", "rate_limited"]);

export async function runInvoiceExtractJob(params: {
  supabase: SupabaseClient<Database>;
  job: ClaimedInvoiceExtractJob;
}): Promise<JobOutcome> {
  const { supabase, job } = params;

  if (!job.subjectId) {
    return { kind: "dead", code: "missing_subject", message: "Job has no subject_id." };
  }

  // ── Tenant-scoping enforcement point ──────────────────────────────
  // The service role bypasses RLS entirely, so this WHERE clause — not
  // any policy — is what stops a job whose restaurant_id doesn't
  // actually own subjectId from touching another tenant's scan. See
  // src/lib/jobs/tenant-isolation.test.ts for the fixture proof.
  const { data: scan, error: fetchError } = await supabase
    .from("invoice_scans")
    .select("id, status, raw_image_path, extra_image_paths, created_by, committed_at")
    .eq("id", job.subjectId)
    .eq("restaurant_id", job.restaurantId)
    .maybeSingle();

  if (fetchError) {
    return { kind: "retry", code: "subject_fetch_failed", message: fetchError.message };
  }
  if (!scan) {
    // Either the scan doesn't exist, or it belongs to a different
    // restaurant than the job claims. Both are terminal: retrying
    // can't fix a tenant mismatch or a missing row.
    return {
      kind: "dead",
      code: "tenant_mismatch_or_missing_subject",
      message:
        `No invoice_scans row ${job.subjectId} found for restaurant ${job.restaurantId}.`,
    };
  }

  // ── Initial retry versus deliberate re-extraction ──────────────────
  // A recovered initial job has attempt_count > 0 after the stuck reclaim
  // and must not double-bill once a result is already persisted. The closed
  // re-extract RPC resets the existing succeeded/dead job to queued with
  // attempt_count = 0. That combination, on an uncommitted complete/review
  // scan, is the bounded signal to fence the scan back to processing and run
  // extraction again. Committed scans remain immutable.
  const ALREADY_PERSISTED_STATUSES = new Set(["complete", "review"]);
  if (ALREADY_PERSISTED_STATUSES.has(scan.status)) {
    const isReextractRequest =
      job.attemptCount === 0 && scan.committed_at === null;
    if (!isReextractRequest) {
      return { kind: "succeeded", skippedExtraction: true };
    }
    const { data: resetRows, error: resetError } = await supabase
      .from("invoice_scans")
      .update({ status: "processing" } as never)
      .eq("id", scan.id)
      .eq("restaurant_id", job.restaurantId)
      .eq("status", scan.status)
      .is("committed_at", null)
      .select("id");
    if (resetError) {
      return {
        kind: "retry",
        code: "reextract_reset_failed",
        message: resetError.message,
      };
    }
    if (!resetRows || resetRows.length !== 1) {
      return {
        kind: "dead",
        code: "reextract_superseded",
        message: "The scan changed before re-extraction started.",
      };
    }
  }

  // C04 (db audit 2026-08-23): a scan can reach status='failed' from a
  // prior attempt's fenced catch-path write (invoice-scan-service.ts),
  // which fences on status='processing'. If this retry proceeds straight
  // to processInvoiceScanOnce with the scan still 'failed', that same
  // fencing is what breaks: the eventual success write (`.eq("status",
  // "processing")`) misses (0 rows), the persist is reported as
  // `scan_superseded`, and this job gets marked 'succeeded' even though
  // the scan is permanently stuck at 'failed' with no data — a real
  // result silently discarded and misreported as success. Resetting the
  // fence back to 'processing' here, fenced on the row still being
  // 'failed', restores the invariant every other fenced write in this
  // pipeline depends on before any of them run again. Safe under
  // concurrency: idempotency_key = scanId is unique, so only one
  // background_jobs row — and therefore only one claim — can ever exist
  // for a given scanId (see 0083's enqueue_invoice_extract_job).
  if (scan.status === "failed") {
    const { error: resetError } = await supabase
      .from("invoice_scans")
      .update({ status: "processing" } as never)
      .eq("id", scan.id)
      .eq("status", "failed");
    if (resetError) {
      return { kind: "retry", code: "failed_reset_failed", message: resetError.message };
    }
  }

  const targets = invoicePageTargets({
    restaurantId: job.restaurantId,
    scanId: scan.id,
    rawImagePath: scan.raw_image_path,
    extraImagePaths: scan.extra_image_paths,
  });
  if (!targets.ok) {
    return { kind: "dead", code: targets.code, message: targets.message };
  }

  const downloadedPages: Array<InvoicePageTarget & { buffer: Buffer }> = [];
  let totalBytes = 0;
  for (const page of targets.pages) {
    const { data: fileData, error: downloadError } = await supabase.storage
      .from(INVOICE_IMAGE_BUCKET)
      .download(page.path);
    if (downloadError || !fileData) {
      return {
        kind: "retry",
        code: "image_download_failed",
        message: downloadError?.message ?? "Storage download returned no data.",
      };
    }

    let buffer: Buffer;
    try {
      buffer = Buffer.from(await fileData.arrayBuffer());
    } catch {
      return {
        kind: "retry",
        code: "image_download_failed",
        message: "Storage download could not be read.",
      };
    }
    totalBytes += buffer.length;
    if (
      buffer.length === 0 ||
      buffer.length > MAX_PAGE_BYTES ||
      totalBytes > MAX_TOTAL_BYTES
    ) {
      return {
        kind: "dead",
        code: "invalid_invoice_page_size",
        message: "Every invoice page must be non-empty and at most 10 MiB.",
      };
    }
    if (fileData.type.trim().toLowerCase() !== page.mimeType) {
      return {
        kind: "dead",
        code: "invalid_invoice_page_mime",
        message: "An invoice page MIME type does not match its stored path.",
      };
    }
    downloadedPages.push({ ...page, buffer });
  }

  const [primaryPage, ...extraPages] = downloadedPages;
  if (!primaryPage) {
    return {
      kind: "dead",
      code: "invalid_invoice_page_count",
      message: "An invoice scan must contain a primary page.",
    };
  }

  // ── Double-bill window: pre-call fencing check ─────────────────────
  // The extraction call below has no bounded timeout and can legitimately
  // run long enough to cross the stuck-job threshold. Without this check,
  // a worker that has *already* been reclaimed (its lease is gone, a new
  // worker owns this job) would still go ahead and call Anthropic/Azure —
  // that's the double-bill window. Verify, via a fresh read, that this
  // worker still holds the claim right now, immediately before starting
  // the call. During the call itself, withClaimHeartbeat renews the lease
  // periodically so a worker that's merely slow (not dead) is never
  // reclaimed in the first place. See heartbeat.ts for what this can and
  // can't guarantee, and complete.ts for the fenced completion writes
  // that back this up.
  if (!(await isStillClaimed(supabase, job))) {
    return {
      kind: "retry",
      code: "claim_lost_before_extraction",
      message: "Job was reclaimed by another worker before extraction started.",
    };
  }

  let result;
  try {
    result = await withClaimHeartbeat(supabase, job, HEARTBEAT_INTERVAL_MS, () =>
      processInvoiceScanOnce({
        supabase,
        restaurantId: job.restaurantId,
        // Inert on this path: processInvoiceScanOnce only reads userId when
        // creating a fresh invoice_scans row, which preCreatedScanId skips.
        userId: job.createdBy ?? scan.created_by ?? SYSTEM_USER_PLACEHOLDER,
        fileBuffer: primaryPage.buffer,
        mimeType: primaryPage.mimeType,
        extraFiles:
          extraPages.length > 0
            ? extraPages.map((page) => ({
                buffer: page.buffer,
                mimeType: page.mimeType,
              }))
            : undefined,
        preCreatedScanId: scan.id,
        preUploadedPath: primaryPage.path,
      }),
    );
  } catch (error) {
    return {
      kind: "retry",
      code: "extraction_threw",
      message: error instanceof Error ? error.message : String(error),
    };
  }

  return classifyResult(result);
}

function classifyResult(result: { status: number; body: unknown }): JobOutcome {
  if (result.status === 200) {
    return { kind: "succeeded", skippedExtraction: false };
  }

  const body = result.body as { code?: string; message?: string } | undefined;
  const code = body?.code ?? `http_${result.status}`;
  const message = body?.message ?? `Extraction returned status ${result.status}.`;

  // Grok-2: a fenced write that lost the race (another attempt already
  // persisted this scan's result) is not a failure to retry or kill —
  // it's the same "already persisted" outcome as the ALREADY_PERSISTED
  // status check above, just discovered later, at persist time instead
  // of before the provider call.
  if (code === "scan_superseded") {
    return { kind: "succeeded", skippedExtraction: true };
  }

  if (RETRYABLE_CODES.has(code) || result.status >= 500) {
    return { kind: "retry", code, message };
  }
  return { kind: "dead", code, message };
}
