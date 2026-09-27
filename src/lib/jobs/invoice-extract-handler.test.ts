import { beforeEach, describe, expect, it, vi } from "vitest";

const mockProcessInvoiceScanOnce = vi.fn();
vi.mock("@/domains/scanning/invoice-scan-service", () => ({
  processInvoiceScanOnce: (...args: unknown[]) => mockProcessInvoiceScanOnce(...args),
}));

const { runInvoiceExtractJob } = await import("@/lib/jobs/invoice-extract-handler");
import type { ClaimedInvoiceExtractJob } from "@/lib/jobs/types";

function job(overrides: Partial<ClaimedInvoiceExtractJob> = {}): ClaimedInvoiceExtractJob {
  return {
    id: "job-1",
    restaurantId: "restaurant-a",
    createdBy: null,
    subjectId: "scan-1",
    attemptCount: 0,
    maxAttempts: 5,
    claimedBy: "worker-1",
    ...overrides,
  };
}

function supabaseFor(opts: {
  scan?: Record<string, unknown> | null;
  fetchError?: unknown;
  downloadData?: unknown;
  downloadError?: unknown;
  downloads?: Record<string, { data: unknown; error: unknown }>;
  downloadCalls?: string[];
  /** Whether the background_jobs claim-check (isStillClaimed) finds this worker still owns the job. Default true. */
  stillClaimed?: boolean;
  /** C04: error returned by the failed->processing reset UPDATE, if any. */
  resetError?: unknown;
  /** C04: records every invoice_scans UPDATE payload issued (the reset write). */
  resetUpdateCalls?: Array<{ payload: unknown }>;
  resetRows?: Array<{ id: string }> | null;
}) {
  const {
    scan = null,
    fetchError = null,
    downloadData = null,
    downloadError = null,
    downloads,
    downloadCalls = [],
    stillClaimed = true,
    resetError = null,
    resetUpdateCalls = [],
    resetRows = [{ id: "scan-1" }],
  } = opts;
  return {
    from: vi.fn((table: string) => {
      if (table === "invoice_scans") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              eq: vi.fn(() => ({
                maybeSingle: vi.fn(async () => ({ data: scan, error: fetchError })),
              })),
            })),
          })),
          update: vi.fn((payload: unknown) => {
            resetUpdateCalls.push({ payload });
            const chain = {
              eq: vi.fn(() => chain),
              is: vi.fn(() => chain),
              select: vi.fn(async () => ({ data: resetRows, error: resetError })),
              then: (
                resolve: (value: { data: Array<{ id: string }> | null; error: unknown }) => unknown,
              ) => Promise.resolve({ data: resetRows, error: resetError }).then(resolve),
            };
            return chain;
          }),
        };
      }
      if (table === "background_jobs") {
        // isStillClaimed's fencing read: id + restaurant_id + claimed_by + status.
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              eq: vi.fn(() => ({
                eq: vi.fn(() => ({
                  eq: vi.fn(() => ({
                    maybeSingle: vi.fn(async () => ({
                      data: stillClaimed ? { id: "job-1" } : null,
                      error: null,
                    })),
                  })),
                })),
              })),
            })),
          })),
        };
      }
      throw new Error(`unexpected table in test mock: ${table}`);
    }),
    storage: {
      from: vi.fn(() => ({
        download: vi.fn(async (path: string) => {
          downloadCalls.push(path);
          return downloads?.[path] ?? { data: downloadData, error: downloadError };
        }),
      })),
    },
  };
}

const validScan = {
  id: "scan-1",
  status: "processing",
  raw_image_path: "restaurant-a/x.jpg",
  extra_image_paths: [],
  created_by: "user-1",
  committed_at: null,
};

const fakeBlob = {
  type: "image/jpeg",
  arrayBuffer: async () => new TextEncoder().encode("bytes").buffer,
};
const fakePngBlob = {
  type: "image/png",
  arrayBuffer: async () => new TextEncoder().encode("png-bytes").buffer,
};

function blobOfSize(size: number, type = "") {
  return { type, arrayBuffer: async () => new Uint8Array(size).buffer };
}

