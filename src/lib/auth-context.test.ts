import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ShadowSiteAccessObservation } from "@/lib/api/shadow-site-access";

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  resolveActiveMembership: vi.fn(),
}));

vi.mock("react", async (importOriginal) => {
  const original = await importOriginal<typeof import("react")>();
  return { ...original, cache: <T extends (...args: never[]) => unknown>(fn: T) => fn };
});
vi.mock("@/lib/supabase/server", () => ({
  createClient: (...args: unknown[]) => mocks.createClient(...args),
}));
vi.mock("@/lib/api/resolve-active-membership", () => ({
  resolveActiveMembership: (...args: unknown[]) =>
    mocks.resolveActiveMembership(...args),
}));

const { getAuthContext } = await import("./auth-context");
const { requireMembership } = await import("./api/auth");

const observations: Array<{
  label: string;
  value: ShadowSiteAccessObservation;
}> = [
  { label: "resolved", value: {
    state: "resolved",
    value: {
      siteId: "11111111-1111-4111-8111-111111111111",
      workspaceId: "33333333-3333-4333-8333-333333333333",
      legacyRole: "manager",
      roleKey: "beverage_manager",
      capabilities: [
        "site.read", "inventory.service", "inventory.manage",
        "receiving.capture", "receiving.cost_capture", "count.capture",
        "discrepancy.approve", "cost.read", "margin.read", "pricing.manage",
      ],
      accessSource: "explicit_site_membership",
    },
  } },
  { label: "denied", value: { state: "denied" } },
  { label: "provider unavailable", value: {
    state: "unavailable", reason: "provider_error",
  } },
  { label: "invalid result", value: {
    state: "unavailable", reason: "invalid_result",
  } },
];

function configureUser(user: { id: string; email?: string } | null) {
  const client = {
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user } }) },
  };
  mocks.createClient.mockResolvedValue(client);
  return client;
}

describe("getAuthContext", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns null without resolving membership when unauthenticated", async () => {
    configureUser(null);
    await expect(getAuthContext()).resolves.toBeNull();
    expect(mocks.resolveActiveMembership).not.toHaveBeenCalled();
  });

  it("returns null for no legacy membership", async () => {
    const client = configureUser({ id: "user-1" });
    mocks.resolveActiveMembership.mockResolvedValue(null);

    await expect(getAuthContext()).resolves.toBeNull();
    expect(mocks.resolveActiveMembership).toHaveBeenCalledWith(client, "user-1");
  });

  it.each(observations)("relays $label with API/RSC legacy-field parity", async ({ value }) => {
    const user = { id: "user-1", email: "manager@example.com" };
    const client = configureUser(user);
    mocks.resolveActiveMembership.mockResolvedValue({
      restaurantId: "restaurant-1",
      restaurantName: "Bar Norman",
      role: "manager",
      shadowAccess: value,
    });

    const rsc = await getAuthContext();
    const api = await requireMembership();

    expect(rsc).toEqual({
      user,
      supabase: client,
      restaurantId: "restaurant-1",
      restaurantName: "Bar Norman",
      userRole: "manager",
      shadowAccess: value,
    });
    expect(api).toMatchObject({
      user,
      supabase: client,
      restaurantId: "restaurant-1",
      role: "manager",
      shadowAccess: value,
    });
    expect(mocks.resolveActiveMembership).toHaveBeenCalledTimes(2);
  });
});
