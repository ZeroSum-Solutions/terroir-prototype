# Focused test selections, source evidence

Historical proposal extracted from read-only CI evidence; use governing05-ci-tests.md and scope decisions for execution. No test commands ran in planning.


These are pre-integration selections, **additional to the unchanged full required gate**, not a proposed paths filter on the required workflow. Commands assume pinned dependencies and an identity-checked disposable local DB when live suites are involved.

| Changed paths | Focused command / browser coverage |
|---|---|
| `src/domains/cellar`, `pours`, `src/lib/reconcile-ledger` | `pnpm exec vitest run src/domains/cellar src/domains/pours src/lib/reconcile-ledger`; pour-flow, cellar-health, reconcile-queue E2E; retain scoped coverage thresholds |
| `src/domains/identity`, `import` | `pnpm exec vitest run src/domains/identity src/domains/import`; live tenant/merge/chunk/idempotency suites; import-journey and lineage E2E |
| Auth/session/roles, tenant route handlers | `pnpm exec vitest run src/lib/api src/lib/auth src/lib/supabase src/test/contracts/auth-flow-safety.test.ts`; critical invite/login, team-mobile, lists-insights-role; new group/business/venue permission cases required |
| `src/domains/scanning`, `src/lib/scanner`, `jobs` | `pnpm exec vitest run src/domains/scanning src/lib/scanner src/lib/jobs`; critical scan→commit, scan-intake-mobile, bottle-scan-trust |
| Wine knowledge/notes | `pnpm exec vitest run src/lib/wine-intelligence src/domains/notes`; global-search and wine-detail E2E. Existing global search does not prove new signed-out publication/privacy contracts |
| Wine lists/PDF/pricing | `pnpm exec vitest run src/domains/wine-lists src/lib/wine-list src/lib/pricing`; wine-list-add-wine, mobile-list-editor, branded-menus, pricing-recommendations |
| CSS/components/layout | Relevant component tests; `pnpm check:design`, `check:file-size`, `check:control-rows`; corresponding mobile tests plus one-row-rule; no ratchet relaxation |
| Migrations/generated DB types | snapshot/type/down/manifest checks; `pnpm test:contracts`; affected real-DB containment/identity/import suites; fresh full migration replay in disposable CI |
| Workflow/Playwright/guards | `pnpm exec vitest run src/test/contracts/playwright-safety.test.ts src/test/contracts/live-db-target.test.ts`; workflow lifecycle validation and guard shell tests; preserve missing-DB failure and zero-retry semantics |

Toast, transfers and multi-business permissions need new acceptance cases traced to approved requirements; today's green suite cannot prove unimplemented contracts.

