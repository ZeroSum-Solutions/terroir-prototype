import { describe, expect, it, vi } from "vitest";
import {
  bulkResolveImportBatchRows,
  resolveImportBatchRow,
} from "./batch-service";

const RESTAURANT_ID = "11111111-1111-4111-8111-111111111111";
const USER_ID = "22222222-2222-4222-8222-222222222222";
const BATCH_ID = "33333333-3333-4333-8333-333333333333";
const ROW_ID = "44444444-4444-4444-8444-444444444444";
const rowReceipt = { rowId: ROW_ID, batchId: BATCH_ID, status: "resolved", updated: true } as const;
const bulkReceipt = { batchId: BATCH_ID, status: "resolved", resolvedCount: 3, remainingPending: 1 } as const;

function query(result: { data: unknown; error: unknown }, eqCalls: Array<[string, unknown]>) {
  const node: Record<string, unknown> = {
    select: () => node,
    eq: (column: string, value: unknown) => {
      eqCalls.push([column, value]);
      return node;
    },
    maybeSingle: async () => result,
    update: () => { throw new Error("direct protected mutation attempted"); },
  };
  return node;
}

function rowClient(row: { resolution: string; cost_status: string } | null, error: unknown = null) {
  const eqCalls: Array<[string, unknown]> = [];
  return {
    eqCalls,
    from: vi.fn(() => query({
      data: row ? { id: ROW_ID, batch_id: BATCH_ID, ...row } : null,
      error,
    }, eqCalls)),
    rpc: vi.fn().mockResolvedValue({ data: rowReceipt, error: null }),
  };
}

function batchClient(batch: { status: string } | null, error: unknown = null) {
  const eqCalls: Array<[string, unknown]> = [];
  return {
    eqCalls,
    from: vi.fn(() => query(
      { data: batch ? { id: BATCH_ID, ...batch } : null, error },
      eqCalls,
    )),
    rpc: vi.fn().mockResolvedValue({ data: bulkReceipt, error: null }),
  };
}

describe("resolveImportBatchRow", () => {
  it("preflights the tenant row and delegates one missing-cost resolution to the RPC", async () => {
    const supabase = rowClient({ resolution: "pending", cost_status: "missing" });
    const result = await resolveImportBatchRow(
      supabase as never,
      RESTAURANT_ID,
      USER_ID,
      ROW_ID,
      "include",
      19.99,
    );
    expect(result).toEqual({ ok: true, receipt: rowReceipt });
    expect(supabase.from).toHaveBeenCalledWith("import_batch_rows");
    expect(supabase.eqCalls).toEqual([
      ["id", ROW_ID],
      ["restaurant_id", RESTAURANT_ID],
    ]);
    expect(supabase.rpc).toHaveBeenCalledOnce();
    expect(supabase.rpc).toHaveBeenCalledWith("resolve_import_batch_row", {
      p_row_id: ROW_ID,
      p_action: "include",
      p_manual_unit_cost: 19.99,
    });
  });

  it.each([-1, 1_000_001, Number.POSITIVE_INFINITY, undefined])(
    "rejects an invalid missing-row manual cost (%s) before RPC",
    async (manualUnitCost) => {
      const supabase = rowClient({ resolution: "pending", cost_status: "missing" });
      const result = await resolveImportBatchRow(
        supabase as never, RESTAURANT_ID, USER_ID, ROW_ID, "include", manualUnitCost,
      );
      expect(result).toMatchObject({ ok: false, error: { code: "manual_cost_required" } });
      expect(supabase.rpc).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["exclude", "missing"],
    ["include", "present"],
  ] as const)("omits irrelevant supplied cost for %s/%s", async (action, costStatus) => {
    const supabase = rowClient({ resolution: "pending", cost_status: costStatus });
    await resolveImportBatchRow(
      supabase as never, RESTAURANT_ID, USER_ID, ROW_ID, action, 19.99,
    );
    expect(supabase.rpc).toHaveBeenCalledWith("resolve_import_batch_row", {
      p_row_id: ROW_ID,
      p_action: action,
    });
  });

  it.each([
    [null, null, "not_found"],
    [{ resolution: "auto", cost_status: "present" }, null, "not_pending"],
    [{ resolution: "pending", cost_status: "present" }, { code: "XX000" }, "internal_error"],
  ])("preserves row preflight refusal %#", async (row, error, code) => {
    const supabase = rowClient(row, error);
    const result = await resolveImportBatchRow(
      supabase as never, RESTAURANT_ID, USER_ID, ROW_ID, "exclude",
    );
    expect(result).toMatchObject({ ok: false, error: { code } });
    expect(supabase.rpc).not.toHaveBeenCalled();
  });
});

describe("bulkResolveImportBatchRows", () => {
  it("preflights the tenant batch and delegates one resolution to the RPC", async () => {
    const supabase = batchClient({ status: "created" });
    const result = await bulkResolveImportBatchRows(
      supabase as never, RESTAURANT_ID, USER_ID, BATCH_ID, "exclude",
    );
    expect(result).toEqual({ ok: true, receipt: bulkReceipt });
    expect(supabase.from).toHaveBeenCalledWith("import_batches");
    expect(supabase.eqCalls).toEqual([
      ["id", BATCH_ID],
      ["restaurant_id", RESTAURANT_ID],
    ]);
    expect(supabase.rpc).toHaveBeenCalledOnce();
  });

  it.each([
    [null, null, "not_found"],
    [{ status: "reverted" }, null, "reverted"],
    [{ status: "created" }, { code: "XX000" }, "internal_error"],
  ])("preserves batch preflight refusal %#", async (batch, error, code) => {
    const supabase = batchClient(batch, error);
    const result = await bulkResolveImportBatchRows(
      supabase as never, RESTAURANT_ID, USER_ID, BATCH_ID, "include",
    );
    expect(result).toMatchObject({ ok: false, error: { code } });
    expect(supabase.rpc).not.toHaveBeenCalled();
  });
});
