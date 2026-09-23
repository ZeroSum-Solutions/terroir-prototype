# Terroir conversation audit and revised planning sequence

Date: 2026-09-22. Status: historical planning audit; product recommendations approved
on September 23 and autonomous implementation started under the linked PRD.
Interview status updated September 23: Q5 accepted as B first, C as soon as practical;
Q8 names Toast as the likely primary POS. The owner subsequently approved all
remaining Q6–Q15 recommendations and requested autonomous implementation. The
original review remains dated September 22; it did not review these later answers.

This document records corrections to the conversation and the rationale for the
revised sequence in [Product and Data Requirements](2026-09-20-terroir-product-data-requirements.md).
The latter remains the single evolving product requirements document. This audit
does not independently authorize implementation; the later explicit owner approval
and execution contract govern current work.

## 1. Decisions actually supplied by the owner

| Decision | Evidence from conversation | Boundary |
|---|---|---|
| Prioritize restaurants and serious private collectors | “We should optimize for the restaurants and private collector” | Hobbyist discovery remains in the vision; its delivery date is unset |
| Launch restaurants first | “Restaurants please” in response to launch order | Collector follows; no collector release date was approved |
| Initial customer profile | “Venue size, 70 people, number of wines 35, #staff 20, sophisticated wine program, multiple locations” | Seats versus covers, per-site versus group totals, site count, bottle count, and shared storage remain unconfirmed |
| Terroir owns inventory authority | “Yes it should be the authoritative inventory system” | The exact POS event and depletion policy is still a recommendation |
| Three distinct experiences | Operations for business; imagery/discovery for collectors; discovery/purchasing for enthusiasts | These are workflow differences, not just color themes |
| Business experience should eventually adapt to roles | Beverage manager, waiter/server, sommelier named explicitly | Cost visibility, approval rights, and generated layout behavior are not settled |
| Explore AI and TypeSafe broadly | Owner requested capability discovery and TypeSafe research | No production accuracy, latency, or workload suitability has been demonstrated |
| Interview before final PRD | Up to 15 questions before creating the lasting source of truth, followed by “Agree with all” on September 23 | Q6–Q15 recommendations and Q7 targets approved; unknown pilot facts and measured results remain unknown |
| Offline release sequence, September 23 | “B is good” with C the intended outcome “as quickly as possible” | Offline service/count capture first; receiving, transfers, and management offline next; no date or detailed failure policy approved |
| Primary POS target, September 23 | “Probably mainly gonna be operating with toast for the POS vendor” | Toast is the provisional primary target, not exclusive; API access, pilot configuration, and depletion policy remain open |
| Use Opus for adversarial review | Owner replaced blocked Grok with Opus and now requests Opus 5 | Grok never delivered a review |

## 2. Corrections to earlier answers

