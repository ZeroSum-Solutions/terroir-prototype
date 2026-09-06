**Note:** per your instruction this is a packet-only review — no tools, files, or skills were invoked (your explicit "no tools" overrides the auto-loaded skill-invocation rule). Nothing ran; nothing changed.

## 1. Findings

**F1 (P1) — The nine PRs are horizontal; the first real user outcome lands at PR6/Day 7.** Evidence: `04-ownership.md` "Planned nine PRs" (PR2 contracts with no consumer; PR3 schema; PR4 adapter; PR5 backend; PR6 UI), `03-delivery.md` Days table. Impact: contract/schema errors surface after three PRs are stacked on them; the Day-3 checkpoint ("first two PRs accepted") proves nothing about the receipt path, which is the whole risk. Fix: restructure to the slices in §2; Day-3 checkpoint becomes "V1 landed: scoped user sees only their cellar against real RLS."

**F2 (P1) — S is ambiguous about whether legacy auth is replaced.** `START-HERE.md` says "replace the ownership, identity, inventory and publication boundaries inside the existing application"; `02-architecture-data.md` says "candidate routes must enforce a server-side supported-command allowlist"; `01-evidence.md` counts 99 auth importers and 164 files touching restaurant scope. If C's 10–14h means migrating `src/lib/api/auth.ts` consumers, it is off by a multiple. Fix (Gate 1 text): S adds `src/contracts` + a new access domain consumed only by new candidate routes under one path prefix; `auth.ts` and legacy routes are untouched; candidate tables carry RLS that legacy roles cannot satisfy, so "blocked legacy writers" becomes a schema property verified by SQL, not a route allowlist that a new route can forget.

**F3 (P1) — The production restore rehearsal is wired as a Day-3 kill switch for a slice that never touches production data.** `02-architecture-data.md`: "S has no legacy backfill requirement"; `START-HERE.md`: "includes no destructive schema removal"; yet `03-delivery.md` Day 3 and `06-capacity.md` fallback make S synthetic-only if a *production* restore has not been attempted. That rehearsal needs owner credentials and production-account operator time that is nowhere in the 88 author-hours. Fix: split it. (a) Production restore rehearsal = precondition for any destructive/cutover work (F/Gate 2 cutover), run by the owner in parallel with no S dependency. (b) S requires backup + restore proof of the **candidate project** only, and only before real pilot identities are admitted at Gate 2 — small, new, cheap; it stays in V4 (§2). (b) cannot be dropped.

**F4 (P1) — Unowned S work: product lookup.** `scope.csv` E-007 is MUST-SHIP S2 with owner U; `04-ownership.md` gives U "no APIs/shared context" and assigns "knowledge/search" to K, deferred. Receiving cannot work without scoped product lookup. Fix: a read-only `lookupProduct` command inside the receiving domain (R), scoped by ScopeContext over existing catalog tables; `src/app/api/search/route.ts` untouched.

**F5 (P1) — Owner/human hours are unmodelled.** Gate 1 items 3–5, `05-ci-tests.md` (protections, Railway routing proof, candidate project provisioning), Gate 2 reviews are owner actions. The 88h budget is author-hours; if T0 is Sept 5, Days 1–11 contain two weekends. Fix: add an owner-hours column per slice (my estimate 4–8h total, front-loaded to Day 1) and make weekend availability an explicit Gate 1 confirmation.

**F6 (P2) — R 4–6h and U 4–6h are the most likely underestimates.** `03-delivery.md` track table vs. `05-ci-tests.md` EV-07/EV-06 asks (real-DB E2E, resumable failure, reversal, four widths, denied-state mobile). My range is 8–12h each. Resulting total (§2) is 58–96h against 88h: the high end does not fit. Fix: record a pre-authorized descope ladder at Gate 1 (§2 last column) so downgrades need no re-approval.

**F7 (P2) — Provisional performance workload is unjustified for a 14-day evaluation.** `05-ci-tests.md`: 10k catalog / 5k lots / 50k events, p95 budgets, ≥200 samples/op, device profile, plus a Day-2 *current-system* baseline "on identical fixture" — the current system has no target schema, so the comparison is not identical, and 50k events is not a manual-receiving evaluation. Keep the correctness parts: 1,000 replay attempts with zero double effects; zero isolation breaches. Drop budgets and device profile; log plain timings; mark "measured workload budgets" NOT APPLICABLE at Gate 2 with reason "evaluation candidate, not stock authority."

