# Current import-revert review

Date: 2026-10-01

Reviewer: independent Codex agent, separate from the implementer.

## Verdict

**PASS for the accepted retained-catalog source contract and the reviewed UUID
repair.** The reviewer found one medium UUID-casing defect; the parent repaired
it, and the independent recheck passed. No critical or high-severity source defect
was found in this bounded review. M1/M2 remain open until the final candidate
passes the missing live application and database gates.

Do not reimplement migration 0164 or restore the old wine-deletion cleanup.
The landed source baseline is `c4bf61b453706925d2c97646250c0b3ac686b260`
on `feat/restaurant-demo-closeout-20261001`. This note also reviews the parent's
uncommitted two-line UUID comparison repair and its two tests. The import packet entered Git at
`e970cc8b`; `58b56d92` later adjusted only the admitted preflight ACL profile.

The reviewer read the root `AGENTS.md`, the accepted import cleanup contract,
M1/M2 criteria, migration 0164 and its guarded down, generated RPC interfaces,
batch/session service callers, HTTP routes, confirmation/result UI and focused
tests. There is no nested `AGENTS.md` and no `.codegraph` directory. Local staged
and unstaged diffs contained no implementation changes at review start, so the
scope is the landed packet and current surrounding code, not an unpublished diff.
The parent subsequently edited the milestone plan; the reviewer left that edit
untouched.

No PR merge-readiness check forms part of this local review. The reviewer did not
load dotenv, use production credentials, call a hosted service, run PostgreSQL,
change a database, commit, switch branch or deploy. This note is the reviewer's
only authored file.

## Finding and accepted repair

### Resolved medium: uppercase UUIDs could turn a committed revert into an HTTP error

Locations:

- `src/domains/import/request-schemas.ts:4` and `:27` accept UUID strings without
  canonicalizing their casing.
- `src/domains/import/import-revert-rpc.ts:93` and `:110` compare the returned
  batch/session UUID to the original request string with case-sensitive equality.

Trigger: send a valid uppercase batch or session UUID containing A-F. PostgreSQL
represents the same UUID in lowercase in its JSON receipt. The RPC can commit,
but the application rejects that successful receipt and the route returns its
fixed 500 error. Batch retry then encounters the already-reverted status fence.

A read-only mocked-RPC reproduction returned `internal_error` for both entries
when the request was uppercase and the receipt contained its equivalent lowercase
UUID. No database mutation occurred in this reproduction.

The parent changed only the two identity comparisons to compare lowercased IDs
and added one regression for each RPC entry. The reviewer inspected that delta
and reran full non-incremental TypeScript, scoped ESLint and all 30 receipt tests.
All passed. Genuinely different IDs, extra keys, nonzero `orphanWinesDeleted`,
partial sessions and invalid counts still fail closed. No receipt shape, SQL
body, permission, error mapping or request payload changed.

## Contract checks

| Boundary | Current source result |
| --- | --- |
| Atomic batch reversal | One core owns eligible LWIN changes, exact captured inventory deletion, applied-row transition and batch status. Exception propagation rolls back the function's transaction work. No per-wine cleanup loop. |
| Catalog/history retention | Core/session bodies contain no catalog wine deletion. Applied rows retain `applied_wine_id`, raw/LWIN/cost evidence; only the inventory reference and revert state change. Receipt uses literal `orphanWinesDeleted: 0`. |
| LWIN compare-and-swap | Exact site, ID, score, confidence and pre-revert timestamp predicates repeat in the final update. An applied claim outside the exact reverting set protects the current pair. Actual updated-wine count drives the receipt. |
| Dependencies/source ambiguity | Fresh post-wait statements reject open-bottle dependencies and multiple applied claims before mutation. Session checks the complete union before visiting children. |
| Serialization | Apply, batch core and session take the same exact-site transaction advisory lock under READ COMMITTED. Session globally locks import rows, wines and inventory in ascending identity order before child mutation. |
| Authority | RPC derives `auth.uid()` and object site; checks current staff-or-above authority before and after waits. Unauthenticated calls refuse; unauthorized/missing objects use safe not-found outcomes. No actor/site override enters the revert core. |
| Execution grants | Definer functions use empty search path and postgres ownership. Only public application wrappers grant authenticated execution; the core and archived pre-cutover functions lack client execution grants. |
| Retry/errors | Batch committed retry yields `already_reverted`; session reports only exact already-reverted child skips. Physical/source refusal has no successful child result. SQLSTATE/message pairs map to fixed public envelopes; unexpected errors and malformed receipts fail closed. |
| Types/callers | Generated interfaces contain typed-batch/session entries. Strict schemas reject extra keys and invalid counts, enforce literal zero, unique session child IDs and aggregate consistency. HTTP responses preserve the approved compatible shape. |
| UI | Batch and session confirmation copy explains retained catalog/history and whole-operation semantics. Batch success parses the exact public receipt. Errors remain visible; no partial-cleanup flags remain in current callers or UI. |
| Paired down | Guards body/metadata/ACL drift and dependents; restores prior functions, drops only exact owned core/typed identities with RESTRICT; no data deletion or CASCADE. |

