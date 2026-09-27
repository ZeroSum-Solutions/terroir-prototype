import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse, type NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(),
  captureException: vi.fn(),
}));

vi.mock("@/lib/api/auth", () => ({
  requireRole: (...args: unknown[]) => mocks.requireRole(...args),
}));

vi.mock("@sentry/nextjs", () => ({
  captureException: (...args: unknown[]) => mocks.captureException(...args),
}));

const { POST } = await import("./route");

const RESTAURANT_ID = "11111111-1111-4111-8111-111111111111";
const WINE_IDS = [
  "a1b2c3d4-e5f6-4789-8abc-def012345678",
  "b1b2c3d4-e5f6-4789-8abc-def012345678",
];

type RpcResult = {
  data: unknown;
  error: { code?: string; message?: string } | null;
};

function request(body: unknown): NextRequest {
  return new Request("http://localhost/api/cellar/batch-section", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  }) as NextRequest;
}

function makeSupabase(
  result: RpcResult = {
    data: { requestedWineCount: WINE_IDS.length, section: "Reds" },
    error: null,
  },
) {
  return {
    rpc: vi.fn().mockResolvedValue(result),
    from: vi.fn(() => {
      throw new Error("batch section assignment must not use direct table access");
    }),
  };
}

function allow(supabase: ReturnType<typeof makeSupabase>) {
  mocks.requireRole.mockResolvedValue({
    supabase,
    restaurantId: RESTAURANT_ID,
    user: { id: "user-a" },
    role: "owner",
  });
}

function call(body: unknown) {
  return POST(request(body));
}

async function expectRedacted500(response: Response, secret?: string) {
  expect(response.status).toBe(500);
  const body = await response.json();
  expect(body).toEqual({
    error: { code: "internal_error", message: "Internal server error." },
  });
  if (secret) expect(JSON.stringify(body)).not.toContain(secret);
}

