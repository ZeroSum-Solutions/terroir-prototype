### Independent Review: Terroir Rebuild Plan (Version 2)

**Reviewer Stance:** Independent Gemini Reviewer (Gemini High).  
**Basis:** Static packet evaluation against repository main (`abdc661abde43b0ac70a81f740b61d21da7e414b`). No tools, web, or external agents were executed.  
**Gate 1 Recommendation:** **NO** on the current text; **IMMEDIATELY UNBLOCKABLE (YES)** upon owner ratification of the bounded corrections below.

---

### 1. Traceability & Scope Boundary Audit

- **Outcome Traceability:** Full traceability is preserved across all 68 product outcomes in [`scope.csv`](file:///Users/zero/.gemini/antigravity-cli/scratch/scope.csv).
- **Core 35 R Requirements:** All 35 R requirements are strictly accounted for:
  - **14 MUST-SHIP bounded subsets in S:** E-001, E-002, E-003, E-005, E-007, E-008, E-012, E-013, E-028, E-030, E-031, E-032, E-065, E-066, E-068.
  - **21 DEFERRED to F:** E-006, E-009, E-010, E-011, E-014, E-015, E-016, E-017, E-018, E-019, E-020, E-021, E-022, E-023, E-024, E-025, E-026, E-027, E-029, E-067.
- **Release Boundaries:** S is strictly scoped to supervised receiving and cellar viewing for one invited pilot venue with synthetic cross-business isolation fixtures. It does not assume restaurant operational stock authority, does not migrate legacy production, and does not claim full release.

---

### 2. Numbered Findings & Bounded Corrections

#### Finding 1: Legacy Migration Parity Conflicted into S Scope
- **Severity:** P1 (Matrix & Scope Contradiction)
- **Exact Location:** [`tests.csv`](file:///Users/zero/.gemini/antigravity-cli/scratch/tests.csv) (EV-05 rows for E-031, E-032) vs. [`02-architecture-data.md`](file:///Users/zero/.gemini/antigravity-cli/scratch/02-architecture-data.md) ("Retention and transformation proposal") & [`03-delivery.md`](file:///Users/zero/.gemini/antigravity-cli/scratch/03-delivery.md).
- **Why:** EV-05 defines row disposition totals, field hashes, foreign key checks, and transformation parity as `S bounded acceptance` across slices `M1, M2, V4`. However, `02-architecture-data.md` explicitly specifies: *"S has no legacy backfill requirement: synthetic candidate plus explicitly created pilot intake records. Full production transformation is deferred until F."* Imposing EV-05 on S introduces an unbudgeted, contradictory legacy data migration gate into candidate landings.
- **Bounded Correction:** In [`tests.csv`](file:///Users/zero/.gemini/antigravity-cli/scratch/tests.csv), mark EV-05 rows as `F only; not S acceptance`, and restrict V4 candidate data checks strictly to synthetic candidate fixture validation.

#### Finding 2: Inactive Roles and Invalid Schema Separation in Test Ownership
- **Severity:** P1 (Ownership & Matrix Conflict)
- **Exact Location:** [`tests.csv`](file:///Users/zero/.gemini/antigravity-cli/scratch/tests.csv) (EV-04 rows for E-007, E-008, E-013, E-028; EV-03 rows for E-012, E-013) vs. [`04-ownership.md`](file:///Users/zero/.gemini/antigravity-cli/scratch/04-ownership.md).
- **Why:** 
  1. EV-04 assigns test ownership to `"Q,U,P"` for active S slices `V0, V1, V2`. In [`04-ownership.md`](file:///Users/zero/.gemini/antigravity-cli/scratch/04-ownership.md), U and P are explicitly unassigned future tracks excluded from S. Slices V0, V1, and V2 are authored by Q, C, and R.
  2. EV-03 assigns test ownership solely to D across implementation slices `M2, V2`. D is the schema authority and is prohibited from authoring application/UI code in V2 (owned by R).
- **Bounded Correction:** In [`tests.csv`](file:///Users/zero/.gemini/antigravity-cli/scratch/tests.csv), update EV-04 ownership for S rows to `"Q,C,R"`. Update EV-03 ownership to `"D,R"` to reflect the schema-contract and consumer split.

#### Finding 3: Internal Contradiction in Integration Controller Authority
- **Severity:** P2 (Protocol Governance Conflict)
- **Exact Location:** [`07-protocol.md`](file:///Users/zero/.gemini/antigravity-cli/scratch/07-protocol.md) ("One builder and one claim record" vs. "Author, findings steward and landing roles" table).
- **Why:** The protocol prose states: *"One integration controller writes it: C normally, O during C-authored admissions."* However, the landing table assigns controller authority for V0 and V4 (both authored by Q) to O instead of C. This creates ambiguity over who holds the lock and write authority for state file updates on Q-authored landings.
- **Bounded Correction:** Reconcile [`07-protocol.md`](file:///Users/zero/.gemini/antigravity-cli/scratch/07-protocol.md) prose to state: *"C normally controls landings; O acts as controller for C-authored (V1) and Q-authored (V0, V4) admissions."*

#### Finding 4: Model Routing Gap for Auth/Security Slices
- **Severity:** P2 (Routing Policy Ambiguity)
- **Exact Location:** [`11-model-routing.md`](file:///Users/zero/.gemini/antigravity-cli/scratch/11-model-routing.md) ("Model routing by accepted task") vs. [`04-ownership.md`](file:///Users/zero/.gemini/antigravity-cli/scratch/04-ownership.md) (Slice V3 / O).
- **Why:** Slice V3 covers operational access revocation, permission checks, and scoped data export. [`04-ownership.md`](file:///Users/zero/.gemini/antigravity-cli/scratch/04-ownership.md) assigns V3 to Claude. Under [`11-model-routing.md`](file:///Users/zero/.gemini/antigravity-cli/scratch/11-model-routing.md), Sonnet Medium is explicitly prohibited from auth/security work (*"No auth/stock/security work sent here by default"*), while Opus High is narrowly scoped to *"SQL, RLS, atomic inventory, recovery semantics"* (and V3 contains no SQL). The plan lacks an authorized Claude lane for application-level auth/security tasks.
- **Bounded Correction:** Clarify in [`11-model-routing.md`](file:///Users/zero/.gemini/antigravity-cli/scratch/11-model-routing.md) that `claude-opus-5 / high` authors Slice V3 application-level security and revocation logic.

#### Finding 5: Out-of-Scope Legacy Defect on the Critical Path
- **Severity:** P2 (Safety & Schedule Decoupling)
- **Exact Location:** [`03-delivery.md`](file:///Users/zero/.gemini/antigravity-cli/scratch/03-delivery.md) (V0 table row) & [`04-ownership.md`](file:///Users/zero/.gemini/antigravity-cli/scratch/04-ownership.md) (V0 / Q exception).
- **Why:** V0 is budgeted 4–8 hours for core rails, protocol activation, and test harnesses, but is also assigned to fix a legacy 390px layout defect in `src/app/(app)/insights/date-range-selector.tsx`. Insights belongs to deferred reporting (E-004, E-019, E-067). Coupling a legacy reporting UI bug to the V0 rails landing risks stalling the Day 1–3 candidate setup and M1 schema delivery.
- **Bounded Correction:** Cap Q's V0 time-box for the 390px repair at 1.5 hours. If unresolved, quarantine the failing legacy insights test on the candidate integration branch with a recorded exemption, ensuring candidate rails and S critical path proceed unblocked.

#### Finding 6: Schedule Arithmetic vs. Operational Slack Forecast
- **Severity:** P2 (Uncertain Forecast vs. Math Error)
- **Exact Location:** [`03-delivery.md`](file:///Users/zero/.gemini/antigravity-cli/scratch/03-delivery.md) ("Capacity and cost arithmetic").
- **Why:** 
  - *Math Verification:* The arithmetic is correct: 39–64 author hours + 10.5–17.5 review/integration hours + 2 qualification hours = 51.5–83.5 total hours. Against the 88-hour capacity (11 days × 8 hours), upper-bound slack is 4.5 hours. The 3-day buffer represents 21.4% (satisfying the ≥20% requirement). CI calculations (125.5 + 354.3 = 479.8 runner-minutes) are mathematically consistent.
  - *Forecast Sensitivity:* A 4.5-hour operational slack across 7 sequential landings yields ~38 minutes per landing for dual independent review (Sol/Claude + Gemini High) and non-author fix rounds. If any landing requires a non-trivial fix round, the planned 11-day window will be exceeded, immediately dipping into the Day 12–14 buffer.
- **Bounded Correction:** Classify the 4.5-hour slack as an operational risk. Mandate a formal capacity checkpoint at Day 4 (post-V1). If cumulative author and review effort exceeds 20 hours, trigger a mandatory scope re-assessment.

---

### 3. Decision-Ready Gate 1 Verdict

**VERDICT: NO (Pending Bounded Corrections)**

**Action to Authorize Gate 1:** The project owner should approve Gate 1 conditionally, effective immediately upon incorporating the five bounded corrections into [`tests.csv`](file:///Users/zero/.gemini/antigravity-cli/scratch/tests.csv), [`07-protocol.md`](file:///Users/zero/.gemini/antigravity-cli/scratch/07-protocol.md), [`11-model-routing.md`](file:///Users/zero/.gemini/antigravity-cli/scratch/11-model-routing.md), and [`03-delivery.md`](file:///Users/zero/.gemini/antigravity-cli/scratch/03-delivery.md). S is structurally sound, rigorously scoped, and ready for Day 1 activation once these matrix and protocol alignments are committed.
