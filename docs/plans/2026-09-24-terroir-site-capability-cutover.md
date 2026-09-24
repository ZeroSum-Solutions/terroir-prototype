# Terroir site-capability authority and pricing cutover

**Date:** 2026-09-24
**Status:** accepted canonical source; unimplemented
**Workstream:** C04, bounded first authority leaf
**Implementation authority:** source preparation only; no migration number, runtime activation, hosted change, purchase, release, or production approval

## Accepted outcome

This design defines the first authoritative C04 leaf:

1. explicit capability grants on current exact-site memberships;
2. identity-bound evaluation and workspace-governed grant replacement; and
3. one sealed cost surface, materialized pricing recommendations.

An active workspace membership, governance role, legacy site role, active-site cookie,
or shadow observation does not grant a site operation. Every protected request derives
`auth.uid()`, joins the exact current site membership to its current workspace
membership, compares the stored grant snapshots with the complete live identity chain,
matches both database-owned lifecycle generations, and checks the exact grant. The
system does not cache a positive authorization decision.

This leaf does not complete C04. C04 still requires the broader role and operational
capability set, remaining raw and derived cost surfaces, legacy role and RLS cutover,
partial-group cost refusal, administration UI, and the full two-site and three-role
browser proof. No part of this plan implements C14.

## Authority vocabulary and governance

The fixed vocabulary for this leaf contains only:

```text
cost.read
margin.read
pricing.manage
```

Unknown keys deny. No `pilot.measurement.*` key enters this authority leaf. A future
capability requires an additive source decision with a real consumer; this plan does not
reserve it.

Only a current `workspace_owner` or `group_admin` in the target site's workspace may
replace a member's capability set. The database derives the caller from `auth.uid()`.
Governance does not confer site access. `team.site.manage` is not an alternate path.
Delegated site administration remains unresolved until the owner approves its
escalation boundary.

## Sealed, durable grant history

Migration A will add a service-private append-history table named
`membership_capability_grants` with these value snapshots:

```text
id
workspace_id
restaurant_id
workspace_membership_id
membership_id
subject_user_id
site_lifecycle_generation
workspace_lifecycle_generation
capability_key
granted_at
granted_by_user_id
grant_reason
source = workspace_governance
expires_at timestamptz null
revoked_at
revoked_by_user_id
revoke_reason
revoke_cause
```

The snapshot identity columns have no foreign keys to memberships or `auth.users`.
Deletion must not erase attribution. This plan does not select a retention duration.

`expires_at` is immutable and separate from both parent membership expiries. A grant row
is current only while `revoked_at is null`. It is effective only when it is current,
unexpired, both parent memberships are current, both captured generations match, and
the complete live identity chain matches. Replacement first retires an expired but
unrevoked row, then appends a fresh row.

A partial unique index on `(membership_id, capability_key) where revoked_at is null`
allows at most one unrevoked row for an exact member and key. Identity, grant, and expiry
fields never change. Revocation fields move once from null to their final values.

Immediately after table creation, the migration revokes table privileges from
`PUBLIC`, `anon`, `authenticated`, and `service_role`. It grants no direct table
privilege back. Reviewed definer functions and lifecycle triggers are the only writers;
authenticated callers receive only the required function `EXECUTE` privileges.

## Live identity and lifecycle predicate

Every effective-grant query evaluates these equalities together:

```text
grant.membership_id = membership.id
grant.subject_user_id = auth.uid() = membership.user_id
grant.restaurant_id = membership.restaurant_id = restaurant.id
grant.workspace_membership_id = membership.workspace_membership_id
grant.workspace_membership_id = workspace_membership.id
grant.subject_user_id = workspace_membership.user_id
grant.workspace_id = workspace_membership.workspace_id
grant.workspace_id = restaurant.workspace_id
workspace_membership.user_id = membership.user_id
workspace_membership.workspace_id = restaurant.workspace_id
```

The query also requires the captured site and workspace lifecycle generations to equal
their live parents. Any mismatch denies authority, including a mismatch introduced by a
trusted maintenance path. `effective_site_ids` and the pricing reader must reuse this
predicate and may not recreate a weaker join.

`workspace_memberships.governance_role` controls the caller's administrative authority.
It is not subject identity. Replacement locks and rechecks it. Changing it does not
rotate grants held by that membership's subject. Changes to `workspace_id` or `user_id`
do rotate them.

## Database-owned generation and retirement

Migration A will add a UUID `lifecycle_generation NOT NULL DEFAULT
gen_random_uuid()` column to both membership parents. Owner-controlled triggers enforce
these rules:

- INSERT overwrites any submitted generation with a fresh database value.
- A submitted generation change on UPDATE is rejected before mutation.
- A site-membership change to `status`, `revoked_at`, `expires_at`, `user_id`,
  `restaurant_id`, or `workspace_membership_id` rotates the generation and retires
  current grants before the new lifecycle or identity can become effective.
