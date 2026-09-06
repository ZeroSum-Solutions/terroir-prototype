# Scope, vertical slices and 14-day capacity

Version 2 replaces the earlier nine horizontal PRs and 56–84-hour estimate. No scope has been approved. All 68 product outcomes and 35 original R requirements remain in scope.csv; bounded evaluation coverage never completes a full release outcome.

## Scope choices

F is the full restaurant release: operational stock authority, group operations, full intake and stock workflows, real Toast, public discovery/knowledge/map and all other 35 R outcomes. Estimated 264–448 contributor-hours, 22–30 integration PRs, 20–32 critical-path calendar days before contingency and external lead times. These remain planning estimates; F is NO-GO in 14 days.

S-broad is the earlier evaluation proposal, including context selection, ambiguous identity review, editable cellar placement and richer support. Re-estimated author effort is 46–76 hours. Seven landings require 10.5–17.5 review/integration hours, plus up to 2 qualification hours: 58.5–95.5 total. Its upper range exceeds the 88-hour capacity assumption. It is not the recommended 14-day baseline.

**S is the newly narrowed recommendation, requiring explicit Gate 1 selection:** invited owner/staff signs in to a fixed assigned business/venue, sees scoped cellar stock, chooses an approved product/package, enters and reviews a manual receipt, confirms it once, then sees the persisted lot. The operator can make an attributed reversal/correction, export the evaluation records, revoke access and pause/recover the evaluation. Cost visibility remains separately granted. Group → business → venue structure exists from day one; fixture coverage spans two businesses and two venues. One named pilot venue tests the workflow. The restaurant continues its authoritative operational records outside S.

S1 scope/grants; S2 approved product/package selection; S3 reviewed manual receipt and retry; S4 atomic immutable receipt/events/balance/correction; S5 scoped cellar and cost separation; S6 export/revoke/recovery and blocked unsupported writers; S7 real persistence, isolation, performance and deployed recovery evidence.

Explicit reductions from S-broad: fixed context per invitation instead of a context-switching setup UI; approved catalog picklist with a clear unsupported-product state instead of identity merge/ambiguity tooling; venue-level placement instead of room/bin editors; scoped CSV and an operator runbook instead of a support dashboard. These save an estimated 7–12 author-hours, not measured savings. Treat the savings and original estimates as uncertain intervals: 46–76 minus 7–12 gives a conservative 34–69 author-hour envelope. Per changed row: V1 broad6–10 minus3–4 gives2–7; V2 broad14–22 minus3–6 gives8–19; V3 broad6–10 minus1–2 gives4–9. Correlated low/high pairing is not assumed. They remove behavior; they do not lower estimates for unchanged behavior. Unknown vintage remains distinct from NV. No custom identity creation, attachment upload, extraction, photo scan, imports, pours, counts, transfers, purchasing, Toast, public map/knowledge, offline or automated publication enters S. All remain explicit deferred outcomes. The old app remains intact.

## Seven planned landings

Hours cover authoring and focused checks. Reviews/integration are separate. Owner letters identify distinct role sessions, not concurrent builders. Schema author D exclusively owns every migration/generated type; a consumer owner never edits SQL.

| Slice | User-observable result / acceptance | Owner | Dependency | Author hours | Scope bound / fallback |
|---|---|---|---|---:|---|
| V0 rails and protocol | Candidate cannot deploy main; existing receipt persistence characterized; required CI and selected canary strategy recorded; protocol/adapters activated together | Q | Gate 1, authorized settings/environment | 4–8 | Existing runner and serialized protected landing; no queue/caching project. Current 390px repair charged here; if it cannot fit, re-plan, never waive a relevant test. |
| M1 scoped access contract | Applied group/business/venue/grants with owner/staff and foreign-scope deny cases | D | V0 | 4–6 | Minimal metadata; no group-wide cost grant or membership editor. Additive schema immediately before V1. |
| V1 sign in and view cellar | Invited actor sees a real DB-backed seeded cellar at assigned venue; foreign data and costs denied; logout works | C | M1 | 2–7 | Fixed context per invite. Pilot bootstrap and invited sign-in only; no broad legacy auth rewrite. |
| M2 receipt contract | Minimal identity/package and transactional receipt/event/balance schema passes replay, concurrency, rollback and correction checks | D | V1 | 6–10 | Only receipt and reversal commands, future stock contracts remain prose. |
| V2 receive and see the wine | Search approved products → type/review → confirm → persisted cellar lot → reopen/retry/correct; actual SQL E2E at mobile and desktop | R | M2 | 8–19 | One full-stack owner for candidate lookup, receipt API and receiving/cellar UI. Venue placement only; no unsupported product creation. |
| V3 revoke, export and pause | Revocation takes effect on next mutation; CSV honors grants; operator pauses safely and follows recovery instructions | O | V2 | 4–9 | Runbook and bounded operator actions; no support dashboard/alert suite. |
| V4 deploy and rehearse | Exact-SHA candidate smoke, selected suite, performance and restore/compatible rollback evidence; Gate 2 packet | Q | V3 | 6–10 | Synthetic-only until every applicable Gate 2 criterion passes. |
| **Author total** | | | | **34–69** | |