| Finding | Correction and planning effect |
|---|---|
| The saved sequence launches collectors first and defers multi-venue work | Superseded by the owner's restaurant-first, multi-location target. Establish group/site boundaries and pilot restaurant operations first. Exact transfer and oversight scope still needs confirmation. |
| “70 seats per venue, 35 distinct wines, 20 staff” treated an interpretation as fact | Preserve the owner's numbers verbatim until their scope is clarified. Do not derive capacity or load targets from seat count. |
| Multi-location immediately became a full launch feature list | Group support is required by the target. Shared warehouse, central purchasing, transfers, and full consolidated accounting are candidate requirements, not automatically approved scope. |
| “321 remain unresolved” was presented as a current verified count | AGENTS.md describes 1,277 blank-producer imports, 956 repaired, and 321 unresolved in production on 2026-08-29. It separately describes a local 1,277-row condition on 2026-08-30. These are historical snapshots. No current database census was performed. |
| Existing operations were called proven, append-only, or strong without a named runtime check | Code and schema show implementation presence. The audit does not establish current runtime correctness. ARCHITECTURE.md explicitly says some records can cascade-delete and newer reconciliation uses compensating steps, not one database transaction. |
| The first Opus review claimed an exclusive market position | “Nobody in wine software owns” the proposed ledger is unsupported. Treat differentiation as a customer-validation hypothesis. |
| Opus recommended mandatory individual bottle records | The existing draft deliberately leaves lot-versus-unit grain open. Recommend lots plus optional bottle identity where condition, placement, or provenance requires it; keep explicit NV and unknown vintage distinct. |
| Opus prescribed six new tables and a universal provenance table | Those are architecture proposals, not settled requirements. First map existing audit/provenance/queue structures. Evaluate prototypes can use fixtures and files; no schema project is prerequisite to learning. |
| A 95% precision gate was suggested for identity auto-resolution | That can mean five wrong links in every hundred accepted matches. Define acceptable false acceptance by consequence and use a held-out set with uncertainty bounds before auto-linking. Sample thresholds were not approved. |
| “Your eval set builds itself” omitted selection bias | Corrections are valuable labels, but disputed cases are not representative. Audit a sample of accepted cases, separate training/tuning and held-out evaluation data, prevent tenant/source leakage, and track model/question versions. |
| TypeSafe was assigned fault detection | It may classify descriptions of suspected faults supplied by a person or sensor. It cannot taste a bottle or establish TCA/oxidation from text alone. |
| Model-based injection/citation checks were treated as sufficient protection | Treat imported content as data; code enforces tool limits, tenant access, and write validation. Model screens and citation judgments are fallible supplementary checks. |
| “AI never writes” and “every action needs human approval” were too broad | Software may execute an authorized low-risk action after deterministic validation. Match review requirements to consequence and uncertainty. Keep everyday service fast. |
| Privacy assurances overstated guarantees | A state hash alone neither reconstructs a request nor proves which tenant's data left. Use access-scoped evidence references, retention decisions, and replayable sanitized fixtures. Pseudonymization is not anonymity. Enterprise ZDR is an option to evaluate, not an owner-approved purchase or universal prerequisite. |
| Live merchant availability was called mandatory for any hobbyist launch | It is necessary for a live best-price/local-availability promise. Discovery, learning, ratings, and wish lists can exist without it. Keep those ideas for the later experience. |
| Existing research still said Grok was pending | Replace this stale status with the actual Opus review and open evaluation limits. Model review is reasoning evidence, not an independent live source audit. |
| Authentication problems stopped product research | Credentials are necessary for live provider trials, not for requirement discovery or synthetic test design. Keep those tracks separate. Do not put any credential from the conversation in reviewer packets or documents. |

## 3. Inventory authority and the missing event rule

Recommend Terroir as the physical wine inventory record; the POS retains orders,
checks, payments, and sales records. POS messages are evidence for Terroir's domain
operations, not raw instructions to subtract stock. Provider support and API access
must be verified for the selected POS and plan before an integration commitment.

The previous diagram omitted the principal risk: a staff pour and its later POS
sale can describe the same service. Idempotency prevents a repeated webhook from
being applied twice, but does not solve this cross-source duplication.

Before coding, choose a depletion authority for each service channel at each site:

- Staff-recorded mode: the pour or bottle-service event changes stock; a linked
  POS line corroborates the sale and never depletes the same wine again.
- POS-derived mode: mapped fulfilled service lines produce estimated depletion;
  staff records verify/link or explicitly correct that depletion.
- Until a cross-source link is reliable, select one authority per channel and
  flag ambiguous matches for reconciliation. Do not subtract both and hope to
  reconcile later.

Version mappings by POS item, vintage/format, pour size, venue, and effective time.
Retain source IDs, order/line revision, occurrence time, receipt time, and causation
links. Late, replayed, out-of-order, edited, split, reopened, or transferred checks
must not create additional physical consumption. A refund or comp changes money;
it does not put poured wine back in a bottle. A void before service and a void
after service need different physical outcomes.

Channel authority also needs a shared stock-allocation rule. Opening one 750 mL
bottle moves one sealed unit into 750 mL open volume; four 150 mL pours leave
150 mL before separately recorded waste. A POS bottle line describing that same
service is a linked financial observation or a review exception, not a second
sealed-bottle removal. Two channels cannot consume the same remaining unit.
Use lot allocation/reservations and optional unit identity; do not mandate a
physical-bottle row for every bottle just to solve the concurrency problem.

