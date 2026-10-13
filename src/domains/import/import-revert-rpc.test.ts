import { describe, expect, it, vi } from "vitest";
import {
  revertImportBatchRpc,
  revertImportSessionRpc,
} from "./import-revert-rpc";

const BATCH_ID = "11111111-1111-4111-8111-111111111111";
const SECOND_BATCH_ID = "22222222-2222-4222-8222-222222222222";
const SESSION_ID = "44444444-4444-4444-8444-444444444444";

function client(result: { data: unknown; error: unknown }) {
  return { rpc: vi.fn().mockResolvedValue(result) };
}

const batchReceipt = {
  version: 1,
  batchId: BATCH_ID,
  status: "reverted",
  revertedItemCount: 3,
  orphanWinesDeleted: 0,
  lwinStampsCleared: 1,
} as const;

describe("revertImportBatchRpc", () => {
  it("accepts PostgreSQL's canonical receipt for an uppercase batch UUID", async () => {
    const canonicalId = "abcdefab-1234-4567-89ab-abcdefabcdef";
    const receipt = { ...batchReceipt, batchId: canonicalId };
    expect(await revertImportBatchRpc(client({ data: receipt, error: null }) as never, canonicalId.toUpperCase()))
      .toEqual({ ok: true, receipt });
  });

  it("calls only the typed user-scoped entry and accepts its exact retained-catalog receipt", async () => {
    const supabase = client({ data: batchReceipt, error: null });

    const result = await revertImportBatchRpc(supabase as never, BATCH_ID);

    expect(result).toEqual({ ok: true, receipt: batchReceipt });
    expect(supabase.rpc).toHaveBeenCalledOnce();
    expect(supabase.rpc).toHaveBeenCalledWith("revert_import_batch_private", {
      p_batch_id: BATCH_ID,
    });
  });

  it.each([
    null,
    { ...batchReceipt, extra: true },
    { ...batchReceipt, batchId: SECOND_BATCH_ID },
    { ...batchReceipt, version: 2 },
    { ...batchReceipt, revertedItemCount: -1 },
    { ...batchReceipt, orphanWinesDeleted: 1 },
    { ...batchReceipt, lwinStampsCleared: 0.5 },
  ])("rejects malformed or mismatched receipts without reporting partial success: %#", async (data) => {
    const result = await revertImportBatchRpc(
      client({ data, error: null }) as never,
      BATCH_ID,
    );

    expect(result).toEqual({
      ok: false,
      error: { code: "internal_error", message: "Could not revert import batch." },
    });
  });

  it("maps a committed retry to the stable already-reverted result", async () => {
    const result = await revertImportBatchRpc(client({
      data: null,
      error: { code: "P04I1", message: "import_batch_already_reverted", details: "private" },
    }) as never, BATCH_ID);

    expect(result).toEqual({
      ok: false,
      error: { code: "already_reverted", message: "Import batch is already reverted." },
    });
    expect(JSON.stringify(result)).not.toContain("private");
  });

  it("maps the exact shared-source refusal to a fixed retained-catalog conflict", async () => {
    const result = await revertImportBatchRpc(client({
      data: null,
      error: { code: "P04I2", message: "import_source_conflict", details: "private" },
    }) as never, BATCH_ID);

    expect(result).toEqual({
      ok: false,
      error: {
        code: "import_source_conflict",
        message: "Import inventory is linked to multiple import rows, so this revert was not performed. Wine catalog entries and import history are unchanged. Ask a manager to review the import.",
      },
    });
    expect(JSON.stringify(result)).not.toContain("private");
  });

  it.each([
    { code: "P04I2", message: "unknown_source_conflict" },
    { code: "XX000", message: "import_source_conflict" },
  ])("fails closed when only one half of the shared-source error pair matches: %#", async (error) => {
    const result = await revertImportBatchRpc(client({ data: null, error }) as never, BATCH_ID);
    expect(result).toEqual({
      ok: false,
      error: { code: "internal_error", message: "Could not revert import batch." },
    });
  });

  it.each([
    { code: "P0001", message: "C04_IMPORT_REVERT_REFUSED", details: "private trigger failure" },
    { code: "25000", message: "read_committed_required", details: "private isolation state" },
    { code: "XX000", message: "private database failure" },
  ])("fails closed and redacts an atomic database refusal: %#", async (error) => {
    const supabase = client({ data: null, error });
    const result = await revertImportBatchRpc(supabase as never, BATCH_ID);

    expect(result).toEqual({
      ok: false,
      error: { code: "internal_error", message: "Could not revert import batch." },
    });
    expect(supabase.rpc).toHaveBeenCalledOnce();
    expect(JSON.stringify(result)).not.toContain("private");
  });
});