describe("runInvoiceExtractJob", () => {
  beforeEach(() => {
    mockProcessInvoiceScanOnce.mockReset();
  });

  it("dies immediately when the job has no subject_id", async () => {
    const outcome = await runInvoiceExtractJob({
      supabase: supabaseFor({}) as never,
      job: job({ subjectId: null }),
    });
    expect(outcome.kind).toBe("dead");
    expect((outcome as { code: string }).code).toBe("missing_subject");
  });

  it("dies when no scan is found scoped to the job's restaurant_id (tenant mismatch or missing row)", async () => {
    const outcome = await runInvoiceExtractJob({
      supabase: supabaseFor({ scan: null }) as never,
      job: job(),
    });
    expect(outcome.kind).toBe("dead");
    expect((outcome as { code: string }).code).toBe("tenant_mismatch_or_missing_subject");
    expect(mockProcessInvoiceScanOnce).not.toHaveBeenCalled();
  });

  it("retries when the tenant-scoped fetch itself errors (transient)", async () => {
    const outcome = await runInvoiceExtractJob({
      supabase: supabaseFor({ fetchError: { message: "connection reset" } }) as never,
      job: job(),
    });
    expect(outcome.kind).toBe("retry");
    expect((outcome as { code: string }).code).toBe("subject_fetch_failed");
  });

  it("succeeds without calling the extraction service when the scan is already complete (no double-bill)", async () => {
    const outcome = await runInvoiceExtractJob({
      supabase: supabaseFor({ scan: { ...validScan, status: "complete" } }) as never,
      job: job({ attemptCount: 1 }),
    });
    expect(outcome).toEqual({ kind: "succeeded", skippedExtraction: true });
    expect(mockProcessInvoiceScanOnce).not.toHaveBeenCalled();
  });

  it("succeeds without calling the extraction service when the scan is already in review (G1-12 arithmetic-mismatch outcome, no double-bill)", async () => {
    const outcome = await runInvoiceExtractJob({
      supabase: supabaseFor({ scan: { ...validScan, status: "review" } }) as never,
      job: job({ attemptCount: 1 }),
    });
    expect(outcome).toEqual({ kind: "succeeded", skippedExtraction: true });
    expect(mockProcessInvoiceScanOnce).not.toHaveBeenCalled();
  });

  it("reruns a deliberately requeued uncommitted completed scan after fencing it to processing", async () => {
    mockProcessInvoiceScanOnce.mockResolvedValue({
      status: 200,
      body: { scanId: "scan-1" },
    });
    const resetUpdateCalls: Array<{ payload: unknown }> = [];
    const outcome = await runInvoiceExtractJob({
      supabase: supabaseFor({
        scan: { ...validScan, status: "complete" },
        downloadData: fakeBlob,
        resetUpdateCalls,
      }) as never,
      job: job({ attemptCount: 0 }),
    });

    expect(outcome).toEqual({ kind: "succeeded", skippedExtraction: false });
    expect(resetUpdateCalls).toEqual([{ payload: { status: "processing" } }]);
    expect(mockProcessInvoiceScanOnce).toHaveBeenCalledOnce();
  });

  it("never reopens a committed scan even when its job attempt was reset", async () => {
    const outcome = await runInvoiceExtractJob({
      supabase: supabaseFor({
        scan: {
          ...validScan,
          status: "complete",
          committed_at: "2026-09-26T12:00:00.000Z",
        },
      }) as never,
      job: job({ attemptCount: 0 }),
    });
    expect(outcome).toEqual({ kind: "succeeded", skippedExtraction: true });
    expect(mockProcessInvoiceScanOnce).not.toHaveBeenCalled();
  });

  it("dies when raw_image_path is missing", async () => {
    const outcome = await runInvoiceExtractJob({
      supabase: supabaseFor({ scan: { ...validScan, raw_image_path: null } }) as never,
      job: job(),
    });
    expect(outcome.kind).toBe("dead");
    expect((outcome as { code: string }).code).toBe("missing_or_mistenanted_image_path");
  });

  it("dies when raw_image_path is not scoped to the job's restaurant (defense in depth)", async () => {
    const outcome = await runInvoiceExtractJob({
      supabase: supabaseFor({ scan: { ...validScan, raw_image_path: "restaurant-b/x.jpg" } }) as never,
      job: job(),
    });
    expect(outcome.kind).toBe("dead");
    expect((outcome as { code: string }).code).toBe("missing_or_mistenanted_image_path");
    expect(mockProcessInvoiceScanOnce).not.toHaveBeenCalled();
  });

  it("dies on an unsupported file extension", async () => {
    const outcome = await runInvoiceExtractJob({
      supabase: supabaseFor({ scan: { ...validScan, raw_image_path: "restaurant-a/x.bmp" } }) as never,
      job: job(),
    });
    expect(outcome.kind).toBe("dead");
    expect((outcome as { code: string }).code).toBe("unsupported_extension");
  });

  it("retries on a storage download failure", async () => {
    const outcome = await runInvoiceExtractJob({
      supabase: supabaseFor({ scan: validScan, downloadError: { message: "storage unavailable" } }) as never,
      job: job(),
    });
    expect(outcome.kind).toBe("retry");
    expect((outcome as { code: string }).code).toBe("image_download_failed");
  });

  it("aborts WITHOUT calling the extraction service when the claim was lost before extraction started (closes the double-bill window)", async () => {
    const outcome = await runInvoiceExtractJob({
      supabase: supabaseFor({ scan: validScan, downloadData: fakeBlob, stillClaimed: false }) as never,
      job: job(),
    });
    expect(outcome.kind).toBe("retry");
    expect((outcome as { code: string }).code).toBe("claim_lost_before_extraction");
    expect(mockProcessInvoiceScanOnce).not.toHaveBeenCalled();
  });

  it("succeeds when the extraction service returns 200, calling it with the pre-created scan", async () => {
    mockProcessInvoiceScanOnce.mockResolvedValue({ status: 200, body: { scanId: "scan-1" } });
    const outcome = await runInvoiceExtractJob({
      supabase: supabaseFor({ scan: validScan, downloadData: fakeBlob }) as never,
      job: job(),
    });
    expect(outcome).toEqual({ kind: "succeeded", skippedExtraction: false });
    expect(mockProcessInvoiceScanOnce).toHaveBeenCalledWith(
      expect.objectContaining({
        restaurantId: "restaurant-a",
        preCreatedScanId: "scan-1",
        preUploadedPath: "restaurant-a/x.jpg",
        mimeType: "image/jpeg",
        extraFiles: undefined,
        userId: "user-1",
      }),
    );
  });

  it("downloads and forwards every stored invoice page in deterministic order", async () => {
    mockProcessInvoiceScanOnce.mockResolvedValue({ status: 200, body: { scanId: "scan-1" } });
    const downloadCalls: string[] = [];
    const outcome = await runInvoiceExtractJob({
      supabase: supabaseFor({
        scan: {
          ...validScan,
          raw_image_path: "restaurant-a/scan-1_page1.jpg",
          extra_image_paths: ["restaurant-a/scan-1_page2.png"],
        },
        downloads: {
          "restaurant-a/scan-1_page1.jpg": { data: fakeBlob, error: null },
          "restaurant-a/scan-1_page2.png": { data: fakePngBlob, error: null },
        },
        downloadCalls,
      }) as never,
      job: job(),
    });

    expect(outcome).toEqual({ kind: "succeeded", skippedExtraction: false });
    expect(downloadCalls).toEqual([
      "restaurant-a/scan-1_page1.jpg",
      "restaurant-a/scan-1_page2.png",
    ]);
    expect(mockProcessInvoiceScanOnce).toHaveBeenCalledWith(
      expect.objectContaining({
        mimeType: "image/jpeg",
        extraFiles: [{ buffer: expect.any(Buffer), mimeType: "image/png" }],
      }),
    );
  });

  it("preserves a safe nested legacy single-page object", async () => {
    mockProcessInvoiceScanOnce.mockResolvedValue({ status: 200, body: { scanId: "scan-1" } });
    const legacyPath = "restaurant-a/cached-scan/invoice.jpg";
    const outcome = await runInvoiceExtractJob({
      supabase: supabaseFor({
        scan: { ...validScan, raw_image_path: legacyPath },
        downloadData: fakeBlob,
      }) as never,
      job: job(),
    });

    expect(outcome).toEqual({ kind: "succeeded", skippedExtraction: false });
    expect(mockProcessInvoiceScanOnce).toHaveBeenCalledWith(
      expect.objectContaining({
        preUploadedPath: legacyPath,
        mimeType: "image/jpeg",
      }),
    );
  });

  it("downloads and forwards the maximum eight photo pages without dropping one", async () => {
    mockProcessInvoiceScanOnce.mockResolvedValue({ status: 200, body: { scanId: "scan-1" } });
    const paths = Array.from(
      { length: 8 },
      (_, index) => `restaurant-a/scan-1_page${index + 1}.jpg`,
    );
    const downloadCalls: string[] = [];

    const outcome = await runInvoiceExtractJob({
      supabase: supabaseFor({
        scan: {
          ...validScan,
          raw_image_path: paths[0],
          extra_image_paths: paths.slice(1),
        },
        downloadData: fakeBlob,
        downloadCalls,
      }) as never,
      job: job(),
    });

    expect(outcome).toEqual({ kind: "succeeded", skippedExtraction: false });
    expect(downloadCalls).toEqual(paths);
    const input = mockProcessInvoiceScanOnce.mock.calls[0][0] as {
      extraFiles?: Array<{ buffer: Buffer; mimeType: string }>;
    };
    expect(input.extraFiles).toHaveLength(7);
    expect(input.extraFiles?.every((page) => page.mimeType === "image/jpeg")).toBe(true);
  });

  it.each([
    null,
    {},
    "restaurant-a/scan-1_page2.jpg",
    ["restaurant-a/scan-1_page2.jpg", 3],
  ])("dies before download/provider when extra_image_paths is malformed: %j", async (extraImagePaths) => {
    const downloadCalls: string[] = [];
    const outcome = await runInvoiceExtractJob({
      supabase: supabaseFor({
        scan: { ...validScan, extra_image_paths: extraImagePaths },
        downloadData: fakeBlob,
        downloadCalls,
      }) as never,
      job: job(),
    });

    expect(outcome.kind).toBe("dead");
    expect((outcome as { code: string }).code).toBe("invalid_invoice_image_paths");
    expect(downloadCalls).toEqual([]);
    expect(mockProcessInvoiceScanOnce).not.toHaveBeenCalled();
  });

  it("dies before download/provider when an invoice stores more than eight pages", async () => {
    const paths = Array.from(
      { length: 9 },
      (_, index) => `restaurant-a/scan-1_page${index + 1}.jpg`,
    );
    const downloadCalls: string[] = [];
    const outcome = await runInvoiceExtractJob({
      supabase: supabaseFor({
        scan: {
          ...validScan,
          raw_image_path: paths[0],
          extra_image_paths: paths.slice(1),
        },
        downloadData: fakeBlob,
        downloadCalls,
      }) as never,
      job: job(),
    });

    expect(outcome.kind).toBe("dead");
    expect((outcome as { code: string }).code).toBe("invalid_invoice_page_count");
    expect(downloadCalls).toEqual([]);
    expect(mockProcessInvoiceScanOnce).not.toHaveBeenCalled();
  });

  it.each([
    {
      name: "cross-site extra",
      raw: "restaurant-a/scan-1_page1.jpg",
      extras: ["restaurant-b/scan-1_page2.jpg"],
    },
    {
      name: "duplicate",
      raw: "restaurant-a/scan-1_page1.jpg",
      extras: ["restaurant-a/scan-1_page1.jpg"],
    },
    {
      name: "out-of-order ordinal",
      raw: "restaurant-a/scan-1_page1.jpg",
      extras: ["restaurant-a/scan-1_page3.jpg"],
    },
    {
      name: "parent traversal",
      raw: "restaurant-a/../restaurant-b/x.jpg",
      extras: [],
    },
    {
      name: "encoded traversal",
      raw: "restaurant-a/%2e%2e/restaurant-b/x.jpg",
      extras: [],
    },
    {
      name: "encoded null control",
      raw: "restaurant-a/x%00.jpg",
      extras: [],
    },
    {
      name: "encoded newline control",
      raw: "restaurant-a/x%0a.jpg",
      extras: [],
    },
    {
      name: "encoded delete control",
      raw: "restaurant-a/x%7f.jpg",
      extras: [],
    },
    {
      name: "recursively encoded traversal",
      raw: "restaurant-a/%252e%252e/restaurant-b/x.jpg",
      extras: [],
    },
  ])("dies before download/provider for $name paths", async ({ raw, extras }) => {
    const downloadCalls: string[] = [];
    const outcome = await runInvoiceExtractJob({
      supabase: supabaseFor({
        scan: { ...validScan, raw_image_path: raw, extra_image_paths: extras },
        downloadData: fakeBlob,
        downloadCalls,
      }) as never,
      job: job(),
    });

    expect(outcome.kind).toBe("dead");
    expect(downloadCalls).toEqual([]);
    expect(mockProcessInvoiceScanOnce).not.toHaveBeenCalled();
  });

  it("retries without provider work when a later page is missing", async () => {
    const firstPath = "restaurant-a/scan-1_page1.jpg";
    const secondPath = "restaurant-a/scan-1_page2.png";
    const outcome = await runInvoiceExtractJob({
      supabase: supabaseFor({
        scan: {
          ...validScan,
          raw_image_path: firstPath,
          extra_image_paths: [secondPath],
        },
        downloads: {
          [firstPath]: { data: fakeBlob, error: null },
          [secondPath]: { data: null, error: null },
        },
      }) as never,
      job: job(),
    });

    expect(outcome.kind).toBe("retry");
    expect((outcome as { code: string }).code).toBe("image_download_failed");
    expect(mockProcessInvoiceScanOnce).not.toHaveBeenCalled();
  });

  it("dies without provider work when any page exceeds 10 MiB", async () => {
    const firstPath = "restaurant-a/scan-1_page1.jpg";
    const secondPath = "restaurant-a/scan-1_page2.png";
    const outcome = await runInvoiceExtractJob({
      supabase: supabaseFor({
        scan: {
          ...validScan,
          raw_image_path: firstPath,
          extra_image_paths: [secondPath],
        },
        downloads: {
          [firstPath]: { data: fakeBlob, error: null },
          [secondPath]: { data: blobOfSize(10 * 1024 * 1024 + 1), error: null },
        },
      }) as never,
      job: job(),
    });

    expect(outcome.kind).toBe("dead");
    expect((outcome as { code: string }).code).toBe("invalid_invoice_page_size");
    expect(mockProcessInvoiceScanOnce).not.toHaveBeenCalled();
  });

  it("dies without provider work when stored MIME conflicts with the path", async () => {
    const outcome = await runInvoiceExtractJob({
      supabase: supabaseFor({
        scan: validScan,
        downloadData: blobOfSize(10, "application/pdf"),
      }) as never,
      job: job(),
    });

    expect(outcome.kind).toBe("dead");
    expect((outcome as { code: string }).code).toBe("invalid_invoice_page_mime");
    expect(mockProcessInvoiceScanOnce).not.toHaveBeenCalled();
  });

  it("dies without provider work when a later page has no MIME metadata", async () => {
    const firstPath = "restaurant-a/scan-1_page1.jpg";
    const secondPath = "restaurant-a/scan-1_page2.png";
    const outcome = await runInvoiceExtractJob({
      supabase: supabaseFor({
        scan: {
          ...validScan,
          raw_image_path: firstPath,
          extra_image_paths: [secondPath],
        },
        downloads: {
          [firstPath]: { data: fakeBlob, error: null },
          [secondPath]: { data: blobOfSize(10), error: null },
        },
      }) as never,
      job: job(),
    });

    expect(outcome.kind).toBe("dead");
    expect((outcome as { code: string }).code).toBe("invalid_invoice_page_mime");
    expect(mockProcessInvoiceScanOnce).not.toHaveBeenCalled();
  });

  it.each([
    ["upstream_error", 502, "retry"],
    ["rate_limited", 429, "retry"],
    ["parse_failed", 422, "dead"],
    ["validation_failed", 422, "dead"],
    ["no_wines_extracted", 422, "dead"],
    ["bad_input", 400, "dead"],
  ] as const)("classifies extraction code %s (status %d) as %s", async (code, status, expectedKind) => {
    mockProcessInvoiceScanOnce.mockResolvedValue({ status, body: { code, message: "boom" } });
    const outcome = await runInvoiceExtractJob({
      supabase: supabaseFor({ scan: validScan, downloadData: fakeBlob }) as never,
      job: job(),
    });
    expect(outcome.kind).toBe(expectedKind);
  });

  it("treats a 409 scan_superseded result as succeeded/skipped (Grok-2: fenced write lost the race)", async () => {
    mockProcessInvoiceScanOnce.mockResolvedValue({
      status: 409,
      body: { code: "scan_superseded", message: "Scan was already completed by another worker attempt." },
    });
    const outcome = await runInvoiceExtractJob({
      supabase: supabaseFor({ scan: validScan, downloadData: fakeBlob }) as never,
      job: job(),
    });
    expect(outcome).toEqual({ kind: "succeeded", skippedExtraction: true });
  });

  it("retries any 5xx even with an unrecognized code", async () => {
    mockProcessInvoiceScanOnce.mockResolvedValue({ status: 503, body: {} });
    const outcome = await runInvoiceExtractJob({
      supabase: supabaseFor({ scan: validScan, downloadData: fakeBlob }) as never,
      job: job(),
    });
    expect(outcome.kind).toBe("retry");
  });

  it("retries when the extraction service throws", async () => {
    mockProcessInvoiceScanOnce.mockRejectedValue(new Error("network blip"));
    const outcome = await runInvoiceExtractJob({
      supabase: supabaseFor({ scan: validScan, downloadData: fakeBlob }) as never,
      job: job(),
    });
    expect(outcome.kind).toBe("retry");
    expect((outcome as { code: string }).code).toBe("extraction_threw");
  });

  describe("C04: failed -> processing reset before a retry", () => {
    it("resets a failed scan back to processing (fenced on status='failed') before calling the extraction service", async () => {
      mockProcessInvoiceScanOnce.mockResolvedValue({ status: 200, body: { scanId: "scan-1" } });
      const resetUpdateCalls: Array<{ payload: unknown }> = [];
      const outcome = await runInvoiceExtractJob({
        supabase: supabaseFor({
          scan: { ...validScan, status: "failed" },
          downloadData: fakeBlob,
          resetUpdateCalls,
        }) as never,
        job: job(),
      });

      expect(resetUpdateCalls).toEqual([{ payload: { status: "processing" } }]);
      expect(outcome).toEqual({ kind: "succeeded", skippedExtraction: false });
      expect(mockProcessInvoiceScanOnce).toHaveBeenCalledTimes(1);
    });

    it("retries without calling the extraction service when the reset write itself fails", async () => {
      const outcome = await runInvoiceExtractJob({
        supabase: supabaseFor({
          scan: { ...validScan, status: "failed" },
          downloadData: fakeBlob,
          resetError: { message: "connection reset" },
        }) as never,
        job: job(),
      });

      expect(outcome.kind).toBe("retry");
      expect((outcome as { code: string }).code).toBe("failed_reset_failed");
      expect(mockProcessInvoiceScanOnce).not.toHaveBeenCalled();
    });

    it("does not attempt a reset when the scan is not 'failed'", async () => {
      mockProcessInvoiceScanOnce.mockResolvedValue({ status: 200, body: { scanId: "scan-1" } });
      const resetUpdateCalls: Array<{ payload: unknown }> = [];
      await runInvoiceExtractJob({
        supabase: supabaseFor({ scan: validScan, downloadData: fakeBlob, resetUpdateCalls }) as never,
        job: job(),
      });
      expect(resetUpdateCalls).toEqual([]);
    });
  });
});
