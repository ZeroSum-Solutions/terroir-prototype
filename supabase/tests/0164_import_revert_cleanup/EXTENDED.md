# 0164 extended rollback matrix

This additive packet leaves the independently executed core files unchanged.
It covers the remaining single-transaction LWIN, atomicity, session rollback,
and catalog/history conservation cases in `extended-matrix.sql`.

Run `node --test extended-source-contract.mjs` before database admission. The
SQL fixture must run as `postgres` on the exact retained target where migration
0164 is already applied. Supply `expected_database`, `target_admitted=on`, and
the exact `source_0164_sha256`. It performs real apply calls, runs every revert
case inside one outer transaction, rolls back, and emits only
`C09_0164_EXTENDED_MATRIX_PASS` on success.

This packet is not multi-session concurrency proof. The already separate
apply/revert schedules and the remaining shared-inventory, LWIN-write, and
physical-open schedules require independent execution and evidence.