Define service occurrence independently from check payment. The proposed contract:

| Observation | Physical result |
|---|---|
| Void/cancel before wine is served | Release any reservation; no consumption |
| Served bottle or measured/standard pour | One recorded consumption under the selected authority |
| Comp, discount, or refund after service | Preserve that consumption; change the financial relationship only |
| Void after service | Retain consumed wine; classify service/waste as appropriate |
| Reopen, split, transfer, or edit a check | Preserve service links; post only an evidenced physical correction |
| Return of a physically unopened bottle | Explicit inspected return event, distinct from a refund |

The POS may lack reliable service-occurrence signals. In that case use an explicit
estimate or staff reconciliation; payment status alone is not proof of consumption.
Store sealed quantity in units by format and open quantity in mL (or a precisely
defined conversion). Display any bottle-equivalent conversion with its basis;
never sum sealed count and open volume without it.

Stock is more than one count: sealed stock, open volume, reserved/unavailable,
in transit, and last physically counted state have different meanings. Estimated
open volume must not be labeled measured. Transfers need dispatch, in-transit,
receipt, and discrepancy states, with one accountable owner throughout. Stocktakes
need a cutoff/version so concurrent service does not become fictitious variance.

Publish availability back to the POS only where supported, with freshness and a
manual fallback. A POS outage cannot prevent local wine lookup or authorized
service logging within the agreed offline scope. A double sale of the last bottle
on disconnected devices cannot be ruled out without a coordination policy.

## 4. Proposed revised sequence

| Step | Concrete output | Exit condition |
|---|---|---|
| 1. Finish product discovery | Owner decision register; launch/later/experiment labels; restaurant workflow examples | Highest-impact unknowns answered or explicitly bounded; measurable pilot outcome chosen |
| 2. Reconcile baseline and capabilities | Current source/branch map; requirement-to-code/schema/test evidence; dated data-quality measurement where access permits | Shipped, present-but-unverified, missing, proposed, and external dependencies have distinct labels |
| 3. Specify the restaurant operating contract | Group/site permissions; quantity units; service/POS match policy; stocktake cutoff; offline sync; returns and transfer lifecycle | Written examples have one unambiguous stock outcome, including failure and correction cases |
| 4. Finalize the living PRD and data design | One PRD with stable feature IDs, use cases, scope, metrics, data relationships, acceptance criteria, dependencies, open decisions, and change log | Owner reviews concrete behavior; database design maps existing tables before proposing changes |
| 5. Build a restaurant pilot in bounded slices | Receive → place → find → serve → count → reconcile; site permissions and required group workflows | Staff complete the agreed journey, counts reconcile, and access/concurrency/replay checks pass in an isolated environment |
| 6. Evaluate selected AI helpers alongside the pilot | Offline/synthetic baseline comparison; shadow results; model/question version; cost/latency and correction burden | A helper improves a measured task and has an explicit fallback; no model opinion alone establishes success |
| 7. Expand collector workflows | Beautiful collection browse, imagery, producer/vintage detail, notes/ratings, acquisition costs, drink guidance, provenance and location | Shared foundation passes collector examples; later duties/insurance/commerce integrations are scoped by actual need |
| 8. Add enthusiast and commercial discovery | Occasion matching, wish lists, learning, merchant offers under verified contracts | Claims about price, stock, delivery, and licensed ratings match available evidence |

Steps 2 and synthetic AI evaluation can proceed alongside the interview. No live
database change, paid-provider dependency, or complete tenancy rewrite is necessary
to finish this planning phase. A one-site usability rehearsal may precede the
group pilot, but it does not validate multi-location requirements.

### Tenancy decision required before schema freeze

Existing `restaurant_id` containment does not by itself provide a group permission
model. The design must map legal/stock owner, group, workspace, site, collection,
and membership onto existing IDs and policies. Compare two migration approaches:
retain site restaurant IDs with explicit group grants and linked transfer records;
or introduce an ownership workspace with site-scoped grants and compatibility
mapping. Do not choose by table-name convenience or silently widen existing access.

