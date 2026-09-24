# C06 physical-bottle app transition

Date: 2026-09-23
Status: accepted source design with B1-B4 and source-review closure F1-F3; unimplemented
Repository: `/Users/zero/projects/_archive/terroir-prototype`
Source revision checked at author freeze: `8bde6b4f67c1def2a912b8abed60a497b7bdf887`; the four reviewed runtime source hashes remain equal to the independent review record, with concurrent uncommitted work owned by the parent run
Contract: [Individual bottles and service inventory](./2026-09-23-terroir-physical-bottle-contract.md) (`sha256 47af646f1b270c306d81188b46fcd3908f6b2aecc9c6e483cd127e3bb78f6584`)
Database transition: [Physical-bottle database transition](./2026-09-23-terroir-physical-bottle-database-transition.md) (`sha256 cb20ceb144b5d17222bbf74d1e4eae8b257a76a1cc12bf9db509663724e52160`)

## Bounded decision

Implement the database review's **Phase B dual-capable application** as one bounded
slice after the additive database expansion exists. The app must be able to read both
contract-1 legacy slots and contract-2 physical bottles, but physical writes remain
hidden until `current_inventory_contract_version()` returns `2`. Do not drop this
request-time version gate in application code and do not cache it across requests.

The first slice includes exact bottle selection, explicit open, exact-bottle
pour/spill/reconcile/close, append-only linked undo, aggregate read compatibility, and
version-1 receipt replay. It excludes C04 cost-policy work, presets/tasting, flights,
holds, sealed tags, and durable offline recovery.

The app must fail closed during a transition race:

- a route that read version 1 just before Phase C commits may receive
  `legacy_inventory_command_retired`; refresh the version and do not retry with a new UUID;
- version 2 + a stale wine-only client => reject without mutation; never auto-open,
  split, or choose among two bottles;
- no UI is evidence that a DB writer is retired. Phase C ACL/trigger changes remain
  mandatory.

## Phase A database dependencies

The app slice should not invent SQL contracts. It depends on the database owner
delivering and generating types for these stable boundaries:

1. `current_inventory_contract_version() returns smallint`. Phase A returns `1`; the
   final statement in the atomic Phase C transaction replaces the body to return `2`.
   It is readable by authenticated members without exposing tenant state. The result is
   a dispatch/UI hint only; RPC bodies, triggers, and ACLs enforce the mode atomically.
2. The accepted `execute_physical_bottle_command(...)` signature and stable error
   names from the DB review.
3. An accepted exact-bottle reconciliation batch boundary with one operation UUID,
   one durable batch receipt, a canonical bottle-sorted entry set, and stored ordered
   results. The database implementation must lock distinct wine rows in PostgreSQL
   native UUID ascending order with `FOR NO KEY UPDATE`, then lock exact bottle rows in
   that order with `FOR UPDATE`. Under the bottle locks it rederives the distinct wine
   set and requires exact equality with the already locked set before validating every
   entry and applying all state/events/receipt completion in one transaction.
4. An exact active-bottle reader containing at minimum `id`, `restaurant_id`,
   `wine_id`, `remaining_ml`, `nominal_capacity_ml`, `opened_at`, `state_version`,
   `preservation_method`, `source_provenance`, and approved source lot/bin labels when
   known. It does not return raw `opened_by` or lot cost.
5. A compatibility `list_open_bottle_items` result with one row per wine,
   `active_bottle_count`, and summed active mL. It must not duplicate wine-list rows.
6. The effective service-event reader that excludes linked reversal rows and their
   reversed originals while preserving legacy history. It and the exact-bottle reader
   use `security_invoker=true`; authenticated access remains RLS-constrained and every
   service-role consumer supplies an explicit restaurant predicate.
7. Version-2 command results with strongly validated UUID/date/integer fields,
   `pour_event_ids`, the exact bottle snapshot, and the transport-only `replayed`
   marker. Open results must also write the operation-to-bottle effect mapping.

If any of these is absent or differs, update this plan before implementation rather
than adding casts or parsing receipt JSON.

## Accepted transition decisions pending implementation

These decisions close the B1-B4 author findings. They still require independent source
review and runtime proof before implementation or cutover:

1. **Contract-version TOCTOU:** the route-level version read is only a UI/dispatch hint.
   Phase C must make the physical RPC and the version-1 replay-only RPC enforce the
   active contract atomically. A separate flag read followed by an otherwise-permitted
   legacy write is not a safe cutover boundary.
