# Restaurant demo milestone

Status: authorized for execution by the owner's September 26 Pacific / September 27 UTC request. Incomplete.

## Outcome

Deliver and push a testable restaurant application milestone: receive and place wine,
find the correct bottle, open it, record service, count stock, and resolve a discrepancy.
Demonstrate persisted results through the browser at desktop and mobile sizes with
staff and manager permissions. Include simple instructions for the owner's MacBook.

This is the next delivery milestone, not a declaration that the entire product is
production-ready. The approved production scope and C00–C14 remain in
[the production execution contract](2026-09-23-terroir-production-execution.md).
Collector, advanced offline, live Toast, AI/JEV and pilot requirements remain open
unless their own evidence passes. Do not remove them from the source ledger.

## Reassessment and carry-forward

This section records the activation baseline. Later execution progress is recorded below.

- Canonical checkout: `/Users/zero/projects/_archive/terroir-prototype`.
- Branch: `feat/production-readiness-20260923`; starting HEAD `fe9ba7c103770f7bf6a932db9175888fe307e0b1`.
- The two generated-RPC type errors are resolved. The September 27 full TypeScript
  check passed, followed by 88 focused tests with zero failures or skips. Do not
  reopen that diagnosis; regenerate and recheck after new migrations.
- An independently reviewed API exercise proved four 150 mL pours, 150 mL remaining,
  duplicate-request safety and fresh-session persistence on a frozen local build.
  It does not prove the current browser or mobile experience.
- Migration 0160 exists on retained local target D; its functional rollback fixture
  remains unrun. Reuse accepted SQL and type evidence; finish only the missing proof.
- Migration 0161 receiving SQL is in progress. Its exact accepted contract is
  [bottle-location receiving](2026-09-27-terroir-bottle-location-receiving.md).
- The working tree contains substantial unpublished source. Preserve it. Classify
  files and exclude credentials, caches and machine-local artifacts before staging.

Historical evidence remains under `/Users/zero/.claude/goal-state/terroir-production-20260923/`.
New state and proof: `/Users/zero/.claude/goal-state/terroir-restaurant-demo-20260927/`.
Link to valid old proof rather than copying or rerunning entire reviewed systems.

## Milestone acceptance criteria

| ID | Required result | Proof |
|---|---|---|
| M1 | Finish pending local database integration without exposing costs or breaking inventory/history | Exact-target functional, retry/concurrency and authorization checks; paired-down safeguards; generated types and snapshot agree; full TypeScript passes. No skipped critical database tests. |
| M2 | Repair all four known application gaps | Regression and live-boundary evidence for bottle receiving, atomic bin-code mirroring, owner-approved import-revert catalog retention with atomic inventory/LWIN/status reversal, and stalled invoice-scan expiry. Each caller uses its reviewed authority boundary; no client/service-role bypass or swallowed failure. |
| M3 | Complete restaurant journey in a real browser | Authenticated receive/place/find/open/four-pour/count/manager-reconcile journey, persisted after reload and new session; exact-bottle choice, retry safety, rejected staff mutations, hidden staff costs and cross-site isolation. No mocked mutation or API-only substitute. |
| M4 | Role-aware, mobile-usable pages and actions | Route/action inventory for every restaurant-facing page, mapped to jobs and actual capabilities. Repair demo-critical and high-severity usability defects. Record lower-priority dispositions explicitly. Browser proof at 320/390/768/1200px, >=44px service targets, keyboard/focus, light/dark contrast, long labels and loading/empty/error/pending/success states. No clipped primary actions. |
| M5 | Reviewed, reproducible GitHub handoff | Required CI-equivalent gates at the release candidate with counts/skips; independent code/security/database/browser review; cleanly scoped commits pushed to the feature branch; remote SHA verified. Portable demo setup, synthetic fixture description, role logins without secrets, step-by-step script, expected outcomes and limitations. |

Completion requires all five criteria. A blocked review or browser check cannot be
waived by a passing unit suite, artifact-presence checker, or a push.

## Four repairs and sequence

1. Finish 0160's missing functional check and complete the approved 0161 receiving
   database/API/client integration. Replace free-text bin identity with an explicit
   active-bin choice. Persist one operation ID before sending; never replace an
   uncertain attempt with a new ID. Preserve rapid next-bottle scanning.
2. Make bin renaming and the corresponding inventory location labels one atomic,
   site-scoped change. Preserve immutable historical receiving receipts.
