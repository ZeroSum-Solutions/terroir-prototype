import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse, type NextRequest } from "next/server";

const mockRequireMembership = vi.fn();
vi.mock("@/lib/api/auth", () => ({
  requireMembership: (...args: unknown[]) => mockRequireMembership(...args),
}));
const mockRevalidate = vi.fn();
vi.mock("next/cache", () => ({ revalidatePath: mockRevalidate }));
const mockRevalidateAutoEightysixedWines = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api/auto-eightysix-revalidation", () => ({
  revalidateAutoEightysixedWines: mockRevalidateAutoEightysixedWines,
}));
vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn() }));

const { POST } = await import("./route");

const OPERATION_ID = "11111111-1111-4111-8111-111111111111";
const RESTAURANT_ID = "22222222-2222-4222-8222-222222222222";
const WINE_ID = "55555555-5555-4555-8555-555555555555";

function makeSupabase(options: {
  replayed?: boolean;
  error?: { code?: string; message?: string } | null;
  contractVersion?: unknown;
} = {}) {
  const rpc = vi.fn((name: string) => {
    if (name === "current_inventory_contract_version") {
      return Promise.resolve({
        data: "contractVersion" in options ? options.contractVersion : 1,
        error: null,
      });
    }
    return Promise.resolve({
      data: options.error
        ? null
        : {
          operation_id: OPERATION_ID,
          command: "pour",
          pour_event_ids: ["77777777-7777-4777-8777-777777777777"],
          replayed: options.replayed ?? false,
          open_bottle: {
            id: "66666666-6666-4666-8666-666666666666",
            ...(name === "execute_physical_bottle_command" ? {
              restaurant_id: RESTAURANT_ID,
              nominal_capacity_ml: 750,
              closed_at: null,
              source_inventory_item_id: "88888888-8888-4888-8888-888888888888",
              source_provenance: "known",
              identity_contract: 2,
              identity_origin: "native",
              state_version: 1,
            } : {}),
            wine_id: WINE_ID,
            remaining_ml: 600,
            opened_at: "2026-09-23T12:00:00.000Z",
            preservation_method: "argon",
          },
          ...(name === "execute_physical_bottle_command" ? { closeout: null } : {}),
        },
      error: options.error ?? null,
    });
  });
  return { rpc };
}

function allow(supabase: ReturnType<typeof makeSupabase>) {
  mockRequireMembership.mockResolvedValue({
    supabase,
    restaurantId: RESTAURANT_ID,
    user: { id: "user-a" },
    role: "staff",
  });
}

function request(
  body: unknown = {
    wine_id: WINE_ID,
    ml: 150,
    kind: "pour",
    note: "glass",
    preservation_method: "argon",
  },
  operationId: string | null = OPERATION_ID,
) {
  const headers = new Headers({ "content-type": "application/json" });
  if (operationId) headers.set("Idempotency-Key", operationId);
  return new Request("http://localhost/api/pour", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  }) as unknown as NextRequest;
}

describe("POST /api/pour", () => {
  beforeEach(() => vi.clearAllMocks());

  it("keeps the current authentication gate first", async () => {
    mockRequireMembership.mockResolvedValue(
      NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    );
    expect((await POST(request({}, null))).status).toBe(401);
  });

  it("requires an idempotency UUID before parsing the command", async () => {
    const supabase = makeSupabase();
    allow(supabase);
    const response = await POST(request(undefined, null));
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe("invalid_idempotency_key");
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it("returns the existing 200 envelope with replay headers", async () => {
    const supabase = makeSupabase({ replayed: true });
    allow(supabase);
    const response = await POST(request());

    expect(response.status).toBe(200);
    expect((await response.json()).open_bottle).toMatchObject({
      wine_id: WINE_ID,
      remaining_ml: 600,
      preservation_method: "argon",
    });
    expect(response.headers.get("Idempotency-Key")).toBe(OPERATION_ID);
    expect(response.headers.get("Idempotency-Replayed")).toBe("true");
    expect(supabase.rpc).toHaveBeenCalledWith(
      "execute_inventory_command",
      expect.objectContaining({
        p_operation_id: OPERATION_ID,
        p_command: "pour",
        p_ml: 150,
        p_note: "glass",
        p_preservation_method: "argon",
      }),
    );
    expect(mockRevalidateAutoEightysixedWines).toHaveBeenCalledWith({
      supabase,
      restaurantId: RESTAURANT_ID,
      touchedWineIds: [WINE_ID],
      sinceTs: expect.any(String),
    });
  });

  it("uses the exact selector in contract 2 and omits legacy preservation", async () => {
    const supabase = makeSupabase({ contractVersion: 2 });
    allow(supabase);
    const response = await POST(request({
      wine_id: WINE_ID,
      open_bottle_id: "66666666-6666-4666-8666-666666666666",
      ml: 150,
      kind: "pour",
      note: "glass",
    }));

    expect(response.status).toBe(200);
    expect(supabase.rpc).toHaveBeenCalledWith(
      "execute_physical_bottle_command",
      expect.objectContaining({
        p_open_bottle_id: "66666666-6666-4666-8666-666666666666",
        p_preservation_method: undefined,
      }),
    );
  });

  it("rejects a contract-2 pour without an exact selector", async () => {
    const supabase = makeSupabase({ contractVersion: 2 });
    allow(supabase);
    const response = await POST(request({ wine_id: WINE_ID, ml: 150, kind: "pour" }));
    expect(response.status).toBe(409);
    expect((await response.json()).error.code).toBe("legacy_inventory_command_retired");
    expect(supabase.rpc).not.toHaveBeenCalledWith(
      "execute_physical_bottle_command",
      expect.anything(),
    );
  });

  it("does not fall back to the legacy writer when contract version is unknown", async () => {
    const supabase = makeSupabase({ contractVersion: null });
    allow(supabase);
    const response = await POST(request());
    expect(response.status).toBe(500);
    expect(supabase.rpc).not.toHaveBeenCalledWith("execute_inventory_command", expect.anything());
  });

  it("rejects volumes above the preserved 2,000 ml maximum", async () => {
    const supabase = makeSupabase();
    allow(supabase);
    const response = await POST(request({ wine_id: WINE_ID, ml: 2001 }));
    expect(response.status).toBe(400);
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it.each([
    ["wine_not_found", 404, "wine_not_found"],
    ["no_inventory", 409, "no_inventory"],
    ["inventory_operation_payload_conflict", 409, "idempotency_conflict"],
    ["invalid_inventory_command", 422, "invalid_inventory_command"],
  ])("maps %s to %i/%s", async (message, status, code) => {
    const supabase = makeSupabase({ error: { code: "P0001", message } });
    allow(supabase);
    const response = await POST(request());
    expect(response.status).toBe(status);
    expect((await response.json()).error.code).toBe(code);
  });

  it("maps SQLSTATE 42501 without exposing database text", async () => {
    const supabase = makeSupabase({
      error: { code: "42501", message: "sensitive-policy-detail" },
    });
    allow(supabase);
    const response = await POST(request());
    const text = await response.text();
    expect(response.status).toBe(403);
    expect(JSON.parse(text).error.code).toBe("forbidden");
    expect(text).not.toContain("sensitive-policy-detail");
  });
});
