# Stalled invoice-scan expiry contract

**Status:** Accepted for implementation under the authorized restaurant-demo
milestone. Independent database and TypeScript reviews required the scan-lock-first,
fresh-snapshot sequence and explicit isolation guard below. No runtime proof or
completion is claimed. Reserve the migration number before SQL implementation.

## Purpose

Replace the scan-history page's direct `invoice_scans` update with one closed,
authorized database operation. The repair must expire only genuinely abandoned
scan work, preserve a live or queued extraction attempt, and tell the user when
housekeeping could not run.

This contract is based on the current implementation, including:

- `src/domains/scanning/stalled-scans.ts`
- `src/app/(app)/scans/page.tsx`
- `src/lib/jobs/constants.ts`
- `src/lib/jobs/invoice-extract-handler.ts`
- `src/lib/jobs/heartbeat.ts`
- `src/lib/jobs/complete.ts`
- migrations `0052`, `0075`, `0083`, `0089`, `0090`, `0143`, and `0157`
- `docs/runbooks/invoice-extract-worker.md`
- `docs/runbooks/migration-numbering.md`
- `docs/runbooks/production-migrations.md`

## Current defect

`expireStalledScans` writes `invoice_scans` directly, computes its cutoff from
caller time and `created_at`, and converts every database error into a successful
zero. The page discards that result. This predates the leased `invoice_extract`
worker, which can queue retries, renew a five-minute processing lease, and reset a
failed scan to `processing` before another attempt.

The current behavior can mark legitimate work failed and gives the user no signal
when cleanup itself fails.

## Database contract

### Identity and result

The additive boundary is exactly:

```text
public.expire_stalled_invoice_scans(p_restaurant_id uuid) returns jsonb
```

On success it returns one strict two-key object:

```json
{"version": 1, "expiredCount": 0}
```

`version` is the JSON number `1`. `expiredCount` is a non-negative integer equal
to the rows changed by this invocation. Zero eligible rows is a successful result,
not an error.

The function accepts no cutoff, current time, scan IDs, status, reason, job ID, or
arbitrary patch from the caller.

### Authority and exposure

The function must:

1. derive the actor from `(select auth.uid())`;
2. require `public.current_site_role_at_least(p_restaurant_id, 'staff')` at the
   time of the call, including its current site and workspace lifecycle checks;
3. raise message `forbidden` with SQLSTATE `42501` for unauthenticated, revoked,
   expired, null-site, or cross-site callers;
4. use `SECURITY DEFINER`, owner `postgres`, and `SET search_path = ''`;
5. schema-qualify every relation, function, type, and operator-sensitive helper;
6. revoke execution from `PUBLIC`, `anon`, `authenticated`, and `service_role`,
   then grant execution only to `authenticated`.

There is no not-found error. An authorized caller with no eligible rows receives
the exact success receipt with `expiredCount: 0`. Unexpected database errors must
propagate. The function must not translate them into a zero count.

Immediately after authentication/authority checks and before locking or changing
rows, require `pg_catalog.current_setting('transaction_isolation') = 'read committed'`.
Otherwise raise `read_committed_required` with SQLSTATE `25000`. Do not attempt
to change transaction isolation inside the function. This guard makes the fresh
statement snapshot guarantee explicit rather than relying on the caller's defaults.

### Eligible scan predicate

One shared `statement_timestamp()` supplies both time boundaries. A scan is
eligible only when every condition below is true at the update fence:

```text
scan.restaurant_id = p_restaurant_id
scan.status = 'processing'
scan.committed_at IS NULL
scan.updated_at < statement_timestamp() - interval '15 minutes'
no active matching invoice_extract job exists
```

The strict `<` is required. A scan whose `updated_at` equals the fifteen-minute
cutoff does not expire. `created_at` does not participate.

For this boundary, a job matches a scan only when all four values match:

```text
job.restaurant_id = scan.restaurant_id
job.job_type = 'invoice_extract'
job.subject_table = 'invoice_scans'
job.subject_id = scan.id
```

A matching job is active when either condition is true:

```text
job.status IN ('queued', 'retrying')

job.status = 'processing'
AND job.claimed_at >= statement_timestamp() - interval '5 minutes'
```

Queued and retrying jobs remain active regardless of `run_after`. A processing
lease exactly five minutes old remains active. A processing job with a null or
older lease, a terminal job (`succeeded`, `failed`, `cancelled`, or `dead`), no
job, or a job with the wrong tenant, type, subject table, or subject ID does not
protect an otherwise eligible scan. If malformed historical data contains more
than one matching job, any active match protects the scan.

An expired processing job with a null claim does not protect its scan, but this
operation does not repair that malformed job or promise that the existing worker
or re-extract operation can recover it. Job repair remains outside this boundary.

