# 0154 C04 additive site-capability Authority A proof assets

Status: source-only. No SQL file in this directory has been executed yet.
Migration 0154 adds Authority A without activating an application reader,
removing legacy pricing SELECT, applying contract B, or completing C04.

## Files

- `authority-catalog-acceptance.sql` checks the two database-owned generation
  columns, FK-free history, fixed vocabulary, trigger ordering, full identity
  and pricing definitions, exact ledger/RPC ACLs, preserved 0152 guards, and
  preserved legacy pricing SELECT.
- `authority-semantics-acceptance.sql` is a rolled-back owner fixture for exact
  site containment and enumeration, unknown-key denial, generation forgery,
  immutable history, partial uniqueness, trusted 0152 refusal, lifecycle
  retire/reactivate, public replacement of an expired grant, both parent DELETE
  causes, and all five required stored/live identity mismatches.
  The workspace-DELETE branch uses rollback-only owner setup to remove its linked
  site parent with the site lifecycle trigger disabled; 0152's `NO ACTION` link
  otherwise makes a direct workspace-parent delete with a current grant unreachable.
- `authority-authenticated-owner-repoint.sql` proves a legacy owner admitted by
  membership RLS still receives all three exact 0152 identity refusals without
  changing the parent generation or grant history.
- `authority-ledger-acl-negative.sql` executes authenticated ledger INSERT,
  UPDATE, and DELETE attempts plus a direct workspace-membership UPDATE, and
  requires four exact `42501` denials.
- `authority-pricing-parity.sql` is a rolled-back 1,005-row authenticated
  legacy-reader/RPC comparison. Neither, cost-only, and margin-only authority
  return no rows; both capabilities enable two separately executed 1,000/5
  pages whose WITH ORDINALITY emission order, values, boundary identities, JSON
  wine shape, and cross-tenant exclusion match the explicitly ordered legacy read.
- `authority-race-setup.sql` creates two finite committed fixtures on a fresh
  disposable database: one parent-retirement race and one governance race.
- `authority-lifecycle-site-session.sql` and
  `authority-lifecycle-workspace-session.sql` are the two overlapping parent
  sessions. `authority-lifecycle-race-acceptance.sql` requires both commits,
  two ineffective grants, and the first immutable retirement on each row.
- `authority-governance-demote-session.sql` holds the caller row after removing
  governance. `authority-governance-replace-session.sql` must wait, recheck,
  and capture exact `P0001 C04_CALLER_NOT_GOVERNOR` without appending a grant.
  `authority-governance-race-acceptance.sql` verifies conservation.
- `authority-state-fingerprint.sql` fingerprints grant bytes, relevant columns,
  routines, triggers, and legacy SELECT for before/after refusal comparison.
- `authority-down-dependency-fixture.sql` creates one external view dependency;
  guarded down must fail with `2BP01` under `RESTRICT` and roll back every drop.
- `scripts/0154-production-preflight.sql` is the no-DDL same-executor catalog
  and NOWAIT maintenance-window probe.

## Finite disposable runtime sequence

The independent runtime release selects and records a disposable PostgreSQL 17
target. No generic repository harness is introduced by this source leaf.

1. Restore through 0153. Run preflight; expect
   `C04_0154_PRODUCTION_PREFLIGHT_PASS`. Apply 0154 in one transaction.
2. Run catalog, semantics, authenticated-owner repoint, ledger-ACL, and pricing
   fixtures. Require these five receipts: `C04_0154_CATALOG_ACCEPTANCE_PASS`,
   `C04_0154_SEMANTICS_ACCEPTANCE_PASS`,
   `C04_0154_AUTHENTICATED_OWNER_REPOINT_PASS`,
   `C04_0154_LEDGER_ACL_NEGATIVE_PASS`, and
   `C04_0154_PRICING_PARITY_PASS`.
3. On a fresh post-0154 restore run `authority-race-setup.sql`. In one persistent
   coordinator connection execute `select pg_advisory_lock(1540404)` and retain
   that same connection. Start both lifecycle session files. After both distinct
   `C04_0154_*_PARENT_LOCKED` rows are captured, release from the coordinator
   connection with `select pg_advisory_unlock(1540404)`. Capture both distinct
   backend IDs and `C04_0154_*_GATE_PASSED` timestamps; both workers then spend
   one second past the shared gate before entering their parent UPDATE. Both must
   exit 0 with no `40P01`; lifecycle acceptance requires both parents committed,
   all grants ineffective, and one immutable first retirement per original row.
   Either `site_lifecycle` or `workspace_lifecycle` may legitimately win, but all
   original rows must record the same first cause. A new coordinator connection
   is invalid because releasing the holder connection would make the gate vacuous.
4. From a fresh race setup, start governance demotion and wait for
   `C04_0154_GOVERNANCE_DEMOTION_LOCKED`; start replacement before the holder
   commits. Both scripts exit 0, replacement records the caught exact error,
   and governance acceptance proves no grant was appended.
5. History refusal: after race setup, capture the state fingerprint, execute the
   guarded down, and require exact `P0001
   C04_CANNOT_DOWN_0154_GRANT_HISTORY_EXISTS`. Re-capture and require byte-equal
   fingerprint output.
6. Dependency refusal: on a fresh post-0154 restore with zero ledger rows, run
   the dependency fixture, fingerprint, and guarded down. Require `2BP01`
   naming `c04_0154_down_dependency_fixture`, then byte-equal fingerprint output.
7. Clean down: on another fresh post-0154 restore with zero history/dependents,
   down succeeds. The two lifecycle columns, ledger, three new triggers, and
   eight private/RPC routines are absent; legacy pricing policy/SELECT and both
   0152 guards remain. Re-applying 0154 and rerunning catalog acceptance passes.

## Exact expected errors and conservation

| Case | Expected SQLSTATE / message | Must remain unchanged |
|---|---|---|
| site generation forgery | `P0001 C04_SITE_LIFECYCLE_GENERATION_FORGERY` | parent generation and all grant rows |
| ledger field update | `P0001 C04_CAPABILITY_GRANT_HISTORY_IMMUTABLE` | complete row |
| ledger delete | `P0001 C04_CAPABILITY_GRANT_HISTORY_DELETE_FORBIDDEN` | complete row |
| authenticated legacy-owner site identity repoints | `P0001 membership_identity_immutable` | parent, generation, history; owner authority and original grant remain effective |
| workspace identity repoints | `P0001 workspace_membership_identity_immutable` | parent, generation, history |
| expired public replacement | success; old row cause `governance_replacement` | old attribution plus exactly one fresh effective current row |
| site/workspace parent DELETE | success; cause `site_delete` / `workspace_delete` | all identity and attribution snapshots remain, access is ineffective |
| governance race | `P0001 C04_CALLER_NOT_GOVERNOR` | zero target grant rows |
| down with history | `P0001 C04_CANNOT_DOWN_0154_GRANT_HISTORY_EXISTS` | complete Authority A fingerprint |
| down with dependency | `2BP01` | complete Authority A fingerprint |

The race scripts deliberately retain their committed fixture rows because they run
only on disposable targets. No cleanup or active-database execution is authorized by
this package.