2. **Effective-event authorization:** any effective-events view must use
   `security_invoker=true`, or be replaced by an equivalently tenant-authorized RPC.
   Every service-role analytics reader must retain an explicit
   `.eq("restaurant_id", restaurantId)` predicate. Reader conversion must not create an
   RLS bypass.
3. **Minimum exact-reader projection:** source joins must not expose lot cost or raw
   opener identifiers merely because those values are available. Return only the
   bottle identity, state, provenance class, and service location needed by this slice;
   cost stays under C04 and operator identity follows the approved display/privacy
   contract.
4. **Legacy-client cutoff:** after Phase C, every fresh version-1 or wine-only request
   returns `legacy_inventory_command_retired` without mutation. There is no optional
   compatibility wrapper. Completed version-1 receipts still replay. TypeScript never
   chooses or emulates a bottle, auto-opens for a stale command, or defaults among
   multiple bottles.

**Revision after root architecture challenge:** the earlier sequential per-bottle
reconcile proposal was an unsupported implementation-convenience regression. Exact
bottle identity and offline dependency resolution do not require weakening the current
all-or-none reconcile guarantee. Physical reconciliation therefore remains one atomic
exact-bottle batch: any failed entry rolls back every entry, and an uncertain response
retains the one batch UUID and exact canonical payload for replay. Intentional partial
completion belongs only to a separately approved flights/split-pours contract.

## Application model

Add one shared exact-bottle shape near `src/lib/wine-list/shapes.ts` and evolve
`CellarWineRow` in [`src/app/(app)/cellar/types.ts`](<../../src/app/(app)/cellar/types.ts>):

```text
activeBottleCount: number
activeOpenMl: number
activeBottles: PhysicalBottleSummary[]
```

Each `PhysicalBottleSummary` carries immutable `id`, captured capacity, remaining mL,
opened time, state version, preservation, provenance, and optional location. It does
not carry raw opener identity or lot cost. Remove the
singular `open_bottle_id/opened_at/opened_by/preservation_method` fields only after all
callers use the array. During Phase B, adapt a single active legacy slot into a
one-element array marked legacy; never present a closed legacy row as a physical
bottle.

Selection rules are centralized, not repeated in buttons:

- zero active bottles: Pour is unavailable; Open remains explicit when sealed stock
  exists;
- one active bottle: select it automatically;
- two or more: require an explicit selection before Pour, Spill, Reconcile, Close, or
  Undo; do not default to first/newest/most-full;
- a remembered selection is only a convenience. Revalidate it against the current
  exact list and server command; a missing/closed selection returns to the chooser;
- an Open result selects only the returned new bottle. Opening another bottle remains
  available and is never relabeled as Pour.

Use `bottle=<uuid>` in cellar URL state so `/cellar/open` and reconciliation can deep
link to the exact bottle. Extend `src/lib/cellar-facets/url-state.ts`,
[`src/app/(app)/cellar/use-cellar-url-state.ts`](<../../src/app/(app)/cellar/use-cellar-url-state.ts>),
and [`src/app/(app)/cellar/cellar-navigation.ts`](<../../src/app/(app)/cellar/cellar-navigation.ts>);
clear a bottle value that does not belong to the selected wine instead of silently
selecting a replacement.

## Command boundary and API transition

Keep the current endpoint paths to avoid two competing first-party APIs. Add a thin
physical command module beside `src/domains/pours/inventory-command.ts`, and centralize
contract-version dispatch in `src/domains/pours/pour-service.ts`. The route must read the
version on every mutation request. Do not put service-role follow-up writes around
the RPC.

