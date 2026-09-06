### Consolidated Finding Closures (Original Finder Review)

#### 1. Legacy Migration Parity in Candidate Scope (EV-05) — VERIFIED FIXED
[`tests.csv`](file:///Users/zero/.gemini/antigravity-cli/scratch/tests.csv) and [`05-ci-tests.md`](file:///Users/zero/.gemini/antigravity-cli/scratch/05-ci-tests.md) now explicitly decouple candidate verification from legacy transformation. EV-05 for S is strictly restricted to candidate synthetic fixtures, replay, schema invariants, currency reconciliation, and backup manifests. Legacy transformation and row disposition parity remain strictly deferred to F. S carries zero legacy migration obligations.

#### 2. Inactive Role Leaks and Test Ownership Alignment (EV-03, EV-04, EV-11) — VERIFIED FIXED
In [`tests.csv`](file:///Users/zero/.gemini/antigravity-cli/scratch/tests.csv), EV-04 active S rows are assigned to `owner: "Q,C,R"`, EV-11 to `owner: "Q,O"`, and EV-03 to `owner: "D,R"`. The addition of the explicit `s_owner` column establishes active S accountability without conflating test artifact stewardship with UI authoring. Inactive deferred roles (U, P) are purged from active S eval paths.

#### 3. Integration Controller Authority Alignment — VERIFIED FIXED
Prose in [`07-protocol.md`](file:///Users/zero/.gemini/antigravity-cli/scratch/07-protocol.md) now matches the landing table: *"One integration controller writes it: C normally, O during C-authored V1 and Q-authored V0/V4 admissions."* Write authority, landing locks, and state-file transitions for Q's admissions (V0, V4) are unambiguous.

#### 4. Model Routing for Application Security (Slice V3) — VERIFIED FIXED
[`11-model-routing.md`](file:///Users/zero/.gemini/antigravity-cli/scratch/11-model-routing.md) explicitly routes Slice V3 to `claude-opus-5 / high` for *"SQL, RLS, atomic inventory, recovery and application security/revocation (V3)"*. This closes the routing gap for non-SQL access control while keeping Sonnet Medium barred from auth/security logic.

#### 5. Critical Path Defect Handling (390px Bug) — VERIFIED FIXED
The author correctly rejected waiving or quarantining required CI checks, preserving safety standards. Schedule risk is bounded via an explicit operational checkpoint: Q's repair effort is budgeted inside V0 (4–8h); exceeding 8 author hours immediately triggers a project re-plan rather than silently eroding downstream slices.

#### 6. Capacity Envelope, Calibration Checkpoints, and Outcome Counts — VERIFIED FIXED / WITHDRAWN WITH EVIDENCE
- **Outcome Counts (WITHDRAWN WITH EVIDENCE):** The previous finding miscounted the split as 14/21; verified evidence confirms exactly 15 MUST-SHIP bounded subsets in S and 20 DEFERRED to F across all 35 R outcomes in [`scope.csv`](file:///Users/zero/.gemini/antigravity-cli/scratch/scope.csv).
- **Capacity & Calibration (VERIFIED FIXED):** The Fable conservative range correction (34–69 author + 10.5–17.5 review + 2 qualification = 46.5–88.5h) is adopted in [`START-HERE.md`](file:///Users/zero/.gemini/antigravity-cli/scratch/START-HERE.md) and [`03-delivery.md`](file:///Users/zero/.gemini/antigravity-cli/scratch/03-delivery.md). The plan transparently records a 0.5-hour upper-envelope overrun against the 88-hour baseline and removes any claim of positive slack. The arbitrary 20-hour cumulative threshold is replaced with a formal Day 4 (post-V1) re-calculation of remaining author/review/fix budget against remaining planned capacity.

---

### Final Verdict: AGREE

The revised proposal, target architecture, seven vertical slices, model routing, and inactive preparation artifacts are **DECISION-READY FOR OWNER GATE 1**:

1. **Full Release F (35 R Outcomes):** Confirmed **14-day NO-GO**.
2. **Narrowed S Evaluation:** Validated as a **conditional forecast only**, not an unconditional upper-bound fit. The upper envelope (88.5h) exceeds the 88-hour capacity assumption (11 days × 8h/day, unverified availability) by 0.5 hours.
3. **Execution Gating:** There is no unconditional deadline GO. Early calibration across V0 (max 8h author) and V1 (Day 4 checkpoint) must prove that observed velocity fits the remaining budget before any firm deadline commitment is made.
