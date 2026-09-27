import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse, type NextRequest } from "next/server";

const mockRequireRole = vi.fn();
vi.mock("@/lib/api/auth", () => ({
  requireRole: (...args: unknown[]) => mockRequireRole(...args),
}));

const { PATCH, DELETE } = await import("./route");

const INVENTORY_ID = "a1b2c3d4-e5f6-4789-8abc-def012345678";
const WINE_ID = "b1b2c3d4-e5f6-4789-8abc-def012345678";
const MISSING_WINE_ID = "c1b2c3d4-e5f6-4789-8abc-def012345678";

function request(body: unknown): NextRequest {
  return new Request(`http://localhost/api/cellar/${INVENTORY_ID}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  }) as unknown as NextRequest;
}

function deleteRequest(body?: unknown): NextRequest {
  return new Request(`http://localhost/api/cellar/${WINE_ID}`, {
    method: "DELETE",
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  }) as NextRequest;
}

function deleteRawRequest(body: string): NextRequest {
  return new Request(`http://localhost/api/cellar/${WINE_ID}`, {
    method: "DELETE",
    headers: { "content-type": "application/json" },
    body,
  }) as NextRequest;
}

function makeSupabase() {
  const calls: Array<{ method: string; args: unknown[] }> = [];
  const rpc = vi.fn(async (name: string): Promise<{
    data: unknown;
    error: { code: string; message: string } | null;
  }> => {
    if (name === "patch_inventory_item_private") {
      return {
        data: { inventoryItemId: INVENTORY_ID, quantity: 4, updated: true },
        error: null,
      };
    }
    if (name === "delete_wine_private") {
      return { data: { wineId: WINE_ID, deleted: true }, error: null };
    }
    throw new Error(`Unexpected RPC: ${name}`);
  });
  const from = vi.fn((table: string) => {
    calls.push({ method: "from", args: [table] });
    if (table === "inventory_items") {
      return {
        select: (columns: string) => {
          calls.push({ method: "select", args: [columns] });
          return {
            eq: (column: string, value: string) => {
              calls.push({ method: "eq", args: [column, value] });
              return {
                eq: (nextColumn: string, nextValue: string) => {
                  calls.push({
                    method: "eq",
                    args: [nextColumn, nextValue],
                  });
                  return {
                    maybeSingle: async () => ({
                      data: {
                        id: INVENTORY_ID,
                        updated_at: "2026-09-26T12:00:00.000Z",
                        bin_location: "A-1",
                      },
                      error: null,
                    }),
                  };
                },
              };
            },
          };
        },
      };
    }
    if (table === "wines") {
      return {
        select: (columns: string) => {
          calls.push({ method: "select", args: [columns] });
          return {
            eq: (column: string, value: string) => {
              calls.push({ method: "eq", args: [column, value] });
              return {
                eq: (nextColumn: string, nextValue: string) => {
                  calls.push({
                    method: "eq",
                    args: [nextColumn, nextValue],
                  });
                  return {
                    maybeSingle: async () => ({
                      data: value === WINE_ID
                        ? {
                            id: WINE_ID,
                            updated_at: "2026-09-26T12:00:00.000Z",
                          }
                        : null,
                      error: null,
                    }),
                  };
                },
              };
            },
          };
        },
      };
    }
    throw new Error(`Unexpected table: ${table}`);
  });
  return { from, rpc, calls };
}

function allow(supabase: ReturnType<typeof makeSupabase>) {
  mockRequireRole.mockResolvedValue({
    supabase,
    restaurantId: "restaurant-a",
    user: { id: "user-a" },
    role: "owner",
  });
}

async function expectValidationError(response: Response, path: string[]) {
  expect(response.status).toBe(400);
  expect(await response.json()).toMatchObject({
    error: {
      code: "validation_error",
      details: [{ path }],
    },
  });
}

