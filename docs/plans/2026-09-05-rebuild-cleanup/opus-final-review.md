# Final review — Terroir cleanup

## Verdict: **PASS**. No blocking cleanup regressions.

The surviving diff matches the approved manifest exactly, my one pre-review hold was discharged with the right kind of evidence, and the disclosed scope additions are safe. Five minor findings below; none block, none require rework of the diff.

## What I reconciled independently

- **Manifest ↔ diff, exact.** 33 pure-deletion doc entries + 7 pure-deletion source entries = 40. The diff's 58 changed files = 40 deletions + 18 modifications, with zero added files — internally consistent with the `+57 / −8744` line counts.
- **Byte arithmetic.** Manifest source bytes (49+48+345+5,790+20,930+3,351+4,525 = 35,038) + doc-audit 379,879 = **414,917**, exactly `verification.json:deleted_bytes`. Not a rounded or restated figure.
- **My hold cleared correctly.** `security-review.json` was blocked on a *glob* consumer, not a text reference — the resolution answers that on its own terms (`run-vwp-evals.mjs:9` reads a named YAML; the `:235` recursion walks `TEST_ROOTS src/e2e` by test-filename pattern, not `docs/`), plus `findings=[]`. Correct evidence for the actual question.
- **My rejected cascade was right to reject.** `requireSupabasePublicConfig` retains live callers (`server.ts:4,16`, public list/print pages). The helper stayed. Good — I flagged a risk, not a required deletion.
- **Reference repairs are complete.** Every deleted path I can trace now has an `abdc661` / `ZeroSum-Solutions` link or a protected historical exemption: design predecessors (`DESIGN.md`, `docs/design/README.md`, refactor plan), scaffold snapshot (`docs/_archive/README.md`, refactor plan), UX cluster (both `_archive/README.md`s, `docs/evals/README.md`), `client.ts` (refactor §0.6), `scan-detail-view.tsx` (component comment, e2e message, both ratchets). Remaining hits are `claude-progress.txt:601,1336` — correctly left untouched as protected machine-read history.
- **Ratchets tightened only.** `scan-detail-view.tsx` pruned from both. All other deltas are reductions or stale-entry removals (`enrich-claude.ts` was already gone via `edb2ad20`; `config/page.tsx` fell below 400). Removing a below-threshold entry makes the gate *stricter*, not weaker.
- **The five binding edits are the five surplus lint warnings.** 7 pre-existing warnings → 2 remaining hook warnings reconciles exactly. `use-section-reorder.test.tsx` is the only one touching a hook: `const [, setErrorToast]` preserves the `useState` call and its position — no hook-order risk. The e2e change alters an assertion *message*, not the condition, selectors, or navigation.

## New findings (minor, non-blocking)

1. **`docs/_archive/README.md` now misleads about one retained file.** The new lede — "The generated snapshots below were removed from the checkout" — sits above a table that still lists `2026-08-21-camera-first-personal-cellar-inventory.md` as a plain filename; that file was **not** removed. `docs/plans/_archive/README.md` solved this correctly ("Plain filenames below remain in this directory"). Apply the same clause.
2. **`docs/plans/2026-08-29-modular-architecture-refactor.md` §0.6 still reads as pending work.** The row "Delete [former browser factory] … (zero importers, verified)" is now done. The added header note covers it, so this is presentation only — mark the row DONE with the commit.
3. **`docs/CONVENTIONS.md:~42` now carries a stale figure.** It states the arbitrary-size baseline is "~1,248 that may only shrink." Summing the regenerated deltas puts it roughly 126 lower (~1,122). The same commit edited that file and regenerated that baseline, so the drift is in-scope.
4. **The RT-05 `RECORD_LIMIT` is only partly discharged.** `verification.json:not_performed` records live-DB suites generally, but nothing in the committed evidence states the specific point. State it plainly and accurately: `predict.test.ts` exercised only the dead client predictor and never `record_pour`, so **no RPC coverage was lost** — but the repo also has no unit-level enumeration of the cascade transitions, and SQL/E2E validation of `record_pour` remains outstanding. Recording it that way avoids both an overclaim and an implied loss.
5. **Evidence-scope gap (read this as a limit on my PASS, not a defect).** The reviewed diff contains **zero added files**, yet `README.md` in that same diff links to `docs/REBUILD.md`, and `docs/plans/2026-09-05-rebuild-cleanup/{README,dependency-map,outcome-areas.csv,verification.json,removal-manifest.json,model-review.md}` are cited throughout. Those files land outside the diff I was shown. Either the link is dangling at this commit or the summary is partial. I reviewed their pasted contents; I cannot confirm their committed state or that nothing else landed with them. Confirm before merge.

## Inherited, not caused here

`scripts/polish-demo-tenant-hosted.ts` (broken import predates via `edb2ad20`/#216) — retaining it on HOLD rather than deleting unverified repair functions is the right call, and the runbook/release citations at `:39`/`:302` justify it. Two hook-dependency warnings, the TER_CF 23-weak/15-unimplemented and VWP 89-pending conformance debt, and the 14-day NO-GO are all pre-existing product state.

## Dependency map vs. architecture

Checked, and it does not overclaim. Every current-state assertion matches `docs/ARCHITECTURE.md` and source: sessions aggregate rather than replace batches (`session-service.ts`); `record_pour` and `reconcile_open_bottles_batch` are distinct; the accept/undo queue is explicitly *not* one transaction — matching ARCHITECTURE.md's own standing warning. `ARCHITECTURE.md` correctly went unedited: removing the barrels and browser factory invalidates none of its boundary statements. The map labels itself proposal-only twice (`dependency-map.md` opening; "This diagram does not authorize database changes"), `outcome-areas.csv` carries all 68 IDs once and defers status to `scope.csv`, and `REBUILD.md` explicitly disclaims approval, scope selection, and deadline start. **I read the map as navigation, not approval.**

## Limits

I did not run anything; this rests on the pasted diff, manifest, and receipts. Browser E2E, live-DB behavior, and production readiness are unverified and correctly not claimed. This is a cleanup-safety PASS for local merge only — not a release, deploy, or rebuild approval.