import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const auth = vi.hoisted(() => ({ requireMembership: vi.fn() }));
const lookup = vi.hoisted(() => ({ loadOfflineCellarRows: vi.fn() }));

vi.mock("@/lib/api/auth", () => ({
  requireMembership: (...args: unknown[]) => auth.requireMembership(...args),
}));
vi.mock("@/domains/offline/cellar-lookup", () => ({
  loadOfflineCellarRows: (...args: unknown[]) => lookup.loadOfflineCellarRows(...args),
}));

const { GET } = await import("./route");

const userId = "10000000-0000-4000-8000-000000000001";
const restaurantId = "10000000-0000-4000-8000-000000000002";
const wineId = "10000000-0000-4000-8000-000000000003";

const lookupRows = [{
  wineId,
  displayName: "Volnay",
  producer: "Maison Example",
  vintage: 2022,
  format: "750ml",
  sealedQuantity: 2,
  placements: [],
  activeOpenBottleId: null,
  openedAt: null,
  remainingMl: null,
}];

describe("GET /api/offline-context", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    auth.requireMembership.mockResolvedValue({
      user: { id: userId },
      restaurantId,
      supabase: { client: "session-scoped" },
      role: "owner",
    });
    lookup.loadOfflineCellarRows.mockResolvedValue(lookupRows);
  });

  it("derives actor and site from current membership and ignores spoofed context", async () => {
    const request = new NextRequest(
      "http://localhost/api/offline-context?userId=attacker&restaurantId=other",
      { headers: { "x-restaurant-id": "other" } },
    );
    const response = await GET(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(body.context.userId).toBe(userId);
    expect(body.context.restaurantId).toBe(restaurantId);
    expect(body.projection.rows).toEqual(lookupRows);
    expect(lookup.loadOfflineCellarRows).toHaveBeenCalledWith(
      { client: "session-scoped" },
      restaurantId,
    );
    const issuedAt = Date.parse(body.context.issuedAt);
    const expiresAt = Date.parse(body.context.expiresAt);
    expect(expiresAt - issuedAt).toBeLessThanOrEqual(12 * 60 * 60 * 1_000);
    expect(body.projection.asOf).toBe(body.context.issuedAt);
  });

  it.each([
    [401, "unauthorized"],
    [403, "forbidden"],
  ])("preserves membership denial %i and marks it no-store", async (status, code) => {
    auth.requireMembership.mockResolvedValue(NextResponse.json(
      { error: { code } },
      { status },
    ));

    const response = await GET();

    expect(response.status).toBe(status);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(lookup.loadOfflineCellarRows).not.toHaveBeenCalled();
  });

  it("fails closed with a no-store 500 on database failure", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    lookup.loadOfflineCellarRows.mockRejectedValue(new Error("private database detail"));

    const response = await GET();

    expect(response.status).toBe(500);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual({
      error: { code: "internal_error", message: "Internal server error." },
    });
  });

  it("validates the response shape before emission", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    lookup.loadOfflineCellarRows.mockResolvedValue([
      { ...lookupRows[0], currentUnitCost: 42 },
    ]);

    const response = await GET();

    expect(response.status).toBe(500);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });
});