3. Keep catalog wines and history on import revert, as approved September 27. Put
   eligible inventory reversal, LWIN-pair cleanup and batch/session status inside the
   authorized atomic database operation. Preserve physical-history guards and typed
   results, including compatible `orphanWinesDeleted: 0`. Explain retention in the UI;
   no route-side delete loop or partial-success cleanup.
4. Replace the swallowed stalled-invoice update with an authorized fixed-scope operation
   and visible, recoverable failure. Keep the existing timeout semantics.

For repairs 2–4, document the smallest exact contract and regression first, have an
independent reviewer check it, then implement. Do not reopen settled receiving design.
Reserve any migration number through the existing numbering runbook.

The exact stalled-scan repair contract is accepted in
[stalled scan expiry](2026-09-27-terroir-stalled-scan-expiry.md), including the
independently required lock/snapshot ordering and isolation guard. Implementation
and live proof remain incomplete.

### Accepted bin-code mirror repair

The independent September 27 source review accepts an additive row trigger on
`public.bins`: `AFTER UPDATE OF code`, only when `NEW.code IS DISTINCT FROM OLD.code`.
Its closed postgres-owned definer function has empty search_path and updates only
`inventory_items.bin_location = NEW.code` for `bin_id = NEW.id` and
`restaurant_id = NEW.restaurant_id`. Revoke direct function execution from all client
roles. Existing bin mutation authorization stays in force; the trigger adds no authority.
Failure aborts both bin and mirror updates in the same transaction. Do not touch rows
matched only by old text, unplaced rows, other sites, or immutable receipts/history.

After the additive migration, simplify the existing manager-gated rename route to
one validated site/id-scoped bins update. Remove the direct inventory mirror, reread,
convergence and compensating rollback. Duplicate-code and not-found behavior remain.
Rollback restores the compatible caller before removing the exact trigger/function;
the paired down deletes no data, uses no CASCADE, and changes no unrelated ACL.

Prove exact-site/all-linked-item mirroring, unrelated-row and history conservation,
injected-update atomic rollback, duplicate-code rollback, two concurrent renames,
staff/revoked/cross-site denial and no route-side inventory update. Migration 0162 is
reserved for this repair; source readiness is not runtime or staff-cost-seal completion.

## Role and UX scope

Job labels below guide task priority; they do not invent database roles or grant access.
Map each job to existing authoritative memberships and capabilities. An interface
must not advertise a forbidden action as available, and hidden controls never replace
server/database enforcement.

| Team member | Prioritize | Guard against |
|---|---|---|
| Server / floor staff | Find wine, exact storage location, available sealed/open stock, choose bottle, record pour quickly | Cost disclosure, wrong-site action, duplicate taps, ambiguous saved state |
| Sommelier / service lead | Wine details, bottle selection, open volume, service guidance and permitted corrections | Dense purchasing information crowding service; unsupported recommendations |
| Receiving / cellar staff | Scan or select wine, explicit bin, confirm quantity, clear success and next item | Typed text mistaken for a bin, lost pending receipt, accidental double receipt |
| Beverage manager | Receive/import, organize locations, count sealed/open stock, review discrepancies, authorized costing | Direct unaudited stock overwrites, stale counts, silent import/revert failure |
| Owner / multi-site manager | Explicit site context, access management, operational exceptions, authorized reporting | Blended site inventory, surprise context switch, overbroad staff grants |

Audit navigation, cellar, wine detail, scanning/receiving, import/review, bins/locations,
count/reconciliation, lists, insights/pricing, team/settings and other discovered
restaurant routes. For each page record primary job, primary action, permission,
entry/exit, interruption behavior, visible state and evidence. Review all pages;
implement the highest-impact defects first. Do not turn this into a wholesale redesign.

The first implementation/browser spine is `/scan-bottle`, `/cellar`, `/cellar/[wineId]`,
`/cellar/open`, `/cellar/reconcile`, `/reconcile-queue`, and `/bins`, plus any discovered
high-severity blocker. The other pages receive explicit review/disposition, not an
automatic redesign. Attach concurrency evidence to the newly changed mutation;
0160 needs only its already-defined missing rollback fixture and conservation check.

### Route-audit dispositions

- R1: Keep section configuration membership-wide, as `app_spec.txt` and the existing
  API require. Add a Cellar sections entry in the shared Settings menu; retain the
  separate owner-only settings panel for its broader owner actions. This is a
  navigation repair, not an authorization change. Keyboard and narrow-height menu
  behavior receive regression coverage; actual rendered geometry remains pending.
