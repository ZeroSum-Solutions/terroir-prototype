import { describe, expect, it, vi } from "vitest";
import {
  markJobDeadImmediately,
  markJobRetryOrDead,
  markJobSucceeded,
} from "@/lib/jobs/complete";
import type { ClaimedInvoiceExtractJob } from "@/lib/jobs/types";

function baseJob(overrides: Partial<ClaimedInvoiceExtractJob> = {}): ClaimedInvoiceExtractJob {
  return {
    id: "job-1",
    restaurantId: "restaurant-a",
    createdBy: null,
    subjectId: "scan-1",
    attemptCount: 0,
    maxAttempts: 3,
    claimedBy: "worker-1",
    ...overrides,
  };
}

const STORED_FAILURE_MESSAGE = "Invoice extraction job failed.";

const recognizedFailureCodes = [
  "missing_subject",
  "subject_fetch_failed",
  "tenant_mismatch_or_missing_subject",
  "reextract_reset_failed",
  "reextract_superseded",
  "failed_reset_failed",
  "missing_or_mistenanted_image_path",
  "invalid_invoice_image_paths",
  "invalid_invoice_page_count",
  "unsupported_extension",
  "image_download_failed",
  "invalid_invoice_page_size",
  "invalid_invoice_page_mime",
  "claim_lost_before_extraction",
  "extraction_threw",
  "not_configured",
  "upstream_error",
  "empty_text",
  "parse_failed",
  "validation_failed",
  "rate_limited",
  "bad_input",
  "unknown",
  "no_wines_extracted",
] as const;

const rawFailureCases = [
  { source: "database", code: "subject_fetch_failed", message: "SENTINEL_DB_ROW_DETAIL" },
  { source: "Storage", code: "image_download_failed", message: "SENTINEL_BUCKET/PATH" },
  { source: "OCR provider", code: "upstream_error", message: "SENTINEL_OCR_PROVIDER_BODY" },
  { source: "thrown error", code: "extraction_threw", message: "SENTINEL_THROWN_SECRET" },
] as const;

/** Captures the update patch and the fencing .eq() chain applied to it. */
function makeSupabase(returnedRows: unknown[] | null, error: unknown = null) {
  const eqCalls: Array<[string, unknown]> = [];
  let capturedPatch: Record<string, unknown> | undefined;
  const chain: Record<string, unknown> = {};
  chain.eq = vi.fn((col: string, val: unknown) => {
    eqCalls.push([col, val]);
    return chain;
  });
  chain.select = vi.fn(async () => ({ data: returnedRows, error }));
  const update = vi.fn((patch: Record<string, unknown>) => {
    capturedPatch = patch;
    return chain;
  });
  const supabase = { from: vi.fn(() => ({ update })) };
  return {
    supabase,
    eqCalls,
    getPatch: () => capturedPatch,
  };
}

