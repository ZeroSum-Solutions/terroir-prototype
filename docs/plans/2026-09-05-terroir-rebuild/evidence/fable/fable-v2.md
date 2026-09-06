**Original-finder verification — Fable 5.1. Packet-only; nothing run, nothing changed. Gate 1/S not approved.**

## Per-finding closure

| ID | Closure | Basis |
|---|---|---|
| F1 | **VERIFIED FIXED** | Seven landings, each schema step immediately consumed; V2 now carries lookup+API+UI as one R landing (`03-delivery.md` table; `04-ownership.md` V2 row). Sol's "backend-only first write" objection was correct and is resolved. |
| F2 | **VERIFIED FIXED; my remedy WITHDRAWN** | I wrote "RLS that legacy roles cannot satisfy" — wrong as stated, since legacy and candidate routes share the authenticated role. The applied fix (withhold direct authenticated DML on candidate tables, narrow actor/scope-validating RPCs, enumerated SECURITY DEFINER/service-role capabilities, test that legacy endpoints leave candidate state unchanged; `02-architecture-data.md` "Candidate authorization") is the correct and stronger form. Legacy auth consumers untouched (`04-ownership.md` last paragraph). |
| F3 | **VERIFIED FIXED** | Candidate synthetic restore by Day 3 + final candidate restore before Gate 2; legacy production restore explicitly F/destructive-only (`02` sequence step 2; `03` re-plan rules). |
| F4 | **VERIFIED FIXED** | E-007 owner R, candidate-only approved-catalog projection; E-013/E-028 "C then R" (`scope.csv`; `04`). |
| F5 | **VERIFIED FIXED (as estimate)** | 4–8 owner/Rohan hours itemized, weekend windows named as a Gate 1 item, labelled unverified (`03` capacity; `START-HERE` item 5). |
| F6 | **PARTIAL — arithmetic, not scope** | See remaining issue 1. Scope reductions are genuine behavior removals, not compression; I accept that. |
| F7 | **PARTIAL — remedy overreach accepted** | Sol is right that E-066 is MUST-SHIP S7, so wholesale N/A was wrong. Reduced budgets (3 staff, 250/1,000/5,000) are proportionate. Residual: see issue 2. |
| F8 | **VERIFIED FIXED** | Simple claim protocol, one controller, no timed leases; reviewers explicitly non-mutating (`07`). |
| F9 | **VERIFIED FIXED** | Queue/aggregator/sharding/WIP3 marked F/optional; 390px charged to V0 with re-plan-not-waive. I accept rejection of my "≤1h else skip" timebox — a time limit is not a scope disposition. |
| F10 | **VERIFIED FIXED** | `s_applicability` + `implementation_slices` columns; ten rows corrected including the EV-04/E-011 row I missed. |
| F11 | **VERIFIED FIXED** | Group kept as minimal metadata; grants at business/venue only; cost capability separate (`CONTRACTS.md` M1). |
| F12 | **WITHDRAWN (inference); intent met** | Inferring a weak reviewer from the 3/10/2 triage split was unsupported. `gemini-3.8-flash-high` is listed in `agy` and routed to complex reviews; its first review receipt should record model echo/limits, as `11` already says. |
| F13 | **VERIFIED FIXED** | F/optional labelling applied; candidate retention kept as an S gate item. |

I also accept Sol's three additions: protocol activation inside V0, V2 merged, V1-by-Day-3 as stretch with "M1 landed, V1 in review" as the base checkpoint.

## Remaining material issues (none P1)

**1. (P2) The narrowed range pairs optimistically.** `03` derives 39–64 author hours from 46–76 minus 7–12 savings. Subtracting a range from a range gives **34–69**, not 39–64; 39–64 assumes small savings coincide with the low estimate and large savings with the high one, which has no basis. Honest totals: 34–69 + 10.5–17.5 + 2 = **46.5–88.5**, whose top touches the 88-hour assumption rather than leaving 4.5h slack. Bounded fix: restate the range as 34–69 / 46.5–88.5 and drop the "4.5 hours slack" sentence; the existing "re-plan after the first two slices calibrate" rule then carries the risk correctly. This does not change the verdict.

**2. (P2) V0 is now the heaviest-loaded small slice.** It carries protocol port + adapter/hash check + both-harness refusal probes + candidate protection/routing proof + receipt-persistence canary + 390px repair, still at 4–8h (`03` table). I would not raise it by assertion, but V0 is the first calibration point: if V0 exceeds 8h, apply the re-plan rule immediately rather than at V1. Qualification (≤2h) is counted once in the total and time-boxed inside V0 — state that explicitly so it isn't double-charged.

**3. (P3) Performance baseline clause has no S subject.** `05` says Q records "the current baseline before replacing a surviving path." S replaces no surviving path (legacy untouched per F2), so for S the baseline is NOT APPLICABLE by the plan's own reason, and all S operations are "target-only, non-comparable." Say so in EV-11 to prevent Gate 2 from expecting a comparison. Keep the reduced budgets, 200-sample capture, 1,000-replay and zero-isolation tests. One recorded device/network profile, not a fleet.

**4. (P3) Routing table hygiene (`11`).** `gpt-5.6-luna` has no probe receipt in the package — mark "unprobed, optional." `gemini-3.8-flash-high` is "listed," not yet exercised for a review — first use is its receipt. Both are already non-authority lanes; no change to verdict.

**5. (P3) tests.csv residue.** EV-04 owner still reads "Q,U,P" though U/P are deferred; EV-06/E-031 is F-only while EV-12/E-031 is S — acceptable (legacy vs candidate restore) but a one-line note in `05` would prevent a Gate 2 reader treating it as a gap.

## Positions

- **Narrowed S conditional: AGREE**, with the range correction in issue 1. It is conditionally credible because (a) every landing ends in a user-observable or executable-contract outcome, (b) the two calibration points (V0, then M1+V1) fall before any transactional work, (c) the safety set that cannot be dropped — cross-business isolation proven by direct RPC/table calls, revocation checked at mutation, payload-bound idempotency, no legacy writer reaching candidate tables, synthetic-only until candidate backup/restore passes, evaluation labelling — survives every proposed descope. Credibility holds only at the corrected 46.5–88.5h against an unconfirmed 88h; the plan's own fallback (labelled synthetic demonstration, no thinner real pilot) is the right failure mode. Not a pilot-readiness claim.
- **F 14-day NO-GO: AGREE.** Nothing in version 2 changes the evidence.
- **Routing (`11`, `QUALIFICATION.md`): AGREE.** Sol high bulk TS/API/UI, Opus 5 high for SQL/RLS/stock under sole schema owner D, Sonnet 5 medium routine, Fable 5.1 high re-plan and low as a qualified challenger; vendor-diverse reviewer pairs preserved. I withdraw my earlier claim that Fable low is the presumptive M2 author; Q-C passing a toy task does not confer schema ownership, as the plan states. Subscription-first, no extra usage, no benchmark claims — consistent with the evidence supplied.
- **Preparation and activation boundary: AGREE.** Prose contracts instead of unnumbered SQL/TS sketches is the safer choice; inactive drafts under `preparation/`, root AGENTS/CLAUDE unchanged, activation only in the reviewed V0 landing after Gate 1.

No unresolved disagreement between my verification and Sol's remains; issue 1 is a correction the author should apply, not a dispute.