- R2: Keep import membership-wide under the current contract and test that boundary.
  Beverage-manager prioritization describes a job, not an additional access rule.
  Do not hide Import from staff while leaving its endpoints authorized.
- R3: The normal Scan page now links to known-wine receiving separately from photo
  identification. Verify that entry during the browser journey.

Use `DESIGN.md` as visual authority. Preserve Terroir tokens and typography. Refero
research supports selectors, stable action hierarchy and recovery states, not a new
brand. Existing receiving reference lock is reusable. Avoid surprise mobile autofocus,
icon-only destructive actions, moving service controls and AI-generated service layouts.
Distinguish pending, committed, unavailable and stale states in plain language.

## Execution rules that prevent another stall

- Keep one end-to-end workflow as the critical path. Parallel workers may own disjoint
  database, caller and review tasks; one agent coordinates integration.
- Every work cycle must change a testable user behavior or close a named blocker.
  Report that result, not review counts or lines changed.
- Use existing test tools and retained evidence. No new generic harness, admission
  framework or manifest layer unless a concrete failing safety check requires it.
- Limit environment diagnosis to 30 minutes of active work before reassessing.
  After two failed attempts, change approach with independent review. Continue a
  safe application task while an external dependency is unavailable. Never weaken guards.
- Review changed risk surfaces. Reopen settled work only for new evidence or a changed
  dependency. Run focused tests per repair and full required gates at the candidate.
- Save reviewed, coherent checkpoints rather than accumulating another large unpublished
  batch. Intermediate checkpoints must be labelled incomplete, not demo-ready.
- Keep proof revision-specific. Code, schema or fixture changes invalidate only the
  affected evidence. Preserve failed results and explicit skipped counts.

## Authority and external gates

The owner authorizes this milestone's implementation, testing, UX improvements and
feature-branch commit/push. No automatic main merge, hosted migration, production
deployment, credential change, destructive reset or new purchase is authorized.
Never load `.env.local` for development or tests. Use guarded isolated local startup
and synthetic data, preserving retained databases and unrelated processes.

The owner approved isolated Playwright on September 27: use synthetic accounts,
local test data and an isolated profile, never the personal browser profile or
production data. The owner also approved catalog retention on import undo and
autonomous routine implementation decisions. These resolve the earlier approval gates.

For advisory review, the owner's latest resume approval permits an independent Codex
reviewer while Opus is unavailable, superseding the earlier provider fallback preference. Verify
actual provider model identifiers and availability; never label a different model as
the requested one. Use existing approved billing/auth lanes. Provider review remains
advisory and cannot replace executable database/browser evidence. JEV remains advisory
and requires its safe credential lane. Avoid retrying unchanged provider failures.

Blanket advance approval permits routine, in-scope decisions; it does not waive safety
gates, turn this demo milestone into a production deployment, or authorize destructive
retained-data resets, credential changes, purchases or main merges.

The independent verifier must reproduce the critical journey at the candidate revision.
The author cannot be the sole reviewer. Run the existing goal completion checker against
the new state only after substantive reviews and actual proof pass. Its file-presence
check is necessary, not sufficient. A demo milestone pass never completes C00–C14.

## Execution checkpoint — September 27, 07:35 UTC

- The missing0160 functional rollback check passed with independent conservation review.
- Receiving now has an explicit active-bin selector, authenticated context fencing,
  durable same-operation retry, receipt-based session counts, wine-name lookup, and a
  normal Scan-page entry. Its source review passed; rendered browser/mobile proof is pending.
- Atomic bin-mirror migration0162 and the one-update API caller passed source review.
  Actual functional, atomic, migration-cycle and two-session rename checks passed.
  Exact test-data cleanup and protected-database conservation passed; final independent
  runtime closeout passed. Failed fixture attempts remain in the evidence record.
- Migration0161 applied successfully to a new isolated local clone. Core, atomic,
  corrected compatibility, migration-cycle, guarded-down and both real concurrency
  checks passed. Fixtures were cleaned and retained databases conserved. Actual types
  were generated; full TypeScript passed without suppression at the0161 checkpoint.
  Independent DB and TypeScript proof reviews passed. The current snapshot update is
  recorded below.