- A workspace-membership change to `status`, `revoked_at`, `expires_at`, `user_id`, or
  `workspace_id` rotates its generation and retires current grants for every linked site
  membership.
- DELETE retires current grants before the parent disappears.

Both rotation checks use plain `BEFORE UPDATE` triggers with `IS DISTINCT FROM`, not
`UPDATE OF` column lists. The site trigger name must sort after the existing
`memberships_link_workspace` trigger so PostgreSQL evaluates the finalized `NEW`
identity and workspace link. The existing migration-0152 identity guards remain in
place and reject ordinary identity repoints. The wider rotation set supplies defense in
depth for an admitted, reviewed future transition. A rejected update changes neither a
generation nor grant history.

## Shared child-lock order

Every retirement path calls one shared helper and locks the entire matching unrevoked
child set in this order:

```text
membership_id ASC, capability_key ASC, id ASC
```

The helper captures the locked IDs and updates only captured rows that still have
`revoked_at is null`. Site lifecycle, workspace lifecycle, identity transition,
governed replacement, and expired-row replacement all use this helper. A waiting path
cannot overwrite the first final retirement.

Neither lifecycle trigger acquires the other mutable parent, or any new parent, after
holding its own update target. Governed replacement locks and rechecks in this order:

1. target workspace;
2. caller and target workspace memberships, ordered by UUID;
3. target site membership; and
4. current grants through the shared child helper.

After those locks, replacement rechecks governance, target containment, lifecycle,
generations, and every live identity equality.

## Evaluators and the pricing boundary

Migration A will add definer RPCs with fixed `search_path`, exact owners, no default
`PUBLIC` execute, and only explicit execute grants:

- `effective_site_capability(p_restaurant_id, p_capability_key)` evaluates the complete
  current, expiry, generation, and live-identity predicate.
- `effective_site_ids(p_capability_key)` returns only sites that pass the same predicate.
- `replace_member_site_capabilities(...)` performs the governance transaction.
- `read_pricing_recommendations(p_restaurant_id)` requires both `cost.read` and
  `margin.read` and returns the current validated reader shape.

The pricing RPC authorizes `p_restaurant_id`, filters recommendations to that site, and
joins wine identity on both tenant keys:

```text
wines.id = pricing_recommendations.wine_id
AND wines.restaurant_id = pricing_recommendations.restaurant_id
```

This join excludes a malformed service-written cross-tenant pair without relying on
`wines` RLS. It uses the existing `(wines.id, wines.restaurant_id)` uniqueness and adds
no speculative composite pricing foreign key.

The RPC preserves the product reader contract exactly:

```text
ORDER BY class ASC, computed_at DESC, wine_id ASC
```

The order is total because `(restaurant_id, wine_id)` is unique. The application keeps
1,000-row range paging until a short page. Parity tests compare the legacy direct reader
with the RPC over more than 1,000 valid rows, including page boundaries and equal
class/time ties. Parsed rows and order must match byte for byte, with no omissions or
duplicates.

The recompute route must prove `pricing.manage` before constructing its service-role
client. Contract B changes only authenticated base-table SELECT. It preserves these
trusted paths:

1. recompute service-role read, write, and delete;
2. the import cleanup reference read;
3. `public.merge_wines`; and
4. the local operational seeder's reuse of recompute.

`public.merge_wines` keeps both current outcomes. A same-restaurant source-only pricing
row repoints to the target wine. When source and target already have pricing rows, the
existing unique `(restaurant_id, wine_id)` constraint raises SQLSTATE `23505`. A
cross-restaurant merge remains rejected before the pricing update. Cutover tests must
pin all three cases and must not promise unconditional repoint success.

## Expand, compatible application, contract

Future migration numbers are unreserved. Select collision-free numbers only after the
C06 checkpoint and a current manifest freeze.

### Additive migration A

Add the sealed grant history, lifecycle generations and triggers, shared retirement
helper, live-identity predicate, four RPCs, ACLs, indexes, and database tests. Keep the
existing authenticated pricing SELECT policy and privilege. Old application code can
continue to read pricing and change or delete memberships. Existing 0152 guards keep
rejecting ordinary identity repoints.

### Compatible application release

1. Apply A through the reviewed production-migration procedure.
2. Deploy only the reviewed capability-administration endpoint. Keep legacy pricing
   read and recompute authority unchanged.
3. Validate real pricing delegates. Current workspace governance then creates explicit
   grants. Do not derive or backfill production grants from legacy roles.
4. Deploy the compatible application: the pricing reader uses the RPC and the recompute
   route proves `pricing.manage` before constructing a service client.
5. Prove positive and negative behavior while legacy SELECT remains rollback
   compatibility.

### Contract migration B

Apply B only after an operator receipt identifies the compatible release and preflight
proves the expected RPCs, ACLs, policy, grants, and identity predicate. B removes the
authenticated base-table SELECT privilege and member policy.

Rollback runs B down first to restore the exact legacy SELECT privilege and policy,
then rolls back the application. Migration A and its history stay in place. A down must
refuse while B, grant history, or dependent objects exist. No source promotion grants
permission to apply A or B, activate a permission, alter hosted data, or promote a
release.

