# 0163 stalled invoice-scan expiry proof

This directory covers the additive database boundary only. It does not change
the scan-history helper or page, execute a migration, or claim runtime proof.

## Source gate

Run with the repository's Node 20 toolchain:

```sh
node supabase/tests/0163_stalled_invoice_scan_expiry/source-contract.mjs
```

The gate pins every focused artifact, the function body, the authority and
isolation fences, the ordered scan lock followed by a separate final update,
the repeated eligibility/job predicates, and the guarded data-free down.

## Root-owned live proposal

On one independently admitted disposable database with 0163 applied, pass the
literal database name, `target_admitted=on`, and frozen source hashes to
`psql -X -v ON_ERROR_STOP=1`.

1. Run `stalled-scan-expiry-contract.sql`; it rolls back its fixtures and
   covers the complete expiry/job matrix, exact receipt/count, current roles,
   lifecycle refusals, recovery fence, and scan/job conservation.
2. Run `isolation-repeatable-read.sql` and `isolation-serializable.sql` in
   separate sessions. Each rolls back and requires `25000` before mutation.
3. Run `migration-cycle.sql`; its down/up cycle is one rollback-only
   transaction and preserves already-failed scan data.
4. Run each `down-refusal-*.sql` in a fresh connection and require the expected
   nonzero exit, SQLSTATE `P0001`, and `C08_0163_DOWN_BASELINE_MISMATCH`.
   Recheck that the function remains after every refused body, owner, ACL,
   search-path, overload, and dependent-object case.
5. For completion contention, run `completion-race-setup.sql`, start
   `completion-race-a.sql`, then start `completion-race-b.sql` during A's
   eight-second hold. Require `completion-race-observe.sql` to see the lock,
   then run `completion-race-verify-cleanup.sql`.
6. For re-extract contention, run `reextract-race-setup.sql`, start
   `reextract-race-a.sql`, then start `reextract-race-b.sql` during A's
   eight-second hold. Require `reextract-race-observe.sql` to see the lock,
   then run `reextract-race-verify-retained.sql`. Both orders call the literal
   `request_invoice_scan_reextract(uuid)` RPC. The fixture covers an absent job,
   a terminal job revived to queued, and expiry followed by re-extract.
7. Stop on the first failure. Compare protected schema/data/global state before
   and after. There is no automatic retry or production authorization.

The re-extract race intentionally retains one named synthetic identity because
the real RPC requires `cost.read`, and capability-grant history cannot be
deleted. The verifier requires exactly one user, its one auto-created site,
workspace, membership and workspace membership, seven reason codes, the fixed
active grant `16350000-0000-4000-8000-000000000041`, three fixed scan IDs, and
three matching queued jobs. It prints the generated site, workspace, membership,
and workspace-membership IDs. Conservation may exclude only that exact recorded
target-database delta. Protected databases still require full equality.

Concurrency claims require the named real multi-session runs; source inspection
or a single transaction is not concurrency evidence.
