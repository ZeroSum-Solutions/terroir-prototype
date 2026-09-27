# Import Revert Cleanup Boundary

Status: accepted product contract; migration 0164 is reserved for source
implementation and independent review. The owner accepted catalog retention
on 2026-09-27. This document does not claim runtime verification.

## Purpose

Make import revert atomic without deleting catalog or history. Inventory
reversal, eligible LWIN-pair cleanup, and batch or session status changes must
commit together or leave the complete operation unchanged. Every `wines` row
and every historical row is retained. The compatibility count
`orphanWinesDeleted` is therefore always the integer `0`.

Today `revert_import_batch(uuid)` commits inventory reversal before
`src/domains/import/batch-service.ts` attempts best-effort wine deletion and
LWIN cleanup. A missing service client, timeout, snapshot error, or per-wine
failure can still produce a successful revert, and session revert does not run
that cleanup. The repair moves the authorized inventory and LWIN work into one
database transaction shared by batch and session callers. It does not add a
generic command framework.

## Fixed SQL surface

The implementation adds and replaces only these exact signatures:

- `public.apply_import_batch_chunk(uuid, integer)` keeps its existing return
  shape and defaults, but requires READ COMMITTED and acquires the shared
  exact-site import transaction lock before its existing batch and row work.
- `public.revert_import_batch_core_private(uuid, uuid[]) returns jsonb` is the
  shared implementation and has no application-role execution grant. The
  second argument is the exact canonical set of batch IDs reverting in the
  caller's transaction.
- `public.revert_import_batch_private(uuid) returns jsonb` is the typed batch
  application entry point.
- `public.revert_import_batch(uuid) returns integer` remains the legacy
  compatibility entry point. It invokes the same core and returns
  `revertedItemCount`; it cannot bypass LWIN cleanup.
- `public.revert_import_session(uuid) returns jsonb` remains the session entry
  point and invokes the same core for each non-skipped child.

All five functions are explicitly `VOLATILE`, `SECURITY DEFINER`, owned by
`postgres`, and have `SET search_path = ''`. Every object reference is schema
qualified. Default and explicit `PUBLIC`, `anon`, and `service_role` execution
are revoked. Only the typed batch, legacy batch, and session entries grant
`EXECUTE` to `authenticated`; the shared core grants execution to no client
role.

The public request identity remains the batch or session UUID. No client can
supply the private reverting-batch set. The typed and legacy batch wrappers
pass exactly `ARRAY[p_batch_id]`; the session passes its complete canonical
eligible-child set to every core call. The core rejects a null, empty,
duplicate, null-bearing, current-batch-omitting, cross-site, or otherwise
noncanonical set. There is no new client operation key or receipt table.
Revert remains a status-fenced, one-shot operation: a committed batch retry is
`already_reverted`, not a replayed success. The successful typed batch receipt
has exactly these six keys:

```json
{
  "version": 1,
  "batchId": "uuid",
  "status": "reverted",
  "revertedItemCount": 0,
  "orphanWinesDeleted": 0,
  "lwinStampsCleared": 0
}
```

`orphanWinesDeleted` is a literal integer `0`, not a computed estimate. Every
other count is an integer derived inside the committing transaction. No extra
cleanup flags, warnings, or nullable counts are allowed.

## Authorization and refusal contract

The core derives the actor from `auth.uid()` and the site from the batch. It
does not accept an actor, site, role, cutoff, cleanup mode, or override from the
caller. Authorization is checked at execution time with
`public.current_site_role_at_least(batch.restaurant_id, 'staff')`.

After authority is established and before row locks or mutation, require
`pg_catalog.current_setting('transaction_isolation') = 'read committed'`.
Otherwise raise `25000 read_committed_required`. Do not change isolation inside
a function. A post-wait dependency check must be a separate SQL statement so
READ COMMITTED supplies a fresh command snapshot.

The typed batch entry has these stable database outcomes:

| SQLSTATE | Message | Meaning |
| --- | --- | --- |
| `42501` | `forbidden` | no authenticated actor |
| `25000` | `read_committed_required` | unsupported isolation; no row mutation |
| `P0002` | `import_batch_not_found` | nonexistent, other-site, or no current staff membership |
| `P04I1` | `import_batch_already_reverted` | status fence already committed |
| `P04D3` | `physical_bottle_dependency` | an open bottle depends on source inventory |
| `P04I2` | `import_source_conflict` | more than one applied import row claims a target inventory item; source ownership is ambiguous |
| `P0001` | `C04_IMPORT_REVERT_REFUSED` | redacted unexpected failure |

The legacy integer wrapper preserves current external compatibility. It maps
`P04I1`, `P04I2`, and `P04D3` to `P0001` with the messages
`import_batch_already_reverted`, `import_source_conflict`, and
`physical_bottle_dependency`, preserves
`42501`, `P0002`, and `25000`, and redacts every other failure as
`P0001 C04_IMPORT_REVERT_REFUSED`.

