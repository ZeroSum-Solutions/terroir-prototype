# Opus 5 adversarial review — Terroir audit and revised planning sequence

Model: `claude-opus-5`. No tools used; reasoning from the supplied packet only.

## 1. Verdict on planning readiness

**Conditionally ready — enough to run the interview and Step 2 now, not enough to freeze Phase 0 defaults or draft the PRD.**

The proposal is a genuine improvement over what it corrects: Section 2 retracts specific overclaims rather than softening them, and Section 3 identifies the real inventory hazard. Two blocking gaps stop it from producing a concrete PRD: (a) it declares the September 20 draft the "single evolving PRD" while contradicting that draft's delivery order and at least two of its recommended defaults, without a supersession record; and (b) it plans multi-site restaurant operations without naming the tenancy unit, which is the input to nearly every other open decision. Both are document-level fixes, not build work.

## 2. Blocking and material findings

### B1 — Two live documents, two incompatible sequences (§4 vs. draft §10–11) — BLOCKING

Draft Phase 3 is a personal-collection vertical slice before Phase 4 restaurant inventory; revised Step 5 is a restaurant pilot before Step 7 collector work. Draft PDR-011 recommends deferring multi-venue "until a real operator supplies requirements"; §1 records multi-location as the launch target. §2 supersedes only "the saved sequence," naming neither PDR-011 nor the phase order.

Failure: the owner signs Phase 0 ("record PDR-002 through PDR-014"), PDR-011 is recorded as "defer" because that is the printed default, and Phase 1 designs schema with no site hierarchy — after which the pilot in Step 5 cannot be scoped.

Correction: add a supersession table to §2 with one row per PDR-002…PDR-014 and per Phase 0–5, marked *stands*, *inverted*, or *held pending Q6*. At minimum: PDR-011 inverted; PDR-013 held; Phase 3/Phase 4 order inverted.

### B2 — "Site" is undefined against existing RLS (§3, §4 Step 3) — BLOCKING

ARCHITECTURE.md states bins, cellar-health, reconciliation history, close-outs, stock adjustments, brand kits, and pricing recommendations are **restaurant-scoped and protected by RLS**. The draft proposes *workspaces* with named *collections* (PDR-002). The revised plan adds *group* and *site*. Nothing maps these four containers onto each other.

Failure, either direction: if a site becomes one restaurant row (the cheapest fit for existing RLS), a transfer between sites cannot be one audited event, because no existing reader crosses restaurant scope — the group gets two unlinked adjustments and no accountable owner in transit, which is exactly what §3 forbids. If sites become collections inside one restaurant row, RLS keyed on restaurant_id grants every server read and write access to every other site's stock and cost data.

Correction: Step 3 must fix the tenancy unit before any permission work, with two written cases: cross-site read denied for a site-scoped role, and one transfer visible to both sites with a single owner. Q6 must ask this explicitly (see §6).

### M1 — Channel-level depletion authority does not cover one bottle consumed two ways (§3)

"Select one authority per channel" partitions *events*, but sites share *lots*. Concrete: last bottle of a wine; the guest orders it as a bottle on the POS (POS-derived channel); the sommelier instead opens it and pours four glasses for two tables (staff-recorded channel). Both authorities fire on the same physical unit; the wine goes to −1.

Correction: bind authority to the lot at open time — a claim/reservation on the unit, where the second channel's event corroborates rather than depletes — and require Step 3 to contain this exact example with one stock outcome.

### M2 — "Fulfilled" is undefined, and comps under-deplete (§3)

§3 depletes from "mapped fulfilled service lines" and correctly says a comp changes money, not wine. But if fulfilment is read from payment or check close, a comped bottle produces no depletion at all. A reopened-and-re-edited check can produce a second.

Correction: define fulfilment on the service event, not payment state, and enumerate physical outcomes for void-before-service, void-after-service, comp, discount, split, transfer, reopen, and refund in one table.

### M3 — Quantity units are not an algebra (§4 Step 3; draft PDR-003/PDR-008)

§3 names five stock meanings; `src/lib/partial-bottles` already computes close-out yields. Step 3's exit condition ("one unambiguous stock outcome") is unreachable without a canonical unit. Failure: a 150 mL pour from 750 mL with waste is reported by one screen as 0.8 bottles and by another as 570 mL open plus 0 sealed; stocktake counts sealed bottles only, so group-level variance never reconciles and the Step 5 gate cannot be judged.

Correction: one stored unit per state, plus an explicit non-additivity rule — sealed count and open volume never combine into a single "on hand" figure without a named conversion recorded with the number.

### M4 — Offline recommendation is broader than the draft's own risk position, and lands on a non-transactional apply (§6 Q5; draft PDR-013)

Q5 recommends queued *service entries*; PDR-013 restricts offline writes to stocktake capture "only after conflict behavior is specified." Offline depletion is the higher-risk write, and the revised plan silently widens it. Worse, ARCHITECTURE.md says reconcile-ledger accept/undo is **not one transaction** and uses explicit compensation on partial failure. Failure: a device replays a queued apply after compensation ran; the ledger holds both compensated and reapplied rows, and the variance report is fiction.

Correction: keep PDR-013's narrower default as the recommendation; gate any offline write on an idempotency key plus a passing replay-after-partial-failure test.

