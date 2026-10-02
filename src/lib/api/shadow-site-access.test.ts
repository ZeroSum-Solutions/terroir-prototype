import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import {
  observeShadowSiteAccess,
  SHADOW_SITE_ACCESS_DEADLINE_MS,
  type ScheduleShadowDeadline,
} from "./shadow-site-access";

const RESTAURANT_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_RESTAURANT_ID = "22222222-2222-4222-8222-222222222222";
const WORKSPACE_ID = "33333333-3333-4333-8333-333333333333";

const STAFF_CAPABILITIES = ["site.read", "inventory.service"] as const;
const MANAGER_CAPABILITIES = [
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
] as const;
const OWNER_CAPABILITIES = [...MANAGER_CAPABILITIES, "team.site.manage"] as const;
const GROUP_OWNER_CAPABILITIES = [...OWNER_CAPABILITIES, "group.manage"] as const;

function row(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    restaurant_id: RESTAURANT_ID,
    workspace_id: WORKSPACE_ID,
    legacy_role: "owner",
    preset_key: "site_owner",
    capabilities: [...GROUP_OWNER_CAPABILITIES],
    access_source: "explicit_site_membership",
    ...overrides,
  };
}

type ClientHarness = {
  client: SupabaseClient<Database>;
  rpc: ReturnType<typeof vi.fn>;
  abortSignal: ReturnType<typeof vi.fn>;
  getSignal: () => AbortSignal | undefined;
};

function clientFor(
  request: unknown,
  options: { rpcThrows?: boolean; abortSignalThrows?: boolean } = {},
): ClientHarness {
  let signal: AbortSignal | undefined;
  const abortSignal = vi.fn((nextSignal: AbortSignal) => {
    signal = nextSignal;
    if (options.abortSignalThrows) throw new Error("builder exploded");
    return request;
  });
  const rpc = vi.fn(() => {
    if (options.rpcThrows) throw new Error("rpc exploded");
    return { abortSignal };
  });
  return {
    client: { rpc } as unknown as SupabaseClient<Database>,
    rpc,
    abortSignal,
    getSignal: () => signal,
  };
}

