# Runtime post-removal review

**No new runtime findings in the reviewed cleanup diff.** Baseline: `9acee206aa124148c21cb0faab047e78cb64732e`, branch `chore/rebuild-cleanup`. The actual diff removes the seven audited source/test files and 33 documents. Its digest and check details are in `runtime-post-review.json`.

A fresh import-resolution scan covered 1,133 remaining tracked JS/TS files. No import targets any deleted file, and no new orphan dependency appeared. The remaining zero-import exceptions are the framework-invoked `src/proxy.ts` and retained Anthropic mock documentation. `requireSupabasePublicConfig` still serves server auth and public menu/print pages; preserve it.

The only retained production component edit, `scan-inventory-list.tsx:14`, changes comments; its parsed AST is identical after removing comments. `e2e/mobile-wine-detail.test.ts:773,788` changes explanatory prose and an assertion failure message. Its condition, selectors, routes, navigation and follow-on wine assertions remain unchanged. No auth/session implementation, API route, worker, migration, generated database type, package manifest or lockfile changes were found.

Both ratchets independently contain **zero new or increased budgets**. Additional reductions reflect existing source shrinkage, not weakened gates. Historical references remaining outside the new planning evidence are protected `claude-progress.txt:601,1336` and a pinned historical GitHub link in the previous refactor plan. `git diff --check` passes.

**Separate pre-existing readiness issue:** `scripts/polish-demo-tenant-hosted.ts:40` imports the missing enrichment module removed by `edb2ad20` (#216). The broken import is already in the baseline; cleanup did not create it. The script cannot run as written. Whole-file retirement is **not yet verified**: it also repairs corpus links, colours, sections and stuck scans (`:119-196`), and the investor-demo runbook (`:39`) and release record (`:302`) cite its completed production repair. Do not execute it or restore retired inference automatically. Explicitly retire this completed repair with preserved history, or separately repair its supported operations.

**Follow-up: all five unused-binding edits now pass review.** The imagery audit loses only an unused locator object; scroll, click, waits and audit actions stay unchanged. The unused React import, uncalled note-selector helper and unused fixture literal have no invoked work to preserve. `SameDropHarness` still calls the same `useState` in the same position and passes its setter to the reorder hook; only the unused tuple value is omitted. AST comparison confirms assertion, hook and `act` calls are unchanged across all five files. No new findings.

Hosted-polish remains **HOLD**, with no expanded investigation or edits. Root owns ongoing tests and gates; no suites were rerun here, and this review does not assert CI/production readiness.
