import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { fetchYieldGroups, YieldReportSection } from "./yield-report-section";

describe("YieldReportSection", () => {
  it("EV-10.3: links every per-bottle actual and theoretical yield figure to its wine drawer", () => {
    document.body.innerHTML = renderToStaticMarkup(
      <YieldReportSection
        rangeLabel="Aug 1 – Aug 20"
        groups={[
          {
            preservationMethod: "coravin",
            bottlesClosed: 1,
            averageVarianceMl: -12,
            actualPouredMl: 562,
            theoreticalPouredMl: 550,
            bottles: [
              {
                bottleId: "b-1",
                wineId: "wine/a",
                preservationMethod: "coravin",
                varianceMl: -12,
                actualPouredMl: 562,
                theoreticalPouredMl: 550,
              },
            ],
          },
        ]}
      />,
    );

    const metrics = [...document.querySelectorAll<HTMLElement>("[data-metric]")];
    expect(metrics).toHaveLength(6);
    expect(metrics.slice(0, 4).map((metric) => metric.querySelector("a")?.getAttribute("href"))).toEqual([
      "/cellar",
      "/cellar",
      "/cellar",
      "/cellar",
    ]);
    expect(metrics.slice(4).map((metric) => metric.querySelector("a")?.getAttribute("href"))).toEqual([
      "/cellar?wine=wine%2Fa",
      "/cellar?wine=wine%2Fa",
    ]);
    expect(document.body.textContent).toContain("Coravin");
    expect(document.body.textContent).toContain("562 ml actual");
    expect(document.body.textContent).toContain("550 ml theoretical");
    expect(
      document.querySelector('[data-insight-scope="yield"]')?.textContent,
    ).toBe("Aug 1 – Aug 20");
  });

  it("allows both heading rows to wrap at the 390px review width", () => {
    document.body.innerHTML = renderToStaticMarkup(
      <YieldReportSection
        rangeLabel="2026-08-01 – 2026-08-20"
        groups={[
          {
            preservationMethod: "coravin",
            bottlesClosed: 1,
            averageVarianceMl: -12,
            actualPouredMl: 562,
            theoreticalPouredMl: 550,
            bottles: [],
          },
        ]}
      />,
    );

    const headingRow = document.querySelector("#yield-report-heading")!
      .parentElement!;
    expect(headingRow.className).toContain("flex-wrap");
    expect(headingRow.parentElement!.className).toContain("flex-wrap");
  });

  it("applies the insights date range to closed_at", async () => {
    const calls: Array<[string, unknown]> = [];
    const selects: string[] = [];
    const query = queryReturning([closeoutRow()], calls);
    const supabase = {
      from: () => ({
        select: (columns: string) => {
          selects.push(columns);
          return query;
        },
      }),
    } as unknown as SupabaseClient<Database>;

    await fetchYieldGroups(
      supabase,
      "restaurant-1",
      new Date("2026-08-01T00:00:00.000Z"),
      new Date("2026-08-18T23:59:59.999Z"),
    );

    expect(selects).toEqual([
      "id, open_bottle_id, wine_id, event_contract, preservation_method, theoretical_remaining_ml, actual_remaining_ml, written_off_ml, captured_bottle:open_bottles!bottle_closeouts_open_bottle_tenant_wine_fkey(nominal_capacity_ml), wines!inner(size_ml)",
    ]);
    expect(calls).toContainEqual(["eq", ["restaurant_id", "restaurant-1"]]);
    expect(calls).toContainEqual(["gte", ["closed_at", "2026-08-01T00:00:00.000Z"]]);
    expect(calls).toContainEqual(["lte", ["closed_at", "2026-08-18T23:59:59.999Z"]]);
  });

  it.each([1500, 375, null])(
    "uses captured contract-2 capacity when mutable catalog capacity is %s",
    async (catalogSizeMl) => {
      const groups = await fetchGroupsFor([
        closeoutRow("physical", {
          event_contract: 2,
          captured_bottle: { nominal_capacity_ml: 750 },
          wines: { size_ml: catalogSizeMl },
        }),
      ]);

      expect(groups[0]?.bottles[0]).toMatchObject({
        theoreticalPouredMl: 250,
        actualPouredMl: 260,
      });
    },
  );

  it("falls back to catalog capacity only for an unlinked contract-1 closeout", async () => {
    const groups = await fetchGroupsFor([
      closeoutRow("legacy", {
        event_contract: 1,
        captured_bottle: null,
        wines: { size_ml: 750 },
      }),
    ]);

    expect(groups[0]?.bottles[0]).toMatchObject({
      theoreticalPouredMl: 250,
      actualPouredMl: 260,
    });
  });

  it("prefers captured capacity for a linked contract-1 closeout", async () => {
    const groups = await fetchGroupsFor([
      closeoutRow("legacy-linked", {
        event_contract: 1,
        captured_bottle: { nominal_capacity_ml: 750 },
        wines: { size_ml: 1500 },
      }),
    ]);

    expect(groups[0]?.bottles[0]).toMatchObject({
      theoreticalPouredMl: 250,
      actualPouredMl: 260,
    });
  });

  it.each([
    ["missing relation", null],
    ["null captured capacity", { nominal_capacity_ml: null }],
  ])("rejects contract-2 yield with %s", async (_label, capturedBottle) => {
    await expect(fetchGroupsFor([
      closeoutRow("physical-invalid", {
        event_contract: 2,
        captured_bottle: capturedBottle,
        wines: { size_ml: 750 },
      }),
    ])).rejects.toThrow("physical_closeout_missing_captured_capacity");
  });

  it("propagates closeout query errors", async () => {
    const error = new Error("yield query failed");
    const supabase = {
      from: () => ({ select: () => queryReturning([], [], [], error) }),
    } as unknown as SupabaseClient<Database>;

    await expect(fetchYieldGroups(supabase, "restaurant-1", null, null)).rejects.toBe(error);
  });

  it("paginates past the former 100-row yield cap", async () => {
    const ranges: Array<[number, number]> = [];
    const firstPage = Array.from({ length: 1_000 }, (_, index) => closeoutRow(`closeout-${index}`));
    const supabase = {
      from: () => ({
        select: () => queryReturning(firstPage, [], ranges),
      }),
    } as unknown as SupabaseClient<Database>;

    const groups = await fetchYieldGroups(supabase, "restaurant-1", null, null);

    expect(ranges).toEqual([[0, 999], [1000, 1999]]);
    expect(groups[0]?.bottlesClosed).toBe(1_000);
  });
});

