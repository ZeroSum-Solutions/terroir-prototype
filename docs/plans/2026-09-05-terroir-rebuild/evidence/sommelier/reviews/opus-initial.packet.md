```json
{
  "verdict": "REVISE",
  "findings": [
    {
      "id": "F1",
      "severity": "high",
      "section": "Retrieval process / Memory lifecycle and control / Implementation slices (AI-4)",
      "claim": "The draft governs model egress with an authorization/evidence ticket rechecked 'immediately before sending data' and restricts external inference, while AI-4 indexes 'any explicitly authorized private notes' and the HF shortlist is evaluated on 'resident memory' and 'deployment cost'.",
      "why": "Egress control is written for answer-generation turns only. Index construction is itself an egress event: embedding a private house note, and any scheduled re-embedding, sends private text to whatever runs the embedding/reranker model, in bulk, outside any per-request ticket. The draft never decides whether Qwen3/E5/BGE/MiniLM inference is self-hosted inside the approved boundary or called through a hosted provider. That single unmade decision determines (a) whether private notes leave the production boundary, (b) whether the Railway/Supabase deployment must carry model memory and latency, and (c) whether the 'production inference needs its own authorized provider' paragraph covers embeddings at all — as written it reads as covering only the conversational provider. The canonical boundary document permits only synthetic fixtures to leave the approved production boundary, so an undecided execution location is not a neutral deferral.",
      "evidence": "Draft: 'For external inference, create a bounded authorization/evidence ticket'; 'Re-embedding builds a new compatible index'; AI-4 dependency line 'plus any explicitly authorized private notes'; 'peak total memory and deployment cost'. Canonical: 'Only synthetic fixtures may leave the approved production boundary for Macs, CI or general AWS.' Packet contains no provider, hosting or egress receipt for any HF model.",
      "required_change": "Add an explicit decision point before AI-4 admission: state embedding/reranker execution location (in-boundary self-hosted vs authorized external provider), classify bulk index-build and re-embedding as egress events subject to the same ticket/revocation rules as inference turns, forbid private-note embedding through any provider not covered by an approved data policy, and fold model hosting cost/memory into the same authorized operating budget as conversational inference."
    },
    {
      "id": "F2",
      "severity": "high",
      "section": "Memory lifecycle and control / Where memory, ratings and recommendations live",
      "claim": "Deletion scope covers 'source content, embeddings, summaries and cached recommendation results', while temporal eligibility requires persisting 'either the eligible candidate set or sufficient catalog/stock/price snapshot versions' plus an exposure log of candidate IDs and shown order.",
      "why": "These two requirements collide and the draft never adjudicates the collision. Exposure and feedback records are per-profile behavioural data; eligibility snapshots embed the candidate lists shown to an identified profile. Neither appears in the enumerated deletion scope, yet AI-6 evaluation depends on retaining exactly those rows. A user exercising 'forget a memory' or 'disable personalization' therefore has an undefined outcome for the largest personal-behaviour store in the design, and the AI-6 exit condition ('deletion handling') has no policy to test against. This is the same class of error the draft correctly warns about elsewhere ('Do not describe a soft-delete flag ... as completed erasure').",
      "evidence": "Draft: 'Forgetting removes or suppresses source content, embeddings, summaries and cached recommendation results'; 'Record what was shown before interpreting clicks or dismissals'; 'Persist either the eligible candidate set or sufficient catalog/stock/price snapshot versions to reconstruct eligibility'; AI-6 exit evidence 'training manifest, deletion handling'.",
      "required_change": "State explicitly, per store, whether exposure records, feedback events and eligibility snapshots are in deletion scope, out of scope, or retained only in a de-identified form that cannot be rejoined to the profile — and if retained, say so in the user-facing 'forget' control rather than implying full erasure. Make the chosen policy a named AI-2/AI-6 acceptance test."
    },
    {
      "id": "F3",
      "severity": "medium",
      "section": "Hugging Face shortlist",
      "claim": "License dispositions are asserted for six model artifacts: Qwen3-Embedding-0.6B and Qwen3-Reranker-0.6B 'list Apache-2.0'; multilingual-e5-small 'lists MIT'; MiniLM cross-encoder 'lists Apache-2.0'; BGE-M3 'lists MIT'; EmbeddingGemma 'gated access'.",
      "why": "The packet supports only one of these. HF-07 verifies BGE MIT and free commercial model use, and HF-05 verifies the Gemma redistribution restriction. The excerpts supplied for Qwen3-Embedding (HF-01), Qwen3-Reranker (HF-02), multilingual-e5-small (HF-08), MiniLM (HF-09) and BGE-M3 (HF-06) quote dimensions, parameter counts, language coverage and a MIRACL correction respectively — none quotes a license, and no HF metadata receipt is included alongside the GitHub license receipts. 'Gated access' for EmbeddingGemma is likewise unsupported in packet. The draft imposes 'licenses by artifact' discipline on itself and then supplies unreceipted license statements for its primary retrieval candidates.",
      "evidence": "HF-01, HF-02, HF-06, HF-08, HF-09 exact_quotes contain no license text; HF-07 is the only license quote; root metadata covers GitHub repos only, no HF artifacts.",
      "required_change": "Mark Qwen3 pair, multilingual-e5-small, MiniLM cross-encoder, BGE-M3 licenses and EmbeddingGemma gating as UNVERIFIED pending a per-artifact license receipt (model card license field or LICENSE file, captured like the GitHub receipts), and make that receipt a prerequisite of the AI-4 evaluation rather than of production selection."
    },
    {
      "id": "F4",
      "severity": "medium",
      "section": "Three architecture choices / Retrieval process",
      "claim": "'Its inspected repository license specifies Apache-2.0' for vercel/ai; pgvector is cited three times with no license statement.",
      "why": "The LICENSE file text is correctly quoted (R-10), but the supplied GitHub receipt for vercel/ai returns spdx_id NOASSERTION at the same file sha — GitHub did not classify it as Apache-2.0. That divergence typically signals a monorepo whose consumed npm packages carry their own terms, and the artifact Terroir would actually depend on is a package, not the repo root. pgvector's receipt is also NOASSERTION and the draft states no license for it at all, even though it is the load-bearing storage dependency of the entire semantic-retrieval path. The draft's own rule — 'Released model licenses, runtime code licenses and training-data rights are separate' — is not applied to its two runtime code dependencies.",
      "evidence": "R-10 quote vs root metadata vercel/ai license.spdx_id 'NOASSERTION' and license_receipt sha 6c16c29f; pgvector metadata license.spdx_id 'NOASSERTION', pushed_at 2026-08-20; draft cites pgvector at R-01/R-02 without license.",
      "required_change": "Record the license at the artifact actually consumed (the `ai` and provider npm packages) and note the NOASSERTION classification rather than presenting a single clean Apache-2.0 disposition; add pgvector's license as an explicit line item with the same receipt discipline."
    },
    {
      "id": "F5",
      "severity": "medium",
      "section": "Implementation slices and acceptance",
      "claim": "'Measure work on AI-1 before estimating later slices against calendar capacity', with AI-1 dependent on E-001/E-003/E-005/E-007/E-012/E-013.",
      "why": "AI-1 is nominated as the calibration slice on the grounds that it needs 'No personal history or embeddings' — but it carries the heaviest data-authority prerequisite in the set: exact-unit ledger, placement, custody hierarchy and an all-location projection over the target stock model, none of which exist in the current contract. The draft acknowledges this in one sentence ('AI-1 requires the full placement authority') but does not condition the estimation plan on it. If E-012/E-013 are not admitted, AI-1 cannot be built or measured, and the whole estimation sequence stalls with no named alternative. Lowest-model-complexity is being treated as lowest-total-cost.",
      "evidence": "Repo audit: voice resolver 'deliberately returns locations: [] because authoritative placement has not landed' (src/app/api/cellar/voice-resolve/handler.ts:252); 'There is no explicit lot identity, room/custody hierarchy, or immutable stock event+receipt authority in the current contract'; canonical 'StockCommand/Receipt' listed as a future contract; E-044 deferred 'No S implementation' (scope.csv:45).",
      "required_change": "Condition the sequencing statement: name E-012/E-013 admission as a hard precondition for AI-1, and either designate AI-2 as the calibration slice if placement authority is not admitted first, or state plainly that no AI slice can be estimated against calendar capacity until the ledger/placement contracts land."
    },
    {
      "id": "F6",
      "severity": "low",
      "section": "Verified starting point",
      "claim": "'Search currently returns one representative, recently stocked bin; the voice resolver returns no authoritative placements. The new concierge needs an all-location projection over the target stock model.'",
      "why": "Accurate as far as it goes, but it omits two verified reads that already return every placement over the legacy model — /api/cellar/grid (all placed rows grouped by normalized bin_location) and resolveCellarContext (all distinct legacy locations plus weighted cost). Omitting them overstates the AI-1 build gap and misdirects it: the missing piece is the authoritative lot/custody model, not the multi-location projection shape, which has a working precedent to reuse.",
      "evidence": "Repo audit: 'src/app/api/cellar/grid/route.ts:13 returns every placed inventory row grouped by normalized bin_location'; 'resolveCellarContext already derives all distinct legacy locations and weighted cost (src/domains/wine-profile/resolve-cellar-context.ts:87)'.",
      "required_change": "Cite both reads as existing all-location precedents in the verified starting point, and restate the AI-1 gap as authoritative lot/custody/ledger identity rather than as an absent multi-location projection."
    },
    {
      "id": "F7",
      "severity": "low",
      "section": "Implementation slices and acceptance",
      "claim": "Six slices AI-1 through AI-6 are presented as the plan, with AI-5 carrying E-018/E-047/E-052–E-054 and AI-4 carrying E-024/E-026 publication rights.",
      "why": "Neither motivating question requires public discovery, supplier-offer surfaces or external seller handoff. Those two slices contribute most of the permission and rights surface in the table but are not marked as optional relative to the request. Presented as an ordered list, the set reads as a roadmap and risks being admitted as a bundle — the specific failure the slice structure exists to prevent.",
      "evidence": "Draft slice table AI-4/AI-5 dependency columns; the two stated examples require only cellar lookup and personalized ranking.",
      "required_change": "Label AI-1/AI-2/AI-3 as required for the stated scope and AI-4/AI-5/AI-6 as separately motivated optional expansions, each needing its own justification at admission rather than inheriting approval from the sommelier request."
    }
  ],
  "architectural_position": "Agree with the core architecture and would defend it. The three-way separation of exact lookup (typed SQL/RPC, never from chat memory or a vector), semantic retrieval (text relevance) and taste ranking (wine choice) is correct and is the single most important structural decision here; keeping Postgres as sole authority with typed allowlisted tools, rejecting the autonomous-agent data-access pattern and deferring dedicated memory/recommendation services is well matched to a system with no community-scale feedback. Source/purpose semantics (personal vs house vs business vs gift; rating vs purchase vs inventory as distinct events; explicit budget outranking inferred spend range) are correctly modelled, and the 'last nine' rule — nine eligible deduplicated experiences in the selected context, with the signal mix disclosed — is the right standard. Cold-start via explicit preferences plus labelled contextual fallback is sound. The temporal-eligibility requirement (reconstruct the candidate set, not just the exposure log) is the strongest single element of the design. Content-based first with learned challengers gated on measured evidence, no universal 'best recommender' claim, no benchmark-derived quality assertions, and the explicit coding-subscription vs production-inference cost separation are all correct. Disagreements are with unmade decisions (F1, F2), unreceipted license statements (F3, F4) and sequencing/framing (F5–F7), not with the architecture.",
  "unresolved_unknowns": [
    "Admission status of E-012 (exact-unit ledger) and E-013 (placement) — the packet establishes E-036/E-038/E-044 as deferred but not these, so AI-1 feasibility is UNVERIFIED.",
    "Execution location and data policy for embedding/reranker inference; no provider, hosting or retention receipt is in the packet.",
    "License terms for the five HF artifacts named in F3 and for pgvector and the consumed vercel/ai npm packages; NOASSERTION receipts resolve nothing.",
    "Whether Railway/Supabase deployment can host in-boundary model inference within the approved operating budget — no runtime, memory or cost measurement exists.",
    "Whether legacy restaurant_id maps to the target business/venue model; canonical text states it cannot be promised.",
    "Provider-side retention and deletion behaviour for any conversational or embedding provider — explicitly uncertified.",
    "Whether the existing pricing_recommendations signals (appreciation, pour velocity, margin) are intended to be excluded from personalization features; the draft's paid-placement rule addresses commercial influence generally but never names this store."
  ],
  "agreement_conditions": [
    "F1 resolved: embedding/reranker execution location decided in writing, bulk index-build and re-embedding classified as egress subject to ticket and revocation, private-note embedding blocked absent an approved provider data policy, model hosting cost inside the authorized budget.",
    "F2 resolved: per-store deletion disposition stated for exposure records, feedback events and eligibility snapshots, reflected in the user-facing forget control, and covered by a named AI-2/AI-6 acceptance test.",
    "F3 and F4 resolved: unreceipted license statements marked UNVERIFIED or replaced with per-artifact receipts; vercel/ai NOASSERTION divergence disclosed; pgvector license stated.",
    "F5 resolved: AI-1's ledger/placement precondition made explicit in the estimation plan with a named alternative if unmet.",
    "F6 and F7 resolved: existing all-location reads credited and the AI-1 gap restated; AI-4/AI-5/AI-6 marked as separately motivated optional expansions.",
    "No other section changed. Gate 1, the S manual-receipt evaluation and the deferred status of E-036/E-038/E-044 remain untouched; this audit approves no slice, schema, installation or spend."
  ]
}
```