| Endpoint | Physical-mode request | Result / error policy | Current files |
|---|---|---|---|
| `POST /api/open-bottles` | existing Idempotency-Key; `wine_id`, `preservation_method`; no bottle selector | exact new bottle result; active bottles do not block another explicit open | `src/app/api/open-bottles/route.ts`, `src/domains/pours/pour-service.ts`, [`src/app/(app)/cellar/use-inventory-commands.ts`](<../../src/app/(app)/cellar/use-inventory-commands.ts>) |
| `POST /api/pour` | Idempotency-Key; `wine_id`, positive `ml`, `kind`; exactly one of `open_bottle_id` or predecessor opening operation | 409 ambiguity/stale/closed/insufficient-volume mappings; no implicit open, split, or cross-bottle spill | `src/app/api/pour/route.ts`, `src/lib/api/inventory-command.ts`, [`src/app/(app)/cellar/use-inventory-commands.ts`](<../../src/app/(app)/cellar/use-inventory-commands.ts>) |
| `POST /api/open-bottles/close` | Idempotency-Key; exact `open_bottle_id`, measured actual/write-off/reason | close the selected identity only; replay succeeds after closure | route, [`src/app/(app)/cellar/partial-bottle-closeout.tsx`](<../../src/app/(app)/cellar/partial-bottle-closeout.tsx>) |
| `POST /api/open-bottles/[id]/close` | Idempotency-Key; path ID is exact; explicit discard command has no synthetic measurement | one exact locked-remainder `spill` plus a distinct linked `discard` receipt/effect; close exact row, increment state version once, and create no measured closeout/replacement; exact replay | route, [`src/app/(app)/cellar/open/close-button.tsx`](<../../src/app/(app)/cellar/open/close-button.tsx>) |
| `POST /api/pour/undo` | required Idempotency-Key; `reversal_of_event_id`; no wine-only body; when reversing a discard, require `correction_reason='mistaken_report'` and `operator_confirms_same_bottle_present=true` | append one version-2 linked `undo`; fixed 15-minute window; map already/window/review errors to 409; actual discard or uncertain possession is review-only and non-mutating; return exact bottle and reversal event | route, `src/domains/pours/pour-service.ts`, drawer/action bar |
| `POST /api/reconcile` | required batch UUID in Idempotency-Key; `entries[]` each carry exactly `open_bottle_id`, `expected_state_version`, `target_remaining_ml`, and a nullable `note` key; reject missing/unknown keys and duplicate bottle IDs | one receipt-backed, all-or-none exact-bottle batch result; same UUID + same canonical set replays, payload mismatch conflicts; never call the legacy wine-only batch RPC in physical mode | route, `src/domains/cellar/reconcile-service.ts`, reconcile client |

Physical-mode schemas reject irrelevant legacy fields. During Phase B while the function
returns 1, current schemas and C02 UUID behavior remain unchanged. After Phase C, a stale
wine-only or fresh version-1 request receives `legacy_inventory_command_retired` with
no mutation. Neither application code nor a database compatibility wrapper selects a
bottle for it.

The reconcile UI keeps “Save N changes” as one operation. Before sending, it validates
exact keys, types, UUIDs, and duplicate bottle IDs. It then canonicalizes entries in the
exact PostgreSQL UUID ascending order by lowercasing each canonical UUID, removing
hyphens, and comparing the resulting 32 hexadecimal digits lexicographically. Request
arrays and validated result arrays use the same comparator. The durable draft captures
the `state_version` read for each bottle as `expected_state_version`. The client generates
one batch UUID and clears the
entire draft only after an operation-valid success/replay response. Any failed response
retains the entire draft; an uncertain response additionally freezes the exact UUID and
canonical payload, including every expected version, behind “Retry prior reconciliation”
until replay resolves it. Editing or refreshing versions after a definitive non-commit
creates a new batch operation; it must never silently
reuse an unresolved UUID for a different set.

The discard route does not introduce a `discard` event kind. Its exact-remainder event
is `spill`; `discard` names only the command, receipt and effect linked to that event.

The SQL and TypeScript order-parity test uses this fixed ascending vector:

```text
00000000-0000-0000-0000-000000000009
00000000-0000-0000-0000-00000000000a
00000000-0000-0000-0000-00000000000f
00000000-0000-0000-0000-000000000010
00000000-0000-0000-000f-ffffffffffff
00000000-0000-0000-0010-000000000000
00000000-0000-000f-ffff-ffffffffffff
00000000-0000-0010-0000-000000000000
00000000-000f-ffff-ffff-ffffffffffff
00000000-0010-0000-0000-000000000000
```

## Service UI and exact identity

1. Add a small bottle selector component owned by the drawer, not the global cellar
   row. It lists short stable ID, location when known, remaining/capacity, age, and
   preservation. At 320/390px each option and action is at least 44px and no value is
   conveyed only by color.
