# Small routing qualification plan

Status: SPECIFIED, NOT EXECUTED. Existing model probes establish availability only.

Use synthetic isolated workspaces, identical task snapshots and pinned toolchain. First screen each candidate on one representative case; keep at most two candidates per task class for the next two cases. Use work produced for the approved slice where possible instead of a large disconnected benchmark. Time-box qualification to two active contributor hours after Gate1 and charge its effort to the schedule. If the time-box expires, retain the conservative route and report unknowns.

| Case | Candidate task | Acceptance held by non-author verifier |
|---|---|---|
| Q-A | Pure receipt-draft validation / exact-unit representation | Reject invalid quantities, wrong formats and unknown keys per approved contract; preserve explicit unknown/NV; deterministic error payloads; no side effects |
| Q-B | Narrow UI/API read projection with cost visibility | Correct selected venue/actor context, no private fields when grant absent, useful loading/error/empty state; real negative cases independent of author tests |
| Q-C | Idempotent receipt command / recovery reasoning | One atomic receipt/event/balance, duplicate same key once, altered payload rejected, transaction failure zero partial state, concurrent retry and revoked actor behavior |

Q-C is a higher-risk qualification and does not authorize a cheaper model to own schema merely by passing a toy test. Real SQL/RLS and failure tests remain required for implementation admission. No user/production data leaves the approved production account/region. No production credentials reach a test runner or reviewer.

Record task/model/effort/harness/version, exact prompt/repo/fixture hashes, wall time, active author time, review/fix time, all attempts, first-pass/final acceptance, missed defects and severity, input/output/cache usage if exposed, API-equivalent estimate separately from actual subscription spend, quota/reset snapshot when available, and unresolved limitations. Rejected attempts remain in the denominator. Compare total work and elapsed time per accepted task at equal acceptance; token/sec is not the score.

Promotion: all safety/acceptance checks pass across the class's three cases, no unresolved P0/P1, no more than one bounded fix round per case, and a material time/quota advantage over the current route. Three cases support a provisional local choice only, not a universal best-model claim. Recheck after the first two real slices. Escalate within the same bounded fix round on two diagnostic failures, a repeated reasoning gap, or a missed isolation/replay requirement; change task design before increasing effort again.

Include Fable5.1 low in the comparison with Opus5 low/medium and Sonnet5 medium where appropriate. Keep Sol high as the Codex implementation default and Sol xhigh for correctness review. Do not activate premium fast mode, overage billing, extra subscriptions or quota-reset credits automatically.
