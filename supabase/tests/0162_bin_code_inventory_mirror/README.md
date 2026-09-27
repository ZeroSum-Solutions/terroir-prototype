# 0162 bin-code inventory mirror proof

This directory proves the additive database half of the accepted bin-rename
repair. The migration adds one closed trigger function and one row trigger; it
does not alter bin RLS, table grants, receipt/history schema, or application
code.

## Source-only gate

Run with the repository's Node 20 toolchain:

```sh
node supabase/tests/0162_bin_code_inventory_mirror/source-contract.mjs
```

The source gate pins every SQL artifact, the trigger-function body, the exact
site/bin predicate, the paired no-data/no-CASCADE down, and the required live
proof cases. Passing it is not a database result.

## Bounded live proposal

Root supplies one independently admitted disposable database with migrations
through 0162 applied, plus the literal `expected_database`,
`target_admitted=on`, and frozen source hashes. Use `psql -X` with
`ON_ERROR_STOP=1` for each command.

1. Run `bin-code-mirror-contract.sql`. It rolls back all fixtures and proves
   owner/manager success, staff and cross-site refusal, current revoked-role
   rejection, exact-site/all-linked-row mirroring, no callable trigger-function
   bypass, and unrelated/history byte conservation.
2. Run `atomic-failure.sql`. It rolls back all fixtures and proves an injected
   inventory update error and a case-insensitive duplicate bin code both leave
   the bin and mirror unchanged.
3. Run `migration-cycle.sql`. Its down/up cycle is enclosed in one transaction
   and proves the paired down changes no bin or inventory data.
4. Run `concurrency-setup.sql` once. Start `concurrency-a.sql`; after its UPDATE
   reaches the eight-second hold, start `concurrency-b.sql`. While B is active,
   run `concurrency-observe.sql` and require its exact lock-wait row. Require A
   and B to exit zero in that order, then run
   `concurrency-verify-cleanup.sql`. The verifier requires the second rename
   and every linked mirror to agree before removing the exact committed
   fixture.
5. Outside these scripts, compare the admitted database and protected/global
   state before and after. There is no automatic retry. If setup succeeds but a
   session or verifier fails, retain the target and inspect it before cleanup.

The revoked-role SQL assertion uses the authoritative
`current_site_role_at_least` lifecycle predicate and separately proves that no
client role can execute the trigger function. The existing HTTP `requireRole`
gate and removal of route-side inventory writes belong to the separately owned
caller cutover; that source/unit proof must pass before the broad ACL cut.

The first admitted forward attempt reached the catalog postflight and rolled
back because `pg_get_expr(tgqual, tgrelid, false)` cannot deparse a trigger
condition that refers to both `OLD` and `NEW`. The repaired source uses
`pg_get_triggerdef(trigger_oid, false)` and compares the complete canonical
trigger definition instead. That repair has not been applied to a database;
it requires a fresh independent source review and root-owned execution.