describe("POST /api/cellar/batch-section", () => {
  beforeEach(() => vi.clearAllMocks());

  it.each([
    { status: 401 as const, actor: "unauthenticated caller" },
    { status: 403 as const, actor: "staff caller" },
  ])("preserves $actor precedence over invalid input", async ({ status }) => {
    const json = vi.fn();
    const supabase = makeSupabase();
    mocks.requireRole.mockResolvedValue(
      NextResponse.json({ error: "denied" }, { status }),
    );

    const response = await POST({ json } as unknown as NextRequest);

    expect(response.status).toBe(status);
    expect(mocks.requireRole).toHaveBeenCalledWith(["owner", "manager"]);
    expect(json).not.toHaveBeenCalled();
    expect(supabase.rpc).not.toHaveBeenCalled();
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it("preserves the existing malformed-JSON response before the RPC", async () => {
    const supabase = makeSupabase();
    allow(supabase);

    const response = await call("{not-json");

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: { code: "bad_request", message: "Invalid JSON." },
    });
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it.each([
    ["empty array", { wine_ids: [], section: "Reds" }],
    [
      "201-item array",
      {
        wine_ids: Array.from(
          { length: 201 },
          (_, index) => `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
        ),
        section: "Reds",
      },
    ],
    ["null element", { wine_ids: [WINE_IDS[0], null], section: "Reds" }],
    ["blank section", { wine_ids: WINE_IDS, section: "   " }],
    ["101-character section", { wine_ids: WINE_IDS, section: "x".repeat(101) }],
  ])("rejects %s before the RPC", async (_label, body) => {
    const supabase = makeSupabase();
    allow(supabase);

    const response = await call(body);

    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe("validation_error");
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it("passes parsed fields to one RPC and preserves the response shape", async () => {
    const supabase = makeSupabase();
    allow(supabase);

    const response = await call({
      wine_ids: WINE_IDS,
      section: "  Reds  ",
      ignored_client_field: "must-not-reach-rpc",
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ updated: 2, section: "Reds" });
    expect(supabase.rpc).toHaveBeenCalledOnce();
    expect(supabase.rpc).toHaveBeenCalledWith(
      "assign_wine_sections_private",
      {
        p_restaurant_id: RESTAURANT_ID,
        p_wine_ids: WINE_IDS,
        p_section: "Reds",
      },
    );
    expect(JSON.stringify(supabase.rpc.mock.calls)).not.toContain(
      "must-not-reach-rpc",
    );
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it("passes duplicate IDs unchanged and maps the database refusal", async () => {
    const duplicates = [WINE_IDS[0], WINE_IDS[0]];
    const supabase = makeSupabase({
      data: null,
      error: { code: "P04W1", message: "duplicate IDs" },
    });
    allow(supabase);

    const response = await call({
      wine_ids: duplicates,
      section: "  Reds  ",
      ignored_client_field: "must-not-reach-rpc",
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: {
        code: "bad_request",
        message: "One or more wines not found in your restaurant.",
      },
    });
    expect(supabase.rpc).toHaveBeenCalledOnce();
    expect(supabase.rpc).toHaveBeenCalledWith(
      "assign_wine_sections_private",
      {
        p_restaurant_id: RESTAURANT_ID,
        p_wine_ids: duplicates,
        p_section: "Reds",
      },
    );
    expect(JSON.stringify(supabase.rpc.mock.calls)).not.toContain(
      "must-not-reach-rpc",
    );
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it("accepts 200 parsed wine IDs and a 100-character section", async () => {
    const wineIds = Array.from(
      { length: 200 },
      (_, index) => `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    );
    const section = "x".repeat(100);
    const supabase = makeSupabase({
      data: { requestedWineCount: 200, section },
      error: null,
    });
    allow(supabase);

    const response = await call({ wine_ids: wineIds, section });

    expect(response.status).toBe(200);
    expect(supabase.rpc).toHaveBeenCalledWith(
      "assign_wine_sections_private",
      expect.objectContaining({ p_wine_ids: wineIds, p_section: section }),
    );
  });

  it("maps P04W1 to the stable batch missing-wine response", async () => {
    const supabase = makeSupabase({
      data: null,
      error: { code: "P04W1", message: "private site detail" },
    });
    allow(supabase);

    const response = await call({ wine_ids: WINE_IDS, section: "Reds" });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: {
        code: "bad_request",
        message: "One or more wines not found in your restaurant.",
      },
    });
  });

  it("maps 42501 to a fixed 403", async () => {
    const supabase = makeSupabase({
      data: null,
      error: { code: "42501", message: "private membership detail" },
    });
    allow(supabase);

    const response = await call({ wine_ids: WINE_IDS, section: "Reds" });

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: { code: "forbidden", message: "Forbidden" },
    });
  });

  it.each(["P04V1", "XX000"])(
    "redacts an unexpected %s RPC refusal",
    async (code) => {
      const supabase = makeSupabase({
        data: null,
        error: { code, message: "private inventory and cost detail" },
      });
      allow(supabase);

      await expectRedacted500(
        await call({ wine_ids: WINE_IDS, section: "Reds" }),
        "private inventory",
      );
    },
  );

  it("redacts a thrown RPC failure", async () => {
    const supabase = makeSupabase();
    supabase.rpc.mockRejectedValueOnce(new Error("private transport detail"));
    allow(supabase);

    await expectRedacted500(
      await call({ wine_ids: WINE_IDS, section: "Reds" }),
      "private transport",
    );
    expect(
      mocks.captureException.mock.calls
        .flat()
        .map((value) => String(value))
        .join(" "),
    ).not.toContain("private transport");
  });

  it.each([
    ["null", null],
    ["array", [{ requestedWineCount: 2, section: "Reds" }]],
    ["missing key", { requestedWineCount: 2 }],
    ["extra key", { requestedWineCount: 2, section: "Reds", rows: 3 }],
    ["fractional count", { requestedWineCount: 2.5, section: "Reds" }],
    ["unsafe count", { requestedWineCount: Number.MAX_VALUE, section: "Reds" }],
    ["wrong count", { requestedWineCount: 1, section: "Reds" }],
    ["wrong section", { requestedWineCount: 2, section: "Whites" }],
  ])("rejects a %s RPC receipt", async (_label, data) => {
    const supabase = makeSupabase({ data, error: null });
    allow(supabase);

    await expectRedacted500(
      await call({ wine_ids: WINE_IDS, section: "Reds" }),
    );
  });
});