describe("fenced completion writes", () => {
  it("markJobSucceeded fences on id, restaurant_id, claimed_by, and status=processing", async () => {
    const { supabase, eqCalls, getPatch } = makeSupabase([{ id: "job-1" }]);
    const applied = await markJobSucceeded(supabase as never, baseJob());

    expect(applied).toBe(true);
    expect(getPatch()).toMatchObject({ status: "succeeded", error_code: null, error_message: null });
    expect(eqCalls).toEqual([
      ["id", "job-1"],
      ["restaurant_id", "restaurant-a"],
      ["claimed_by", "worker-1"],
      ["status", "processing"],
    ]);
  });

  it("markJobSucceeded returns false when fenced out (0 rows updated)", async () => {
    const { supabase } = makeSupabase([]);
    expect(await markJobSucceeded(supabase as never, baseJob())).toBe(false);
  });

  it("markJobRetryOrDead requeues with backoff when attempts remain", async () => {
    const { supabase, getPatch } = makeSupabase([{ id: "job-1" }]);
    const job = baseJob({ attemptCount: 0, maxAttempts: 3 });
    await markJobRetryOrDead(supabase as never, job, { code: "upstream_error", message: "boom" });

    const patch = getPatch()!;
    expect(patch.status).toBe("queued");
    expect(patch.attempt_count).toBe(1);
    expect(patch.claimed_at).toBeNull();
    expect(patch.claimed_by).toBeNull();
    expect(patch.error_code).toBe("upstream_error");
    expect(typeof patch.run_after).toBe("string");
    expect(new Date(patch.run_after as string).getTime()).toBeGreaterThan(Date.now());
  });

  it("markJobRetryOrDead transitions to dead once max_attempts is exhausted", async () => {
    const { supabase, getPatch } = makeSupabase([{ id: "job-1" }]);
    const job = baseJob({ attemptCount: 2, maxAttempts: 3 });
    await markJobRetryOrDead(supabase as never, job, { code: "upstream_error", message: "boom" });

    const patch = getPatch()!;
    expect(patch.status).toBe("dead");
    expect(patch.attempt_count).toBe(3);
    expect(patch.finished_at).toBeDefined();
    expect(patch.run_after).toBeUndefined();
  });

  it("markJobDeadImmediately sets attempt_count to max_attempts and clears claim fields", async () => {
    const { supabase, getPatch } = makeSupabase([{ id: "job-1" }]);
    const job = baseJob({ attemptCount: 0, maxAttempts: 5 });
    await markJobDeadImmediately(supabase as never, job, {
      code: "tenant_mismatch_or_missing_subject",
      message: "nope",
    });

    const patch = getPatch()!;
    expect(patch.status).toBe("dead");
    expect(patch.attempt_count).toBe(5);
    expect(patch.claimed_at).toBeNull();
    expect(patch.claimed_by).toBeNull();
    expect(patch.error_code).toBe("tenant_mismatch_or_missing_subject");
  });

  it.each(rawFailureCases)(
    "markJobRetryOrDead redacts raw $source prose",
    async ({ code, message }) => {
      const { supabase, getPatch } = makeSupabase([{ id: "job-1" }]);

      await markJobRetryOrDead(supabase as never, baseJob(), { code, message });

      expect(getPatch()).toMatchObject({
        error_code: code,
        error_message: STORED_FAILURE_MESSAGE,
      });
      expect(JSON.stringify(getPatch())).not.toContain(message);
    },
  );

  it.each(rawFailureCases)(
    "markJobDeadImmediately redacts raw $source prose",
    async ({ code, message }) => {
      const { supabase, getPatch } = makeSupabase([{ id: "job-1" }]);

      await markJobDeadImmediately(supabase as never, baseJob(), { code, message });

      expect(getPatch()).toMatchObject({
        error_code: code,
        error_message: STORED_FAILURE_MESSAGE,
      });
      expect(JSON.stringify(getPatch())).not.toContain(message);
    },
  );

  it.each(recognizedFailureCodes)("preserves recognized code %s", async (code) => {
    const { supabase, getPatch } = makeSupabase([{ id: "job-1" }]);

    await markJobRetryOrDead(supabase as never, baseJob(), {
      code,
      message: `SENTINEL_RECOGNIZED_${code}`,
    });

    expect(getPatch()).toMatchObject({
      error_code: code,
      error_message: STORED_FAILURE_MESSAGE,
    });
  });

  it.each(["http_503", "arbitrary_dynamic_code"])(
    "maps unknown code %s to unknown without throwing",
    async (code) => {
      const retry = makeSupabase([{ id: "job-1" }]);
      await expect(
        markJobRetryOrDead(retry.supabase as never, baseJob(), {
          code,
          message: "SENTINEL_UNKNOWN_RETRY",
        }),
      ).resolves.toBe(true);
      expect(retry.getPatch()).toMatchObject({
        error_code: "unknown",
        error_message: STORED_FAILURE_MESSAGE,
      });

      const dead = makeSupabase([{ id: "job-1" }]);
      await expect(
        markJobDeadImmediately(dead.supabase as never, baseJob(), {
          code,
          message: "SENTINEL_UNKNOWN_DEAD",
        }),
      ).resolves.toBe(true);
      expect(dead.getPatch()).toMatchObject({
        error_code: "unknown",
        error_message: STORED_FAILURE_MESSAGE,
      });
    },
  );

  it("markJobRetryOrDead still throws database write errors", async () => {
    const dbError = { message: "retry write failed" };
    const { supabase } = makeSupabase(null, dbError);
    await expect(
      markJobRetryOrDead(supabase as never, baseJob(), {
        code: "upstream_error",
        message: "SENTINEL_RAW_MESSAGE",
      }),
    ).rejects.toBe(dbError);
  });

  it("markJobDeadImmediately still throws database write errors", async () => {
    const dbError = { message: "dead write failed" };
    const { supabase } = makeSupabase(null, dbError);
    await expect(
      markJobDeadImmediately(supabase as never, baseJob(), {
        code: "bad_input",
        message: "SENTINEL_RAW_MESSAGE",
      }),
    ).rejects.toBe(dbError);
  });

  it("throws on a database error instead of silently swallowing it", async () => {
    const dbError = { message: "connection reset" };
    const { supabase } = makeSupabase(null, dbError);
    await expect(markJobSucceeded(supabase as never, baseJob())).rejects.toBe(dbError);
  });
});
