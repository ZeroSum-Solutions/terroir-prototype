# Terroir autonomous production-readiness execution

Date: 2026-09-23. Status: active; no completion claim.

## Authority and outcome

The owner approved all remaining interview recommendations in the
[product PRD](2026-09-20-terroir-product-data-requirements.md), then requested `/goal`
implementation, testing and iteration, team readiness, mobile optimization, arbitrary
agent delegation, and JEV verification while the owner is absent. This document
turns that approval into executable work. It is not a replacement PRD.

Done means the committed release requirements have working application paths,
independent review, and captured proof against the actual code/database/browser.
An unavailable provider, an unmeasured pilot, a skipped test, or a fixture-only
integration is never reported as verified live behavior. Engineering readiness and
production promotion remain separate. The approved four-week pilot metrics require
real staff and a baseline; automation cannot fabricate those observations.

Repository: `/Users/zero/projects/_archive/terroir-prototype`.
Initial HEAD: `beb7539b289396caad26fed1c1ba78d2c9d0aeb2`.
Implementation branch: `feat/production-readiness-20260923`.
Existing unpublished planning edits are preserved. No automatic merge to main:
AGENTS.md identifies it as a production deployment trigger.

## Scope and decision policy

- Deliver restaurant operations and team/multi-site safety first, then the approved
  collector follow-on. Offline B is required; C is the next priority offline slice.
- Preserve central-purchasing/warehouse automation, 3D expansion, alcohol checkout,
  and merchant-dependent enthusiast functionality as explicit roadmap deferrals.
  Provenance: approved PRD Q6 defers central purchasing/warehouses; Q14 retains 3D
  and merchant/enthusiast expansion on the roadmap; Q15 excludes alcohol checkout.
- Staff physical events own depletion initially. Toast sales corroborate, not
  duplicate, that physical outcome. Toast access and exact pilot setup remain unknown.
- Use group/site fixtures to prove isolation without inventing the real business's
  site count, legal owners, country, currency, staff devices, or inventory quantities.
- Resolve reversible implementation details using existing repository conventions.
  Record consequential choices and their acceptance tests before changing schema.
- Do not read `.env.local` for tests or point dev/test/migration tools at hosted data.
  Use `scripts/local/dev-local.sh` and loopback guards. Never weaken those guards.
- Use existing approved subscription/provider lanes. JEV is explicitly requested;
  keep secrets out of source, logs, reports, and reviewer packets. Do not rotate keys.
- Retain the accepted Q15 gates for production data/migrations, production deployment,
  and new purchases beyond existing approvals. Continue safe independent work when
  an external dependency is unavailable; do not waive its evidence requirement.

## Execution sequence and acceptance criteria

Each row is a workstream, split into bounded tasks as evidence identifies the exact
change. Approved new behavior enters `app_spec.txt` and the generated feature ledger
before implementation, following repository rules. No hand-editing generated output.

