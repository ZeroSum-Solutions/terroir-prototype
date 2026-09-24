# Handoff: MacBook transfer
status: in-progress
date: 2026-09-24
branch: feat/production-readiness-20260923
last-code-commit: bccd227791ec612b4728b23e70edd7e349bb3c3d

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
- Keep unfinished 0154 out of the active migration directory on the transferred
  branch. Its source is preserved in `0154-unverified-recovery.patch` beside this
  file. Review it before restoration; SQL runtime checks and generated artifacts
  are missing. Do not apply it to any hosted database.
- Credentials, local database contents, dependencies and raw goal evidence stay
  on the mini. GitHub alone does not reproduce the running development setup.
- Do not copy production credentials into local testing. Follow AGENTS.md and
  `docs/runbooks/local-stack.md`; start with `scripts/local/dev-local.sh`, never
  bare `pnpm dev`. Use `DEV_BYPASS_EMAIL=owner+local@terroir.test`.

## Files

- `docs/plans/2026-09-23-terroir-production-execution.md`: execution contract.
- `docs/plans/2026-09-20-terroir-product-data-requirements.md`: approved scope.
- `docs/feature-ledger.json`: completion ledger; active is not complete.
- `.claude/handoffs/terroir-production-credit-pause.md`: detailed prior evidence,
  suspended database actions and mini-only recovery paths. Its earlier no-push
  instruction is superseded only by this owner's transfer request.
- `.claude/handoffs/0154-unverified-recovery.patch`: 20-path unfinished packet.

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

These checkpoints are NOT a complete authorization rollout. Without 0154 and explicit
grants, cost/target displays and suggestions fail closed for owners and managers too;
manual menu-price entry remains available by source inspection. Raw authenticated
database access, several other screens and historical JSON cost copies remain open.
Do not expose this branch
to real staff/data or deploy it alone as completed privacy protection. No C04 or demo
milestone was completed. Active local schema remains 0152; neither 0153 nor 0154
was applied during this checkpoint. A synthetic local authenticated HTTP request
proved the missing-authority 403, not live positive grants or database privacy.

Historical checkpoints, not rerun for transfer: C03 browser checkpoint 27 pass,
0 fail, 0 skip; Toast pure contracts 217 tests; JEV advisory modules 145 tests;
pilot calculations 59 tests. These do not prove complete end-to-end workflows.
Physical-bottle foundation b7fba749 passed disposable SQL and generated-artifact
checks; API/auth checks and application integration remain incomplete. 0153 was
not applied to the active local database. 0154 runtime SQL remains unexecuted.
The outgoing 44-commit range passed a redacted Gitleaks scan before transfer.

## Open Questions

The MacBook needs GitHub repository access, dependencies and an isolated local
Supabase setup before runtime testing. Provider-backed features need separately
provisioned credentials. Toast access and JEV runtime integration remain gates.
Raw controller evidence and QA worktrees are backed up only on the mini; request
a separately reviewed transfer if needed. Do not upload database dumps or raw
archives to GitHub.

## Next Action

On the MacBook, read this handoff and AGENTS.md, verify the checked-out branch,
then prepare an isolated local test setup from the local-stack runbook. Report
setup blockers before running tests. Do not resume suspended C13 database work.

For the active mini goal, finish database and remaining-screen cost protection before claiming
team safety, then prove find/open/pour and receive/count/reconcile in the browser.
The latest isolated schema restore passed after exact source-derived owner-role setup,
but whole owner/ACL comparison found two missing GraphQL schema permission sets.
That run stopped before applying 0153/0154. The first reviewed finite repair stopped
at a process-identity assertion before mutation. A separately reviewed correction
passed that check, then stopped because transaction command tags accompanied its
two expected admission rows. Neither run changed the database. Fresh read-only
settlement confirmed the donor and isolated target unchanged. The next preparation
audits output parsing throughout the helper before any further reviewed invocation.
Do not run another blind restore or change the retained active database.

On the mini, the guarded development wrapper responds with `--webpack` after the
default bundler entered a memory/restart loop. The synthetic local login and mobile
cellar content loaded, but browser screenshots timed out and a native capture was
blank. This is not a visual-QA pass or a completed service demo.

## Suggested Skills

Use goal and fable-mode only when the owner resumes implementation; use the
database, security and TypeScript reviewers before promoting unfinished work.
