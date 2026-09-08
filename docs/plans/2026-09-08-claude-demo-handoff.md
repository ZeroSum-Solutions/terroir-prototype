# Handoff: Terroir prototype demo continuation
status: in-progress
date: 2026-09-08
branch: prototype/workbench
last-runtime-commit: 9c10b5b2c50d5fa64439033e89be70e8cf218318

## Active Task

Continue the existing Terroir prototype, improve the mobile restaurant experience and prepare a verified demo that Rohan can open on his own device. This handoff does not start another implementation session or authorize deployment by itself.

## Goal

Deliver a coherent visual direction and dependable new-user journey: sign-in and restaurant setup; CSV/Excel import with preview, correction and explicit apply; invoice intake; storage placement; wine search/details/images; lists; floor pouring and availability; open-bottle reconciliation; Insights. Verify the actual hosted link and Rohan's access before calling the demo ready. Distinguish implemented, locally tested, deployed and externally blocked work.

## Decisions

- Work only in `/Users/zero/projects/terroir-prototype`, branch `prototype/workbench`, origin `git@github.com:ZeroSum-Solutions/terroir-prototype.git`. `/Users/zero/projects/terroir-rebuild` is the separate expanded build. Do not touch it or the old `/Users/zero/projects/terroir` checkout.
- Devin explicitly dislikes the current visual design and authorized changing it. The old Nocturne look and color prohibitions in DESIGN.md are superseded by that instruction. Preserve functional, tenant, auth and data safeguards. Update DESIGN.md and token validation coherently once a direction is selected; do not bypass checks.
- No new visual direction has been selected. The latest three concepts are in `docs/plans/2026-09-08-demo-design-options/index.html`: A Cellar Index (blue, graphic inventory rows), B Wine Atelier (photographic catalogue), C Service Desk (task-first home). A is the previous assistant's recommendation, not owner approval. Use Refero MCP and the included reference-locks.md. Do not redo research unless refinement requires it. Generated bottles are fictional and must never enter the inventory database.
- Rohan needs a link on his own device. The earlier user said the demo was tomorrow; that statement is now date-sensitive. Confirm the actual deadline only if it changes prioritization. Do not assume this Mac or a localhost URL is sufficient.
- Use existing behaviors for the near-term demo. Full sealed-bottle stocktake by bin, offline writes, POS integration, transfers and supplier ordering are not delivered. Existing reconciliation adjusts open-bottle volume; stock-adjustment events alone do not apply a physical inventory count.
- User has a Grok subscription; that is not proof of xAI API entitlement. Follow current provider/billing rules. Prior goal received an explicit exception to an unavailable Grok advisory audit and completed its review scope. Do not resurrect its stale reviewer requirement or treat that old goal completion as hosted readiness. If invoking /goal again, use a current measurable spec with the design override captured.
- Do not merge main, deploy, send invitations or change hosted data merely because this handoff exists. Do all reviewable preparation first, check the session's release authorization, and obtain any still-required concrete owner decision. Merging main deploys both Railway environments; they share a hosted database. No automatic migration rollout.

## Safety and local execution

Read repository AGENTS.md before changes. `.env.local` contains production credentials: never source it for tests or use bare `pnpm dev`. Start through `scripts/local/dev-local.sh` with local bypass identity `owner+local@terroir.test`. The guarded stack used Supabase `http://127.0.0.1:57321` and app `http://127.0.0.1:3000`; verify current process ownership before reuse. Node24 is available at `/Users/zero/.nvm/versions/node/v24.18.0/bin`.

The existing helper `/Users/zero/Documents/Codex/2026-09-07/hey-i-would-just-like-to/work/restaurant-mobile/run-local-check.py` runs commands from the prototype with guarded local keys in child process memory. It obtains local credentials from Supabase status and does not print them. Inspect before reuse. Do not weaken target guards, reset fixtures or reseed populated tenants. Use `PLAYWRIGHT_BASE_URL` only for a known guarded running server; zero retries and `FAIL_ON_SKIPPED_TESTS=1` for critical selected journeys.

