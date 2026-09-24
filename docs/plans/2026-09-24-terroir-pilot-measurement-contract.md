# Terroir pilot measurement contract

Date: 2026-09-24
Status: v6 summary-only projection correction pending independent review; no runtime completion claim
Source anchor: `10537217bd96929af8ec45f6a5704c3ce056b324`.

## 1. Decision

C14 has two separate engineering layers:

1. A small pure calculation/export contract consumes typed supplied evidence. It
   computes Q7 aggregates, preserves failures in denominators, applies privacy rules,
   and renders CSV. It does not establish authorization, trusted time, phase, or real
   provenance.
2. A later runtime evidence validator will derive authorization, provenance, phase,
   window eligibility, and clock status from server-held activation data plus captured
   evidence. Its output becomes supplied evidence for the pure calculator.

The first implementation leaf covers only layer 1. This separation prevents a pure
function from treating a client claim or test fixture as proof of real pilot evidence.

C14 itself is a software-capability criterion: tested capture and baseline export may
eventually satisfy it without claiming that the real pilot met Q7. A real same-venue
baseline and full four-week pilot remain external validation. A provisional export is
useful before that validation exists.

## 2. Preserved Q7 measurement boundaries

### Lookup

The primary lookup interval starts when a trained participant accepts an assigned,
preregistered task, before search, scan, or browse interaction. It ends when the app
displays the correct wine's availability and placement. The assigned-mode mix remains
fixed for the window. The calculator retains private mode results and reports only the
combined full-cohort summary in this CSV.

Requiring placement as well as availability is a conservative engineering boundary.
Q7 does not name the end interaction. This choice can cause a false failure, not a
false pass, and is not a claim about the real pilot. Search-submit to result-selection
may exist as a private child diagnostic but never substitutes for the Q7 lookup
interval.
Physical travel to or retrieval of a bottle is excluded.

### Standard pour

The pour interval starts after the UI accepts the wine selection and presents the
venue's versioned standard-pour action. It ends at the first durable accepted capture:

- online, the server acknowledges the committed idempotent operation;
- offline, the device durably stores the pending operation and acknowledges it to the
  user.

Offline synchronization is outside the interval. Finding and physically pouring the
wine are also excluded. The venue defines the standard amount; this contract invents
no pour size.

### Count and reconciliation

Count effort is summed active staff labor for the same preregistered venue, scope,
item denominator, inventory cutoff rule, and reconciliation definition. Two workers
active for ten minutes contribute twenty staff-minutes. Count wall-clock span, API
latency, batch counts, and server receipt latency are not labor.

All labor attributable to the comparison unit and phase is included, including failed
attempts, abandoned attempts, reconciliation, and corrections recorded after an
apparent workflow completion but before the evidence cutoff. A completion event is a
workflow milestone, not the labor cutoff.

## 3. Pure supplied-evidence contract

The pure leaf accepts an immutable `SuppliedEvidenceBundle`. The name is deliberate:
shape validation is not proof that evidence came from an authorized server path.

The bundle contains:

- report identity, contract version, activation version, the full activated venue-set
  fingerprint, explicit baseline/pilot windows, and evidence cutoff;
- one evidence origin: `synthetic-fixture` or `runtime-validated-real`;
- lookup assignment roster entries and their attempt histories;
- pour intent/attempt histories and external inventory-operation receipts;
- count comparison units, attempts, labor segments, roster metadata, and correction
  segments through the evidence cutoff;
- runtime validation snapshots for real observations, including authorization,
  phase, window, duration, context, and clock disposition; and
- declared session totals, known health gaps, and coverage status.

The pure leaf must validate both closed vocabularies before arithmetic or export. An
unknown terminal outcome or runtime rejection token rejects the whole bundle; it never
falls through to `incomplete`, another known disposition, or a generic failure. The
leaf also checks internal consistency, integer arithmetic, deduplication, and
referential integrity. It must not issue a runtime validation receipt, convert
synthetic evidence to real, infer a phase from client timestamps, or claim server
authorization. A future production caller may construct
`runtime-validated-real` input only from server-held validation receipts. Tests use
synthetic fixtures and make that origin visible in every result.

### Closed dispositions

The calculator recognizes these terminal measurement outcomes where applicable:

- `succeeded`
- `no-result`
- `incorrect-selection`
- `mode-mismatched`
- `denied`
- `abandoned`
- `interrupted`
- `storage-failed`
- `conflicted`
- `incomplete`
- `unaccepted`
- `unverifiable-clock`
- `context-expired`
- `context-not-yet-valid`
- `context-version-mismatched`
- `context-improperly-reissued`
- `replay-too-late`
- `invalid-provenance`
- `cross-window`