The session entry requires the same current staff-or-above membership for the
session's exact site. Its stable refusals are:

| SQLSTATE | Message | Meaning |
| --- | --- | --- |
| `42501` | `forbidden` | no authenticated actor |
| `25000` | `read_committed_required` | unsupported isolation; no row mutation |
| `P0002` | `import_session_not_found` | nonexistent, other-site, or no current staff membership |
| `P04D3` | `physical_bottle_dependency` | any eligible child has dependent physical bottles; the whole session rolls back |
| `P04I2` | `import_source_conflict` | any eligible inventory item has ambiguous applied-row ownership; the whole session rolls back |
| `P0001` | `C04_IMPORT_SESSION_REVERT_REFUSED` | redacted unexpected failure |

These responses reveal no other site's object existence.

## One-batch transaction

One call to the core performs this work in order. Every set of rows is locked
in ascending UUID order unless a different order is stated explicitly. The
typed and legacy entries pass only their own batch ID as the reverting set.

Before any batch, import-row, wine, or inventory row lock, apply and revert
derive the exact site without a locking read and acquire the same
transaction-scoped advisory lock keyed by `import-mutation:<restaurant UUID>`.
Apply, like revert, refuses a non-READ-COMMITTED transaction with exact
`25000 read_committed_required` before taking that lock.
They then revalidate current authority. This deliberately serializes import
apply and revert inside one restaurant, including inverse row-number versus
wine-ID order, while unrelated restaurants remain independent. The lock is
transaction-scoped, never session-scoped, and no function releases it early.

1. Resolve `auth.uid()` and the authorized batch/site without a locking read;
   apply the isolation guard, lock the authorized `import_batches` row
   `FOR UPDATE`, then revalidate authority, existence, and status.
2. Lock this batch's rows where `apply_status = 'applied'` by
   `import_batch_rows.id FOR UPDATE`. Before changing them, retain their exact
   pre-revert evidence: `id`, `restaurant_id`,
   `applied_inventory_item_id`, `applied_wine_id`, `updated_at`, `lwin_id`, and
   `lwin_score`.
3. Lock the exact-site candidate `wines` rows named by that evidence by
   `wines.id FOR UPDATE`. Then lock the named exact-site `inventory_items` by
   `inventory_items.id FOR UPDATE`. Wine-before-inventory order is mandatory
   and matches existing writers.
4. In a separate statement after all lock waits, use a fresh READ COMMITTED
   snapshot to revalidate authority, then refuse with `P04I2` if more than one
   currently applied import row claims any captured inventory ID. The database
   does not constrain `applied_inventory_item_id` as unique, and the 0156
   inventory-delete trigger updates every applied row that shares it, so
   guessing ownership would corrupt sibling evidence and counts. Then refuse
   with `P04D3` if any `open_bottles` row names a captured
   `source_inventory_item_id`. Both refusals occur before mutation.
5. While the captured import rows still have their original apply-time
   timestamps, clear only an eligible LWIN pair with the exact compare-and-swap
   update defined below. Count actual distinct wine rows updated.
6. Update only the captured applied import rows to `apply_status = 'reverted'`,
   clear `applied_inventory_item_id`, and update their timestamp. Preserve
   `applied_wine_id`, LWIN evidence, raw import data, cost data, and all other
   row history.
7. Delete only the captured inventory IDs from the same site. Never delete any
   other inventory for the same wine.
8. Set the batch to `reverted`, with `reverted_at` and `reverted_by` derived in
   the transaction, then return the exact receipt.

Any SQL or cleanup error rolls back batch status, import rows, inventory, and
LWIN changes together. No wine or history row is deleted or rewritten. There
is no deadline, truncation, catch-and-continue cleanup, or service-role
application client.

## Exact LWIN-pair boundary

One set-based update clears `wines.lwin_id` and `wines.lwin_match_score`
together only when an applied row captured before revert satisfies every
condition below:

- the captured `applied_wine_id` names the locked exact-site wine;
- captured `lwin_id` and `lwin_score` are non-null;
- captured `lwin_score >= 0.6`, matching the apply confidence gate;
- the current wine `updated_at` equals the captured row's pre-revert
  `updated_at`;
- the current wine pair exactly equals the captured `lwin_id` and
  `lwin_score`; and
- no row from a batch outside the exact transaction-scoped reverting set is
  still `apply_status = 'applied'` for that wine and exact current pair.

