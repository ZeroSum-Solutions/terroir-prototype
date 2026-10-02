import { describe, expect, it, vi } from "vitest";
import {
  invalidIdempotencyKeyResult,
  isValidIdempotencyKey,
  withIdempotency,
} from "./idempotency";

const KEY = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const RESTAURANT = "11111111-1111-4111-8111-111111111111";
const SCAN = "22222222-2222-4222-8222-222222222222";

function client(script: Record<string, Array<{ data: unknown; error: unknown }>>) {
  const calls: Array<{ name: string; args: unknown }> = [];
  return {
    calls,
    rpc: vi.fn(async (name: string, args: unknown) => {
      calls.push({ name, args });
      const result = script[name]?.shift();
      if (!result) throw new Error(`Unexpected RPC ${name}`);
      return result;
    }),
  };
}

const receipt = {
  version: 1 as const,
  kind: "invoice_scan_upload" as const,
  scanId: SCAN,
  status: "queued" as const,
  itemCount: 0 as const,
};

describe("scan idempotency RPC adapter", () => {
  it("requires a canonical UUID key", () => {
    expect(isValidIdempotencyKey(KEY)).toBe(true);
    expect(isValidIdempotencyKey(null)).toBe(false);
    expect(isValidIdempotencyKey("opaque-key")).toBe(false);
    expect(invalidIdempotencyKeyResult()).toMatchObject({
      status: 400,
      body: { error: { code: "idempotency_key_required" } },
    });
  });

  it("claims, runs once, completes with typed scalar arguments, and returns 202", async () => {
    const supabase = client({
      claim_scan_idempotency: [
        { data: [{ disposition: "claimed", receipt: null }], error: null },
      ],
      complete_scan_idempotency: [{ data: receipt, error: null }],
    });
    const handler = vi.fn(async () => ({ outcome: "complete" as const, receipt }));

    const result = await withIdempotency({
      supabase: supabase as never,
      restaurantId: RESTAURANT,
      key: KEY,
      kind: "invoice_scan_upload",
      handler,
    });

    expect(result).toEqual({ status: 202, body: receipt, replayed: false });
    expect(handler).toHaveBeenCalledOnce();
    expect(supabase.calls[1]).toEqual({
      name: "complete_scan_idempotency",
      args: {
        p_restaurant_id: RESTAURANT,
        p_key: KEY,
        p_kind: "invoice_scan_upload",
        p_scan_id: SCAN,
        p_item_count: 0,
        p_wine_count: null,
        p_wine_id: null,
      },
    });
  });

  it("strictly replays only the requested kind and never runs the handler", async () => {
    const supabase = client({
      claim_scan_idempotency: [
        { data: [{ disposition: "replay", receipt }], error: null },
      ],
    });
    const handler = vi.fn();

    const result = await withIdempotency({
      supabase: supabase as never,
      restaurantId: RESTAURANT,
      key: KEY,
      kind: "invoice_scan_upload",
      handler,
    });

    expect(result).toEqual({ status: 202, body: receipt, replayed: true });
    expect(handler).not.toHaveBeenCalled();
  });

  it.each([
    ["in_progress", "idempotency_in_progress"],
    ["expired", "idempotency_expired"],
  ] as const)("maps %s to an explicit 409 without handler work", async (disposition, code) => {
    const supabase = client({
      claim_scan_idempotency: [
        { data: [{ disposition, receipt: null }], error: null },
      ],
    });
    const handler = vi.fn();
    const result = await withIdempotency({
      supabase: supabase as never,
      restaurantId: RESTAURANT,
      key: KEY,
      kind: "invoice_scan_upload",
      handler,
    });
    expect(result).toMatchObject({ status: 409, body: { error: { code } } });
    expect(handler).not.toHaveBeenCalled();
  });

  it("maps the database's closed actor/kind conflict to 409", async () => {
    const supabase = client({
      claim_scan_idempotency: [{
        data: null,
        error: { code: "P0001", message: "C04_IDEMPOTENCY_CONFLICT" },
      }],
    });
    const handler = vi.fn();
    const result = await withIdempotency({
      supabase: supabase as never,
      restaurantId: RESTAURANT,
      key: KEY,
      kind: "invoice_scan_upload",
      handler,
    });
    expect(result).toMatchObject({
      status: 409,
      body: { error: { code: "idempotency_conflict" } },
    });
    expect(handler).not.toHaveBeenCalled();
  });

  it.each([
    { name: "claim error", claim: { data: null, error: { code: "XX000" } } },
    { name: "malformed claim", claim: { data: [], error: null } },
    {
      name: "wrong-kind replay",
      claim: {
        data: [{
          disposition: "replay",
          receipt: {
            version: 1,
            kind: "bottle_inventory_save",
            wineId: "33333333-3333-4333-8333-333333333333",
            status: "committed",
            itemCount: 1,
          },
        }],
        error: null,
      },
    },
  ])("fails closed on $name", async ({ claim }) => {
    const supabase = client({ claim_scan_idempotency: [claim] });
    const handler = vi.fn();
    const result = await withIdempotency({
      supabase: supabase as never,
      restaurantId: RESTAURANT,
      key: KEY,
      kind: "invoice_scan_upload",
      handler,
    });
    expect(result).toMatchObject({ status: 500 });
    expect(handler).not.toHaveBeenCalled();
  });

  it("abandons only a declared safe failure before returning it", async () => {
    const supabase = client({
      claim_scan_idempotency: [
        { data: [{ disposition: "claimed", receipt: null }], error: null },
      ],
      abandon_scan_idempotency: [{ data: true, error: null }],
    });
    const result = await withIdempotency({
      supabase: supabase as never,
      restaurantId: RESTAURANT,
      key: KEY,
      kind: "invoice_scan_upload",
      handler: async () => ({
        outcome: "abandon",
        response: { status: 422, body: { error: { code: "invalid" } } },
      }),
    });
    expect(result).toEqual({
      status: 422,
      body: { error: { code: "invalid" } },
      replayed: false,
    });
    expect(supabase.calls.at(-1)?.name).toBe("abandon_scan_idempotency");
  });

  it("preserves the claim when the handler throws because the business outcome is uncertain", async () => {
    const supabase = client({
      claim_scan_idempotency: [
        { data: [{ disposition: "claimed", receipt: null }], error: null },
      ],
    });
    const failure = new Error("transport ended after the request was sent");
    await expect(withIdempotency({
      supabase: supabase as never,
      restaurantId: RESTAURANT,
      key: KEY,
      kind: "invoice_scan_upload",
      handler: async () => { throw failure; },
    })).rejects.toBe(failure);
    expect(supabase.calls.map((call) => call.name)).toEqual([
      "claim_scan_idempotency",
    ]);
  });

  it("does not abandon or acknowledge success when completion fails", async () => {
    const supabase = client({
      claim_scan_idempotency: [
        { data: [{ disposition: "claimed", receipt: null }], error: null },
      ],
      complete_scan_idempotency: [
        { data: null, error: { code: "XX000", message: "storage failure" } },
      ],
    });
    const result = await withIdempotency({
      supabase: supabase as never,
      restaurantId: RESTAURANT,
      key: KEY,
      kind: "invoice_scan_upload",
      handler: async () => ({ outcome: "complete", receipt }),
    });
    expect(result).toMatchObject({ status: 500, replayed: false });
    expect(supabase.calls.map((call) => call.name)).toEqual([
      "claim_scan_idempotency",
      "complete_scan_idempotency",
    ]);
  });

  it("fails closed when abandon returns false", async () => {
    const supabase = client({
      claim_scan_idempotency: [
        { data: [{ disposition: "claimed", receipt: null }], error: null },
      ],
      abandon_scan_idempotency: [{ data: false, error: null }],
    });
    const result = await withIdempotency({
      supabase: supabase as never,
      restaurantId: RESTAURANT,
      key: KEY,
      kind: "invoice_scan_upload",
      handler: async () => ({
        outcome: "abandon",
        response: { status: 422, body: { error: { code: "invalid" } } },
      }),
    });
    expect(result).toMatchObject({ status: 500 });
  });
});