| ID | Required outcome and source | Evidence required |
|---|---|---|
| C00 | Approved contract, source-ledger traceability, durable resumable state (PRD sections 2/9/11) | Contract check, generated-ledger verification, independent plan review |
| C01 | Safe isolated reproducible environment and truthful baseline (Q15) | Loopback target checks; current type/lint/unit/contract/design/build results with exit codes and explicit skips |
| C02 | Conserved quantities, one depletion, idempotent/concurrent writes and history (Q8/10, PRD invariants) | Live local DB tests including opening 750 mL, four 150 mL pours leaving 150 mL, retries, concurrent last bottle, rejection and reversal |
| C03 | Offline B: cached lookup, pours, opening, waste and counts (Q5) | Browser offline/reload/reconnect tests; durable pending states, one replay outcome, access revalidation, count cutoff, conflict and device-storage failure cases |
| C04 | Group/site team access, role-aware controls and protected costs (Q6/9) | Authenticated API/UI/live RLS tests with at least two sites, group grants, third-party isolation, revoked membership and staff cost hiding |
| C05 | Transfers and offline C receiving/management paths (Q5/6) | Reviewed allowed-operation list before code, excluding local authorization administration/irreversible financial actions; six dispatched/five received preserves unresolved unit; offline reconciliation, actor/owner/custodian audit, conflict and no-duplicate cases |
| C06 | Receive/place/find/serve/count/reconcile end-to-end (Q10/11) | Invoice/file review paths, open-vs-sealed counts, returns/credits, manager discrepancy review, critical E2E evidence |
| C07 | Mobile-first service usable by a team (Q12 and explicit mobile request) | Browser journeys at 320/390/768/1200 widths, no clipped primary controls, >=44px service targets, keyboard/focus/contrast checks, light/dark screenshots against DESIGN.md, interruption recovery |
| C08 | Toast-first boundary with safe unavailable-integration behavior (Q8) | Adapter contract tests for duplicate/out-of-order/refund/comp/split events, versioned mapping, no double depletion; live smoke only with verified access, otherwise clearly gated |
| C09 | Useful bounded AI with JEV advisory verification (Q13 and explicit JEV request) | Sanitized held-out fixtures, schema validation, source/tenant isolation, latency/cost accounting, abstention and provider-failure fallback; recorded JEV requests/results when safely authenticated |
| C10 | Identity, provenance, prices, notes and history remain truthful (Q10/11/13/14) | Unknown/NV/vintage/format cases, rejected wrong producer, import correction/reversal, private notes and source/observation metadata tests |
| C11 | Approved personal collector experience (Q14) | Personal tenancy, multiple cellars, delegated access, intake/location/image-led browsing, evolving notes/ratings, sourced guidance/value or explicit unknown; restaurant regression proof |
| C12 | Operational release safety (Q15) | Local fresh migration + upgrade/down checks, generated types/snapshot, restore rehearsal in disposable target, local/disposable health/monitoring checks, documented rollback/release steps; hosted checks belong to gated promotion |
| C13 | Independent production-readiness verification (Q15) | All required CI-equivalent gates at final revision, zero skipped critical tests, security + TypeScript review, independent browser/database verifier, exact revision evidence, deterministic completion gate |
| C14 | Pilot measurement capability (Q7) | Tested task/count-duration capture and baseline export using Q7 definitions, scoped to authorized users; synthetic timing fixtures never presented as real four-week pilot observations |

Acceptance criteria translate approved behaviors; they do not invent a measured
baseline. Human task-speed and 50% count-time improvement targets remain external
pilot validation, with metric definitions from Q7. Live Toast, licensed market data,
and image rights must be verified before enabling the corresponding live feature.

## Offline engineering policy to prove

The first C03 slice is partial local work under `TER-048`, not a C03 completion claim.
The frozen twelve-path leaf implements the local `GET /api/offline-context` source for
TER-CF-297; bounded evidence records 81 passing tests, including three live loopback
tenant-containment tests, plus independent acceptance of this bounded leaf. TER-CF-291 through
TER-CF-293 store work remains concurrent, unverified WIP. TER-CF-294 through
TER-CF-296 public-shell, session-boundary, and cached-search work is incomplete.
This evidence covers the endpoint only; deployment and the full offline workflow are
unverified. Completion status remains in the generated feature ledger and product
conformance report. The accepted
[`offline-operation contract`](2026-09-23-terroir-offline-operation-contract.md)
keeps this slice cost-free and mutation-free. C06 individual-bottle receipts and
online count/receiving/placement authority gate durable capture; C04 site grants and
the transfer lifecycle also gate C05 transfers.

Never label a local pending write as synchronized. Persist a stable operation ID
before acknowledging capture. Partition local data by authenticated user and site;
do not expose a previous user's cache after switching or signing out. Revalidate
authority on replay. Preserve a physical report that conflicts with current stock
as a needs-review event, rather than silently dropping it or forcing negative stock.
Quantity conservation applies to the server-committed ledger. A needs-review report
does not change that ledger until an authorized resolution commits a correction.
Flag the affected bottle/allocation as disputed rather than presenting it as known
available. Resolve by an auditable adjustment or rejected-report reason; retain the
original report in either case. Test this arithmetic and presentation explicitly.
Two disconnected devices cannot promise exclusive allocation of a last bottle.
Show cached-data age and pending changes. Fail explicitly if durable storage is
unavailable. Do not make authorization administration or an irreversible financial
action execute locally without server validation. Specify offline C's allowed
management operations before implementing that slice.

