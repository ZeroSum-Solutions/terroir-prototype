# 0156 physical-bottle cutover SQL proof assets

These checks target an admitted disposable PostgreSQL 17 database only. They do
not activate a candidate, touch the retained local stack, or complete C06.

- `phase-c-core-acceptance.sql` proves two physical opens of one wine, four
  identity-bound pours, one atomic cross-wine batch and reversed-order replay,
  discard plus linked correction, fresh-v1 retirement, zero-mL discard refusal,
  and source-lot deletion refusal. The fixture is enclosed in `BEGIN/ROLLBACK`.
- `phase-c-acl-runtime.sql` executes the physical boundary as `authenticated`
  and proves actual permission denial (not catalog inference alone) for retired
  RPCs, direct DML, and TRUNCATE as both `authenticated` and `service_role`.
- `phase-c-down-refusal-fixture.sql` creates native/version-2 evidence for an
  outer `psql -1` invocation that appends the guarded down and expects its
  pre-mutation `unsafe_down_physical_bottle_data_present` refusal.
- `phase-c-undo-order-concurrency.sh` delays one scalar command before its
  membership lock, commits another command first, and proves event order follows
  the serialized bottle mutations while Undo of the earlier mutation is rejected
  without a receipt, effect, event, or state change.
- `scripts/0156-production-preflight.sql` repeats read-only Phase-A and active-slot
  admission under the exact NOWAIT lock set.
- `scripts/0156-production-postflight.sql` verifies the version, catalog, ACL,
  promotion, source-FK, and DELETE-trigger boundaries after forward cutover.
- The paired down refuses before mutation once any native/version-2 evidence
  exists. A safe down returns to the expanded Phase-A contract, not pre-0153.