describe("PATCH /api/cellar/[id]", () => {
  beforeEach(() => vi.clearAllMocks());

  it("authorizes before reading malformed params or body", async () => {
    const text = vi.fn();
    const supabase = makeSupabase();
    mockRequireRole.mockResolvedValue(
      NextResponse.json({ error: "denied" }, { status: 401 }),
    );

    const response = await PATCH({ text } as unknown as NextRequest, {
      params: Promise.resolve({ id: "not-a-uuid" }),
    });

    expect(response.status).toBe(401);
    expect(text).not.toHaveBeenCalled();
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it("rejects an invalid UUID before business database access", async () => {
    const supabase = makeSupabase();
    allow(supabase);

    const response = await PATCH(request({ quantity: 2 }), {
      params: Promise.resolve({ id: "not-a-uuid" }),
    });

    await expectValidationError(response, ["id"]);
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it("rejects malformed JSON before business database access", async () => {
    const supabase = makeSupabase();
    allow(supabase);

    const response = await PATCH(request("{not-json"), {
      params: Promise.resolve({ id: INVENTORY_ID }),
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: { code: "invalid_json", message: "Invalid JSON." },
    });
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it("rejects invalid known fields before business database access", async () => {
    const supabase = makeSupabase();
    allow(supabase);

    const response = await PATCH(request({ quantity: -1 }), {
      params: Promise.resolve({ id: INVENTORY_ID }),
    });

    await expectValidationError(response, ["quantity"]);
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it("routes safe fields through the CAS RPC without direct protected DML", async () => {
    const supabase = makeSupabase();
    allow(supabase);

    const response = await PATCH(
      request({
        quantity: 4,
        bin_location: "  A-2  ",
        ignored_client_field: true,
      }),
      { params: Promise.resolve({ id: INVENTORY_ID }) },
    );

    expect(response.status).toBe(200);
    expect(supabase.rpc).toHaveBeenCalledWith(
      "patch_inventory_item_private",
      expect.objectContaining({
        p_inventory_item_id: INVENTORY_ID,
        p_expected_updated_at: "2026-09-26T12:00:00.000Z",
        p_set_quantity: true,
        p_quantity: 4,
        p_set_unit_cost: false,
        p_unit_cost: null,
        p_set_bin_location: true,
        p_bin_location: "A-2",
      }),
    );
    expect(supabase.calls.some((call) => call.method === "update")).toBe(false);
    expect(supabase.calls).toContainEqual({
      method: "eq",
      args: ["id", INVENTORY_ID],
    });
    expect(supabase.calls).toContainEqual({
      method: "eq",
      args: ["restaurant_id", "restaurant-a"],
    });
  });

  it("rejects explicit null cost before the RPC", async () => {
    const supabase = makeSupabase();
    allow(supabase);

    const response = await PATCH(request({ unit_cost: null }), {
      params: Promise.resolve({ id: INVENTORY_ID }),
    });

    expect(response.status).toBe(400);
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it("preserves a caller-supplied inventory CAS timestamp", async () => {
    const supabase = makeSupabase();
    allow(supabase);
    const expectedUpdatedAt = "2026-09-26T11:00:00.000Z";

    const response = await PATCH(request({
      expected_updated_at: expectedUpdatedAt,
      quantity: 4,
    }), {
      params: Promise.resolve({ id: INVENTORY_ID }),
    });

    expect(response.status).toBe(200);
    expect(supabase.rpc).toHaveBeenCalledWith(
      "patch_inventory_item_private",
      expect.objectContaining({ p_expected_updated_at: expectedUpdatedAt }),
    );
  });

  it("maps a stale CAS refusal to a closed 409", async () => {
    const supabase = makeSupabase();
    supabase.rpc.mockResolvedValueOnce({
      data: null,
      error: { code: "P0001", message: "inventory_item_stale" },
    });
    allow(supabase);

    const response = await PATCH(request({ quantity: 2 }), {
      params: Promise.resolve({ id: INVENTORY_ID }),
    });

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: {
        code: "inventory_item_stale",
        message: "Inventory changed before this update. Refresh and try again.",
      },
    });
  });

  it.each([
    ["wrong item", { inventoryItemId: MISSING_WINE_ID, quantity: 2, updated: true }],
    ["extra field", { inventoryItemId: INVENTORY_ID, quantity: 2, updated: true, unitCost: 42 }],
  ])("rejects a %s patch receipt", async (_label, data) => {
    const supabase = makeSupabase();
    supabase.rpc.mockResolvedValueOnce({ data, error: null });
    allow(supabase);

    const response = await PATCH(request({ quantity: 2 }), {
      params: Promise.resolve({ id: INVENTORY_ID }),
    });

    expect(response.status).toBe(500);
  });
});

describe("DELETE /api/cellar/[id]", () => {
  beforeEach(() => vi.clearAllMocks());

  it("preserves owner authorization precedence for malformed params", async () => {
    const supabase = makeSupabase();
    mockRequireRole.mockResolvedValue(
      NextResponse.json({ error: "denied" }, { status: 403 }),
    );

    const response = await DELETE(deleteRequest(), {
      params: Promise.resolve({ id: "not-a-uuid" }),
    });

    expect(response.status).toBe(403);
    expect(mockRequireRole).toHaveBeenCalledWith(["owner"]);
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it("rejects an invalid UUID before business database access", async () => {
    const supabase = makeSupabase();
    allow(supabase);

    const response = await DELETE(deleteRequest(), {
      params: Promise.resolve({ id: "not-a-uuid" }),
    });

    await expectValidationError(response, ["id"]);
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it("preserves the tenant-scoped missing-wine response for a valid UUID", async () => {
    const supabase = makeSupabase();
    allow(supabase);

    const response = await DELETE(deleteRequest(), {
      params: Promise.resolve({ id: MISSING_WINE_ID }),
    });

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      error: { code: "not_found", message: "Wine not found." },
    });
    expect(supabase.calls).toContainEqual({
      method: "eq",
      args: ["id", MISSING_WINE_ID],
    });
    expect(supabase.calls).toContainEqual({
      method: "eq",
      args: ["restaurant_id", "restaurant-a"],
    });
  });

  it("rejects present malformed JSON before lookup or RPC", async () => {
    const supabase = makeSupabase();
    allow(supabase);

    const response = await DELETE(deleteRawRequest("{not-json"), {
      params: Promise.resolve({ id: WINE_ID }),
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: { code: "invalid_json", message: "Invalid JSON." },
    });
    expect(supabase.from).not.toHaveBeenCalled();
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it.each([null, [], 42, "timestamp"])(
    "rejects present non-object JSON %# before lookup or RPC",
    async (body) => {
      const supabase = makeSupabase();
      allow(supabase);

      const response = await DELETE(deleteRequest(body), {
        params: Promise.resolve({ id: WINE_ID }),
      });

      expect(response.status).toBe(400);
      expect(supabase.from).not.toHaveBeenCalled();
      expect(supabase.rpc).not.toHaveBeenCalled();
    },
  );

  it("preserves a whitespace-only body as genuinely empty", async () => {
    const supabase = makeSupabase();
    allow(supabase);

    const response = await DELETE(deleteRawRequest("   "), {
      params: Promise.resolve({ id: WINE_ID }),
    });

    expect(response.status).toBe(200);
    expect(supabase.rpc).toHaveBeenCalledWith(
      "delete_wine_private",
      expect.objectContaining({
        p_expected_updated_at: "2026-09-26T12:00:00.000Z",
      }),
    );
  });

  it("preserves a caller-supplied wine CAS timestamp", async () => {
    const supabase = makeSupabase();
    allow(supabase);
    const expectedUpdatedAt = "2026-09-26T11:00:00.000Z";

    const response = await DELETE(deleteRequest({
      expected_updated_at: expectedUpdatedAt,
    }), {
      params: Promise.resolve({ id: WINE_ID }),
    });

    expect(response.status).toBe(200);
    expect(supabase.rpc).toHaveBeenCalledWith(
      "delete_wine_private",
      expect.objectContaining({ p_expected_updated_at: expectedUpdatedAt }),
    );
  });

  it("routes owner deletion through the atomic RPC without direct deletes", async () => {
    const supabase = makeSupabase();
    allow(supabase);

    const response = await DELETE(deleteRequest(), {
      params: Promise.resolve({ id: WINE_ID }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ wineId: WINE_ID, deleted: true });
    expect(supabase.rpc).toHaveBeenCalledWith("delete_wine_private", {
      p_restaurant_id: "restaurant-a",
      p_wine_id: WINE_ID,
      p_expected_updated_at: "2026-09-26T12:00:00.000Z",
    });
    expect(supabase.calls.some((call) => call.method === "delete")).toBe(false);
  });

  it.each([
    ["wine_stale", "wine_stale"],
    ["wine_has_dependencies", "wine_has_dependencies"],
  ])("maps %s to a closed conflict", async (message, code) => {
    const supabase = makeSupabase();
    supabase.rpc.mockResolvedValueOnce({
      data: null,
      error: { code: "P0001", message },
    });
    allow(supabase);

    const response = await DELETE(deleteRequest(), {
      params: Promise.resolve({ id: WINE_ID }),
    });

    expect(response.status).toBe(409);
    expect((await response.json()).error.code).toBe(code);
  });
});
