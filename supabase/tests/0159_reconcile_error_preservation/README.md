# 0159 reconciliation error-preservation proof

Status: source-only and unexecuted for the canonical `0159` wrapper.

`reconcile-error-preservation-contract.sql` is a rollback-only psql entrypoint for
the three stable-error cases repaired by the migration:

- changed-input idempotency conflict;
- repeated Undo after a completed Undo; and
- stale-subject Undo after the subject changed.

The central `do $reconcile_error_preservation_contract$ ...` block is byte-for-byte
the already reviewed control-v2 block. The canonical wrapper adds only a required
`source_0159_sha256` pin and a stronger safety header.

## Safety boundary

Run this test only in the separately authorized disposable local database named
`terroir_cost_seal_20260926b`, after applying the exact canonical forward migration.
Never run it against production, a hosted project, the active local stack, or a
database with another session or pre-existing fixture rows. The SQL independently
requires the exact database/user/catalog/empty-state boundary before inserting any
fixture. Every fixture write is enclosed by its own `BEGIN`/`ROLLBACK` boundary.

The caller supplies the already authorized local psql connection. This folder
contains no URL, password, token, service key, environment-file lookup, container ID,
or credential-discovery command. In particular, do not source `.env.local`.

The psql invocation must use `-X`, `ON_ERROR_STOP=1`, and explicit values for:

- `source_0157_sha256`;
- `source_0158_sha256`;
- `source_0159_sha256`;
- `schema_sha256`;
- `data_sha256`;
- `fresh_interval_admitted=on`; and
- `receiving_rehearsal_settled=on`.

Success is process exit 0 with
`C04_RECONCILE_ERROR_PRESERVATION_PASS`. Any guard error, broad-refusal notice,
RED marker, nonzero exit, or missing final rollback is failure.

## Required later proof

The earlier body-only GREEN does not prove the numbered wrapper. Root must still
independently review and execute canonical forward, this rollback-only contract,
paired down, re-up, exact catalog restoration, and pre/post conservation in one
approved disposable window. Do not mark C04, C06, D2, migration readiness, or
production readiness complete from these source files.