**F8 (P2) — The lease/CAS/heartbeat ledger is built for concurrency S does not have.** `07-protocol.md` (60-min leases, 10-min heartbeats, generation CAS, journal recovery) against `04-ownership.md`/`06-capacity.md`: one builder, one Mini, MacBook excluded. Fix: one tracked `docs/rebuild/STATE.md` appended by the non-author integrator at each landing (slice, SHA, evidence paths, findings closure), plus "one active feature branch per lane." Keep non-author steward and finder closure. Reinstate leases only if a second machine is admitted.

**F9 (P2) — CI plumbing inside Q's 8–12h.** `05-ci-tests.md` proposes fail-closed aggregator, draft/retarget triggers, `merge_group`, runner and sharding canaries; PR8 is "evidence tooling." For S: (a) protect the candidate branch with the existing required check and strict up-to-date (settings, not workflow edits); (b) fix the 390px defect only if ≤1h, else disposition as a named F skip; (c) publish the selected-scope E2E list with zero skips. Everything else moves to F.

**F10 (P2) — `tests.csv` gives S slice requirements to DEFERRED outcomes.** EV-03 E-016/E-017 → "S4 S5"; EV-04 E-016/E-018/E-019/E-067 → "S3 S5"; EV-02 E-011 → "S2 S3"; EV-11 E-019/E-067 → "S7". `scope.csv` marks all of these DEFERRED. Gate 2 could read them as S coverage. Fix: blank `slice_requirement` on DEFERRED rows or add an `s_applicability` column; the structural verification in `09-review.md` (57 rows checked) did not catch this.

**F11 (P2) — Group tier in S1 adds RLS paths without an S user.** E-002 "group → business → venue"; two-business synthetic fixture needs no group grants. Fix: `groups` minimal (id, name) with nullable `businesses.group_id` so the hierarchy is additive later; grants only at business/venue in S.

**F12 (P3) — Second-reviewer strength on SQL/RLS slices.** `06-capacity.md` names `gemini-3.8-flash-low`; `09-review.md` triage shows 10 of 15 findings partial/unsupported. For M1/M2/V2a, request a higher Gemini reasoning tier if `agy` lists one (unverified — I make no availability claim); otherwise keep flash-low and record the limitation. Never replace it with a same-vendor model.

**F13 (P3) — WIP=3 thresholds, AWS options B/C, four-shard plans, and the 30-day compatibility windows are F material** and should be labelled so; they lengthen Gate 1 reading without changing the S decision.

## 2. Vertical slices for the smallest safe S

Schema rule: D lands M1 and M2 as small, separately reviewed PRs *immediately before* their first consumer (≤24h gap). Consumers never add migrations; if a consumer needs a column, D lands an additive ≤2h fix PR. No per-feature migration ownership. Contracts (`ScopeContext`, `WineIdentity`, `StockCommand/Receipt`) ship inside M1/M2 as TS types + generated DB types; `CountObservation`, `ConsumptionReconciliation`, `PublicWineView`, `JobEnvelope` are frozen as prose in the protocol draft, not code, until F.