These are source conclusions. They do not certify current deployed schema, live
ACLs, rollback behavior, concurrency or browser execution.

## Fresh commands and results

Every command ran from `/Users/zero/projects/_archive/terroir-prototype` using
`/bin/bash`, non-login shell. The TypeScript command avoids an incremental cache
write. Vitest inherited no production database target: its command explicitly
unset `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
`SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_URL` and `DATABASE_URL`.

| Command | Exit | Observed output |
| --- | --- | --- |
| `pnpm exec tsc --noEmit --incremental false` | 0 | No diagnostics. |
| `pnpm lint` | 0 | 0 errors, 7 existing warnings in imagery audit, Cellar test, list reorder hooks/tests, notes test and corpus fixture. |
| Focused Vitest command below | 0 | 10 files passed; 224 tests passed; 0 selected failures/skips; 753 ms. Global setup separately warned that broader live-DB suites were unconfigured. |
| Source-contract command below | 0 | 6 tests passed, 0 failed/skipped. Markers `C07_0162_SOURCE_CONTRACT_PASS`, `C08_0163_SOURCE_CONTRACT_PASS` and all four named `C09_0164_*_SOURCE_CONTRACT_PASS`. |
| `tsx` mocked-RPC casing reproduction | 0 | Both batch and session returned `{ok:false,error:{code:"internal_error",...}}` for equivalent upper/lowercase UUIDs. |
| Post-repair `pnpm exec tsc --noEmit --incremental false` | 0 | No diagnostics. |
| Post-repair `pnpm exec eslint src/domains/import/import-revert-rpc.ts src/domains/import/import-revert-rpc.test.ts` | 0 | No ESLint diagnostics. |
| Post-repair focused `vitest run src/domains/import/import-revert-rpc.test.ts`, database environment unset | 0 | 1 file passed, 30 tests passed, 0 selected failures/skips; 243 ms. Includes both casing regressions and retained mismatch/error/schema refusals. |

Focused command:

```sh
env -u NEXT_PUBLIC_SUPABASE_URL -u NEXT_PUBLIC_SUPABASE_ANON_KEY \
  -u SUPABASE_SERVICE_ROLE_KEY -u SUPABASE_URL -u DATABASE_URL \
  pnpm exec vitest run \
  src/domains/import/import-revert-rpc.test.ts \
  src/domains/import/revert-summary.test.ts \
  src/domains/import/batch-service.test.ts \
  src/domains/import/session-service.test.ts \
  'src/app/api/import/batches/[id]/revert/route.test.ts' \
  'src/app/api/import/sessions/[id]/revert/route.test.ts' \
  'src/app/(app)/import/import-client.revert-copy.test.tsx' \
  'src/app/api/bins/[id]/route.test.ts' \
  src/domains/scanning/stalled-scans.test.ts \
  'src/app/(app)/scans/page.housekeeping.test.tsx'
```

Source-contract command (reads files; no SQL execution):

```sh
node --test \
  supabase/tests/0164_import_revert_cleanup/source-contract.mjs \
  supabase/tests/0164_import_revert_cleanup/extended-source-contract.mjs \
  supabase/tests/0164_import_revert_cleanup/physical-race-source-contract.mjs \
  supabase/tests/0164_import_revert_cleanup/remaining-concurrency-source-contract.mjs \
  supabase/tests/0162_bin_code_inventory_mirror/source-contract.mjs \
  supabase/tests/0163_stalled_invoice_scan_expiry/source-contract.mjs