Only `succeeded` may enter a success numerator. Every assigned lookup task or captured
pour attempt remains represented even when its terminal outcome is a failure. Lookup
and pour retry attempts follow the metric-specific denominator rules below. An
unusable count segment makes its comparison unit non-evaluable; it is never dropped to
improve the result. `Mode-mismatched` and `unaccepted` are lookup-only outcomes.

Runtime rejection reasons and pure dispositions are separate closed vocabularies. The
runtime validator maps every rejection exactly once:

| Runtime rejection reason | Pure calculation disposition |
|---|---|
| `authorization-denied`, `authorization-revoked` | `denied` |
| `context-not-yet-valid` | `context-not-yet-valid` |
| `context-expired` | `context-expired` |
| `context-version-mismatched` | `context-version-mismatched` |
| `context-improperly-reissued` | `context-improperly-reissued` |
| `clock-divergence`, `impossible-server-receipt-order` | `unverifiable-clock` |
| `replay-too-late` | `replay-too-late` |
| `open-interval-lost` | `interrupted` |
| `cross-window-capture` | `cross-window` |
| `synthetic-on-live-path`, `client-asserted-provenance` | `invalid-provenance` |
| `immutable-identity-conflict` | `conflicted` |

No runtime rejection may fall through to `incomplete` or a generic error. `Incomplete`
is reserved for a captured task whose required terminal evidence is absent at the
evidence cutoff. `Unaccepted` is reserved for a preregistered lookup assignment with
no accepted attempt at that cutoff. An open interval whose clock origin is lost always
maps to `interrupted`.

## 4. Intent, attempt, and operation identity

Three identities have different jobs:

- **Intent ID:** one logical staff goal, such as recording one selected pour. The
  intent owns at most one inventory operation ID.
- **Attempt ID:** one deliberate try to complete or receive acknowledgement for that
  intent. Every new deliberate retry gets a new attempt ID. Lookup/pour retries add a
  rate-denominator entry; count retries add their labor rather than a rate entry.
- **Operation ID:** the idempotency identity for the inventory mutation. Attempts for
  one intent may reuse it. Two different intents may not.

The invariants are:

1. Exact redelivery of one attempt is idempotent and adds no denominator entry.
2. Conflicting payload under an existing attempt ID is rejected; the original history
   remains.
3. A terminal failed attempt does not erase or release history. A deliberate retry of
   the same intent uses a new attempt ID and may reuse that intent's operation ID. Its
   failure and later retry both remain measurable under the task's denominator/labor
   rule.
4. A successful inventory operation commits at most once even when several attempts
   seek acknowledgement.
5. Two intent IDs bound to one operation ID conflict. The conflict remains in history;
   no binding is deleted to make a retry pass.
6. Measurement code reads operation receipts but never writes inventory.
7. A successfully acknowledged attempt closes the intent for rate measurement. A later
   delivery is either replay of an existing attempt or a distinct new intent; it cannot
   mint extra successes under the closed intent.

### Worked identity sequences

`Denominator` below means captured pour attempts. `Inventory commits` is supplied by
the inventory receipt, not caused by measurement.

| Sequence | Events | Denominator | Inventory commits | Required result |
|---|---|---:|---:|---|
| Exact redelivery | `I1/A1/O1` succeeds, then the same `A1` is delivered again | 1 | 1 | Return the existing attempt and receipt |
| Local failure then retry | `I1/A1/O1` ends `storage-failed`; the user deliberately retries as `A2/O1`, which succeeds | 2 | 1 | Preserve both attempts; success never replaces failure |
| Acknowledgement lost | `I1/A1/O1` commits inventory, response is lost, then `A1` replays | 1 | 1 | Replay is idempotent |
| User retries after lost acknowledgement | `I1/A1/O1` committed but appeared failed; user creates `A2/O1` and receives the existing receipt | 2 | 1 | Both deliberate attempts count; inventory stays single |
| Retry after acknowledged success | `I1/A1/O1` succeeds and is acknowledged; user creates `A2/O1` | 2 | 1 | `A2` is conflicted and cannot add another success |
| Conflicting attempt payload | `I1/A1/O1` succeeds; `A1` is redelivered with changed immutable data | 1 | 1 | Reject the changed copy; retain original state |
| Operation reused by another intent | `I1/A1/O1` succeeds and commits; `I2/A2/O1` arrives | 2 | 1 | Record `A2` as conflicted; never merge `I2` into `I1` |
| New independent pour | `I1/A1/O1` and `I2/A2/O2` both succeed | 2 | 2 | Two intents, attempts, and operations remain distinct |

## 5. Interval and labor evidence

### Closed intervals survive reload

Each interval records an opaque clock-origin ID plus nonnegative integer start/end
microseconds. Start and end must share one origin and `end >= start`.

- A closed interval that durably persisted both boundaries before reload keeps its
  duration after reload and replay.
