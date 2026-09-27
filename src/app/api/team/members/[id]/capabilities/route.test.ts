import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const mockRequireAuth = vi.fn();
vi.mock("@/lib/api/auth", () => ({
  requireAuth: () => mockRequireAuth(),
}));

const { PUT } = await import("./route");

const MEMBER_ID = "00000000-0000-4000-8000-000000000001";
const params = { params: Promise.resolve({ id: MEMBER_ID }) };

describe("PUT /api/team/members/[id]/capabilities", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the authentication response without invoking governance", async () => {
    mockRequireAuth.mockResolvedValue(
      NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    );

    const response = await PUT(request(validBody()), params);

    expect(response.status).toBe(401);
  });

  it("allows an authenticated governance-only actor to replace the exact set", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: ["cost.read", "pricing.manage"],
      error: null,
    });
    mockRequireAuth.mockResolvedValue(authResult(rpc));

    const response = await PUT(
      request({
        capabilityKeys: ["pricing.manage", "cost.read"],
        expiresAt: "2099-09-26T12:00:00.000Z",
        grantReason: "  Covering the harvest menu  ",
      }),
      params,
    );

    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("replace_member_site_capabilities", {
      p_membership_id: MEMBER_ID,
      p_capability_keys: ["pricing.manage", "cost.read"],
      p_expires_at: "2099-09-26T12:00:00.000Z",
      p_grant_reason: "Covering the harvest menu",
    });
    expect(await response.json()).toEqual({
      capabilityKeys: ["cost.read", "pricing.manage"],
    });
  });

  it("uses an empty exact set to revoke every capability", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [], error: null });
    mockRequireAuth.mockResolvedValue(authResult(rpc));

    const response = await PUT(
      request({ capabilityKeys: [], grantReason: "Access no longer required" }),
      params,
    );

    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("replace_member_site_capabilities", {
      p_membership_id: MEMBER_ID,
      p_capability_keys: [],
      p_expires_at: null,
      p_grant_reason: "Access no longer required",
    });
    expect(await response.json()).toEqual({ capabilityKeys: [] });
  });

  it.each([
    [{ capabilityKeys: ["inventory.write"], grantReason: "Unknown key" }],
    [{ capabilityKeys: ["cost.read", "cost.read"], grantReason: "Duplicate" }],
    [{ capabilityKeys: ["cost.read"], grantReason: "   " }],
    [{ capabilityKeys: ["cost.read"], grantReason: "x".repeat(1001) }],
    [{ capabilityKeys: ["cost.read"], grantReason: "Valid", extra: true }],
  ])("rejects malformed or unknown capability input", async (body) => {
    const rpc = vi.fn();
    mockRequireAuth.mockResolvedValue(authResult(rpc));

    const response = await PUT(request(body), params);

    expect(response.status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });

  it.each([
    "C04_CALLER_NOT_GOVERNOR",
    "C04_TARGET_MEMBERSHIP_NOT_FOUND",
    "C04_TARGET_IDENTITY_NOT_CURRENT",
    "C04_TARGET_WORKSPACE_NOT_CURRENT",
  ])("fails closed for database-owned governance denial %s", async (message) => {
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: { message },
    });
    mockRequireAuth.mockResolvedValue(authResult(rpc));

    const response = await PUT(request(validBody()), params);

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: {
        code: "forbidden",
        message: "Capability replacement is not permitted.",
      },
    });
  });

  it("fails closed on unexpected RPC errors and malformed replacement results", async () => {
    const rpc = vi
      .fn()
      .mockResolvedValueOnce({ data: null, error: { message: "connection lost" } })
      .mockResolvedValueOnce({ data: ["margin.read"], error: null });
    mockRequireAuth.mockResolvedValue(authResult(rpc));

    const errored = await PUT(request(validBody()), params);
    const mismatched = await PUT(request(validBody()), params);

    expect(errored.status).toBe(500);
    expect(mismatched.status).toBe(500);
  });

  it("redacts a rejected RPC transport error", async () => {
    const rpc = vi.fn().mockRejectedValue(new Error("secret provider detail"));
    mockRequireAuth.mockResolvedValue(authResult(rpc));

    const response = await PUT(request(validBody()), params);
    const body = await response.text();

    expect(response.status).toBe(500);
    expect(body).not.toContain("secret provider detail");
  });
});

function authResult(rpc: ReturnType<typeof vi.fn>) {
  return {
    supabase: { rpc },
    user: { id: "governor-1" },
  };
}

function validBody() {
  return {
    capabilityKeys: ["cost.read", "pricing.manage"],
    grantReason: "Operational pricing delegation",
  };
}

function request(body: unknown) {
  return new NextRequest(
    `http://localhost/api/team/members/${MEMBER_ID}/capabilities`,
    {
      method: "PUT",
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
    },
  );
}
