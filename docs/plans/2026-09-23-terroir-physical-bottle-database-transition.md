# Q10 physical-bottle database review

Date: 2026-09-23
Repository: `/Users/zero/projects/_archive/terroir-prototype`
Branch reviewed: `feat/production-readiness-20260923`
Scope: database design only; no physical-bottle migration was written.

Status: accepted source design with B1-B4 and source-review closure F1-F3
incorporated; unimplemented.
Contract: [Individual bottles and service inventory](./2026-09-23-terroir-physical-bottle-contract.md).

## Decision

**Accept the product contract, but do not implement its `open_bottles` change as one in-place migration.** The smallest safe design is an **expand / app transition / contract** sequence over the existing `open_bottles`, `pour_events`, `bottle_closeouts`, and `inventory_command_receipts` tables. A separate replacement ledger would make every historical and analytics reader more invasive without buying a safer transition.

The contract migration must not run until bottle-aware readers and writers are deployed behind a database capability gate. In that migration, physical identity becomes effective atomically: current active legacy slots are validated and promoted, the wine/site uniqueness constraint is removed, trigger mutations become exact-ID mutations, all wine-scoped legacy RPCs are retired, and the original C02 function becomes replay-only. Enabling multiple rows while any old wine-scoped trigger/RPC is callable is a release blocker.

The narrow first slice is: multiple individually selectable open bottles of the same wine; explicit open; one-bottle pour/spill/close; one atomic exact-bottle reconciliation batch; linked compensation; exact lot consumption; aggregate read compatibility; and old-receipt replay. It does **not** implement holds, flights, presets, or sealed tags. Those remain required named follow-on slices, not optional backlog.

## C06 atomic reconciliation amendment

The canonical C06 decision is incorporated as a hard boundary, not an implementation
option: reconciliation has one exact-bottle batch RPC even for a one-entry draft. One
operation UUID owns one canonical request, one receipt, every ordered bottle/wine effect,
and one ordered result. `open_bottles.state_version` supplies the exact stale predicate;
distinct wines are locked in PostgreSQL native UUID ascending order with `FOR NO KEY
UPDATE` before exact bottles are locked in that order with `FOR UPDATE`. The batch then
rederives the distinct wine set from the locked bottles and requires exact equality with
the set already locked. Complete
validation precedes writes, and PostgreSQL transaction rollback remains the final guard
for a late second-entry failure. There are no per-bottle commits or partial-success
results. The durable UI draft stores the `state_version` read for every bottle and
freezes those values with the operation UUID and canonical payload while unresolved.
It retains the whole draft on any failure and clears it only after confirmed success
or exact replay.

## Confirmed current-state hazards

The proposal correctly identifies the core problem, but the live schema has more coupled behavior than the proposal names.

1. `open_bottles` is a reusable slot, not a bottle. `0016_pour_tracking.sql` declares `unique (wine_id, restaurant_id)` and `0044_open_bottles_closed_at.sql` revives that row with `ON CONFLICT`, resetting `opened_at`. The row ID can span several physical lifecycles.
2. Both current event triggers are wine-scoped. `pour_events_maintain_open_bottle` updates by `(wine_id, restaurant_id)`; `pour_events_reverse_open_bottle` does the same on DELETE. Merely dropping the unique constraint would make one event mutate every bottle of that wine.
3. The current capacity trigger (`0088`) compares `remaining_ml` with mutable `wines.size_ml`, not a capacity captured at opening.
4. Current `record_pour` (`0087`) auto-opens and can cross into a replacement bottle. Current reconciliation (`0046`/`0044`), close (`0061`), and undo (`0088`) all locate state by wine. Undo deletes evidence and depends on the wine-scoped DELETE trigger.
5. C02 (`0151`) makes this legacy slot atomic and retry-safe, but it deliberately serializes by wine and can loop across replacement lifecycles. Its receipts are valuable immutable evidence, not a physical-identity implementation.
6. Current live grants are broader than the migration comments imply. Catalog inspection on the guarded local PG17 stack showed DML base grants for `authenticated` and `service_role` on `open_bottles`, `pour_events`, `inventory_items`, and `bottle_closeouts`. RLS blocks ordinary authenticated writes to `open_bottles` and `pour_events`, but `service_role` bypasses RLS. `bottle_closeouts` also has an authenticated INSERT policy. Function ACLs expose `record_pour`, both reconcile functions, `undo_last_pour`, and `list_open_bottle_items` to `PUBLIC`; `close_open_bottle` and `execute_inventory_command` are authenticated-only.
7. `open_bottles.source_inventory_item_id` is `ON DELETE SET NULL`. That silently erases source provenance. `revert_import_batch` (`0109`) and `delete_invoice_scan` (`0143`) delete `inventory_items`; `revert_import_session` (`0110`) catches per-batch failures but then unconditionally marks the whole session `reverted`.
8. `merge_wines` (`0100`) updates inventory, events, reusable bottle rows, and closeouts, then deletes the source wine. It does not know about C02 receipts added later. Because `inventory_command_receipts.(wine_id, restaurant_id)` is `ON DELETE RESTRICT`, a source wine with any C02 receipt currently prevents the merge. Repointing only the relational receipt wine while comparing it to immutable request JSON would also break replay unless replay logic changes.
9. Current readers assume at most one row per wine:
   - `list_open_bottle_items` has a scalar left join.
   - The [cellar page](<../../src/app/(app)/cellar/page.tsx>) writes direct and RPC rows into `Map<wine_id,row>`, overwriting duplicates.
   - reconciliation is wine-scoped.
   - search and cellar totals consume one `open_remaining_ml` value.
   - `auto_eightysix_on_low_inventory` reads one open row, not `sum(remaining_ml)`.
   - the open-bottles page already renders rows individually, but displays mutable `wines.size_ml` rather than an opening capacity snapshot.
   - atlas only needs wine presence and remains valid if its source changes to canonical active rows.