### Atomic transition and concurrency boundary

The database operation must update eligible rows to exactly:

```text
status = 'failed'
status_reason = 'stalled'
```

It must not modify scan payloads, OCR data, line items, ownership, commit state,
cost data, job rows, or storage objects. The existing `invoice_scans_set_updated_at`
trigger owns the resulting `updated_at` change.

Selection, row locking, the active-job exclusion, the status fence, the update,
and the count must run in one function transaction. The function is `VOLATILE`.
It first locks candidate scan rows in ascending scan-ID order with `FOR UPDATE`,
using the exact-site, `processing`, uncommitted, and strict `updated_at`
predicates. It retains only those locked IDs. It must then issue a separate SQL
statement so that the final update observes a fresh READ COMMITTED snapshot after
any lock wait. That update is restricted to the locked IDs and repeats all four
scan predicates plus the complete active-job `NOT EXISTS` predicate.

A single UPDATE, or a CTE that selects and updates in one statement snapshot, is
not sufficient. A concurrent re-extract request can hold the scan lock and insert
or revive a job without changing the scan row. After waiting for that transaction,
expiry must see its committed active job, not the snapshot from before the wait.
Derive the count only from rows actually returned by the final update.

This guarantees one winning status transition on a scan row:

- If extraction changes `processing` to `complete` or `review` first, expiry
  updates zero rows.
- If expiry changes `processing` to `failed/stalled` first, the worker's existing
  `status = 'processing'` completion fence updates zero rows and reports
  `scan_superseded`; it cannot overwrite the failure.
- A later worker retry may use the existing `failed -> processing` fence and
  continue. A manager may also use the existing re-extract path when there is no
  retryable job.

The guarantee is row-level atomicity, not serializable scheduling across unrelated
rows. The current `request_invoice_scan_reextract` function locks the scan before
it creates or revives the job. The two-statement scan-lock-first sequence above
therefore serializes expiry with that request. Any future
enqueue path that can act on an old scan must retain that scan-first ordering or
establish an equivalent status fence. This RPC must not claim protection from a job
inserted after its statement snapshot by a caller that ignores that rule.

### Query and scope constraints

The implementation must use the existing tenant and subject indexes. It must not
scan or update another restaurant and must not add a caller-configurable sweep.
No new generic job framework, scheduler, background task, or provider interaction
belongs in this repair.

## Migration and rollback contract

Implementation follows the repository migration runbooks, but the next number is
not claimed by this document. Before reserving one, check the current migration tail
and serialize with every other migration author.

The forward migration must:

- refuse a missing required baseline, including `invoice_scans.updated_at`,
  `invoice_scans.committed_at`, `invoice_scans.status_reason`, the four matching
  `background_jobs` fields (`restaurant_id`, `job_type`, `subject_table`, and
  `subject_id`), the job `status` and `claimed_at` fields, their required status
  vocabulary, and
  `current_site_role_at_least(uuid, public.membership_role)`;
- refuse any pre-existing function named `expire_stalled_invoice_scans`, including
  another overload, instead of replacing or shadowing it;
- create only the exact function and ACL described above;
- finish with a catalog postflight that pins the reviewed body hash, signature,
  return type, language, volatility, owner, security-definer flag, empty search
  path, argument metadata, absence of defaults or extra overloads, and exact ACL;
- contain no transaction commit so the migration runner owns the transaction.

The paired down migration must verify the same known signature, body hash, owner,
ACL, search path, and function metadata before DDL. Missing or drifted identity must
fail before any change. A valid down uses `DROP FUNCTION ... RESTRICT`, never
`CASCADE`, and changes no table data.

Already expired `failed/stalled` rows remain historical truth after rollback. The
down migration must not guess which rows to restore to `processing`, clear reasons,
or mutate `background_jobs`.

Release ordering is additive: apply the function before deploying its caller. On
application rollback, restore the old caller before dropping the function. A call
during a mismatched rollback must surface the recoverable page warning rather than
pretend zero rows expired.

## Application contract

### Helper

`expireStalledScans` must call only:

```text
supabase.rpc('expire_stalled_invoice_scans', {
  p_restaurant_id: restaurantId
})
```

It must use the request-bound authenticated client supplied by `getAuthContext`,
never an admin or service-role client. The helper no longer accepts `now`, computes
a cutoff, or writes `invoice_scans`. It validates an exact object with only
`version: 1` and a safe, non-negative integer `expiredCount`, then returns that
count.

A Supabase error, null result, array result, extra or missing key, wrong version,
fractional count, negative count, or unsafe numeric count must throw. Only a valid
receipt may produce `0`. SQLSTATE `42501` remains distinguishable for tests and
telemetry, but the scan-history page maps it to the same safe housekeeping warning
as other RPC failures. It never shows a raw database message.

