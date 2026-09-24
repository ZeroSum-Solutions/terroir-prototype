# Handoff: MacBook transfer
status: in-progress
date: 2026-09-24
branch: feat/production-readiness-20260923
last-code-commit: b7fba74973cd0215104313aecbaf162f1b14b974

## Active Task

Transfer saved work through GitHub. The Mac mini goal remains paused. The owner
may start a separate development session on the MacBook; do not restart the mini.

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

## Suggested Skills

Use goal and fable-mode only when the owner resumes implementation; use the
database, security and TypeScript reviewers before promoting unfinished work.