| # | Slice | User outcome | Exit test | Deps | Owner lane / handoff | Author h | Pre-authorized descope |
|---|---|---|---|---|---|---:|---|
| V0 | Rails + characterization (S7, E-031) | None (safety) | Candidate branch protected; Railway proof that candidate merges don't deploy main; read-only canary documenting current manual save→DB path (`scanner.tsx:550`, `api/cellar/route.ts:44`); synthetic project ref recorded | Gate 1 | Q; owner does settings | 4–8 (+owner 2–4) | 390px fix → F skip |
| M1 | Scope schema + ScopeContext (S1) | — | RLS cases: foreign venue/business denied, revoked grant denied, `view_costs` separate; generated types | V0 | D → hands migration file + types to V1 | 4–6 | Group grants → F (F11) |
| V1 | Scoped sign-in + scoped cellar read (E-001/002/003/068, S1, S5-read) | Invited pilot user picks business/venue, sees only that venue's (seeded) cellar; costs hidden without grant; foreign venue 403/404 | EV-01 deny matrix (real SQL + E2E) | M1 | C | 6–10 | Context switcher → one context per invite |
| M2 | Identity + ledger schema + receipt RPC (S2, S4) | — | EV-02/EV-03: `vintage_state` unknown≠NV; single-txn receipt+event+balance; op key bound to payload hash; same key+payload → same receipt; changed payload → fail; concurrent replay once; conservation SQL; reversal | M1 | D → freezes RPC signature + DTOs for V2 | 6–10 | None |
| V2a | Reviewed manual receipt → ledger (E-005/006/007-min/008-manual/012, S2–S4) | Enter receipt (scoped lookup, qty, package, cost/currency, venue), review, confirm; retry does not duplicate; correction via reversal | EV-07 backend half against real DB; 1,000 replay zero double; kill-between-steps leaves zero stock; blocked legacy writer SQL | M2, V1 | R (includes `lookupProduct`, F4) | 8–12 | Ambiguity review → pick-list only; reversal API-only |
| V2b | Cellar/placement view + mobile (E-013/028, S5) | Lot visible in cellar with placement; usable at 390px with denied states; evaluation banner | EV-07 browser half; 320/390 evidence | V2a | U | 6–10 | Bin → venue-level placement; 768/1440 evidence → F |
| V3 | Revoke, export, restart (E-003/030-min/032, S6) | Revoked user denied mid-session; scoped receipts CSV; server/DB failure mid-receipt leaves no partial state | EV-06 subset + EV-03 blocked-writer | V2a | O | 6–10 | Alerts/support console → F |
| V4 | Deploy + evidence + Gate 2 packet (E-031/065/066-min, S7) | Deployed candidate at exact SHA; supervised script runnable | Smoke on real routes/DB; selected suite zero skips; **candidate-project** backup/restore proof (F3b); packet | V3 | Q author, C integrates | 6–10 | None |

Totals: author 46–76h; review/integration 8 PRs × 1.5–2.5h = 12–20h; **58–96h vs. 88h budget**. Feasible at low–mid estimates or with the descope ladder; not at the high end. Day-3 gate = V1 landed; Day-7 gate = V2a passing EV-07 backend; otherwise synthetic demo + NO-GO, as the package already prescribes.

Cannot be dropped: RLS isolation across the two synthetic businesses; grant revocation actually denying; atomic receipt with payload-bound idempotency; legacy writers unable to touch candidate tables; no production data outside the approved boundary; "evaluation, not stock authority" labelling; candidate-project backup/restore before any real pilot identity.

## 3. Routing, qualification, escalation

Subscription lanes only: Claude Code (Max OAuth) with `claude-opus-5` / `claude-sonnet-5` / `claude-fable-5-1`; Codex CLI with `gpt-5.6-sol`; `agy` with `gemini-3.8-flash-low`. Only these IDs have prior probe receipts; each run records the CLI-reported model. No proxies (11455/11456 refused), no direct API, no extra-usage activation. Author vendor determines the reviewer pair per the standing protocol.

| Task class | Author model / effort | Harness | Reviewers |
|---|---|---|---|
| M1, M2, V2a, V3 (SQL, RLS, transactions, failure semantics) | `claude-opus-5` high; `claude-fable-5-1` low replaces it only if the qualification below wins on cost-per-accepted | Claude Code, tools on, cwd = slice worktree only | `gpt-5.6-sol` Codex read-only + Gemini (F12) |
| V1, V2b (TS contracts, routes, UI) | `gpt-5.6-sol` high (UI: medium) | Codex CLI, workspace-write sandbox scoped to worktree | `claude-opus-5` `--tools ""` empty MCP + Gemini plan/sandbox |
| V0, V4 (characterization, evidence scripts, packet) | `claude-sonnet-5` medium | Claude Code | `gpt-5.6-sol` + Gemini |

