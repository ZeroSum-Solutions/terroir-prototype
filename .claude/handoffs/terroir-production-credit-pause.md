# Handoff: Terroir production goal credit pause
status: in-progress
date: 2026-09-24
branch: feat/production-readiness-20260923
last-commit: b7fba749 feat: add physical bottle expansion foundation

## Active Task

PAUSED BY OWNER because subscription credits are exhausted. No development,
review/model calls, database mutations or automatic goal continuation until the
owner explicitly resumes. Save/settlement work only has completed this checkpoint.

## Goal

The approved restaurant-first, mobile/team/offline/Toast/AI and collector goal is
incomplete. Only T00/T01 are complete; T02–T14 remain incomplete. Canonical scope:
`docs/plans/2026-09-23-terroir-production-execution.md` and the September20 PRD.
Do not interpret 40 local commits in the prior18hours as completed product workflows.

## Decisions

- Preserve all source, owner planning edits and failed proof. No push, merge,
  deployment, hosted changes, credential rotation, new spending or deletions.
- Do not commit unverified0154 as ready: runtime SQL and generated artifacts remain
  pending. WIP is preserved in place and in the recovery source archives.
- Native goal tools cannot pause. Local state is `paused_by_user`; automatic native
  continuation is not permission to resume. Do not falsely mark complete/blocked.
- The C13 clone-role repair was NOT executed. Its one-shot release is suspended;
  any later execution needs fresh admission and an explicit resumed work window.

## Files

- Goal controller/evidence: `/Users/zero/.claude/goal-state/terroir-production-20260923/`.
- Recovery bundle: `/Users/zero/Inbox/notes/handoffs/2026-09-24-terroir-credit-pause/`.
- C04 pending source: 0154 migration/down/preflight, its fixture directory,
  `src/test/contracts/site-capability-authority.test.ts`, and the0154 manifest row.
- Existing owner WIP: September20 PRD, September23 execution plan, and
  `docs/superpowers/plans/2026-09-03-wine-page.md`. Preserve without reverting.
- Retained QA worktrees are listed in recovery `worktrees.txt`; preserve them.

## Evidence

- C06 foundation commit `b7fba74973cd0215104313aecbaf162f1b14b974` has accepted
  disposable SQL, generated-artifact and security checkpoints. API/auth suite and
  PhaseB/C application work remain undone. Active0153 has not been applied.
- C03 prior browser checkpoint:27pass/0fail/0skip at QAa720890d, not whole offlineB.
- C04 v2 exact20 diff `be398ff8a937d3cad6fd566320f005458729ee2a22177975ee35b389ab67f824`;
  native source report `C04-authority-a-source-independent-db-v2-report.md`
  SHA `d7fdeb15e2eab53143ca7becb756bf66eab66acd25892aa2ed4294eeab0300b0` accepts
  bounded source only. Actual SQL remains unexecuted. Opus session45560 was stopped
  at owner pause: verified PGID41137 terminated, exit143. Any partial output is NOT approval.
- C03 v2 Opus session19282 completed0, REVISE DESIGN. Full review is
  `proof/C03-public-shell-design-v2-opus-review.json`. It flags dropped cases,
  the15-path/file-size conflict, read-only terminology despite local bookkeeping,
  and incomplete fetch-route classification. Native v2 reportb4be6a6a also requires
  full eligibility timing, deterministic unique password fixture and narrow contract
  additions. Draftv3 contains native edits only and is NOT frozen/accepted. Author
  c03_public_shell_map was interrupted; do not assume its awaited Opus merge happened.
- C13 failed prior restore: missing clone roles; active sourceexport9e7c5d46 conserved.
  Root corrected one hash typo in role-bootstrap-v2.sql SHA
  `78585bf8ccd4cd17b16e9730ed24e8b66552db07bb2472abcc06ccda180cc89d`.
  Native closure9bfe69d6 and Opusab7822f0 support the correction. Exact fresh read-only
  admission is in `proof/C13-clone-role-bootstrap-20260924a/`. NO bootstrap call ran.
  Clone currently has29roles/21edges; target source31/23. No restore retry or cleanup.
- Existing ports/containers retained; no owned app server listened on3000 at pause.

## Open Questions

- QUESTION: Owner must explicitly resume when ready; current pause supersedes the
  earlier persistence instruction. Native Goal may need UI Pause/Stop.
- External gates remain Toast access, safe runtime JEV provisioning, actual pilot
  facts/measurements, and production promotion authority. Never fabricate them.

## Next Action

Wait for explicit owner resumption; then verify the saved hashes and current state
before reauthorizing any test or mutation. Do not run the suspended C13 release first.

## Suggested Skills

compact-prep for this handoff; goal and fable-mode only after explicit resumption;
relevant database/security/TypeScript review before later implementation promotion.