10. Analytics and profile readers consume `pour_events` directly (`insights/pour`, member analytics, pricing recommendations, cellar health, wine profile). Keeping new exact-bottle events in that table is less invasive than introducing a parallel event ledger, but compensation semantics require an effective-events view or equivalent filter.

## Required challenges to the proposal

### Do not claim historical `open_bottle_id` values are physical identity

Old event rows that contain `open_bottle_id` can still refer to a reused slot across lifecycles. They must remain `contract_version = 1` legacy history. Do not relabel or redistribute them. Only events written after cutover, plus a validated current active slot promoted at cutover, are exact physical identity.

### Do not use catalog size after opening

New and promoted physical rows need `nominal_capacity_ml`. All new state checks use it. `wines.size_ml` is used only while opening (or while validating a legacy active row during cutover), under the wine lock. Editing the catalog later must not change capacity, replay validity, reconciliation, or undo.

### Do not let a selected action spill into a different bottle

The physical command must reject `ml > selected.remaining_ml` with `insufficient_bottle_volume`. It must not finish the selected bottle, open another, or split the event. Opening another bottle and splitting a service action are later explicit workflows.

### Do not weaken reconciliation into per-bottle commits

The existing reconciliation journey is all-or-none, and physical identity does not change
that contract. Replace the wine-only batch with one exact-bottle batch UUID and receipt,
canonical bottle-sorted entries, sorted wine-before-bottle locks, complete validation,
and all effects in one transaction. Any duplicate, stale, closed, foreign, or invalid
entry rolls back every bottle/event/effect and the receipt. The client retains the whole
draft after failure and clears it only after a validated success or exact replay; there
are no per-entry success envelopes to mistake for committed partial work.

### Preserve source provenance rather than nulling it

For native physical rows, `source_inventory_item_id` is required and must match the bottle's restaurant and wine. Promoted active legacy rows may explicitly carry `legacy_unknown` provenance. Change the source FK from `ON DELETE SET NULL` to `ON DELETE RESTRICT`; adapt import and invoice removal to report the physical dependency before attempting deletion.

### A wine merge must not rewrite receipt JSON

`request_payload` and `result_payload` are recorded facts and remain byte-for-byte unchanged. `merge_wines` may repoint non-batch relational `inventory_command_receipts.wine_id`, exact bottle-effect wine IDs, bottle rows, closeouts, and events to the target wine; a multi-wine batch receipt remains null-wine scoped. Replay compares the caller's original request to the stored request JSON and authorizes using the receipt's restaurant; it must not require the original wine row to still exist or require the relational current wine to equal the historical payload wine.

## Exact transition shape

Source review observed `0151`; C04 subsequently owns the `0152` checkpoint.
Allocate C06 migration numbers only from the normative manifest after C04 is committed;
do not reserve numbers in prose.

### Phase A — additive expansion, safe under the old app

This migration changes no current write semantics and leaves the `(wine_id, restaurant_id)` unique constraint and all current functions/triggers in place.

Add to `open_bottles`:

- `identity_contract smallint not null default 1 check (identity_contract in (1,2))`
- `identity_origin text not null default 'legacy_slot' check (identity_origin in ('legacy_slot','migrated_active','native'))`
- `nominal_capacity_ml int null check (nominal_capacity_ml is null or nominal_capacity_ml > 0)`
- `source_provenance text not null default 'legacy_unknown' check (source_provenance in ('known','legacy_unknown'))`
- `opening_operation_id uuid null`
- `state_version bigint not null default 0 check (state_version >= 0)`; every contract-2
  mutation after opening increments it exactly once
- a unique key on `(id, restaurant_id, wine_id)` for containing child FKs
- a supporting unique key on `inventory_items(id, restaurant_id, wine_id)` so source-lot containment can be enforced by a deferred composite FK
- a check, initially `NOT VALID`, requiring every contract-2 row to have capacity; native rows additionally require known source and opening operation

Add to `pour_events`:

- `event_contract smallint not null default 1 check (event_contract in (1,2))`
- `operation_id uuid null`
- `operation_entry_ordinal int null check (operation_entry_ordinal is null or operation_entry_ordinal >= 0)`
- `reversal_of_event_id uuid null references pour_events(id) on delete restrict`
- extend `kind` with `undo`
- unique partial indexes on `(restaurant_id, operation_id, operation_entry_ordinal)`
  where `operation_id is not null`, and on `reversal_of_event_id` where it is not null;
  scalar commands use ordinal zero and batches use their canonical ordinals
- a deferred composite FK `(open_bottle_id, restaurant_id, wine_id) -> open_bottles(id, restaurant_id, wine_id)`
- a deferred composite FK `(restaurant_id, operation_id) -> inventory_command_receipts(restaurant_id, operation_id)`
- a check, initially `NOT VALID`, requiring contract-2 events to have exact bottle,
  operation ID, and non-negative entry ordinal; `undo` additionally requires
  `reversal_of_event_id`

Add to `bottle_closeouts`:

- `event_contract smallint not null default 1`
- for contract 2, require an exact `open_bottle_id`
- replace its simple bottle FK with a containing deferred FK once supporting unique keys exist

Add to `inventory_command_receipts`:

- `command_version smallint not null default 1 check (command_version in (1,2))`
- extend `command_type` with `reconcile_batch`, `discard`, and `undo`
- make relational `wine_id` nullable only for a version-2 exact-bottle batch
- `scope_kind text not null default 'single_wine' check (scope_kind in ('single_wine','exact_bottle_batch'))`
- `batch_entry_count int null check (batch_entry_count is null or batch_entry_count > 0)`
- a validated shape check: every version-1 and scalar version-2 receipt remains
  `single_wine` with non-null `wine_id` and null `batch_entry_count`; only
  `command_version=2, command_type='reconcile_batch'` may be `exact_bottle_batch`, and
  it has null `wine_id` plus the exact positive entry count