- Stalled-scan RPC caller and visible history-page recovery behavior passed focused
  tests and independent source review. Migration 0163 is applied locally. Its functional,
  isolation-refusal, migration-cycle and six guarded-down checks passed. Both real
  completion and re-extraction contention checks observed the waiting session and passed.
  Final protected database state is unchanged; the exact synthetic re-extraction fixture
  is retained because its capability audit is immutable. Final independent runtime
  closeout passed. Failed fixture attempts remain recorded; no production SQL was
  weakened to make them pass.
- Actual database types now contain the expiry RPC, preserving all 119 prior RPCs.
  Full TypeScript passes without suppression. The deterministic schema snapshot contains
  all 135 source migrations through 0163; independent type and snapshot reviews passed.
  Paired-down and migration-manifest checks pass. These are bounded integration results,
  not a whole-M1 or production-readiness verdict.
- Import-revert physical catalog deletion is blocked by logical-history insert races.
  Owner acceptance is pending for the safer bounded alternative: retain catalog wines
  while atomically reverting inventory, eligible LWIN links and status. No cutover occurred.
- The23-route source audit has explicit dispositions. Cellar-section navigation and
  reconciliation typography repairs pass focused tests/design gates; rendered role/mobile
  verification, full browser journey, portable instructions and commit/push remain unfinished.
- Section-editor recovery now retains failed drafts and delete confirmation, keeps the
  saved order after failed reordering, disables editing after failed loading and prevents
  overlapping saves. Independent21-test/source review passed; browser proof is pending.
- An interim local unit run passed5549tests with182skipped. It did not configure the
  live database and is not a substitute for the final candidate gates or browser journey.

No M1–M5 criterion is complete at this checkpoint. No hosted migration or deployment
has occurred, and the feature branch has not been published with this milestone.

## Resume checkpoint — October 2, 04:15 UTC

The owner reapproved catalog-retaining import undo, isolated Playwright with synthetic
local data, and a separate Codex reviewer. The native goal is active again. This
approval is limited to the demo milestone and feature-branch commit/push; it does not
authorize a new `main` merge, hosted database change or production deployment.

Fresh GitHub inspection confirms PR #229 merged on September 27. The source now
includes migration 0164 and the later physical/authority cutover repairs; the saved
September 27 goal state and draft handoff describe earlier incomplete checkpoints,
not the current implementation. Current `origin/main` is `2d76a701`; the new demo
closeout branch starts at `c4bf61b4`, retaining the reviewed Cellar layout repair.

The next critical path is the existing portable demo package: prove absent Docker
resources and exact cleanup ownership, apply fresh migrations transactionally, admit
loopback-only services, then demonstrate the complete restaurant journey without
replaying a failed mutation. Current import/caller review proceeds independently.
All M1–M5 acceptance criteria remain unchanged and require revision-bound evidence.

## STOP checkpoint: October 2 mobile attempt C

The independently reviewed attempt-C replan exhausted the authorized portable
startup attempts. No fourth launch or automatic replay is allowed from this
checkpoint.

Attempt C reached `local-app-admitted` on a fresh loopback-only target. The launcher
applied 136 migrations through `0164`, admitted the zero-stock catalog fixture,
created synthetic users, and started the database-backed application. The real
mobile journey received two bottles with distinct committed identities and passed
the explicit same-key receive replay check. It then **FAILED** at
`received-main-2-of-2`, before opening a bottle. The journey still queried the stale
placeholder `Search name, producer, region…`; the current Cellar search exposes
`Filter this cellar`. This is a journey-selector failure. It does not demonstrate an
application stock defect or satisfy the remaining open/pour/count/reconcile,
persistence, staff-denial, responsive, or accessibility results. See the
[journey result](../evidence/restaurant-demo-20261001/mobile-c-journey-result.json)
and [failure screenshot](../evidence/restaurant-demo-20261001/mobile-c-failure.png).

Independent attempt-C database checks passed the bounded `0162` and `0163`
functional rollback contracts and left no prefixed fixture rows. The separate staff
acquisition-cost confidentiality result **FAILED**: a staff identity with no effective
`cost.read` received zero rows from the governed reader but successfully selected raw
`inventory_items.unit_cost = 47.75`. The diagnostic transaction rolled back with no
residual user, wine, or inventory rows. M1 remains incomplete pending a forward raw
cost privacy seal and its reviewed negative/positive runtime matrix. The retained
proof is in [functional contracts](../evidence/restaurant-demo-20261001/functional-contracts.md)
and [staff raw-cost failure](../evidence/restaurant-demo-20261001/staff-raw-cost-failure.md).