## Design reference lock

Use the existing `DESIGN.md` as the primary visual target, preserving Obsidian/Bone,
Copper action roles, Cormorant wine names, Manrope controls, and existing token gates.
The owner approved stable role-aware navigation, readable low-light service, large
targets, and image-led collector browsing. Refero/craft research supports interaction
details; it does not authorize replacing the existing product identity. Inspect real
rendered states before selecting changes. No generic new design system or heavy UI kit.

## Review and proof protocol

The goal skill controls durable state and proof; Fable controls evidence-first
planning and reassessment. User instructions override the goal skill's Grok route:
retain Opus 5 adversarial review from this conversation and add JEV as requested.
JEV's structured judgments are advisory, not an executable browser/database verifier.
Use separate workers, TypeScript/database/security reviewers, and an independent
verifier. The author never provides the sole final verification of their own change.

Store machine state and full command/review evidence under
`/Users/zero/.claude/goal-state/terroir-production-20260923/`.
Read state each iteration; record task, criterion, current diff, test command,
stdout/stderr/exit code, independent review and remediation before completing a task.
The goal completion script checks artifact presence, not content correctness:
reviewers and actual passing commands must establish the latter.
An independent verifier must run its own commands and capture its own browser/database
evidence at the exact revision, not summarize an implementer's report. JEV/Opus
judgments alone cannot satisfy an executable acceptance criterion.
The September 23 Opus closure returned READY TO IMPLEMENT, not runtime approval.
Its suggested overall iteration ceiling is not adopted: the owner expressly asked
for persistent execution without a budget. Bound individual requests and retries,
preserve resumable state, and stop only at verified completion or a genuine remaining
authority/dependency blocker after safe alternatives and independent work are exhausted.

C12's disposable target must be a separately named database/container on loopback,
never the existing application's live local database or a hosted project. Record its
exact name before a restore/down-migration rehearsal. Successful local rehearsal
does not authorize or prove production promotion. Re-run JEV checks at the relevant
final revision using an authorized safe credential lane; historical transcripts alone
cannot establish the current provider check. If that lane becomes unavailable, keep
the corresponding check unverified rather than marking fixture fallback as live proof.

Per-criterion outcomes are `COMPLETE-VERIFIED`, `INCOMPLETE`, or `BLOCKED-EXTERNAL`.
Only the first may map to a completed task. Any other outcome forbids an aggregate
application-complete claim, even if an artifact-presence checker exits successfully.
C11 cannot be reclassified as roadmap merely because it has not been reached.
External gaps lead the readiness report rather than being hidden among passed checks.
After two failed attempts at one task, re-examine the evidence with an independent
reviewer/root and change the approach. Record genuine external decisions in
`owner-decisions.md`, continue independent tasks, and never relabel an implementation
defect as an external blocker simply because it is difficult.

## Initial unknowns and dependencies

- Exact pilot location/entity/device/source-file facts remain unknown. Use named
  synthetic fixtures and label them; do not substitute them for customer facts.
- Toast access/entitlements are unverified. Controlled inventory pilot remains usable
  without a live connector; do not claim the connector has passed live testing.
- JEV environment variables are absent and ZS Vault is locked. A one-time,
  non-echoing in-memory use of the owner's supplied key succeeded on September 23:
  `jev-1.13.0`, three bounded advisory judgments, 354 ms, 3,150 input tokens and
  119 output tokens. This proves provider connectivity for that call, not application
  correctness or wine-domain accuracy. No key was rotated or stored in the repository.
  Runtime secret provisioning for the application remains a separate setup step.
- Real-user performance, willingness to pay, and production promotion require
  external validation/authority distinct from software engineering checks.
