import { z } from "zod";

const CurrentOperationalMembershipSchema = z.object({
  restaurant_id: z.uuid().transform((value) => value.toLowerCase()),
  restaurant_name: z.string(),
  role: z.enum(["owner", "manager", "staff"]),
}).strict();

const CurrentOperationalMembershipsSchema = z.array(
  CurrentOperationalMembershipSchema,
);

export type CurrentOperationalMembership = z.infer<
  typeof CurrentOperationalMembershipSchema
>;

/**
 * Validates the complete result of read_current_operational_memberships.
 * A valid empty result stays distinct from a malformed or null response so
 * the resolver can fail closed without treating provider failure as absence.
 */
export function parseCurrentOperationalMemberships(
  value: unknown,
): CurrentOperationalMembership[] | null {
  const parsed = CurrentOperationalMembershipsSchema.safeParse(value);
  if (!parsed.success) return null;

  const siteIds = new Set<string>();
  for (const membership of parsed.data) {
    if (siteIds.has(membership.restaurant_id)) return null;
    siteIds.add(membership.restaurant_id);
  }

  return parsed.data;
}