- An open interval that loses its origin on reload has no usable duration. A later
  boundary from a new origin cannot close it. The runtime reason is
  `open-interval-lost`, the pure disposition is always `interrupted`, and a deliberate
  retry uses a new attempt ID.
- Wall-clock values never compute duration.

The same-origin rule applies within one interval or count segment. It does not require
different segments to share an origin. Closed segments from different workers,
devices, or origins may be summed after each segment passes runtime validation.

### Count segment rules

- Start, pause, resume, handoff, completion, and correction create segment boundaries.
- Pause closes the current segment. Resume opens a new one.
- Handoff closes the outgoing worker's segment. The receiving worker opens a separate
  segment, possibly under another origin.
- Simultaneous segments from different workers are additive.
- Overlapping segments for the same worker in one comparison unit are invalid.
- The evidence cutoff is fixed before export. Every attributable segment ending by the
  cutoff is included, even if it follows a completion event.
- A correction discovered after a frozen export creates an append-only amended bundle
  and recomputed report. It does not rewrite the old evidence silently.

### Worked interval sequences

| Sequence | Evidence | Duration/labor result |
|---|---|---|
| Closed then reload | `origin-a: 1000..4000` is durably stored; app reloads; record replays | Usable 3000 microseconds, subject to runtime clock/window disposition |
| Open across reload | Start `origin-a: 1000`; reload; end arrives on `origin-b` | No duration; attempt remains in denominator as `interrupted` |
| Two-worker handoff | Worker 1 closes 10 minutes on origin A; worker 2 closes 8 minutes on origin B | Sum 18 staff-minutes |
| Parallel workers | Two workers each close 10 minutes over the same wall-clock span | Sum 20 staff-minutes |
| Post-completion correction | 40 minutes before completion plus 5 minutes of attributable correction before cutoff | Sum 45 staff-minutes |
| Same-worker overlap | One worker has overlapping closed segments in the same unit | Unit is non-evaluable; neither segment is silently removed |

## 6. Metric arithmetic

### Lookup target

Each trained-cohort lookup assignment due in the activated window contributes at least
one denominator unit. If it has no attempt, one roster-derived `unaccepted` failure
represents it. If it has attempts, every deliberate attempt is a denominator
unit and the roster-only placeholder disappears. The numerator contains successful
attempts in the assigned mode within 10,000,000 usable microseconds.

```text
100 * successful_attempts >= 90 * denominator_units
```

The canonical lookup metric record exposes one full-cohort summary. It reports the
frozen combined-mix numerator, denominator, 10-second threshold arithmetic, generic
failure count, qualification, and Q7 verdict. The generic failure count is exactly
`denominator - numerator`; it is a full-cohort aggregate with no identity, mode,
terminal-outcome, or timing-miss label. A rare failure or mode category does not
suppress this summary when the preregistered trained cohort passes its contributor
gate.

Assigned-mode summaries, roster coverage counters, the closed outcome-count map,
threshold-miss partitions, and quality totals remain inside the authorized private
evidence boundary and never enter this CSV. Untrained and unknown-cohort assignments
remain in those private quality totals but not the trained Q7 cohort. An attempt
accepted inside the window but completed after its close is `cross-window`, remains in
the denominator, and cannot enter the numerator.

### Pour target

The denominator is every captured standard-pour attempt after wine selection,
including retry, denial, conflict, interruption, storage failure, context expiry,
clock unverifiability, and incomplete outcomes. The numerator contains attempts with a
usable duration at or below 3,000,000 microseconds and a durable accepted capture.

```text
100 * successful_attempts >= 90 * captured_attempts
```

The pour summary reports its full-cohort numerator, captured-attempt denominator,
3-second threshold arithmetic, generic failure count, qualification, and Q7 verdict.
Online/offline strata, granular coverage counters, the closed outcome-count map,
threshold-miss partitions, and quality totals remain private and never enter this CSV.
No stratum becomes a selectable child row. Because an uncaptured natural intent leaves
no independent trace, end-to-end pour capture coverage is unavailable and any
released coarse qualification remains explicitly `captured-attempts-only`.
`q7_verdict` remains reserved for the fixed Q7 evaluation outcome.

### Count target

Each comparison unit fixes venue, scope fingerprint/version, item denominator,
inventory cutoff rule, reconciliation definition, baseline/pilot worker rosters, and
roster policy. Baseline and pilot venue sets must match exactly. Missing pairs, scope
mismatch, open/invalid segments, unfinished reconciliation, or absent corrections by
the evidence cutoff make the panel non-evaluable.

If same workers are required, roster mismatch is non-evaluable. If different rosters
are allowed, arithmetic is exported as `confounded` and cannot receive a Q7 success
verdict. No real roster is invented here.

For an evaluable unit and panel with positive baseline labor:

```text
2 * pilot_staff_microseconds <= baseline_staff_microseconds
```

