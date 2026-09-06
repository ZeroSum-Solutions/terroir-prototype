# Final findings ledger

This ledger consolidates all 13 original Fable findings, five Fable v2 residual conditions, and six Gemini findings into 20 root causes while preserving every source ID. “Resolved” below means corrected and verified in the planning source. It never means implemented or tested.

| Root | Provenance | Disposition | Evidence / bounded correction |
|---|---|---|---|
| L01 vertical first write | F1 | **Resolved; Fable v2 verified** | Seven landings; V2 owns candidate lookup, API, receiving UI and persisted cellar. Protocol activation is inside V0 (`03-delivery.md:21-32`). |
| L02 candidate authorization | F2 | **Resolved; Fable v2 verified** | RLS route distinction remedy withdrawn. Direct authenticated writes withheld; narrow validating RPCs, service-role inventory and legacy endpoint negative checks required (`02-architecture-data.md:54-60`). |
| L03 restore boundary | F3 | **Resolved; Fable v2 verified** | Candidate restore is required for S; legacy restore/transformation is F-only (`02-architecture-data.md:46-52,62`). |
| L04 lookup ownership | F4 | **Resolved; Fable v2 verified** | R owns candidate lookup backend/UI; D owns schema; ambiguity tooling deferred (`04-ownership.md:10,18`). |
| L05 human availability | F5 | **Accepted as unverified estimate; Fable v2 verified** | 4–8 owner/Rohan hours are separately itemized and remain assumptions (`03-delivery.md:36-38`). |
| L06 estimate compression | F6 | **Residual resolved objectively; final Fable reread unavailable** | Scope cuts remove behavior. Correct conservative author interval is 34–69 and total is 46.5–88.5, with no positive slack (`03-delivery.md:15,30-36`). See L14. |
| L07 performance acceptance | F7 | **Residual resolved objectively; final Fable reread unavailable** | S keeps bounded target tests and labels them target-only/non-comparable; equivalent legacy baseline is required only before F replacement (`05-ci-tests.md:58`). See L16. |
| L08 claim protocol | F8 | **Resolved; Fable v2 verified** | One controller and a simple persistent claim record; no timed leases or branch stealing (`07-protocol.md:5-11`). |
| L09 CI complexity and 390px defect | F9 | **Planning correction resolved; Fable v2 verified** | Queue/aggregation/sharding/WIP3 are F/optional. The defect is charged to V0 and re-plans if over capacity; the defect itself remains unfixed (`04-ownership.md:16`; `05-ci-tests.md:35`). |
| L10 deferred test scope | F10 | **Resolved; Fable v2 verified** | 57 test rows cover all 35 R outcomes; S rows cover exactly 15 S subsets with explicit slice/owner fields; 20 R outcomes remain deferred. All tests are unexecuted (`05-ci-tests.md:39-41,62`; CSV check). |
| L11 group and cost grants | F11 | **Resolved; Fable v2 verified** | Group is minimal metadata; grants are scoped to business/venue and cost remains a separate capability (`03-delivery.md:11-13`). |
| L12 reviewer inference | F12 | **Withdrawn with evidence by Fable v2** | Review quality was not inferable from triage counts; routing now records evidence limits (`11-model-routing.md:12-25`). |
| L13 F-only complexity | F13 | **Resolved; Fable v2 verified** | CI/operational complexity is marked F/optional while candidate retention/recovery stays an S gate (`05-ci-tests.md:35,60-62`). |
| L14 conservative capacity | FV2-1, G6 | **Resolved objectively; Gemini verified; final Fable reread unavailable** | 34–69 + 10.5–17.5 + up to 2 = 46.5–88.5. The upper envelope exceeds 88 by 0.5; reductions are unmeasured; there is no deadline GO (`03-delivery.md:15,36`). Gemini's 14/21 count is withdrawn; verified split is 15/20. |
| L15 V0 calibration risk | FV2-2, G5 | **Condition specified objectively; Gemini verified; risk remains** | V0 over 8 author hours triggers immediate re-plan; qualification is charged once. This schedules the existing 390px repair but supplies no application acceptance (`03-delivery.md:23,50-58`). |
| L16 S baseline subject | FV2-3 | **Resolved objectively; final Fable reread unavailable** | S uses target-only, non-comparable performance acceptance. Optional comparable characterization is informational; F needs a baseline before replacement (`05-ci-tests.md:58`). |
| L17 model routing evidence | FV2-4, G4 | **Resolved objectively; Gemini verified; final Fable reread unavailable** | V3 application security/revocation routes to Opus 5 high; Luna is explicitly unprobed/optional; Gemini high records CLI selection without backend attestation (`11-model-routing.md:9,14,18-25`). |
| L18 S test ownership | FV2-5, G2 | **Resolved objectively; Gemini verified; final Fable reread unavailable** | `s_owner` separates active S responsibility from artifact lead and UI authorship; active S owners exclude deferred U/P. EV-06/E-031 and EV-12/E-031 are documented F/S sub-evals (`05-ci-tests.md:41`). |
| L19 EV-05 parity | G1 | **Resolved; Gemini verified** | S checks candidate fixtures/replay/parity/backup manifests; legacy transform and row-disposition parity remain F-only (`05-ci-tests.md:41,49`). |
| L20 controller prose | G3 | **Resolved; Gemini verified** | Prose now matches landing ownership: C normally, O for C-authored V1 and Q-authored V0/V4 admissions (`07-protocol.md:7,15-23`). |

## Closure state

All 24 source claims are represented: F1–F13, FV2-1–FV2-5 and G1–G6. Fable's successful v2 review gives conditional agreement and verifies the original corrections, subject to its five residual conditions. Those conditions are satisfied by independent source/CSV/graph checks, but the final Fable reread failed with exit 1 at the subscription limit and is **not** an original-finder closure. Gemini's final closure is valid and hash-matched.

The package is verified as a planning artifact for a Gate 1 decision. Gate 1 and S remain unapproved; F remains a 14-day NO-GO; S remains conditional; no implementation tests ran; the 390px bug remains unfixed.
