import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mockRequireMembership = vi.fn();
vi.mock("@/lib/api/auth", () => ({
  requireMembership: (...args: unknown[]) => mockRequireMembership(...args),
}));
vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn() }));

const { GET } = await import("./route");

type QueryResult = { data: unknown; error: unknown };

function makeSupabase(results: Record<string, QueryResult>) {
  const calls: Array<{ table: string; method: string; args: unknown[] }> = [];
  const from = vi.fn((table: string) => {
    const result = results[table] ?? { data: [], error: null };
    const query = {
      select: (...args: unknown[]) => {
        calls.push({ table, method: "select", args });
        return query;
      },
      eq: (...args: unknown[]) => {
        calls.push({ table, method: "eq", args });
        return query;
      },
      order: (...args: unknown[]) => {
        calls.push({ table, method: "order", args });
        return query;
      },
      gte: (...args: unknown[]) => {
        calls.push({ table, method: "gte", args });
        return query;
      },
      lte: (...args: unknown[]) => {
        calls.push({ table, method: "lte", args });
        return query;
      },
      then: (
        resolve: (value: QueryResult) => unknown,
        reject?: (reason: unknown) => unknown,
      ) => Promise.resolve(result).then(resolve, reject),
    };
    return query;
  });
  return { from, calls };
}

function allow(supabase: ReturnType<typeof makeSupabase>) {
  mockRequireMembership.mockResolvedValue({
    supabase,
    restaurantId: "restaurant-a",
    user: { id: "user-a" },
    role: "staff",
  });
}

describe("GET /api/insights/pour", () => {
  beforeEach(() => vi.clearAllMocks());

  it.each(["effective_service_pour_events", "inventory_items", "wine_list_items"])(
    "redacts a %s query failure instead of returning partial analytics",
    async (failedTable) => {
      const results = Object.fromEntries(
        ["effective_service_pour_events", "inventory_items", "wine_list_items"].map((table) => [
          table,
          {
            data: [],
            error:
              table === failedTable
                ? { message: "super-secret analytics failure" }
                : null,
          },
        ]),
      );
      const supabase = makeSupabase(results);
      allow(supabase);

      const response = await GET(
        new NextRequest("http://localhost/api/insights/pour?range=30d"),
      );
      const text = await response.text();

      expect(response.status).toBe(500);
      expect(JSON.parse(text)).toEqual({
        error: {
          code: "internal_error",
          message: "Failed to load pour analytics.",
        },
      });
      expect(text).not.toContain("super-secret");
    },
  );

  it("preserves one-sided custom ranges, tenant filters, and response shape", async () => {
    const supabase = makeSupabase({
      effective_service_pour_events: { data: [], error: null },
      inventory_items: { data: [], error: null },
      wine_list_items: { data: [], error: null },
    });
    allow(supabase);

    const response = await GET(
      new NextRequest(
        "http://localhost/api/insights/pour?range=custom&from=2026-01-02&topN=2",
      ),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      range: "custom",
      topN: 2,
      totalPours: 0,
      pourVolumeBySection: [],
      topWinesByPours: [],
      topWinesByRevenue: [],
    });
    expect(supabase.calls).toContainEqual({
      table: "effective_service_pour_events",
      method: "gte",
      args: ["occurred_at", new Date("2026-01-02T00:00:00").toISOString()],
    });
    expect(supabase.calls).toContainEqual({
      table: "effective_service_pour_events",
      method: "eq",
      args: ["restaurant_id", "restaurant-a"],
    });
    expect(
      supabase.calls.filter(
        (call) =>
          call.method === "eq" && call.args.includes("restaurant-a"),
      ),
    ).toHaveLength(3);
  });

  it("counts legacy rows supplied by the effective source without reading raw events", async () => {
    const supabase = makeSupabase({
      effective_service_pour_events: {
        data: [{
          event_contract: 1,
          wine_id: "wine-a",
          ml_delta: 148,
          kind: "pour",
          occurred_at: "2026-09-20T12:00:00.000Z",
          wines: { id: "wine-a", name: "Legacy Red", producer: "House", vintage: 2020 },
        }],
        error: null,
      },
      inventory_items: { data: [{ wine_id: "wine-a", section: "Reds" }], error: null },
      wine_list_items: { data: [], error: null },
    });
    allow(supabase);

    const response = await GET(new NextRequest("http://localhost/api/insights/pour?range=all"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.totalPours).toBe(1);
    expect(body.pourVolumeBySection).toEqual([{ section: "Reds", oz: 5 }]);
    expect(body.topWinesByPours[0]).toMatchObject({
      wine_id: "wine-a",
      name: "Legacy Red",
      pour_count: 1,
    });
    expect(supabase.from).toHaveBeenCalledWith("effective_service_pour_events");
    expect(supabase.from).not.toHaveBeenCalledWith("pour_events");
  });

  it("fails closed when the effective source returns an incomplete row", async () => {
    const supabase = makeSupabase({
      effective_service_pour_events: {
        data: [{ wine_id: null, ml_delta: 148, kind: "pour", occurred_at: "2026-09-20T12:00:00.000Z" }],
        error: null,
      },
      inventory_items: { data: [], error: null },
      wine_list_items: { data: [], error: null },
    });
    allow(supabase);

    const response = await GET(new NextRequest("http://localhost/api/insights/pour?range=all"));

    expect(response.status).toBe(500);
  });
});