The calculator validates every comparison unit privately, but CSV exports only one
panel-level count metric record. Its full-panel summary contains baseline and pilot
panel labor, the integer comparison, panel evaluation status, the roster and health
qualifications required to interpret the result, and the Q7 verdict. The panel status
is coarse and carries no unit identity or diagnostic reason. Regressed-unit count,
panel-completeness detail, granular coverage counters, the closed outcome-count map,
quality totals, and all other count diagnostics remain private and never enter this
CSV. The record contains no venue or comparison-unit child arithmetic. All captured
attempts and all attributable valid labor through the evidence cutoff remain included
internally. Count attempt-capture coverage is unavailable; preregistered panel
completeness is measurable.

All formulas use integer arithmetic. Zero baseline, negative, noninteger, non-finite,
overflowing, or out-of-range values fail closed.

## 7. Future runtime evidence validator

The pure leaf does not implement this validator. The later capture/persistence slice
must produce an immutable server-held receipt before evidence can be exported as real.

### Runtime receipt

A receipt binds observation, intent, attempt, operation where applicable, actor,
tenant, venue, activation/context version, evidence class, phase, authorization,
window status, duration status, server receipt instant, and rejection reason. The
server derives those fields. A client-supplied role, venue, phase, or evidence class
has no authority.

Online validation rederives active membership, venue grant, task capability, pilot
assignment, activation, and window. Offline local capture is provisional. Replay and
export rederive current server authority; local availability never pretends to be a
fresh authorization check.

### Offline context and clock policy

The activation freezes and versions these fields with the measurement boundary:

- context validity duration;
- reissue policy;
- maximum clock-consistency divergence;
- maximum replay delay;
- server phase windows; and
- context issuance/expiry semantics.

Context issuance, expiry, captured boundaries, and replay comparisons use integer
microseconds. Validity uses the half-open interval `[issued_at_us, expires_at_us)`.
Both measurement boundaries must qualify. A boundary captured one microsecond before
expiry may qualify; a boundary exactly at expiry is `context-expired`.
Reissue requires a fresh online authorization check and creates a new prospective
context version. It never extends an old context or reclassifies old evidence.

An offline record carries closed monotonic boundaries, the monotonic origin and receipt
tick, integer-microsecond client wall-clock receipt/capture instants, context version,
and durable-local capture proof. Replay computes an observed monotonic duration but
treats window placement separately. It compares:

1. the instant derived from context issuance plus monotonic elapsed time;
2. the instant derived from the client wall-clock delta;
3. the context validity interval; and
4. the server replay-receipt instant and maximum replay delay.

The result is `unverifiable-clock` when the derived instants diverge beyond the
preregistered tolerance, the server receipt ordering is impossible, or replay arrives
outside the fixed delay policy. No tolerance may be invented or tuned after collection.
A monotonic duration alone never establishes offline phase or a Q7 success.

This caution is required because `Performance.now()` sleep ticking differs across
platforms, as documented by MDN:
<https://developer.mozilla.org/en-US/docs/Web/API/Performance/now#ticking_during_sleep>.
The plan does not assume trusted hardware.

### Runtime rejection states

The later validator must emit exactly one closed runtime rejection reason from the
mapping in section 3 when validation fails. It distinguishes:

- authorization denied or revoked;
- context not yet valid, expired, version mismatched, or improperly reissued;
- clock divergence, impossible server receipt order, or replay too late;
- open interval lost across reload;
- cross-window capture;
- synthetic or client-asserted provenance on a live path; and
- immutable identity conflict.

Each rejection remains evidence. Lookup assignments and captured pour attempts stay in
their denominators. A rejected count segment makes the unit non-evaluable.

## 8. Authorization, provenance, windows, and coverage

Capture and export are separate capabilities. Live activation records the authorized
venues, provisioned capture capabilities, exporter subjects/capabilities, trained
cohort, assigned lookup roster and mode mix, baseline/pilot windows, count panel and
roster policy, context/clock policy, health-gap reporter, deletion deadline, and
deletion owner. This contract does not invent those external facts or infer exporter
authority from another role.

The later runtime validator and authorized export caller must compare the supplied
venue-set fingerprint with the complete venue set in the server-held activation and
reject a missing, extra, or substituted venue before constructing
`runtime-validated-real` evidence. The pure leaf can reject a subset projection
request against one supplied bundle, but it cannot prove that a self-consistent bundle
contains the complete server-held activation set.

Measurement evidence does not retain raw search text, wine identity/name, free-text
notes, or device fingerprints. Actor, operation, context, and clock diagnostics needed
for validation remain inside the authorized server-private evidence boundary, follow
the activation's retention/deletion policy, and never enter CSV or staff rankings.

Real and synthetic evidence never share an exporter. A normal exporter rejects
synthetic input. A test-only exporter uses a `synthetic-test` filename and a first
record stating `NOT REAL PILOT EVIDENCE`. Mixed origin is an error.

