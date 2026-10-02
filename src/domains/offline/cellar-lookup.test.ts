import { describe, expect, it } from "vitest";
import {
  fetchKeysetPages,
  loadOfflineCellarRows,
  mapOfflineCellarRows,
  OFFLINE_LOOKUP_SELECTS,
} from "./cellar-lookup";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

const wineId = "10000000-0000-4000-8000-000000000001";
const binA = "10000000-0000-4000-8000-000000000002";
const binB = "10000000-0000-4000-8000-000000000003";
const retiredBin = "10000000-0000-4000-8000-000000000004";

describe("mapOfflineCellarRows", () => {
  it("aggregates every lot and omits placements absent from the active-bin scan", () => {
    const rows = mapOfflineCellarRows({
      wines: [{
        id: wineId,
        name: "Volnay",
        producer: "Maison Example",
        vintage: 2022,
        size_ml: 750,
      }],
      inventory: [
        { id: "lot-1", wine_id: wineId, bin_id: binA, quantity: 2 },
        { id: "lot-2", wine_id: wineId, bin_id: binA, quantity: 1 },
        { id: "lot-3", wine_id: wineId, bin_id: binB, quantity: 4 },
        { id: "lot-4", wine_id: wineId, bin_id: retiredBin, quantity: 5 },
        { id: "lot-5", wine_id: wineId, bin_id: null, quantity: 6 },
      ],
      bins: [
        { id: binB, code: "Same label" },
        { id: binA, code: "Same label" },
      ],
      openBottles: [{
        id: "10000000-0000-4000-8000-000000000005",
        wine_id: wineId,
        opened_at: "2026-09-23T10:00:00.000Z",
        remaining_ml: 500,
      }],
    });

    expect(rows).toEqual([{
      wineId,
      displayName: "Volnay",
      producer: "Maison Example",
      vintage: 2022,
      format: "750ml",
      sealedQuantity: 18,
      placements: [
        { binId: binA, label: "Same label", sealedQuantity: 3 },
        { binId: binB, label: "Same label", sealedQuantity: 4 },
      ],
      activeOpenBottleId: "10000000-0000-4000-8000-000000000005",
      openedAt: "2026-09-23T10:00:00.000Z",
      remainingMl: 500,
    }]);
    expect(JSON.stringify(rows)).not.toContain("lot-");
  });

  it("fails closed when concurrent reads observe inventory after the wine snapshot", () => {
    const wines = [{
      id: wineId,
      name: "Volnay",
      producer: "Maison Example",
      vintage: null,
      size_ml: 750,
    }];

    expect(() => mapOfflineCellarRows({
      wines,
      inventory: [{ id: "lot", wine_id: "missing", bin_id: null, quantity: 1 }],
      bins: [],
      openBottles: [],
    })).toThrow("Offline inventory has no wine.");

    expect(() => mapOfflineCellarRows({
      wines,
      inventory: [],
      bins: [],
      openBottles: [{
        id: "open",
        wine_id: "missing",
        opened_at: "2026-09-23T10:00:00Z",
        remaining_ml: 1,
      }],
    })).toThrow("Offline bottle has no wine.");
  });

  it("uses advisory zero when a later inventory scan omits a wine's lots", () => {
    expect(mapOfflineCellarRows({
      wines: [{
        id: wineId,
        name: "Volnay",
        producer: "Maison Example",
        vintage: null,
        size_ml: 750,
      }],
      inventory: [],
      bins: [{ id: binA, code: "A-01" }],
      openBottles: [],
    })).toEqual([expect.objectContaining({
      wineId,
      sealedQuantity: 0,
      placements: [],
    })]);
  });

  it("fails closed on multiple active bottles for one wine", () => {
    const wines = [{
      id: wineId,
      name: "Volnay",
      producer: "Maison Example",
      vintage: null,
      size_ml: 750,
    }];

    expect(() => mapOfflineCellarRows({
      wines,
      inventory: [],
      bins: [],
      openBottles: [
        { id: "one", wine_id: wineId, opened_at: "2026-09-23T10:00:00Z", remaining_ml: 1 },
        { id: "two", wine_id: wineId, opened_at: "2026-09-23T11:00:00Z", remaining_ml: 2 },
      ],
    })).toThrow("multiple active bottles");
  });
});