## Files

Paths below are relative to `/Users/zero/projects/terroir-prototype` unless absolute.

- `src/app/(app)/get-started/page.tsx`: new role-aware setup/service guide.
- `src/app/(app)/restaurant-name-form.tsx`, `onboarding-modal.tsx`, `layout.tsx`: retryable owner restaurant naming, owner-only blank-name modal.
- `src/app/(app)/import/import-header.tsx`, `upload-step.tsx`: import stages and file-format guidance; importer logic remains intact.
- `src/app/(app)/cellar/reconcile-list.tsx`, `reconcile-modal.tsx`, `reconcile-navigation-guard.tsx`: save feedback, busy lock, retained failed-save edits, app-link/discard and unload warnings.
- `src/app/(app)/cellar/reconcile-navigation-guard.test.tsx`, `reconcile-modal.mobile.test.tsx`: navigation/modal regressions.
- `src/app/(app)/fab.tsx`, `cellar/cellar-shell.tsx`, `search/search-palette.tsx`: mobile action overlap and input-size fixes.
- `e2e/pour-flow.test.ts`: uses canonical cellar wine name for searching; guest list display name can differ legitimately.
- `README.md#Restaurant workflow`: current capabilities and limitations.
- `docs/plans/2026-09-08-restaurant-mobile-journey.md`: scoped implementation criteria and partial reconciliation result.
- `docs/plans/2026-09-08-prototype-rohan-demo-goal.md`: prior approved review spec; design-preservation instruction is superseded, review completion is not release completion.
- `docs/plans/2026-09-08-demo-design-options/`: three generated concept boards, comparison page and reference decisions, now committed with this handoff.

## Evidence

As of this handoff, GitHub's required `Typecheck / Lint / Test / Schema` check is `SUCCESS` for runtime commit `9c10b5b2c50d5fa64439033e89be70e8cf218318`. `Railway preview /api/health` is `SKIPPED`, not deployment proof. PR225 remains OPEN and DRAFT: https://github.com/ZeroSum-Solutions/terroir-prototype/pull/225 . Recheck CI for any later commit.

Local proof root: `/Users/zero/Documents/Codex/2026-09-07/hey-i-would-just-like-to/work/restaurant-mobile/`.

- `unit-complete.log`: `Test Files 443 passed (443)`; `Tests 3996 passed (3996)`, zero skips, before final modal-unload regression.
- `guard-final.log`: final guard/modal tests, 2 files / 5 tests passed.
- `journeys.log`: CSV preview/confirm/apply/verify/revert and five queue journeys passed. Initial pour attempt failed; `pour-final.log` is the corrected passing pour/reconcile result. Seven selected E2E tests passed across these runs, not full coverage.
- `xlsx-preview.txt`: real two-sheet Excel conversion and preview, one valid row from first worksheet, zero errors; not confirmed/applied.
- `gates-final.log`: type, design, file-size, control-row, API/product/feature-ledger, downs and manifest checks passed. Its lint failure was subsequently repaired; `lint-complete.log` is final lint exit 0 with seven pre-existing warnings. VWP command passes with pending evaluations, not executed eval proof.
- `review.md`: independent criteria 1/2/4 PASS; criterion 3 FAIL solely for browser SPA history losing unsaved counts.
- `security-review.json`, `security-validation.log`: formal six-surface review PASS, exact base 0efb5c27 to 9c10b5b2 gitleaks clean and report validator exit 0.
- `.tmp/restaurant-mobile/docs-final.json` in repository: README documentation verifier passed before commit; ledger is local scratch and must be refreshed if rerun after changed manifest.