Window behavior is explicit:

- roster-only lookup denominator entries are assignments, not observations, so they
  need no interval boundaries;
- an accepted lookup or started pour uses the start phase and remains a denominator
  failure if it ends outside the phase window;
- every count segment must belong to its declared phase window; and
- provisional export may cover any explicit interval, but a Q7 pilot-success verdict
  requires the closed pilot window to span at least 2,419,200,000,000 microseconds.

The runtime boundary converts any trusted integer-millisecond source exactly once by
multiplying it by 1,000 before constructing supplied evidence. The pure calculator
accepts window boundaries and spans only as integer microseconds.

The private evidence boundary retains detailed records needed to validate every task,
attempt, segment, roster entry, mode, venue, and rejection. CSV never acts as that
record store. The following records remain available for authorized private validation
but never enter this CSV:

- lookup assigned, accepted, durably started, terminal, and unaccepted task counts;
- pour captured-attempt, declared-service-session, known-health-gap, and
  `capture-coverage=unavailable` details;
- count panel-completeness, captured-attempt, declared-session, known-health-gap, and
  `attempt-capture-coverage=unavailable` details;
- mode and stratum summaries, threshold-miss partitions, and quality totals for every
  metric; and
- each metric's closed outcome-count map, containing every pure disposition in section
  3, including `context-expired`. Lookup and pour outcome counts still sum to their
  denominator; count outcome counts still accompany the private panel evaluation.

These granular values never appear at a full-cohort, venue, comparison-unit, actor,
mode, outcome, or any other CSV grain. No contributor threshold can release them in
this initial projection.

A known health gap sets the affected metric's shared coarse qualification to a
qualified state. Unavailable coverage sets that column for a pour/count rate to
`captured-attempts-only`; `q7_verdict` does not carry this coverage or denominator-scope
label. This qualification does not forbid arithmetic, provisional export, or future
C14 software completion. It does forbid describing the rate as complete coverage. No
known gap is not proof that capture was complete. These shared coarse qualification
states remain in an eligible summary; they disclose no actor or diagnostic-category
count. For count, coarse panel evaluation status and roster/health qualification
separately convey panel evaluability and count-specific roster/health conditions.

## 9. Privacy-safe projection

Privacy suppression happens after calculation. Failed, abandoned, expired, or
unverifiable attempts remain in internal denominators even though granular diagnostic
fields are never exported.

### One canonical release grain

Every CSV has one fixed projection. A canonical metric record is keyed by report
fingerprint, contract version, activation version, evidence origin, metric, evidence
cutoff, full activated venue-set fingerprint, and evaluation window:

- lookup and pour use one full-group record for each declared phase window; and
- count uses one full-group record for the declared baseline/pilot comparison pair.

The exporter offers no venue, venue-subset, comparison-unit, mode, outcome, roster, or
alternative rollup projection. Its released columns are limited to this enumerated
projection:

1. Dimensions: report fingerprint, contract version, activation version, evidence
   origin, metric, evidence cutoff, full activated venue-set fingerprint, and the
   declared evaluation window or baseline/pilot window pair.
2. Shared controls: `summary_status`, `summary_contributor_bucket`, the fixed
   `diagnostic_status=not-exported`, coarse qualification for metric coverage and
   denominator scope, and `q7_verdict` for the fixed Q7 evaluation outcome.
3. Lookup and pour summary fields: full-cohort numerator, denominator, integer threshold
   comparison, and generic failure total.
4. Count summary fields: full-panel baseline labor, pilot labor, integer comparison,
   coarse panel evaluation status, and roster/health qualification. The last two are
   count-specific and distinct from the shared coarse qualification.

Every mode or stratum value, coverage counter, terminal-outcome count, threshold-miss
partition, quality total, comparison-unit value, and count diagnostic stays private.
There is no diagnostic contributor bucket, conditional diagnostic release, hidden
release flag, or alternate-grain request in this initial CSV.

The report fingerprint commits to the complete activated venue set, windows, mode
mix, evidence cutoff, contract version, and source bundle identity. The pure exporter
rejects a request to project a supplied bundle to a venue subset or alternate grain.
It cannot establish that a self-consistent supplied bundle represents the complete
activation; the future runtime validator and authorized caller own that comparison to
server-held activation. Re-export of the same frozen bundle is deterministic; amended
evidence requires a new bundle and fingerprint.

### Summary privacy gate

An eligible contributor is a distinct actor represented in the metric's full-group
evidence and admitted by its preregistered cohort for that window. Lookup counts the
actor assigned each included roster task, including an `unaccepted` assignment. Pour
counts the trained-cohort actor on each included captured attempt; a roster member
with no captured intent is not invented as a contributor. Count uses the smaller
distinct-contributor count represented in the full baseline panel and the full pilot
panel under the frozen rosters and declared roster policy. It never substitutes a
comparison-unit slice for either full panel. A real bundle may qualify an actor only
through its runtime validation receipt. A synthetic bundle uses fixture-scoped actor
identity that can reach only the visibly synthetic test exporter.

