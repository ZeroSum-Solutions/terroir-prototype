import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { fetchPricingRecommendations } from "./fetch";

const RESTAURANT_ID = "00000000-0000-4000-8000-000000000099";

describe("fetchPricingRecommendations", () => {
  it("reads only the exact-site pricing RPC and maps wine details", async () => {
    const row = storedRow(1);
    const { client, rpc, from, ranges } = clientWithPages([row]);

    const rows = await fetchPricingRecommendations(client, RESTAURANT_ID);

    expect(rpc).toHaveBeenCalledOnce();
    expect(rpc).toHaveBeenCalledWith("read_pricing_recommendations", {
      p_restaurant_id: RESTAURANT_ID,
    });
    expect(from).not.toHaveBeenCalled();
    expect(ranges).toEqual([[0, 999]]);
    expect(rows).toEqual([
      expect.objectContaining({
        class: "hold",
        wineId: row.wine_id,
        wine: { name: "Wine 0001", producer: "Fixture", vintage: 2020 },
      }),
    ]);
  });

  it("pages beyond 1,000 rows exactly once and preserves RPC order", async () => {
    const source = Array.from({ length: 1001 }, (_, index) => storedRow(index + 1));
    const { client, rpc, ranges } = clientWithPages(source);

    const rows = await fetchPricingRecommendations(client, RESTAURANT_ID);

    expect(rpc).toHaveBeenCalledTimes(2);
    expect(ranges).toEqual([[0, 999], [1000, 1999]]);
    expect(rows).toHaveLength(1001);
    expect(rows.map((row) => row.wineId)).toEqual(
      source.map((row) => row.wine_id),
    );
  });

  it.each([
    "missing cost grant",
    "revoked grant",
    "expired grant",
    "foreign-site grant",
  ])("returns no protected rows for a caller with a %s", async () => {
    const { client } = clientWithPages([]);

    await expect(
      fetchPricingRecommendations(client, RESTAURANT_ID),
    ).resolves.toEqual([]);
  });

  it("propagates a provider error without returning protected rows", async () => {
    const error = { message: "connection lost" };
    const { client } = clientWithPages([], error);

    await expect(fetchPricingRecommendations(client, RESTAURANT_ID)).rejects.toBe(
      error,
    );
  });

  it("rejects malformed stored evidence instead of hiding the row", async () => {
    const malformed = { ...storedRow(1), evidence: {} };
    const { client } = clientWithPages([malformed]);

    await expect(
      fetchPricingRecommendations(client, RESTAURANT_ID),
    ).rejects.toThrow();
  });
});

function clientWithPages(rows: unknown[], error: unknown = null) {
  const ranges: Array<[number, number]> = [];
  const rpc = vi.fn(() => {
    const builder = {
      range: (from: number, to: number) => {
        ranges.push([from, to]);
        return Promise.resolve({
          data: error == null ? rows.slice(from, to + 1) : null,
          error,
        });
      },
    };
    return builder;
  });
  const from = vi.fn();
  return {
    client: { rpc, from } as unknown as SupabaseClient<Database>,
    rpc,
    from,
    ranges,
  };
}

function storedRow(index: number) {
  const suffix = index.toString(16).padStart(12, "0");
  return {
    wine_id: `00000000-0000-4000-8000-${suffix}`,
    class: "hold" as const,
    rationale: `No action is supported for wine ${index}.`,
    evidence: {
      healthSegment: "hold" as const,
      appreciation: 0.05,
      appreciationThreshold: 0.08,
      velocity30d: 0,
      marginPct: 60,
      marginThresholdPct: 70,
      dayOfWeekProfile: {},
      selectedDay: null,
    },
    timing: null,
    computed_at: "2026-08-19T12:00:00.000+00:00",
    wines: {
      name: `Wine ${String(index).padStart(4, "0")}`,
      producer: "Fixture",
      vintage: 2020,
    },
  };
}