function manualDeadline() {
  let callback: (() => void) | undefined;
  const cancel = vi.fn();
  const schedule: ScheduleShadowDeadline = vi.fn((next, delayMs) => {
    callback = next;
    expect(delayMs).toBe(SHADOW_SITE_ACCESS_DEADLINE_MS);
    return cancel;
  });
  return {
    schedule,
    cancel,
    fire: () => {
      if (!callback) throw new Error("deadline was not scheduled");
      callback();
    },
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe("observeShadowSiteAccess SDK boundary", () => {
  it("calls the one RPC with only the selected restaurant and one abort signal", async () => {
    const harness = clientFor(Promise.resolve({ data: [row()], error: null }));
    const deadline = manualDeadline();

    await observeShadowSiteAccess(
      harness.client,
      RESTAURANT_ID,
      "owner",
      deadline.schedule,
    );

    expect(harness.rpc).toHaveBeenCalledTimes(1);
    expect(harness.rpc).toHaveBeenCalledWith("shadow_effective_site_access", {
      p_restaurant_id: RESTAURANT_ID,
    });
    expect(harness.abortSignal).toHaveBeenCalledTimes(1);
    expect(harness.getSignal()).toBeInstanceOf(AbortSignal);
    expect(deadline.cancel).toHaveBeenCalledTimes(1);
  });

  it.each([
    { name: "null result", result: null },
    { name: "array result", result: [] },
    { name: "missing fields", result: {} },
    { name: "missing data", result: { error: null } },
    { name: "missing error", result: { data: [] } },
    { name: "undefined error", result: { data: [], error: undefined } },
    { name: "primitive error", result: { data: [], error: "bad" } },
    { name: "null data", result: { data: null, error: null } },
    { name: "undefined data", result: { data: undefined, error: null } },
    { name: "non-array data", result: { data: row(), error: null } },
  ])("maps $name to invalid_result", async ({ result }) => {
    const harness = clientFor(Promise.resolve(result));
    await expect(
      observeShadowSiteAccess(harness.client, RESTAURANT_ID, "owner"),
    ).resolves.toEqual({ state: "unavailable", reason: "invalid_result" });
  });

  it("lets a provider error win over accompanying data and discards its details", async () => {
    const harness = clientFor(Promise.resolve({
      data: [row()],
      error: { message: "SHADOW_PROVIDER_SECRET", details: "raw detail" },
    }));

    const observation = await observeShadowSiteAccess(
      harness.client,
      RESTAURANT_ID,
      "owner",
    );

    expect(observation).toEqual({ state: "unavailable", reason: "provider_error" });
    expect(JSON.stringify(observation)).not.toContain("SHADOW_PROVIDER_SECRET");
  });

  it("maps only a successful empty array to denied", async () => {
    const harness = clientFor(Promise.resolve({ data: [], error: null }));
    await expect(
      observeShadowSiteAccess(harness.client, RESTAURANT_ID, "owner"),
    ).resolves.toEqual({ state: "denied" });
  });

  it("maps synchronous RPC and abort-builder throws to provider_error", async () => {
    const rpcThrow = clientFor(undefined, { rpcThrows: true });
    const builderThrow = clientFor(undefined, { abortSignalThrows: true });

    await expect(
      observeShadowSiteAccess(rpcThrow.client, RESTAURANT_ID, "owner"),
    ).resolves.toEqual({ state: "unavailable", reason: "provider_error" });
    await expect(
      observeShadowSiteAccess(builderThrow.client, RESTAURANT_ID, "owner"),
    ).resolves.toEqual({ state: "unavailable", reason: "provider_error" });
  });

  it("maps an asynchronously rejected request to provider_error", async () => {
    const harness = clientFor(Promise.reject(new Error("request failed")));
    await expect(
      observeShadowSiteAccess(harness.client, RESTAURANT_ID, "owner"),
    ).resolves.toEqual({ state: "unavailable", reason: "provider_error" });
  });
});

describe("observeShadowSiteAccess exact normalization", () => {
  it.each([
    {
      role: "staff" as const,
      preset: "service_staff",
      providerCapabilities: [...STAFF_CAPABILITIES].reverse(),
      canonicalCapabilities: STAFF_CAPABILITIES,
    },
    {
      role: "manager" as const,
      preset: "beverage_manager",
      providerCapabilities: [...MANAGER_CAPABILITIES].reverse(),
      canonicalCapabilities: MANAGER_CAPABILITIES,
    },
    {
      role: "owner" as const,
      preset: "site_owner",
      providerCapabilities: [...OWNER_CAPABILITIES].reverse(),
      canonicalCapabilities: OWNER_CAPABILITIES,
    },
    {
      role: "owner" as const,
      preset: "site_owner",
      providerCapabilities: [...GROUP_OWNER_CAPABILITIES].reverse(),
      canonicalCapabilities: GROUP_OWNER_CAPABILITIES,
    },
  ])("returns canonical $role capabilities", async ({
    role,
    preset,
    providerCapabilities,
    canonicalCapabilities,
  }) => {
    const harness = clientFor(Promise.resolve({
      data: [row({
        legacy_role: role,
        preset_key: preset,
        capabilities: providerCapabilities,
        raw_secret: "DO_NOT_RETAIN",
      })],
      error: null,
    }));

    const observation = await observeShadowSiteAccess(
      harness.client,
      RESTAURANT_ID,
      role,
    );

    expect(observation).toEqual({
      state: "resolved",
      value: {
        siteId: RESTAURANT_ID,
        workspaceId: WORKSPACE_ID,
        legacyRole: role,
        roleKey: preset,
        capabilities: [...canonicalCapabilities],
        accessSource: "explicit_site_membership",
      },
    });
    expect(observation.state).toBe("resolved");
    if (observation.state === "resolved") {
      expect(Object.isFrozen(observation.value.capabilities)).toBe(true);
      expect(observation.value.capabilities).not.toBe(providerCapabilities);
    }
    expect(JSON.stringify(observation)).not.toContain("DO_NOT_RETAIN");
  });

  it.each([
    { name: "two rows", rows: [row(), row()] },
    { name: "null row", rows: [null] },
    { name: "missing field", rows: [row({ workspace_id: undefined })] },
    { name: "bad restaurant UUID", rows: [row({ restaurant_id: "not-a-uuid" })] },
    { name: "bad workspace UUID", rows: [row({ workspace_id: "not-a-uuid" })] },
    { name: "cross-site row", rows: [row({ restaurant_id: OTHER_RESTAURANT_ID })] },
    { name: "wrong role", rows: [row({ legacy_role: "manager" })] },
    { name: "wrong preset", rows: [row({ preset_key: "beverage_manager" })] },
    { name: "wrong source", rows: [row({ access_source: "workspace_inherited" })] },
    { name: "non-array capabilities", rows: [row({ capabilities: "site.read" })] },
    { name: "missing capability", rows: [row({ capabilities: OWNER_CAPABILITIES.slice(0, -1) })] },
    { name: "duplicate capability", rows: [row({ capabilities: [...OWNER_CAPABILITIES, "site.read"] })] },
    { name: "unknown capability", rows: [row({ capabilities: [...OWNER_CAPABILITIES, "unknown"] })] },
  ])("rejects $name", async ({ rows }) => {
    const harness = clientFor(Promise.resolve({ data: rows, error: null }));
    await expect(
      observeShadowSiteAccess(harness.client, RESTAURANT_ID, "owner"),
    ).resolves.toEqual({ state: "unavailable", reason: "invalid_result" });
  });

  it.each([
    {
      role: "manager" as const,
      preset: "beverage_manager",
      canonicalCapabilities: MANAGER_CAPABILITIES,
      capabilities: [...MANAGER_CAPABILITIES, "group.manage"],
    },
    {
      role: "staff" as const,
      preset: "service_staff",
      canonicalCapabilities: STAFF_CAPABILITIES,
      capabilities: [...STAFF_CAPABILITIES, "inventory.manage"],
    },
  ])("rejects capabilities outside the selected $role role", async ({ role, preset, canonicalCapabilities, capabilities }) => {
    const valid = clientFor(Promise.resolve({
      data: [row({ legacy_role: role, preset_key: preset, capabilities: canonicalCapabilities })],
      error: null,
    }));
    await expect(
      observeShadowSiteAccess(valid.client, RESTAURANT_ID, role),
    ).resolves.toMatchObject({ state: "resolved", value: { legacyRole: role, roleKey: preset } });
    const harness = clientFor(Promise.resolve({
      data: [row({ legacy_role: role, preset_key: preset, capabilities })],
      error: null,
    }));
    await expect(
      observeShadowSiteAccess(harness.client, RESTAURANT_ID, role),
    ).resolves.toEqual({ state: "unavailable", reason: "invalid_result" });
  });

  it("rejects a valid row that contradicts the selected legacy role", async () => {
    const harness = clientFor(Promise.resolve({ data: [row()], error: null }));
    await expect(
      observeShadowSiteAccess(harness.client, RESTAURANT_ID, "manager"),
    ).resolves.toEqual({ state: "unavailable", reason: "invalid_result" });
  });
});

describe("observeShadowSiteAccess deadline", () => {
  it("returns at the one manual deadline, aborts, and does not await a stuck request", async () => {
    const never = new Promise<never>(() => undefined);
    const harness = clientFor(never);
    const deadline = manualDeadline();

    const pending = observeShadowSiteAccess(
      harness.client,
      RESTAURANT_ID,
      "owner",
      deadline.schedule,
    );
    deadline.fire();

    await expect(pending).resolves.toEqual({
      state: "unavailable",
      reason: "provider_error",
    });
    expect(harness.rpc).toHaveBeenCalledTimes(1);
    expect(harness.getSignal()?.aborted).toBe(true);
    expect(deadline.cancel).toHaveBeenCalledTimes(1);
  });

  it("cancels exactly once when the request resolves before the deadline", async () => {
    const harness = clientFor(Promise.resolve({ data: [], error: null }));
    const deadline = manualDeadline();

    await observeShadowSiteAccess(
      harness.client,
      RESTAURANT_ID,
      "owner",
      deadline.schedule,
    );

    expect(deadline.cancel).toHaveBeenCalledTimes(1);
    expect(harness.getSignal()?.aborted).toBe(false);
  });

  it("drains a late request rejection after timeout", async () => {
    const request = deferred<unknown>();
    const harness = clientFor(request.promise);
    const deadline = manualDeadline();
    const pending = observeShadowSiteAccess(
      harness.client,
      RESTAURANT_ID,
      "owner",
      deadline.schedule,
    );

    deadline.fire();
    await expect(pending).resolves.toEqual({
      state: "unavailable",
      reason: "provider_error",
    });
    request.reject(new Error("late rejection must be handled"));
    await Promise.resolve();
    await Promise.resolve();
  });

  it("ignores a canceled fake deadline fired after completion", async () => {
    const harness = clientFor(Promise.resolve({ data: [], error: null }));
    const deadline = manualDeadline();
    const observation = await observeShadowSiteAccess(
      harness.client,
      RESTAURANT_ID,
      "owner",
      deadline.schedule,
    );

    deadline.fire();

    expect(observation).toEqual({ state: "denied" });
    expect(harness.getSignal()?.aborted).toBe(false);
    expect(deadline.cancel).toHaveBeenCalledTimes(1);
  });
});