Current non-runtime checks are bounded: 29 portable source tests passed with zero
skips; the normal Turbopack build completed 73 pages; the focused import/session set
passed 36 tests; and the full unit run passed 5,633 with 141 skips. These results do
not replace live-database suites or the failed real-browser path.

M1–M5 remain incomplete. Nobody reproduced the package on the MacBook, no native
application passed, and no hosted migration, production deployment, new `main`
merge, credential change, or retained-data reset occurred.

Attempts A, B, and C remain preserved. Goal safety freezes deletion of the external
runtime directory even after success; owned Docker service cleanup remains gated on a
passing journey plus exact re-admission. Do not stop, delete, reseed, adopt, or rerun
the failed targets. Resume only from a reviewed stable accessible locator and privacy
seal with a fresh namespace; do not roll the current application UI back to the stale
placeholder. The pushed and remotely verified application checkpoint remains
`ffced31d0964082c2554b1e566d5762e4c36619a` at evidence capture. It is not a
permanent claim about the latest feature-branch tip. The portable source snapshot
is the commit containing this checkpoint; resolve its exact `HEAD` and verify the
remote branch ref before reuse.

## Source-only locator repair checkpoint: October 2, 05:50 UTC

Against branch base `e115b54b1903b9880da270df4856130e0e368f43`, the journey's
single Cellar filter lookup now uses Playwright role `searchbox` with exact accessible
name `Filter this cellar`, matching the current Cellar UI. A regression requires that
role-and-name locator and rejects the stale placeholder selector. The regression was
red before the source change, with two tests passing and one failing. The one-line
selector repair made all three focused tests pass, and the complete portable source
suite passed 30 of 30 tests with zero skips. Independent Codex source review passed.

This checkpoint contains no browser or application-runtime execution and makes no
new journey claim. No Docker service, SQL, credential, dotenv file, failed-target
restart or adoption, mutation replay, commit, or push occurred. Attempt C remains
failed, its retained evidence remains authoritative for that run, and the prohibition
on a fourth launch or replay remains in force. The staff raw-cost privacy failure is
still open. M1–M5 remain incomplete.

## Source-only S10 recompute-receipt checkpoint: October 2, 06:03 UTC

Against branch base `e115b54b1903b9880da270df4856130e0e368f43`, both protected
recompute services now return and persist exact cost-free success receipts. The
Cellar-health kind is `cellar_health_recompute`; the pricing kind is
`pricing_recommendations_recompute`. Each receipt contains only `version: 1`, its
fixed `kind`, and `status: "succeeded"`. The API routes validate those exact contracts
and reject legacy derived counts, segment or class maps, and any additional key.

The bounded source suite passed 49 tests with zero skips. It covers both service
returns, exact future `background_jobs.result` writes, strict HTTP bodies, rejected
legacy and expanded receipts, unchanged client request behavior, and successful
pricing recompute for a delegate with `pricing.manage = true`, `cost.read = false`,
and `margin.read = false`. TypeScript, targeted lint, the file-size ratchet, and diff
hygiene passed. A broader unit attempt did not complete as evidence because unrelated
search and theme tests required an absent localhost application and unavailable Node
local storage. Independent S10 source review is running; no verdict is recorded yet.

This checkpoint changes future source output only. Historical detailed job results,
the authenticated table ACL cut, invoice-image Storage policy, real JWT/Data API and
Storage checks, paired migration proof, and browser runtime verification remain open.
No SQL, migration, Docker service, credential, dotenv file, browser or application
runtime, commit, or push was used. Attempt C remains failed, attempts A–C remain
closed evidence, and no fourth launch or replay is authorized. Any later attempt D
requires full independent privacy-seal acceptance, a frozen candidate, separate owner
authorization, and a fresh namespace, paths, and ports. Staff-cost privacy, M1, and
M1–M5 remain incomplete.

## Source-only S10 review retry checkpoint: October 2, 06:11 UTC

The first independent S10 source review failed because
`scripts/seed-local-operational.ts` still read the removed `health.classified`,
`health.segments`, `pricing.recommended`, and `pricing.classes` result fields. That
script is outside the TypeScript compile boundary, so the earlier green typecheck did
not cover the stale caller.

A new static source regression failed with 12 tests passing and one failing before the
repair. The seeder now logs only each closed receipt's `kind` and `status`, preserving
the recompute order and all seed business actions. The repaired seven-file focused
suite passed 50 of 50 tests with zero skips. TypeScript, targeted lint, and diff hygiene
passed, and a fresh search of `src` and `scripts` found no runtime caller reading those
four legacy result fields. The independent review retry is pending; no independent S10
pass is claimed.

