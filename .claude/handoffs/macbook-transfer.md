# Handoff: MacBook transfer
status: in-progress
date: 2026-09-25
branch: feat/production-readiness-20260923
last-code-commit: c770248afba3ec531475b1847dbf5794bfd1ae3b

## Active Task

Transfer saved work through GitHub. The owner has now authorized renewed work
and a replacement goal is active. Coordinate MacBook work with this branch; do not
start competing writers against the same files or local database.

September 24 update: the owner now requests a restarted, demo-first production
goal. Read the new opening directive in the September 23 execution contract before
continuing. It prioritizes complete staff workflows and preserves all production
criteria. After the initial refusal, the owner deleted the previous paused goal
and the replacement goal was successfully created with status active. This new
owner instruction supersedes the earlier no-development pause, but never authorizes
unsafe database resets, hosted changes or a main merge.

## Goal

Continue the restaurant-first production implementation with mobile and team
workflows. The application is not production-ready. Only T00/T01 were complete
at pause; T02–T14 remain incomplete.

## Decisions

- This transfer authorizes a feature-branch push, not merge or deployment.
- Main deploys to both Railway environments sharing one hosted database.
- Migration 0154's exact 22-path source checkpoint, including generated type and
  schema-snapshot artifacts, is saved and pushed at `29b06e78`. Its isolated proof
  does not authorize a hosted apply.
- Credentials, local database contents, dependencies and raw goal evidence stay
  on the mini. GitHub alone does not reproduce the running development setup.
- Do not copy production credentials into local testing. Follow AGENTS.md and
  `docs/runbooks/local-stack.md`; start with `scripts/local/dev-local.sh`, never
  bare `pnpm dev`. Use `DEV_BYPASS_EMAIL=owner+local@terroir.test`.

## Files

- `docs/plans/2026-09-23-terroir-production-execution.md`: execution contract.
- `docs/plans/2026-09-20-terroir-product-data-requirements.md`: approved scope.
- `docs/feature-ledger.json`: completion ledger; active is not complete.
- [Prior pause handoff](terroir-production-credit-pause.md): detailed prior evidence,
  suspended database actions and mini-only recovery paths. Its earlier no-push
  instruction is superseded only by this owner's transfer request.
- `docs/ARCHITECTURE.md`: canonical current code and database contracts.
- `docs/runbooks/local-stack.md`: canonical local startup, port, and conservation
  safety contract.

## Current transfer ledger

| State | Checkpoint | Evidence and limit |
|---|---|---|
| Saved and pushed | `44d046d5` exact-bottle Open/Pour application slice | 141/141 focused checks plus native, Opus, and immutable-range security review passed. This is a partial Phase B checkpoint; physical contract version 2 remains disabled. |
| Saved and pushed | `d35a9dae` live-test conservation and `3532f13e` local app origin | 41/41 combined focused checks plus native gates, Opus review, and exact-range security review passed. These are launch and conservation safeguards, not a runtime application proof. |
| Saved and pushed | `29b06e78` 0154 authority source checkpoint, 22 paths | Isolated V6 apply, fresh settlement, and immutable-range security review passed. The retained full local stack remains at schema 0152 and physical contract version 1; all nine measured raw-cost exposures remain open. |
| Saved and pushed | `f402beea` effective service-event readers and guarded 0155 view grant, 19 paths | The isolated retained-C V4.1 run passed apply/down/reapply, reader semantics and 16 rollback-only ACL cases. Generated artifacts and the immutable-range security review passed. This does not apply 0155 to the browser stack or activate physical contract version 2. |
| Saved and pushed | `e9a49e5d` measured closeout integration, 20-path V2 checkpoint | The corrected author and native independent sets pass 100/100, Opus accepted the bounded source, and immutable-range security review passed. Runtime proof remains pending. |
| Saved and pushed | `9f3a1b25` receipt-bound physical Undo, exact 20-path checkpoint | The frozen 22-file review packet included two unchanged architecture tests; the commit changes 20 paths. Native and bounded source review accepted it, and the affected gate passed 190/190 with zero selected skips. The exact `1c37b7ab..9f3a1b25` immutable certificate passed with no prescribed Gitleaks or validator findings. No SQL, browser, reconciliation, or Phase B completion is claimed. |
| Saved and pushed | `3a928550` exact-bottle reconciliation and recoverable retries, 19 paths | Independent focused checks passed 98/98; the final binding also records a 46-test recheck of the four repaired recovery defects. Opus and immutable-range security review passed. Live reconciliation and definitive-conflict recovery remain incomplete. |
| Saved and pushed | `6163388a` retained Open/Pour/Undo retry controls, four paths | Independent component checks passed 32/32, including a positive custom-picker control. Opus and immutable-range review passed. No browser geometry or live retry result is claimed. |
| Saved in branch | `3359f0a7` import/scan history conflict mapping, nine paths | Independent TypeScript/security review and 189 focused tests passed; Opus accepted the source. The SQL dependency producer and truthful persisted session status still need implementation. |
| Saved in branch | `7a4a2e37` completed-v1 replay validation, nine changed paths | Independent review passed 99 tests and 16 semantic probes; Opus accepted the V2 repair. Live replay-only SQL and atomic legacy retirement remain unverified. |
| Saved in branch | `c770248a` captured-capacity yield, two paths | Author and independent checks each passed 12 tests, and Opus accepted the source. Live relational-query proof remains pending. |

