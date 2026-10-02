# 0164 retained-catalog import revert proof package

This directory defines source and database proofs for
`0164_import_revert_cleanup.sql`. The migration keeps wines and history,
atomically reverses owned inventory and eligible LWIN pairs, and serializes
same-site apply/revert operations. No database proof has run merely because the
source contract passes.

Run `node --test source-contract.mjs` first. Database execution belongs on an
independently admitted disposable target, as `postgres`, with `ON_ERROR_STOP`
and the exact source hashes supplied to the rollback-only fixtures.

The main rollback-only sequence is:

1. `import-revert-contract.sql`
2. `isolation-refusals.sql`
3. `migration-cycle.sql`

The forward refusal fixture runs on a pre-0164 baseline once per `drift_kind`:
`helper_body`, `apply_owner`, `trigger`, and `constraint`. The down metadata
fixture runs once per `drift_kind`: `owner`, `acl`, and `search_path`. The body
and dependent down refusals are separate expected-failure invocations. Every
expected refusal must exit nonzero at the guarded migration; reaching the
fixture's `ERROR_*` marker is failure.

`concurrency-setup.sql` creates the closed committed fixture used by the
concurrency scripts. It refuses unless the exact admitted 0164 source digest
is supplied and all reserved IDs are absent. The fixed actor, site, membership,
revert batch, and apply batch IDs end in `0001`, `0020`, `0040`, `0060`, and
`0061`, respectively, under the `16440000-0000-4000-8000-000000000000`
prefix. The two-row apply batch resolves to the same two wines as the already
applied revert batch, in the inverse row-number order. Connection A validates
the two-wine inverse ordering before the race. Supply `actor_id`, `site_id`,
`apply_batch_id`, and `revert_batch_id` from those fixed IDs.

Run `apply-revert-race-a.sql` first and `apply-revert-race-b.sql` second, then
run the observer while B is blocked and the verifier after both exit. Repeat
with `race_mode=apply_first` and `race_mode=revert_first`, rebuilding the exact
fixture between directions. The observer must see B waiting on an advisory
lock. Run `concurrency-cleanup.sql` after each direction and before rebuilding.
It derives only the reserved user's explicit and auto-onboarding parents,
asserts exact cardinalities and both directions of membership ownership, and
deletes nothing unless the closed fixture remains uncontaminated.

For authority races, supply one applied batch plus its current actor,
membership, and site. Run A/B/revoke/verify twice: once with
`wait_kind=advisory`, once with `wait_kind=batch`. The revocation command runs
only after `authority-wait-baseline.sql` captures the exact batch/row/
inventory/wine digest and B is observed waiting. B must return exact
`P0002 import_batch_not_found`, and the verifier must find the batch/import/
inventory/wine digest unchanged. Run the exact cleanup before rebuilding for
the second wait kind; do not restore the revoked membership in place.

Expected success markers are prefixed `C09_0164_`. Source success is not a
database, generated-types, caller, browser, hosted, or release result.
