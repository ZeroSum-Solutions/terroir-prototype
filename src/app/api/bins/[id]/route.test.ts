import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";
import { BIN_ID, makeSupabase, PARAMS, patchRequest } from "./route.test-helpers";

const authMocks = vi.hoisted(() => ({
  routeRequireRole: vi.fn(),
  getUser: vi.fn(),
  rpc: vi.fn(),
  actualRequireRole: undefined as
    | typeof import("@/lib/api/auth").requireRole
    | undefined,
}));
const mockCaptureException = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser: authMocks.getUser },
    rpc: (...args: unknown[]) => authMocks.rpc(...args),
  })),
}));
vi.mock("@/lib/api/shadow-site-access", () => ({
  observeShadowSiteAccess: vi.fn(async () => ({ state: "denied" })),
}));
vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({ get: () => undefined })),
}));
vi.mock("@/lib/api/auth", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/api/auth")>();
  authMocks.actualRequireRole = original.requireRole;
  return {
    ...original,
    requireRole: (...args: unknown[]) => authMocks.routeRequireRole(...args),
  };
});
vi.mock("@sentry/nextjs", () => ({
  captureException: (...args: unknown[]) => mockCaptureException(...args),
}));

const { PATCH } = await import("./route");

function allowManager(supabase: ReturnType<typeof makeSupabase>) {
  authMocks.routeRequireRole.mockResolvedValue({
    supabase,
    restaurantId: "restaurant-a",
    user: { id: "user-a" },
    role: "manager",
  });
}

function expectSafeCapture() {
  expect(mockCaptureException).toHaveBeenCalledWith(
    expect.objectContaining({ message: "Bin update failed." }),
    {
      tags: { surface: "bins", phase: "update" },
      extra: { restaurantId: "restaurant-a", binId: BIN_ID },
    },
  );
}

function expectTelemetryRedacted(secret: string) {
  expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain(
    secret,
  );
  expect(JSON.stringify(mockCaptureException.mock.calls)).not.toContain(secret);
}