Specify first: a staff member at site A cannot read site B's restricted costs or
mutate its inventory; a group manager sees only granted sites; a transfer is one
linked business operation even if storage uses paired records. Stock owner and
transit custodian are distinct. If the sites have different legal owners, treat
that as a different business operation rather than assuming an internal transfer.
The owner supplies operational facts; engineers propose and test the schema mapping.

For each implementation step define its baseline, acceptance metric, threshold,
judge, and stop/descope condition before starting. For the restaurant pilot, measure
lookup time, service logging time, count/reconciliation effort, and stock variance
with named unit, site scope, and time period. Select the primary outcome with the
owner; numeric targets are still open. Stop automatic writes on a wrong match,
duplicate depletion, or access breach. Keep the manual path while reviewing the cause.
Defer optional merchant/AI integrations if access or representative evaluation data
is unavailable; do not redefine that as a passed evaluation.

## 5. AI adoption priorities and evaluation rules

First compare TypeSafe with existing code and model behavior on three bounded
jobs: extraction verification, candidate matching, and intent/search ranking.
Use OCR/vision/STT for perception, generative models for explanations, TypeSafe for
typed judgments, and deterministic code for quantities, eligibility, and actions.

For each job record: user benefit; inputs and their rights; output/action contract;
model and question version; failure cost; eligible automatic actions; review and
abstention behavior; deterministic fallback; acceptable latency/cost; and evaluation.
No universal confidence threshold or model score qualifies all workflows.

Synthetic fixtures establish mechanics and failure cases. Representative authorized
pilot data and human labels establish real-world suitability. Use a held-out set
and slices for similar producer names, vintage/format mistakes, incomplete invoices,
multilingual text, missing candidates, and contradictory evidence. Measure false
acceptance, coverage, review time, p50/p95 end-to-end latency, failure rate, and full
workflow cost including OCR and escalation. Numeric production gates remain proposals
until tied to the pilot's risk and baseline. Provider bills are not an accuracy metric.

No representative authorized pilot corpus is identified yet. Existing demo and
historical defect sets can supply regression cases, not production performance
claims. Production promotion is gated on suitable data and evaluations. Preserve
the recorded rejection of silent write-time producer recovery: matching experiments
start as suggestions; any future automatic link policy requires its own explicit
decision and evaluation, rather than silently reopening that rejected design.

Keep a durable, private decision/review record for consequential production actions,
with subject and evidence references, actor, authorization context, policy version,
typed output and correction history. Implement it through existing mechanisms where
possible. An AI service never gains independent authority to change access rights.

Use stable role presets for restaurant navigation and controls. Explore generated
summaries, an explicit suggestions area, or user-approved dashboard composition
without changing primary control positions mid-task. Generative UI remains in the
vision; its introduction depends on measured task benefit and accessibility.

## 6. Remaining interview (up to 15 total numbered questions)

Q1–Q5 have answers. The later approval of Q7 supplies proposed success targets,
not measured results. All Q6–Q15 recommendations were subsequently approved.
Q8 now has a provisional vendor answer: Toast is the likely primary POS, with
access still unverified. The later blanket approval accepts the proposed operational
policy without establishing integration access or customer facts.
On September 23 the owner requested recommended answers to all remaining questions
together. Those proposals are in the PRD, section 10. The original topic list is
retained below with Q5's updated decision; accept partial answers without silently
approving the remaining details:

5. Accepted: B for the first release (cached lookup and offline service/count capture),
   C as the intended outcome as quickly as possible (offline receiving, transfers,
   management changes). Outage duration, exact actions, and conflict/security policy
   still require specification; disconnected devices cannot guarantee global stock.
6. Pilot group shape: site count and whether 70/35/20 apply per venue; shared stock
   and transfer/purchasing workflow.
   Track separately: (a) number of sites; (b) scope of the three figures;
   (c) shared storage/transfers; (d) cross-site stock/cost/count read and write
   visibility; (e) legal stock owner at each site. All remain unanswered.
7. Highest-cost current problem and the measurable outcome that makes the pilot
   successful; include baseline and who will judge it.
8. Toast is the likely primary POS. API access and actual pilot configuration remain
   unverified; manual pour practice versus POS-derived depletion is still undecided.
