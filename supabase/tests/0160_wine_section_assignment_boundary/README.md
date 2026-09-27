# 0160 wine-section assignment database contracts

Status: source-only and unexecuted. Root is the sole database executor.

`section-assignment-contract.sql` is the primary rollback-only contract. It
admits only the separately named disposable target cloned from pinned B after
0159 and 0160 have been applied. Its fixtures, authority mutations, and
section writes remain inside one `BEGIN`/`ROLLBACK`. It covers exact catalog
and ACL shape, owner and manager success without cost access, staff with cost
access refusal, anonymous/service/cross-site/current-lifecycle refusals,
authorization precedence, input bounds, duplicate/missing/foreign all-or-none
behavior, zero inventory, multi-lot updates, strict two-key receipts, and
stock/cost/physical-state conservation.

`migration-cycle.sql` runs the exact 0160 down migration and forward migration
inside one transaction, observes absence then exact restored definition, and
rolls back to the already-applied starting state. Its `\ir` paths are relative
to this directory.

`source-contract.mjs` is a built-in-Node source check. It performs no database,
Docker, network, package, credential, or Git action.

`CONCURRENCY-PROPOSAL.md` is intentionally not a passing test. It records the
minimum real two-session proof still required for overlapping assignments and
0158 new-lot ordering; the rollback-only contract makes no concurrency claim.

Runtime order proposed for root after independent review:

1. Freshly admit the exact clone and source pins, then commit 0159 and 0160 so
   the metadata generator's separate connection can see the new definition.
2. Run `section-assignment-contract.sql` with all four admission variables and
   require its sole PASS marker plus an outer target-conservation check.
3. Run `migration-cycle.sql` with its five admission variables and require its
   sole PASS marker plus the same conservation check.
4. Treat concurrency as pending until the separate proposal has an
   independently reviewed harness and captured two-session wait evidence.