**Qualification (≤2h, Day 1, scratch directory outside the repo, ephemeral local Postgres, no repo mutation):** one identical spec — "additive migration + plpgsql RPC committing receipt/event/balance in one transaction with an operation key bound to a payload hash; tests for same-key replay, changed-payload conflict, and two concurrent callers" — run once each with Opus 5 high, Fable 5.1 low, Sol high. Score: accepted as-is / accepted after one fix round / rejected; wall time; whatever usage the CLI displays (recorded, not extrapolated). Pick the M2/V2a author by accepted-outcome-first, then time. One sample each: a routing decision, not a benchmark, and never a quota claim.

**Escalation:** bounded fix round fails → same lane, one effort step up (Sonnet→Opus; Opus high→Fable high; Sol high→xhigh). Second failed round → slice returns to planning (protocol rule), no vendor switch mid-slice without re-pairing reviewers. Reviewer quota failure → checkpoint, retry inside the window; if only one independent vendor remains, label it and owner adjudicates.

## 4. Project-prep artifacts (uncommitted, planning directory only)

All under the current package directory, none under `/Users/zero/projects/terroir`; no branch, settings, CI, AGENTS/CLAUDE, skill, or hook changes before Gate 1.

- `10-vertical-slices.md` — §2 table, DAG amendment, descope ladder, owner-hours; supersedes the nine-PR list without deleting it.
- `tests.csv` corrected per F10; `scope.csv` unchanged.
- `drafts/PROJECT-PROTOCOL.md` — canonical protocol (scope/gates, single-writer ownership, DB destination checks, required-check name, vendor pairing, STATE.md rule, landing without deletion, finder closure). Frozen-as-prose contracts for deferred interfaces.
- `drafts/AGENTS.adapter.md`, `drafts/CLAUDE.adapter.md` — thin pointers with protocol version/hash placeholders; staged only.
- `drafts/contracts/{scope-context,wine-identity,stock-command}.ts` — type sketches with invariant comments; no import paths yet.
- `drafts/schema/M1-scope.sql`, `M2-ledger.sql` — unnumbered sketches; D assigns numbers after Gate 1.
- `drafts/fixtures/two-business.spec.md` — synthetic actors/grants/venues, 375/750/1500ml, unknown/NV/year, USD/EUR, replay keys.
- `drafts/tests/deny-matrix.csv`, `receipt-cases.csv`, `selected-e2e-list.md` (zero-skip set).
- `drafts/lanes.md` — §3 table, qualification task + scoring sheet, receipt template (requested/reported model, harness version, session id, packet hash).
- `drafts/STATE.template.md` and `drafts/gate1-decision-record.md` (LA-time T0/deadline fields, weekend confirmation, descope ladder acknowledgement).

Activation boundary: at Gate 1 approval, the first PR on `rebuild/integration` is protocol + adapters + STATE.md (evidence-only, no code); adapters activate only by that reviewed landing.

## 5. Verdict and disagreement

**Feasibility:** S as a vertically-sliced evaluation candidate is a conditional GO, on the same conditions the package states plus F2/F3/F5 resolved at Gate 1. F remains NO-GO for 14 days; I agree. At the package's own author-hour assumption the plan fits only at low–mid estimates; the descope ladder is what makes it credible, not extra agents.

**Where I differ from the package and its reviewers:**
1. Production restore rehearsal must not gate S (F3). The package's coupling came from the reviewer round; I think it imports F risk into S without protecting any S data.
2. Nine horizontal PRs → eight vertical landings (§2). Same traceability, earlier real signal.
3. R/U estimates are low (F6); the package treats them as settled.
4. Performance workload, lease protocol, CI plumbing are unjustified for the 14-day evaluation (F7–F9).
5. Two defects the closed review missed: F4 (unowned lookup) and F10 (tests.csv traceability).

**Uncertainty:** nothing was executed; my effort ranges are judgement, not measurement; the MacBook and owner availability are unknown; Gemini tier availability above flash-low is unverified; I make no comparative speed/quality claim between lanes until the qualification receipts exist. If the owner wants a single number: plan for ~80 author-hours, hold the ladder, and treat Day 3 (V1) and Day 7 (V2a) as the honest go/no-go points.