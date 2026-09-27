// ARCH-013: single source of truth for "which restaurant is active
// for this user on this request". Previously getAuthContext (used by
// AppLayout to drive the nav + RestaurantProvider) used
// .limit(1).single() with no ordering, and requireMembership (used by
// every API route) used a cookie-first / created_at-DESC fallback.
// For a user with two memberships the two helpers could disagree,
// leaving the shell showing one restaurant while API calls targeted
// another. Both now route through resolveActiveMembership so they
// always pick the same one.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { readActiveRestaurantFromCookie } from "@/lib/api/active-restaurant";
import { parseCurrentOperationalMemberships } from "@/lib/auth/current-operational-memberships";
import {
  observeShadowSiteAccess,
  type ShadowLegacyRole,
  type ShadowSiteAccessObservation,
} from "@/lib/api/shadow-site-access";

export type MembershipRole = ShadowLegacyRole;

export type ResolvedMembership = {
  restaurantId: string;
  restaurantName: string;
  role: MembershipRole;
  shadowAccess: ShadowSiteAccessObservation;
};

type Client = SupabaseClient<Database>;

/**
 * Returns the active membership for `userId`, or `null` if the user
 * has no memberships. Resolution order:
 *   1. signed `active_restaurant_id` cookie (if the user still
 *      belongs to that restaurant),
 *   2. most recently created membership (deterministic tiebreaker:
 *      id DESC).
 *
 * The closed reader applies both membership parents' lifecycle rules and
 * returns restaurant names in deterministic fallback order.
 */
export async function resolveActiveMembership(
  supabase: Client,
  userId: string,
): Promise<ResolvedMembership | null> {
  let membershipsData: unknown = null;
  try {
    const { data, error } = await supabase.rpc(
      "read_current_operational_memberships",
      { p_user_id: userId },
    );
    if (error) return null;
    membershipsData = data;
  } catch {
    return null;
  }

  const memberships = parseCurrentOperationalMemberships(membershipsData);
  if (!memberships || memberships.length === 0) return null;

  const memberIds = memberships.map((m) => m.restaurant_id);
  const activeId = await readActiveRestaurantFromCookie(memberIds);

  const chosen =
    (activeId && memberships.find((m) => m.restaurant_id === activeId)) ||
    memberships[0];

  const shadowAccess = await observeShadowSiteAccess(
    supabase,
    chosen.restaurant_id,
    chosen.role,
  );

  return {
    restaurantId: chosen.restaurant_id,
    restaurantName: chosen.restaurant_name,
    role: chosen.role,
    shadowAccess,
  };
}
