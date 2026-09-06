# Fable audit: verified changes and limits

Fable 5.1 reviewed the complete existing package. GPT-5.6 Sol independently checked its 13 findings against source files and the plan; the root author also checked scope, arithmetic and policy constraints. The independent ledger classified six supported, six partial and one unsupported finding. This is triage, not automatic agreement with every proposed remedy. Original reports and exact-model receipts are under evidence/fable/; original-finder closure is recorded in09-review.md.

| Finding | Decision applied to version 2 |
|---|---|
| F1 horizontal delivery | Replace nine layer-oriented PRs with seven landings: rails, scope schema, usable read, receipt schema, complete receiving flow, operations, deployment evidence. |
| F2 auth/scope ambiguity | Isolate candidate routes/project and narrow SQL capabilities; preserve legacy consumers. Reject the claim that RLS can distinguish app routes sharing a DB role. |
| F3 recovery dependency | Separate candidate restore before real pilot from legacy restore before F/destructive cutover. Keep an early candidate attempt and final restore gate. |
| F4 product lookup | R owns backend lookup and its UI; only approved catalog fields. Legacy broad search stays untouched. |
| F5 human capacity | Add separately estimated 4–8 owner/Rohan hours and named weekend windows. No assumed availability. |
| F6 receipt/UI effort | Raise the broad estimate; show explicit scope reductions and a seven-landing 46.5–88.5-hour proposal. First two slices must calibrate it. |
| F7 performance | Retain required budgets and baselines; reduce fixture size and compare logical workloads, not incompatible physical schemas. |
| F8 claim complexity | One durable controller-written claim record and one builder. Remove unnecessary CAS/heartbeat infrastructure from S. |
| F9 CI scope | Defer queue, aggregator, runner move, sharding and WIP3. Preserve required gates, exact-SHA evidence and selected-scope zero skips. No one-hour deadline authorizes skipping the current bug. |
| F10 matrix contradiction | Add explicit applicability, remove S tags from deferred outcomes, narrow per-outcome test tags and correct lookup ownership. The verifier found a tenth conflict omitted by Fable. |
| F11 group model | Keep group → business → venue and cost separation. Minimal metadata/setup, no implicit group-wide grant. |
| F12 reviewer tier | Reject inference that prior finding dispositions prove a weak reviewer. Independently verify Gemini high availability and use it for complex boundary reviews; qualification remains unmeasured. |
| F13 approval burden | Keep S-first navigation; mark F/AWS/CI expansion as optional/deferred. Preserve required data and owner gates. |

Additional checks of Fable's proposal: protocol activation is included in V0; receiving backend and UI are one V2 landing; Day-3 usable read is only a stretch; no unnumbered SQL migrations or TypeScript sketches are created during planning; Sol coding stays high under the host routing policy. The smaller scope is a proposal, not an owner-approved change or a production readiness claim.
