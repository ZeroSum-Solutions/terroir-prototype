# C04 operational caller inventory

Date: 2026-09-26  
Scope: read-only prerequisite for the full staff-cost seal; current source at `fe9ba7c103770f7bf6a932db9175888fe307e0b1` plus preserved working-tree changes.  
Authority: inventory and contract recommendation only. No application, SQL, database, runtime, browser, provider, credential, or Git mutation was performed.

## Decision summary

`scan_idempotency` has one production implementation and exactly three production HTTP callers (four call sites because `/api/scan` has JSON and multipart branches). The callers cache three incompatible body families. The table key is only `(key, restaurant_id)`, so it binds neither the actor nor the operation kind. Reusing one UUID across two operations in the same restaurant can replay the wrong body. Reusing it as a different same-site user can replay the first user's body under the current membership-only RLS policy.

The accepted plan's one five-key scan receipt cannot replace all three current body families without breaking callers or relabeling `wineId` as `scanId`. Before direct cache DML is revoked, the additive database contract needs actor binding plus operation-kind binding and distinct closed, cost-free receipt envelopes for the three operations. Legacy null-actor or generic bodies must never replay.

## Complete `scan_idempotency` production source inventory

### Storage, policy, cleanup, and generated contract

| Concern | Exact source | Current behavior |
|---|---|---|
| Table | `supabase/migrations/0011_scan_idempotency.sql:24-31` | `(key uuid, restaurant_id uuid)` primary key; nullable `response_status integer` and arbitrary `response_body jsonb`; `created_at` default `now()`; restaurant cascades delete cache rows. |
| RLS | `0011_scan_idempotency.sql:36-46`, replaced by `0084_rls_initplan_wrap.sql:243-247` | Any authenticated member of the restaurant can select/insert/update/delete every site cache row. There is no actor binding. |
| Cleanup function | `0011_scan_idempotency.sql:48-61` | `cleanup_scan_idempotency()` deletes rows older than 24 hours. It is `SECURITY DEFINER`, uses `search_path = public`, revokes `PUBLIC`, and grants only `service_role`. |
| Scheduler | `0020_schedule_cleanup_scan_idempotency.sql:13-22` | `pg_cron` invokes cleanup hourly at minute 05. Effective retention is at most approximately 25 hours. |
| Type surface | `src/types/database.ts:1809-1839,2894` | Generated type exposes direct table Row/Insert/Update and cleanup RPC. No claim/complete/abandon RPCs exist. |
| Only production data-access implementation | `src/lib/api/idempotency.ts:88-120,135-261` | Direct Data API table access. No other non-test source opens `scan_idempotency`. |

Non-runtime references are `app_spec.txt:117,357,532-534,688`, `docs/CONVENTIONS.md:58`, the generated feature ledger/tests, schema snapshot, and archived planning prose. They do not add a caller.

### Current direct state machine and failure behavior

`withIdempotency` in `src/lib/api/idempotency.ts` implements:

1. Missing/invalid key: the route converts it to `null`; the handler runs with no cache (`:74-76`, callers below, helper `:154-157`).
2. Claim: direct INSERT of `{key, restaurant_id, response_status:null, response_body:null}` (`:161-167`).
3. Non-`23505` claim failure: logs/Sentry, then **fails open** and runs the protected mutation/provider handler uncached (`:169-180`).
4. Conflict: directly SELECTs `response_status,response_body,created_at` by key and restaurant (`:183-188`).
5. Row disappeared after conflict: **fails open** and runs the handler uncached (`:190-195`).
6. Age over 24h: returns HTTP-shaped status 409 with `{error:"Idempotency key expired; please generate a new one."}` (`:203-211`). The row remains until cleanup.
7. Null `response_status`: returns 409 with `{error:"A request with this Idempotency-Key is already in progress."}` (`:214-221`).
8. Completed row: returns the stored arbitrary status/body verbatim with `replayed:true` (`:224-228`).
9. Handler throws: direct DELETE by key and restaurant, then rethrows (`:231-242`). Delete error is not examined.
10. Handler returns any status/body: direct UPDATE stores both without shape validation (`:244-251`). Cache-update failure logs/Sentry but still returns the mutation result, uncached (`:253-261`).

