# Remaining 0164 concurrency proof packet

This disabled packet closes the authority, LWIN compare-and-swap, shared-source,
and inverse-session schedules without changing migration 0164 or the already
accepted core/race fixtures. It performs no database or Docker action itself.
Root executes each finite schedule on the admitted retained target as
`postgres`, using `psql -X -v ON_ERROR_STOP=1` and the exact source digest
`b5416022789c096d9b94245770e543465d74a02f60c847270254e862545294ad`.
There is no automatic retry.

## Fresh authority after waits

Run twice, rebuilding the accepted `concurrency-setup.sql` fixture and running
`concurrency-cleanup.sql` afterward. Use `wait_kind=advisory` first and
`wait_kind=batch` second. Fixed variables are:

- `actor_id=16440000-0000-4000-8000-000000000001`
- `site_id=16440000-0000-4000-8000-000000000020`
- `membership_id=16440000-0000-4000-8000-000000000040`
- `batch_id=16440000-0000-4000-8000-000000000060`

After setup, run `authority-wait-baseline.sql` and retain its exact
`c09_0164_before_state_sha256`. Start `authority-wait-a.sql`; after A has
acquired the selected lock and entered its bounded hold, start
`authority-wait-b.sql`. While B is visibly lock-waiting, run
`authority-wait-revoke.sql`. It both proves the wait and commits the one exact
lifecycle revocation. A and B must exit zero; B must have caught exact
`P0002 import_batch_not_found`. Run `authority-wait-verify.sql` with the saved
hash, then the accepted cleanup. The batch/import/inventory/wine hash must be
identical; only the declared membership lifecycle transition is retained until
cleanup.

## LWIN writer/revert both orders

Run twice with `race_mode=apply_first` and `race_mode=revert_first`. For each
mode: run `lwin-race-setup.sql`, start `lwin-race-a.sql`, start
`lwin-race-b.sql` after A enters its hold, run the accepted
`apply-revert-race-observe.sql` while B waits on the site advisory lock, wait
for both, run `lwin-race-verify.sql`, then the accepted
`concurrency-cleanup.sql`.

The newer real-apply pair must win in both orders. `apply_first` requires the
waiting old-batch revert receipt to report `lwinStampsCleared: 0`;
`revert_first` requires the first revert receipt to report
`lwinStampsCleared: 2`. Final state is the same: the old rows are reverted,
the new rows remain applied, and both wines hold the exact new 0.9 real-valued
pair with timestamp equality to the new import rows.

## Shared source and inverse sessions

Run twice with `race_kind=batch` and `race_kind=session`. For each kind, run
`source-conflict-race-setup.sql` and retain the emitted
`before_state_sha256`. Start `source-conflict-race-a.sql`, start
`source-conflict-race-b.sql` after A enters its hold, and run
`source-conflict-race-observe.sql` while B waits. Both A and B must exit zero
after independently catching exact `P04I2 import_source_conflict`. Run
`source-conflict-race-verify.sql` and `source-conflict-race-cleanup.sql` with
the saved hash.

The batch fixture has two batch claims over one exact inventory row. The
session fixture has two two-child sessions sharing two exact wine/inventory
pairs; their chunk processing order is inverse. A acquires the same site
advisory boundary before its call and holds it after the expected refusal, so
the observer proves B is serialized rather than deadlocked. The before/after
JSON state digest covers sessions, batches, rows, inventory, and wines. Cleanup
refuses unless that digest and both directions of parent ownership remain
exact.

Every setup must start from absent reserved IDs. Every cleanup must finish
before rebuilding. Root-owned full target/protected-database captures are still
required around the packet. These source definitions are not runtime proof,
type-generation proof, caller proof, browser proof, or release authorization.