describe("fetchKeysetPages", () => {
  it("reads beyond one page with an advancing stable key", async () => {
    const calls: Array<{ afterId: string | null; limit: number }> = [];
    const rows = await fetchKeysetPages(async (afterId, limit) => {
      calls.push({ afterId, limit });
      if (afterId === null) return { data: [{ id: "a" }, { id: "b" }], error: null };
      if (afterId === "b") return { data: [{ id: "c" }], error: null };
      return { data: [], error: null };
    }, { pageSize: 2, maxRows: 5 });

    expect(rows.map((row) => row.id)).toEqual(["a", "b", "c"]);
    expect(calls).toEqual([
      { afterId: null, limit: 2 },
      { afterId: "b", limit: 2 },
      { afterId: "c", limit: 2 },
    ]);
  });

  it("does not truncate when the server cap is below the requested page size", async () => {
    const source = ["a", "b", "c", "d", "e"].map((id) => ({ id }));
    const calls: Array<{ afterId: string | null; returned: number }> = [];

    const rows = await fetchKeysetPages(async (afterId) => {
      const start = afterId === null
        ? 0
        : source.findIndex((row) => row.id > afterId);
      const data = start < 0 ? [] : source.slice(start, start + 2);
      calls.push({ afterId, returned: data.length });
      return { data, error: null };
    }, { pageSize: 1_000, maxRows: 10 });

    expect(rows).toEqual(source);
    expect(calls).toEqual([
      { afterId: null, returned: 2 },
      { afterId: "b", returned: 2 },
      { afterId: "d", returned: 1 },
      { afterId: "e", returned: 0 },
    ]);
  });

  it("fails closed on database errors, non-advancing pages, and the safety cap", async () => {
    await expect(fetchKeysetPages(async () => ({ data: null, error: { message: "private" } })))
      .rejects.toThrow("Offline cellar lookup read failed.");
    await expect(fetchKeysetPages(async () => ({ data: [{ id: "same" }], error: null }), {
      pageSize: 1,
      maxRows: 3,
    })).rejects.toThrow("pagination did not advance");
    await expect(fetchKeysetPages(async () => ({
      data: [{ id: "b" }, { id: "a" }], error: null,
    }), { pageSize: 3 })).rejects.toThrow("pagination did not advance");
    await expect(fetchKeysetPages(async (afterId) => ({
      data: afterId ? [{ id: "c" }] : [{ id: "a" }, { id: "b" }],
      error: null,
    }), { pageSize: 2, maxRows: 2 })).rejects.toThrow("safe row limit");
  });

  it("rejects null data on the first page instead of treating it as exhaustion", async () => {
    await expect(fetchKeysetPages(async () => ({ data: null, error: null })))
      .rejects.toThrow("Offline cellar lookup read failed.");
  });

  it("rejects null data after a valid prefix instead of publishing truncation", async () => {
    await expect(fetchKeysetPages(async (afterId) => afterId === null
      ? { data: [{ id: "a" }], error: null }
      : { data: null, error: null }))
      .rejects.toThrow("Offline cellar lookup read failed.");
  });

  it.each([
    ["undefined data", { data: undefined, error: null }],
    ["undefined error", { data: [], error: undefined }],
    ["false error", { data: [], error: false }],
  ])("rejects the malformed %s result shape", async (_label, result) => {
    await expect(fetchKeysetPages(async () => result as never))
      .rejects.toThrow("Offline cellar lookup read failed.");
  });

  it("keeps the database select allowlist cost-free", () => {
    expect(OFFLINE_LOOKUP_SELECTS).toEqual({
      wines: "id, name, producer, vintage, size_ml",
      inventory_items: "id, wine_id, bin_id, quantity",
      bins: "id, code",
      open_bottles: "id, wine_id, opened_at, remaining_ml",
    });
    expect(Object.values(OFFLINE_LOOKUP_SELECTS).join(",")).not.toMatch(
      /cost|price|margin|note|role|member|staff|setting/i,
    );
  });
});