The current tests at `src/lib/api/idempotency.test.ts:119-321` cover UUID validation, no-key bypass, arbitrary response caching/replay, in-progress, expiry, throw/delete, and restaurant separation. They do not cover actor binding, operation-kind binding, malformed legacy response rejection, delete/update failure fail-closed behavior, or same-key cross-operation collision.

## Exact three caller/result contracts

### 1. Invoice extraction: `invoice_scan_upload`

Production call sites:

- JSON storage-path branch: `src/app/api/scan/route.ts:107-220`; `withIdempotency` at `:154-218`.
- Multipart branch: `src/app/api/scan/route.ts:223-354`; `withIdempotency` at `:288-301`.

Current cached bodies:

- Success from `processInvoiceScanOnce`: HTTP 200, `{ scanId, ...Scan }` (`src/domains/scanning/invoice-scan-service.ts:217-281`). `Scan` contains source metadata, `items[]` including `unitCost` and optional `lineTotal`, edits, quality, raw OCR text, and arithmetic details (`src/lib/scanner/types.ts:1-84`). This is protected cost-bearing content and cannot remain in `response_body`.
- No wines: HTTP 422 with `scanId`, `code`, `message`, and `rawText` (`invoice-scan-service.ts:127-145`).
- OCR/LLM failures: 4xx/5xx bodies can contain codes/messages and raw OCR text (`invoice-scan-service.ts:315-346`; `src/lib/api/result-response.ts:36-70`).
- JSON pre-processing returns may also be cached: 404 `{error:{code,message}}` and 413 `{error:{code,message}}` (`scan/route.ts:159-187`).

Current client dependency:

- `src/app/(app)/scan/scanner.tsx:95-123,320-365` waits synchronously for a complete `Scan`, clears the retry key only on 2xx, dispatches the full extraction result, and immediately renders/reports `fresh.items.length`.
- `results-view.tsx:109-137` extracts `scanId` from that full response.
- There is no scan-job polling hook. `scanner.tsx:239-256` is only a cosmetic progress timer. The scans list/detail pages are server reads without automatic refresh.

Required cutover behavior:

- Upload/create/enqueue must return a cost-free receipt, not the extracted payload. The plan already specifies `{scanId,status}` for upload and says protected writes belong to the tenant-filtered worker (`plan:278-282,296-299`).
- The scanner needs an explicit status/read polling or navigation contract before synchronous extraction is removed. Returning only `{scanId,status}` to the existing `postScan(): Promise<Scan>` is not compatible.

### 2. Invoice inventory save: `invoice_inventory_save`

Production call site: `src/app/api/inventory/save-scan/route.ts:92-114`.

Current cached bodies:

- Success: HTTP 200 `{scanId,itemCount,wineCount}` (`save-scan/route.ts:300-320`). `itemCount` is inventory-row/line count; `wineCount` is distinct wine IDs, not newly created wines.
- Every returned error body is also cached, including arithmetic mismatch details and generic save failures (`:126-143,161-171,239-280`).

Current client dependency:

- `scanner.tsx:497-540` requires the success body to contain `scanId,itemCount,wineCount`; it dispatches `itemCount` and `wineCount`.
- `scanner-state.ts:15,47` and `views/ready-view.tsx:84,240` preserve and render both counts.

Persistence behavior:

- Claims or creates the `invoice_scans` ledger row, optionally writes image path, calls `find_or_create_wines_batch`, directly inserts cost-bearing `inventory_items`, and then returns the count receipt (`save-scan/route.ts:149-320`).

Compatibility finding: the plan's current five-key envelope (`version,kind,scanId,status,itemCount`) omits `wineCount`, which is an active response/UI contract. Dropping it is a breaking change. This operation needs its own closed receipt shape or a separately approved UI change.

### 3. Bottle inventory save: `bottle_inventory_save`

Production call site: `src/app/api/inventory/save-bottle-scan/route.ts:46-58`.

Current cached bodies:

- Success: HTTP 200 `{wineId}` (`save-bottle-scan/route.ts:140`).
- Failure bodies include `{error:"Failed to save wine."}` or `{error:"Failed to save inventory item."}` (`:87-120`).

Persistence behavior:

- Calls `find_or_create_wines_batch` for one wine (`:68-96`).
- Directly inserts one `inventory_items` row with `invoice_scan_id:null`, quantity, unit cost, format, and `added_via:'bottle_scan'` (`:98-109`).
- It creates **no `invoice_scans` row**. It then runs best-effort `match_lwin_batch` (`:123-138`).

Current client dependency:

- `scanner.tsx:648-687` needs `wineId` to attach a label photo after save. It does not have a scan ID.

Compatibility finding: a receipt requiring `scanId` cannot represent this operation honestly. `wineId` must not be relabeled as `scanId`.

## Cross-operation and cross-actor collision

All three callers use the same key validator and the same table primary key. There is no route/kind input in the claim (`idempotency.ts:161-167`) or replay lookup (`:183-188`). A caller can deliberately reuse a valid UUID used by any other operation in the same restaurant:

- invoice extraction can receive `{wineId}` or `{scanId,itemCount,wineCount}` as a nominal 200 `Scan`;
- invoice save can receive the full protected extraction body or `{wineId}`;
- bottle save can receive either invoice body.

Current random UUID generation makes accidental collision unlikely, but the server accepts caller-selected UUIDs and therefore must treat the namespace collision as reachable. `claimed_by_user_id` closes the same-site foreign-user replay only if every claim/replay/complete/abandon predicate verifies it. It does not close cross-operation replay; a kind must be bound at claim time.

## Concrete minimal typed-cache amendment recommendation

This subsection is a recommendation required by the discovered source contract, not an implemented database contract. It preserves the plan's only-new-column rule by storing the operation kind in a closed `response_body` sentinel and adding only `claimed_by_user_id` as a scalar column.

### Claim result shape

Use a typed SQL result rather than returning arbitrary JSON directly:

```text
disposition: claimed | in_progress | expired | replay
receipt: jsonb null unless disposition = replay
```

Require `p_kind` from the closed enum below in claim/complete/abandon. A new claim stores an internally constructed, closed sentinel such as `{version:1,kind:<kind>,status:"claimed"}`. Conflict handling verifies exact restaurant, current actor, kind, version, and closed shape before returning any disposition or receipt. A null-actor row, null/generic body, wrong kind/version, extra key, invalid field, or unsupported legacy status is `expired`/nonreplayable and never cast into a receipt.

Recommended closed successful receipts, derived from the three current success contracts:

```text
invoice_scan_upload:
  {version:1, kind:"invoice_scan_upload", scanId:uuid, status:"queued", itemCount:0}

invoice_inventory_save:
  {version:1, kind:"invoice_inventory_save", scanId:uuid,
   status:"committed", itemCount:0..500, wineCount:0..500}

bottle_inventory_save:
  {version:1, kind:"bottle_inventory_save", wineId:uuid,
   status:"committed", itemCount:1}
```

Why these literals are minimal:

- `version:1` matches the repository's established versioned receipt convention (`0151`/`0153` inventory command receipts) without implying compatibility with those tables.
- `queued` is the existing `background_jobs` status and truthfully describes upload/enqueue before extraction.
- `committed` matches `invoice_scans.committed_at` and the existing scan-commit language.
- `itemCount` retains the plan's bounded count. `wineCount` and `wineId` are included only in the operation whose current UI requires them.
- No receipt includes cost, line items, OCR, provider payload, raw import row, image path, or error text.

### HTTP/application mapping

| Claim disposition | Recommended application behavior | Grounding |
|---|---|---|
| `claimed` | Continue exactly one operation. Do not begin protected mutation/provider work before this result. | Current claim-owner path. |
| `replay` | Return the exact validated receipt with the operation's successful status. For async upload, 202 is the truthful new-request status; replay may return the identical stored 202 receipt. Existing save paths remain 200. | Existing replay returns original status/body; worker enqueue is asynchronous. |
| `in_progress` | HTTP 409, closed code `idempotency_in_progress`; no handler execution. | Current helper already returns 409. |
| `expired` or legacy/nonconforming row | HTTP 409, closed code `idempotency_expired`; no handler execution and no legacy body bytes. | Current helper already returns 409 for age expiry; plan makes legacy generic rows nonreplayable. |
| actor/kind/request mismatch | HTTP 409, one generic closed code `idempotency_conflict`; no receipt or existence detail. | Prevents replay and avoids turning key reuse into a body/existence oracle. |
| claim/complete/abandon RPC error | Fail closed with the normal redacted 500 envelope; never run/acknowledge the protected operation uncached. | Required to remove both current fail-open paths. |

