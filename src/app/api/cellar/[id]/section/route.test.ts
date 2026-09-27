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

const { PATCH } = await import("./route");

const WINE_ID = "a1b2c3d4-e5f6-4789-8abc-def012345678";
const RESTAURANT_ID = "11111111-1111-4111-8111-111111111111";

type RpcResult = {
  data: unknown;
  error: { code?: string; message?: string } | null;
};

function request(body: unknown): NextRequest {
  return new Request(`http://localhost/api/cellar/${WINE_ID}/section`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  }) as NextRequest;
}

function makeSupabase(
  result: RpcResult = {
    data: { requestedWineCount: 1, section: "Cult Cabs" },
    error: null,
  },
) {
  return {
    rpc: vi.fn().mockResolvedValue(result),
    from: vi.fn(() => {
      throw new Error("section assignment must not use direct table access");
    }),
  };
}

function allow(supabase: ReturnType<typeof makeSupabase>) {
  mocks.requireRole.mockResolvedValue({
    supabase,
    restaurantId: RESTAURANT_ID,
    user: { id: "user-a" },
    role: "manager",
  });
}

function call(body: unknown, id = WINE_ID) {
  return PATCH(request(body), { params: Promise.resolve({ id }) });
}

async function expectRedacted500(response: Response, secret?: string) {
  expect(response.status).toBe(500);
  const body = await response.json();
  expect(body).toEqual({
    error: { code: "internal_error", message: "Internal server error." },
  });
  if (secret) expect(JSON.stringify(body)).not.toContain(secret);
}

describe("PATCH /api/cellar/[id]/section", () => {
  beforeEach(() => vi.clearAllMocks());

  it.each([
    { status: 401 as const, actor: "unauthenticated caller" },
    { status: 403 as const, actor: "staff caller" },
  ])("preserves $actor precedence over invalid input", async ({ status }) => {
    const text = vi.fn();
    const supabase = makeSupabase();
    mocks.requireRole.mockResolvedValue(
      NextResponse.json({ error: "denied" }, { status }),
    );

    const response = await PATCH({ text } as unknown as NextRequest, {
      params: Promise.resolve({ id: "not-a-uuid" }),
    });

    expect(response.status).toBe(status);
    expect(mocks.requireRole).toHaveBeenCalledWith(["owner", "manager"]);
    expect(text).not.toHaveBeenCalled();
    expect(supabase.rpc).not.toHaveBeenCalled();
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it("rejects an invalid UUID before the RPC", async () => {
    const supabase = makeSupabase();
    allow(supabase);

    const response = await call({ section: "Reds" }, "not-a-uuid");

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: {
        code: "validation_error",
        details: [{ path: ["id"] }],
      },
    });
    expect(supabase.rpc).not.toHaveBeenCalled();
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it("rejects malformed JSON before the RPC", async () => {
    const supabase = makeSupabase();
    allow(supabase);

    const response = await call("{not-json");

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: { code: "invalid_json", message: "Invalid JSON." },
    });
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it("rejects a 101-character section before the RPC", async () => {
    const supabase = makeSupabase();
    allow(supabase);

    const response = await call({ section: "x".repeat(101) });

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: {
        code: "validation_error",
        details: [{ path: ["section"] }],
      },
    });
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it.each(["" as const, null])(
    "normalizes %j to null and preserves the Uncategorized response",
    async (section) => {
      const supabase = makeSupabase({
        data: { requestedWineCount: 1, section: null },
        error: null,
      });
      allow(supabase);

      const response = await call({ section });

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ wine_id: WINE_ID, section: null });
      expect(supabase.rpc).toHaveBeenCalledWith(
        "assign_wine_sections_private",
        {
          p_restaurant_id: RESTAURANT_ID,
          p_wine_ids: [WINE_ID],
          p_section: null,
        },
      );
      expect(supabase.from).not.toHaveBeenCalled();
    },
  );

  it("passes only parsed fields and returns the existing response shape", async () => {
    const supabase = makeSupabase();
    allow(supabase);

    const response = await call({
      section: "  Cult Cabs  ",
      ignored_client_field: "must-not-reach-rpc",
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      wine_id: WINE_ID,
      section: "Cult Cabs",
    });
    expect(supabase.rpc).toHaveBeenCalledOnce();
    expect(supabase.rpc).toHaveBeenCalledWith(
      "assign_wine_sections_private",
      {
        p_restaurant_id: RESTAURANT_ID,
        p_wine_ids: [WINE_ID],
        p_section: "Cult Cabs",
      },
    );
    expect(JSON.stringify(supabase.rpc.mock.calls)).not.toContain(
      "must-not-reach-rpc",
    );
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it("maps P04W1 to the stable missing-wine response", async () => {
    const supabase = makeSupabase({
      data: null,
      error: { code: "P04W1", message: "private site detail" },
    });
    allow(supabase);

    const response = await call({ section: "Reds" });

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      error: { code: "not_found", message: "Wine not found." },
    });
  });

  it("maps 42501 to a fixed 403", async () => {
    const supabase = makeSupabase({
      data: null,
      error: { code: "42501", message: "private membership detail" },
    });
    allow(supabase);

    const response = await call({ section: "Reds" });

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
        await call({ section: "Reds" }),
        "private inventory",
      );
    },
  );

  it("redacts a thrown RPC failure", async () => {
    const supabase = makeSupabase();
    supabase.rpc.mockRejectedValueOnce(new Error("private transport detail"));
    allow(supabase);

    await expectRedacted500(
      await call({ section: "Reds" }),
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
    ["array", [{ requestedWineCount: 1, section: "Reds" }]],
    ["missing key", { requestedWineCount: 1 }],
    ["extra key", { requestedWineCount: 1, section: "Reds", rows: 3 }],
    ["fractional count", { requestedWineCount: 1.5, section: "Reds" }],
    ["unsafe count", { requestedWineCount: Number.MAX_VALUE, section: "Reds" }],
    ["wrong count", { requestedWineCount: 2, section: "Reds" }],
    ["wrong section", { requestedWineCount: 1, section: "Whites" }],
  ])("rejects a %s RPC receipt", async (_label, data) => {
    const supabase = makeSupabase({ data, error: null });
    allow(supabase);

    await expectRedacted500(await call({ section: "Reds" }));
  });
});