describe("loadOfflineCellarRows", () => {
  it("scopes every keyset page to the authorized site and reads beyond 1,000 rows", async () => {
    const wines = Array.from({ length: 1_001 }, (_, index) => ({
      id: `wine-${String(index).padStart(4, "0")}`,
      name: `Wine ${index}`,
      producer: "Producer",
      vintage: null,
      size_ml: 750,
    }));
    const calls: QueryCall[] = [];
    const client = queryClient({
      wines,
      inventory_items: [],
      bins: [],
      open_bottles: [],
    }, calls);

    const rows = await loadOfflineCellarRows(client, "authorized-restaurant");

    expect(rows).toHaveLength(1_001);
    expect(calls.filter((call) => call.table === "wines")).toHaveLength(3);
    expect(calls.every((call) => (
      call.restaurantId === "authorized-restaurant"
      && call.order === "id"
      && call.limit === 1_000
    ))).toBe(true);
    expect(calls.find((call) => call.table === "wines" && call.afterId)?.afterId)
      .toBe("wine-0999");
    expect(calls.find((call) => call.table === "bins")?.isNull)
      .toEqual(["retired_at", null]);
    expect(calls.find((call) => call.table === "open_bottles")?.isNull)
      .toEqual(["closed_at", null]);
    expect(calls.map(({ table, select }) => [table, select])).toEqual([
      ["wines", OFFLINE_LOOKUP_SELECTS.wines],
      ["inventory_items", OFFLINE_LOOKUP_SELECTS.inventory_items],
      ["bins", OFFLINE_LOOKUP_SELECTS.bins],
      ["open_bottles", OFFLINE_LOOKUP_SELECTS.open_bottles],
      ["wines", OFFLINE_LOOKUP_SELECTS.wines],
      ["wines", OFFLINE_LOOKUP_SELECTS.wines],
    ]);
  });
});

type QueryCall = {
  table: keyof typeof OFFLINE_LOOKUP_SELECTS;
  select: string;
  restaurantId: string | null;
  isNull: [string, null] | null;
  order: string | null;
  limit: number | null;
  afterId: string | null;
};

function queryClient(
  rowsByTable: Record<keyof typeof OFFLINE_LOOKUP_SELECTS, Array<{ id: string }>>,
  calls: QueryCall[],
): SupabaseClient<Database> {
  return {
    from(table: keyof typeof OFFLINE_LOOKUP_SELECTS) {
      const call: QueryCall = {
        table,
        select: "",
        restaurantId: null,
        isNull: null,
        order: null,
        limit: null,
        afterId: null,
      };
      const builder = {
        select(columns: string) { call.select = columns; return builder; },
        eq(column: string, value: string) {
          if (column === "restaurant_id") call.restaurantId = value;
          return builder;
        },
        is(column: string, value: null) { call.isNull = [column, value]; return builder; },
        order(column: string) { call.order = column; return builder; },
        limit(value: number) { call.limit = value; return builder; },
        gt(_column: string, value: string) { call.afterId = value; return builder; },
        then(resolve: (value: { data: Array<{ id: string }>; error: null }) => unknown) {
          const source = rowsByTable[table];
          const start = call.afterId
            ? source.findIndex((row) => row.id > call.afterId!)
            : 0;
          const data = start < 0 ? [] : source.slice(start, start + (call.limit ?? 1_000));
          calls.push({ ...call });
          return Promise.resolve({ data, error: null }).then(resolve);
        },
      };
      return builder;
    },
  } as unknown as SupabaseClient<Database>;
}