This preserves all 0151 rows and indexes byte-for-behavior while refusing to pretend a
multi-wine batch belongs to one wine. The batch's complete relational wine ownership is
recorded by its exact bottle-effect rows below; request/result JSON remains immutable.

Add `inventory_command_bottle_effects` as the narrow stable resolver for offline dependencies:

```text
restaurant_id uuid
operation_id uuid
entry_ordinal int
open_bottle_id uuid
wine_id uuid
effect_type text check ('open','pour','spill','reconcile','close','discard','undo')
primary key (restaurant_id, operation_id, entry_ordinal)
unique (restaurant_id, operation_id, open_bottle_id, effect_type)
FK receipt (restaurant_id, operation_id) ON DELETE RESTRICT
FK bottle (open_bottle_id, restaurant_id, wine_id) ON DELETE RESTRICT
RLS enabled; no authenticated/service-role DML; members may read only if the UI needs it
```

`entry_ordinal` is the zero-based canonical bottle order. Add a partial unique index on
`(restaurant_id, operation_id) where effect_type='open'` so a predecessor-opening
operation resolves to exactly one bottle, while reconciliation batches may own many
bottle/wine effects honestly. The physical RPC writes the mapping in the same transaction.
Do not resolve a predecessor by parsing JSON. Existing C02 `open` receipts may be
backfilled into the mapping **only** when the stored `open_bottle.id + opened_at` exactly
matches the current active legacy slot promoted at cutover. Otherwise the old dependency
is stale/ambiguous and must fail without allocating stock.

Create, but do not expose to traffic yet:

```text
execute_physical_bottle_command(
  p_operation_id uuid,
  p_restaurant_id uuid,
  p_command text,                 -- open|pour|spill|close|discard|undo
  p_wine_id uuid,
  p_open_bottle_id uuid default null,
  p_predecessor_open_operation_id uuid default null,
  p_ml int default null,
  p_note text default null,
  p_preservation_method text default null,
  p_actual_remaining_ml int default null,
  p_written_off_ml int default 0,
  p_reason_code_id uuid default null,
  p_reversal_of_event_id uuid default null,
  p_correction_reason text default null,
  p_operator_confirms_same_bottle_present boolean default false
) returns jsonb

execute_physical_reconciliation_batch(
  p_operation_id uuid,            -- one UUID for the entire draft
  p_restaurant_id uuid,
  p_entries jsonb                  -- exact bottle entries, never wine-only
) returns jsonb
```

Reject irrelevant parameter combinations; do not ignore them. For
`pour`/`spill`/`close`/`discard`, accept exactly one selection mechanism: direct
`p_open_bottle_id`, or `p_predecessor_open_operation_id` resolved through the mapping.
`open` accepts neither. `undo` requires the original event and derives the bottle from
it. Reconciliation is available only through the batch RPC, including a batch of one;
there is no scalar reconciliation escape hatch. After Phase C, every fresh command is
version 2 and exact-bottle scoped. There is no wine-only compatibility wrapper: every
fresh version-1 or wine-only request returns `legacy_inventory_command_retired` without
mutation. Completed version-1 receipts remain replayable under the rules below.

The batch RPC accepts a non-empty bounded array whose entries have exactly
`open_bottle_id`, `expected_state_version`, `target_remaining_ml`, and nullable `note`.
Reject unknown/missing keys, non-integer or negative values, invalid UUIDs, and duplicate
bottle IDs; never collapse duplicates. Canonicalize only after exact key, type, UUID, and
duplicate validation. The canonical order is PostgreSQL native UUID ascending. The exact
TypeScript equivalent lowercases each validated canonical UUID, removes hyphens, and
compares the resulting 32 hexadecimal digits lexicographically. Request arrays, result
arrays, and every wine/bottle lock query use this order. Store that canonical request.
Reversed input order therefore
replays the same operation, while any bottle, expected version, target, or note change is
an operation-payload conflict. Store ordered results in that same canonical order.

The comparator proof uses this fixed ascending vector, which crosses both digit and UUID
field boundaries:

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

The whole batch is one manager-authorized command. It emits one completed receipt,
one exact effect/event per entry, and no per-entry commit status. The receipt's
`batch_entry_count` must equal both canonical request/result array lengths and the number
of effect rows. A failure before receipt completion aborts the receipt row too.

Phase A also adds new aggregate/read helpers and this normative request-time version
function while leaving old helpers intact:

```sql
create function public.current_inventory_contract_version()
returns smallint
language sql
stable
security invoker
set search_path = ''
as $$ select 1::smallint $$;
```

Authenticated members may execute the function; it exposes no tenant state. The exact
active-bottle reader and `effective_service_pour_events` view use
`security_invoker=true` and remain constrained by the caller's RLS. The exact reader
returns only bottle identity, restaurant/wine containment, remaining and nominal mL,
opened time, preservation, provenance class, state version, and approved source
location labels. It does not return raw `opened_by` or lot cost. Service-role consumers
must also supply an explicit restaurant predicate. The dual-capable app deploys next
and keeps physical writes disabled while this function returns `1`.

### Phase B — app transition before the contract switch

Deploy code that can read both legacy-slot and physical rows and can call the new RPC, but keep its physical command UI gated off. Required reader changes are listed below. This phase is what makes the normal “migration before application” deploy order safe.

### Phase C — atomic contract migration

The contract migration performs these steps in one transaction:

1. Lock physical inventory tables against concurrent legacy writers for the short cutover; then preflight every active legacy slot.
2. Refuse if an active row has null/non-positive catalog size, `remaining_ml <= 0`, `remaining_ml > wines.size_ml`, a non-null source lot from another site/wine, or contradictory lifecycle state. Do not default to 750 mL.
3. Promote each valid active slot to `identity_contract=2`, `identity_origin='migrated_active'`, snapshot `nominal_capacity_ml=wines.size_ml`, and initialize `state_version=0`. Preserve null source as `source_provenance='legacy_unknown'`; mark a valid same-site/wine source `known`. Closed legacy slots stay contract 1 and explicitly legacy. Native opens also start at version zero after their opening state is committed.
4. Change the source FK to `ON DELETE RESTRICT`, add/validate same-site/wine containment with deferred composite keys, and validate all contract-2 checks.
5. Drop `open_bottles_wine_id_restaurant_id_key`; add `(restaurant_id, wine_id, opened_at desc)` plus a partial active index `where closed_at is null`. Do **not** add a replacement unique-per-wine index.
6. Replace the capacity trigger so contract-2 rows compare only with `nominal_capacity_ml`.
7. Replace the insert trigger with an exact-ID contract-2 trigger. A native open row is inserted explicitly before its `new_bottle` event. `pour`, `spill`, `reconcile`, `finish_bottle`, and `undo` update only `NEW.open_bottle_id`, verify restaurant/wine containment, enforce active/capacity rules, increment that bottle's `state_version` exactly once, and never search by wine. `discard` is a command/receipt/effect type, not a `pour_events.kind`; its linked depletion event remains `spill`, and the spill plus close form one command mutation that increments the version only once. Contract-1 inserts after cutover raise `legacy_writer_retired`.
8. Drop the DELETE reversal trigger. Contract-2 evidence is never deleted; undo inserts one linked compensating event. Deny DELETE on `pour_events` at both policy and grant layers.
9. Replace `auto_eightysix_on_low_inventory` with `sum(remaining_ml) filter (where closed_at is null)` and keep its sealed-volume calculation explicit. It must also run after a successful undo/reconcile where the availability result can change.
10. Enable/grant the scalar physical RPC and atomic exact-bottle batch RPC. At the same instant, retire every legacy writer listed below and make C02 replay-only.
11. Replace merge/import/removal functions and aggregate read helpers.
12. As the final statement in this same transaction, `CREATE OR REPLACE` the body of
    `current_inventory_contract_version()` to return `2::smallint`. The route read is
    only a dispatch/UI hint; the RPC bodies, triggers, and ACL changes above enforce the
    active contract atomically. A fresh version-1 request is already non-mutating before
    the version becomes visible as 2.

## Command, lock, and error policy

For every call, including replay:

1. Require `auth.uid()` and lock the caller's membership row `FOR SHARE`; current membership is mandatory on replay.
2. Look up an already-completed receipt by `(restaurant_id, operation_id)` before mutable domain validation. If found, compare actor and canonical historical payload, then return its stored result with only the transport `replayed=true` marker. This permits replay after close, catalog-size edits, and a wine identity merge.
3. For a new operation, lock the current wine row `FOR NO KEY UPDATE`. This is compatible
   with the legacy bottle-first writer's FK `KEY SHARE` while still serializing state
   changes with `merge_wines` and retaining intentionally coarse per-wine ordering.
4. Claim the version-2 receipt. Same operation/same canonical payload blocks then replays; same operation/different actor or payload conflicts.
5. Resolve predecessor mapping if supplied; then lock the selected bottle row `FOR UPDATE`. For `open`, lock one deterministic positive-quantity source lot ordered by `(added_at,id)`, update it with a checked `quantity > 0` predicate, and require exactly one row changed.
6. Apply state, event, effect mapping, closeout, and receipt completion in the same transaction.

For `execute_physical_reconciliation_batch`, preserve the same replay-first rule but use
one deterministic multi-row lock plan:

1. Perform only structural entry validation, duplicate rejection, and canonical sorting
   before receipt lookup; these are immutable payload operations, not mutable-domain checks.
2. If a completed receipt exists, revalidate current membership and exact actor/canonical
   payload, then return the stored ordered result with `replayed=true` without inspecting
   current bottle state.
3. For a new operation, resolve the canonical bottle IDs to distinct wine IDs without
   trusting caller-supplied wine data. Lock every current wine row in PostgreSQL native
   UUID ascending order `FOR NO KEY UPDATE`, then claim the one
   `exact_bottle_batch` receipt.
4. Lock every selected bottle in ascending UUID order `FOR UPDATE`; revalidate the full
   set under lock. Rederive the distinct current wine IDs from those locked rows and
   require exact set equality with the earlier resolved/locked wine set. Any difference,
   including a concurrent identity merge between resolution and bottle locking, returns
   `reconciliation_batch_stale` and aborts the transaction. Then validate exact count,
   tenant/wine containment, active state, captured-capacity bound, and exact
   `expected_state_version`. Validate **all** entries before the first state/event write.
5. Capture one batch occurrence timestamp, write bottle/event/effect rows in canonical
   order, increment each bottle version once, build the ordered result, and complete the
   receipt. Any exception at any entry rolls back prior loop writes and the receipt.

The wine-before-bottle order is mandatory even when the submitted array is reversed. Two
overlapping batches therefore cannot deadlock by entry order: one completes first and the
other either validates against its then-current versions or fails the whole batch stale.