2. Update `wine-detail-drawer.tsx`, `pour-action-bar.tsx`,
   `use-inventory-commands.ts`, `partial-bottle-closeout.tsx`, and the picker so every
   command carries the selected identity. Preserve unresolved-command recovery even if
   the current selection or availability changes.
3. Replace `lastPour: {ml}` with the successful receipt's exact event ID, bottle ID,
   amount, and operation state. Undo targets that event. It never asks the server for
   “latest for this wine.” A later event on another bottle does not change the target.
   Do not expose Undo for version-1/pre-cutover events. For a discard-linked spill,
   require an explicit “mistaken report” reason and confirmation that the same physical
   bottle is still present. If it was actually discarded or possession is uncertain,
   send no mutation and direct the operator to review.
4. `/cellar/open` already renders rows by ID. Switch percentage/format from mutable
   `wines.size_ml` to `nominal_capacity_ml`, show provenance/location, deep link with
   `wine` + `bottle`, and keep close bound to the row ID.
5. Reconciliation keys rows and draft entries by bottle ID, not wine ID. Version the
   draft shape in `src/lib/reconcile-draft/draft-storage.ts`; store the
   `expected_state_version` read for every bottle with the operation UUID and canonical
   payload. Reject/clear old wine-keyed or unversioned drafts after cutover rather than
   applying them to an arbitrary bottle.

## Reader conversion inventory

All of these must be addressed before Phase C is enabled.

| Reader | Required transition |
|---|---|
| [`src/app/(app)/cellar/page.tsx`](<../../src/app/(app)/cellar/page.tsx>) | Replace `Map<wine_id,row>` overwrite and `directOpenByWine` with per-wine aggregate + exact array. Compute draining history only for contract-2 exact IDs; retain labeled legacy totals without inventing attribution. |
| [`src/app/(app)/cellar/types.ts`](<../../src/app/(app)/cellar/types.ts>), `row-chip.ts`, `cellar-shell.tsx`, `cellar-control-bar.tsx` | Use summed active mL and physical bottle count. Keep “wines” and “bottles” labels truthful; low-stock arithmetic uses aggregate active volume. |
| `wine-detail-drawer.tsx`, `pour-action-bar.tsx`, picker/closeout | Render/select exact bottles and pass IDs as above. Multiple active bottles must never collapse into one displayed lifecycle. |
| [`src/app/(app)/cellar/open/page.tsx`](<../../src/app/(app)/cellar/open/page.tsx>) | Every active identity is one row; captured capacity drives format/percentage; exact deep link and exact close. |
| [`src/app/(app)/cellar/reconcile/page.tsx`](<../../src/app/(app)/cellar/reconcile/page.tsx>), `reconcile-list.tsx`, modal and draft storage | Exact rows and bottle-keyed pending state including each captured `expected_state_version`; one immutable batch UUID/payload while unresolved; retain the entire draft on failure and clear it only on a valid atomic success/replay. |
| `src/app/api/wines/search/route.ts` | Consume one aggregate row per wine; open filter uses count/summed mL, low filter does not double count duplicate rows. |
| [`src/app/(app)/atlas/page.tsx`](<../../src/app/(app)/atlas/page.tsx>) | Reduce active physical rows to a distinct wine set; duplicate bottles must not duplicate atlas facts. |
| DB auto-86 plus `src/lib/api/auto-eightysix-revalidation.ts` | SQL uses active sum/count and fires after physical undo/reconcile; application still revalidates only touched wine IDs. |
| `src/app/api/insights/pour/route.ts` | Read effective service events; reversal rows and reversed originals do not count as sales. |
| `src/app/api/member-analytics/route.ts` | Same effective-event source for pour attribution; keep closeout attribution exact. |
| `src/lib/pricing-recommendations/recompute.ts` | Effective events only; an undo removes the original pour once. |
| `src/lib/cellar-health/recompute.ts` | Effective events only; spill remains waste, undo does not create a sale. |
| `src/domains/wine-profile/resolve-cellar-context.ts` | Last depletion is the latest effective pour, not a reversed original or undo row. |
| [`src/app/(app)/insights/yield-report-section.tsx`](<../../src/app/(app)/insights/yield-report-section.tsx>) | Use captured bottle/closeout capacity, not joined mutable `wines.size_ml`. |
| [Cellar deletion route](<../../src/app/api/cellar/[id]/route.ts>) | Wine deletion remains fail-closed for immutable physical history; do not rely on cascaded bottle deletion. |

