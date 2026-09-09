# Restaurant mobile journey improvements

Scope: the existing Terroir prototype, requested September 8, 2026. Baseline 0efb5c2 on prototype/workbench. Preserve the separate rebuild and existing data/auth contracts.

## Delivery criteria

1. A reachable restaurant setup guide connects inventory import, invoices, storage placement, team setup, guest lists, service and close-of-shift. Owner can edit restaurant name with retryable errors; staff see appropriate service guidance.
2. Empty Insights and cellar explain CSV/Excel intake. Import distinguishes choosing a file, reviewing rows, and applying inventory; supported and unsupported formats have a clear route. Existing preview, producer acknowledgement and apply safeguards remain intact.
3. Phone reconciliation preserves edits on failed save, prevents editing/dismissal during save, asks before discarding unsaved changes, reports success, and has legible compact quantity controls. Numeric inputs avoid a small keyboard target.
4. Verify changed behavior with regressions, type/lint/design/size gates and 390/320px browser checks. Record independent review and remaining product/hosted limitations.

## Journey and remaining product scope

Account and restaurant -> inventory CSV/XLSX or invoice -> preview and correction -> apply -> bin placement -> team and guest list -> search, pour, availability during service -> open-bottle reconciliation and closeout -> Insights.

Full sealed-bottle stocktake is missing. Existing reconciliation adjusts open-bottle volume; stock-adjustment events do not apply a physical inventory count. A future count workflow needs per-bin sessions, resumable counts, expected-versus-counted review and conflict-safe application. Offline writes, POS integration, receiving-versus-opening-balance modes, transfers and supplier reordering also require separate behavior contracts. Do not describe these as delivered.

## Design decisions

Primary reference: existing DESIGN.md Nocturne. Preserve Source Sans/Serif, claret actions, neutral surfaces, 44px targets and safe-area chrome. No palette or font changes.

| Decision | Evidence | Application |
| --- | --- | --- |
| Ordered optional setup with direct entry points | Refero Airtable flow 1533; owner Insights empty-state audit | Setup guide with useful destinations, no invented completion ticks |
| Distinct quantity and save controls | Refero Shopify mobile inventory screens fd481176-5590-4aa3-ac4b-0f989708c7f9 and bc8810d3-caaa-406e-9498-335eeb3bb9f1 | Compact fractions, explicit save and discard decision |
| Structured rows, readable hierarchy | Refero Mews style fb98cf43-2d7c-4ced-8c47-efbf39e1fe0f and 19-86 style 7a8c99db-5ce7-4fa4-b491-8f1fcac18991 | Borrow hierarchy and ordered dividers only; retain Terroir tokens |
| Import-first entry, invoice alternate | Actual empty Insights and CSV/Excel implementation | No claim that scans are required for metrics |

## Verification

Implemented setup guide, retryable owner naming, import stages and format guidance,
mobile input sizing, reconciliation save feedback and app-owned discard guards.
320px and 390px browser captures show no horizontal overflow; fraction buttons
measure at least 47.59 by 44px and numeric inputs use 17px text.

Local verification: 443 files / 3,996 tests passed without skips before the final
modal-unload regression; the final guard/modal suite passed all five tests.
CSV import/apply/revert, five queue scenarios, and pour/reconcile passed in seven
selected browser tests. This is selected journey coverage, not full E2E coverage.
Type, design, file-size, control-row, API/product/feature-ledger, migration-pair and
manifest gates passed. VWP evaluation command passed with pending evaluations;
that is not proof those evaluations executed.

Criterion 3 remains partial: app-owned close and link controls protect pending
counts, and reload warns, but browser SPA Back/Forward can bypass confirmation.
No persisted drafts or offline recovery are claimed. Independent review records
this limitation rather than an unqualified completion verdict.

No hosted writes, invites, provider calls, migrations or deployment in this pass.
