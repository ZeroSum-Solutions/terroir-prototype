# Rebuild cleanup results

September 5, 2026. Verified repository cleanup on `chore/rebuild-cleanup`, based on production-source commit `abdc661abde43b0ac70a81f740b61d21da7e414b`. The prior 176-file planning package was preserved unchanged in commit `9acee206aa124148c21cb0faab047e78cb64732e` before removal began. Cleanup completion is local; no merge or deployment is included.

## Removed and preserved

- Removed **40 tracked files / 414,917 bytes**: 33 obsolete documents and seven unused source/test files. The [manifest](removal-manifest.json) records every path, original hash, reason and recovery commit.
- Removed five additional unused bindings without changing actions, hooks or assertions. Repaired history/index links and two stale source/test descriptions.
- Removed **13,253,543,874 bytes (13.25 GB decimal)** of inactive generated Next.js caches and incremental TypeScript state. These are regenerable; bytes removed are logical file sizes, not a claim about APFS physical allocation. The isolated build snapshot was discarded after verification.
- Retained all 44 package dependencies: each has a consumer. Preserved 176 current planning/research files and 440 protected API/schema/configuration files byte-for-byte. Retained migrations/downs, machine-read specifications, licensed-data provenance, still-cited research, screenshots and active operational runbooks.
- Regenerated existing file-size and typography ratchets with their standard tools. All changes tighten existing ceilings; the refresh also captures reductions already present before this cleanup.

This was an inventory of the project and its local artifacts, not a deletion of every older file. Retained evidence has current references, future rebuild use or unresolved ownership. No database, cloud resource, credential file, other worktree or live workflow was removed. Research sources for the new architecture and wine comparisons remain part of the active plan.

## Verification and model review

Gemini **3.8 Flash High** supplied the first structural pass. Independent source and document reviews checked consumers and recovery. **Opus 5** reviewed the exact proposed removals before execution; its one conditional hold on an old security report was cleared by proving that it contains no findings and has no machine consumers. The final review record is in [model-review.md](model-review.md).

We rejected Flash's claim that import sessions supersede batch services: sessions still aggregate and call those batches. We also rejected age alone as a reason to remove audit screenshots, licensing evidence or active dependencies.

The full Vitest run passed **418 files / 3,833 tests**, with **18 files / 122 tests explicitly skipped** for missing live database configuration. Focused tests passed after the five binding edits. TypeScript, lint (zero errors, two remaining pre-existing hook warnings), design, file-size, control-row, API/feature/product-contract, migration-pair and migration-manifest checks passed. The VWP gate ran its four implemented test files; 89 of its 93 entries remain pending, so the gate does not establish feature completeness.

A normal `pnpm build` using Next.js Turbopack passed in an isolated copy of the current tracked source with synthetic loopback configuration. Production environment files and provider credentials were excluded. Its dependency manifest, workspace settings and lockfile match the repository. Browser E2E, live-database behavior, production smoke and deployment were not verified by this cleanup. The deleted `predict.test.ts` covered only the unused client predictor and never exercised `record_pour`; its removal loses no RPC tests. Live SQL cascade behavior was not verified by this run. See [verification.json](verification.json) for exact commands and limits.

## Retained issues

`scripts/polish-demo-tenant-hosted.ts` has a pre-existing import of removed enrichment code. It also performs corpus linking, cellar-section and stuck-scan repairs and has historical runbook references, so whole-file deletion is not justified. Treat it as unavailable until a separate repair/retirement review; do not execute it against a hosted database. Two existing hook-dependency lint warnings also remain outside unused-code cleanup.

The current implementation's conformance report still has 23 weak and 15 unimplemented outcomes, with none classified as proved. This is inherited product debt, not caused by this cleanup. The reviewed full-release-in-14-days estimate remains NO-GO; its narrower pilot proposal has not been accepted. Neither the deadline nor draft build rules were activated here.

## Recovery and next work

All tracked deletions remain recoverable from `abdc661abde43b0ac70a81f740b61d21da7e414b`. Inspect a removed file with `git show abdc661abde43b0ac70a81f740b61d21da7e414b:path/to/file`. To reintroduce one, copy that specific blob into a reviewed change; there is no need to reset the branch. Generated caches rebuild normally.

Use the [rebuild entry point](../../REBUILD.md) and [dependency map with five next actions](dependency-map.md). The [68-outcome area index](outcome-areas.csv) helps assign work while keeping the original scope matrix authoritative.
