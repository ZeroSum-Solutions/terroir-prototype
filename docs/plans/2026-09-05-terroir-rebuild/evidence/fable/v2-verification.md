# Version 2 independent verification

**Verdict:** the corrected planning package is internally consistent and decision-ready for owner consideration at Gate 1. Full release F remains a 14-day **NO-GO**. Narrowed S is only a conditional forecast: Gate 1 is not approved, the current 390px defect is not fixed, and no implementation or application test was run.

The verified core snapshot is `b01d71871c3207e4685fcaaf7d2c5883f256c0c591599fa295add5934676ae77` (SHA-256 over 14 stable core plan files, filename-delimited). Read-only CSV/graph checks found no structural errors.

Verification used a read-only Python `csv`/`json` assertion pass for scope, test ownership, requirement coverage and DAG acyclicity, plus `shasum -a 256` for all four review packets. No repository command that executes application code was used.

| Check | Result | Resolving evidence |
|---|---|---|
| Scope and tests | **PASS (planning)** | `scope.csv`: 68 unique outcomes, 35 R, 15 MUST-SHIP S subsets, 20 deferred R outcomes. `tests.csv`: 57 rows; its requirement set equals all 35 R outcomes; S rows cover exactly the 15 S outcomes; every S row has an active `s_owner` and implementation slice. All remain `SPECIFIED; NOT EXECUTED`. `05-ci-tests.md:39-41,62`. |
| Data inventory and graph | **PASS (planning)** | `database-dispositions.csv`: 44 rows. `dependency-edges.json`: 15 nodes, 21 edges, acyclic; the S path is G1→V0→M1→V1→M2→V2→V3→V4→G2 (`04-ownership.md:22`). |
| Seven landings | **PASS (planning)** | V0/M1/V1/M2/V2/V3/V4 have exclusive owners and acceptance results. V2 is full-stack lookup→receipt→persisted cellar, not a backend-only first write (`03-delivery.md:21-32`; `04-ownership.md:7-18`). |
| Capacity | **CONDITIONAL** | Author range 34–69, review/integration 10.5–17.5, qualification up to 2: **46.5–88.5 hours**. The high end exceeds the unverified 88-hour assumption by 0.5 hour. The 7–12-hour scope reduction is explicitly estimated, not measured. V0 above 8 hours triggers immediate re-plan; V1 completion triggers a remaining-capacity calculation (`03-delivery.md:15,23-36,50-60`). |
| Authorization boundary | **PASS (contract only)** | The plan correctly states that RLS cannot distinguish routes sharing `authenticated`; direct authenticated candidate-table writes are withheld in favor of narrow actor/scope-validating RPCs. `service_role` bypass and every privileged capability must be enumerated. Candidate credentials cannot enter legacy adapters, and direct RPC/table plus legacy-endpoint negative cases are required (`02-architecture-data.md:54-62`). |
| Lookup ownership | **PASS** | R owns the candidate-only approved-catalog lookup backend and UI; D owns identity/package schema; ambiguity/merge tooling is deferred (`04-ownership.md:10,18`). |
| Recovery and CI scope | **PASS (planning)** | Candidate synthetic restore by Day 3 and candidate restore before Gate 2 remain mandatory for S. Legacy production restore/transformation is F-only (`02-architecture-data.md:46-52`; `03-delivery.md:50-60`). Queue aggregation, sharding and WIP 3 remain F/optional; selected S skips fail rather than receive a waiver (`05-ci-tests.md:35,62`). |

## Review provenance

- Fable's valid v2 review (`fable-v2-receipt.json`, exit 0, packet hash matched) verified F1–F5, F8–F11 and F13, withdrew F12, conditionally agreed with narrowed S, and left five bounded residual conditions. The corrected source now satisfies those five conditions by objective checks permitted by `07-protocol.md:33-35`.
- Fable's requested final reread is **unavailable**, not a closure: `fable-closure-receipt.json` has exit 1 and the response is only a subscription-limit message. No final-finder acknowledgment is claimed.
- Gemini's final original-finder closure is valid (`gemini-closure-receipt.json`, exit 0, packet hash matched). It verified G1–G5 fixed and withdrew its incorrect 14/21 count in G6 after the 15/20 split was checked.

This verifies the planning artifact and its review trail. It does not establish feasibility at measured velocity, application correctness, pilot readiness, or a deadline GO.