Every exact-reader adapter is allowlist-based. Raw `opened_by`, source-lot cost, and
other unapproved joined fields are rejected rather than passed through to UI models.
Every service-role effective-event query includes an explicit restaurant predicate.

## Legacy and provenance paths

Application changes complement, but do not replace, Phase C retirement:

- `src/domains/pours/inventory-command.ts` becomes completed-version-1 replay support
  plus a physical dispatcher; no fresh v1 write after contract version 2 is visible.
  There is no wine-only compatibility wrapper.
- Delete the production use of `undo_last_pour` and
  `reconcile_open_bottles_batch`. `src/lib/pour/predict.ts` must not remain an
  authoritative mirror of the auto-open/cross-bottle legacy RPC.
- Both close routes keep receipt-first replay semantics and exact authority; neither
  performs a mutable pre-read as an authorization decision.
- `src/domains/import/batch-service.ts` and
  `src/domains/import/session-service.ts` surface `physical_bottle_dependency` and do
  not label blocked batches/sessions reverted.
- The [scan detail route](<../../src/app/api/scans/[id]/route.ts>) maps the same dependency and reports no deletion
  when source lots are referenced.
- `src/app/api/wines/merge/route.ts` treats receipt JSON as immutable; its tests prove
  relational repoint plus old-receipt replay.
- Direct inventory deletion/edit routes must surface the stable provenance conflict;
  none may turn an FK error into partial success.
- Update first-party E2E callers in `e2e/pour-flow.test.ts` and
  `e2e/opp-10-partial-bottles.spec.ts` to select and retain exact IDs/UUIDs.
- Phase C still revokes every old RPC/direct DML grant and rejects contract-1 events as
  listed in the database review. A route test is not proof of ACL closure.

## Implementation order

1. **Typed DB dependency adapters** — contract-version function, exact-bottle reader,
   aggregate reader, physical command parser/error map. Verify version-1 mode against
   Phase A.
2. **Read model** — exact arrays plus aggregate compatibility; convert cellar/open/
   reconcile/search/atlas without enabling physical actions. Prove duplicate bottles
   cannot be overwritten by a JavaScript `Map`.
3. **Exact write routes** — open, selected pour/spill, measured close, discard,
   reconcile, undo. Preserve C02 replay headers and strict response validation.
4. **Drawer/open/reconcile clients** — selection, bottle-keyed drafts, receipt-bound
   Undo, unresolved retry UI. Physical controls remain contract-version-gated.
5. **Derived readers** — effective-event analytics/profile/pricing/health and captured-
   capacity yield.
6. **Legacy/provenance error surfaces** — import/session/scan/merge/delete paths and
   tests.
7. **Pre-cutover gate** — dual-capable app deployed with contract version 1; independent
   TypeScript/security review; reader parity against legacy dataset.
8. **Phase C cutover** — database owner atomically promotes, retires, and enables. Run live and
   browser acceptance; only then claim the physical slice independently shippable.

## Acceptance cases

### API/domain

1. One wine has bottles A and B. Pour A changes only A and returns A's event ID; B is
   byte-equivalent before/after.
2. Missing selector, foreign selector, closed selector, and `ml > A.remaining_ml` make
   zero mutations and do not open/split/substitute.
3. Two explicit opens consume two exact lot units and return two IDs. Catalog-size edits
   afterward do not affect either captured capacity.
4. Same UUID/same payload replays; same UUID/different bottle or amount conflicts.
   Network loss keeps the UUID and exact payload.
5. Undo references A's exact event, inserts one linked reversal, and never deletes the
   original. A later event on B does not block it; a later event/closeout on A yields
   review. Duplicate undo is non-mutating. The window is exactly 15 minutes, and a
   version-1/pre-cutover event cannot be targeted.
6. A batch reconciling A and B changes both or neither. If the second entry has an
   `expected_state_version` mismatch after the draft was read, is closed, foreign, or
   out of bounds, A, B, their events, and the batch receipt remain unchanged.
   A lost response retains the single batch UUID and exact canonical set with both
   expected versions;
   replay returns the stored result without another event. Reversed input order
   canonicalizes to the same request, and concurrent batches submitted in opposite
   order complete without deadlock because both use sorted wine-before-bottle locks.