The final `UPDATE` repeats the timestamp, ID, score, site, and competing-claim
predicates under the held wine lock. It runs before the reverting import rows'
timestamps and statuses change, so the compare-and-swap evidence is never read
after it has been overwritten. A newer timestamp, different ID, different
score, lower-confidence row, claim outside the exact reverting set, unrelated
wine, or already-empty pair remains unchanged. Multiple qualifying rows for
one wine still update and count that wine once. When two eligible session
children claim the same current pair, the child whose captured timestamp and
pair equal the current wine clears and counts it; the sibling's in-scope claim
does not block that clear, and the sibling later counts zero.

The contract claims only timestamp-and-pair evidence. It does not infer sole
historical provenance and never deletes the retained catalog wine.

## Session all-or-nothing and global lock order

`revert_import_session(uuid)` establishes current authority and checks
isolation before locking and revalidating the authorized session. It locks all
child batch rows in the existing processing order:
`coalesce(chunk_index, 0) DESC, created_at DESC, id DESC`.

Before invoking the core for any child, the session path constructs one sorted,
distinct array containing every non-reverted eligible child batch ID. It locks
the union of those children's applied import rows by row ID, then locks the
union of all candidate wines globally by wine ID and the union of all captured
inventory rows globally by inventory ID. Both union sets are mandatory;
`applied_inventory_item_id` is not database-unique, so logical uniqueness may
not be assumed. Two sessions whose children share wines or inventory must not
acquire `X -> Y` and `Y -> X` through different batch orders. After the global
locks, one fresh statement checks the complete inventory union for physical
dependencies and shared applied-row ownership after revalidating authority.
Any shared inventory claim raises `P04I2`; any dependency raises `P04D3` before
any child mutation.

The session then visits eligible children in the existing reverse order and
invokes the same core with that identical complete eligible-child array.
Already-reverted children are reported as skipped and are absent from the
array. A physical dependency or any unexpected child failure aborts the whole
session transaction and rolls back every earlier child change. There is no
successful `in_progress` result and no physical-dependency skip: success always
means every eligible child committed and the session is `reverted`.

The exact successful database result has these seven top-level keys:

```text
{
  version: 1,
  sessionId: uuid,
  status: "reverted",
  batches: BatchResult[],
  revertedBatchCount: integer,
  blockedBatchCount: 0,
  revertedItemCount: integer
}
```

Each child is exactly one of:

```text
{
  batchId: uuid,
  chunkIndex: integer | null,
  skipped: false,
  status: "reverted",
  revertedItemCount: integer,
  orphanWinesDeleted: 0,
  lwinStampsCleared: integer
}

{
  batchId: uuid,
  chunkIndex: integer | null,
  skipped: true,
  reason: "already_reverted"
}
```

`revertedBatchCount` counts committed non-skipped children;
`revertedItemCount` sums those children's exact counts; and
`blockedBatchCount` is the literal integer `0`. Already-reverted children do
not contribute to aggregate counts.

## Application cutover

- The batch service calls only `revert_import_batch_private`, strictly
  validates the exact version-1 receipt, and maps `P0002`, `P04I1`, and
  `P04D3` to the current safe not-found/conflict responses. `P04I2` maps to a
  409 `import_source_conflict` response explaining that retained import history
  has ambiguous inventory ownership and needs operator repair. Malformed
  results and unexpected errors become redacted 500 responses.
- Preserve the compatible batch HTTP success shape exactly:
  `{revertedCount, orphanWinesDeleted, lwinStampsCleared}`. Map database
  `revertedItemCount` to public `revertedCount`; require
  `orphanWinesDeleted === 0`.
- The session service strictly validates the exact top-level and child union.
  Its public success stays `{sessionId, batches}`. A successful child maps
  database `revertedItemCount` to public `revertedCount` and retains literal
  `orphanWinesDeleted: 0`; an already-reverted child keeps only its exact
  skipped shape.
- Session `P04D3 physical_bottle_dependency` maps to the existing safe 409
  envelope with `details: { batches: [] }`. No child result is returned because
  the database transaction committed none. Unexpected errors are redacted.
- Session `P04I2 import_source_conflict` uses the same zero-result 409 envelope
  and actionable retained-history wording; it never becomes a physical-bottle
  error or a successful skipped child.
- The batch route keeps lifecycle-aware membership and UUID validation but
  removes the service-role client, pre-revert cleanup snapshot, wine deletion,
  LWIN update, cleanup deadline, and compensating/best-effort loops.
- The session route remains on the shared session RPC and gains no cleanup
  branch of its own.
- Remove `cleanupTruncated`, `orphanCleanupSkipped`, and `cleanupFailures` from
  success types, route payloads, summaries, UI copy, and tests. The UI explains
  that revert removes imported inventory while retaining wine catalog/history.

## Forward and down migration obligations

Migration `0164_import_revert_cleanup.sql` is reserved through the migration
runbook and must include these guards:

