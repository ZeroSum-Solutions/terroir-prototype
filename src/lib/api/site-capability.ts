import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

export type SitePricingAccess = {
  canReadCost: boolean;
  canReadMargin: boolean;
  canManagePricing: boolean;
};

export const SITE_CAPABILITY_DEADLINE_MS = 750;

type SiteCapability = "cost.read" | "margin.read" | "pricing.manage";

type CapabilityRpcClient = {
  rpc: (
    name: "effective_site_capability",
    args: { p_restaurant_id: string; p_capability_key: SiteCapability },
  ) => {
    abortSignal: (
      signal: AbortSignal,
    ) => PromiseLike<{ data: unknown; error: unknown }>;
  };
};

const DEADLINE = Symbol("site-capability-deadline");

async function hasExactSiteCapability(
  client: CapabilityRpcClient,
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
    const request = Promise.resolve(builder.abortSignal(controller.signal)).catch(
      () => null,
    );
    const result = await Promise.race([request, deadline]);
    if (result === DEADLINE || result == null) return false;
    const { data, error } = result;
    return error == null && data === true;
  } catch {
    return false;
  } finally {
    clearTimeout(handle);
  }
}

/**
 * Resolves the accepted C04 exact-site pricing authority for this request.
 * The cast is intentionally isolated because migration 0154 has not generated
 * client types yet. An absent RPC, database error, or non-boolean result denies.
 */
export async function resolveSitePricingAccess(
  client: SupabaseClient<Database>,
  restaurantId: string,
): Promise<SitePricingAccess> {
  const rpcClient = client as unknown as CapabilityRpcClient;
  const [canReadCost, canReadMargin, canManagePricing] = await Promise.all([
    hasExactSiteCapability(rpcClient, restaurantId, "cost.read"),
    hasExactSiteCapability(rpcClient, restaurantId, "margin.read"),
    hasExactSiteCapability(rpcClient, restaurantId, "pricing.manage"),
  ]);

  return { canReadCost, canReadMargin, canManagePricing };
}
