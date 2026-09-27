# 0153 physical-bottle Phase A proof assets

Status: source-only. None of the commands or database cases in this directory
has been run for this migration yet.

Migration 0153 is an additive maintenance-window expansion. It keeps the
legacy one-slot-per-wine model and every legacy writer active, returns contract
version 1, and leaves both physical writer functions uncallable by application
roles. It does not activate physical bottles or complete C06.

## Files

- `phase-a-preflight-fingerprint.sql` fingerprints the complete affected
  pre-0153 data/catalog surface, including constraint names and the exact four
  pre-existing-relation index identities even when one has the wrong relation
  kind. It is used before and after each forward refusal.
- `phase-a-post-up-acceptance.sql` checks the exact additive catalog, dormant
  contract gate, readers, closeout child index, and effective-event semantics.
- `phase-a-legacy-compatibility.sql` checks a fresh version-1 command and every
  accepted additive bottle field. The harness creates a completed receipt before
  0153, compares its request/result bytes, and replays it after up, down, and
  re-up.
- `phase-a-acl-rls.sql` checks exact function/table/view ACL closure, invoker
  metadata, RLS, and the approved projection.
- `phase-a-state-fingerprint.sql` fingerprints all six affected tables, three
  unrelated tenant tables, and the 0153 catalog/ACL surface. It is used before
  and after each down refusal and safe cycle.
- `phase-a-down-acceptance.sql` verifies exact legacy restoration after a safe
  down.
- `scripts/0153-production-preflight.sql` is the non-writing production-role
  gate. Its NOWAIT probe takes real locks and must run only in the approved
  maintenance window. The migration repeats and holds those locks before it
  revalidates any mutable predicate.
- `scripts/local/physical-bottle-phase-a-rehearsal.sh` is the reviewed
  network-none PG17 disposable-database harness. It requires an exact approved
  image reference and immutable image ID, plus the reviewed 14-path manifest
  and manifest hash. It never targets an active local `postgres` database.

Pristine admission has four explicit collision classes: 14 new column pairs,
seven primary object identities, 21 newly named constraints on pre-existing
relations, and four index identities on pre-existing relations. The two legacy
constraints replaced in place are validated by the locked legacy checks, not
misclassified as collisions. Any occupied exact index name counts even when its
relation kind is wrong; constraint identity is relation plus name regardless of
constraint kind. Only 0/0/0/0 is pristine, and only 14/7/21/4 is complete.

## Required later runtime matrix

The rehearsal must capture SQLSTATE `55P03` and an unchanged complete
fingerprint separately for each forward lock target, in order:

1. `inventory_items`
2. `open_bottles`
3. `pour_events`
4. `bottle_closeouts`
5. `inventory_command_receipts`

It must repeat that proof for each guarded-down target, adding
`inventory_command_bottle_effects` sixth. A deterministic two-session case must
also hold all five forward locks, start an affected-table writer only after the
locks are confirmed, prove the writer cannot overtake the compatibility scan,
then roll both sessions back.

The post-up semantics fixture must show contract-1 events pass through
`effective_service_pour_events`; a linked contract-2 original and reversal are
both excluded only when their restaurant, wine, bottle, and inverse delta
match; malformed wrong-kind, wrong-bottle/wine, and wrong-delta links leave the
original visible; unrelated pour and spill rows retain their meaning; and RLS
plus the approved projection expose neither another tenant nor raw bottle
opener or lot cost.

The authored refusal matrix also covers forward legacy constraint, function,
trigger, source-lot drift, an exact constraint-name collision, and a wrong-kind
index-name collision. Guarded down has separate data cases for each
representable non-default bottle marker, scalar and batch receipts, physical
events, reversals, closeouts, effect rows, duplicate legacy slots, and an invalid
legacy receipt command. Catalog cases cover missing or deferrable legacy
uniqueness, drifted legacy constraints/functions/triggers, an extra function
GUC, unlisted grants, index/view/constraint/function drift, policy/RLS drift,
and an unexpected dependent view. Its sealed-constraint cases separately prove
that an extra sealed name and a renamed sealed constraint are refused, while an
unrelated table's same-named constraint is allowed through a complete down and
down-acceptance run. The two data
states that require first dropping a constraint expect the catalog guard to win;
their complete fingerprints still prove transaction rollback. The first
authorized disposable run stopped in initial operator preflight before migration
0153, so these cases remain unrun.

The catalog seals are writable by the object owner. They detect accidental
definition drift; they are not a defense against a malicious owner. The safe
cycle compares the full pre-up catalog with the post-down catalog. The post-up
versus re-up comparison is data-only because dropped and recreated columns can
receive different catalog attribute numbers. A missing sealed object still
fails closed, but a `regclass` or `regprocedure` cast may surface PostgreSQL
`42P01` or `42883` before the migration's custom drift error. The duplicate-slot
and invalid-command data predicates remain deliberate backstops even though the
catalog guard normally wins first.

`inventory_items_id_restaurant_wine_key` is intentional Phase B preparation.
It supports the accepted future tenant/wine-qualified physical-bottle foreign
key without activating Phase B or changing the Phase A contract version.

Every registered local holder is given a bounded natural-exit window, then a
bounded TERM window, then a bounded KILL window. The harness never seals if the
exact registered PID remains alive after those windows; it does not select or
signal an unrelated process.

## Safety boundary

Do not run the rehearsal against the active local stack, a hosted project, or a
database named `postgres`. Do not generate types or the schema snapshot until
the separately authorized disposable runtime proof passes. Production commands
remain documented as not run until the later runbook gate.