Error names should be stable and distinct: `physical_operation_actor_conflict`, `physical_operation_payload_conflict`, `physical_dependency_not_found`, `physical_dependency_stale`, `open_bottle_not_found`, `open_bottle_ambiguous`, `open_bottle_closed`, `open_bottle_changed`, `insufficient_bottle_volume`, `wine_size_unknown`, `invalid_physical_command`, `invalid_reconciliation_batch`, `duplicate_reconciliation_bottle`, `reconciliation_batch_stale`, `undo_already_applied`, `undo_window_expired`, and `undo_requires_review`. A foreign dependency or bottle returns the same not-found error as a missing one; it must not become a tenant-existence oracle.

No failed/foreign/stale predecessor may decrement sealed stock. Mutable validation occurs after completed-receipt lookup, as C02 now correctly does.

## Undo policy

Replace `undo_last_pour(wine_id)` with an idempotent physical `undo` command referencing an exact original event.

- Original must be an event-contract-2 `pour` or `spill` for the same tenant/bottle.
- The fixed reversal window is 15 minutes. Staff may reverse their own event;
  manager/owner may reverse any tenant event within that same window.
- The original may have no existing reversal. The unique partial index enforces that under concurrency.
- No later event on that **same bottle**, and no closeout for it, may make reversal unsafe. Events on a replacement bottle do not block reversal.
- Resulting remaining volume must be `<= nominal_capacity_ml`. A draining original may reopen its exact bottle by clearing `closed_at`; it never alters the replacement bottle.
- Insert `kind='undo'`, a negative delta, and `reversal_of_event_id`; do not delete or rewrite the original.
- A discard records the selected bottle's exact remaining mL as one contract-2 `spill`,
  writes a distinct `discard` receipt/effect linked to that spill and bottle, closes the
  exact row, writes no measured closeout or replacement, and increments state version
  exactly once.
- When the original spill is linked to a discard, undo additionally requires
  `p_correction_reason = 'mistaken_report'` and
  `p_operator_confirms_same_bottle_present = true`. These assert that the report was
  false and the same physical bottle is still present. An actual discard or uncertain
  possession returns `undo_requires_review` without mutation. No result may describe
  physically discarded wine as returned.
- Version-1 and other pre-cutover events, including known legacy discard spills, are not
  version-2 undo targets. `undo_last_pour` is retired rather than adapted. Completed
  version-1 receipts remain replayable but cannot create a new undo.
- If a retained offline report cannot be safely applied, return/record `undo_requires_review` in that report workflow. Do not mutate bottle state to make the report fit.

Add an `effective_service_pour_events` view with `security_invoker=true` (or an exact
equivalent tenant-authorized RPC) that excludes reversal rows and excludes originals
with a linked reversal. Authenticated reads remain subject to RLS, and every service-role
consumer supplies an explicit restaurant predicate. Move sales, revenue, velocity,
member attribution, and “last depletion” readers to it. Otherwise append-only
compensation would restore stock but leave sales analytics overstated.

## Stable C02 receipt replay

`execute_inventory_command` keeps its exact 0151 signature but becomes **replay-only** in Phase C:

- authorize using current membership at the receipt's restaurant;
- reconstruct the version-1 canonical request exactly;
- require the same actor and byte-equivalent stored request payload;
- return the stored result unchanged except `replayed=true`;
- if no completed version-1 receipt exists, raise `legacy_inventory_command_retired` and perform no write;
- do not require current `wines.size_ml`, current bottle state, or even the historical source wine row after a valid identity merge.

Do not rewrite version-1 `request_payload` or `result_payload`, backfill new fields into them, or “correct” their old reusable-slot snapshots. New commands use `command_version=2`. The new RPC uses the same receipt PK, so an operation UUID cannot cross the old/new command boundary silently.

## Legacy writer retirement checklist

All items below are part of Phase C, not a later cleanup:

| Writer or mutation path | Required treatment |
|---|---|
| `execute_inventory_command` (0151) | Replace with completed-v1-replay-only body; no fresh legacy writes. |
| `record_pour` (0087) | Revoke from `PUBLIC`, `anon`, `authenticated`, and `service_role`; retain body only for down/forensics. |
| `reconcile_open_bottle` and `reconcile_open_bottles_batch` (0046/0044) | Revoke all app roles; the only replacement is one atomic exact-bottle batch RPC, including for a one-entry draft. |
| `close_open_bottle` (0061) | Revoke all app roles; exact bottle close goes through v2 receipt boundary. |
| `undo_last_pour` (0088) | Revoke all app roles; never delete events after cutover. |
| `pour_events_maintain_open_bottle` | Replace with exact-ID/version-aware trigger; reject contract-1 inserts. |
| `pour_events_reverse_open_bottle` and its DELETE trigger | Drop. |
| `open_bottles_enforce_capacity` | Replace mutable catalog lookup with captured capacity. |
| Direct `open_bottles`/`pour_events` DML | Revoke DML from authenticated and service role; RLS remains enabled; only owner-run security-definer functions write. |
| Direct `bottle_closeouts` insert | Drop authenticated INSERT policy and revoke DML from authenticated/service role; close RPC is sole writer. |
| Receipt/effect mapping DML | No client or service-role writes; authenticated has no receipt-table visibility. |
| `revert_import_batch` (0109) | Preflight physical source references and raise a domain error before changing row status. A blocked batch stays non-reverted. |
| `revert_import_session` (0110) | Do not set the session to `reverted` if any non-reverted batch was blocked; keep `in_progress` and return per-batch reasons. |
| `delete_invoice_scan` (0143) | Refuse atomically when any inventory row is a bottle source; insert no deletion audit and delete nothing. |
| `inventory_items_reflect_import_delete` (0086) | Add an earlier explicit source-dependency guard; a failed delete rolls back its import-row state change. |
| `merge_wines` (0100) | Repoint physical bottles, events, closeouts, non-batch receipt wine IDs, and every batch/scalar effect wine dependency; batch receipts stay null-wine scoped. Defer containment FKs; never alter receipt JSON/order. Add moved counts. |
| Old API/service code | Remove wine-only undo/reconcile and implicit auto-open/cross-bottle behavior. Both close routes must call the exact physical command without a mutable pre-read being authoritative. |

