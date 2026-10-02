import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import type { Database } from "@/types/database";
import {
  readImportBatchCostRows,
  readImportBatchDisplayRows,
  readInventoryCosts,
  readRestaurantPricingDefaults,
} from "./protected-readers";

const RESTAURANT_ID = "11111111-1111-4111-8111-111111111111";
const WINE_ID = "22222222-2222-4222-8222-222222222222";
const INVENTORY_ID = "33333333-3333-4333-8333-333333333333";
const BATCH_ID = "44444444-4444-4444-8444-444444444444";
const ROW_ID = "55555555-5555-4555-8555-555555555555";

type RpcResponse = { data: unknown[] | null; error: { message: string } | null };

function builder(response: RpcResponse) {
  const resolved = Promise.resolve(response);
  return {
    range: vi.fn(async (from: number, to: number) => ({
      ...response,
      data: response.data?.slice(from, to + 1) ?? response.data,
    })),
    then: resolved.then.bind(resolved),
  };
}

function clientWith(rpc: ReturnType<typeof vi.fn>): SupabaseClient<Database> {
  return { rpc } as unknown as SupabaseClient<Database>;
}

describe("staff-cost protected readers", () => {
  it("pages typed cost rows through the closed RPC without naming a protected table column", async () => {
    const data = Array.from({ length: 1001 }, (_, index) => ({
      inventory_item_id: index === 0 ? INVENTORY_ID : crypto.randomUUID(),
      wine_id: WINE_ID,
      invoice_scan_id: null,
      unit_cost: 42,
      currency: "USD",
      added_at: "2026-09-26T12:00:00+00:00",
    }));
    const query = builder({ data, error: null });
    const rpc = vi.fn(() => query);

    const rows = await readInventoryCosts(clientWith(rpc), RESTAURANT_ID, [WINE_ID]);

    expect(rows).toHaveLength(1001);
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(rpc).toHaveBeenNthCalledWith(1, "read_inventory_costs", {
      p_restaurant_id: RESTAURANT_ID,
      p_wine_ids: [WINE_ID],
    });
    expect(query.range.mock.calls).toEqual([[0, 999], [1000, 1999]]);
  });

  it("rejects duplicate or oversized wine filters before making an RPC", async () => {
    const rpc = vi.fn();
    const client = clientWith(rpc);

    expect(() => readInventoryCosts(client, RESTAURANT_ID, [WINE_ID, WINE_ID])).toThrow(
      "at most 500 unique UUIDs",
    );
    expect(() =>
      readInventoryCosts(client, RESTAURANT_ID, Array.from({ length: 501 }, () => WINE_ID)),
    ).toThrow("at most 500 unique UUIDs");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("throws provider and malformed-result failures instead of returning a restricted-looking value", async () => {
    const providerError = { message: "permission denied" };
    await expect(
      readRestaurantPricingDefaults(
        clientWith(vi.fn(() => builder({ data: null, error: providerError }))),
        RESTAURANT_ID,
      ),
    ).rejects.toBe(providerError);

    await expect(
      readRestaurantPricingDefaults(
        clientWith(vi.fn(() => builder({ data: [{ restaurant_id: "not-a-uuid" }], error: null }))),
        RESTAURANT_ID,
      ),
    ).rejects.toThrow();
  });

  it("validates import page bounds and sends the exact bounded arguments", async () => {
    const row = {
      row_id: ROW_ID,
      batch_id: BATCH_ID,
      restaurant_id: RESTAURANT_ID,
      row_number: 7,
      raw: { wine_name: "Margaux" },
      manual_unit_cost: 18,
      validation_errors: [],
      last_error_message: null,
      cost_status: "provided",
      resolution: "pending",
      apply_status: "pending",
      applied_inventory_item_id: null,
      applied_wine_id: WINE_ID,
      apply_attempts: 0,
      lwin_id: null,
      lwin_score: null,
      lwin_status: "unmatched",
      duplicate_reason: null,
      row_state: "ready",
      resolved_at: null,
      resolved_by: null,
      created_at: "2026-09-26T12:00:00+00:00",
      updated_at: "2026-09-26T12:00:00+00:00",
    };
    const rpc = vi.fn(() => builder({ data: [row], error: null }));
    const client = clientWith(rpc);

    await expect(readImportBatchCostRows(client, BATCH_ID, { limit: 501 })).rejects.toThrow();
    await expect(
      readImportBatchCostRows(client, BATCH_ID, { afterRowNumber: -1 }),
    ).rejects.toThrow();
    await expect(
      readImportBatchCostRows(client, BATCH_ID, { afterRowNumber: 6, limit: 1 }),
    ).resolves.toEqual([row]);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("read_import_batch_cost_rows", {
      p_batch_id: BATCH_ID,
      p_after_row_number: 6,
      p_limit: 1,
    });
  });

  it("returns only the typed cost-free import display projection", async () => {
    const row = {
      row_id: ROW_ID,
      batch_id: BATCH_ID,
      restaurant_id: RESTAURANT_ID,
      row_number: 7,
      producer: "Chateau Example",
      name: "Reserve",
    };
    const rpc = vi.fn(() => builder({ data: [row], error: null }));

    await expect(
      readImportBatchDisplayRows(clientWith(rpc), BATCH_ID, {
        afterRowNumber: 6,
        limit: 100,
      }),
    ).resolves.toEqual([row]);
    expect(rpc).toHaveBeenCalledWith("read_import_batch_display_rows", {
      p_batch_id: BATCH_ID,
      p_after_row_number: 6,
      p_limit: 100,
    });
  });
});