9. Actual roles, cost visibility, write/approval authority, and delegation.
10. Physical tracking: counts/lots versus uniquely tagged bottles, pour sizes,
    partial bottles, and reservation practice.
11. Receiving/counting: source files, frequency, suppliers, returns, credit notes,
    and who resolves discrepancies.
12. Devices and service interactions: phones/shared tablets/desktop, scan/voice,
    interruption recovery, and staff login practice.
13. AI autonomy and review: which suggestions can execute, who reviews exceptions,
    and acceptable wait/cost/privacy constraints for the pilot.
14. Collector launch boundary: approximate scale, storage/custody, imagery,
    notes/ratings, and acquisition/valuation expectations.
15. Launch constraints: geography/currency, timeline, operating budget, pilot access,
    and commercial success assumptions.

Each topic can contain several missing facts; record the answer status of each
fact independently. A short answer never approves the rest of a topic. Q7 explicitly
carries Q1's unanswered success metric. Q9 also covers visibility, retention, and
permitted use of staff-attributed performance/variance data. Q5's B-to-C sequence
is now accepted; queued service writes still require replay-after-partial-failure,
revoked-access, concurrent-last-bottle, stocktake-cutoff, and device-loss acceptance
cases. Offline conflict reports must not silently discard physical activity.

The final PRD should preserve the broad idea inventory while identifying committed
release scope. The interview cap is not evidence that every requirement is settled;
unanswered items remain explicit decisions with an owner and consequence.

## 7. Evidence and limits

- Verified local repository: `/Users/zero/projects/_archive/terroir-prototype`,
  remote `git@github.com:ZeroSum-Solutions/terroir-prototype.git`, branch
  `docs/product-data-requirements`, HEAD `beb7539b289396caad26fed1c1ba78d2c9d0aeb2`.
- Read-only `git ls-remote` on 2026-09-22: GitHub main is
  `9ac5a932a099be3bfda6eb59f9682eb0affcd81e`; mobile branch is
  `b9a352661ee2da9dc387839e0bc93db9d4c8ecc3`. The docs branch is not present under
  that remote name. A clean local tree did not mean the documentation was published.
- Repository sources: AGENTS.md (dated identity counts and runtime boundaries),
  docs/ARCHITECTURE.md (transaction and immutability limitations),
  src/domains/pours/pour-service.ts (existing pour operations), and the September
  20 product/data draft (capabilities, domain proposals, and unresolved decisions).
- The first Opus response exists in this conversation. It had no code tools;
  it reasoned from a packet and automatically supplied repository instructions.
  Its model result identified `claude-opus-5`. Its assertions are not source proof.
- TypeSafe research is a documentation audit. No authenticated TypeSafe request or
  workload evaluation has been demonstrated in this conversation. The key is
  deliberately absent from these documents and reviewer prompts.
