# Current evidence and conflicts

Repository root `/Users/zero/projects/terroir`; remote `git@github.com:ZeroSum-Solutions/terroir.git`; main and remote main `abdc661abde43b0ac70a81f740b61d21da7e414b`. The tree was clean before adding this uncommitted planning directory. Read-only `git status`, `rev-parse`, `ls-remote --heads`, worktree list and GitHub PR queries provide the baseline in `evidence/`. No tests that create fixtures or services ran during discovery.

Other remote heads: `feat/high-leverage-loops-2026-09-04` at `2846f067a4d9dba32121654796ddee72557d75be`; `staging` at `a94b196ad7b5947afec76c6174644cd520bfc932`. These are owned work, not stale-delete candidates. Known detached worktree `/Users/zero/projects/terroir-vw` is at main's SHA. See the harness evidence for all excluded directories and their ownership state. Never work from them for this rebuild.

| Finding | Current evidence | Planning implication |
|---|---|---|
| Flat tenant contract has broad reach | `src/lib/api/auth.ts:15`; 164 non-test files mention restaurant scope; 69 import generated DB types | Freeze one scope/DTO contract before independent work; counts are coupling indicators, not effort estimates |
| Stock has multiple writers | `src/app/api/inventory/save-scan/route.ts:267`; `src/domains/import/batch-service.ts:1615`; `src/domains/pours/pour-service.ts:52` | All activated candidate writers must use the same transaction; block excluded mutation paths |
| Receipt E2E mocks persistence | `e2e/demo-critical-journeys.test.ts:30`; `e2e/bottle-scan-trust.test.ts:179` | Add an actual receipt-to-cellar DB canary before replacing the boundary |
| Required CI already uses Blacksmith | `.github/workflows/ci.yml:65`; 18 successful jobs, median 5m58.5s | No hypothetical speedup from a switch already made |
| Full browser gate not green | [run 33962752544](https://github.com/ZeroSum-Solutions/terroir/actions/runs/33962752544): 66 pass, 27 skip, one 390px insights failure; last30: 12 failures,18 cancellations,zero success | Repair reproducible defect and classify every skip; unchanged skipped tests cannot certify selected scope |
| Local schema artifact is not a current DB query | 44 generated tables;122 migrations through0150;112 paired downs;37 manifest entries | Rehearse applied schema and inspect actual environments before implementation migration |
| Public discovery is new | Existing atlas reads private cellar; catalogue requires membership; search mixes private/reference sources | Public search/map needs separate approved projection, not removing auth from existing routes |
| Toast connector absent in inspected source | Existing `src/app/api/export/toast-csv/route.ts:12` is a CSV export | Real consent, access, durable ingress, mapping and reconciliation remain new work |

## Reference guideline decisions

Source read: `/Users/zero/Desktop/efficient-brownfield-session-guideline.md`. It reports other projects, not measured Terroir results.

| Guideline idea | Terroir evidence / conflict | Decision |
|---|---|---|
| Offload every full-suite run from Macs | Mini16GiB with about3GiB swap; hosted CI already works | Adopt CI-first heavy testing; no compulsory AWS dependency |
| ARM16-vCPU AWS worker, historical costs/timings | Terroir CI uses x64; AWS tools/account unavailable here | Optional smaller x64 parity worker; new quote/benchmark before purchase |
| Multiple heavy lanes and many agents | Shared fixture IDs and one Playwright worker | Two integration PRs maximum; one local heavy lease, preferably zero |
| Four-way sharding | Current global fixtures collide | Defer until isolated runner/DB/actor fixtures and measured canary parity |
| Skip draft checks | Skipped required jobs can appear successful | Keep an always-running, fail-closed required aggregator |
| Merge queue and automatic cleanup | Queue not configured; ownership exists outside main | Protected serialized landing fallback; no automatic deletion or bypass |
| Old model lane examples | Exact Claude Opus5, Gemini3.8Flash and Sol probes succeeded | Use verified requested lanes, no GLM substitution |

## Conflicts remain explicit

1. Repo instructions describe one production/staging DB, but prior live evidence found separate projects and44/18 table drift. This turn verified local code only. Environment truth is unresolved until fresh metadata; neither source silently wins as current runtime evidence.
2. Backup runbook says no drill; `docs/RESTORE-DRILL.md:110` records an older Aug22 PASS. Both are historical; require a fresh same-account/region rehearsal.
3. Generated snapshot is concatenated SQL history (`scripts/build-schema-snapshot.mjs:8`), not normalized final schema. Passing string assertions does not settle RLS or final function behavior.
4. Some documentation says adapters lack tests; three real adapter test files exist. Preserve them and assess coverage, not the stale claim.
5. Existing identity test requires separate tenant variants. Target global identity deliberately supersedes that expectation while preserving private overrides and records.
6. Public menus deliberately fetch bin labels via a privileged helper (`src/app/list/[slug]/page.tsx:36`). Their publication policy needs an explicit decision; general public knowledge must not inherit that helper.

The six summary tables in `evidence/` meet the updated 800-word limit. Longer scratch discovery reports are historical supporting material outside this package, not the governing recommendations. Their older September19/all 35 R assumption and four-bucket cleanup terminology are superseded by this package.


## Classification and access-attempt record

Local generated schema and source were inspected; no live production DB/API connection, secret read, customer-row inspection, dump or asset-content fetch was attempted in this planning pass. Nothing was refused by a tool: the governing no-secret/no-production-copy boundary and absent approved diagnostic destination limited the evidence. The prior live metadata report is explicitly historical.

Provisional schema-based classes: auth users/memberships/invitations identify people and permissions; invoice scans/assets may contain personal/vendor details; inventory costs and supplier terms are confidential business data; private wine notes may be personal; public reference names/ratings/images still have source-rights constraints. No payment-card storage is required by the product scope, but contents were not inspected and absence is not verified. D owns a future in-boundary classification job; owner must authorize scoped credential access and the exact production account/region. It reports column/bucket categories, row/byte counts and restricted-content flags without exporting records. Gate 1 approves conservative retention; actual data movement/admission remains blocked until this classification and Gate 2 evidence pass.
