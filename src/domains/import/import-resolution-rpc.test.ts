import { describe, expect, it, vi } from "vitest";
import {
  bulkResolveImportRowsRpc,
  resolveImportRowRpc,
} from "./import-resolution-rpc";

const ROW_ID = "44444444-4444-4444-8444-444444444444";
const BATCH_ID = "33333333-3333-4333-8333-333333333333";
const OTHER_ID = "11111111-1111-4111-8111-111111111111";

function client(result: { data: unknown; error: unknown }) {
  return { rpc: vi.fn().mockResolvedValue(result) };
}

describe("resolveImportRowRpc", () => {
  const receipt = {
    rowId: ROW_ID,
    batchId: BATCH_ID,
    status: "resolved",
    updated: true,
  } as const;

  it("calls the user-scoped RPC once and accepts only its exact matching receipt", async () => {
    const supabase = client({ data: receipt, error: null });
    const result = await resolveImportRowRpc(
      supabase as never,
      ROW_ID,
      BATCH_ID,
      "include",
      19.99,
    );

    expect(result).toEqual({ ok: true, receipt });
    expect(supabase.rpc).toHaveBeenCalledOnce();
    expect(supabase.rpc).toHaveBeenCalledWith("resolve_import_batch_row", {
      p_row_id: ROW_ID,
      p_action: "include",
      p_manual_unit_cost: 19.99,
    });
  });

  it("omits the nullable manual-cost argument when it is not applicable", async () => {
    const supabase = client({ data: receipt, error: null });
    await resolveImportRowRpc(supabase as never, ROW_ID, BATCH_ID, "exclude");
    expect(supabase.rpc).toHaveBeenCalledWith("resolve_import_batch_row", {
      p_row_id: ROW_ID,
      p_action: "exclude",
    });
  });

  it.each([
    null,
    { ...receipt, extra: true },
    { ...receipt, rowId: OTHER_ID },
    { ...receipt, batchId: OTHER_ID },
    { ...receipt, status: "pending" },
    { ...receipt, updated: false },
  ])("rejects an invalid or mismatched receipt %#", async (data) => {
    const result = await resolveImportRowRpc(
      client({ data, error: null }) as never,
      ROW_ID,
      BATCH_ID,
      "exclude",
    );
    expect(result).toEqual({
      ok: false,
      error: { code: "internal_error", message: "Could not resolve import row." },
    });
  });

  it.each([
    [{ code: "42501", message: "forbidden", details: "private" }, "forbidden", "Forbidden"],
    [{ code: "P0001", message: "C04_IMPORT_RESOLVE_REFUSED", hint: "private" }, "resolution_refused", "Could not resolve import row."],
    [{ code: "P0002", message: "C04_IMPORT_RESOLVE_REFUSED", hint: "private" }, "internal_error", "Could not resolve import row."],
    [{ code: "42501", message: " forbidden ", details: "private" }, "internal_error", "Could not resolve import row."],
    [{ code: "P0001", message: "C04_IMPORT_RESOLVE_REFUSED ", hint: "private" }, "internal_error", "Could not resolve import row."],
    [{ code: "XX000", message: "raw database failure", details: "private" }, "internal_error", "Could not resolve import row."],
  ])("maps only exact admitted failures to fixed row errors %#", async (error, code, message) => {
    const result = await resolveImportRowRpc(
      client({ data: null, error }) as never,
      ROW_ID,
      BATCH_ID,
      "exclude",
    );
    expect(result).toEqual({ ok: false, error: { code, message } });
    expect(JSON.stringify(result)).not.toContain("private");
    if (error.message !== "forbidden") expect(JSON.stringify(result)).not.toContain(error.message);
  });

  it("keeps a thrown RPC failure fixed and redacted", async () => {
    const supabase = client({ data: receipt, error: null });
    supabase.rpc.mockRejectedValue(new Error("private socket failure"));
    const result = await resolveImportRowRpc(supabase as never, ROW_ID, BATCH_ID, "exclude");
    expect(result).toEqual({
      ok: false,
      error: { code: "internal_error", message: "Could not resolve import row." },
    });
    expect(JSON.stringify(result)).not.toContain("private socket failure");
  });
});

