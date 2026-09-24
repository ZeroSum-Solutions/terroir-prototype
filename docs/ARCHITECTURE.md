# Terroir Architecture

Terroir stays a modular monolith. Route handlers should own HTTP lifecycle only:
auth, request parsing, validation, and response mapping. Domain modules own
business workflows. Adapter modules own external/provider mechanics.

## Current Boundaries

- `src/domains/scanning`: invoice OCR/LLM extraction orchestration.
- `src/domains/wine-lists`: wine-list PDF generation workflow.
- `src/domains/pours`: bottle-open, pour, spill, close, discard, and Undo
  orchestration around `execute_inventory_command` and `undo_last_pour`.
- `src/domains/cellar`: reconcile transaction orchestration around
  `reconcile_open_bottles_batch`.
- `src/domains/integrations/pos/toast`: internal, pure Toast observation
  normalization, strict manual/operator snapshot guards, and versioned canonical
  framing/digests for domains `0x01`, `0x02`, and `0x03`, backed by checked literal vectors.
  It has no persistence, API, provider, or live-runtime wiring. See the
  [Toast integration contract](plans/2026-09-23-terroir-toast-integration-contract.md)
  for the approved vendor and activation plan.
- `src/adapters/ocr`: Azure Document Intelligence boundary.
- `src/adapters/llm`: Anthropic invoice extraction boundary.
- `src/adapters/pdf`: Puppeteer HTML-to-PDF boundary.
- `src/lib/supabase`: Supabase runtime configuration and client creation.
- `src/lib/api/shadow-site-access.ts`: server-private C04 workspace/site access
  observation. It validates exact legacy-role capability sets behind one 750 ms
  total deadline; it is not a client contract or authorization authority.
- `src/lib/bins`, `src/lib/cellar-facets`, and `src/lib/cellar-health`:
  physical placement, URL-backed cellar views, and health classification.
- `src/lib/reconcile-queue` and `src/lib/reconcile-ledger`: derived issue
  ranking plus reversible accept and undo workflows.
- `src/lib/partial-bottles` and `src/lib/member-analytics`: close-out yield
  calculations and member-attributed operational metrics.
- `src/lib/pricing-recommendations`: pricing classification, timing, and
  materialized recompute workflow.
- `src/lib/branding`: logo palette extraction, theme validation, and shared
  public, print, and PDF theme rendering.
- `scripts/restore-drill.mjs`: encrypted-backup data-restore rehearsal;
  `scripts/backup/restore-isolation.mjs` owns scratch container isolation and
  `scripts/backup/collect-database-evidence.mjs` collects comparison evidence.
  The backup transport retains its service-file and exported-snapshot path;
  the restore transport uses the isolated container directly. See
  [the restore guide](RESTORE-DRILL.md) for coverage and limitations.

Provider boundaries have two branding exceptions. Menu-theme proposals in
`src/lib/branding/menu-design.ts` call the shared Anthropic client directly.
Non-PNG palette extraction in `src/lib/branding/palette.ts` launches Puppeteer
directly. Wine-list PDF generation still reaches Puppeteer through
`src/adapters/pdf`.

## Shadow access observation

- After legacy membership selects the active restaurant,
  `src/lib/api/resolve-active-membership.ts` calls
  `shadow_effective_site_access` once through the same authenticated Supabase
  client. Resolved, denied, malformed, provider-error, and timed-out observations
  preserve the legacy restaurant, role, HTTP outcome, and RLS behavior. The
  normalized observation stays inside the server auth helpers; it is not included
  in route payloads, logs, telemetry, rendered markup, or client provider props.
  Legacy membership remains authoritative until a separately reviewed cutover.
- The observer can add at most 750 ms to each membership resolution. Existing auth
  and legacy membership-query latency is outside that budget. Repeated API or
  helper resolutions can each pay the observer budget. React's request-scoped
  `getAuthContext` cache deduplicates only within one server render tree; it does
  not deduplicate separate route or helper calls.

## Database Contracts

- The legacy end-of-shift `POST /api/reconcile` path calls
  `reconcile_open_bottles_batch` through `src/domains/cellar/reconcile-service.ts`;
  that batch is one database transaction.
- The newer reconciliation queue does not use that RPC. Accept and undo in
  `src/lib/reconcile-ledger/index.ts` issue ordered table reads, subject updates,
  and ledger inserts through the authenticated Supabase client, with explicit
  compensation on partial failure. Do not describe that workflow as one
  database transaction.
- Public wine-list reads stay explicitly protected by RLS policies and contract
  tests.
- First-party open, pour, spill, and measured-close routes send a caller-generated UUID
  to `execute_inventory_command`; quantity-bearing fields use integer milliliters. The RPC applies
  the physical effects and durable receipt atomically, returns the stored outcome for
  an exact replay without applying stock twice, and rechecks current membership before
  replay. Close commands bind to both the reusable `open_bottles` row ID and its
  `opened_at` lifecycle timestamp.
- `execute_inventory_command` and the C02 Undo path serialize on the wine row with
  `FOR NO KEY UPDATE` before locking the reusable bottle slot. That lock still excludes
  another C02 writer, but permits the wine foreign key's `FOR KEY SHARE` after a
  retained legacy RPC has locked the slot first. This avoids the mixed-version
  expand-contract deadlock without weakening per-wine command serialization.
- Deprecated `POST /api/open-bottles/[id]/close` has a strict current contract: a UUID
  `Idempotency-Key` header and JSON `expected_opened_at` with an offset are required.
  It invokes the internal `discard` command, which derives and spills the locked
  lifecycle's full remainder, closes it without opening a replacement, and creates no
  `bottle_closeouts` row. This is not an external backward-compatibility guarantee;
  callers of the deprecated endpoint must send the current header and body.
- `POST /api/pour/undo` still uses `undo_last_pour`. When a command crossed multiple
  physical lifecycles or a replacement lifecycle has opened, the RPC refuses the
  unsafe partial reversal and the route returns `409 undo_not_reversible`.
- `record_pour` and `close_open_bottle` remain during expand-contract deployment, but
  migrated first-party inventory routes no longer call them. Authenticated direct
  `bottle_closeouts` insertion also remains a receipt-bypass until the separately
  reviewed contraction removes the legacy grants and policy.
- Reconciliation batches persist ordered before-and-after state so undo restores
  actions in reverse application order.
- First-class bins, cellar-health rows, reconciliation history, bottle
  close-outs, stock adjustments, brand kits, and pricing recommendations are
  restaurant-scoped and protected by RLS. Ordinary authenticated app clients
  cannot update or delete stock adjustments, bottle close-outs, or reconcile
  actions. Those records are not globally immutable: parent deletes can cascade,
  and service-role or database-owner access can bypass ordinary client grants.
- Current application code writes `public.background_jobs` only during
  cellar-health and pricing-recommendation recomputes. The schema reserves
  `invoice_ocr`, `wine_enrichment`, and `wine_list_pdf` job types, but this branch
  has no producer/consumer path using those types.

## Remaining Handoffs

- Restore a green exact-SHA smoke result on the protected staging tip and land
  the reviewed promotion workflow on `main` before treating staging as a hard
  promotion gate.
- Implement and verify producers and consumers before describing OCR,
  enrichment, or PDF as background-job workflows. The reserved enum values do
  not prove runtime execution.
- Finish extracting `auth`, remaining `cellar`, `insights`, and `storage`
  workflow code as those routes are touched.
