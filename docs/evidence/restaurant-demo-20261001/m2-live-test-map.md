# M2 live application check map

Read-only scouting on 2026-10-01 at branch `feat/restaurant-demo-closeout-20261001`, HEAD `ffced31d0964082c2554b1e566d5762e4c36619a`. This note records source contracts, not executed HTTP or database results. The baseline browser journey must pass before these follow-up mutations run.

## Existing checks and their limits

| Check | Existing source | What it proves when run | Remaining app evidence |
| --- | --- | --- | --- |
| Import batch undo | `e2e/import-journey.test.ts` | Mobile upload, preview, apply, quantity 4 / cost 42.50, UI undo, inventory removal, retained wine and retention copy | Persisted `reverted_at`, session undo and refusal/error contracts |
| Bin page | `e2e/bins.test.ts` | Occupancy and bottle search | It never performs PATCH or checks the inventory mirror; it skips under `CI` |
| Current-schema import backend | `src/domains/import/{p3-live,tenant-isolation,import-hardening-live}.test.ts` | Real database/RPC apply, retained-catalog batch/session undo, tenant and digest protections | These suites do not call the Next HTTP routes |
| Caller unit contracts | Bin route tests, import revert route tests, `scans/page.housekeeping.test.tsx` | Mocked role/status/error mapping and visible stalled-scan retry warning | Genuine app requests and persisted state |

The existing import E2E expects `DEV_BYPASS_EMAIL` in both its test process and the app, then calls `/api/dev-login`. The portable app does not enable that bypass. Reuse its upload/undo actions with the journey's password-authenticated owner/staff contexts; do not enable a new bypass just to run this file unchanged.

## Smallest follow-up inside the admitted journey

Run after all M3 receipt, replay, location and count assertions finish, before the launcher performs successful cleanup. Reuse the existing `ready.json` database container ID, pinned local Docker endpoint, owner/staff browser cookies and read-only state capture. Successful launcher cleanup removes the stack, so no app remains for a later probe. Do not mutate concurrently with the baseline journey.

### Bin rename

Owner request: `PATCH /api/bins/<ready.binId>` with JSON `{"code":"DEMO-M2-RENAMED"}`. Require HTTP 200 and the returned exact bin ID/code. Read back every same-site `inventory_items` row with that `bin_id`: all must have the renamed `bin_code`. Compare receiving receipts and pour/count history before/after; renaming must not rewrite historical receiving location values or command receipts.

Staff sends the same PATCH: require 403 and unchanged state. A duplicate same-site bin code must return 409 `duplicate_bin_code`, leaving both bin and inventory unchanged. A foreign-site bin ID must return 404. The route performs one bin update; migration 0162 owns the atomic mirror. Existing `supabase/tests/0162_bin_code_inventory_mirror/{bin-code-mirror-contract,atomic-failure}.sql` supplies rollback-only database and injected-failure evidence, not HTTP evidence.

### Import batch and session undo

Use unique synthetic producer/name/file content for each case so digest deduplication does not conflate fixtures. A present producer and cost avoid unrelated blank-producer/manual-cost decisions. Example CSV:

```csv
producer,name,vintage,quantity,unit_cost
M2 Synthetic Producer,M2 Batch Wine,2021,4,42.50
```

Exact HTTP sequence:

1. Optional preview: `POST /api/import/preview`, multipart `file` containing the CSV, matching the existing UI action.
2. Confirm: `POST /api/import/batches`, multipart `file`. Require 201 and capture `batchId`; unexpected `alreadyExists: true` is a fixture collision, not a fresh successful import.
3. `GET /api/import/batches/<batchId>` returns `batch` and `rows`. Resolve any unmatched pending row with `PATCH /api/import/batches/<batchId>/rows/<rowId>`, JSON `{"action":"include"}`. Supply `manualUnitCost` only when explicitly testing a missing-cost row.
4. `POST /api/import/batches/<batchId>/apply` with no body until `done: true`; require the actual `batchStatus` to complete, not merely zero eligible rows. Verify exact imported inventory IDs, quantity/cost and wine identity through the admitted database.
5. `POST /api/import/batches/<batchId>/revert` with no body. Require 200, `revertedCount: 1`, `orphanWinesDeleted: 0`; assert `lwinStampsCleared` against the fixture's actual linked pairs, not a guessed positive count. Verify only this batch's inventory disappears, catalog wine/history remain, batch status becomes `reverted` and `reverted_at` is non-null. GET detail/list and the UI must show the persisted state and retention copy.
6. Repeat batch revert: require 409 `not_completed` and identical database state. Foreign-site batch ID: require 404. Re-applying the reverted batch must not recreate stock.

