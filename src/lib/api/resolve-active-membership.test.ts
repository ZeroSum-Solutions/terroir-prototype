import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import type { ShadowSiteAccessObservation } from "./shadow-site-access";

const mocks = vi.hoisted(() => ({
  readActiveRestaurantFromCookie: vi.fn(),
  observeShadowSiteAccess: vi.fn(),
}));

vi.mock("@/lib/api/active-restaurant", () => ({
  readActiveRestaurantFromCookie: (...args: unknown[]) =>
    mocks.readActiveRestaurantFromCookie(...args),
}));
vi.mock("@/lib/api/shadow-site-access", async (importOriginal) => {
  const original = await importOriginal<typeof import("./shadow-site-access")>();
  return {
    ...original,
    observeShadowSiteAccess: (...args: unknown[]) =>
      mocks.observeShadowSiteAccess(...args),
  };
});

const { resolveActiveMembership } = await import("./resolve-active-membership");

const RESOLVED: ShadowSiteAccessObservation = {
  state: "resolved",
  value: {
    siteId: "11111111-1111-4111-8111-111111111111",
    workspaceId: "33333333-3333-4333-8333-333333333333",
    legacyRole: "manager",
    roleKey: "beverage_manager",
    capabilities: [
      "site.read",
      "inventory.service",
      "inventory.manage",
      "receiving.capture",
      "receiving.cost_capture",
      "count.capture",
      "discrepancy.approve",
      "cost.read",
      "margin.read",
      "pricing.manage",
    ],
    accessSource: "explicit_site_membership",
  },
};

type MembershipRow = {
  restaurant_id: string;
  role: "owner" | "manager" | "staff" | null;
  restaurants: { name: string } | null;
};

function clientWith(data: MembershipRow[] | null, error: unknown = null) {
  const finalOrder = vi.fn(() => Promise.resolve({ data, error }));
  const firstOrder = vi.fn(() => ({ order: finalOrder }));
  const eq = vi.fn(() => ({ order: firstOrder }));
  const select = vi.fn(() => ({ eq }));
  const from = vi.fn(() => ({ select }));
  const client = { from } as unknown as SupabaseClient<Database>;
  return { client, from, select, eq, firstOrder, finalOrder };
}

describe("resolveActiveMembership", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.readActiveRestaurantFromCookie.mockResolvedValue(null);
    mocks.observeShadowSiteAccess.mockResolvedValue(RESOLVED);
  });

  it("keeps deterministic fallback selection and observes it once with the same client", async () => {
    const newest = "11111111-1111-4111-8111-111111111111";
    const older = "22222222-2222-4222-8222-222222222222";
    const harness = clientWith([
      { restaurant_id: newest, role: "manager", restaurants: { name: "Newest" } },
      { restaurant_id: older, role: "owner", restaurants: { name: "Older" } },
    ]);

    const result = await resolveActiveMembership(harness.client, "user-1");

    expect(result).toEqual({
      restaurantId: newest,
      restaurantName: "Newest",
      role: "manager",
      shadowAccess: RESOLVED,
    });
    expect(harness.from).toHaveBeenCalledWith("memberships");
    expect(harness.select).toHaveBeenCalledWith(
      "restaurant_id, role, restaurants(name)",
    );
    expect(harness.eq).toHaveBeenCalledWith("user_id", "user-1");
    expect(harness.firstOrder).toHaveBeenCalledWith("created_at", {
      ascending: false,
    });
    expect(harness.finalOrder).toHaveBeenCalledWith("id", { ascending: false });
    expect(mocks.readActiveRestaurantFromCookie).toHaveBeenCalledWith([newest, older]);
    expect(mocks.observeShadowSiteAccess).toHaveBeenCalledTimes(1);
    expect(mocks.observeShadowSiteAccess).toHaveBeenCalledWith(
      harness.client,
      newest,
      "manager",
    );
  });

  it("observes the cookie-selected membership without changing its role or name", async () => {
    const newest = "11111111-1111-4111-8111-111111111111";
    const older = "22222222-2222-4222-8222-222222222222";
    const harness = clientWith([
      { restaurant_id: newest, role: "manager", restaurants: { name: "Newest" } },
      { restaurant_id: older, role: "owner", restaurants: { name: "Older" } },
    ]);
    mocks.readActiveRestaurantFromCookie.mockResolvedValue(older);
    mocks.observeShadowSiteAccess.mockResolvedValue({ state: "denied" });

    const result = await resolveActiveMembership(harness.client, "user-1");

    expect(result).toEqual({
      restaurantId: older,
      restaurantName: "Older",
      role: "owner",
      shadowAccess: { state: "denied" },
    });
    expect(mocks.observeShadowSiteAccess).toHaveBeenCalledWith(
      harness.client,
      older,
      "owner",
    );
  });

  it.each([
    { state: "resolved", observation: RESOLVED },
    { state: "denied", observation: { state: "denied" } },
    {
      state: "timeout or rejection",
      observation: { state: "unavailable", reason: "provider_error" },
    },
    {
      state: "invalid result",
      observation: { state: "unavailable", reason: "invalid_result" },
    },
  ] as const)("preserves legacy selection for $state", async ({ observation }) => {
    const harness = clientWith([
      {
        restaurant_id: "11111111-1111-4111-8111-111111111111",
        role: "manager",
        restaurants: { name: "Legacy authority" },
      },
    ]);
    mocks.observeShadowSiteAccess.mockResolvedValue(observation);

    const result = await resolveActiveMembership(harness.client, "user-1");

    expect(result).toMatchObject({
      restaurantId: "11111111-1111-4111-8111-111111111111",
      restaurantName: "Legacy authority",
      role: "manager",
      shadowAccess: observation,
    });
  });

  it("returns null and skips shadow observation when no membership exists", async () => {
    const harness = clientWith([]);
    await expect(resolveActiveMembership(harness.client, "user-1")).resolves.toBeNull();
    expect(mocks.observeShadowSiteAccess).not.toHaveBeenCalled();
  });

  it("returns null and skips shadow observation on a membership provider error", async () => {
    const harness = clientWith(null, { message: "membership failed" });
    await expect(resolveActiveMembership(harness.client, "user-1")).resolves.toBeNull();
    expect(mocks.observeShadowSiteAccess).not.toHaveBeenCalled();
  });

  it("preserves the legacy staff and restaurant-name fallbacks", async () => {
    const harness = clientWith([
      {
        restaurant_id: "11111111-1111-4111-8111-111111111111",
        role: null,
        restaurants: null,
      },
    ]);
    mocks.observeShadowSiteAccess.mockResolvedValue({ state: "denied" });

    const result = await resolveActiveMembership(harness.client, "user-1");

    expect(result).toMatchObject({
      restaurantName: "My Restaurant",
      role: "staff",
      shadowAccess: { state: "denied" },
    });
    expect(mocks.observeShadowSiteAccess).toHaveBeenCalledWith(
      harness.client,
      "11111111-1111-4111-8111-111111111111",
      "staff",
    );
  });
});
