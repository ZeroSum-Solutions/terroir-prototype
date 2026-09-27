import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";

// Mock the Supabase server client. Operational membership selection is one
// closed RPC; no direct memberships-table query remains in this boundary.
const mockGetUser = vi.fn();
const mockRpc = vi.fn();
const mockObserveShadowSiteAccess = vi.fn();

type MembershipsPayload = {
  data: MembershipRow[] | null;
  error?: unknown;
};

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser: mockGetUser },
    rpc: (...args: unknown[]) => mockRpc(...args),
  })),
}));

// next/headers cookies() mock — active-restaurant.readActiveRestaurantFromCookie calls this.
const mockCookieGet = vi.fn();
vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({
    get: (name: string) => mockCookieGet(name),
  })),
}));

vi.mock("@/lib/api/shadow-site-access", async (importOriginal) => {
  const original = await importOriginal<typeof import("./shadow-site-access")>();
  return {
    ...original,
    observeShadowSiteAccess: (...args: unknown[]) =>
      mockObserveShadowSiteAccess(...args),
  };
});

// Import AFTER mocks
const { requireAuth, requireMembership, requireOwner, requireRole } = await import(
  "./auth"
);
const { signActiveRestaurantCookie } = await import("./active-restaurant");

const USER_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const SITE_A = "11111111-1111-4111-8111-111111111111";
const SITE_B = "22222222-2222-4222-8222-222222222222";
const REMOVED_SITE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

type MembershipRow = {
  restaurant_id: string;
  restaurant_name: string;
  role: "owner" | "manager" | "staff";
};

function membership(
  restaurantId: string,
  role: MembershipRow["role"],
  restaurantName = restaurantId,
): MembershipRow {
  return {
    restaurant_id: restaurantId,
    restaurant_name: restaurantName,
    role,
  };
}

function withMemberships(memberships: MembershipRow[]) {
  const payload: MembershipsPayload = { data: memberships, error: null };
  mockRpc.mockResolvedValue(payload);
}

const observations = [
  { label: "resolved", value: {
    state: "resolved",
    value: {
      siteId: "11111111-1111-4111-8111-111111111111",
      workspaceId: "33333333-3333-4333-8333-333333333333",
      legacyRole: "owner",
      roleKey: "site_owner",
      capabilities: ["site.read", "inventory.service", "inventory.manage",
        "receiving.capture", "receiving.cost_capture", "count.capture",
        "discrepancy.approve", "cost.read", "margin.read", "pricing.manage",
        "team.site.manage"],
      accessSource: "explicit_site_membership",
    },
  } },
  { label: "denied", value: { state: "denied" } },
  { label: "timeout or rejection", value: {
    state: "unavailable", reason: "provider_error",
  } },
  { label: "invalid", value: {
    state: "unavailable", reason: "invalid_result",
  } },
] as const;

beforeEach(() => {
  mockObserveShadowSiteAccess.mockResolvedValue({ state: "denied" });
});

describe("requireAuth", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCookieGet.mockReturnValue(undefined);
  });

  it("returns 401 when no user", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    const result = await requireAuth();
    expect(result).toBeInstanceOf(NextResponse);
    expect((result as NextResponse).status).toBe(401);
  });

  it("returns auth result with user when authenticated", async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: USER_ID, email: "test@test.com" } },
    });
    const result = await requireAuth();
    expect(result).not.toBeInstanceOf(NextResponse);
    expect((result as { user: { id: string } }).user.id).toBe(USER_ID);
  });
});

