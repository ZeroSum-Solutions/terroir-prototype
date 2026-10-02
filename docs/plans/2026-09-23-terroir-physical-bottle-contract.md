# Individual bottles and service inventory

Status: accepted source design for approved Q10 / C02 / C06, September 23, 2026;
unimplemented. The C02 retry repair is a prerequisite, not completion of this contract.
Independent acceptance was recorded in the goal-state C06 source-closure proof, which
is external to this repository.
Canonical transitions: [database](./2026-09-23-terroir-physical-bottle-database-transition.md)
and [application](./2026-09-23-terroir-physical-bottle-app-transition.md).

Review follow-up: the C02 adversary independently reproduced the legacy Undo API
reversing a discard's single spill and reopening that lifecycle. This behavior
predates C02; it is not fixed by retry receipts. The physical-bottle transition must
replace raw event deletion with explicitly authorized, linked compensation, and
must distinguish correcting a mistaken report from claiming discarded wine has
physically returned. Include discard and measured-close outcomes in reversal tests.

## Why the existing model needs a second step

`0016_pour_tracking.sql` makes `open_bottles` unique by wine and restaurant.
`0044_open_bottles_closed_at.sql` reuses that row for the next bottle. The current
insert and delete triggers update by wine/site rather than a physical bottle ID.
`0151_inventory_commands.sql` safely serializes that existing slot and distinguishes
its lifecycles with `id + opened_at`; it does not make concurrent physical bottles
possible. The [cellar page](<../../src/app/(app)/cellar/page.tsx>), the atlas,
reconciliation and import removal also consume this model. Changing only the unique
constraint would corrupt multiple bottles.

Approved Q10 requires individually tracked open bottles, lot/format-based sealed
inventory, optional tags for valuable sealed bottles, tasting portions, flights and
bottle/table holds. Implement these as bounded slices; none is silently deferred.

## Next slice: immutable open-bottle identity

1. Keep `inventory_items` as the sealed receipt/lot allocation. Every newly opened
   bottle consumes exactly one unit from an identified same-site lot. Do not fabricate
   a source lot for legacy bottles whose provenance is unknown.
2. One `open_bottles` row represents one physical opening and is never reused. Keep
   its wine/site, source lot, opener, time, nominal capacity at opening, remaining mL,
   preservation and close time. The capacity snapshot, not a later catalog correction,
   bounds the physical bottle. Existing active bottles need an explicit migration
   rule using known catalog capacity; unknown/contradictory legacy data must block
   migration or enter review, never receive an invented default.
3. Each new pour, spill, reconciliation and close event refers to that exact bottle.
   Batch reconciliation preserves the existing all-or-none contract: one immutable
   batch UUID and receipt. Every entry has exactly `open_bottle_id`,
   `expected_state_version`, `target_remaining_ml`, and a nullable `note`; the client
   captures each bottle's read version in the durable draft and freezes it with the
   unresolved operation UUID and canonical payload. Entries are canonically sorted by
   bottle, with distinct wine locks in
   PostgreSQL native UUID ascending order with `FOR NO KEY UPDATE`, then exact bottle
   locks in that order with `FOR UPDATE`, and all validation and writes in one
   transaction. After bottle locking, rederive the distinct wine set from the locked
   bottle rows and require it to equal the wine set already locked. A concurrent merge
   mismatch returns `reconciliation_batch_stale` and rolls back the entire batch. A
   stale, foreign, closed or over-capacity entry likewise rolls back the entire batch,
   including its receipt. Exact
   replay returns the stored ordered results; changed payload reuse conflicts.
   The UI retains the whole draft on failure and clears it only after a validated
   success/replay. Do not substitute sequential per-bottle partial commits. The
   receipt represents every affected wine honestly, not a fabricated single wine ID.
   Trigger updates must use this identity and validate site/wine containment. No
   event may update every open bottle of a wine. Existing ambiguous history remains
   labeled legacy history; do not invent which historical physical bottle it belongs to.
4. Selected-bottle actions never spill into another physical bottle silently. If the
   selected bottle lacks the requested volume, ask for a split or another bottle.
   After physical cutover, every fresh action requires exact bottle identity. A stale
   wine-only client returns `legacy_inventory_command_retired` without mutation; no
   compatibility wrapper resolves a bottle. Opening another bottle is an explicit
   operation.
5. Preserve the C02 operation UUID/current-authority receipt contract. An offline
   dependent report references the predecessor opening operation, whose receipt
   resolves its bottle identity. Resolve that dependency on the server without
   rewriting the immutable report payload. Failed or foreign dependencies never
   allocate stock. Independent reports against a known bottle include its identity.