`inventory_items` remains an editable sealed lot table because receiving, scans, imports, and manager corrections already write it. That is not permission to claim every inventory mutation is receipt-safe. The physical opening RPC is the only path allowed to transform one sealed unit into an open bottle; direct lot edits/removals must fail when they would erase an existing physical source.

## Reader transition checklist

- `list_open_bottle_items`: keep a compatibility result with **sum of active mL** and add `active_bottle_count`; never produce one duplicate list row per bottle. Add a separate exact-bottle helper for service/reconciliation.
- [Cellar page](<../../src/app/(app)/cellar/page.tsx>): replace `Map<wine_id,row>` overwrite behavior with per-wine aggregate plus a bottle array; calculate draining history by exact event identity/version.
- `/cellar/open`: show every active physical row and use `nominal_capacity_ml`, not current wine size.
- reconciliation page/API: submit one operation UUID plus canonical entries containing
  exactly `open_bottle_id`, `expected_state_version`, `target_remaining_ml`, and a
  nullable `note` key to the exact-bottle batch RPC. Persist the version read for each
  bottle in the durable draft and freeze it with the unresolved UUID/payload. Never loop
  scalar RPCs. Retain the entire draft on any error and clear it only after validated
  success or exact replay.
- exact active-bottle reader: use its privacy-safe projection only. Do not expose raw
  `opened_by` or source-lot cost to the service UI.
- pour/close/undo APIs: require exact bottle or a predecessor opening operation. No implicit opening and no silent split.
- search, cellar totals, low-stock, atlas, and auto-86: aggregate active rows with `sum`/`count`; atlas may reduce to a distinct wine set.
- insights, pricing recommendations, member analytics, cellar health, and wine profile: read effective service events so compensation is honored while legacy events remain visible as legacy history.
- import orphan cleanup: `open_bottles` remains in the reference sweep, and immutable physical history should make wine deletion fail closed rather than cascade-delete it.

## Identity merge details

Retain `merge_wines`' deterministic wine-lock ordering. Because the new containment FKs span inventory lots, bottles, events, and receipts, declare them `DEFERRABLE` and defer them inside the merge transaction before repointing children. The target and source must still share restaurant, lineage, vintage, and format.

Update in one transaction:

1. `inventory_items.wine_id`
2. physical/legacy `open_bottles.wine_id`
3. `pour_events.wine_id`
4. `bottle_closeouts.wine_id`
5. non-batch `inventory_command_receipts.wine_id` (relational current identity only;
   exact-bottle batch receipts remain null-scoped)
6. `inventory_command_bottle_effects.wine_id` for every affected batch/scalar bottle
7. every other existing referrer already covered by 0100

Receipt JSON, canonical batch entry order, and event/bottle IDs stay unchanged. Replay of
an old operation still uses the original `p_wine_id` found in stored request JSON and
returns its original result snapshot. A batch receipt never acquires a fabricated single
wine during merge; its relational effect rows move to the target wine with their bottles.
New operations use the target wine ID.

## Import and removal behavior

An inventory lot that supplied a bottle is historical provenance even after its quantity reaches zero. It cannot be deleted by an import revert, invoice deletion, ordinary member delete, or cleanup job.

- `revert_import_batch`: before flipping any applied row, collect all referenced inventory IDs and refuse the entire batch if any are bottle sources. Do not partially label the batch reverted.
- `revert_import_session`: may continue isolating batches, but its final session status is `reverted` only if every child is actually reverted; otherwise remain `in_progress` and return `physical_bottle_dependency` for blocked children.
- `delete_invoice_scan`: preflight all inventory rows for source references under the scan lock. Any reference means zero inventory deletion, zero scan deletion, and zero deletion-audit insertion.
- direct inventory DELETE: a trigger produces the same stable dependency error before the existing import-reflection trigger. FK `RESTRICT` is the final invariant.

## Guarded down migration

The down migration must inspect data before changing any object. Refuse with `unsafe_down_physical_bottle_data_present` if any of these is true:

- any completed version-2 receipt or effect mapping exists;
- any contract-2 event, reversal, native physical bottle, or contract-2 closeout exists;
- any `(restaurant_id,wine_id)` has more than one bottle row (active or closed);
- any row cannot satisfy the restored legacy uniqueness/capacity assumptions.

If no physical command has occurred, it may demote only cutover-promoted legacy active rows, restore the old unique constraint/functions/triggers/grants, restore the source FK behavior, and remove additive objects. Once two physical bottles or exact history exist, rollback is a forward-fix or backup-restore decision; it must never merge, discard, or relabel history.

## Concrete live acceptance suite

Run on a guarded local/disposable PG17 database, with real authenticated JWT contexts where authorization matters.