Private actor identity deduplicates contributors; actor identity never enters CSV.
`summary_contributor_bucket` reflects that distinct full-group contributor count and
has only `<5`, `5-9`, or `10+`. If the full-group contributor count is below five,
the record emits only dimensions, `summary_status=suppressed-small-cohort`,
`summary_contributor_bucket=<5`,
`diagnostic_status=not-exported`, and
`q7_verdict=not-evaluable-privacy`. All summary arithmetic is blank; private evidence
and calculations remain intact. Shared coarse qualification, coarse panel evaluation
status, and roster/health qualification are also blank. An eligible summary reports
`summary_status=released` and uses `5-9` or `10+`, never an exact contributor count.

`diagnostic_status` is `not-exported` for both small and eligible cohorts. It describes
the fixed projection, not a contributor-dependent decision. For a
`suppressed-small-cohort` record, the exhaustive `emits only` list in the preceding
paragraph takes precedence over every eligible-record field rule: all summary
arithmetic and all three qualification/status fields named there are blank. Every
other eligible-cohort behavior is unchanged. Granular private values remain in
calculation denominators and validation evidence regardless of the summary result.

The generic failure total in a lookup or pour summary is the full-group
aggregate `denominator - numerator`. It reveals how many denominator units missed the
numerator, whether through a terminal failure or a timing/qualification miss, but no
actor identity, mode, coverage state, or failure category. It adds no independent
equation beyond the released numerator and denominator.

The generic failure total is intentionally inferable from the released numerator and
denominator; it is not an independently protected cell. The enumerated projection
releases no sibling field that labels how that total divides across modes, terminal
outcomes, coverage states, threshold misses, quality totals, or count diagnostics.
This guarantee applies only to the enumerated fields emitted by this CSV. It is not
differential privacy and makes no promise against arbitrary auxiliary information,
colluding participants, or comparisons of legitimately amended bundles.

The five-contributor threshold is a conservative engineering privacy default, not an
owner fact or legal claim. Changing it requires a new contract version and privacy
review. The CSV contains no actor ID/name, venue identity, query, wine ID/name, note,
operation ID, interval, segment, comparison-unit identity, or device field and no
staff ranking. The private full-group calculation retains every failure. Releasing any
granular diagnostic requires a separate privacy-reviewed projection outside this
initial leaf, not a hidden flag or later activation of fields defined here.

### CSV framing

The dependency-free encoder extracts the behavior of `src/lib/scanner/csv.ts`:

- formula-leading cells receive a leading single quote;
- quotes double inside quoted cells;
- `null` and `undefined` encode as empty cells;
- output starts with a UTF-8 BOM;
- rows use CRLF; and
- output has no trailing CRLF.

After the header, data records use this fixed order:

1. the `NOT REAL PILOT EVIDENCE` marker for a synthetic export only;
2. lookup baseline;
3. lookup pilot;
4. pour baseline;
5. pour pilot; and
6. count baseline/pilot pair.

A real export has no synthetic marker and begins with lookup baseline. Suppressed
records retain their position. The exporter never sorts records from input order or
omits a canonical position to move another record earlier.

Scanner CSV output for the existing scanner fixtures must remain byte-for-byte
unchanged after extraction. The scanner may delegate to the shared encoder. The
insights route stays outside this leaf because it has route dependencies and LF/no-BOM
framing.

## 10. Worked runtime edge cases