`docs/feature-ledger.json` remains the only completion authority. The prior remote
check confirmed `6163388a`; this branch also contains the three reviewed source
checkpoints above. Verify the exact checkout on the MacBook. Raw verification
artifacts and database contents remain on the mini. A checkout does not provide
a running preview.
None of these checkpoints completes C04, D1, C06, or Phase B.

## Evidence

Current partial application checkpoint `74af64f2` requires explicit site capability
grants before selecting/serializing cellar costs, displaying internal pricing targets
or returning pricing suggestions. Native review passed 38 tests in eight selected
files (zero selected skips), 14 adversarial helper probes, TypeScript, scoped ESLint,
file-size and whitespace checks. Opus accepted this bounded source checkpoint.
The exact code-commit range passed a redacted secret scan. Four network-reset
diagnostics remain in an unchanged drawer-state test; this is not a clean full-suite
or browser verdict. Mini-only evidence: goal proof `demo-staff-cost-20260924/`.

The next checkpoint `d0372759` applies the same explicit cost-and-margin grants to
wine-detail queries and below-cost badges. Independent focused tests passed 33/33;
the changed live-database test remains unexecuted. Checkpoint `b0a3ecfe` fixes the
offline-context request type and an inert test-fixture false positive; its independent
44/44 tests and full no-incremental TypeScript check passed. Opus accepted both
bounded checkpoints. These counts are selected tests, not full-release coverage.
Mini-only evidence: `demo-detail-cost-20260924/` and
`demo-verification-blockers-20260924/` under the goal proof directory.

Checkpoint `0ba6c37b` protects wine-list detail reads too: safe wine fields go to
the client, and internal pricing inputs/suggestions require both read grants.
Read failures leave suggestions unavailable, not zero. Independent focused tests
passed 5/5, with TypeScript and scoped gates passing; Opus accepted the bounded
source. Evidence is in `demo-list-cost-20260924/`. No live database or browser
pass is implied by these unit checks.

Checkpoint `bccd2277` protects reconciliation-queue and supplier price-comparison
reads with exact-site `cost.read` before querying protected data. The price page
shows an unavailable state when access cannot be verified, not an empty or zero
result. Independent focused tests passed 36/36 with zero selected skips; full
Node20 TypeScript and scoped lint/file-size checks passed. Opus accepted the bounded
source. Actual 390px browser DOM showed the expected unavailable message without
cost values or horizontal overflow; screenshot capture still failed. Evidence:
`demo-cost-endpoints-20260924/` and `demo-browser-recheck-20260924/` on the mini.

Checkpoint `698587e3` keeps safe Insights quantities, scan activity and service
metrics visible while gating procurement costs, pricing modules and CSV exports.
Denied or failed cost reads show unavailable values, never fabricated zeroes.
Sales revenue remains visible; this is not a blanket restriction on monetary values.
Independent tests passed 56/56 with zero selected skips, plus Node20 TypeScript,
scoped ESLint and the changed files' size limits. Opus accepted the corrected
checkpoint after identifying a delayed promise-rejection handler; a regression
test reproduced that failure before the fix. Concurrent uncommitted Cellar work
temporarily failed the repository-wide size gate, so these results do not establish
a green full checkout. Mini-only evidence: `demo-insights-cost-implementation-20260924/`.