Protocol activation is inside V0, not an uncounted extra PR. V2 includes minimal receiving UI and cellar refresh; no backend-only landing can claim the first user write. Each schema landing has executable contract tests and one immediate consumer; aim to begin that consumer within 24 hours, otherwise stop new admissions and re-plan. D supplies schema changes through M1/M2, never by sharing file ownership with V1/V2. Split a landing only if coherent review requires it, and charge the extra review/integration cost before admission.

## Capacity and cost arithmetic

Assume one builder and 11 planned delivery days × 8 productive contributor-hours/day = 88 hours. This is an unverified availability assumption for sequential author, triage, fix and integration effort, not 88 hours of Devin's typing. Review cloud wait may overlap, but active review/integration effort stays charged. Seven landings × 1.5–2.5 review/integration hours = 10.5–17.5. Add up to 2 qualification hours. Total S = **46.5–88.5 hours**. The conservative upper envelope exceeds 88 hours by 0.5 hour; there is no claimed positive slack. The deadline has no unconditional GO. A conditional evaluation forecast requires early calibration showing the remaining upper estimate fits the remaining planned capacity; otherwise return deadline NO-GO and the synthetic fallback. Estimates are not probabilities or measured agent throughput; scope savings need confirmation on the first two slices. At 4 hours/day only 44 hours are available: S is NO-GO. Unbounded auth, provisioning and owner waits are additional calendar risks, not hidden in the effort range.

Devin/Rohan: separately reserve an estimated **4–8 human hours** across Gate 1/settings approvals (1–2), pilot workflow/fixture acceptance (1–2), Gate 2 and rehearsal attendance (1–2), final review/feedback (1–2), with named weekend windows. This estimate is unverified and does not replace ongoing product review; any additional review enters observed capacity. Record who owns each window. No answer or availability is inferred from elapsed time.

Current measured required CI median is 5.975 minutes. Last 30 merged PRs have median created-to-merged time 5.9917 minutes (18 non-doc median 6.2917); this omits pre-PR development. WIP 2 gives a queue-service ceiling of 19.1 merges/hour, not build capacity. Actual supply must deliver 7/11 = 0.64 accepted slices/day. At 12 contributor-hours/slice, 88/12 = 7.33 slices, before extra qualification; no agent-count multiplier. Initial WIP remains at most two ready PRs, one builder and one serialized landing.

Required-gate compute allowance: 7 × 3 runs × 5.975 = 125.5 runner-minutes (initial, one fix, integration). Eleven full runs × observed noncancelled-failure median 21.475 × 1.5 retry allowance = 354.3 minutes. Total provisional compute 479.8 minutes excludes setup variance and any additional characterization; failed runs may understate passing-suite duration. Verify account rate/credits before spending. See evidence/ci/pr-cycle-statistics.json and 06-capacity.md. CI speed does not establish delivery speed.

## Calendar and re-plan rules

T0 is the Gate 1 approval timestamp, in Los Angeles time. Deadline T0 + 14 calendar days; no fixed September 19 date without a September 5 approval. Day 1 ends T0 + 24 hours. Days 12–14 are contingency: 3/14 = 21.4%, with no scheduled features.

| Planned window | Exit / response |
|---|---|
| Days 1–3 | V0 then M1; verify candidate protection/routing and candidate recovery destination, start baseline characterization and qualification. First candidate synthetic restore attempt by Day 3. V1 by Day 3 is only a low-estimate stretch, not baseline. |
| Days 3–4 | V1 usable invited/scoped read with actual isolation proof. Record measured effort and external waits; reassess all remaining slices. |
| Days 4–6 | M2 then start V2; schema invariants before API/UI consumer. |
| Days 6–8 | V2 complete receipt-to-cellar and correction. No deferred feature admission. |
| Days 8–9 | V3 operational evaluation controls and recovery proof. |
| Days 10–11 | V4 integrated acceptance, exact-SHA deployment and candidate-data restore rehearsal; Gate 2 only if all applicable checks pass. |
| Days 12–14 | Reserved defect/recovery/approval contingency. Otherwise prepared demonstration and supervised test readiness. |

These are checkpoints, not guarantees that every high estimate fits its calendar row. V0 is the first calibration point: exceeding its 8-hour author estimate triggers immediate re-plan. Qualification is separate (up to2 hours) and charged once even when run during V0. At V1 completion, no later than Day4, formally recompute cumulative and remaining author/review/fix effort versus remaining planned hours. No arbitrary20-hour cumulative threshold replaces that calculation. At each later landing recompute the same forecast. Re-plan if a wave is over one day late, the same gate fails twice, the bounded fix round leaves a blocker, or remaining high estimate exceeds capacity. If candidate infrastructure/recovery is unavailable by Day 3, declare hosted real-pilot deadline NO-GO; synthetic proof may continue. Legacy production restore is required before any legacy destructive/cutover work, not an S dependency. Candidate backup/restore remains mandatory before real pilot admission.

Failing S after these explicit cuts falls back to a clearly labelled synthetic demonstration and gap report, not an even thinner unannounced real pilot. Do not borrow the buffer for added features, skip relevant tests, widen permissions, or call S the full release. Gate 1 must approve the narrowed S definition and capacity assumptions; implementation remains NO-GO until then.