```

## Remaining live application proof

Use one admitted disposable loopback stack and synthetic sessions. Preserve the
retained stacks. The cheapest existing browser tool is this repo's Playwright;
use its one-worker, zero-retry setup and `FAIL_ON_SKIPPED_TESTS=1`. An explicit
`PLAYWRIGHT_BASE_URL` can target the independently guarded test app and avoid
starting another unknown server. Supply only the admitted stack's fixture keys
in the process environment, never `.env.local`.

| Repair | Existing coverage and cheapest missing extension |
| --- | --- |
| Batch import undo | `e2e/import-journey.test.ts` already drives upload, preview, include, apply and confirmed revert at 390px against a real local stack, then checks inventory removal and catalog retention. Run it at the candidate. Add captured exact HTTP receipt, batch/import-row/history persistence after reload, one committed retry (409), physical/source-conflict refusal and foreign/revoked authorization checks. The current UI test does not prove LWIN CAS or session undo. |
| Session import undo | Reuse the same isolated app and synthetic owner/staff sessions; create two small chunks through real confirm/apply, invoke `/api/import/sessions/[id]/revert`, assert strict child counts/literal zero, whole-session persistence, already-reverted skip, dependency/conflict 409 with `details.batches: []`, and unchanged state after refusal. Existing session/route unit tests use mocks; they do not close this boundary. |
| Bin rename | `e2e/bins.test.ts` only proves seeded occupancy/find, not rename, and deliberately skips in CI. Extend a guarded disposable-only runner to edit a linked bin in `/bins`, capture manager `PATCH /api/bins/[id]`, verify the bin and every same-site linked inventory label after reload while receiving receipts/history remain unchanged. Assert duplicate 409, staff/revoked denial and foreign-site 404 without changes. Reuse accepted SQL atomic/concurrency evidence rather than inventing a second migration harness. |
| Stalled scan expiry | Actual application entry is authenticated `GET /scans`; there is no expiry POST route. Seed one abandoned scan plus recent/live-job protected controls in the disposable target. Navigate to `/scans`, assert abandoned scan shows the stated stalled reason, controls stay processing, and reload adds no change. To prove warning recovery, induce a bounded local-only database RPC failure, keep history readable, inspect the visible reload warning, remove the injection, reload and require recovery. Browser request interception cannot prove a server-side RPC failure; mocked page tests alone are insufficient. No existing stalled-expiry browser test was found. |

Also test the multisite active-context edge: batch HTTP revert checks its active
`restaurantId`; session HTTP revert sends only the session UUID, and the database
authorizes membership for the session's own site. A user active in A who also has
current staff-or-above access to B can revert B by known session UUID. This matches
the accepted object's-site RPC contract, but this review does not prove the UI's
no-surprise-site-context behavior. Test it before claiming that broader property;
do not silently change the accepted database authority policy. The smallest
application repair reuses the batch-route pattern: preserve `restaurantId` from
`requireMembership`, then select only the session ID with both UUID and exact
active restaurant filters before calling the existing session RPC. Throw a
database read error and return safe 404 for an absent match; never call revert
after either refusal. Current authority inside the RPC remains the final fence.
The parent implemented this exact route-only repair. Independent follow-up read
the delta and authoritative cookie/lifecycle resolver, then passed full
non-incremental TypeScript, scoped ESLint and the combined route/receipt suite:
2 files, 36 tests, 0 selected skips, exit 0. Wrong active site returns 404 without
calling revert; lookup failure returns sanitized 500 without calling revert.
Successful current-site and existing conflict/error envelopes remain intact.
This extends the source PASS to the session mutation preflight; live multisite
execution remains pending.

Lower-priority follow-up: `GET /api/import/sessions/[id]` has the same
object-membership rather than active-site-only behavior. Track that read boundary
explicitly; a mutation preflight does not prove all session reads use active-site
context. No read-path change or completion claim forms part of this review.

The September 27 independent database note records actual 0164 races and
conservation, but pins an earlier full migration-file digest. Current source gates
pin current bytes; the reviewed core/wrapper body hashes remain the same. This
review did not revalidate the historical raw artifacts or rerun their database
commands. Do not label those results as fresh October 1 execution. The canonical
live database suites at the final candidate remain a separate M1 gate.