describe("revertImportSessionRpc", () => {
  const receipt = {
    version: 1,
    sessionId: SESSION_ID,
    status: "reverted",
    batches: [
      {
        batchId: SECOND_BATCH_ID,
        chunkIndex: 2,
        skipped: false,
        status: "reverted",
        revertedItemCount: 3,
        orphanWinesDeleted: 0,
        lwinStampsCleared: 1,
      },
      {
        batchId: BATCH_ID,
        chunkIndex: 1,
        skipped: true,
        reason: "already_reverted",
      },
    ],
    revertedBatchCount: 1,
    blockedBatchCount: 0,
    revertedItemCount: 3,
  } as const;

  it("accepts the exact all-or-nothing session receipt", async () => {
    const supabase = client({ data: receipt, error: null });
    const result = await revertImportSessionRpc(supabase as never, SESSION_ID);

    expect(result).toEqual({ ok: true, receipt });
    expect(supabase.rpc).toHaveBeenCalledWith("revert_import_session", {
      p_session_id: SESSION_ID,
    });
  });

  it("accepts PostgreSQL's canonical receipt for an uppercase session UUID", async () => {
    const canonicalId = "abcdefab-1234-4567-89ab-abcdefabcdef";
    const canonicalReceipt = { ...receipt, sessionId: canonicalId };
    expect(await revertImportSessionRpc(client({ data: canonicalReceipt, error: null }) as never, canonicalId.toUpperCase()))
      .toEqual({ ok: true, receipt: canonicalReceipt });
  });

  it.each([
    { ...receipt, extra: true },
    { ...receipt, sessionId: "55555555-5555-4555-8555-555555555555" },
    { ...receipt, status: "in_progress" },
    { ...receipt, blockedBatchCount: 1 },
    { ...receipt, revertedBatchCount: 2 },
    { ...receipt, revertedItemCount: 2 },
    { ...receipt, batches: [...receipt.batches, receipt.batches[0]] },
    {
      ...receipt,
      batches: [{
        batchId: BATCH_ID,
        chunkIndex: 1,
        skipped: true,
        reason: "physical_bottle_dependency",
      }],
      revertedBatchCount: 0,
      revertedItemCount: 0,
    },
  ])("rejects a malformed, partial, or internally inconsistent session receipt: %#", async (data) => {
    const result = await revertImportSessionRpc(
      client({ data, error: null }) as never,
      SESSION_ID,
    );
    expect(result).toEqual({
      ok: false,
      error: { code: "internal_error", message: "Could not revert import session." },
    });
  });

  it("maps a physical dependency to a rolled-back conflict with no child receipt", async () => {
    const result = await revertImportSessionRpc(client({
      data: null,
      error: { code: "P04D3", message: "physical_bottle_dependency", details: "private" },
    }) as never, SESSION_ID);

    expect(result).toEqual({
      ok: false,
      error: {
        code: "physical_bottle_dependency",
        message: "Import session cannot be reverted because physical bottles depend on imported inventory.",
      },
    });
    expect(JSON.stringify(result)).not.toContain("private");
  });

  it("maps the exact shared-source refusal without exposing a partial session receipt", async () => {
    const result = await revertImportSessionRpc(client({
      data: null,
      error: { code: "P04I2", message: "import_source_conflict", details: "private" },
    }) as never, SESSION_ID);

    expect(result).toEqual({
      ok: false,
      error: {
        code: "import_source_conflict",
        message: "Import inventory is linked to multiple import rows, so this revert was not performed. Wine catalog entries and import history are unchanged. Ask a manager to review the import.",
      },
    });
    expect(JSON.stringify(result)).not.toContain("private");
  });

  it.each([
    { code: "P04I2", message: "unknown_source_conflict" },
    { code: "XX000", message: "import_source_conflict" },
  ])("fails closed when only one half of the session shared-source error pair matches: %#", async (error) => {
    const result = await revertImportSessionRpc(client({ data: null, error }) as never, SESSION_ID);
    expect(result).toEqual({
      ok: false,
      error: { code: "internal_error", message: "Could not revert import session." },
    });
  });
});