For a separate two-chunk session, create with `POST /api/import/sessions`, JSON `{"label":"M2 synthetic session","declaredChunkTotal":2}`; require 201 and capture `sessionId`. Confirm two distinct CSVs with multipart `file`, `sessionId`, `chunkIndex` (`"1"`, then `"2"`) and `chunkTotal: "2"`. Apply both as above. `POST /api/import/sessions/<sessionId>/revert` needs no body and returns `{sessionId,batches}`. Verify two reversed batch results, zero session-created inventory, retained wine IDs, both batch statuses/timestamps and session status `reverted`. Foreign-site session ID must return 404.

For an observable safe refusal, import one extra bottle and open it through the normal app command before undo: require 409 `physical_bottle_dependency` and unchanged imported inventory, catalog links, batch/session statuses and command history. Session refusal includes an empty `batches` result. This fixture must remain separate from successful undo fixtures. The API intentionally allows active staff membership to import/revert; do not assert a blanket staff 403.

Existing rollback-only `supabase/tests/0164_import_revert_cleanup/import-revert-contract.sql` covers exact LWIN pair cleanup, retained unrelated/historical rows and transactional rollback. A CSV with no matched LWIN can prove zero-pair handling but cannot prove positive link cleanup. Generic 500/redaction still needs a reviewed fault fixture if genuine HTTP failure evidence is required; mocked route tests alone do not establish it.

### Stalled scan caller

The real caller is authenticated `GET /scans`, implemented by `src/app/(app)/scans/page.tsx`, not `/api/scans`. Before GET, create only named synthetic rows in the admitted disposable database, adapting the existing rollback-only 0163 fixture to the journey's exact users/site. An eligible row has `status='processing'`, `committed_at=null`, and an INSERT-specified `updated_at` older than 15 minutes. Updating the timestamp later would trigger `set_updated_at` and erase the intended stale state.

Include a fresh processing row, an old row with a queued/retrying extraction job, an old row with a processing job claimed within 5 minutes, and a foreign-site row. Jobs must match `job_type='invoice_extract'`, `subject_table='invoice_scans'`, and the exact scan ID. The eligible row must have no protected active extraction job. Reuse the required invoice/job column shapes from `supabase/tests/0163_stalled_invoice_scan_expiry/stalled-scan-expiry-contract.sql` rather than guessing a new schema.

After GET, require only the eligible same-site row to become `failed` / `stalled`; protected and foreign rows remain byte-for-byte unchanged. Reload must not expire another row. Capture the rendered stalled status and read-only database states. A genuine RPC failure must render the existing warning and working Reload link while preserving scan history. A browser network abort does not prove server RPC failure; keep that claim pending until a reviewed, narrowly targeted fault fixture runs.

## Existing current-schema live command

Run from the admitted runtime project, after its synthetic database fixture setup, with only the already-admitted loopback URL and local publishable/service keys supplied in process memory. Do not source dotenv or print keys. The conservation wrapper checks the config/namespace/container before and after and sets CI so missing credentials or skipped mandatory checks cannot count as green.

```sh
node scripts/run-live-test-conservation.mjs -- pnpm exec vitest run \
  src/domains/import/p3-live.test.ts \
  src/domains/import/tenant-isolation.test.ts \
  src/domains/import/import-hardening-live.test.ts --maxWorkers=1
```

These suites create and clean tracked synthetic users/sites, so they can share the admitted daemon and fresh disposable stack after the baseline completes. Record exact totals, failures and skips. They add backend coverage without claiming UI/HTTP proof.

Parent already owns the rollback-only 0162/0163/0164 execution. Each SQL contract requires `expected_database=postgres`, `target_admitted=on` and its exact `source_016N_sha256`; run through the immutable admitted container ID, never a guessed port or broad reset. Read-only scouting verified the current forward hashes:

- 0162: `c899f1f5113773f0cc826a227bc0c800c4303cc2a6bc5a945bd5b040ced01955`
- 0163: `ed98ab776aca2c509b691709da00c3a698789f613d493c3abb3eb0e902e57475`
- 0164: `2d535f329b600c3dfc33b23494532f93c023b1a89c6aad055b8de3a865ee49ff`

No scout command ran a database write, app mutation, Docker lifecycle command or paid provider call. M2 runtime checks remain pending.