Only successful closed receipts should complete the cache. Any operation error abandons the actor/kind-bound unfinished claim before returning the ordinary redacted 4xx/5xx. Completion or abandon that affects zero rows is an error, not success. Missing or malformed `Idempotency-Key` should be rejected before protected write work for these three mutation paths; silently mapping it to `null` preserves the current duplicate-write bypass.

## Synchronous providers versus the existing tenant-filtered worker

### Current synchronous request paths

- `/api/scan` calls `assertInvoiceExtractionConfigured` and `processInvoiceScanOnce` inside the HTTP request (`scan/route.ts:154-217,269-301`).
- `processInvoiceScanOnce` creates/updates protected `invoice_scans`, calls `readInvoicePages`, persists OCR, parsed/final line items, accuracy/status, and returns the full result (`invoice-scan-service.ts:69-346`).
- `readInvoicePages` calls Azure OCR per page and then Anthropic extraction, or image-model extraction when permitted (`invoice-extraction-stage.ts:49-77`).
- `/api/scans/[id]/re-extract` directly reads protected `ocr_text`, calls Anthropic once or twice, and directly updates protected extraction fields (`re-extract/route.ts:75-224`).

### Existing worker path

- `enqueueInvoiceExtractJob` calls authenticated `enqueue_invoice_extract_job(restaurant,scan)` and returns `{jobId,created}` (`src/lib/jobs/enqueue.ts:39-55`). There are currently no application callers.
- SQL verifies membership and scan/site identity and pins job properties (`0083_background_jobs_enqueue_rpc.sql:113-202`). Its unique key is `(job_type, scanId)`.
- The service-role worker claims jobs (`src/worker/index.ts:36-74`; `src/lib/jobs/claim.ts:24-46`) and tenant-filters the subject by both scan ID and restaurant before any provider call (`invoice-extract-handler.ts:34-59`).
- It validates path tenancy, downloads from the private bucket, fences ownership, calls `processInvoiceScanOnce`, classifies success/retry/dead, and uses fenced job completion (`invoice-extract-handler.ts:61-203`; `run-once.ts:18-35`; `complete.ts:6-92`).

### Cutover blockers grounded in current source

1. Upload order: multipart `/api/scan` currently uploads images only after synchronous extraction (`scan/route.ts:303-352`). The worker requires a pre-existing scan with `raw_image_path` before it can run (`invoice-extract-handler.ts:102-135`). Upload/create/enqueue must become one admitted path before provider work is removed.
2. Multi-page worker gap: the worker fetches only `raw_image_path`; it does not fetch/use `extra_image_paths` (`invoice-extract-handler.ts:39-44,102-169`). Current synchronous extraction passes every page (`scan/route.ts:276-300`). Multi-page behavior would regress unless the worker is updated to load and validate all admitted paths.
3. Re-extract enqueue gap: the existing enqueue unique key is the scan ID and a duplicate only revives `dead`; a prior `succeeded` job is returned unchanged (`0083...sql:162-186`). It cannot represent a new re-extraction attempt. The database contract must establish a bounded re-extract request/requeue transition; the route must not create a service-role client.
4. UI gap: the scanner expects full results synchronously and no status poll exists; re-extract reloads immediately after its POST (`re-extract-button.tsx:16-38`). Both need a finite status/read path compatible with the new private reader and worker states.
5. Stalled cleanup: `expireStalledScans` is request-era housekeeping that directly marks old processing scans failed and is called by the scans page (`stalled-scans.ts:23-42`; `scans/page.tsx:55`). Worker retry/dead state must become authoritative or this path must be moved behind an admitted closed operation; it cannot retain direct protected UPDATE after ACL cut.

## Other operational dependencies and blockers

### Invoice operations

