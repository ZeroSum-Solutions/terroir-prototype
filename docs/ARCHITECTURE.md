# Terroir Architecture

Terroir stays a modular monolith. Route handlers should own HTTP lifecycle only:
auth, request parsing, validation, and response mapping. Domain modules own
business workflows. Adapter modules own external/provider mechanics.

## Current Boundaries

- `src/domains/scanning`: invoice OCR/LLM extraction orchestration.
- `src/domains/wine-lists`: wine-list PDF generation workflow.
- `src/domains/pours`: versioned bottle command orchestration. Contract version 1
  uses `execute_inventory_command` and the wine-scoped `undo_last_pour`. Contract
  version 2 routes Open, Pour, close/discard, and receipt-bound Undo through
  `execute_physical_bottle_command` with exact event, bottle, and wine identities.
  Version 2 is not active yet.
- `src/domains/cellar`: versioned reconciliation contracts and orchestration.
  Version 1 still uses the wine-keyed `reconcile_open_bottles_batch`. The
  version 2 application boundary validates and canonicalizes one exact-bottle
  batch before calling `execute_physical_reconciliation_batch`, then rejects any
  result that does not match the requested operation, order, identities, volume,
  and next state version.
- `src/domains/offline`: the versioned private projection contract, IndexedDB
  policy and driver, and deny-only device marker. The marker is not authentication
  or positive offline eligibility.
