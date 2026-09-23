# Opus 5 closure check — Terroir planning documents

**Model:** `claude-opus-5`. No tools used; assessment is from the supplied documents only.

## 1. Readiness verdict

**Ready to continue discovery and run Step 2 baseline reconciliation with these two documents as the working plan.** They are not a build contract, and nothing here establishes live behavior.

Three levels should not be conflated:

- **Proposal quality — strong.** The corrections in §2 of the audit are retractions, not softenings; the inventory-authority section now states the hazard it previously omitted; evidence limits are stated rather than implied.
- **Build readiness — not established, correctly.** Tenancy, offline scope, units algebra, and pilot thresholds are named as decisions with owners and sequence, not resolved. That is the right state for a document whose interview is open.
- **Live verification — none, and the documents say so.** Runtime correctness, production counts, deployment state, POS entitlements, and TypeSafe workload suitability remain unverified. The dated identity counts are labeled historical snapshots.

## 2. B1 / B2 closure

**B1 — closed.** The PRD itself now orders Phase 3 restaurant, Phase 4 collector; PDR-011 no longer recommends deferral; PDR-013 is marked outstanding; §10's preamble limits the freeze to pilot-needed decisions; and the audit carries an explicit supersession record covering PDR-002…PDR-014 and Phase 0–5. The failure mode I described — PDR-011 recorded as "defer" because that was the printed default — can no longer occur.

**B2 — closed at the planning layer, which is the correct closure.** Phase 1 step 3 requires mapping group, stock/legal owner, workspace, site, collection, and membership onto existing restaurant IDs *before* selecting a migration, compares two named approaches, forbids silently widening RLS, and specifies three acceptance cases (site-scoped denial, granted group manager, one linked cross-site transfer with distinct owner and custodian). The decision is bounded and sequenced ahead of schema freeze rather than answered — appropriate, since it depends on owner facts.

## 3. Remaining material defects

Two, both minor and neither blocking:

1. **Q6 does not ask the visibility half of the tenancy question it gates.** It asks site count, scope of 70/35/20, shared stock, and transfer/purchasing workflow — but not whether staff at one site may see another site's stock, cost, and counts, or who legally owns stock at each site. Q9 covers cost visibility generically, not site-scoped. That operational fact is the input to choosing between the two migration approaches.

2. **PDR-013's printed default is wider than the audit's own position.** The PRD proposes "cached lookup and queued service/count capture"; the audit records the count-only default as historical and the requirement as unanswered. Both mark it outstanding, so silent adoption is guarded against — but a recommendation column is where default-by-silence happens.

I found nothing else I would call a defect. Prior M1–M3, M5, M7–M10 are addressed; M6's equivalence is rejected on record, with the write-time producer-repair rejection preserved and any automatic-link policy pushed to a separate decision.

## 4. Three improvements

1. **Split Q6 into tracked sub-items** and add: cross-site read/write visibility for stock, cost, and counts; and the legal stock owner per site. Keep the per-fact answer-status rule already stated in §6.

2. **Promote three operating-contract rules into PRD §8 invariants**, where they survive document drift better than capability prose: one physical unit depletes once regardless of channel; sealed count and open volume never sum without a named conversion; service occurrence is defined independently of payment state. Carry the five acceptance scenarios from audit §8 into the PRD so implementation tickets bind to them via §12.

3. **Restate PDR-013's default** as cached reads only, with queued service writes marked "recommendation pending Q5." This matches the audit and keeps the wider option visible without printing it as the fallback.

**Word count: 613.**