### M5 — Collector-shaped defaults are scheduled to freeze before collector design (draft §10–11 vs. §4 Step 7)

PDR-004 (note visibility), PDR-005 (rating scale), PDR-006 (price types), PDR-007 (retention), PDR-009 (sharing) are collector decisions due in Phase 0 and encoded in Phase 1–2 migrations, while the collector experience isn't specified until Step 7. Failure: defaults become the product by default, with no collector use case to test them, which is the premature building the audit is trying to avoid.

Correction: mark those five "decide at Step 7 unless the restaurant pilot requires them," and remove them from the Phase-0 freeze list.

### M6 — Step 6 re-opens a recorded rejection (§5)

"Candidate matching" is the 321-unresolved-producer problem. AGENTS.md records that write-time recovery via `src/lib/wine-intelligence/producer-from-name.ts` was **deliberately rejected**, with the reasons stored in `src/domains/import/producer-acknowledgement.ts`, and that "a wrong producer is worse than a missing one." Failure: a TypeSafe matcher is evaluated and adopted on a task whose autonomous form was already refused, and the refusal is discovered after the fact.

Correction: Step 6 must cite that rejection and either accept it (suggest-only, human-confirmed, reversible) or explicitly reverse it with reasons.

### M7 — No usable evaluation corpus is identified (§5)

The two named local datasets are a 1,277-row blank-producer defect set and a 250-wine demo set. Neither is representative. Failure: Step 6 reports a large win on degenerate data.

Correction: name the corpus and its provenance, or mark Step 6 blocked on authorized pilot data; synthetic fixtures may still run for mechanics.

### M8 — Staff-attributed data has no privacy question (§6)

`src/lib/member-analytics` produces member-attributed operational metrics, and pour records name the pourer. Q13 covers AI privacy only. Failure: individual variance metrics are used for discipline with no retention, access, or notice decision.

Correction: add a sub-question on who may view individual staff metrics, retention, and whether they may be used for performance management.

### M9 — Success gates have no tolerance and no stop conditions (§4)

"Counts reconcile" is unmeasurable; Steps 1–8 have exit conditions but no abandon triggers. Failure: pilot ends at 3% variance and success is litigated afterward.

Correction: define the variance metric (unit, scope, period), a threshold, a named judge, and one descope trigger per step.

### M10 — The 15-question cap is nominal (§6)

Q11 carries six asks, Q12 five, Q6 three. Failure: the first clause of each is answered, the remainder is recorded as answered, and the PRD freezes on silence. Correction: sub-number every clause; require an explicit "not answered" marker per sub-item. Q1's open success-metric half should be visibly folded into Q7 as a labeled sub-item.

## 3. Claims I cannot substantiate from this packet

Owner quotations (only the proposal's rendering is supplied); the `git ls-remote` SHAs and that the docs branch is unpublished; that the first reviewer's model ID was `claude-opus-5`; the contents of `pour-service.ts`, `app_spec.txt`, or `docs/feature-ledger.json` (referenced, not supplied); the truncated AGENTS.md sentence about `apply_import_batch_chunk`; whether the 2026-08-29/30 counts still hold; TypeSafe's existence, capabilities, pricing, or latency; POS entitlements, merchant contracts, deployment state, market position, and any owner approval.

## 4. What is already sound

Rejecting the 95% precision gate and reframing it as false acceptance by consequence. Naming selection bias in correction-derived eval sets, with train/held-out separation and tenant/source leakage as distinct hazards. Stating TypeSafe cannot taste wine or establish TCA from text. Treating imported content as data with code — not model screens — enforcing tenant access and write validation. Refusing both absolutes ("AI never writes," "every action needs approval"). Distinguishing pseudonymization from anonymity and declining to treat ZDR as approved. Stock as several non-interchangeable states; refund ≠ restock; stocktake cutoff versioning; estimated open volume never labeled measured. Declining to make new tables a prerequisite for learning. Keeping credentials out of reviewer packets, and separating auth-blocked live trials from requirement discovery. The shipped / present-but-unverified / missing / proposed / external labels are the right instrument for Step 2.

## 5. Five strongest acceptance scenarios for the PRD

1. **Last bottle, two channels.** POS bottle sale and four staff pours describe one unit; stock ends at zero, both events are retained, and the corroborating event never depletes.
2. **Cross-site transfer with discrepancy.** Dispatch 6, receive 5; one accountable owner throughout, both sites see one event, and a site-scoped role at the third site is denied the read.
3. **Offline stocktake replay.** A queued apply is replayed after a partially-failed compensating apply; the idempotency key collapses it, and the variance report is unchanged.
4. **Real producer-less vendor export.** Import proceeds only with the acknowledged count, a suggested producer match is wrong, and refusal plus reversal leave an audit trail with the row still blank.
5. **Money-only changes.** Comp, reopen, and post-service edit alter revenue; physical stock is unchanged, and the sequence is replayable out of order.

## 6. Highest-value next owner question

Reframe **Q6**, not Q5 — Q5 can be closed by adopting PDR-013's narrower default. Ask:

> How many locations are in the pilot, do the 70/35/20 figures describe each site or the group, does physical stock move between sites, and should staff at one site see another site's stock, costs, and counts?

This fixes the tenancy unit (B2), which gates permissions, transfers, stocktake cutoffs, group reporting, and the offline scope. Every other open decision is cheaper to answer once it is settled.
