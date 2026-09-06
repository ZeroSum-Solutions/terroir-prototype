# Independent architecture-research verification

**VERDICT: PASS**

Verified at `2026-09-06T01:32:54Z` against draft SHA-256 `10f47399936c3a7d16d4e258f3b2407f120e7dd1221bf675290991525e8aa02f`.

The final synthesis is evidence-bounded and consistent with the canonical Terroir plan. It retains the modular Next.js/Supabase target, treats S as an unapproved manual-receipt evaluation only, and does not admit Toast, OCR, label scanning, maps, purchasing, imports, or new queue infrastructure into S.

| Criterion | Verdict | Evidence |
|---|---|---|
| Quote and attribution integrity | PASS | All 38 records in `checked/claims.jsonl` have unique IDs, exact literal quotes in their SHA-256-matched captures, and matching URL/path/hash records in `checked/sources.json`. `checked/checks.json` independently records 38/38 literal passes, 35 quoted pages and no original-core-file changes. |
| Source dates and staleness | PASS | Unsupported dates on the Vivino and Bevly captures were changed to `unknown`; the final draft no longer dates the Vivino guide. The 2015 Vinous date is present in `harvest/competitors/v1.vinous.com-3209769435.md:38`; WineSensed's 2025 update is present in `harvest/huggingface/huggingface.co-1173021735.md:118-119`. Unknown dates remain unknown. |
| Competitor private-backend boundary | PASS | `draft.md:9,15-20` labels public behavior/vendor statements separately and says the six current private backends are not established. It does not infer databases, queues, tenancy, consistency, or matcher topology from UI behavior. |
| Model-quality boundary | PASS | `draft.md:72-78,108,130` treats models as evaluation candidates, supplies a Terroir-specific holdout protocol, and makes no invoice, bottle, latency, memory, or cost claim from generic benchmarks. |
| Code, weight, and data licensing | PASS | `draft.md:57-62,72-76` distinguishes application code licenses, Granite/DINOv2 weights, Paddle 1.6's unresolved weights license, unknown training-data rights, WineSensed's dataset statement and upstream-rights gap, X-Wines' dataset label, and the absence of a separate X-Wines code license. The InvenTree and ERPNext code-license links match their GitHub license receipts in `checked/sources.json`. |
| Queue delivery versus business effect | PASS | `draft.md:60,104,121` records Graphile's at-least-once execution and pg-boss transactional enqueueing while retaining payload-bound idempotency, durable receipts, provider-aware recovery, and the explicit warning that queue-delivery claims do not prove exactly-once cross-system effects. |
| Authorization at receipt | PASS | `draft.md:51,87-94,104,116` checks current authorization at execution and commits authorized stock effects atomically; receipt never creates or expands grants. This matches `02-architecture-data.md:11,58,60`. |
| Reconciliation versus lifecycle replay | PASS | `draft.md:30,51,91-97,121` confines desired/observed reconciliation to projections or worker supervision and preserves versioned Toast events/snapshots, corrected/out-of-order replay, and effect-level posting. This matches `scope.csv:E-022` and `02-architecture-data.md:89`. |
| S/F scope and Gate 1 | PASS | `draft.md:3,60-64,82,112-124,138` marks future capabilities as deferred/full-target, keeps S to approved-product lookup plus manual receipt/correction/export/revoke/recovery, changes no scope row, and preserves implementation NO-GO pending Gate 1. |
| Fable/Opus endorsement boundary | PASS | `draft.md:136` explicitly states that prior Fable/Opus reviews do not certify this addendum and that no new Fable/Opus agreement is claimed. |
| Research-only boundary | PASS | Terroir remains at `abdc661abde43b0ac70a81f740b61d21da7e414b`; `git status --short` shows only the existing untracked planning directory. No application, schema, config, dependency, credential, model, or deployment work was performed by this verification. |

## Resolved findings

1. `infrastructure.md:32` originally used desired-state reconciliation for Toast intake and grant propagation. It now preserves provider lifecycle history and uses reconciliation only for projection drift.
2. `infrastructure.md:34` originally said receipt created tenant grant effects. It now checks the current grant and forbids receive from creating or expanding authority.
3. `competitors.claims.jsonl` originally supplied unsupported exact dates for Vivino and Bevly. Both are now `unknown`, and the prose no longer carries the Vivino date.
4. `draft.md:72-76` now separates code, model/weight, training-data, dataset, and upstream-content rights instead of carrying one license across artifact classes or model versions.
5. `draft.md:136` now denies any new Fable/Opus endorsement of this addendum.

## Evidence limits

This was a source-and-recommendation audit, not a runtime product test. Current competitor internals, vendor contracts, Terroir model accuracy, deployment compatibility, performance, memory pressure, cost, and provider replay guarantees remain unverified, as the draft states.

The packaged evidence is normalized: every claim uses an absolute capture path and is joined to the source catalog by URL, capture path and SHA-256. Raw full-page captures remain scratch evidence and are not part of the intended deliverable.

Checked artifact SHA-256 receipts: `claims.jsonl` `3d0fb324681d4b614a73cb9fed3d49f27d0405e5806d4c85d84917e6f44817f3`; `sources.json` `1c6fd10165ee81f4b578b72ed4ec89b479c0a0a9e2e8d6318ee690dc6dad0503`; `checks.json` `2fddeafa4f98c011cdcfe58f232ab5c2a6a20680ac4e5609a9e3503cd1bb1bca`.

Highest-priority fix: none. The blocking findings were corrected before this verdict.