| Case | Runtime evidence disposition | Pure calculation disposition |
|---|---|---|
| Closed offline interval, app reloads, then replay succeeds | Receipt may validate if authority, window, context, clocks, and replay delay pass | Use persisted duration; keep original attempt identity |
| Open offline interval straddles reload | `open-interval-lost` | `interrupted`; attempt stays denominator failure with no duration |
| Capture one microsecond before context expiry | Eligible if every other check passes | Use supplied valid receipt |
| Capture exactly at context expiry | `context-expired` | Denominator failure or non-evaluable count unit |
| Capture before context issuance | `context-not-yet-valid` | `context-not-yet-valid`; preserve as failure/non-evaluable evidence |
| Capture presents a different context version | `context-version-mismatched` | `context-version-mismatched`; never coerce to expired |
| Device sleeps beyond expiry while monotonic clock pauses | Wall/monotonic/server checks exceed fixed tolerance | `unverifiable-clock`; never offline success |
| Context reissued after expiry | New version applies prospectively | Old attempt remains `context-expired`; never reclassified |
| Old context extended or reissued without fresh online authority | `context-improperly-reissued` | `context-improperly-reissued`; preserve as failure/non-evaluable evidence |
| Replay after maximum delay | `replay-too-late` | `replay-too-late`; preserve attempt as failure/non-evaluable evidence |
| Synthetic or client-asserted real provenance reaches live validation | `synthetic-on-live-path` or `client-asserted-provenance` | `invalid-provenance`; normal export rejects the bundle |
| Lookup accepted before window close, result after close | `cross-window` | Assignment remains denominator failure |
| Count correction after apparent completion, before cutoff | Valid correction segment | Add labor to the same unit and phase |
| Correction after frozen export | Append-only amended bundle required | Recompute; do not mutate old report silently |
| Lookup has 12 trained staff and 240 tasks: 221 succeed; the 19 failures are `no-result` 7 from 5 actors, `incorrect-selection` 4 from 3, `incomplete` 3 from 2, `cross-window` 2 from 2, and `unaccepted` 3 from 3 | Full cohort clears the summary gate; the detailed distribution remains private | Release numerator 221, denominator 240, generic failure total 19, `summary_contributor_bucket=10+`, and `diagnostic_status=not-exported`. The mode, coverage, threshold-miss, outcome, and quality fields never enter CSV. The integer check `100 * 221 >= 90 * 240` passes. A real closed four-week window with no other qualification may emit Q7 success; a synthetic, open, or qualified record may not claim that result. |
| Lookup mode has four contributors while the preregistered full cohort has ten or more | The full cohort clears the only contributor gate | Release the combined full-cohort summary and its gated verdict. Mode, coverage, threshold-miss, outcome, and quality details remain private regardless of their contributor counts. |
| Lookup full cohort has four contributors | Summary small-cohort rule | Emit only the fixed dimensions, `summary_status=suppressed-small-cohort`, `<5`, `diagnostic_status=not-exported`, and `not-evaluable-privacy`; blank summary arithmetic, coarse qualification, coarse panel evaluation status, and roster/health qualification even when task volume is large. Private calculations and quality totals remain intact. |
| Count panel has eight represented rostered contributors in each phase, baseline labor 28,800,000,000 microseconds (480 staff-minutes), pilot labor 13,200,000,000 microseconds (220 staff-minutes), and one private diagnostic slice from one actor | Both full panels clear the summary gate; the diagnostic detail is not an export input | Release the panel labor, `diagnostic_status=not-exported`, and the met integer comparison `2 * 13,200,000,000 <= 28,800,000,000`, subject to window, provenance, roster, and health qualifications. Regressed-unit, coverage, outcome, quality, and other count diagnostics remain private. |
| Eligible count panel contains several private comparison units | Canonical panel projection | Publish enumerated panel summary fields only; no unit child can be subtracted from the panel |
| Every nonzero private diagnostic slice has at least five contributors, including `context-expired` | Granular release is outside this projection | Keep the full closed diagnostic data private; contributor counts do not activate an export path |
| Bundle carries an unknown runtime rejection token or terminal outcome | Closed-vocabulary validation | Reject the whole bundle before arithmetic or export; never coerce it to a known or generic failure |

## 11. Verification matrix

