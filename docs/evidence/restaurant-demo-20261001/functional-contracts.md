# Independent Mobile-C database verification

Result: PASS for the bounded 0162/0163 functional contracts. Staff-cost secrecy
is separately FAIL; see `staff-raw-cost-failure.md`. This is not whole M1–M5.

The verifier did not author either migration or these existing SQL contracts.
The verifier authored the portable application fixture and therefore does not
independently certify that fixture here.

Source checkpoint observed at proof capture:
`ffced31d0964082c2554b1e566d5762e4c36619a`.
Exact SHA256 pins:

- 0162 functional SQL: `24d77f92e652fce41cb00f7a17c130d3e0454333c85dc7fa8d23880205e6136c`
- 0163 functional SQL: `f67503d89fa164970f38b62f37d8b57a9f9346e077148846c6e6e1cfa05cf533`
- Portable launcher: `fc8a856dd766d2322ad279ada7e9525861a51bc13e721b3afe65990058006e84`
- Portable fixture: `2db52e17ddeb329855d0de164e14370951c112dba105979ec4c294156029988b`

Only the executed contracts, actual admission and observation are certified;
listing the launcher/fixture pins does not constitute review of those sources.

## Actual admission

Exact endpoint `unix:///Users/zero/.orbstack/run/docker.sock`, daemon
`orbstack|29.4.0`, database `postgres`, immutable database container
`be1e35bbb6f67dda282207f8de293920146381dfaa1119ebb98c6625fd47b350`,
name `/supabase_db_terroir-demo-20261001-mobile-c`, project label
`terroir-demo-20261001-mobile-c`, and published `5432/tcp` binding exactly
`127.0.0.1:62322` were independently checked immediately before execution.

Read-only ledger query:

```sql
begin transaction read only;
select count(*) || '/' || max(version) from supabase_migrations.schema_migrations;
select public.current_inventory_contract_version();
rollback;
```

Actual stdout: `136/0164`, then `2`. Stderr empty; exit 0.

## Commands and outcomes

Both commands used this exact Docker endpoint and immutable container:

```sh
docker --host unix:///Users/zero/.orbstack/run/docker.sock exec -i be1e35bbb6f67dda282207f8de293920146381dfaa1119ebb98c6625fd47b350 psql -X -v ON_ERROR_STOP=1 -qAt -U postgres -d postgres -v expected_database=postgres -v target_admitted=on -v source_0162_sha256=c899f1f5113773f0cc826a227bc0c800c4303cc2a6bc5a945bd5b040ced01955 < supabase/tests/0162_bin_code_inventory_mirror/bin-code-mirror-contract.sql
docker --host unix:///Users/zero/.orbstack/run/docker.sock exec -i be1e35bbb6f67dda282207f8de293920146381dfaa1119ebb98c6625fd47b350 psql -X -v ON_ERROR_STOP=1 -qAt -U postgres -d postgres -v expected_database=postgres -v target_admitted=on -v source_0163_sha256=ed98ab776aca2c509b691709da00c3a698789f613d493c3abb3eb0e902e57475 < supabase/tests/0163_stalled_invoice_scan_expiry/stalled-scan-expiry-contract.sql
```

Working directory: `/Users/zero/projects/_archive/terroir-prototype`.
Migration SHA256 values were recomputed and matched immediately before each
execution. Node piped the exact SQL file bytes into each recorded command.

0162 stdout:

```text
1
16200000-0000-4000-8000-000000000001
16200000-0000-4000-8000-000000000002
16200000-0000-4000-8000-000000000003
1
16200000-0000-4000-8000-000000000002
1
16200000-0000-4000-8000-000000000005
1
C07_0162_BIN_CODE_MIRROR_CONTRACT_PASS
```

Exit 0, stderr empty. Proved trigger posture, exact-site/all-linked inventory
mirroring, unchanged receiving receipts/reconciliation history/unrelated rows,
owner/manager success, staff/cross-site denial and current revoked-authority denial.

0163 stdout:

```text
1
16300000-0000-4000-8000-000000000003
C08_0163_STALLED_SCAN_EXPIRY_CONTRACT_PASS
```

Exit 0, stderr empty. Proved the 11 eligible expiry cases, exact safe receipt,
zero-repeat count, 15-minute scan and 5-minute lease boundaries, current role
success, revoked/expired/workspace-revoked/cross-site/anonymous denial, scan/job
conservation and the worker recovery fence.

Both files ended with ROLLBACK. A subsequent read-only query found zero rows
with the exact `16200000-` or `16300000-` prefixes in `auth.users`,
`public.restaurants`, `public.inventory_items` and `public.invoice_scans`.
All resources and the restaurant browser fixture were preserved.

Concurrency evidence, mutation HTTP callers, schema/type drift comparison and
the canonical mandatory live-test suites are not claimed by this packet.