describe("bulkResolveImportRowsRpc", () => {
  const receipt = {
    batchId: BATCH_ID,
    status: "resolved",
    resolvedCount: 3,
    remainingPending: 1,
  } as const;

  it("calls the user-scoped RPC once and accepts an exact count receipt", async () => {
    const supabase = client({ data: receipt, error: null });
    const result = await bulkResolveImportRowsRpc(supabase as never, BATCH_ID, "exclude");
    expect(result).toEqual({ ok: true, receipt });
    expect(supabase.rpc).toHaveBeenCalledOnce();
    expect(supabase.rpc).toHaveBeenCalledWith("bulk_resolve_import_batch_rows", {
      p_batch_id: BATCH_ID,
      p_action: "exclude",
    });
  });

  it("accepts an exact zero-count replay receipt", async () => {
    const replay = { ...receipt, resolvedCount: 0, remainingPending: 0 };
    const result = await bulkResolveImportRowsRpc(
      client({ data: replay, error: null }) as never,
      BATCH_ID,
      "include",
    );
    expect(result).toEqual({ ok: true, receipt: replay });
  });

  it.each([
    null,
    { ...receipt, extra: true },
    { ...receipt, batchId: OTHER_ID },
    { ...receipt, status: "pending" },
    { ...receipt, resolvedCount: -1 },
    { ...receipt, resolvedCount: 5_000, remainingPending: 1 },
  ])("rejects an invalid or mismatched receipt %#", async (data) => {
    const result = await bulkResolveImportRowsRpc(
      client({ data, error: null }) as never,
      BATCH_ID,
      "exclude",
    );
    expect(result).toEqual({
      ok: false,
      error: { code: "internal_error", message: "Could not resolve import rows." },
    });
  });

  it.each([
    [{ code: "42501", message: "forbidden", details: "private" }, "forbidden", "Forbidden"],
    [{ code: "P0001", message: "C04_IMPORT_BULK_RESOLVE_REFUSED", hint: "private" }, "resolution_refused", "Could not resolve import rows."],
    [{ code: "P0002", message: "C04_IMPORT_BULK_RESOLVE_REFUSED", hint: "private" }, "internal_error", "Could not resolve import rows."],
    [{ code: "42501", message: " forbidden ", details: "private" }, "internal_error", "Could not resolve import rows."],
    [{ code: "P0001", message: "C04_IMPORT_BULK_RESOLVE_REFUSED ", hint: "private" }, "internal_error", "Could not resolve import rows."],
    [{ code: "XX000", message: "raw database failure", details: "private" }, "internal_error", "Could not resolve import rows."],
  ])("maps only exact admitted failures to fixed bulk errors %#", async (error, code, message) => {
    const result = await bulkResolveImportRowsRpc(
      client({ data: null, error }) as never,
      BATCH_ID,
      "exclude",
    );
    expect(result).toEqual({ ok: false, error: { code, message } });
    expect(JSON.stringify(result)).not.toContain("private");
    if (error.message !== "forbidden") expect(JSON.stringify(result)).not.toContain(error.message);
  });

  it("keeps a thrown RPC failure fixed and redacted", async () => {
    const supabase = client({ data: receipt, error: null });
    supabase.rpc.mockRejectedValue(new Error("private socket failure"));
    const result = await bulkResolveImportRowsRpc(supabase as never, BATCH_ID, "exclude");
    expect(result).toEqual({
      ok: false,
      error: { code: "internal_error", message: "Could not resolve import rows." },
    });
    expect(JSON.stringify(result)).not.toContain("private socket failure");
  });
});