6. A discard closes one selected active bottle by recording its exact remaining mL as
   one `spill`, recording a distinct `discard` receipt/effect, and closing that row.
   `discard` is not a `pour_events.kind`; the depletion event remains `spill`, while
   `discard` identifies the command, receipt and effect.
   It creates no measured closeout or replacement and increments `state_version` once.
   Undo is a version-2 linked compensating event against the original physical bottle,
   never deletion of evidence or application to the next bottle of the same wine. Its
   fixed window is 15 minutes. It proves current authority, one reversal, capacity, and
   that no later event or closeout exists on that bottle. Reversing a discard additionally
   requires `correction_reason = 'mistaken_report'` and explicit operator confirmation
   that the same physical bottle is still present. An actual discard or uncertain
   possession returns `undo_requires_review` without mutation; undo never represents
   physically discarded wine as returned. Version-1 and pre-cutover events are not
   valid version-2 undo targets, and `undo_last_pour` is retired. Completed version-1
   receipts remain replayable.
7. Retire or safely adapt all directly callable legacy write RPCs and trigger paths
   in the same rollout. An HTTP migration alone cannot prevent authenticated direct
   RPC calls. Receipt tables, bottle state and event history remain non-writable by
   ordinary authenticated clients outside approved functions.
8. Expose one normative database contract-version function. Phase A returns `1`; the
   final step of the Phase C transaction replaces its body to return `2`. The route read
   is only a dispatch and UI hint; database writers and ACLs enforce the active mode in
   the same transaction. The exact reader is `security_invoker=true`, is constrained by
   tenant RLS, and does not expose raw opener identifiers or lot cost.

The first UI exposes the active bottles with distinct identifiers, location when
known, remaining volume, age and preservation. A previously selected bottle may be
remembered for fast service, but must still be checked by the server. Cellar summaries
sum active volume and count active bottles; they must not overwrite duplicate wine
keys in a JavaScript Map. Historical closed bottles remain accessible without being
included in active totals. Costs follow C04 capability rules.

## Following Q10 slices

| Slice | Bound behavior | Proof required |
|---|---|---|
| Pour presets and tasting | Venue-managed positive mL presets, including tasting sizes; manual amount with explicit units and limits | Exact integer-mL arithmetic, permission checks, stable presets during a service action |
| Flights and split pours | Named lines identify wine, physical bottle and amount; display any partial completion explicitly; retries retain line identity | No duplicate lines on retry; no silent substitution; clear recorded/pending/failed status for every line |
| Bottle/table holds | Reserve identified sealed units or an individual open bottle for a table/service purpose; release/consume/expire with audit | Two concurrent holds cannot reserve the same available unit; expiry does not pretend the physical wine was consumed |
| Optional sealed tags | Tag a particular unit within an existing lot without increasing its total; opening/transfer preserves its provenance | Unique site/workspace tag, tag-to-lot conservation, duplicate scan and retag audit |

Holds do not make disconnected devices mutually exclusive. Offline UI shows stale
availability and unresolved reports; final reservation authority remains on the server.
Table labels must not require guest names or other unnecessary personal data.

## Migration and acceptance gates

- Inventory the current trigger/RPC/API/UI consumers before editing. Include import
  reversal, wine identity merge, open-volume reporting and the legacy undo route.
- Add a forward migration, paired guarded down migration, generated local types,
  snapshot and normative manifest. A down migration must refuse a state it cannot
  represent without losing multiple bottles/history; do not silently merge or delete.
- Keep original C02 receipts byte-stable and replayable after migration. Their old
  row snapshots describe the recorded outcome, not present availability.
- Live tests open two bottles of the same wine, pour from only one, reconcile the
  other, close one, then prove both identities, lot conservation and separate history.
- Live tests cover identical/different UUID concurrency on the last sealed unit,
  unknown capacity, edited catalog capacity, cross-site IDs, revoked access, stale
  selection, retry after close, legacy direct-call bypass and compensation after a
  replacement bottle opens.
- Lock tests prove a legacy slot-first writer cannot deadlock either the scalar or batch
  physical command, and a concurrent wine merge between initial resolution and bottle
  locking causes a total `reconciliation_batch_stale` abort.
- Contract tests prove PostgreSQL native UUID ascending order in both SQL and TypeScript
  using normalized 32-digit lowercase hexadecimal comparison, including `09/0a`,
  `0f/10`, and UUID field-boundary vectors.
- Lifecycle tests separately cover measured close, discard, mistaken-discard correction,
  actual-discard rejection, replacement-bottle isolation, and rejection of a prior
  version-1 event as a version-2 Undo target.
- Browser tests cover selecting the correct bottle at 320/390 widths, fast repeated
  preset pours, an interrupted response/retry, and readable ambiguity/error states.
- Promote approved behavior into `app_spec.txt` and regenerate its ledger before
  implementation. A database reviewer must accept the transition and tests first.

The individual-bottle slice may be verified independently. It cannot complete C06.
The approved completion gate remains receive, place, find, serve, count and reconcile
end-to-end, including invoice/file review paths, open-vs-sealed counts, returns and
credits, manager discrepancy review, and critical E2E evidence. The following Q10
slices and their stated concurrency proofs are also required; none is silently deferred.