1. **Cutover preflight:** known active size promotes exactly; null/non-positive size, `remaining > size`, foreign source lot, and contradictory active-zero row each abort the whole migration with no partial DDL/data.
2. **Two physical opens:** two explicit operations for one wine consume two sealed units and create two distinct immutable IDs, capacities, opening events, effects, receipts, and initial state versions. Source lot/site/wine containment holds.
3. **Selected pour/spill:** pour one bottle and spill the other; each event/state delta touches only its selected ID and increments only that version. `ml > remaining` rolls back completely and never opens/splits.
4. **Atomic batch success:** one two-entry reconciliation spanning two wines updates both exact bottles, increments each version once, and creates exactly one null-wine `exact_bottle_batch` receipt, two canonically ordered effects/events, and one ordered result. Captured capacities still bound both after catalog edits.
5. **Canonical replay/conflict:** reverse the submitted entry order under the same UUID and get the identical stored result/replay with no new rows. Reuse that UUID with a changed bottle, expected version, target, note, actor, duplicate, missing, or extra field and get a conflict/validation error with no mutation. Two simultaneous identical calls converge on the same receipt/result.
6. **Duplicate/foreign validation:** duplicate bottle IDs are rejected rather than collapsed. A missing, foreign-tenant, closed, over-capacity, or malformed entry aborts the whole batch without exposing foreign existence or creating a receipt/effect/event.
7. **Stale-entry total rollback:** make the second canonical bottle stale after the draft was read. The batch changes neither requested bottle, writes no batch receipt/effect/event, and returns `reconciliation_batch_stale`; the unrelated concurrent mutation remains. No first-entry credit survives.
8. **Late second-entry rollback:** in a guarded outer-rollback test only, install an operation-and-bottle-scoped temporary trigger that raises while writing the second canonical event. Prove the first bottle write/event/effect, second bottle, receipt, and all trigger residue roll back. No production failpoint is added.
9. **Reversed-order concurrency:** run distinct overlapping batches submitted as `[A,B]` and `[B,A]`. Sorted wine-before-bottle locks produce no deadlock; one valid batch completes and the other completes only if its versions remain current, otherwise it fails wholly stale. There is never a mixed per-bottle outcome.
10. **Close:** close A while B remains active; closeout/event name A exactly. Replaying after close returns the original receipt and adds no rows.
11. **Legacy-client cutoff:** after Phase C, fresh version-1 and wine-only calls return
   `legacy_inventory_command_retired` with zero mutations whether zero, one, or multiple
   active bottles exist. No compatibility wrapper selects a bottle or auto-opens one.
12. **Same UUID open concurrency:** two simultaneous identical opens on the last sealed unit yield one physical mutation and identical stored result/replay.
13. **Different UUID open concurrency:** two simultaneous distinct opens on one sealed unit yield one success and one `no_inventory`, never negative stock or a source-less bottle.
14. **Scalar operation conflict:** same UUID with different bottle, amount, command, predecessor, or actor returns the appropriate conflict and no mutation.
15. **Dependency resolution:** valid predecessor opening maps to its bottle; incomplete, stale, foreign-tenant, wrong-wine, and ambiguous legacy receipts allocate no stock and create no event.
16. **Authority:** revoked membership cannot replay either scalar or batch receipts; cross-site wine/bottle/lot/reason/event IDs all fail without revealing or mutating foreign state.
17. **Compensation:** undo one exact event once; duplicate/concurrent undo is rejected; capacity holds; a replacement bottle remains untouched; a later same-bottle event or closeout produces `undo_requires_review` and preserves evidence.
18. **Legacy bypass closure:** direct calls to every retired RPC and direct DML against bottles/events/closeouts/receipts/effects fail for authenticated and service-role clients; version-1 event insert is rejected after cutover.
19. **Import/invoice removal:** batch revert, session revert, invoice deletion, and direct lot deletion are blocked by a source reference; quantities, import statuses, scan, and audits remain unchanged. An unrelated lot still reverts/deletes normally.
20. **Identity merge:** merge a source wine with two active bottles, events, closeout, scalar receipts, and a multi-wine batch receipt. All relational refs/effects move to target, the batch receipt remains null-wine, all IDs and receipt JSON bytes/order remain unchanged, moved counts are correct, and old receipts replay using historical payloads.
21. **Reader totals:** exact bottle list returns two rows; compatibility aggregate returns count 2 and correct summed mL; cellar/search/atlas/auto-86 agree; no JavaScript map overwrite.
22. **Analytics:** an ordinary pour contributes exact positive mL once; its compensation removes it from effective sales/velocity/member totals without deleting either ledger row; spill remains waste, not revenue.
23. **Catalog edit:** opening at 750, editing catalog to 375/null, then pour/batch reconcile/close/replay all use 750 captured capacity and stored receipts.
24. **Down refusal:** untouched expansion can go down/up; promoted-only/no-new-write state can go down/up; any native bottle, v2 scalar/batch receipt, effect, event, reversal, or duplicate row makes down fail before mutation.
25. **Conservation:** across opens, pours, spills, atomic reconciliation, undo, and close, prove sealed units plus each bottle's captured/opened/removed volumes independently; do not infer correctness from wine-level totals alone.
26. **Whole-draft UI retention:** browser/API tests at required mobile widths prove every failed batch keeps every draft row and shows one whole-batch error with no row labeled committed; only validated success or exact replay clears the draft. Refreshing stale versions or otherwise changing payload requires a new operation UUID.
27. **Legacy lock compatibility:** in two deterministic sessions, pause the legacy
   slot-first writer after its bottle lock and FK `KEY SHARE`, then invoke both the new
   scalar command and a batch containing that wine. `FOR NO KEY UPDATE` on wine followed
   by exact bottle `FOR UPDATE` produces no deadlock; each call either completes in the
   defined order or returns its ordinary stale/closed outcome.
28. **Merge during batch resolution:** pause the batch after its initial bottle-to-wine
   resolution, commit a concurrent wine merge, and resume. The under-lock wine-set
   equality check returns `reconciliation_batch_stale`; no bottle, event, effect, or
   receipt change from the batch survives.
29. **UUID order parity:** PostgreSQL `ORDER BY uuid ASC` and the TypeScript normalized
   32-hex comparator produce the exact fixed vector above, including `09/0a`, `0f/10`,
   and all listed field-boundary pairs. Reversed requests produce the same canonical JSON,
   lock order, stored request, and result order.
