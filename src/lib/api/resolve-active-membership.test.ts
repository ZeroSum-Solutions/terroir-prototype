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

const USER_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const SITE_A = "11111111-1111-4111-8111-111111111111";
const SITE_B = "22222222-2222-4222-8222-222222222222";

const RESOLVED: ShadowSiteAccessObservation = {
  state: "resolved",
  value: {
    siteId: SITE_A,
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
  restaurant_name: string;
  role: "owner" | "manager" | "staff";
};

function membership(overrides: Partial<MembershipRow> = {}): MembershipRow {
  return {
    restaurant_id: SITE_A,
    restaurant_name: "Osteria Scala",
    role: "staff",
    ...overrides,
  };
}

function clientWith(data: unknown, error: unknown = null) {
  const rpc = vi.fn().mockResolvedValue({ data, error });
  const client = { rpc } as unknown as SupabaseClient<Database>;
  return { client, rpc };
}

function expectNoSelectionSideEffects() {
  expect(mocks.readActiveRestaurantFromCookie).not.toHaveBeenCalled();
  expect(mocks.observeShadowSiteAccess).not.toHaveBeenCalled();
}

describe("resolveActiveMembership", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.readActiveRestaurantFromCookie.mockResolvedValue(null);
    mocks.observeShadowSiteAccess.mockResolvedValue(RESOLVED);
  });

  it("uses the exact actor RPC and preserves its deterministic fallback order", async () => {
    const rows = [
      membership({ restaurant_name: "Newest", role: "manager" }),
      membership({ restaurant_id: SITE_B, restaurant_name: "Older", role: "owner" }),
    ];
    const harness = clientWith(rows);

    const result = await resolveActiveMembership(harness.client, USER_ID);

    expect(result).toEqual({
      restaurantId: SITE_A,
      restaurantName: "Newest",
      role: "manager",
      shadowAccess: RESOLVED,
    });
    expect(harness.rpc).toHaveBeenCalledOnce();
    expect(harness.rpc).toHaveBeenCalledWith(
      "read_current_operational_memberships",
      { p_user_id: USER_ID },
    );
    expect(mocks.readActiveRestaurantFromCookie).toHaveBeenCalledWith([
      SITE_A,
      SITE_B,
    ]);
    expect(mocks.observeShadowSiteAccess).toHaveBeenCalledOnce();
    expect(mocks.observeShadowSiteAccess).toHaveBeenCalledWith(
      harness.client,
      SITE_A,
      "manager",
    );
  });

  it("selects a signed-cookie site only from the validated current rows", async () => {
    const harness = clientWith([
      membership({ restaurant_name: "Newest", role: "manager" }),
      membership({ restaurant_id: SITE_B, restaurant_name: "Older", role: "owner" }),
    ]);
    mocks.readActiveRestaurantFromCookie.mockResolvedValue(SITE_B);
    mocks.observeShadowSiteAccess.mockResolvedValue({ state: "denied" });

    await expect(resolveActiveMembership(harness.client, USER_ID)).resolves.toEqual({
      restaurantId: SITE_B,
      restaurantName: "Older",
      role: "owner",
      shadowAccess: { state: "denied" },
    });
    expect(mocks.observeShadowSiteAccess).toHaveBeenCalledWith(
      harness.client,
      SITE_B,
      "owner",
    );
  });

  it("falls back to the first ordered row when the cookie helper returns no current site", async () => {
    const harness = clientWith([
      membership({ restaurant_name: "Newest", role: "manager" }),
      membership({ restaurant_id: SITE_B, restaurant_name: "Older", role: "owner" }),
    ]);
    mocks.readActiveRestaurantFromCookie.mockResolvedValue(
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    );

    await expect(resolveActiveMembership(harness.client, USER_ID)).resolves.toMatchObject({
      restaurantId: SITE_A,
      restaurantName: "Newest",
      role: "manager",
    });
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
  ] as const)("keeps operational selection authoritative when shadow is $state", async ({ observation }) => {
    const harness = clientWith([
      membership({ restaurant_name: "Operational authority", role: "manager" }),
    ]);
    mocks.observeShadowSiteAccess.mockResolvedValue(observation);

    await expect(resolveActiveMembership(harness.client, USER_ID)).resolves.toMatchObject({
      restaurantId: SITE_A,
      restaurantName: "Operational authority",
      role: "manager",
      shadowAccess: observation,
    });
  });

  it("returns null before cookie or shadow work for a valid empty result", async () => {
    const harness = clientWith([]);

    await expect(resolveActiveMembership(harness.client, USER_ID)).resolves.toBeNull();
    expectNoSelectionSideEffects();
  });

  it("returns null before cookie or shadow work for an RPC error", async () => {
    const harness = clientWith([membership()], { message: "membership failed" });

    await expect(resolveActiveMembership(harness.client, USER_ID)).resolves.toBeNull();
    expectNoSelectionSideEffects();
  });

  it("fails closed when the RPC promise rejects", async () => {
    const rpc = vi.fn().mockRejectedValue(new Error("private provider detail"));
    const client = { rpc } as unknown as SupabaseClient<Database>;

    await expect(resolveActiveMembership(client, USER_ID)).resolves.toBeNull();
    expectNoSelectionSideEffects();
  });

  it("returns null before cookie or shadow work for null RPC data", async () => {
    const harness = clientWith(null);

    await expect(resolveActiveMembership(harness.client, USER_ID)).resolves.toBeNull();
    expectNoSelectionSideEffects();
  });

  it.each([
    ["a non-array response", {}],
    ["an extra key", [{ ...membership(), workspace_id: SITE_B }]],
    ["an unknown role", [{ ...membership(), role: "admin" }]],
    ["null name and role fallbacks", [{ ...membership(), restaurant_name: null, role: null }]],
    [
      "a duplicate site",
      [membership(), membership({ restaurant_name: "Duplicate", role: "owner" })],
    ],
  ])("returns null for %s before cookie or shadow work", async (_case, data) => {
    const harness = clientWith(data);

    await expect(resolveActiveMembership(harness.client, USER_ID)).resolves.toBeNull();
    expectNoSelectionSideEffects();
  });

  it("uses the database name verbatim without inventing a fallback", async () => {
    const harness = clientWith([membership({ restaurant_name: "" })]);

    await expect(resolveActiveMembership(harness.client, USER_ID)).resolves.toMatchObject({
      restaurantName: "",
      role: "staff",
    });
  });

  it("propagates cookie-provider failures without running shadow observation", async () => {
    const harness = clientWith([membership()]);
    const failure = new Error("cookie secret unavailable");
    mocks.readActiveRestaurantFromCookie.mockRejectedValue(failure);

    await expect(resolveActiveMembership(harness.client, USER_ID)).rejects.toBe(failure);
    expect(mocks.observeShadowSiteAccess).not.toHaveBeenCalled();
  });

  it("keeps staff operational access independent from pricing capabilities", async () => {
    const harness = clientWith([membership({ role: "staff" })]);
    mocks.observeShadowSiteAccess.mockResolvedValue({ state: "denied" });

    await expect(resolveActiveMembership(harness.client, USER_ID)).resolves.toEqual({
      restaurantId: SITE_A,
      restaurantName: "Osteria Scala",
      role: "staff",
      shadowAccess: { state: "denied" },
    });
    expect(harness.rpc).toHaveBeenCalledTimes(1);
  });
});