The earlier broad `pnpm test` attempt still is not evidence: its terminal exit was not
observed. A later process-state check found no remaining `pnpm test` or Vitest process,
but no pass or failure is inferred from that absence.

This remains a source-only checkpoint. Historical detailed job results, the raw table
ACL cut, invoice-image Storage policy, real JWT/Data API and Storage checks, paired
migration proof, the full privacy seal, and browser runtime verification remain open.
No seeder, SQL, migration, Docker service, credential, dotenv file, browser or
application runtime, commit, or push was used. Attempts A–C remain closed evidence,
and no fourth launch, replay, or attempt D is authorized. Any later attempt D still
requires full independent privacy-seal acceptance, a frozen candidate, separate owner
authorization, and fresh paths, ports, and namespace. Staff-cost privacy, M1, and
M1–M5 remain incomplete.

## Independent S10 source-review disposition: October 2

Independent review passed the repaired eleven-path source leaf. The reviewer reran
the seven focused files: all 50 focused tests passed with zero focused skips. The
preimage probe failed on the stale seeder fields and the repaired probe passed.
TypeScript, targeted lint, the file-size ratchet, scoped diff hygiene, and the
whole-tree caller search also passed. Vitest's global setup separately listed 25
unavailable live-database suites; they are not counted as passes and are outside this
source-only verdict. The earlier broad `pnpm test` attempt remains unaccepted because
its terminal exit was not observed, although no owned test process remained at the
later process-state check.

This approval is limited to exact future HTTP and successful-job receipts plus the
compatible seeder caller. Historical job results, raw-table ACLs, invoice-image
Storage policy, real JWT/Data API and Storage checks, paired migration proof, the full
privacy seal, runtime verification, and the final committed-range security scan remain
open. Attempts A–C remain closed evidence. No fourth launch, replay, or attempt D is
authorized; any later attempt D still requires full independent privacy-seal
acceptance, a frozen candidate, separate owner authorization, and fresh paths, ports,
and namespace. Staff-cost privacy, M1, and M1–M5 remain incomplete.

## Source-only invoice-job error checkpoint: October 2

Against base `e7ad3b335d4173e6deee3debe467bfa791f2713c`, both
`invoice_extract` failure-completion writers now store one closed pair. A private
total mapper preserves the 24 admitted handler and scan-service codes, maps any
unrecognized or dynamic code to the existing `unknown`, and writes only
`Invoice extraction job failed.`. It never persists the handler's raw failure prose.

The direct regression failed with 34 failures and eight passes before the source
change and passed all 42 tests afterward. The six-file completion, run-once, handler,
scan recovery, fencing, and arithmetic set passed all 105 focused tests with zero
focused skips. Independent review repeated those gates and passed this bounded
two-file source leaf. Vitest global setup separately listed 25 unavailable
live-database suites; they are not counted as passes.

Retry versus dead classification, attempt accounting, exponential backoff, claim
clearing, tenant/job/worker/status fencing, database write-error propagation, success
clearing, provider-call behavior, scan recovery, the fixed SQL reclaim pair, and all
`result` and `metadata` behavior remain unchanged.

A separate fixture source leaf retains safe synthetic job ordinals 1, 2, 3, 4, 8, 9,
11, and 12 and omits only four unsupported legacy error fixtures. Both deterministic
IDs derive from the original ordinal, and every retained job is hard-projected to
empty `result` and `metadata` objects plus null error fields. Independent review
reproduced the three-failure, one-pass baseline and passed the current two-file set at
17 of 17 focused tests. The leaf never deletes or rewrites old database rows.

This remains source-only preparation. Historical job rows, raw-table ACLs,
invoice-image Storage policy, real JWT/Data API, RPC, Storage and service-worker
proof and the full privacy seal remain open. The fixture leaf does not alter or waive
M4 rendered-state coverage or S16 worker, retry, recovery, and exactly-once coverage.
No database,
SQL, migration, seed execution, browser, runtime, Docker service, credential, dotenv
file, commit, or push was used. Attempts A–C remain closed evidence. No fourth launch,
replay, or attempt D is authorized; any later attempt D still requires full
independent privacy-seal acceptance, a frozen candidate, separate owner authority,
and fresh paths, ports, and namespace. M1–M5 remain incomplete.
