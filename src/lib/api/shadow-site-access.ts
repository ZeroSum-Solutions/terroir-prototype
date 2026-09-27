import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

export const SHADOW_SITE_ACCESS_DEADLINE_MS = 750;

const STAFF_CAPABILITIES = Object.freeze(["site.read", "inventory.service"] as const);
const MANAGER_CAPABILITIES = Object.freeze([
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
] as const);
const OWNER_CAPABILITIES = Object.freeze([
  ...MANAGER_CAPABILITIES,
  "team.site.manage",
] as const);
const GROUP_OWNER_CAPABILITIES = Object.freeze([
  ...OWNER_CAPABILITIES,
  "group.manage",
] as const);

export type ShadowCapability = (typeof GROUP_OWNER_CAPABILITIES)[number];
export type ShadowLegacyRole = "owner" | "manager" | "staff";

export type ShadowSiteAccessObservation =
  | {
      state: "resolved";
      value: {
        siteId: string;
        workspaceId: string;
        legacyRole: ShadowLegacyRole;
        roleKey: "site_owner" | "beverage_manager" | "service_staff";
        capabilities: readonly ShadowCapability[];
        accessSource: "explicit_site_membership";
      };
    }
  | { state: "denied" }
  | {
      state: "unavailable";
      reason: "provider_error" | "invalid_result";
    };

export type ScheduleShadowDeadline = (
  callback: () => void,
  delayMs: number,
) => () => void;

const scheduleDefaultDeadline: ScheduleShadowDeadline = (callback, delayMs) => {
  const handle = setTimeout(callback, delayMs);
  return () => clearTimeout(handle);
};

const DEADLINE = Symbol("shadow-site-access-deadline");
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type RequestOutcome =
  | { kind: "result"; value: unknown }
  | { kind: "request_error" };

export async function observeShadowSiteAccess(
  supabase: SupabaseClient<Database>,
  restaurantId: string,
  selectedRole: ShadowLegacyRole,
  scheduleDeadline: ScheduleShadowDeadline = scheduleDefaultDeadline,
): Promise<ShadowSiteAccessObservation> {
  const controller = new AbortController();
  let completed = false;
  let timedOut = false;
  let resolveDeadline!: (value: typeof DEADLINE) => void;
  const deadline = new Promise<typeof DEADLINE>((resolve) => {
    resolveDeadline = resolve;
  });
  let cancelDeadline: (() => void) | undefined;

  try {
    cancelDeadline = scheduleDeadline(() => {
      if (completed) return;
      timedOut = true;
      controller.abort();
      resolveDeadline(DEADLINE);
    }, SHADOW_SITE_ACCESS_DEADLINE_MS);

    const builder = supabase.rpc("shadow_effective_site_access", {
      p_restaurant_id: restaurantId,
    });
    const request = builder.abortSignal(controller.signal);
    const guardedRequest: Promise<RequestOutcome> = Promise.resolve(request).then(
      (sdkResult): RequestOutcome => ({ kind: "result", value: sdkResult as unknown }),
      (): RequestOutcome => ({ kind: "request_error" }),
    );

    const outcome = await Promise.race([guardedRequest, deadline]);
    if (outcome === DEADLINE || timedOut) return providerError();
    if (outcome.kind === "request_error") return providerError();

    const observation = normalizeResult(outcome.value, restaurantId, selectedRole);
    return timedOut ? providerError() : observation;
  } catch {
    return providerError();
  } finally {
    completed = true;
    cancelDeadline?.();
  }
}

function normalizeResult(
  sdkResult: unknown,
  restaurantId: string,
  selectedRole: ShadowLegacyRole,
): ShadowSiteAccessObservation {
  if (!isRecord(sdkResult) || Array.isArray(sdkResult)) return invalidResult();
  if (!hasOwn(sdkResult, "data") || !hasOwn(sdkResult, "error")) {
    return invalidResult();
  }

  const error: unknown = sdkResult.error;
  if (error !== null) {
    return isRecord(error) && !Array.isArray(error)
      ? providerError()
      : invalidResult();
  }

  const data: unknown = sdkResult.data;
  if (!Array.isArray(data)) return invalidResult();
  if (data.length === 0) return { state: "denied" };
  if (data.length !== 1) return invalidResult();

  return normalizeRow(data[0], restaurantId, selectedRole);
}

function normalizeRow(
  candidate: unknown,
  restaurantId: string,
  selectedRole: ShadowLegacyRole,
): ShadowSiteAccessObservation {
  if (!isRecord(candidate) || Array.isArray(candidate)) return invalidResult();
  const required = [
    "restaurant_id",
    "workspace_id",
    "legacy_role",
    "preset_key",
    "capabilities",
    "access_source",
  ] as const;
  if (required.some((key) => !hasOwn(candidate, key))) return invalidResult();

  const siteId: unknown = candidate.restaurant_id;
  const workspaceId: unknown = candidate.workspace_id;
  const legacyRole: unknown = candidate.legacy_role;
  const roleKey: unknown = candidate.preset_key;
  const capabilities: unknown = candidate.capabilities;
  const accessSource: unknown = candidate.access_source;

  if (
    typeof siteId !== "string" ||
    typeof workspaceId !== "string" ||
    !UUID_PATTERN.test(siteId) ||
    !UUID_PATTERN.test(workspaceId) ||
    siteId !== restaurantId ||
    legacyRole !== selectedRole ||
    accessSource !== "explicit_site_membership"
  ) {
    return invalidResult();
  }

  const normalizedCapabilities = normalizeCapabilities(
    capabilities,
    selectedRole,
  );
  const expectedRoleKey = roleKeyFor(selectedRole);
  if (!normalizedCapabilities || roleKey !== expectedRoleKey) {
    return invalidResult();
  }

  return {
    state: "resolved",
    value: {
      siteId,
      workspaceId,
      legacyRole: selectedRole,
      roleKey: expectedRoleKey,
      capabilities: normalizedCapabilities,
      accessSource: "explicit_site_membership",
    },
  };
}

function normalizeCapabilities(
  value: unknown,
  role: ShadowLegacyRole,
): readonly ShadowCapability[] | null {
  if (role === "staff") {
    return matchesExactSet(value, STAFF_CAPABILITIES) ? STAFF_CAPABILITIES : null;
  }
  if (role === "manager") {
    return matchesExactSet(value, MANAGER_CAPABILITIES) ? MANAGER_CAPABILITIES : null;
  }
  if (matchesExactSet(value, GROUP_OWNER_CAPABILITIES)) {
    return GROUP_OWNER_CAPABILITIES;
  }
  return matchesExactSet(value, OWNER_CAPABILITIES) ? OWNER_CAPABILITIES : null;
}

function matchesExactSet(
  value: unknown,
  expected: readonly ShadowCapability[],
): boolean {
  if (!Array.isArray(value) || value.length !== expected.length) return false;
  if (!value.every((item): item is string => typeof item === "string")) return false;
  const actual = new Set(value);
  return actual.size === expected.length && expected.every((item) => actual.has(item));
}

function roleKeyFor(role: ShadowLegacyRole) {
  if (role === "owner") return "site_owner" as const;
  if (role === "manager") return "beverage_manager" as const;
  return "service_staff" as const;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function hasOwn(value: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function providerError(): ShadowSiteAccessObservation {
  return { state: "unavailable", reason: "provider_error" };
}

function invalidResult(): ShadowSiteAccessObservation {
  return { state: "unavailable", reason: "invalid_result" };
}
