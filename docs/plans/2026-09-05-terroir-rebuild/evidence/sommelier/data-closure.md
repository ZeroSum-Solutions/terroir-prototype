# Data architecture closure review

**Verdict: REVISE — two material consistency issues remain.** The corrected last-nine grain, per-store erasure/disable semantics, private inference boundary, and common safety gates are otherwise coherent and do not make an unsafe universal guarantee.

## Material issues

1. **AI-2 can be sequenced before the identity authority its records require.** The data contract stores ratings against exact wine/vintage and acquisitions against wine/package (`draft.md:43-44`); the last-nine rule groups by canonical producer/cuvée plus explicit vintage state (`draft.md:58`). Yet AI-2 names only E-001/E-036/E-038 (`draft.md:142`), and the conditional sequence says it may start when those three are ready (`draft.md:150`). Matrix rows AI-F04 and AI-F05 likewise omit E-005/E-007 (`feature-data-matrix.csv:5-6`). This permits a slice to meet its listed prerequisites while lacking the canonical identity/package resolution needed for provenance, deduplication, unknown-versus-NV handling, and stable edition counts. **Bounded fix:** require the applicable E-005 identity/package authority for AI-2 and both matrix rows; require E-007 where the recording flow promises user lookup/selection. Include that dependency in the readiness sentence. The bounded S picklist should count only if it is explicitly shown to satisfy AI-2's later identity contract.

2. **The matrix promises business taste profiles that no admitted slice owns.** The proposed profile authority is explicitly a single-actor personal profile; AI-2 adds no cross-context grants, and business house notes remain under business permissions (`draft.md:41,62,142`). AI-3 depends on that personal foundation (`draft.md:143`). In contrast, AI-F03 includes “authorized business profiles” and AI-F06 includes “business taste profiles” (`feature-data-matrix.csv:4,7`). There is no corresponding business-profile ownership, consent, correction, erasure, or cross-context admission. That wording could authorize personal-profile machinery to consume business evidence despite the separation policy. **Bounded fix:** restrict these two rows to personal profiles plus request-scoped business context, or mark business taste profiles as a separately admitted future contract. Do not broaden AI-2 to close this editorial mismatch.

## Verified closure points

- **Last nine:** the rule has a stable wine-edition grain, deterministic event choice, explicit inclusion/exclusion, identity-resolution behavior, actual signal mix, and separate price sample (`draft.md:17,58`). It does not equate purchases with liking or ratings with price.
- **Erasure and disable:** source deletion, inference forgetting, disablement, full-history erasure, derived stores, exposures, snapshots, transcripts/traces, trained artifacts, late jobs, restores, backups, and provider retention are distinguished (`draft.md:64-74`). Epoch checks and suppression receipts avoid resurrection without claiming immediate backup destruction.
- **Private inference and index jobs:** private embeddings, reranking, extraction, generation, and batch/index work remain disabled until an approved production boundary, capacity, budget, and data policy exist; private records cannot use developer/CI/research hosts (`draft.md:78-82`).
- **Sequence and safety gates:** AI-1 correctly waits for authoritative E-012/E-013 placement; AI-1 and AI-2 may otherwise proceed according to prerequisites. The common suite applies to model and model-free paths, requires reviewed evidence for any N/A, and phrases zero failures as acceptance observations rather than universal guarantees (`draft.md:137-160`; `feature-data-matrix.csv:2-15`).

## Final disposition after targeted correction check

**PASS.** Both material findings above are closed.

- AI-2 now requires E-001/E-005/E-007/E-036/E-038, expressly requires identity/package resolution and lookup to satisfy the slice contract, and repeats the same prerequisites in the conditional readiness rule (`draft.md:142,150`). AI-F04 and AI-F05 now map E-005/E-007 along with their personal-context outcomes (`feature-data-matrix.csv:5-6`). This closes the premature-admission path.
- AI-F03 now permits only request-scoped business context without a business taste profile, while AI-F06 explicitly defers business taste profiles (`feature-data-matrix.csv:4,7`). This matches the single-actor personal profile and no-cross-context AI-2 contract (`draft.md:41,142`) without broadening the slice.

No contradiction or unsafe data promise remains within these two corrected areas. The earlier findings and verified closure points remain the audit record.