- Before DDL, require the exact known signatures, owner, ACL, search-path
  metadata, and accepted current bodies of `apply_import_batch_chunk(uuid,
  integer)`, `revert_import_batch(uuid)`, and `revert_import_session(uuid)`.
  Refuse missing, unknown, or drifted bodies.
- Require the referenced tables, columns, constraints, indexes, current
  membership predicate, update-trigger behavior, physical-bottle relation,
  and exact LWIN fields. Do not clobber a pre-existing typed entry or either
  one- or two-argument core identity.
- After all definitions, assert exact signatures, bodies, owner, security
  mode, `VOLATILE` metadata, empty search path, and ACL. The private core must
  have no client execution grant.
- Provide a guarded paired down migration with no `CASCADE`. It restores the
  exact prior apply, batch, and session definitions and ACL/metadata, then
  drops only the exact owned typed entry and core. It refuses unknown later
  bodies or dependents.

Down restores function definitions only. It does not recreate inventory or
reverse already committed forward-era operations, and it never deletes catalog
or history data.

## Required proof before promotion

1. **Batch functional:** use the real apply RPC and prove its production
   apply-time `import_batch_rows.updated_at` equals the wine write timestamp;
   then prove exact imported inventory is removed, import row and batch status
   change exactly, catalog wine and history remain, and
   `orphanWinesDeleted` is exactly `0`.
2. **LWIN matrix:** through the real apply path (or a fixture pinned byte-for-
   byte to its timestamp-writing body), prove the exact untouched pair clears;
   newer timestamp, different ID, different score, score below `0.6`, another
   applied batch claim outside the exact reverting set, unrelated wine, and
   empty pair do not clear. Duplicate qualifying rows count one changed wine.
   Two real-applied session children claiming the same current pair in reverse
   processing order clear it once, attribute that one clear to the matching
   child, and leave the sibling at zero.
3. **Atomic failure:** transaction-scoped injected failures after LWIN work and
   after inventory work each restore the complete batch, import-row,
   inventory, wine-pair, and session state.
4. **Physical dependency:** one open bottle yields exact `P04D3` before any
   mutation and preserves complete state. Session physical dependency rolls
   back every child and returns no success receipt.
5. **Ambiguous source:** same-batch, same-session sibling, and outside-session
   applied rows sharing one inventory ID each yield exact `P04I2`, preserve all
   rows and LWIN evidence, and never run the 0156 delete trigger's broad update.
   Two concurrent reverts over the shared ID also refuse without deadlock.
6. **Session:** success visits batches in reverse order through the same core;
   counts are exact; already-reverted children have only their stated skip
   shape; mixed eligible/physical and injected unexpected-child cases prove
   whole-session rollback.
7. **Concurrency:** two sessions with different batch order but shared wines
   and inventory prove the global union lock order completes without deadlock.
   Real apply and revert use at least two shared wines whose row-number and
   wine-ID orders are inverse, in both lock-acquisition orders, and prove the
   common site advisory lock serializes before batch/wine locks. LWIN-pair
   updates and physical-open/revert are also exercised in both relevant lock
   orders. An open bottle committed while revert waits is seen
   by the fresh post-wait dependency statement and returns `P04D3`, not an FK
   error or redacted refusal. A single-session script is not concurrency proof.
8. **Catalog/history conservation:** catalog wines and direct, physical, scan,
   deletion, reconciliation, merge, pour, receipt, note, availability, health,
   pricing, adjustment, and audit history are unchanged by every successful
   or refused revert.
9. **Authorization:** current same-site staff, manager, and owner succeed;
   revoked, unauthenticated, and cross-site callers fail without revealing
   existence or changing rows. The legacy integer entry proves it uses the
   same inventory/LWIN core rather than an old-body bypass.
10. **Isolation:** READ COMMITTED works. REPEATABLE READ and SERIALIZABLE are
   refused with `25000` before child locks or mutation through typed, legacy,
   and session entries, with complete conservation.
11. **Forward/down refusal:** missing or drifted prerequisite bodies,
    metadata, ACL, tables, fields, or owned objects fail before DDL; down
    refuses unrelated later definitions and restores the exact prior catalog.
12. **Source and caller:** exact SQL metadata and receipt keys are pinned; batch
    and session callers strictly parse results, issue no service-role or direct
    wine/LWIN cleanup writes, expose no partial-success flags, and preserve the
    safe public envelopes.
13. **Conservation:** rollback-only acceptance leaves schema, protected data,
    roles, memberships, ACL, and unrelated import/catalog/history rows exact.

## Non-goals

This repair does not delete catalog wines, erase or rewrite history, redesign
import apply, add generalized operation receipts, change LWIN matching, alter
physical-bottle rules, expose cost data, or replace broader placement/history
work. It closes only the non-atomic import-revert cleanup boundary.
