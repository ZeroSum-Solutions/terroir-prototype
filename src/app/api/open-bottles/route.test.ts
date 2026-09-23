import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse, type NextRequest } from "next/server";

const mockRequireMembership = vi.fn();
vi.mock("@/lib/api/auth", () => ({
  requireMembership: (...args: unknown[]) => mockRequireMembership(...args),
}));
const mockRevalidate = vi.fn();
vi.mock("next/cache", () => ({ revalidatePath: mockRevalidate }));
vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn() }));

const { POST } = await import("./route");

const OPERATION_ID = "11111111-1111-4111-8111-111111111111";
const WINE_ID = "55555555-5555-4555-8555-555555555555";
const BOTTLE_ID = "66666666-6666-4666-8666-666666666666";

function makeSupabase(options: {
  replayed?: boolean;
  error?: { code?: string; message?: string } | null;
} = {}) {
  const rpc = vi.fn().mockResolvedValue({
    data: options.error
      ? null
      : {
          operation_id: OPERATION_ID,
          command: "open",
          pour_event_ids: ["77777777-7777-4777-8777-777777777777"],
          replayed: options.replayed ?? false,
          open_bottle: {
            id: BOTTLE_ID,
            wine_id: WINE_ID,
            remaining_ml: 750,
            opened_at: "2026-09-23T12:00:00.000Z",
          },
        },
    error: options.error ?? null,
  });
  return { rpc };
}

function allow(supabase: ReturnType<typeof makeSupabase>) {
  mockRequireMembership.mockResolvedValue({
    supabase,
    restaurantId: "restaurant-a",
    user: { id: "user-a" },
    role: "staff",
  });
}

function request(
  body: unknown = { wine_id: WINE_ID, preservation_method: "coravin" },
  operationId: string | null = OPERATION_ID,
) {
  const headers = new Headers({ "content-type": "application/json" });
  if (operationId) headers.set("Idempotency-Key", operationId);
  return new Request("http://localhost/api/open-bottles", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  }) as unknown as NextRequest;
}

describe("POST /api/open-bottles", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns the membership response before header or body validation", async () => {
    mockRequireMembership.mockResolvedValue(
      NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    );
    expect((await POST(request({}, null))).status).toBe(401);
  });

  it.each([null, "not-a-uuid"])(
    "requires a valid UUID Idempotency-Key (%s)",
    async (key) => {
      const supabase = makeSupabase();
      allow(supabase);
      const response = await POST(request(undefined, key));
      expect(response.status).toBe(400);
      expect((await response.json()).error.code).toBe("invalid_idempotency_key");
      expect(supabase.rpc).not.toHaveBeenCalled();
    },
  );

  it("returns the existing 201 envelope and replay headers", async () => {
    const supabase = makeSupabase({ replayed: true });
    allow(supabase);

    const response = await POST(request());

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({
      open_bottle: expect.objectContaining({ id: BOTTLE_ID, wine_id: WINE_ID }),
    });
    expect(response.headers.get("Idempotency-Key")).toBe(OPERATION_ID);
    expect(response.headers.get("Idempotency-Replayed")).toBe("true");
    expect(supabase.rpc).toHaveBeenCalledWith(
      "execute_inventory_command",
      expect.objectContaining({
        p_operation_id: OPERATION_ID,
        p_restaurant_id: "restaurant-a",
        p_command: "open",
        p_wine_id: WINE_ID,
        p_preservation_method: "coravin",
      }),
    );
  });

  it.each([
    ["wine_not_found", 404, "wine_not_found"],
    ["no_inventory", 409, "no_inventory"],
    ["open_bottle_already_open", 409, "open_bottle_already_open"],
    ["inventory_operation_actor_conflict", 409, "idempotency_conflict"],
    ["inventory_operation_payload_conflict", 409, "idempotency_conflict"],
    ["invalid_inventory_command", 422, "invalid_inventory_command"],
  ])("maps %s to %i/%s", async (message, status, code) => {
    const supabase = makeSupabase({ error: { code: "P0001", message } });
    allow(supabase);
    const response = await POST(request());
    expect(response.status).toBe(status);
    expect((await response.json()).error.code).toBe(code);
    expect(response.headers.get("Idempotency-Replayed")).toBe("false");
  });

  it("sanitizes unknown database errors", async () => {
    const supabase = makeSupabase({
      error: { code: "XX000", message: "provider-secret" },
    });
    allow(supabase);
    const response = await POST(request());
    const text = await response.text();
    expect(response.status).toBe(500);
    expect(text).not.toContain("provider-secret");
  });
});