7. Current membership is required on replay; foreign/missing predecessor IDs are
   indistinguishable and allocate no stock.
8. A deterministic two-session legacy slot-first writer holds A and its wine FK
   `KEY SHARE` while the physical scalar and batch paths run. Wine `FOR NO KEY UPDATE`
   followed by bottle `FOR UPDATE` produces no deadlock. A separate paused batch whose
   bottle-to-wine resolution is overtaken by a committed merge fails wholly with
   `reconciliation_batch_stale`; no batch write or receipt survives.
9. PostgreSQL `ORDER BY uuid ASC` and the TypeScript normalized-hex comparator produce
   the exact fixed vector above. Reversed entry arrays generate byte-equivalent canonical
   JSON and the same validated result order.
10. Measured close writes its exact closeout. Discard instead writes one exact-remainder
    spill plus one distinct linked discard receipt/effect, closes only A, increments A's
    version once, and creates no measured closeout or replacement.
11. A mistaken discard report can be compensated only within 15 minutes when both the
    exact reason and same-bottle-present confirmation are supplied. Actual discard,
    uncertain possession, missing confirmation, later A activity, or expired time is
    non-mutating review/error. B remains byte-equivalent. A version-1 discard spill is
    not targetable, while its completed receipt remains replayable.

### UI/browser

12. At 320 and 390px, two active bottles are distinct, readable, keyboard selectable,
   and expose >=44px targets. Pour remains disabled until one is selected.
13. Selecting A, pouring, closing, refreshing, and returning via `/cellar/open` preserves
   exact identity. A stale `bottle=` URL clears with an explicit message; it never picks B.
14. “Open another bottle” remains available with A active. It cannot masquerade as a
    pour, and the returned B becomes the selected bottle only after a valid success.
15. Interrupted pour/close/discard/undo/reconcile shows Retry prior action with the original
    bottle/event/payload even if stock, selection, or membership UI changes.
16. Light/dark screenshots cover zero/one/two bottle states, ambiguity, insufficient
    volume, closed/stale selection, pending retry, replay “Already recorded,” and undo
    review.

### Readers and retirement

17. Compatibility aggregate reports count 2 and summed mL; cellar/search/low stock/
    atlas/auto-86 agree and no duplicate wine row is produced.
18. An effective pour counts once; its compensation removes it from sales, velocity,
    member, pricing, health, and last-depletion results while preserving both events.
19. Import/session/scan deletion of a source lot fails atomically and truthfully; an
    unrelated lot still deletes/reverts.
20. Wine merge moves relational refs without changing receipt JSON bytes; old receipt
    replay remains byte-stable apart from `replayed=true`.
21. Authenticated and service-role attempts through every retired RPC/direct table write
    fail after Phase C. A fresh v1 command returns `legacy_inventory_command_retired`;
    a completed v1 receipt still replays.
22. Phase A reports version 1. A forced Phase C failure before its final statement leaves
    version 1 and prior behavior; successful commit exposes version 2 only after writer
    retirement. Exact/effective readers honor invoker RLS, service readers are explicitly
    restaurant-scoped, and exact-reader results contain no raw `opened_by` or lot cost.

## Stop gates

Do not enable Phase C when any reader still assumes one bottle per wine, any first-party
write lacks exact identity, Undo still deletes an event, reconcile still keys state by
wine, effective analytics are incomplete, a source lot can be deleted, or the contract
version has not been exercised 1-to-2 in a disposable/local PG17 proof.

This is an app-transition plan only. It does not claim C06 complete. The approved C06
gate remains receive, place, find, serve, count and reconcile end-to-end, including
invoice/file review paths, open-vs-sealed counts, returns and credits, manager
discrepancy review, and critical E2E evidence. The named Q10 follow-on slices and their
concurrency proofs remain required too; none is silently deferred.

## Required following Q10 slices

These are required contract slices, not optional backlog and not part of this first
implementation boundary:

1. venue-managed pour/tasting presets with exact integer-mL snapshots and permission
   checks;
2. flights and split-pour line identities with explicit recorded, pending, and failed
   states plus retry proof;
3. sealed-unit and open-bottle holds with audited reserve, release, consume, and expire
   transitions plus concurrent exclusivity proof;
4. optional sealed tags with one-to-one unit attachment, lot conservation, provenance,
   duplicate-scan handling, and retag audit.