| Area | Required deterministic cases | Expected result |
|---|---|---|
| Identity | All eight sequences in section 4 | Attempt denominators and exact supplied inventory commit counts match the table, including exactly one commit for cross-intent operation reuse; measurement performs no write |
| Replay | Exact delivery twice; changed payload under same attempt | Exact replay is one attempt; changed replay conflicts without history deletion |
| Reload | Closed interval replay; open cross-origin interval | Closed duration survives; lost open interval deterministically maps to `interrupted` with no duration |
| Clock origins | Same-origin interval; multi-origin independent count segments; same-worker overlap | Within-segment origin enforced; valid segments sum; overlap invalidates unit |
| Context validity | One microsecond before issuance; at issuance; one microsecond before expiry; at expiry; version mismatch; improper reissue | Half-open microsecond boundary holds; each invalid context maps to its exact closed disposition |
| Suspend/replay | Monotonic/wall divergence below and above frozen tolerance; receipt before derived capture; replay past fixed delay | Only consistent evidence validates; clock failures map to `unverifiable-clock`; late replay maps to `replay-too-late` |
| Provenance | Synthetic shaped as baseline; client asserts real/phase; mixed bundle | Live validation maps synthetic/client assertions to `invalid-provenance`; normal export rejects all three; synthetic export is visibly marked |
| Vocabulary | Unknown runtime rejection token; unknown pure disposition | Reject the entire bundle before arithmetic and CSV rendering; no fallback disposition exists |
| Lookup | 10,000,000 and 10,000,001 microseconds; 9/10 and 8/10; mode mismatch; unaccepted assignment; window straddle | Exact edge and integer rate rules hold; every assignment remains accounted for |
| Pour | 3,000,000 and 3,000,001 microseconds; deliberate retry; acknowledgement replay; unavailable coverage | Exact edge holds; retries add attempts, redelivery does not; shared coarse qualification says `captured-attempts-only`, never `q7_verdict` |
| Count | Parallel workers; handoff across origins; failed attempt; post-completion correction; missing pair; roster divergence; exact 50% edge | All attributable labor included; invalid panels do not pass; confound visible |
| Windows | Short/open pilot and closed 2,419,200,000,000-microsecond pilot; exact integer-millisecond conversion at the runtime boundary | Both export provisionally; only the closed full window may emit Q7 success; the pure calculator receives microseconds only |
| Privacy | Full cohort under five; 12-staff/240-task case; one lookup mode under five with larger combined total; one coverage/outcome category under five; private count detail from one actor; eligible count panel with private units | A small full cohort suppresses summary arithmetic and blanks shared coarse qualification, coarse panel evaluation status, and roster/health qualification. Every granular mode, outcome, coverage, threshold-miss, quality, and count diagnostic remains private for both small and eligible cohorts. The 221/240 summary and eligible count-panel arithmetic remain available, and count exposes no unit children. |
| Projection | Attempts to request venue, unit, mode, outcome, diagnostics, subset, or alternate rollup output; repeated same frozen bundle | Every alternate or granular projection request is rejected; one deterministic canonical record carries only the enumerated summary projection with `diagnostic_status=not-exported` |
| Activation completeness | Full server-held activated venue set; self-consistent bundle missing one activated venue; extra or substituted venue | Future runtime validation accepts only the exact activated set before constructing real supplied evidence; pure calculation does not claim it can detect the self-consistent subset |
| CSV | Formula lead, quote, comma, newline, Unicode, null, undefined, empty rows, final row; real and synthetic fixed record order; suppressed positional record; scanner regression fixtures | BOM/CRLF output matches scanner with no trailing CRLF; synthetic marker is the first data record, metric records follow the fixed order, and scanner fixture output remains byte-identical after delegation |
| Authorization | Online denial; offline provisional capture; revoked replay; export scope denial | Pure leaf preserves supplied states; future runtime denies authority as specified |

Plan-only fixtures prove arithmetic and projection behavior. They are not runtime,
database, browser, authorization, or real-pilot proof.

## 12. Smallest implementation leaf and sequencing

C09 source promotion is already locally committed at
`e342c6b5483b15230809b75cef4c0f480bf219f1`. A future C14 promotion must still reread
the approved count and ordered assertions at that time, preserve the whole pre-C14
set, append only reviewed C14 assertions/completion ownership through official
generators, and let the generator allocate IDs. This plan reserves no feature or
migration identity and performs no source promotion.

The first code leaf is limited to eight paths:

- `src/lib/csv/encode.ts`
- `src/lib/csv/encode.test.ts`
- `src/lib/scanner/csv.ts`
- `src/lib/scanner/csv.test.ts`
- `src/domains/pilot-measurement/calculate.ts`
- `src/domains/pilot-measurement/calculate.test.ts`
- `src/domains/pilot-measurement/export.ts`
- `src/domains/pilot-measurement/export.test.ts`

It defines supplied-evidence types, identity consistency, interval arithmetic,
metrics, atomic canonical projection, and CSV rendering. It contains no route, UI,
persistence, server validator, provider, analytics dashboard, schema, or migration.
Any additional path requires root release.

A separate later plan owns the runtime validator, persistence, authenticated capture,
offline context issuance/replay, export ledger, retention deletion, and authorized
route. C03 supplies offline storage/replay boundaries; C04 supplies site/capability
authority; C06 supplies pour/count operation integration; C07 supplies mobile
interaction; C13 supplies final independent evidence.

The pure leaf cannot complete C14. A later tested end-to-end capture and authorized
baseline export can satisfy the C14 software criterion while real Q7 success remains
external and unverified.

## 13. Rejected shortcuts

- Do not treat supplied evidence as proof of server authority or trusted time.
- Do not infer offline phase or success from a monotonic clock alone.
- Do not replace a failed attempt with a successful retry; preserve both.
- Do not let measurement write inventory or turn operation replay into another commit.
- Do not invalidate a closed persisted interval merely because replay follows reload.
- Do not close an open interval with a boundary from another origin.
- Do not stop count labor at the first completion when attributable corrections exist.
- Do not tune context TTL, clock tolerance, or replay delay after collection.
- Do not add a selectable export grain, publish venue/unit children beside a total,
  publish mode/coverage/outcome/threshold-miss/quality/count diagnostics, or expose
  exact contributor counts.
- Do not suppress an eligible full-group Q7 summary because one private category is
  small, and do not add a conditional diagnostic-release path to this initial leaf.
- Do not remove denominator failures because their display cell is suppressed.
- Do not relabel historical application timestamps as pilot evidence.
- Do not claim a real four-week result from fixtures or provisional export.