- Refreshed TypeSafe official [model documentation](https://docs.typesafe.ai/models)
  and [confidence documentation](https://docs.typesafe.ai/confidence) on 2026-09-22:
  the listed model is Jev 1.13.0, text-only, priced at $0.042 per million input
  tokens with free output. Choice/Score confidence derives from the returned
  distribution; it does not establish measured wine-domain accuracy.
- Toast's [orders webhook documentation](https://doc.toasttab.com/doc/devguide/devOrdersWebhookRef.html)
  describes a full order on updates, supporting the need for revision-aware
  ingestion. Its [API overview](https://doc.toasttab.com/doc/devguide/apiOverview.html)
  distinguishes integration access. These documents establish possible interfaces,
  not the pilot's entitlement. The owner's September 23 answer, separately from
  this source evidence, identifies Toast as the likely primary POS.
- Deployment, production schema, production data counts, POS entitlements,
  merchant contracts, and actual staff task performance remain unverified.

## 8. Opus 5 review and disposition

The fresh reviewer call explicitly requested and reported `claude-opus-5` through
the authenticated Claude Max CLI. Tools and external browsing were disabled.
The raw [review](evidence/2026-09-22-opus5/review.md) and
[metadata](evidence/2026-09-22-opus5/metadata.json) are saved. Its initial verdict
was conditionally ready for interview/baseline audit, not schema or scope freeze.

A second pinned Opus 5 [closure review](evidence/2026-09-22-opus5/closure.md)
read the revised audit and actual updated PRD. It marked B1 and B2 closed at the
planning layer and judged the documents ready to continue discovery and baseline
reconciliation. Its remaining suggestions have been applied: Q6 tracks cross-site
visibility and legal stock ownership; PDR-013 recommends cached reads with queued
writes pending Q5; and the PRD now contains the three operating invariants and
five acceptance scenarios. This verdict is not implementation or runtime approval.

| Finding | Disposition |
|---|---|
| B1: conflicting documents | Accepted and corrected in the existing PRD itself: restaurant phase precedes collector, PDR-011 no longer recommends deferral, PDR-013 remains open. The reviewer saw the pre-edit excerpts. |
| B2: site versus tenant ambiguity | Accepted as a required schema-design decision; added alternatives and three access/transfer cases. An unresolved engineering decision does not block interviewing users. |
| M1: last bottle across two channels | Accepted hazard; use a shared allocation rule and explicit link/review. Reject mandatory lot-level channel locking as the only solution. |
| M2: fulfilment versus payment | Accepted; added event outcome table including comps and reopened checks. |
| M3: quantity algebra | Accepted; sealed units and open mL remain separate, with explicit conversion. Corrected review example: four 150 mL pours from 750 mL leave 150 mL, not zero liquid. |
| M4: offline replay risk | Accepted replay-after-partial-failure test; keep offline service scope open. Do not accept the reviewer suggestion to close Q5 without the owner's answer. |
| M5: premature collector decisions | Accepted; defer collector-only schema commitments until collector scope, retaining shared identity/ownership compatibility now. |
| M6: candidate matching equals rejected producer repair | Rejected equivalence. Retain the existing restriction on silent producer repair and require a separate decision for any future automatic linking policy. |
| M7: missing representative eval corpus | Accepted; synthetic/demo tests establish mechanics only, real performance remains gated. |
| M8: staff data privacy | Accepted into Q9 and pilot role/data policy. |
| M9: success tolerance and stop conditions | Accepted; define metric unit/scope/period, threshold, judge, and stop/descope triggers before implementation. Owner success target remains open. |
| M10: nominal question cap | Accepted concern. Track partial answers per fact; keep <=15 numbered question topics without treating silence as agreement or forcing technical decisions on the owner. |

### PRD acceptance examples to carry forward

1. Opening one 750 mL bottle and logging four 150 mL pours yields zero sealed
   units from that bottle and 150 mL open, before waste. A linked POS line cannot
   deplete it again; an unmatched line is an exception.
2. Dispatch six units and receive five at another site: five become received,
   the remaining unit stays explicitly unresolved/in transit under an accountable
   owner/custodian, and a third site's unauthorized staff cannot read the records.
3. Replaying an offline count/service request after a partially failed application
   produces one domain outcome; a count has a cutoff and later service is preserved.
4. A producer-less export retains its unresolved identity after a wrong suggestion
   is rejected; any confirmed correction and reversal retain evidence and history.
5. Comping, splitting, reopening, or refunding a served order preserves its
   consumption; replaying updates out of order does not change that stock outcome.

### Explicit supersession record

- PDR-002/003/008: remain open; settle only the restaurant/shared-core subset now.
- PDR-004/005/006/007/009: restaurant-needed portions are pilot decisions;
  collector-only commitments wait for collector discovery.
- PDR-010/012/014: retain existing proposed boundaries; no new owner acceptance.
- PDR-011: old defer recommendation superseded by the multi-location target.
- PDR-013: old count-only and cached-read-only defaults are historical. The owner
  accepted B first and C as the priority offline extension on September 23; detailed
  failure and authorization policies remain open. This supersedes the September 22
  review's open-Q5 status without changing its historical evidence.
- Phase 0 now includes the interview and restaurant operating contract; Phase 1
  stays mapping/design; Phase 2 is limited to the pilot's shared needs; Phase 3
  is restaurant and Phase 4 collector; Phase 5 retains deeper expansion.
