// P3 — unit coverage for getImportSessionProgress's derived `status`.
//
// import_sessions.status is only ever written to 'reverted' (by
// revert_import_session, 0110) — nothing promotes it to 'completed' when
// every chunk finishes applying. getImportSessionProgress derives that case
// itself rather than trusting the stored column, so a fully-applied session
// reports 'completed' (and the browser stops offering to resume it) without
// a DB write. See the audit's finding #4.

import { describe, expect, it, vi } from "vitest";
import { getImportSessionProgress, revertImportSession } from "./session-service";

const SESSION_ID = "44444444-4444-4444-8444-444444444444";

type Batch = { id: string; chunk_index: number | null; status: string };
type Counts = { total: number; applied: number; excluded: number; pending: number; eligible_not_applied: number };

/** Builds a fake supabase client for getImportSessionProgress: one
 * import_sessions row, N import_batches rows, and a count_import_batch_rows
 * RPC answered per-batch-id via `countsByBatchId`. */
function makeSupabase(
  session: { status: string; declared_chunk_total: number | null } | null,
  batches: Batch[],
  countsByBatchId: Record<string, Counts>,
) {
  const from = vi.fn((table: string) => {
    if (table === "import_sessions") {
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({
              data: session ? { id: SESSION_ID, ...session } : null,
              error: null,
            }),
          }),
        }),
      };
    }
    if (table === "import_batches") {
      return {
        select: () => ({
          eq: () => ({
            order: async () => ({ data: batches, error: null }),
          }),
        }),
      };
    }
    throw new Error(`unexpected table ${table}`);
  });

  const rpc = vi.fn((name: string, args: { p_batch_id: string }) => {
    if (name !== "count_import_batch_rows") throw new Error(`unexpected rpc ${name}`);
    return Promise.resolve({ data: [countsByBatchId[args.p_batch_id]], error: null });
  });

  return { from, rpc };
}

const SETTLED: Counts = { total: 5, applied: 5, excluded: 0, pending: 0, eligible_not_applied: 0 };
const UNSETTLED: Counts = { total: 5, applied: 2, excluded: 0, pending: 0, eligible_not_applied: 3 };

describe("getImportSessionProgress — derived status", () => {
  it("reports 'completed' when stored status is 'in_progress' but every declared chunk arrived and is fully applied", async () => {
    const batches: Batch[] = [
      { id: "b1", chunk_index: 1, status: "completed" },
      { id: "b2", chunk_index: 2, status: "completed" },
    ];
    const supabase = makeSupabase({ status: "in_progress", declared_chunk_total: 2 }, batches, {
      b1: SETTLED,
      b2: SETTLED,
    });

    const progress = await getImportSessionProgress(supabase as never, SESSION_ID);

    expect(progress?.status).toBe("completed");
    expect(progress?.allApplied).toBe(true);
  });

  it("stays 'in_progress' while any chunk still has eligible or pending rows", async () => {
    const batches: Batch[] = [
      { id: "b1", chunk_index: 1, status: "completed" },
      { id: "b2", chunk_index: 2, status: "created" },
    ];
    const supabase = makeSupabase({ status: "in_progress", declared_chunk_total: 2 }, batches, {
      b1: SETTLED,
      b2: UNSETTLED,
    });

    const progress = await getImportSessionProgress(supabase as never, SESSION_ID);

    expect(progress?.status).toBe("in_progress");
  });

  it("stays 'in_progress' when a declared chunk hasn't arrived yet, even if every present chunk is fully applied", async () => {
    // Only chunk 1 of a declared 2 has shown up.
    const batches: Batch[] = [{ id: "b1", chunk_index: 1, status: "completed" }];
    const supabase = makeSupabase({ status: "in_progress", declared_chunk_total: 2 }, batches, { b1: SETTLED });

    const progress = await getImportSessionProgress(supabase as never, SESSION_ID);

    expect(progress?.allChunksPresent).toBe(false);
    expect(progress?.status).toBe("in_progress");
  });

  it("never derives 'completed' for a session with zero batches yet", async () => {
    const supabase = makeSupabase({ status: "in_progress", declared_chunk_total: null }, [], {});

    const progress = await getImportSessionProgress(supabase as never, SESSION_ID);

    expect(progress?.status).toBe("in_progress");
  });

  it("leaves a 'reverted' session's status untouched", async () => {
    const batches: Batch[] = [{ id: "b1", chunk_index: 1, status: "reverted" }];
    const supabase = makeSupabase({ status: "reverted", declared_chunk_total: 1 }, batches, { b1: SETTLED });

    const progress = await getImportSessionProgress(supabase as never, SESSION_ID);

    expect(progress?.status).toBe("reverted");
  });
});

describe("revertImportSession", () => {
  function makeRevertSupabase(data: unknown, error: unknown = null) {
    return { rpc: vi.fn().mockResolvedValue({ data, error }) };
  }

  it("returns the parsed child outcomes when every child reverted", async () => {
    const data = {
      sessionId: SESSION_ID,
      batches: [{ batchId: "b2", chunkIndex: 2, skipped: false, revertedCount: 4 }],
    };
    const result = await revertImportSession(makeRevertSupabase(data) as never, SESSION_ID);
    expect(result).toEqual({ ok: true, ...data });
  });

  it("returns a dependency conflict with every parsed outcome when one skipped child has the exact reason", async () => {
    const batches = [
      { batchId: "b2", chunkIndex: 2, skipped: true, reason: "physical_bottle_dependency" },
      { batchId: "b1", chunkIndex: 1, skipped: false, revertedCount: 3 },
    ];
    const result = await revertImportSession(makeRevertSupabase({ sessionId: SESSION_ID, batches }) as never, SESSION_ID);
    expect(result).toEqual({
      ok: false,
      error: {
        code: "physical_bottle_dependency",
        message: "Import session cannot be fully reverted because physical bottles depend on imported inventory.",
      },
      batches,
    });
  });

  it("keeps a near-match skipped reason in the existing successful result", async () => {
    const batches = [{ batchId: "b1", chunkIndex: 1, skipped: true, reason: "physical_bottle_dependency: detail" }];
    const result = await revertImportSession(makeRevertSupabase({ sessionId: SESSION_ID, batches }) as never, SESSION_ID);
    expect(result).toEqual({ ok: true, sessionId: SESSION_ID, batches });
  });

  it("keeps not-found and unknown RPC errors distinct", async () => {
    const missing = await revertImportSession(makeRevertSupabase(null, { code: "P0002", message: "raw missing" }) as never, SESSION_ID);
    expect(missing).toEqual({ ok: false, error: { code: "not_found", message: "Import session not found." } });
    const unknown = { code: "P0001", message: "other failure" };
    await expect(revertImportSession(makeRevertSupabase(null, unknown) as never, SESSION_ID)).rejects.toBe(unknown);
  });
});
