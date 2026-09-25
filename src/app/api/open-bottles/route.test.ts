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
const RESTAURANT_ID = "22222222-2222-4222-8222-222222222222";
const OTHER_RESTAURANT_ID = "33333333-3333-4333-8333-333333333333";
const WINE_ID = "55555555-5555-4555-8555-555555555555";
const BOTTLE_ID = "66666666-6666-4666-8666-666666666666";

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
          command: "open",
          pour_event_ids: ["77777777-7777-4777-8777-777777777777"],
          replayed: options.replayed ?? false,
          open_bottle: {
            id: BOTTLE_ID,
            restaurant_id: RESTAURANT_ID,
            ...(name === "execute_physical_bottle_command" ? {
              nominal_capacity_ml: 750,
              closed_at: null,
              preservation_method: "coravin",
              source_inventory_item_id: "88888888-8888-4888-8888-888888888888",
              source_provenance: "known",
              identity_contract: 2,
              identity_origin: "native",
              state_version: 0,
            } : {}),
            wine_id: WINE_ID,
            remaining_ml: 750,
            opened_at: "2026-09-23T12:00:00.000Z",
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
        p_restaurant_id: RESTAURANT_ID,
        p_command: "open",
        p_wine_id: WINE_ID,
        p_preservation_method: "coravin",
      }),
    );
  });

  it("opens another exact bottle through the physical command in contract 2", async () => {
    const supabase = makeSupabase({ contractVersion: 2 });
    supabase.rpc.mockImplementation((name: string) => {
      if (name === "current_inventory_contract_version") {
        return Promise.resolve({ data: 2, error: null });
      }
      if (name === "execute_inventory_command") {
        return Promise.resolve({
          data: null,
          error: { code: "P0001", message: "legacy_inventory_command_retired" },
        });
      }
      return Promise.resolve({
        data: {
          operation_id: OPERATION_ID,
          command: "open",
          pour_event_ids: ["77777777-7777-4777-8777-777777777777"],
          replayed: false,
          closeout: null,
          open_bottle: {
            id: BOTTLE_ID,
            restaurant_id: RESTAURANT_ID,
            wine_id: WINE_ID,
            remaining_ml: 750,
            nominal_capacity_ml: 750,
            opened_at: "2026-09-23T12:00:00.000Z",
            closed_at: null,
            preservation_method: "coravin",
            source_inventory_item_id: "88888888-8888-4888-8888-888888888888",
            source_provenance: "known",
            identity_contract: 2,
            identity_origin: "native",
            state_version: 0,
          },
        },
        error: null,
      });
    });
    allow(supabase);
    const response = await POST(request());
    expect(response.status).toBe(201);
    expect((await response.json()).open_bottle.id).toBe(BOTTLE_ID);
    expect(supabase.rpc).toHaveBeenCalledWith(
      "execute_inventory_command",
      expect.objectContaining({
        p_operation_id: OPERATION_ID,
        p_command: "open",
      }),
    );
    expect(supabase.rpc).toHaveBeenCalledWith(
      "execute_physical_bottle_command",
      expect.objectContaining({
        p_command: "open",
        p_open_bottle_id: undefined,
        p_preservation_method: "coravin",
      }),
    );
  });

  it("returns a completed version-1 replay under contract 2 without a physical call", async () => {
    const supabase = makeSupabase({ contractVersion: 2, replayed: true });
    allow(supabase);

    const response = await POST(request());

    expect(response.status).toBe(201);
    expect(response.headers.get("Idempotency-Key")).toBe(OPERATION_ID);
    expect(response.headers.get("Idempotency-Replayed")).toBe("true");
    expect((await response.json()).open_bottle.id).toBe(BOTTLE_ID);
    expect(supabase.rpc).toHaveBeenCalledWith(
      "execute_inventory_command",
      expect.objectContaining({ p_operation_id: OPERATION_ID, p_command: "open" }),
    );
    expect(supabase.rpc).not.toHaveBeenCalledWith(
      "execute_physical_bottle_command",
      expect.anything(),
    );
  });

  it.each([
    ["inventory_operation_actor_conflict", "P0001", 409, "idempotency_conflict"],
    ["inventory_operation_payload_conflict", "P0001", 409, "idempotency_conflict"],
    ["private-policy-detail", "42501", 403, "forbidden"],
    ["provider-secret", "XX000", 500, "internal_error"],
  ])("keeps replay error %s terminal under contract 2", async (
    message,
    code,
    status,
    responseCode,
  ) => {
    const supabase = makeSupabase({
      contractVersion: 2,
      error: { code, message },
    });
    allow(supabase);

    const response = await POST(request());

    expect(response.status).toBe(status);
    expect((await response.json()).error.code).toBe(responseCode);
    expect(supabase.rpc).not.toHaveBeenCalledWith(
      "execute_physical_bottle_command",
      expect.anything(),
    );
  });

  it("keeps a malformed legacy replay result terminal under contract 2", async () => {
    const supabase = makeSupabase({ contractVersion: 2 });
    supabase.rpc.mockImplementation((name: string) => Promise.resolve(
      name === "current_inventory_contract_version"
        ? { data: 2, error: null }
        : { data: { operation_id: OPERATION_ID }, error: null },
    ));
    allow(supabase);

    const response = await POST(request());

    expect(response.status).toBe(500);
    expect((await response.json()).error.code).toBe("internal_error");
    expect(supabase.rpc).not.toHaveBeenCalledWith(
      "execute_physical_bottle_command",
      expect.anything(),
    );
  });

  it.each([
    ["mismatched identity", {
      operation_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      command: "pour",
      replayed: true,
      restaurant_id: OTHER_RESTAURANT_ID,
      wine_id: "44444444-4444-4444-8444-444444444444",
    }],
    ["non-replay result", {
      operation_id: OPERATION_ID,
      command: "open",
      replayed: false,
      restaurant_id: RESTAURANT_ID,
      wine_id: WINE_ID,
    }],
  ])("rejects a contract-2 legacy Open %s without physical fallback", async (
    _label,
    values,
  ) => {
    const supabase = makeSupabase({ contractVersion: 2 });
    supabase.rpc.mockImplementation((name: string) => Promise.resolve(
      name === "current_inventory_contract_version"
        ? { data: 2, error: null }
        : {
            data: {
              operation_id: values.operation_id,
              command: values.command,
              pour_event_ids: [],
              replayed: values.replayed,
              open_bottle: {
                id: BOTTLE_ID,
                restaurant_id: values.restaurant_id,
                wine_id: values.wine_id,
                remaining_ml: 750,
                opened_at: "2026-09-23T12:00:00.000Z",
              },
              closeout: null,
            },
            error: null,
          },
    ));
    allow(supabase);

    const response = await POST(request());

    expect(response.status).toBe(500);
    expect((await response.json()).error.code).toBe("internal_error");
    expect(response.headers.get("Idempotency-Key")).toBe(OPERATION_ID);
    expect(response.headers.get("Idempotency-Replayed")).toBe("false");
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