describe("PATCH /api/bins/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  it.each([401, 403])(
    "uses the manager role gate and stops before database access (%s)",
    async (status) => {
      const supabase = makeSupabase({});
      authMocks.routeRequireRole.mockResolvedValue(
        NextResponse.json({ error: "denied" }, { status }),
      );

      const response = await PATCH(patchRequest({ priority: 3 }), PARAMS());

      expect(response.status).toBe(status);
      expect(authMocks.routeRequireRole).toHaveBeenCalledWith([
        "owner",
        "manager",
      ]);
      expect(supabase.from).not.toHaveBeenCalled();
    },
  );

  it("denies through the actual auth helper when the lifecycle-aware reader returns no current membership", async () => {
    // This proves the HTTP helper consumes the closed reader fail-closed. The
    // database contract, not this mock, proves revoked rows are excluded.
    authMocks.getUser.mockResolvedValue({
      data: { user: { id: "revoked-user" } },
    });
    authMocks.rpc.mockResolvedValue({ data: [], error: null });

    const response = await authMocks.actualRequireRole?.(["owner", "manager"]);

    expect(response).toBeInstanceOf(NextResponse);
    expect((response as NextResponse).status).toBe(403);
    expect(authMocks.rpc).toHaveBeenCalledWith(
      "read_current_operational_memberships",
      { p_user_id: "revoked-user" },
    );
  });

  it.each([
    ["invalid JSON", "{not json"],
    ["empty body", {}],
    ["unknown fields", { restaurant_id: "restaurant-b" }],
    ["blank code", { code: "   " }],
    ["oversized code", { code: "x".repeat(51) }],
    ["oversized zone", { zone: "x".repeat(101) }],
    ["non-positive capacity", { capacity: -1 }],
    ["fractional priority", { priority: 2.5 }],
    ["invalid retired_at", { retired_at: "yesterday" }],
  ])("returns 400 for %s before updating", async (_name, body) => {
    const supabase = makeSupabase({});
    allowManager(supabase);

    const response = await PATCH(patchRequest(body), PARAMS());

    expect(response.status).toBe(400);
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it("returns 400 for a malformed bin id", async () => {
    const supabase = makeSupabase({});
    allowManager(supabase);

    const response = await PATCH(patchRequest({ priority: 1 }), {
      params: Promise.resolve({ id: "not-a-uuid" }),
    });

    expect(response.status).toBe(400);
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it("updates non-code fields with explicit id and tenant scope", async () => {
    const updated = {
      id: BIN_ID,
      code: "A-01",
      zone: "Reserve",
      capacity: 18,
      priority: 3,
      sort_order: 0,
      retired_at: null,
    };
    const supabase = makeSupabase({
      bins: [{ data: updated, error: null }],
    });
    allowManager(supabase);

    const response = await PATCH(
      patchRequest({ zone: "  Reserve  ", capacity: 18, priority: 3 }),
      PARAMS(),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(updated);
    expect(supabase.operations.bins[0]).toEqual([
      ["update", { zone: "Reserve", capacity: 18, priority: 3 }],
      ["eq", "id", BIN_ID],
      ["eq", "restaurant_id", "restaurant-a"],
      [
        "select",
        "id, code, zone, capacity, priority, sort_order, retired_at",
      ],
    ]);
    expect(supabase.from).toHaveBeenCalledTimes(1);
  });

  it("renames with one tenant-scoped bins update and no inventory call", async () => {
    const updated = {
      id: BIN_ID,
      code: "R-04",
      zone: null,
      capacity: 12,
      priority: 2,
      sort_order: 0,
      retired_at: null,
    };
    const supabase = makeSupabase({
      bins: [{ data: updated, error: null }],
    });
    allowManager(supabase);

    const response = await PATCH(
      patchRequest({ code: "  R-04  ", capacity: 12, priority: 2 }),
      PARAMS(),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(updated);
    expect(supabase.operations.bins).toEqual([
      [
        ["update", { code: "R-04", capacity: 12, priority: 2 }],
        ["eq", "id", BIN_ID],
        ["eq", "restaurant_id", "restaurant-a"],
        [
          "select",
          "id, code, zone, capacity, priority, sort_order, retired_at",
        ],
      ],
    ]);
    expect(supabase.operations.inventory_items).toBeUndefined();
    expect(supabase.from).toHaveBeenCalledTimes(1);
  });

  it("returns 404 when the explicit tenant scope finds no bin", async () => {
    const supabase = makeSupabase({
      bins: [{ data: null, error: null }],
    });
    allowManager(supabase);

    const response = await PATCH(patchRequest({ code: "R-04" }), PARAMS());

    expect(response.status).toBe(404);
    expect(supabase.operations.bins[0]).toContainEqual([
      "eq",
      "restaurant_id",
      "restaurant-a",
    ]);
    expect(supabase.operations.inventory_items).toBeUndefined();
    expect(supabase.from).toHaveBeenCalledTimes(1);
  });

  it("maps duplicate codes to duplicate_bin_code without a second query", async () => {
    const error = { code: "23505", message: "duplicate secret detail" };
    const supabase = makeSupabase({
      bins: [{ data: null, error }],
    });
    allowManager(supabase);

    const response = await PATCH(patchRequest({ code: "R-04" }), PARAMS());

    expect(response.status).toBe(409);
    expect((await response.json()).error.code).toBe("duplicate_bin_code");
    expect(supabase.operations.inventory_items).toBeUndefined();
    expect(supabase.from).toHaveBeenCalledTimes(1);
    expect(mockCaptureException).not.toHaveBeenCalled();
  });

  it("redacts and captures an atomic rename failure", async () => {
    const error = { code: "XX000", message: "password=secret" };
    const supabase = makeSupabase({
      bins: [{ data: null, error }],
    });
    allowManager(supabase);

    const response = await PATCH(patchRequest({ code: "R-04" }), PARAMS());
    const text = await response.text();

    expect(response.status).toBe(500);
    expect(text).not.toContain("secret");
    expect(console.error).toHaveBeenCalledTimes(1);
    expect(console.error).toHaveBeenCalledWith("Bin update failed.");
    expectSafeCapture();
    expect(mockCaptureException).not.toHaveBeenCalledWith(
      error,
      expect.anything(),
    );
    expectTelemetryRedacted("password=secret");
    expect(supabase.operations.inventory_items).toBeUndefined();
    expect(supabase.from).toHaveBeenCalledTimes(1);
  });
});