- The [offline session boundary](../src/app/%28app%29/offline-session-boundary.tsx),
  `src/lib/auth/same-origin-request.ts`, and `src/lib/supabase/proxy.ts` form the
  bounded local sign-out boundary. It unmounts
  private React content before starting sign-out work, applies the strongest
  recognized raw-cookie denial, and keeps provider cleanup bounded. Real-browser
  verification now covers the bounded 17-case
  [session-boundary browser checkpoint](plans/2026-09-23-terroir-offline-operation-contract.md#session-boundary-browser-checkpoint).
  The public offline shell and the rest of the offline workflow remain incomplete.
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
- `src/lib/api/site-capability.ts`: exact-site application authority for
  `cost.read`, `margin.read`, and `pricing.manage`. It fails closed when the RPC is
  missing, denied, malformed, timed out, or unavailable. Migration 0154's source is
  committed, but it is not yet part of the retained local stack.
- `src/lib/bins`, `src/lib/cellar-facets`, and `src/lib/cellar-health`:
  physical placement, URL-backed cellar views, and health classification.
- `src/lib/reconcile-queue` and `src/lib/reconcile-ledger`: derived issue
  ranking plus reversible accept and undo workflows.
- `src/lib/reconcile-draft`: restaurant-and-user-scoped reconciliation drafts.
  Version 2 freezes one operation UUID and canonical payload for unresolved
  exact-bottle batches and verifies the persisted copy before each send.
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
- `scripts/run-live-test-conservation.mjs`: guarded live-test wrapper for the exact
  local project and immutable database container admitted from
  `supabase/config.toml`. Its startup and six-table identity scope are documented in
  the [local-stack runbook](runbooks/local-stack.md#live-test-identity-conservation).

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

- The retained configured local stack is at schema 0152 and physical contract
  version 1. Migration 0154 has passed an isolated V6 apply and settlement rehearsal,
  and its exact 22-path source checkpoint is committed at `29b06e78`. The rehearsal
  is not proof that the retained stack, a hosted database, or all raw cost paths are
  protected. All nine measured raw-cost exposures remain open.
- Migration 0153 defines `physical_bottles`, immutable command receipts,
  `execute_physical_bottle_command`, and the `effective_service_pour_events` view.
  The committed application checkpoint at `44d046d5` implements selected exact-bottle
  Open/Pour surfaces while preserving version 1. The application must not enable
  contract version 2 until closeout, Undo, reconciliation, analytics, provenance, and
  the canonical pre-cutover gates are complete.
- Saved and pushed commit `e9a49e5d` adds exact-row close/discard routes and `/cellar/open`
  integration. Its corrected V2 author and native independent checkpoints pass
  100/100 focused tests, Opus accepted the bounded source, and immutable-range security
  review passed. Runtime proof remains outstanding.
- Saved and pushed commit `9f3a1b25` adds the contract-version-2 Undo application checkpoint.
  A physical pour or discard receipt binds Undo to the original event, exact bottle,
  and wine. The server rejects missing or mismatched physical identities and returns
  a distinct Undo event receipt. Client retries retain the same operation UUID and
  immutable payload after an uncertain result. Mistaken-discard correction requires
  affirmative confirmation that the same bottle remains present; while that correction
  is pending or unresolved, the competing discard-confirmation and review exits stay
  disabled. Native and bounded source review accepted the frozen source with 190/190
  focused tests. Its exact `1c37b7ab..9f3a1b25` range passed the immutable security
  certificate across 20 changed paths and 22 reviewed blobs. No SQL or browser result
  is claimed.
- The drawer keeps unresolved Open, Pour, and Undo retries reachable even when
  refreshed bottle data cannot support a fresh action. In that state it hides fresh
  commands and the custom-pour picker, while retry keeps the original operation
  identity and payload. Checkpoint `6163388a` passed 32 focused independent tests;
  this is component proof, not browser or server-replay proof.
- The effective-reader checkpoint redirects five application readers to
  `effective_service_pour_events`, which excludes version 2 reversals and reversed
  originals while retaining legacy history. Migration 0155 grants only non-grantable
  `SELECT` to `service_role`; it does not expand authenticated access. Forward and
  down migrations require a caller-owned transaction and reject unexpected ACLs
  before mutation. Native and Opus review accepted the bounded V4 source. The
  independent V4.1 matrix passed on the isolated retained-C database: 16 rollback-only
  ACL cases, unwrapped-call refusals, fault rollback, up/down/reapply, effective-reader
  semantics and conservation of all six non-target databases. That target now holds
  0155; the normal retained stack and separate browser stack do not. This is bounded
  database proof, not a browser, Phase B, cost-secrecy or production completion claim.

- Yield reporting prefers each closeout's captured bottle capacity. Only a legacy
  contract-1 closeout without that value falls back to catalogue size; a physical
  closeout without captured capacity fails instead of publishing a fabricated yield.
  The reader retains its restaurant/date filters and selects no bottle cost or
  opener fields. This application change does not prove the live relational query.
- In contract 2, legacy Open/Pour/Close/Discard request shapes reach the completed-v1
  replay boundary. A successful replay must match the operation, command, tenant and
  historical wine or bottle/lifecycle identity. Contract 1 keeps its existing parser.
  Only Open falls through to the physical writer, and only on the exact SQLSTATE
  `P0001` plus `legacy_inventory_command_retired` pair. Other failures remain terminal.
  Close/Discard do not compare historical receipt wine with a mutable merged wine.
  Phase C still must install replay-only SQL and retire fresh legacy writes atomically;
  these response checks cannot prevent a write that an old RPC already performed.
- Import-batch reversal and invoice deletion recognize only SQLSTATE `P0001` with
  the trimmed message `physical_bottle_dependency` as the named provenance conflict.
  They return HTTP 409 with stable copy and do not run post-reversal cleanup on that
  error. A session reversal with that exact skipped-child reason returns 409 with
  the existing child outcomes instead of reporting success. Other error mappings
  remain unchanged. The application mapping does not enforce the source-lot
  restriction: Phase C still must supply the SQL producer, protect referenced lots,
  and keep a partially reverted session's persisted status truthful.

- The legacy end-of-shift `POST /api/reconcile` path calls
  `reconcile_open_bottles_batch` through `src/domains/cellar/reconcile-service.ts`;
  that version 1 contract and response remain unchanged.
- The version 2 `POST /api/reconcile` source checkpoint requires one operation
  UUID and 1-100 exact-bottle entries with captured state versions. It submits
  the canonical bottle-sorted set through one
  `execute_physical_reconciliation_batch` call and accepts only a strict result
  for the same operation, entry order, bottle identities, target volumes, and
  incremented state versions. This is the application contract for an atomic
  batch; the current source and mocked tests do not prove the SQL transaction,
  RLS, concurrency, or replay implementation.
- Before an initial version 2 request or retry, the client writes and reads back
  the same operation UUID and canonical payload in scoped session storage. A
  missing, throwing, or unverifiable storage write prevents the POST. An
  unresolved frozen operation survives remounts and the legacy 12-hour draft
  expiry, and refreshed, reordered, or missing rows do not change its retry
  payload. Invalid new input remains editable and creates no frozen operation or
  request.
- The bounded version 2 source checkpoint passed 98 focused native tests and
  independent source review. Terminal stale/conflict recovery still needs an
  explicit workflow; the checkpoint keeps the unresolved operation rather than
  clearing it. This checkpoint does not claim SQL, browser, runtime-recovery,
  contract-version cutover, Phase C, or full D1 completion.
- The newer reconciliation queue does not use that RPC. Accept and undo in
  `src/lib/reconcile-ledger/index.ts` issue ordered table reads, subject updates,
  and ledger inserts through the authenticated Supabase client, with explicit
  compensation on partial failure. Do not describe that workflow as one
  database transaction.
- Public wine-list reads stay explicitly protected by RLS policies and contract
  tests.
- Version 1 open, pour, spill, and measured-close routes send a caller-generated UUID
  to `execute_inventory_command`; quantity-bearing fields use integer milliliters. The
  RPC applies physical effects and a durable receipt atomically, returns the stored
  outcome for an exact replay without applying stock twice, and rechecks current
  membership before replay. Close commands bind to both the reusable `open_bottles`
  row ID and its `opened_at` lifecycle timestamp.
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
- Under contract version 1, `POST /api/pour/undo` still uses `undo_last_pour`. When a
  command crossed multiple physical lifecycles or a replacement lifecycle has opened,
  the RPC refuses the unsafe partial reversal and the route returns
  `409 undo_not_reversible`.
- Under contract version 2, the same route requires an idempotency UUID plus the wine,
  expected bottle, and original pour-or-discard event UUID. It routes through
  `execute_physical_bottle_command`, which scopes and locks the referenced event and
  bottle before writing a distinct reversal event. A retry after an uncertain response
  reuses the same UUID and payload. The route fails closed on unknown contract state,
  malformed receipt identity, expired windows, prior reversal, or unsafe review cases.
  These source contracts do not prove migration behavior, RLS, concurrency, or browser
  recovery. In particular, a zero-volume discard cannot satisfy migration 0153's
  positive-delta Undo lookup and still needs SQL/runtime follow-up.
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
