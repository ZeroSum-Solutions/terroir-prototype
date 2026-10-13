import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";

const mockRequireMembership = vi.fn();
vi.mock("@/lib/api/auth", () => ({
  requireMembership: () => mockRequireMembership(),
}));

const mockResolveSitePricingAccess = vi.fn();
vi.mock("@/lib/api/site-capability", () => ({
  resolveSitePricingAccess: (...args: unknown[]) =>
    mockResolveSitePricingAccess(...args),
}));

const mockCreateClient = vi.fn();
vi.mock("@supabase/supabase-js", () => ({
  createClient: (...args: unknown[]) => mockCreateClient(...args),
}));

const mockRunRecompute = vi.fn();
vi.mock("@/lib/pricing-recommendations/recompute", () => ({
  runPricingRecommendationsRecompute: (...args: unknown[]) =>
    mockRunRecompute(...args),
}));

const { POST } = await import("./route");

describe("POST /api/pricing-recommendations/recompute", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-role-key");
  });

  it.each([401, 403])("returns the %s membership response", async (status) => {
    mockRequireMembership.mockResolvedValue(
      NextResponse.json({ error: "Denied" }, { status }),
    );

    const response = await POST();

    expect(response.status).toBe(status);
    expect(mockCreateClient).not.toHaveBeenCalled();
  });

  it.each([
    ["missing", undefined],
    ["denied", false],
    ["revoked", false],
  ])("denies %s pricing.manage authority before service access", async (_case, authority) => {
    mockRequireMembership.mockResolvedValue(authResult("owner"));
    mockResolveSitePricingAccess.mockResolvedValue({
      canReadCost: true,
      canReadMargin: true,
      canManagePricing: authority,
    });

    const response = await POST();

    expect(response.status).toBe(403);
    expect(mockResolveSitePricingAccess).toHaveBeenCalledWith(
      authenticatedClient,
      "restaurant-1",
    );
    expect(mockCreateClient).not.toHaveBeenCalled();
    expect(mockRunRecompute).not.toHaveBeenCalled();
  });

  it("fails closed when capability resolution errors", async () => {
    mockRequireMembership.mockResolvedValue(authResult("manager"));
    mockResolveSitePricingAccess.mockRejectedValue(new Error("authority timeout"));

    const response = await POST();

    expect(response.status).toBe(403);
    expect(mockCreateClient).not.toHaveBeenCalled();
  });

  it("does not turn governance or a grant on another site into operational authority", async () => {
    mockRequireMembership.mockResolvedValue(
      authResult("owner", "active-site-without-grant"),
    );
    mockResolveSitePricingAccess.mockResolvedValue({
      canReadCost: false,
      canReadMargin: false,
      canManagePricing: false,
    });

    const response = await POST();

    expect(response.status).toBe(403);
    expect(mockResolveSitePricingAccess).toHaveBeenCalledWith(
      authenticatedClient,
      "active-site-without-grant",
    );
    expect(mockCreateClient).not.toHaveBeenCalled();
  });

  it("returns 500 when service-role configuration is missing", async () => {
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
    mockRequireMembership.mockResolvedValue(authResult("staff"));
    mockResolveSitePricingAccess.mockResolvedValue(manageAccess());

    const response = await POST();

    expect(response.status).toBe(500);
    expect(mockCreateClient).not.toHaveBeenCalled();
  });

  it("allows an explicitly delegated staff member on the exact active site", async () => {
    const admin = { kind: "admin" };
    mockRequireMembership.mockResolvedValue(authResult("staff"));
    mockResolveSitePricingAccess.mockResolvedValue(manageAccess());
    mockCreateClient.mockReturnValue(admin);
    mockRunRecompute.mockResolvedValue({
      version: 1,
      kind: "pricing_recommendations_recompute",
      status: "succeeded",
    });

    const response = await POST();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      version: 1,
      kind: "pricing_recommendations_recompute",
      status: "succeeded",
    });
    expect(mockResolveSitePricingAccess).toHaveBeenCalledWith(
      authenticatedClient,
      "restaurant-1",
    );
    expect(mockCreateClient).toHaveBeenCalledWith(
      "https://example.supabase.co",
      "service-role-key",
      { auth: { persistSession: false } },
    );
    expect(mockRunRecompute).toHaveBeenCalledWith(
      admin,
      "restaurant-1",
      "user-1",
    );
  });

  it("rejects a legacy or expanded recompute result", async () => {
    mockRequireMembership.mockResolvedValue(authResult("staff"));
    mockResolveSitePricingAccess.mockResolvedValue(manageAccess());
    mockCreateClient.mockReturnValue({ kind: "admin" });
    mockRunRecompute.mockResolvedValue({
      version: 1,
      kind: "pricing_recommendations_recompute",
      status: "succeeded",
      classes: { feature_btg: 1 },
    });
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    const response = await POST();

    expect(response.status).toBe(500);
  });

  it("returns a redacted 500 when the job fails", async () => {
    mockRequireMembership.mockResolvedValue(authResult("manager"));
    mockResolveSitePricingAccess.mockResolvedValue(manageAccess());
    mockCreateClient.mockReturnValue({ kind: "admin" });
    mockRunRecompute.mockRejectedValue(new Error("secret database detail"));
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    const response = await POST();
    const body = await response.text();

    expect(response.status).toBe(500);
    expect(body).not.toContain("secret database detail");
    expect(console.error).toHaveBeenCalledWith(
      "pricing recommendations recompute failed",
    );
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain(
      "secret database detail",
    );
  });
});

const authenticatedClient = { kind: "authenticated" };

function authResult(
  role: "owner" | "manager" | "staff",
  restaurantId = "restaurant-1",
) {
  return {
    supabase: authenticatedClient,
    restaurantId,
    user: { id: "user-1" },
    role,
  };
}

function manageAccess() {
  return {
    canReadCost: false,
    canReadMargin: false,
    canManagePricing: true,
  };
}