Historical 390px browser captures used a synthetic local owner against a database
without 0154. They do not prove staff-role isolation, positive grants, or a completed
inventory journey. This transfer does not claim a current positive browser result.
Earlier screenshot failures and captures remain in
`demo-playwright-capture-20260924/` as historical evidence.

These checkpoints are NOT a complete authorization rollout. Until 0154 is applied and
explicit grants exist, cost/target displays and suggestions fail closed for owners and
managers too;
manual menu-price entry remains available by source inspection. Raw authenticated
database access, several other screens and historical JSON cost copies remain open.
Do not expose this branch
to real staff/data or deploy it alone as completed privacy protection. No C04 or demo
milestone was completed. At that checkpoint the retained stack stayed at 0152;
neither 0153 nor 0154 was applied there. A synthetic local authenticated HTTP request
proved the missing-authority 403, not live positive grants or database privacy.

Historical checkpoints, not rerun for transfer: C03 browser checkpoint 27 pass,
0 fail, 0 skip; Toast pure contracts 217 tests; JEV advisory modules 145 tests;
pilot calculations 59 tests. These do not prove complete end-to-end workflows.
Physical-bottle foundation b7fba749 passed earlier disposable SQL and generated-artifact
checks. A later run applied 0153 on an isolated disposable target and stopped in the
0154 preflight. That failure remains valid historical evidence, but the later isolated
V6 run superseded it for the bounded 0154 apply and settlement result. V6 did not
change the retained full local stack or prove a hosted rollout.
The outgoing 44-commit range passed a redacted Gitleaks scan before transfer.

## Open Questions

The MacBook needs GitHub repository access, dependencies and an isolated local
Supabase setup before runtime testing. Provider-backed features need separately
provisioned credentials. Toast access and JEV runtime integration remain gates.
Raw controller evidence and QA worktrees are backed up only on the mini; request
a separately reviewed transfer if needed. Do not upload database dumps or raw
archives to GitHub.

## Next Action

On the MacBook, read this handoff and AGENTS.md, verify the checked-out branch and
exact commit, then follow the local-stack runbook. Do not run `dev-stack.sh` against
an existing local stack unless erasing its database is intentional. Report setup
blockers instead of inventing a fresh-stack procedure.

For the active mini goal, finish the remaining canonical Phase B gates and design
stale-count recovery that preserves the failed draft as required by the source
ledger. The new provenance, replay and yield source reviews passed; live database
and browser acceptance remains separate. Preserve the existing
checkpoints and failed-run evidence. The finite 0155 rehearsal left the retained-C
database at 0155; it is not the browser environment. The separate
synthetic browser stack reached 0154 with contract version 1. Its app on port 3100
is stopped, and screenshot capture remains unresolved. The original retained stack
was not reset or migrated by those rehearsals. Revalidate each exact target before
use; do not retry spent historical runs or treat local proof as hosted approval.

Exact-bottle Open/Pour application work is saved in `44d046d5`. The corrected closeout
V2 leaf is saved and pushed at `e9a49e5d`; its 100/100 focused author and native
independent checks passed, Opus accepted the bounded source, and immutable-range
security review passed. The exact commit is saved and pushed; runtime proof remains
outstanding. Receipt-bound Undo is saved and pushed at `9f3a1b25`; 190/190 focused
checks and bounded native and Opus source review passed, as did the exact immutable
range security certificate. It binds physical Undo to exact event, bottle, and wine
receipt identity, keeps the same operation UUID and payload for uncertain retries, and
blocks competing mistaken-discard exits while a correction remains unresolved. No SQL
or browser proof ran. Do not enable contract version 2 until
all required readers, writers, Undo, reconciliation, analytics, provenance, and the
canonical pre-cutover gates pass.

No completed browser-to-database service demo, current positive browser pass, or
all-width visual-QA pass is claimed.

## Suggested Skills

Use goal and fable-mode only when the owner resumes implementation; use the
database, security and TypeScript reviewers before promoting unfinished work.