30. **Measured close versus discard:** measured close writes its exact closeout. Discard
   writes one exact-remainder spill plus one linked `discard` receipt/effect, no measured
   closeout or replacement, closes only that bottle, and increments its state version once.
31. **Mistaken discard correction:** within 15 minutes, with
   `correction_reason='mistaken_report'` and explicit confirmation that the same physical
   bottle remains present, one linked version-2 compensation may restore only that bottle.
   A missing confirmation, a different reason, an actual discard, uncertain possession,
   a later same-bottle event/closeout, or an expired window returns
   `undo_requires_review` or `undo_window_expired` with zero mutations. A replacement
   bottle is byte-equivalent before and after.
32. **Prior-version Undo boundary:** a version-1 or pre-cutover event, including a known
   legacy discard spill, cannot be targeted by the version-2 undo command.
   `undo_last_pour` is uncallable, the attempted correction is non-mutating, and a
   completed version-1 receipt still replays byte-stably.
33. **Version and reader boundary:** Phase A returns contract version 1. The Phase C
   transaction exposes version 2 only after every writer/ACL change is complete; a forced
   pre-final-statement failure leaves version 1 and all prior schema behavior. The exact
   and effective-event readers honor invoker RLS, service consumers require an explicit
   restaurant predicate, and neither raw `opened_by` nor lot cost appears in the exact
   reader result.

## Required following Q10 slices

The first slice intentionally provides stable identities consumed by these later slices:

1. venue-managed pour/tasting presets with exact integer-mL snapshots;
2. flight/split-pour line identities and per-line retry/result states;
3. sealed-unit and open-bottle holds with audited reserve/release/consume/expire transitions;
4. optional sealed tags whose one-to-one unit attachment cannot increase lot quantity and whose provenance follows open/transfer.

C06/production readiness remains incomplete until those journeys and their stated
concurrency proofs land. The approved C06 gate also requires receive, place, find,
serve, count and reconcile end-to-end, including invoice/file review paths,
open-vs-sealed counts, returns and credits, manager discrepancy review, and critical
E2E evidence. The physical first slice is independently shippable only as the identity
and service-command foundation; it cannot complete C06 by itself.

## Disposable PG17 pattern already proven for migration rehearsal

The existing Supabase database container is PostgreSQL/`pg_restore` 17.6; the host PG16 client cannot read its dump format 1.16. For a migration-only disposable database inside that container:

1. Generate the archive list with container PG17: `docker exec -i supabase_db_terroir-vw-local pg_restore --list < BACKUP > /tmp/restore.list`.
2. Comment the `pg_cron | cron` archive-list lines because this image permits `pg_cron` only in database `postgres`, then copy the edited list into the container.
3. Verify the exact disposable database name is absent; create it as `supabase_admin` from `template0`.
4. Restore as `supabase_admin` with `--exit-on-error --use-list=...`. Do not restore as `postgres`; in this local image `postgres` is not the ownership-capable superuser and ownership restoration fails.
5. Apply migration/down/up through `docker exec -i ... psql -U supabase_admin -d EXACT_NAME -X -v ON_ERROR_STOP=1`.
6. Validate only that exact database, drop only that exact name, and prove its catalog count is zero. Never reset or repurpose the live local `postgres` database.

For the separate full disaster-restore rehearsal, the parent run's isolated PG17 container and role/bootstrap proof is authoritative; this pattern is only the already-proven migration/down/up method.

## Evidence anchors

- Reusable slot and original wine-scoped trigger: `supabase/migrations/0016_pour_tracking.sql:25-102`.
- Row revival and scalar list helper: `supabase/migrations/0044_open_bottles_closed_at.sql:20-62,303-348`.
- Wine-scoped DELETE reversal: `supabase/migrations/0050_pour_events_delete_trigger.sql:13-54`.
- Wine-scoped close: `supabase/migrations/0061_close_open_bottle.sql:10-96`.
- Auto-open/cross-replacement pour: `supabase/migrations/0087_record_pour_overage_shortfall.sql:26-160`.
- Delete-based undo and mutable catalog capacity: `supabase/migrations/0088_undo_last_pour_single_reversal.sql:60-168`.
- Identity merge referrer updates: `supabase/migrations/0100_wine_identity_merge.sql:62-236`.
- Batch/session removal behavior: `supabase/migrations/0109_revert_import_batch_v2.sql:42-125`; `supabase/migrations/0110_revert_import_session.sql:31-92`.
- Invoice inventory deletion: `supabase/migrations/0143_invoice_scan_deletion.sql:175-254`.
- C02 receipt and reusable-slot assumptions: `supabase/migrations/0151_inventory_commands.sql:9-474`.
- Duplicate-overwriting readers: [`src/app/(app)/cellar/page.tsx`](<../../src/app/(app)/cellar/page.tsx>), lines 236-257; wine-only reconciliation in `src/domains/cellar/reconcile-service.ts:31-69`.
- Legacy undo caller: `src/domains/pours/pour-service.ts:94-143`; explicit close still performs a pre-read at `src/domains/pours/pour-service.ts:164-203`.
- Direct event analytics readers: `src/app/api/insights/pour/route.ts:51-215`, `src/app/api/member-analytics/route.ts:20-64`, `src/lib/pricing-recommendations/recompute.ts:101-212`, and `src/lib/cellar-health/recompute.ts:95-136`.

## Author remediation status

**B1-B4 are incorporated as an authoring contract, not independently accepted.** A
one-migration unique-constraint removal, historical `open_bottle_id` trust,
catalog-sized capacity checks, `SET NULL` provenance, HTTP-only retirement, a
wine-only compatibility wrapper, or weaker lock/revalidation semantics remains unsafe.
No migration, application code, runtime rehearsal, or source-ledger promotion has been
performed. Independent source review is required before implementation begins.
