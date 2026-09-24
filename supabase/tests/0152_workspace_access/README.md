# C04 Slice 1 workspace-access package

Status: promoted from the independently accepted frozen C04 draft. The forward and down
migration bytes are unchanged from the accepted package. Repository-only path and status
adaptations are limited to this README, the disposable harness, and the live-test header.
Local application and generated-artifact status belongs in the C04 integration proof,
not this reusable package description; production remains gated by the runbook.

The forward draft must run in one verified outer transaction. Its first executable
statements take fail-fast `NOWAIT` locks on `auth.users`, `restaurants`, and
`memberships` before any DDL. Applying 0152 therefore requires a short maintenance
window with auth/application writers drained. Old restaurant, signup, invitation, and
membership writers remain column-compatible **after commit**; this is not a claim that
the schema migration itself is zero-downtime.

The target migration operator is also an explicit gate. The same credential must pass
the bundled no-DDL catalog and lock preflight before apply. `current_user` must be the
direct shared owner of the altered tables and existing signup function; inherited-only
ownership is deliberately rejected because it splits the preserved security-definer
owner from newly created objects. A login that is a member of the owner role must
explicitly `SET ROLE` before both preflight and apply. The gate also covers schema,
`auth.users` reference/runtime-read, auth-row RLS visibility, helper/type/language, and
direction-specific lock rights. It requires either superuser or `BYPASSRLS` for correct
auth-row visibility while accepting neither that flag nor inherited-role facts as
ownership substitutes. Do not assume a role named `postgres` owns or may lock
`auth.users`, and do not grant broader privileges ad hoc. The disposable clone's
privileged main rehearsal proves the SQL and concurrency contract under its recorded
executor; separate non-superuser fixtures prove the catalog gate mechanics, not hosted
operator readiness.

## Files

- `supabase/migrations/0152_workspace_access_foundation.sql` — additive shadow foundation.
- `supabase/migrations/down/0152_workspace_access_foundation.down.sql` — transactionally guarded legacy rollback.
- `scripts/0152-production-preflight.sql` — read-only same-executor catalog and direction-specific
  `NOWAIT` lock gate for the production runbook.
- `src/domains/auth/workspace-access-live.test.ts` — local-loopback live database suite.
- `workspace-access-conservation-legacy.sql` — the identical read-only legacy count and
  identity capture run before/after migration and compared byte-for-byte.
- `workspace-access-containment-after.sql` — read-only post-migration containment,
  validation, and privilege assertions.
- `workspace-access-state-fingerprint.sql` — read-only atomic-refusal fingerprint.
- `workspace-access-preflight-fingerprint.sql` — pre-0152 catalog/data fingerprint for
  proving lock refusal happens before partial DDL.
- `workspace-access-post-up-acceptance.sql` — disposable-PG17 SQL assertions for exact
  capability, implicit-access, and privilege behavior.
- `workspace-access-explain.sql` — captured `EXPLAIN (ANALYZE, BUFFERS)` for all three
  shadow helpers on the post-up multi-site fixture.
- `scripts/local/workspace-access-down-rehearsal.sh` — guarded disposable-PG17 orchestration.
- `docs/runbooks/production-migrations.md` — maintenance-window and operator contract.

The SQL proof assets named without a prefix above live in this directory.

## Exact shadow boundary

- `workspaces` is the only group boundary; `restaurants` remains the site/operational
  tenant.
- Existing `memberships` remains the only explicit site grant.
- Workspace membership never implies site access.
- Existing membership helpers, RLS, routes, cookies, roles, and costs remain
  authoritative. Revocation/expiry and capabilities are observational in Slice 1.
- No group/site-grant table, custom role, role assignment endpoint, cost projection, or
  active capability enforcement is introduced.
- The one-time restaurant link backfill preserves `restaurants.updated_at`; it does not
  manufacture a tenant-wide edit timestamp.

## Deletion lifecycle resolution

Routine singleton deletion and meaningful group state have different outcomes:

1. The restaurant delete locks its workspace.
2. Cleanup is allowed only for `workspace.id = restaurant.id`, `expanded_at IS NULL`, no sibling site, and
   workspace/site membership rows with default lifecycle state and exactly derivable
   governance.
3. The BEFORE trigger removes those derived child rows; the AFTER trigger removes the
   workspace only after the site is gone, `expanded_at IS NULL`, and both child counts
   are zero.
4. A non-identity site sets `workspaces.expanded_at` once and it is never cleared, so
   deleting that child first cannot erase the former-group evidence. Former groups,
   group-only members, `group_admin`, or non-default status/expiry state
   preserve an intentional empty workspace. The guarded down refuses it.
5. The memberships-to-workspace-memberships FK is `ON DELETE NO ACTION`, so an auth-user
   delete can finish both same-statement cascades without weakening standalone referential
   integrity.
6. `memberships.granted_by` remains caller-immutable, but its trigger permits the FK's
   non-null-to-null update only after the referenced auth user has actually been deleted.
