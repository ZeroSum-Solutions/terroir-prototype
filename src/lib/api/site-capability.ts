import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

export type SitePricingAccess = {
  canReadCost: boolean;
  canReadMargin: boolean;
  canManagePricing: boolean;
};

export const SITE_CAPABILITY_DEADLINE_MS = 750;

type SiteCapability = "cost.read" | "margin.read" | "pricing.manage";

export class SiteCapabilityResolutionError extends Error {
  constructor(options?: { cause?: unknown }) {
    super("Site capability evaluation failed.", options);
    this.name = "SiteCapabilityResolutionError";
  }
}

const DEADLINE = Symbol("site-capability-deadline");

async function hasExactSiteCapability(
  client: SupabaseClient<Database>,
  restaurantId: string,
  capability: SiteCapability,
): Promise<boolean> {
  const controller = new AbortController();
  let resolveDeadline!: (value: typeof DEADLINE) => void;
  const deadline = new Promise<typeof DEADLINE>((resolve) => {
    resolveDeadline = resolve;
  });
  const handle = setTimeout(() => {
    controller.abort();
    resolveDeadline(DEADLINE);
  }, SITE_CAPABILITY_DEADLINE_MS);

  try {
    const builder = client.rpc("effective_site_capability", {
      p_restaurant_id: restaurantId,
      p_capability_key: capability,
    });
    const request = Promise.resolve(builder.abortSignal(controller.signal));
    const result = await Promise.race([request, deadline]);
    if (result === DEADLINE) {
      throw new SiteCapabilityResolutionError();
    }
    const { data, error } = result;
    if (error != null || typeof data !== "boolean") {
      throw new SiteCapabilityResolutionError({ cause: error });
    }
    return data;
  } catch (error) {
    if (error instanceof SiteCapabilityResolutionError) throw error;
    throw new SiteCapabilityResolutionError({ cause: error });
  } finally {
    clearTimeout(handle);
  }
}

/**
 * Resolves the accepted C04 exact-site pricing authority for this request.
 * A boolean false is an explicit restricted state. Transport, RPC, timeout, and
 * malformed-result failures remain errors so callers cannot misreport an
 * authorization outage as an absent grant.
 */
export async function resolveSitePricingAccess(
  client: SupabaseClient<Database>,
  restaurantId: string,
): Promise<SitePricingAccess> {
  const [canReadCost, canReadMargin, canManagePricing] = await Promise.all([
    hasExactSiteCapability(client, restaurantId, "cost.read"),
    hasExactSiteCapability(client, restaurantId, "margin.read"),
    hasExactSiteCapability(client, restaurantId, "pricing.manage"),
  ]);

  return { canReadCost, canReadMargin, canManagePricing };
}

/** Resolves only the exact cost.read authority needed by a cost-only route. */
export function resolveSiteCostReadAccess(
  client: SupabaseClient<Database>,
  restaurantId: string,
): Promise<boolean> {
  return hasExactSiteCapability(client, restaurantId, "cost.read");
}

/** Resolves only the exact margin.read authority needed by a margin-only route. */
export function resolveSiteMarginReadAccess(
  client: SupabaseClient<Database>,
  restaurantId: string,
): Promise<boolean> {
  return hasExactSiteCapability(client, restaurantId, "margin.read");
}

/** Resolves the two read grants required by mixed cost-and-margin output. */
export async function resolveSitePricingReadAccess(
  client: SupabaseClient<Database>,
  restaurantId: string,
): Promise<boolean> {
  const [canReadCost, canReadMargin] = await Promise.all([
    hasExactSiteCapability(client, restaurantId, "cost.read"),
    hasExactSiteCapability(client, restaurantId, "margin.read"),
  ]);
  return canReadCost && canReadMargin;
}