## Candidate implementation paths

These paths are conditional and do not reserve migration numbers:

```text
supabase/migrations/<next>_site_capability_authority.sql
supabase/migrations/down/<next>_site_capability_authority.down.sql
supabase/migrations/<next+1>_pricing_recommendation_capability_seal.sql
supabase/migrations/down/<next+1>_pricing_recommendation_capability_seal.down.sql
scripts/<next>-production-preflight.sql
scripts/<next+1>-production-preflight.sql
supabase/tests/<next>_site_capability_authority/*
supabase/tests/<next+1>_pricing_recommendation_capability_seal/*
supabase/schema.snapshot.sql
src/types/database.ts
src/lib/api/site-capability.ts
src/lib/api/site-capability.test.ts
src/app/api/team/members/[id]/capabilities/route.ts
src/app/api/team/members/[id]/capabilities/route.test.ts
src/lib/pricing-recommendations/fetch.ts
src/lib/pricing-recommendations/fetch.test.ts
src/app/api/pricing-recommendations/recompute/route.ts
src/app/api/pricing-recommendations/recompute/route.test.ts
src/domains/auth/site-capability-authority-live.test.ts
src/test/contracts/database-contracts.test.ts
docs/ARCHITECTURE.md
docs/runbooks/production-migrations.md
```

Leave the existing EV-9.1 job-write-only assertion unchanged. Add a separate post-B
assertion for authenticated SELECT denial and the exact RPC and table ACLs. Older 0152
and EV-9.1 contracts cannot stand in for cutover proof.

## Acceptance before a production cutover

1. A capability grant for site A1 never reaches A2. Governance without an exact-site
   grant reaches neither site.
2. Seeded mismatches in subject user, restaurant, workspace-membership link, workspace
   ID, or workspace-member user deny authority even when grant, generation, and
   lifecycle state would otherwise pass.
3. An authenticated legacy owner attempts to repoint `memberships.user_id`,
   `restaurant_id`, and `workspace_membership_id`. Each 0152 guard refuses without
   changing the parent, generation, or grant history. The original live identity keeps
   its grant.
4. Authenticated workspace-membership mutation remains denied by ACL. Trusted-role
   changes to `workspace_memberships.user_id` or `workspace_id` remain refused by 0152
   without mutation. The generation trigger contract still names both fields.
5. A governance-role removal racing with replacement resolves through the locked caller
   row and recheck. It does not repoint subject identity.
6. Tests cover grant expiry, revoke and reactivate, direct generation forgery, ledger
   DML denial, partial uniqueness, deletion-resistant history, and immutable retirement.
7. Simultaneous site and workspace revocation for a subject with at least two grants
   commits without `40P01`, leaves every grant ineffective, and records one final
   retirement per original row.
8. The pricing tenant join rejects a service-written cross-tenant wine pair.
9. More than 1,000 valid pricing rows prove exact three-key ordering and page parity with
   the legacy reader.
10. Contract-B conservation proves recompute read, write, and delete; the import
    reference read; same-restaurant `public.merge_wines` source-only repoint; existing
    `23505` when both wines already have pricing rows; and cross-restaurant refusal.
11. A new post-B privilege assertion proves direct authenticated SELECT denial and the
    exact ledger and RPC ACLs while older EV-9.1 and 0152 assertions stay byte-identical.
12. B down restores only the exact legacy policy and privilege before application
    rollback. A down refuses with history or dependents. Refusal paths do not mutate.
13. Focused unit and live suites, static checks, generated-artifact gates, migration
    manifest/down/snapshot checks, exact-path diff checks, security review, and an
    independent database review pass on the frozen source set.

## Open decisions and required later work

- Real pricing delegates, sites, expiry expectations, and reasons still require
  validation.
- Delegated site administration has no selected rule.
- Retention duration remains unresolved.
- Migration numbers depend on the C06 checkpoint and current manifest.
- Full C04 still requires remaining cost surfaces, partial-group cost refusal, legacy
  authorization replacement, broader operational capabilities, role-aware UI, and the
  two-site and three-role browser proof.

These are not source-promotion blockers. They remain implementation, validation, or
owner-decision gates and may not be reported as completed facts.

## Acceptance provenance

This canonical source promotes the accepted design from the following immutable review
artifacts:

- authoritative v5 proposal, SHA-256
  `f8d045a616ebd77325d3dc4a3cb804125fae94b2a112b764580e5268aaecb8a5`;
- independent database closure review, SHA-256
  `d7c1b946e2bd06d288312b855dfe6be25a809a7bfbebaf863f5ed58ad40daf2f`;
- independent Opus review, SHA-256
  `1e87ab5f668cb53a0b3042c44ccedf1f201788f0c4b9c55d46e88f1aecfb673f`.

All three accepted the design boundary. None provides runtime, database, hosted,
provider, release, or C04-completion evidence.