- `PATCH /api/scans/[id]` directly reads and updates protected final line items/edits (`src/app/api/scans/[id]/route.ts:16-64`); it must use `review_invoice_scan`, including expected `updated_at`, manager plus `cost.read`, exact bounds, and safe receipt.
- `POST /api/scans/[id]/commit` directly reads protected final lines, claims `committed_at`, creates wines, inserts cost-bearing inventory, and releases the claim on failure (`commit/route.ts:21-147`). It must become atomic `commit_invoice_scan`; its existing success receipt `{scanId,itemCount,wineCount}` is a caller contract (`scan-review.tsx:118-126`).
- `DELETE /api/scans/[id]` already calls `delete_invoice_scan` and validates `{scanId,inventoryRowsDeleted,bottlesRemoved}` (`route.ts:86-122`), but the function must be replaced/admitted under the new current-role helper and ACL contract.
- The image route ultimately reads `raw_image_path`; the sealed contract requires `cost.read`, no raw path, and a <=60-second signed URL.

### CSV import

Current operational RPCs are `create_import_batch` (`batch-service.ts:576-608`), `count_import_batch_rows` (`:1438-1463`; `session-service.ts:72-123`), `apply_import_batch_chunk` (`batch-service.ts:1615-1642`), `revert_import_batch` (`:2067-2135`), and `revert_import_session` (`session-service.ts:184-228`). `match_lwin_bulk` is read-only catalog matching (`lwin-matching.ts:62-107`).

Blockers before ACL cut:

- `create_import_batch` accepts caller-supplied `p_created_by`; the plan requires deriving `auth.uid()`.
- Row resolution and bulk resolution directly read/update protected `import_batch_rows.manual_unit_cost`, validation/error/raw state, and directly update batch status (`batch-service.ts:1656-1773`). They need closed definers and cost-free closed codes.
- Apply returns `error_message` for each processed row and TypeScript directly updates `import_batches.status` after the RPC (`batch-service.ts:1625-1641`). The sealed function must return closed error codes only and own the entire state transition.
- Batch detail directly returns `raw`, `validation_errors`, and `manual_unit_cost` to any member (`src/app/api/import/batches/[id]/route.ts:31-50`). It must split safe operational rows from `read_import_batch_cost_rows` capability data.
- Confirm and revert routes create route-level service clients for orphan cleanup (`batches/route.ts:25,106-127`; `revert/route.ts:14,49-62`). This conflicts with the plan's no-new-route-service-client boundary; required cross-tenant cleanup must be inside closed SQL/operator maintenance, not retained as a route bypass.

### Reconciliation and merge

- Queue GET uses wildcard reads on `inventory_items`, `invoice_scans`, and `wines` (`reconcile-queue/route.ts:17-38`) after a TypeScript capability precheck. Wildcards will fail after column ACL; protected mixed data needs typed readers.
- `acceptBatch` and `undoBatch` are multi-call TypeScript transactions in name only: they directly read/write subjects, `reconcile_batches`, and protected `reconcile_actions.prior_state/new_state`, with compensating writes (`src/lib/reconcile-ledger/index.ts:84-570`). They are not atomic against a connection failure. They must be replaced by plan RPCs `accept_reconcile_batch` and `undo_reconcile_batch`, with idempotency, locks, ordered immutable history, and cost-free receipts.
- `merge_wines` is already one RPC (`src/app/api/wines/merge/route.ts:90-116`) but the route's result currently exposes the full `moved` JSON. The 0156 function and route must be admitted against the plan's safe moved-count receipt and mixed private snapshot protections.
- The separate physical bottle reconciliation RPCs are not the C04 reconcile-ledger functions and do not substitute for them (`src/domains/cellar/reconcile-service.ts:94-199`).

## Completeness check

Fresh whole-tree searches were run for:

```text
scan_idempotency | claim_scan_idempotency | complete_scan_idempotency | abandon_scan_idempotency
withIdempotency | isValidIdempotencyKey
processInvoiceScanOnce | extractFromOcr | readInvoicePages | enqueue_invoice_extract_job
.rpc( in invoice/scanning, import, reconciliation, and merge scopes
.from( in the same operational scopes
```

The production cache result is exactly three HTTP callers/four call sites and one direct table implementation. No claim/complete/abandon RPC exists in current SQL or generated types. The evidence commands and source hashes are recorded alongside this note.