7. After 0152 commits, legacy membership insert locks restaurant then workspace, matching cleanup. Identity
   retargeting is rejected after the one-time nullable-link backfill; grant moves use
   delete+insert. Provenance-only FK nulling returns before either parent lock.

Migration-time table locks are deliberately separate from that post-commit row-lock
order. Reversing the two `ALTER TABLE` statements alone is unsafe: it merely moves the
wait cycle from a direct membership insert to signup's restaurant-then-membership path.
The opening `NOWAIT` locks make any conflicting application/auth activity a clean
pre-DDL refusal instead.

This is compatibility for the existing restaurant-delete path, not a new account-erasure
or group-administration API. User IDs are never deleted by restaurant cleanup.

## Acceptance ownership

| Case | Draft proof owner |
|---|---|
| 1 backfill/containment conservation | live DB test plus migration pre/post count capture |
| 2 signup and reason codes | live DB test |
| 3 metadata escalation | live DB test |
| 4 old restaurant insert | live DB test |
| 5 old service/auth membership inserts | live DB test |
| 6 current invite flow | existing route test plus a future live route integration test |
| 7 legacy role/update/delete behavior | current focused team/auth suite plus live legacy helper assertions |
| 8 cross-user mismatch | live DB test |
| 9 cross-workspace mismatch | live DB test |
| 10 personal misuse | live DB test |
| 11 reassignment guard, auth and service | live DB test; deliberately not another ledger assertion |
| 12 safe singleton owner-route deletion | live DB service-path test plus existing owner-route authorization test |
| 13 meaningful/last-site/non-default preservation | live DB tests plus guarded-down rehearsal |
| 14 user-first/granter auth deletion | live DB cascade and provenance tests plus standalone referenced-WM deletion rejection |
| 15 no implicit group access | live DB test |
| 16 shadow revocation honesty | paired live shadow-deny and legacy-allow assertions |
| 17 exact fixed capabilities | live DB test |
| 18 privilege boundary | live DB direct Data API test |
| 19 cookie/fallback unchanged | application resolver/setter focused tests; not a DB-only claim |
| 20 concurrent old membership insert/delete | live DB duplicate test plus both restaurant-delete race orderings |
| 21 clean down/up and refusal fixtures | isolated PG17 rehearsal, never the active local DB |
| 22 regression/generated artifacts | Node 20 full gates after promotion/application |

## Required isolated down/up rehearsal

Use a disposable PG17 database restored from the same pre-0152 migration state. Do not
run the down concurrently with application traffic or wrap its explicit transaction in a
second `--single-transaction` wrapper.

The rehearsal must prove:

1. Clean singleton/default state: up, down, up succeeds with IDs and legacy rows intact.
2. Each fixture independently refuses before mutation: personal workspace; two-site
   workspace; preserved empty/former-group workspace; group-only member; `group_admin`;
   non-default workspace status/expiry/revocation; non-default site
   status/expiry/revocation; non-null `created_by`/`granted_by`; non-derivable governance; mismatched
   link.
3. Safe singleton deletion leaves no workspace residue and does not poison a later down.
4. Failed downs preserve both tables, all new columns/functions/triggers, and fixture data.
5. A direct membership writer and a signup/restaurant writer each make the forward
   migration refuse with lock-not-available before any DDL; the complete pre-0152
   catalog/data fingerprint remains byte-identical after each attempt.
6. An `auth.users` writer makes the down refuse with SQLSTATE `55P03` before any guard or
   DDL; the complete post-0152 catalog/data fingerprint remains byte-identical.
7. Non-superuser fixtures prove inherited owner-role DDL works but is deliberately
   rejected, explicit shared-owner `SET ROLE` completes baseline signup plus full
   up/signup/down, and the preflight deterministically refuses missing direct table or
   signup-function ownership, public-schema `CREATE`, `auth.users` `REFERENCES` or
   runtime `SELECT`, or auth-row RLS bypass despite a successful table-lock probe.

## Mandatory independent SQL-review focus

- Verify trigger and FK-cascade ordering for restaurant-first and user-first deletes.
- Probe restaurant deletion racing a child restaurant and a workspace-member insert.
- Probe both orderings of restaurant deletion racing a legacy site-membership insert;
  require no deadlock and no partial workspace/member state.
- Probe restaurant deletion racing auth-user deletion; any deadlock or partial child
  cleanup is a blocker.
- Confirm the workspace lock blocks FK `KEY SHARE` child inserts and that every lock path
  has a consistent bounded order.
- Confirm generated-column composite FK behavior rejects a personal workspace even for
  service role.
- Confirm no authenticated base-table privilege was inherited through `PUBLIC`.
- Run `EXPLAIN (ANALYZE, BUFFERS)` for each shadow helper on a multi-site fixture after
  indexes exist; no unbounded per-row security-definer scan is accepted.

The draft omits the previously proposed unused `restaurants(id, workspace_id)` and
`workspace_memberships(id, workspace_id, user_id)` uniques. It retains only the consumed
`workspaces(id, kind)` constraint and the business identity
`workspace_memberships(workspace_id, user_id)`.
