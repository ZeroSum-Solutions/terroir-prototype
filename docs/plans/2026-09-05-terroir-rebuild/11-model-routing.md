# Model routing by accepted task

Use existing subscriptions first. Default routing below is a proposed operational policy, not a measured speed/quality ranking. The qualification plan in preparation/QUALIFICATION.md can change a route only after accepted-task evidence; model count and token price do not predict delivered features.

| Task | Initial author / effort / harness | Escalation and boundary |
|---|---|---|
| Architecture, vertical slices, high-impact re-plan | claude-fable-5-1 / high / Claude Code Max OAuth | Fable already completed this audit. Use bounded packets and explicit questions; medium for narrow closure when justified. |
| Most TypeScript, API/UI vertical slices | gpt-5.6-sol / high / Codex OAuth CLI | xhigh for difficult debugging/testing/review. This is the default bulk coding lane. |
| SQL, RLS, atomic inventory, recovery and application security/revocation (V3) | claude-opus-5 / high / Claude Code Max OAuth | Fable high for unresolved architectural contradictions; D remains sole schema owner regardless of model. |
| Bounded routine fixtures, docs, mechanical edits | claude-sonnet-5 / medium / Claude Code Max OAuth | Escalate to Sol high or Opus high when scope grows. No auth/stock/security work sent here by default. |
| Bulk-lane challenger | claude-fable-5-1 / low / Claude Code Max OAuth | Qualify against Sonnet medium and Opus low/medium on small tasks. Promote only if accepted quality and total time/quota use justify it. |
| Codex-authored independent review | claude-opus-5 / high / Claude Code + gemini-3.8-flash-high / agy | Separate fresh sessions/agents, simultaneous identical packet. Fable high can replace the Claude reviewer for a critical design. |
| Claude-authored independent review | gpt-5.6-sol / xhigh / Codex + gemini-3.8-flash-high / agy | Same vendor/harness/session independence rules. Gemini medium/low may review simple docs after qualification, never silent substitution. |
| Trivial classification/title/extraction | gpt-5.6-luna / xhigh / Codex | Unprobed optional lane; no implementation, schema, review or operational authority. Terra is not a default lane. |

After a reproducible failure, isolate the cause before changing models. One bounded review correction round remains the limit. Escalation inside that round must preserve evidence and the author identity; if a second vendor starts authoring, re-evaluate reviewer independence before admission. A quota error checkpoints exact SHA/diff/claim and stops that lane; it does not authorize account switching, a new subscription or extra usage. Verified approved fallbacks must still satisfy independent review or require owner adjudication.

## Dated availability and provenance: September 5, 2026

- Fable: exact requested and reported model claude-fable-5-1, high, Claude Code Max OAuth; real audit completed in 285 seconds, session afd0f4d2-85a7-4f94-a836-d36105e25314. This proves the lane worked for the audit, not coding throughput. OpenRouter uses a different route ID, anthropic/claude-fable-5.1. [Official Fable model ID and capabilities](https://platform.claude.com/docs/en/models/fable-5-1/overview).
- Sonnet: requested/reported claude-sonnet-5, medium, Max OAuth, LANE_OK in 5.9 seconds. Availability only.
- Opus and Sol: earlier dated package probes succeeded; Opus also performed the previous real audit. This turn Sol performed the independent source verification. See06 and original receipts; quota/latency is not guaranteed.
- Antigravity lists gemini-3.8-flash-high, medium and low. Low worked in the previous review. The fresh high review succeeded via the requested CLI selection (63 seconds, session a2c98f83-1448-4a38-bebd-947f8073c969), but did not echo a backend model ID. This is successful CLI selection, not full model attestation.
- Codex shared weekly snapshot showed 26% used / 74% remaining. It is account-wide, can change, and is not reserved capacity for Terroir. No reset credit was redeemed.
- Existing local subscription proxies refused connections; none is needed for these working CLIs. MacBook/AWS and paid alternate providers are excluded from promised capacity.

Latest availability update: the attempted final Fable reread returned a Claude session-limit message with a7pm reset and exit1. Its status string said success, but no substantive review occurred. Treat Fable as unavailable until a fresh availability check succeeds; recheck other Claude lanes before assigning work because earlier probes do not reserve quota. We cannot attribute shared-account exhaustion solely to this audit. No paid fallback or overage was enabled. Sol/Gemini source and closure verification continued; no substitute is labelled as Fable. See09 and the failure receipt.

## Qualification, economics and limits

Before changing the bulk route, time-box up to two active contributor-hours in V0. Screen a small synthetic task, then compare at most two finalists per task class on two more independent cases. Retain failed attempts; score correctness/security first, then first-pass acceptance, active author/review/fix time, elapsed time and usage when exposed. At least one case must test ambiguous input, one transactional/permission failure and one UI persistence outcome. This is a screen, not statistical proof; revisit the first two real slices. Do not run every model against the full app or route production data to benchmark prompts.

Compare cost per accepted task: billed incremental spend when known, subscription quota use, total completion time and fix/review overhead. Report separate columns; do not invent a dollar conversion for OAuth quotas. A bigger model at low effort is worth testing rather than assuming a smaller one is cheaper. That is a provider hypothesis, not a Terroir measurement. [Anthropic task-cost guidance](https://platform.claude.com/docs/en/about-claude/models/optimizing-for-cost-and-intelligence).

Official direct-API reference prices, not our subscription bill: Fable input/output $10/$50 per million tokens, Opus $5/$25, Sonnet $2/$10 in the fetched model guidance; Sol $4/$20 on its official page. Route/catalog prices may differ, so do not mix OpenRouter and direct API numbers. [Claude pricing context](https://platform.claude.com/docs/en/models/fable-5-1/overview), [Sol official pricing](https://developers.openai.com/api/docs/models/gpt-5.6-sol). Fable CLI's $1.145985 cost estimate has unknown cost basis and is explicitly **not a subscription invoice**. No direct billed Anthropic call, fast-mode premium, overage enablement, reset redemption or new subscription is authorized by this plan. Existing $800/month coding and $100/month miscellaneous budgets remain unchanged.
