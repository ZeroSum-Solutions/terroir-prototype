import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse, type NextRequest } from "next/server";
import { BOTTLE_LOCATION_BIN_UNAVAILABLE_MESSAGE } from "@/lib/api/bottle-location-receive-contract";

const mockRequireMembership = vi.fn();
vi.mock("@/lib/api/auth", () => ({ requireMembership: (...args: unknown[]) => mockRequireMembership(...args) }));
vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn() }));
const { POST } = await import("./route");

const userId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const restaurantId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const operationId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const wineId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const binId = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const receipt = {
  version: 1, kind: "bottle_location_receive", status: "committed",
  operationId, inventoryItemId: "ffffffff-ffff-4fff-8fff-ffffffffffff",
  wineId, section: "Main cellar", binId, binCode: "A-1", quantity: 1,
};
const body = { wine_id: wineId, section: "Main cellar", bin_id: binId };

function auth() {
  const rpc = vi.fn().mockResolvedValue({ data: { ...receipt, replayed: false }, error: null });
  const from = vi.fn(() => { throw new Error("Direct table access is forbidden"); });
  mockRequireMembership.mockResolvedValue({ supabase: { rpc, from }, restaurantId, user: { id: userId }, role: "staff" });
  return { rpc, from };
}
function request(value: unknown = body, overrides: Record<string, string | null> = {}): NextRequest {
  const headers = new Headers({ "Content-Type": "application/json", "Idempotency-Key": operationId,
    "X-Expected-User-Id": userId, "X-Expected-Restaurant-Id": restaurantId });
  for (const [key, value] of Object.entries(overrides)) {
    if (value === null) headers.delete(key); else headers.set(key, value);
  }
  return new Request("http://localhost/api/scan-bottle/confirm", {
    method: "POST", headers, body: JSON.stringify(value),
  }) as NextRequest;
}
beforeEach(() => vi.clearAllMocks());

describe("POST /api/scan-bottle/confirm", () => {
  it("authenticates before header or body validation", async () => {
    const { rpc, from } = auth();
    mockRequireMembership.mockResolvedValue(NextResponse.json({ error: { code: "unauthorized" } }, { status: 401 }));
    const invalid = new Request("http://localhost/api/scan-bottle/confirm", { method: "POST", body: "not json" }) as NextRequest;
    expect((await POST(invalid)).status).toBe(401);
    expect(rpc).not.toHaveBeenCalled();
    expect(from).not.toHaveBeenCalled();
  });
  it.each(["X-Expected-User-Id", "X-Expected-Restaurant-Id"])("refuses missing or wrong %s before RPC", async (header) => {
    const { rpc } = auth();
    for (const value of [null, "invalid", binId]) {
      const response = await POST(request(body, { [header]: value }));
      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({ error: { code: "bottle_context_mismatch" } });
    }
    expect(rpc).not.toHaveBeenCalled();
  });
  it.each([null, "invalid"])("refuses invalid idempotency key %j before RPC", async (key) => {
    const { rpc } = auth();
    expect((await POST(request(body, { "Idempotency-Key": key }))).status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });
  it.each([
    { ...body, wine_id: "invalid" }, { ...body, bin_id: "A-1" }, { ...body, section: " " },
    { ...body, section: "a".repeat(201) }, { ...body, quantity: 2 }, { ...body, unit_cost: 50 },
    { wine_id: wineId, section: "Cellar", bin_location: "A-1" },
  ])("refuses invalid or extra input before database access: %j", async (value) => {
    const { rpc, from } = auth();
    expect((await POST(request(value))).status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
    expect(from).not.toHaveBeenCalled();
  });
  it.each([false, true])("preserves staff success/replay=%s with exact arguments and cost-free output", async (replayed) => {
    const { rpc, from } = auth();
    rpc.mockResolvedValue({ data: { ...receipt, replayed }, error: null });
    const response = await POST(request({ ...body, section: " Main cellar " }));
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual(receipt);
    expect(response.headers.get("Idempotency-Key")).toBe(operationId);
    expect(response.headers.get("Idempotency-Replayed")).toBe(String(replayed));
    expect(rpc).toHaveBeenCalledExactlyOnceWith("receive_bottle_at_location_private", {
      p_restaurant_id: restaurantId, p_operation_id: operationId, p_wine_id: wineId,
      p_section: "Main cellar", p_bin_id: binId,
    });
    expect(from).not.toHaveBeenCalled();
  });
  it("accepts uppercase UUIDs and echoes the original submitted key", async () => {
    auth();
    const response = await POST(request({ ...body, wine_id: wineId.toUpperCase(), bin_id: binId.toUpperCase() }, {
      "Idempotency-Key": operationId.toUpperCase(), "X-Expected-User-Id": userId.toUpperCase(),
      "X-Expected-Restaurant-Id": restaurantId.toUpperCase(),
    }));
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual(receipt);
    expect(response.headers.get("Idempotency-Key")).toBe(operationId.toUpperCase());
  });
  it.each([
    ["42501", 403, "forbidden"], ["P05W1", 404, "wine_not_found"],
    ["P05B1", 409, "bin_unavailable"], ["P05C1", 409, "bottle_location_operation_conflict"],
    ["P05V1", 500, "internal_error"], ["P05I1", 500, "internal_error"], ["unknown", 500, "internal_error"],
  ])("maps SQLSTATE %s without inspecting or exposing provider text", async (code, status, expectedCode) => {
    const { rpc } = auth();
    rpc.mockResolvedValue({ data: null, error: { code, message: "super-secret raw cost P05B1", details: "private" } });
    const response = await POST(request());
    expect(response.status).toBe(status);
    const result = await response.json();
    expect(result.error.code).toBe(expectedCode);
    expect(JSON.stringify(result)).not.toMatch(/super-secret|raw cost|private/);
    if (code === "P05B1") expect(result).toEqual({ error: { code: "bin_unavailable", message: BOTTLE_LOCATION_BIN_UNAVAILABLE_MESSAGE } });
  });
  it.each([
    null, {}, { ...receipt }, { ...receipt, replayed: "true" },
    { ...receipt, replayed: false, unit_cost: 50 }, { ...receipt, replayed: false, operationId: wineId },
    { ...receipt, replayed: false, wineId: operationId }, { ...receipt, replayed: false, section: "Elsewhere" },
    { ...receipt, replayed: false, binId: wineId }, { ...receipt, replayed: false, quantity: 2 },
  ])("fails closed on malformed or mismatched RPC results", async (data) => {
    const { rpc } = auth();
    rpc.mockResolvedValue({ data, error: null });
    const response = await POST(request());
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: { code: "internal_error", message: "Internal server error." } });
  });
  it("redacts thrown RPC errors", async () => {
    const { rpc } = auth();
    rpc.mockRejectedValue(new Error("super-secret"));
    const response = await POST(request());
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain("super-secret");
  });
});