User-facing report and 320/390px screenshots: `/Users/zero/Documents/Codex/2026-09-07/hey-i-would-just-like-to/outputs/restaurant-mobile-journey/restaurant-mobile-review.md`. Fraction controls measured at least 47.59 x 44px; inputs 17px; no horizontal overflow on checked routes. Browser emulation is not real iPhone/Android camera/keyboard proof.

Earlier review artifacts: `/Users/zero/Documents/Codex/2026-09-07/hey-i-would-just-like-to/outputs/prototype-goal-review/` contains `report.md`, `flow-audit.md`, `recognition-diagnosis.md`, `completion-gate.txt`, `independent-review.md`. These describe the earlier build, not new-diff validation. Earlier92-test browser rehearsal had 2 explicit skips and mocked recognition.

## Open Questions

- DEFECT: Browser SPA Back/Forward can bypass the reconciliation discard prompt and lose edits. App-owned links/modal dismissal are guarded; reload warning restored; no persisted drafts. Fix safely and test back/forward, failed saves, duplicate saves, tenant isolation if drafts are stored, and interrupted sessions. Do not use a brittle history trap that breaks navigation.
- QUESTION: Which design concept should become the build target? Ask once while fixing independent defects. Do not treat the prior recommendation as an accepted choice.
- BLOCKER TO HOSTED DEMO, not local work: release and Rohan's authenticated access are unverified. Previously observed hosted URL `https://terroir-web-production.up.railway.app` ran older abdc661; recheck live health and exact SHA. No invite sent; use authorized invitation flow only when recipient and permission are clear.
- BLOCKER TO REAL SCANNING: one prior real bottle-recognition request returned HTTP 502. `recognition-diagnosis.md` found the configured model in the provider catalog at that time; exact upstream cause remained unknown. Do not assert billing is proven as the cause. Mocked scan tests do not clear this. Capture sanitized upstream status and run an authorized real scan before claiming readiness; never log headers, credentials or sensitive request bodies.
- PHOTOS PARTIAL: previous reviewed coverage 414 of 797 wine names, 696 variant rows previewed locally; hosted photo attachment not done. Refresh counts if needed. Exact-vintage/format uncertain images must remain labeled reference/representative and carry provenance.
- SECURITY FOLLOW-UP: earlier report records an OpenRouter credential exposed in a child task log; rotation was not verified. Inspect status through ZS Vault credential workflow without printing any value. Do not copy old logs containing secrets or silently assume rotation occurred.

## Next Action

Verify the prototype checkout and reproduce the browser Back/Forward unsaved-count loss, then fix it while obtaining the user's choice among the three committed design concepts.

## Suggested Skills

Use compact-prep for this handoff; refero-design plus Refero MCP for design; design-contract when implementing the selected direction; systematic debugging and focused regressions for defects; independent verifier/security review where relevant; conventional-commits. Use the current goal skill only for a newly scoped approved /goal. No new goal is started by this handoff.

## Completion and release checklist

1. Lock the chosen design direction and implement it across the actual mobile setup/import/cellar/detail/reconciliation screens; preserve readable long names, accessible controls, keyboard and error states. Update the canonical design contract and run its checks.
2. Fix unsaved-count history loss and any demonstrated demo-blocking defects. Retain user work on failure and make success explicit.
3. Rehearse new-user sign-in/setup, CSV and XLSX, storage placement, search/photo/detail, wine lists, floor pouring/availability, reconciliation and Insights. Record pass/fail/not-tested per flow; report skipped and mocked checks separately.
4. Run relevant repository gates, independent review and final-SHA CI. Keep changes in prototype branch; do not confuse clean Git or green CI with demo readiness.
5. Prepare the concrete release diff and remaining access/provider decisions. Once authorized, verify deployment SUCCESS and hosted health at the exact release SHA, then Rohan's real-device login/link and real provider flows. Never label localhost or an old hosted deployment as the new build.
6. Return a working demo link, concise rehearsal script, exact commit/deployment identifiers, verification evidence and any remaining limitations. If external blockers remain, report them explicitly with the next owner action.
