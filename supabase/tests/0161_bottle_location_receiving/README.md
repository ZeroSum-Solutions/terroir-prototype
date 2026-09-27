# 0161 bottle-location receiving proofs

This directory is the focused proof surface for the additive
`receive_bottle_at_location_private(uuid,uuid,uuid,text,uuid)` boundary. The
SQL sources do not select a database, start services, or read credentials.
Root must independently admit one disposable loopback target and pass its exact
database name with `target_admitted=on`.

## Source-only check

```sh
node supabase/tests/0161_bottle_location_receiving/source-contract.mjs
```

This checks the immutable forward/down/test hashes, exact function body hash,
receipt-family constraint preservation, lock order, ACL posture, typed errors,
rollback guard, and the presence of the functional and real-concurrency proof
definitions. It does not parse or execute SQL.

## Transactional runtime proofs (not run by the author)

After applying the independently admitted 0161 forward migration to the same
disposable target, root runs these as `postgres`, with `-X -v ON_ERROR_STOP=1`,
the exact admitted database name, and the frozen source hashes:

1. `bottle-location-contract.sql`
2. `atomic-and-malformed.sql`
3. `receipt-compatibility.sql`
4. `migration-cycle.sql`

All four use bounded timeouts and roll back every fixture. The populated down
test is deliberately separate: `down-history-refusal.sql` must exit nonzero
with SQLSTATE `P0001` and `C06_0161_DOWN_REFUSES_DURABLE_HISTORY`; after the
connection rolls back, root must prove the exact function and receipt
constraints remain applied.

## Two-session concurrency proof

This proof is committed-fixture work and therefore runs only after a separate
execution admission on the disposable target. It is a fixed sequence, not a
generic runner:

1. Run `concurrency-setup.sql` once.
2. Start `concurrency-same-a.sql`; only after session A is observed sleeping,
   start `concurrency-same-b.sql`.
3. While B is blocked, run `concurrency-observe.sql` with
   `waiter_application_name=c06_0161_same_b`. Require its exact one-row lock
   wait result. Wait for both sessions; require both JSON outputs to have the
   same ten stored-result keys, with only `replayed` changing false to true.
4. Start `concurrency-bin-a.sql`; only after A is observed sleeping, start
   `concurrency-bin-b.sql`.
5. While B is blocked, run `concurrency-observe.sql` with
   `waiter_application_name=c06_0161_bin_b`. Require its exact lock wait.
6. After both finish, run `concurrency-verify-cleanup.sql`. It proves one item
   for the shared operation and proves the receive committed the original
   bin ID/code pair before the later serialized rename/retirement. It then
   removes only reserved 0161 fixtures.
7. Root must compare the complete protected database/global state to the
   pre-fixture capture. Scheduler order without both observed lock waits is a
   failed concurrency proof.

There is no automatic retry. A timeout, missing wait observation, output
mismatch, cleanup mismatch, or conservation mismatch fails the proof.