function queryReturning(
  firstPage: CloseoutRow[],
  calls: Array<[string, unknown]>,
  ranges: Array<[number, number]> = [],
  error: Error | null = null,
) {
  const query = {
    eq: (column: string, value: unknown) => track("eq", [column, value]),
    order: (column: string, options: unknown) => track("order", [column, options]),
    gte: (column: string, value: string) => track("gte", [column, value]),
    lte: (column: string, value: string) => track("lte", [column, value]),
    range: async (from: number, to: number) => {
      ranges.push([from, to]);
      return { data: error ? null : from === 0 ? firstPage : [], error };
    },
  };
  function track(method: string, args: unknown) {
    calls.push([method, args]);
    return query;
  }
  return query;
}

type CloseoutRow = {
  id: string;
  open_bottle_id: string;
  wine_id: string;
  event_contract: number;
  preservation_method: string;
  theoretical_remaining_ml: number;
  actual_remaining_ml: number;
  written_off_ml: number;
  captured_bottle: { nominal_capacity_ml: number | null } | null;
  wines: { size_ml: number | null };
};

function closeoutRow(id = "closeout-1", overrides: Partial<CloseoutRow> = {}): CloseoutRow {
  return {
    id,
    open_bottle_id: `bottle-${id}`,
    wine_id: "wine-1",
    event_contract: 1,
    preservation_method: "coravin",
    theoretical_remaining_ml: 500,
    actual_remaining_ml: 490,
    written_off_ml: 0,
    captured_bottle: null,
    wines: { size_ml: 750 },
    ...overrides,
  };
}

async function fetchGroupsFor(rows: CloseoutRow[]) {
  const supabase = {
    from: () => ({ select: () => queryReturning(rows, []) }),
  } as unknown as SupabaseClient<Database>;
  return fetchYieldGroups(supabase, "restaurant-1", null, null);
}