describe("requireMembership", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCookieGet.mockReturnValue(undefined);
  });

  it("returns 403 when user has no memberships", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: USER_ID } } });
    withMemberships([]);
    const result = await requireMembership();
    expect(result).toBeInstanceOf(NextResponse);
    expect((result as NextResponse).status).toBe(403);
    expect(mockObserveShadowSiteAccess).not.toHaveBeenCalled();
  });

  it("returns the sole membership when the user belongs to one restaurant", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: USER_ID } } });
    withMemberships([membership(SITE_A, "manager")]);
    const result = await requireMembership();
    expect(result).not.toBeInstanceOf(NextResponse);
    expect((result as { restaurantId: string }).restaurantId).toBe(SITE_A);
    expect(mockRpc).toHaveBeenCalledWith(
      "read_current_operational_memberships",
      { p_user_id: USER_ID },
    );
  });

  it("falls back to most-recently-joined when no cookie is present (multi-restaurant user)", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: USER_ID } } });
    // The RPC returns created_at DESC, id DESC order.
    withMemberships([
      membership(SITE_A, "manager", "Newest"),
      membership(SITE_B, "owner", "Older"),
    ]);
    const result = await requireMembership();
    expect((result as { restaurantId: string }).restaurantId).toBe(SITE_A);
  });

  it("honours the active_restaurant_id cookie when it points to a real membership", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: USER_ID } } });
    withMemberships([
      membership(SITE_A, "manager", "Newest"),
      membership(SITE_B, "owner", "Older"),
    ]);
    mockCookieGet.mockReturnValue({
      value: signActiveRestaurantCookie(SITE_B),
    });
    const result = await requireMembership();
    expect((result as { restaurantId: string }).restaurantId).toBe(SITE_B);
    expect((result as { role: string }).role).toBe("owner");
  });

  it("ignores a cookie for a restaurant the user no longer belongs to", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: USER_ID } } });
    withMemberships([
      membership(SITE_A, "manager", "Newest"),
      membership(SITE_B, "owner", "Older"),
    ]);
    mockCookieGet.mockReturnValue({
      value: signActiveRestaurantCookie(REMOVED_SITE),
    });
    const result = await requireMembership();
    expect((result as { restaurantId: string }).restaurantId).toBe(SITE_A);
  });

  it("ignores a cookie whose signature does not verify", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: USER_ID } } });
    withMemberships([
      membership(SITE_A, "manager", "Newest"),
      membership(SITE_B, "owner", "Older"),
    ]);
    // A hand-crafted cookie with a wrong MAC.
    mockCookieGet.mockReturnValue({ value: `${SITE_B}.not-a-real-signature` });
    const result = await requireMembership();
    expect((result as { restaurantId: string }).restaurantId).toBe(SITE_A);
  });

  it.each(observations)("relays the $label observation without changing membership", async ({ value }) => {
    mockGetUser.mockResolvedValue({ data: { user: { id: USER_ID } } });
    withMemberships([membership(SITE_A, "manager")]);
    mockObserveShadowSiteAccess.mockResolvedValue(value);

    const result = await requireMembership();

    expect(result).not.toBeInstanceOf(NextResponse);
    expect(result).toMatchObject({
      restaurantId: SITE_A,
      role: "manager",
      shadowAccess: value,
    });
    expect(mockObserveShadowSiteAccess).toHaveBeenCalledTimes(1);
  });
});

describe("requireOwner", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCookieGet.mockReturnValue(undefined);
  });

  it("returns 403 for non-owner role", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: USER_ID } } });
    withMemberships([membership(SITE_A, "staff")]);
    const result = await requireOwner();
    expect(result).toBeInstanceOf(NextResponse);
    expect((result as NextResponse).status).toBe(403);
  });

  it("returns membership for owner", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: USER_ID } } });
    withMemberships([membership(SITE_A, "owner")]);
    const result = await requireOwner();
    expect(result).not.toBeInstanceOf(NextResponse);
    expect((result as { role: string }).role).toBe("owner");
  });

  it.each(observations)("keeps owner authorization unchanged for $label", async ({ value }) => {
    mockGetUser.mockResolvedValue({ data: { user: { id: USER_ID } } });
    withMemberships([membership(SITE_A, "owner")]);
    mockObserveShadowSiteAccess.mockResolvedValue(value);

    const result = await requireOwner();

    expect(result).not.toBeInstanceOf(NextResponse);
    expect(result).toMatchObject({ role: "owner", shadowAccess: value });
  });
});

describe("requireRole", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCookieGet.mockReturnValue(undefined);
  });

  it("returns 401 when no user (propagates from requireMembership → requireAuth)", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    const result = await requireRole(["owner", "manager"]);
    expect(result).toBeInstanceOf(NextResponse);
    expect((result as NextResponse).status).toBe(401);
  });

  it("returns 403 when the caller's role is not in the allowed list (staff vs owner/manager)", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: USER_ID } } });
    withMemberships([membership(SITE_A, "staff")]);
    const result = await requireRole(["owner", "manager"]);
    expect(result).toBeInstanceOf(NextResponse);
    expect((result as NextResponse).status).toBe(403);
  });

  it("returns the membership when role is in the allowed list (manager)", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: USER_ID } } });
    withMemberships([membership(SITE_A, "manager")]);
    const result = await requireRole(["owner", "manager"]);
    expect(result).not.toBeInstanceOf(NextResponse);
    expect((result as { role: string }).role).toBe("manager");
    expect((result as { restaurantId: string }).restaurantId).toBe(SITE_A);
  });

  it("returns the membership when role is in the allowed list (owner)", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: USER_ID } } });
    withMemberships([membership(SITE_A, "owner")]);
    const result = await requireRole(["owner", "manager"]);
    expect(result).not.toBeInstanceOf(NextResponse);
    expect((result as { role: string }).role).toBe("owner");
  });

  it.each(observations)("keeps role authorization unchanged for $label", async ({ value }) => {
    mockGetUser.mockResolvedValue({ data: { user: { id: USER_ID } } });
    withMemberships([membership(SITE_A, "manager")]);
    mockObserveShadowSiteAccess.mockResolvedValue(value);

    const allowed = await requireRole(["owner", "manager"]);
    expect(allowed).not.toBeInstanceOf(NextResponse);
    expect(allowed).toMatchObject({ role: "manager", shadowAccess: value });

    withMemberships([membership(SITE_A, "staff")]);
    const denied = await requireRole(["owner", "manager"]);
    expect(denied).toBeInstanceOf(NextResponse);
    expect((denied as NextResponse).status).toBe(403);
  });
});