### Scan-history page

The page still attempts housekeeping before it lists scans, but wraps that attempt
separately from the history reads:

- Success renders the existing page with no new notice.
- Failure is reported once to Sentry with the `scans` and `expire-stalled` context.
- The page continues its normal tenant-scoped history and count queries.
- If those reads succeed, a visible warning appears in both the populated and empty
  states. The warning says: `We couldn't check for stalled scans. Scan history is
  still available. Reload to try again.`
- The warning includes a reload or retry action that preserves the current page and
  status filter. It exposes no SQLSTATE, database message, tenant ID, scan ID, or job
  detail.
- A history-read failure keeps the existing history-load error behavior. It must not
  be mislabeled as a housekeeping-only warning.

The existing `stalled` status-reason prose remains the row-level recovery message.
The repair does not remove failed scans or hide their stated reason.

## Required regression evidence

### SQL and catalog

1. **Expiry matrix:** old uncommitted `processing` scans with no job and with each
   terminal job status expire. Recent scans, exact fifteen-minute-boundary scans,
   `complete`, `review`, and already `failed` scans do not.
2. **Commit fence:** an old `processing` scan with `committed_at` set does not
   change.
3. **Active-job matrix:** queued and retrying jobs protect regardless of
   `run_after`; processing jobs with newer and exact-five-minute leases protect;
   a null or older lease does not. Wrong-site, wrong-type, wrong-table, and
   wrong-subject jobs do not protect.
4. **Exact count and conservation:** the receipt has exactly two keys and counts
   only changed exact-site rows. All other scan columns, all job rows, and another
   restaurant's rows remain byte-for-byte unchanged. A second call returns zero.
5. **Authorization:** current staff, manager, and owner callers can run the exact-site
   sweep. Unauthenticated, cross-site, site-revoked, workspace-revoked, and expired
   lifecycle callers receive `42501` and change zero rows.
6. **Completion race:** two real sessions force completion and expiry to contend on
   the same scan. Exactly one terminal scan status wins. A stale completion never
   overwrites `failed/stalled`.
7. **Recovery:** a stale-lease retry exercises the existing `failed -> processing`
   fence and can later complete. A terminal or absent job remains eligible for the
   existing manager re-extract path.
8. **Migration cycle:** forward metadata matches the closed catalog contract; empty
   down and reapply succeed; drifted body, owner, ACL, search path, overload, and a
   dependent object each make down fail before DDL. Down leaves failed/stalled data
   unchanged.

9. **Re-extract race:** one session holds the scan lock and creates or revives a
   matching active job through the existing re-extract boundary without updating
   the scan row. A second session starts expiry before the first commits and is
   observed waiting for that scan lock. After release, expiry must observe the new
   job, return zero, and leave the scan unchanged. Exercise both a previously
   absent job and a terminal job revived to queued. The reverse ordering must
   remain a valid serialized expiry followed by re-extract request.
10. **Isolation fence:** default READ COMMITTED succeeds. Explicit REPEATABLE READ
    and SERIALIZABLE calls each return `25000` before scan locks or mutations and
    conserve scans and jobs.

### TypeScript and page behavior

1. The helper makes one RPC call with only `p_restaurant_id`, accepts the exact
   receipt, and returns `expiredCount`.
2. Every database and malformed-result case throws. No test describes an error as a
   successful zero.
3. Source checks refuse direct `.from('invoice_scans').update(...)` use in
   `stalled-scans.ts`, caller-controlled time, or caller-controlled status/reason.
4. Source checks pin the SQL fifteen-minute threshold to
   `MAX_BACKOFF_MS = 15 * 60 * 1000`, the five-minute lease threshold to
   `STUCK_AFTER_SECONDS = 5 * 60`, and both to the documented worker lifecycle. A
   change to either side fails the contract until both are reviewed together.
5. Page tests prove a successful sweep shows no warning. A failed sweep still renders
   populated and empty histories, reports telemetry once, and shows the safe retry
   warning with current filters preserved.
6. Authorization mapping tests prove `42501` does not leak a database message. History
   query failures remain distinct from housekeeping failures.

## Explicit non-goals

This repair does not change extraction providers, retry counts, backoff, heartbeat
frequency, reclaim behavior, scan deletion, re-extract authority, status-reason copy,
cost access, committed scan rules, or job scheduling. It does not delete scans or
jobs, revive terminal jobs, expose a service-role caller, add a cron task, or claim
that all production migration criteria are complete.

Acceptance still requires migration-number reservation under the runbook, paired
source review, disposable database proof, and caller/page review.
