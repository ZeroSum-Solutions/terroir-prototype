import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse, type NextRequest } from "next/server";

const mockRequireMembership = vi.fn();
vi.mock("@/lib/api/auth", () => ({
  requireMembership: (...args: unknown[]) => mockRequireMembership(...args),
}));

const { GET } = await import("./route");

const BATCH_ID = "11111111-1111-4111-8111-111111111111";
const RESTAURANT_ID = "22222222-2222-4222-8222-222222222222";
const ROW_ID = "33333333-3333-4333-8333-333333333333";

function request() {
  return new Request(`http://localhost/api/import/batches/${BATCH_ID}`) as unknown as NextRequest;
}

function params() {
  return Promise.resolve({ id: BATCH_ID });
}

function makeSupabase(options: { batch?: unknown; rows?: unknown[] } = {}) {
  const eqCallsByTable: Record<string, Array<[string, unknown]>> = {};
  const selections: Record<string, string[]> = {};
  const from = vi.fn((table: string) => {
    eqCallsByTable[table] = [];
    if (table === "import_batches") {
      return {
        select: () => ({
          eq: (col: string, val: unknown) => {
            eqCallsByTable[table].push([col, val]);
            return {
              eq: (col2: string, val2: unknown) => {
                eqCallsByTable[table].push([col2, val2]);
                return { maybeSingle: async () => ({ data: options.batch ?? null, error: null }) };
              },
            };
          },
        }),
      };
    }
    if (table === "import_batch_rows") {
      const chain = {
        select: (columns: string) => {
          (selections[table] ??= []).push(columns);
          return chain;
        },
        eq: (col: string, val: unknown) => {
          eqCallsByTable[table].push([col, val]);
          return chain;
        },
        order: () => chain,
        range: async (from: number, to: number) => ({
          data: (options.rows ?? []).slice(from, to + 1),
          error: null,
        }),
      };
      return chain;
    }
    throw new Error(`unexpected table ${table}`);
  });
  const rpc = vi.fn(() => {
    const data = (options.rows ?? []).map((row) => ({
      row_id: (row as { id: string }).id,
      batch_id: BATCH_ID,
      restaurant_id: RESTAURANT_ID,
      row_number: (row as { row_number: number }).row_number,
      producer: "Chateau Example",
      name: "Reserve",
    }));
    const resolved = Promise.resolve({ data, error: null });
    return { then: resolved.then.bind(resolved) };
  });
  return { client: { from, rpc }, eqCallsByTable, selections };
}

function allow(supabase: unknown) {
  mockRequireMembership.mockResolvedValue({
    supabase,
    restaurantId: RESTAURANT_ID,
    user: { id: "user-a" },
    role: "staff",
  });
}

describe("GET /api/import/batches/[id]", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 404 when the batch isn't found (including cross-tenant)", async () => {
    const { client } = makeSupabase({ batch: null });
    allow(client);
    const response = await GET(request(), { params: params() });
    expect(response.status).toBe(404);
  });

  it("scopes both the batch and row lookups to id + restaurant_id", async () => {
    const { client, eqCallsByTable, selections } = makeSupabase({
      batch: { id: BATCH_ID, status: "created" },
      rows: [{
        id: ROW_ID,
        row_number: 1,
        row_state: "valid",
        lwin_status: "matched",
        lwin_id: null,
        lwin_score: null,
        cost_status: "present",
        resolution: "auto",
        apply_status: "not_applied",
        applied_inventory_item_id: null,
      }],
    });
    allow(client);
    const response = await GET(request(), { params: params() });
    expect(response.status).toBe(200);
    expect(eqCallsByTable.import_batches).toEqual([
      ["id", BATCH_ID],
      ["restaurant_id", RESTAURANT_ID],
    ]);
    expect(eqCallsByTable.import_batch_rows).toEqual([
      ["batch_id", BATCH_ID],
      ["restaurant_id", RESTAURANT_ID],
    ]);
    expect(selections.import_batch_rows[0]).not.toMatch(
      /raw|validation_errors|manual_unit_cost|last_error_message/,
    );
    const body = await response.json();
    expect(body.batch.id).toBe(BATCH_ID);
    expect(body.rows[0]).toMatchObject({
      id: ROW_ID,
      row_number: 1,
      producer: "Chateau Example",
      name: "Reserve",
    });
    expect(body.rows[0]).not.toHaveProperty("raw");
  });

  it("denies before querying when unauthenticated", async () => {
    mockRequireMembership.mockResolvedValue(NextResponse.json({ error: "Unauthorized" }, { status: 401 }));
    const response = await GET(request(), { params: params() });
    expect(response.status).toBe(401);
  });
});
