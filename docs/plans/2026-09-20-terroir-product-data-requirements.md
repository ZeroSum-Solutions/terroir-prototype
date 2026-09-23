# Terroir Product and Data Requirements

**Status:** Product direction and Q6–Q15 recommendations approved by the owner on
2026-09-23, followed by an explicit autonomous implementation request. Promote each
new requirement through the source ledger before implementation. This approval does
not establish unknown pilot facts or authorize production data changes/deployment.
The [execution contract](2026-09-23-terroir-production-execution.md) maps approved
behavior to implementation tasks and proof; it does not replace this product PRD.

**Date:** 2026-09-20

**Last revised:** 2026-09-23, after the owner's offline decision, request for
recommended interview answers, and identification of Toast as the likely primary POS.
Restaurants launch first; serious private collectors follow. This is an evolving
PRD, not a claim that all listed capabilities belong in the first release.
See [the audit and revised planning sequence](2026-09-22-terroir-plan-audit.md)
for evidence corrections, recommendations, and remaining interview topics.

**Repository baseline:** `main` at `9ac5a932a099be3bfda6eb59f9682eb0affcd81e`

**Purpose:** Consolidate the restaurant, collector, wine-intelligence, inventory,
pricing, tasting-note, spatial-cellar, and integration requirements that currently
live across separate plans. Use this document to settle product decisions and design
the next database contract. Continue to use `docs/feature-ledger.json` for the current
269-feature contract until approved requirements are promoted through the repository's
source-ledger process.

## 1. Product definition

Terroir is a wine management, collection, service, and purchasing-intelligence
platform for two workspace types:

1. **Personal collection:** one or more people managing wine they own or control
   across homes, cellars, refrigerators, cases, and professional storage.
2. **Restaurant:** owners, managers, sommeliers, and staff managing receiving,
   storage, menus, service, open bottles, counts, reconciliation, and reporting.

Both workspace types use the same wine identity, acquisition, inventory, location,
note, rating, pricing, provenance, search, and audit foundations. Restaurant-only
capabilities sit on top of that shared core. A personal collection must not be stored
as a restaurant merely to reuse existing tables.

### Owner decisions recorded through 2026-09-23

- Prioritize restaurants and serious private collectors; launch restaurants first.
- Target a sophisticated wine program with multiple locations. The owner's initial
  profile is “70 people,” “35 wines,” and “20 staff.” Whether these are per-site
  or group totals, the number of sites, and physical bottle counts remain open.
- Terroir is the authoritative physical wine inventory system. Recommend keeping
  orders, checks, payments, and financial sales records authoritative in the POS.
  The service/depletion contract remains open. For Q8 the owner said the operation
  will “probably mainly” use Toast: record Toast as the provisional primary POS
  integration target, not an exclusive vendor commitment. Actual pilot use, API
  access, integration permissions, and available data remain unverified.
- Preserve three experiences: rapid restaurant service and management; an image-led
  collector experience; and later enthusiast discovery and purchasing assistance.
- Explore role-aware business UI and extensive AI assistance. The role permission
  matrix, automation thresholds, and generative layout behavior remain proposals.
- Q5: the owner accepts B for the first release: cached lookup plus offline pours,
  opened bottles, waste, and counts, synchronized afterward. C is the intended
  outcome as quickly as possible: extend offline operation to receiving, transfers,
  and management changes. Treat C as the next priority offline milestone, not a
  discarded idea or an approved delivery date. Exact management actions, supported
  devices, outage duration, and conflict/authorization rules remain to be specified.

Offline entries must show pending, synchronized, or needs-review status and the age
of cached stock. Disconnected devices cannot guarantee globally current availability
or exclusive allocation of the last bottle. Preserve conflicting physical reports
for reconciliation without silently overwriting or dropping them. The build contract
must define secure local persistence, device-loss/revocation handling, and recovery.

Multi-location support is part of the target. Central purchasing, shared warehouses,
inter-site transfers, group reports, and staff access across sites need a bounded
pilot definition before they become committed release requirements. Personal
collector support follows the restaurant pilot; its release date remains unset.

### Decision PDR-001: shared workspace foundation

**Status:** Accepted by the owner on 2026-09-20.

Replace the product-level assumption that every tenant is a restaurant with a general
workspace or collection owner. The exact table and migration names remain a schema
design decision. The required behavior is:

- a workspace has a stable identity and a type such as `personal` or `restaurant`;
- users join workspaces through memberships and capabilities;
- both workspace types can own collections, inventory, notes, prices, locations, and
  evidence;
- restaurant group and site scopes must be explicit; physical location alone does
  not grant group-wide access. The organization/workspace/site relationship and
  cross-site role model remain a schema design decision;
- restaurant workspaces can additionally enable teams, menus, pours, stocktakes,
  receiving, reconciliation, suppliers, and POS-adjacent integrations;
- existing restaurant IDs, RLS policies, URLs, and critical journeys remain valid
  throughout migration;
- no implementation may infer that a workspace type grants a permission. Membership,
  role, and capability checks remain explicit.

## 2. Authority and document boundaries

This document is the planning source for the future product and data model after owner
approval. It does not replace current implementation truth.

| Question | Authority |
|---|---|
| What is implemented and verified now? | `docs/feature-ledger.json`, conformance artifacts, code, schema snapshot, and executable evidence |
| What are the current module and database boundaries? | `docs/ARCHITECTURE.md` |
| What should the combined restaurant and collector product support? | This document after owner approval |
| What may an implementation ticket change? | An approved requirement promoted into `app_spec.txt` and the generated feature ledger |
| What is historical context rather than current authority? | Archived plans, `app_spec.txt` drifted prose, and `claude-progress.txt` |

The current feature ledger contains 269 active core requirements. Later planning added
collector tenancy, evidence states, global vintage identity, physical placements,
source-aware ratings, stocktakes, custody, and deeper provenance. Those later
requirements have not all entered the source ledger. This document reconciles them
without pretending they have shipped.

## 3. Product principles

### 3.1 Truth before convenience

- Never turn a probable match into a confirmed wine without an actor or trusted source.
- Keep expected, extracted, visually identified, user-confirmed, physically verified,
  and externally synchronized facts distinct.
- Preserve corrections and superseded values instead of silently overwriting history.
- Show the source, observation date, confidence, and applicable vintage or format for
  ratings, prices, notes, images, drink windows, and market facts.
- Prefer an explicit unknown state to an invented producer, vintage, price, score,
  placement, or count.

### 3.2 One wine identity, many relationships

A producer, cuvee, vintage, bottle format, acquisition lot, and physical bottle are
different things. The schema must not collapse them into one row. Restaurant and
collector records should point to the same global wine identity while keeping private
ownership, cost, notes, and activity scoped to the workspace.

### 3.3 History is product data

Inventory, price, custody, placement, rating, and note changes matter over time. Store
events or versioned observations when users will need to answer who changed something,
what it used to be, when it changed, why it changed, and which evidence supported it.

### 3.4 Shared core, capability-specific workflows

Do not fork the wine model into a restaurant database and a collector database.
Restaurant and personal experiences can present different workflows while sharing
identity, inventory, acquisition, provenance, search, and storage concepts.

### 3.5 Private by default

Collection contents, purchase prices, invoices, photos, notes, locations, custody,
queries, and valuations are private unless an owner grants a narrower scope. Public
restaurant menus do not establish a general sharing model.

## 4. Users and workspace roles

### 4.1 Shared roles

- **Owner:** controls workspace settings, membership, exports, retention, and
  destructive actions.
- **Manager or delegate:** manages inventory and approved operational workflows.
- **Contributor:** adds and corrects inventory, notes, evidence, or placements within
  granted capabilities.
- **Viewer:** reads an explicitly granted scope without mutation rights.

### 4.2 Restaurant actors

- restaurant owner;
- beverage director or sommelier;
- manager;
- service staff;
- receiving or inventory staff;
- guest viewing a published menu;
- supplier, POS, or inventory integration acting through a bounded adapter.

### 4.3 Personal-collection actors

- collector;
- household member;
- cellar manager or assistant;
- advisor;
- temporary guest or recipient of a share;
- professional storage provider or merchant acting through a bounded adapter.

The exact role names and capability matrix remain open. The database must support
capability-scoped access without assuming that restaurant roles apply unchanged to a
household.

## 5. Capability requirements

The capability IDs below are durable planning identifiers. They are not implementation
IDs until they enter the approved source ledger.

### CAP-01: accounts, workspaces, and membership

- Create and manage personal and restaurant workspaces.
- Join more than one workspace and switch without leaking state between them.
- Invite, revoke, expire, and audit access.
- Assign roles and narrower capabilities.
- Preserve existing restaurant owner, manager, and staff behavior.
- Support the multi-location restaurant target with explicit group/site access;
  settle cross-site membership and administration through the pilot role matrix.
- Export or delete workspace data under an explicit retention policy.

### CAP-02: producer and wine identity

- Store producers as first-class global identities rather than repeated free text.
- Support producer aliases, former names, spelling variants, ownership changes, and
  external identifiers with source provenance.
- Store the producer's cuvees or wine products separately from vintages.
- Represent non-vintage explicitly. Unknown vintage and non-vintage are not the same.
- Represent bottle format separately from vintage.
- Resolve imports, scans, and manual entries to ranked candidates or abstain.
- Merge duplicate identities through an audited, reversible process.
- Keep tenant-private assertions separate from shared catalog facts.

### CAP-03: wine edition and vintage knowledge

- Represent one edition for a wine product and vintage.
- Attach vintage-specific ratings, notes, imagery, production facts, drinking windows,
  market observations, and critic coverage to the edition.
- Navigate a vintage rail without implying that facts from one vintage apply to another.
- Track vintage status such as declared, non-vintage, unknown, or disputed.
- Record provenance and effective dates for every externally sourced vintage fact.

### CAP-04: intake and acquisition

- Add wine manually.
- Scan one bottle label and confirm or correct its identity.
- Capture multiple labels for later review without claiming counts from the image.
- Import CSV and Excel files with source-aware mapping and row-level correction.
- Scan invoices and review extracted lines before inventory changes.
- Record purchase date, supplier or merchant, quantity, unit cost, currency, taxes,
  fees, invoice, order reference, and acquisition channel when known.
- Import from named exports such as CellarTracker, Vivino, Binwise, Bevrly, BevSpot,
  and a generic mapping path.
- Make every confirmation and import safe to retry.

### CAP-05: holdings, lots, cases, and physical bottles

- Track an acquisition lot independently from wine identity.
- Preserve separate cost bases when the same edition is bought more than once.
- Track aggregate quantity where bottle-level identity is unnecessary.
- Create optional physical-bottle records when placement, custody, condition,
  provenance, or service requires unit-level history.
- Represent sealed cases with expected contents and verified contents kept separate.
- Record case state such as sealed, opened, partial, damaged, or unknown.
- Preserve bottle or case condition observations over time.
- Prevent placed physical units from exceeding available quantity.

### CAP-06: inventory history and stock truth

- Record receipts, manual additions, adjustments, transfers, placements, removals,
  consumption, breakage, returns, gifts, sales if later approved, and corrections as
  typed inventory events.
- Require actor, timestamp, reason, and idempotency data for each write.
- Derive current quantity from authoritative transactions or reconcile snapshots with
  an auditable event history.
- Support effective dates for late-entered events.
- Preserve correction links rather than deleting the original event.
- Distinguish unavailable, reserved, pending delivery, in transit, external custody,
  consumed, disposed, and missing states.
- Keep sealed quantity in units by format and open quantity in mL with exact
  conversions. Distinguish measured volume from estimates based on standard pours.
  A bottle-equivalent display must name its conversion basis.

### CAP-07: locations, containers, and custody

- Model sites, rooms, walls, racks, refrigerators, shelves, bins, cases, and slots as a
  hierarchy without storing location only as free text.
- Support an unplaced queue.
- Place aggregate lots or individual bottles according to the chosen inventory grain.
- Move stock between locations with history.
- Record custody separately from physical location and ownership.
- Represent professional storage with provider record, remote ID, source timestamp,
  last synchronization, and conflict state.
- Support 2D photo-backed layouts first. Keep 3D rendering dependent on the same stable
  location and placement data.

### CAP-08: stocktake and reconciliation

- Create resumable stocktake sessions scoped to a site, container, bin, or full
  workspace.
- Support blind counts where appropriate.
- Compare expected and observed quantities with transparent arithmetic.
- Review discrepancies before applying corrections.
- Handle concurrent inventory writes safely.
- Preserve who counted, who approved, and what changed.
- Keep sealed-stock counts separate from open-bottle volume reconciliation.
- Support offline capture only after conflict, retry, and device-loss behavior is
  specified and tested.

### CAP-09: tasting notes and personal notes

- Let a user create, edit, and delete their own note within policy.
- Record author, workspace, wine or edition, tasting date, body, optional score, and
  confirmed descriptors.
- Keep note edit history or a clear audit event when the text or score changes.
- Allow private notes and workspace-shared notes after visibility rules are approved.
- Keep service telemetry and pour notes separate from tasting notes.
- Keep model-suggested descriptors provisional until a person confirms them.
- Aggregate house or collection taste only from qualifying, confirmed notes and show
  the sample size.
- Never allow one workspace's private notes to affect global ratings.

### CAP-10: ratings, reviews, and drink guidance

- Keep user or workspace reviews separate from external critic and community events.
- Store each external rating as a sourced event with subject grain, source, scale,
  publication date, observed date, URL or reference, and licensing status.
- Aggregate ratings without counting one source more than once for the same subject.
- Prefer edition-level ratings. Label base-wine ratings when no vintage-specific event
  exists.
- Store drink windows with source, vintage, confidence, review state, and override
  attribution.
- Let an authorized user override a recommendation without erasing the prior basis.
- Update notes, scores, and recommendations as new evidence arrives while preserving
  history.

### CAP-11: pricing, valuation, and purchasing intelligence

- Preserve actual acquisition costs by lot and currency.
- Store market price observations as time-stamped, sourced records rather than only
  overwriting a current minimum, median, or maximum.
- Distinguish retail ask, auction result, merchant offer, restaurant list price,
  insurance value, and internal estimate.
- Record tax, buyer's premium, shipping, and other landed-cost components where users
  need them.
- Calculate current estimates from eligible observations under a documented method.
- Show the valuation date, source coverage, range, and confidence.
- Chart cost and market history without implying guaranteed appreciation.
- Support restaurant bottle and glass pricing rules, pour cost, markup targets, manual
  overrides, and published prices.
- Flag possible overpayment or pricing opportunity without rewriting source data.
- Keep marketplace listing, brokerage, payments, tax advice, and sale execution out of
  scope until separately approved.

### CAP-12: search, discovery, and assistant

- Search the user's holdings and the global catalog as separate scopes.
- Search producer, cuvee, vintage, region, country, grape, style, format, location,
  note text, descriptors, purchase period, price range, custody, and availability.
- Tolerate misspellings, punctuation, accents, and producer/cuvee ambiguity.
- Compile natural-language requests into a whitelisted, tenant-scoped query contract.
- Ask for clarification when identity or intent is ambiguous.
- Distinguish answers from the user's collection from catalog suggestions.
- Cite the stored facts used in an answer.
- Never generate free-form SQL or invent IDs, inventory, ratings, notes, or prices.
- Provide typed-query fallback when speech or model providers fail.

### CAP-13: recommendations and insights

- Recommend bottles to drink using available stock, drink-window urgency, source
  quality, user preferences, and approved context.
- Support restaurant pairing, service, pricing, and availability workflows.
- Support collector views for value, maturity, concentration risk, duplicates, missing
  locations, and pending delivery.
- Let users inspect the evidence behind every recommendation.
- Keep inferred recommendations separate from recorded facts.
- Measure scan correction rates, inventory variance, stock movement, pours, revenue,
  note activity, and data-quality gaps where applicable.

### CAP-14: restaurant receiving and operations

- Receive against invoices or import batches with inline exceptions.
- Preserve supplier, invoice, line, lot, cost, and inventory relationships.
- Review unmatched or low-confidence lines before applying stock.
- Place received inventory or leave it explicitly unplaced.
- Track open bottles, pours, closeouts, waste, and service adjustments.
- Reconcile open-bottle volumes independently from sealed-stock counts.
- Support staff wayfinding and service pull lists.
- Define site-specific availability and group oversight; scope inter-site transfers,
  shared storage, purchasing, pars, credits/returns, and shift handoff with the pilot.
- Where transfers are required, represent dispatch, in transit, receipt, and
  discrepancies without duplicating stock at both sites.
- Treat POS and supplier integrations as versioned adapters. Terroir owns physical
  inventory; the POS owns its financial/order facts and suppliers own their documents.
- Specify depletion authority per site and service channel. A manual pour and a POS
  sale of that same glass must produce one physical depletion, with a link between
  the two observations. Message idempotency alone does not establish that link.
- Distinguish void before service, void after service, comp, refund, return, and
  waste. A financial reversal does not automatically restore consumed wine.
- Preserve occurrence time, receipt time, source revision, effective mapping, and
  correction links; define stocktake cutoffs and concurrent-service handling.
- Coordinate stock allocation across channels: opening a 750 mL bottle and serving
  four 150 mL pours leaves 150 mL open before waste. A linked POS bottle line cannot
  remove the same sealed unit again. Unmatched records enter reconciliation.
- Define physical service independently from payment/check status; comped service
  still consumes wine. Return unopened stock only through a physical return event.

### CAP-15: restaurant lists and menus

- Build, reorder, publish, archive, clone, and export wine lists.
- Organize sections and wine entries independently from physical cellar sections.
- Display producer, cuvee, vintage, format, bottle price, glass price, description,
  availability, and approved imagery.
- Suggest prices from restaurant rules while preserving human overrides.
- Record which price and availability state was published and when.
- Generate guest, print, PDF, and accessible mobile views.
- Preserve public menu access as a bounded read surface, not a substitute for private
  sharing.

### CAP-16: collector experience

- Show what the collector owns, where it is, what it cost, what it may be worth, and
  when to consider drinking it.
- Support wishlist, pending delivery, owned, external custody, consumed, gifted, and
  removed states after their event semantics are approved.
- Recall purchases and source invoices from a wine or lot.
- Preserve personal purchase rationale if the owner defines what that field means.
- Support cases and long-lived storage without requiring restaurant service concepts.
- Allow approved household, assistant, advisor, or guest access through capabilities.
- Provide collection exports that retain stable IDs and provenance.
- Make imagery, collection browsing, producer/vintage discovery, ratings, notes,
  price context, and drinking suggestions central to the collector experience.
  Show image scope and source uncertainty without claiming representative images
  are exact evidence of the owned bottle.

### CAP-17: imagery and evidence

- Store label, bottle, invoice, case, receipt, storage, and location images as typed
  evidence.
- Record source, rights, credit, captured or fetched time, applicable vintage and
  format, confidence, and derivative lineage.
- Keep exact-label, producer-representative, and generic representative imagery
  semantically distinct.
- Use signed access for private evidence.
- Support retention, deletion, export, and source removal without orphaning facts.
- Prevent lower-confidence image matches from silently becoming identity authority.

### CAP-18: integrations and data portability

- Import and export through versioned adapters with mapping previews.
- Preserve source system, source record ID, source timestamp, sync timestamp, and raw
  payload reference where lawful.
- Make synchronization idempotent and conflict-aware.
- Never let an external outage overwrite confirmed local facts.
- Support deletion lineage for licensed or revocable datasets and their derivatives.
- Keep provider credentials server-side and out of general logs.

### CAP-19: audit, privacy, and operations

- Enforce RLS or an equivalent database boundary on every private workspace table.
- Use composite same-workspace foreign keys where a cross-tenant reference would cause
  damage.
- Record material mutations with actor, source, timestamp, request or idempotency key,
  and reason.
- Treat service-role paths as privileged and capability-scoped.
- Keep raw images, invoices, costs, provider credentials, and unredacted queries out
  of general logs and replay tools.
- Define access, retention, and permitted use of member-attributed pour and variance
  metrics; do not infer employee misconduct from an unexplained discrepancy.
- Provide backup, restore, migration, retention, deletion, and export procedures.
- Apply schema migrations with paired downs, snapshots, generated types, containment
  tests, and exact-SHA release evidence.

### CAP-20: Atlas and spatial experience

- Let users explore their collection by country, region, appellation, producer,
  vintage, storage site, and physical position.
- Link map and spatial selections to a complete wine dossier.
- Show bottle or placement detail with cost, estimated value, drinking window,
  production or rarity when sourced, provenance, reviews, notes, and location.
- Use a 2D photo-backed container and slot model as the first spatial release.
- Add assisted grids, 3D bottle rendering, LiDAR, photogrammetry, or splats only after
  measured feasibility and a stable placement model.
- Never infer inventory count from a room or shelf image unless a later approved
  contract defines evidence strength and human confirmation.

### CAP-21: AI decisions, assistance, and evaluation

- Explore TypeSafe for candidate alignment, extraction verification, intent routing,
  search ranking, descriptor classification, and evidence checks. These are workload
  hypotheses until tested on representative examples.
- Use perception services for images/audio and generative models for explanation;
  retain deterministic quantity arithmetic, permissions, eligibility, and writes.
- Reuse existing decision/audit mechanisms where possible. For consequential
  production actions retain operation, actor, subject, evidence references, model,
  question/policy versions, typed result, confidence, review, and correction history.
- Evaluate false acceptance, coverage, review time, end-to-end latency, cost, and
  fallback behavior against the current workflow and a simpler baseline.
- Separate calibration/tuning data from held-out evaluation. Sample automatically
  accepted cases as well as corrected cases; record source/tenant restrictions.
- Match automatic action and human review to consequence and uncertainty. Do not
  block routine service on universal approval prompts or a model's availability.
- Keep model-based prompt/citation checks supplementary to code-enforced boundaries.
  Text about a suspected wine fault is not physical confirmation of that fault.
- Keep provider-specific integrations replaceable. Pin evaluated model versions and
  re-evaluate upgrades; provider speed, price, and confidence claims are not proof
  of Terroir performance.

### CAP-22: differentiated and role-aware experiences

- Provide restaurant presets for actual authorized roles, including beverage
  manager, sommelier, and server, with cost visibility and write rights set explicitly.
- Optimize service for rapid location lookup, availability, pours, interruption
  recovery, low light, and shared/concurrent staff work.
- Preserve stable primary controls and navigation. Evaluate generated summaries,
  suggestions, and user-approved dashboard composition as separate experiments.
- Keep the collector's visual discovery emphasis distinct from operational density.
- Enforce capabilities server-side independently of displayed or generated controls.

### CAP-23: enthusiast discovery and purchasing (later horizon)

- Preserve occasion, meal, gift, taste, budget, learning, rating, and wishlist ideas.
- Keep discovery usable when merchant integration is absent, stating that current
  local stock or best price is unknown.
- Make verified merchant price, availability, shipping, format, vintage, observation
  time, rights, and commercial disclosures prerequisites for those specific claims.
- Retain the boundary between purchasing assistance and actual transaction execution.

## 6. Proposed domain and data model

Names in this section express responsibilities and record grain. They are not approved
SQL names.

### 6.1 Workspace and access

| Concept | Required grain | Key relationships |
|---|---|---|
| Workspace | One personal or restaurant tenant | Memberships, collections, sites, settings, capability set |
| Membership | One user in one workspace | Role, explicit capabilities, status, joined/expired/revoked dates |
| Access grant | One bounded share | Subject, recipient, resource scope, capabilities, expiry, revocation, audit |
| Collection | One logical set of holdings | Workspace; optional site or purpose; supports more than one collection per workspace if approved |

### 6.2 Global wine knowledge

| Concept | Required grain | Key relationships |
|---|---|---|
| Producer | One real producer identity | Aliases, locations, external IDs, source assertions |
| Wine product | One producer plus cuvee or named wine | Producer, style, region, grapes, aliases |
| Wine edition | One wine product plus vintage or explicit NV | Vintage facts, ratings, notes, windows, imagery, market observations |
| Bottle format | One standardized package size and shape | Size, package type, GTIN or LWIN identifiers where applicable |
| Edition format | One edition available in one format | External identifiers, label variants, imagery |
| Source assertion | One sourced claim about one subject | Field/value, source, observed date, effective dates, confidence, rights |

Producer, wine product, edition, and format must not be workspace-owned. Writes to
shared identities require controlled resolution and merge paths. Private workspace
facts point to those identities without becoming global catalog truth.

### 6.3 Ownership and inventory

| Concept | Required grain | Key relationships |
|---|---|---|
| Acquisition | One purchase, gift, transfer-in, or other acquisition event | Workspace, supplier or source, invoice, date, currency, fees |
| Acquisition lot | One edition-format and cost basis within an acquisition | Quantity, unit cost, landed cost, pending or received state |
| Holding | Current workspace interest in an edition-format | Derived or reconciled quantity; never the sole history |
| Physical unit | Optional one bottle or sealed case | Lot, condition, serial or tag, custody, placement |
| Inventory event | One typed change | Subject, quantity delta or state transition, actor, reason, evidence, effective time |
| Stocktake session | One bounded counting exercise | Scope, counters, observations, variances, approvals, applied corrections |

The recommended model is hybrid, subject to PDR-003. Lots remain efficient for
ordinary quantity and cost accounting. Physical units appear only when bottle-specific
placement, condition, provenance, custody, or service history creates product value.
Do not require one database row per bottle for every import unless the owner approves a
different grain.

### 6.4 Space and custody

| Concept | Required grain | Key relationships |
|---|---|---|
| Site | One physical or provider-managed location | Workspace or custody provider |
| Container | One room, rack, fridge, shelf, bin, case, wall, or zone | Parent container, geometry, image evidence |
| Slot | One addressable position | Container, coordinates, capacity |
| Placement | One active assignment | Holding lot or physical unit, slot or container, effective dates |
| Custody record | One period of custody | Owner workspace, custodian, location, source record, sync state |

### 6.5 Notes, ratings, and recommendations

| Concept | Required grain | Key relationships |
|---|---|---|
| User note | One authored note on a wine product, edition, lot, or bottle | Author, workspace, visibility, tasted date, edit history |
| Descriptor assertion | One confirmed or proposed descriptor on a note | Origin, confirmer, timestamp |
| External rating event | One source's rating of one wine product or edition | Score, scale, source, publication, URL, rights |
| Rating aggregate | One calculated view for one subject and method version | Inputs, count, computed time; never the source record |
| Drink-window assertion | One sourced or human-authored window | Subject, range, basis, confidence, reviewed state |
| Recommendation | One generated result | Inputs, method version, time, explanation; not a durable fact unless explicitly saved |

### 6.6 Price and value

| Concept | Required grain | Key relationships |
|---|---|---|
| Price observation | One source, subject, price type, currency, and observation time | Edition or edition-format, merchant or venue, URL, availability |
| Cost basis | One acquisition-lot calculation | Components, currency, conversion basis |
| Valuation snapshot | One workspace holding valued under one method at one time | Eligible observations, range, confidence, method version |
| Menu price | One list item price with effective history | Restaurant list, edition-format, glass or bottle, override basis |

Current-value fields may be cached for reads, but the underlying observations and
method version must remain available.

### 6.7 Evidence and integration

| Concept | Required grain | Key relationships |
|---|---|---|
| Evidence object | One image, document, export, scan, or provider payload | Workspace visibility, storage key, hash, source, rights, retention |
| Fact support | One link between evidence and a claimed fact | Extraction method, confidence, confirmer, correction chain |
| Integration connection | One workspace-to-provider authorization | Capabilities, credential reference, status, last success |
| Sync record | One import or synchronization run | Source cursor, counts, conflicts, errors, idempotency key |

## 7. Current schema gap map

This inherited structural assessment is a starting point for baseline reconciliation,
not a fresh production or runtime audit. Verify each affected row against current
code, migrations, and executable evidence before using it in an implementation ticket.

| Current area | What is useful now | Gap against this document | Direction |
|---|---|---|---|
| `restaurants`, `memberships` | Existing RLS-backed restaurant tenancy | Personal workspaces and non-restaurant roles are unresolved | Generalize through a staged compatibility migration; do not rename blindly |
| `canonical_wines` | Global producer plus cuvee identity | Producer is text, not an entity; no global vintage edition | Introduce producer and edition contracts without breaking current IDs |
| `wine_variants` | Vintage and size identity with tenant containment | Variant is restaurant-scoped; proposed global edition does not exist | Separate global edition/format identity from private workspace assertions |
| `wines` | Mature operational row used across the app | Mixes identity, enrichment, cached ratings, pricing, availability, and tenant state | Keep as a compatibility projection while new domains take authority incrementally |
| `inventory_items` | Quantity and unit cost by receipt-like row | No complete acquisition, lot, landed-cost, custody, or optional unit model | Promote to acquisition-lot semantics or migrate into an explicit lot model |
| `availability_events`, `stock_adjustments` | Some stock history and reason data | Event vocabulary is fragmented and does not cover the full lifecycle | Define one inventory-event contract and migrate readers in bounded slices |
| `bins`, `cellar_config` | Existing location and display behavior | No general hierarchy, slot capacity, placement history, or custody | Add site/container/slot/placement contracts, then migrate bins once |
| `wine_notes` | Authored workspace notes with scores and descriptors | Restaurant naming, no visibility policy, no edit-history contract | Re-scope to workspace and add visibility/version decisions |
| `wine_reference_notes` | Vintage-specific sourced reference data | Narrow source kinds and no general claim/event model | Preserve as a bounded source or migrate to sourced assertions |
| rating fields on `wines` | Simple current display | Mixes inferred, external, and cached values; lacks event history | Use user-review, external-event, and aggregate separation |
| retail fields on `wines` | Current min/median/max cache | No price history, type, currency, method, or observation lineage | Add price observations; retain current fields as projections if useful |
| `pricing_recommendations` | Restaurant action suggestions | One current row per wine, no recommendation history | Treat as recomputable output with saved decisions where needed |
| invoice and import tables | Existing intake and review structures | Purchase, lot, evidence, and inventory application are not one canonical lifecycle | Define one acquisition/intake state machine before expanding providers |
| pours and reconciliation | Existing restaurant workflows | Not applicable to personal workspaces; sealed-stock count remains absent | Gate by capabilities and add separate stocktake domain |
| wine lists | Existing restaurant publishing | No effective history for published price/availability | Add publication snapshots only if operational or legal needs require them |

## 8. Data invariants

The detailed schema may change. These invariants may not.

1. Every private row resolves to exactly one workspace through a database-enforced
   path.
2. A global wine identity does not expose which workspace first created or owns it.
3. Unknown vintage is not converted to non-vintage.
4. Vintage-specific facts never attach to a different vintage through fallback.
5. A price, rating, review, image, or drink window retains its source and observation
   time.
6. An aggregate never replaces its contributing events.
7. A correction does not erase the original event or evidence.
8. Private notes never feed global ratings.
9. External synchronization never overwrites a stronger confirmed local fact without
   an explicit conflict decision.
10. Placed physical units cannot exceed available units.
11. The same active physical unit cannot occupy two slots or two custody states.
12. A photograph does not establish quantity without a separately approved count
   contract and confirmation step.
13. Service-role writes verify membership or integration capability before bypassing
   RLS.
14. Deletes that affect inventory, invoices, notes, or evidence state their impact,
   require the proper authority, and leave the required audit record.
15. Retryable writes use durable idempotency keys at the boundary where duplication
   would create a second fact or inventory change.
16. One physical service occurrence has one depletion outcome, even when staff and
   POS each report it. Shared stock allocation prevents double use of the last unit.
17. Sealed count and open volume never sum without a named, dimensionally valid
   conversion. Opening moves stock between states; pouring consumes open volume.
18. Physical service is independent of payment state. A comp or post-service refund
   does not undo consumption; restoring stock requires a physical correction/return.

## 9. Requirement status model

Every requirement promoted from this document must carry one of these statuses:

- **Current and verified:** executable evidence proves the behavior on the named
  baseline.
- **Current but weakly evidenced:** code or schema exists, but behavioral proof is
  incomplete.
- **Approved, not implemented:** the owner approved the product behavior and its
  acceptance criteria.
- **Proposed:** useful direction that still needs an owner decision or evidence.
- **External dependency:** blocked on licensing, credentials, commercial access, or a
  provider contract.
- **Deferred:** deliberately outside the next delivery horizon.
- **Rejected:** explicitly excluded, with a reason and reversal condition.

Do not use `active` as a synonym for shipped.

## 10. Owner decisions still required

PDR-001 is settled. The decisions below change schema grain, permissions, or product
scope and should be answered before database tickets freeze.

Freeze only the decisions needed by the restaurant pilot and shared identity/access
boundaries. Collector-only portions of PDR-004/005/006/007/009 remain open for
collector discovery. Defaults are recommendations, not owner answers. Multi-location
scope (PDR-011) replaces the old defer recommendation. PDR-013 now has an accepted
release sequence (B first, C as soon as practical); its detailed acceptance and
failure policies remain open. The audit records the full supersession history.

| ID | Decision | Recommended default | Why it matters |
|---|---|---|---|
| PDR-002 | Can one workspace contain multiple named collections? | Yes, but one default collection in the first migration | Supports home plus professional storage without multiplying tenants |
| PDR-003 | When does a holding need physical-bottle rows? | Hybrid: lots by default, units on placement or special provenance | Avoids millions of low-value rows while enabling bottle-level history |
| PDR-004 | What are note visibility levels? | Private, workspace, and explicitly shared | Determines RLS, aggregates, and household behavior |
| PDR-005 | What user rating scale should Terroir own? | One stored normalized score plus the original input scale | Prevents future scale migrations and preserves user intent |
| PDR-006 | Which market-price types may feed valuation? | Sourced retail and auction observations under separate methods | Prevents mixed, misleading value estimates |
| PDR-007 | Should price and valuation history be retained indefinitely? | Yes for user costs; bounded retention for external observations by source rights | Changes storage, licensing, and charts |
| PDR-008 | Which case states and count authorities are allowed? | Expected, confirmed contents, sealed, opened, partial, damaged | Defines inventory events and evidence strength |
| PDR-009 | Who may receive a share, and what may they do? | Named users first; expiring view-only links later | Defines access-grant schema and abuse cases |
| PDR-010 | Which external custody provider is first? | None until a lawful API or export contract is selected | Prevents provider-specific schema and credential risk |
| PDR-011 | What multi-location group/site behavior must the restaurant pilot support? | Multi-location target confirmed; clarify site count, shared inventory, transfers, oversight, and access | Sets tenant/site boundaries without assuming every group workflow is launch scope |
| PDR-012 | Is marketplace or sale execution part of Terroir? | No; retain acquisition and value data without transaction execution | Avoids compliance and tax scope entering the core model |
| PDR-013 | What offline reads/writes are required? | Owner accepted B on September 23: cached lookup and offline service/count capture first; C (receiving, transfers, management) is the priority follow-on | Detailed conflict, stocktake cutoff, revoked access, duplicate-device, outage duration, and device-loss behavior still require specification |
| PDR-014 | What does “why I bought this” mean? | User-authored acquisition note linked to the lot | Avoids confusing invoice context with personal rationale |

### Remaining interview: proposed answers to Q6–Q15

Status: all recommendations below accepted on September 23 by “Agree with all,”
with Toast identified as the likely primary POS. The owner also authorized autonomous
implementation, testing, iteration, agent delegation, and mobile optimization.
Recommendation language below preserves the wording approved. Agreement approves
product choices, not unknown operational facts or implied access. Production-release
gates and explicit roadmap deferrals remain as approved in Q15. Engineers may resolve
reversible implementation choices without waiting for the absent owner.

6. **Group and locations.** Recommend a group workspace with separately controlled
   sites, scoped group oversight, consolidated stock views, and tracked transfers.
   Rehearse at one site, then prove the cross-site cycle at two before claiming
   multi-site readiness. Defer central purchasing and warehouse automation. Actual
   site count, whether 70/35/20 are per-site, storage arrangements, and legal stock
   owners remain unknown; different legal owners need a distinct transfer policy.
7. **Primary problem and success.** Propose trusted availability and reduced
   inventory administration as the primary outcome. Provisional pilot targets:
   90% of trained-staff lookup tasks within 10 seconds, 90% of standard-pour logging
   tasks within 3 seconds once the wine is selected, and 50% less staff time for
   the same count/reconciliation scope. Measure baseline and a four-week pilot at
   the same venues; the beverage manager and owner judge success. Offline timing
   measures durable local capture, not server synchronization. No lost acknowledged
   entries, duplicate depletion, or unauthorized access in the required test suite.
   These are proposed targets, not measured results; changes require explicit review.
8. **POS and depletion.** Recommend keeping orders/payments in the existing POS
   and physical inventory in Terroir. Use staff-recorded physical events as the
   initial depletion authority; POS/imported sales corroborate and flag discrepancies,
   never subtract a second time. Do not make an unverified integration a controlled
   pilot prerequisite. Owner update: Toast is the provisional primary vendor, not
   an exclusive commitment. API access, actual pilot configuration, and present
   staff workflow remain unknown. The later blanket approval accepts the proposed
   staff-recorded depletion policy without establishing live Toast access.
9. **Roles and staff data.** Recommend owner/group admin, beverage manager/sommelier,
   shift manager, service staff, and receiving/counting capabilities. Grant site
   access explicitly. Owners and authorized beverage managers see costs/margins;
   service staff see availability, locations, guest prices, and service actions.
   Receiving staff can capture deliveries/counts; managers approve discrepancies.
   Routine service needs no manager approval. Log actor history for accountability;
   keep staff-attributed variance private and exclude automated performance rankings.
   Actual roles, delegates, and retention periods still need validation.
10. **Physical tracking.** Recommend quantities by wine/vintage/format and acquisition
    lot, individually tracked open bottles with remaining mL, and optional individual
    sealed-bottle tags for rare/high-value stock. Venue-defined pour sizes, tasting
    portions, flights, waste, and explicit bottle/table holds share one stock model.
    Show estimated open volume as estimated. Do not require every bottle to be tagged.
11. **Receiving and counts.** Recommend invoice photo/PDF/CSV capture with review
    of uncertain identities, quantities, costs, and vintage before posting; record
    shortages, damage, returns, and supplier credits separately. Start with daily
    open-bottle checks and weekly full counts, then tune frequency using pilot effort
    and variance. Beverage managers own unresolved discrepancies. Actual suppliers,
    source files, and existing count practices remain unknown.
12. **Devices and service UX.** Recommend phone-first service, shared-tablet support,
    and desktop management; rapid staff identification without shared identities.
    Use readable low-light screens, large stable controls, interruption recovery,
    scan-assisted lookup, and a manual fallback. Voice is optional, never required
    in a noisy venue. Devices and shared-device authentication need field validation.
13. **AI authority.** Recommend early assistance for import checks, wine matching,
    search, pairings, concise staff explanations, and anomaly detection. Evaluate
    TypeSafe for bounded judgments/ranking against rules and current alternatives;
    use separate perception/generative services where needed. Permit validated,
    authorized low-risk assistance automatically; require confirmation for uncertain
    identity, count adjustments, purchasing, pricing, or access changes. Normal
    authorized pours do not need an AI review. Keep role controls stable; generated
    suggestions/composition must not rearrange service controls mid-task. Ground
    factual wine advice in sources, show uncertainty, isolate tenant data, and keep
    core service usable without AI. Model quality, latency, spend caps, provider data
    permissions, and exceptional-action review thresholds remain explicit gates.
14. **Collector scope.** Recommend the next customer release after the restaurant
    pilot: image-led browsing, exact location, producer/vintage information, provenance,
    purchase prices, sourced value observations, note/rating history, drink-window
    guidance, pairings, and discovery within the owned collection. Support multiple
    cellars and delegated access. Preserve 3D exploration, merchant integrations,
    and later enthusiast purchasing in the roadmap without making them restaurant
    launch requirements. Collector scale/custody examples and data/image rights remain
    to be verified; unknown valuations or missing exact images stay explicit.
15. **Launch and autonomous-run boundaries.** Recommend an invite-only restaurant
    pilot in one selected country and operating currency; no alcohol checkout/sales
    execution in the first release. Use readiness gates rather than an invented date:
    verified critical journeys, tenant/site isolation, offline recovery, migration and
    backup/restore rehearsal, monitoring, and independent adversarial review. Require
    a genuinely isolated test environment before claiming staging proof. Prepare
    implementation/testing autonomously after the build contract is approved; retain
    a separate owner gate for production data/migrations, merge-to-main deployment,
    paid services beyond existing approvals, and live release. Country/currency,
    pilot access, budget caps, and deadline remain unknown; initial commercial success
    is continued pilot use and validated willingness to pay, not assumed revenue.

## 11. Delivery sequence

### Phase 0: approve the contract

1. Finish the owner interview, preserving the maximum of 15 numbered questions.
   Q1–Q5 have answers and Q6–Q15 recommendations are approved, including Q7's proposed
   pilot metrics. Q8 names Toast as the likely primary vendor. Missing operational
   facts remain unknown; pilot measurements are not established by approval.
2. Record PDR-002 through PDR-014 and the additional POS, service, role, pilot,
   and AI decisions identified in the September 22 audit. Distinguish accepted
   owner decisions, proposed defaults, and unanswered questions.
3. Mark each capability as required now, later, experiment, deferred, or rejected;
   map it to current code/schema/evidence without treating presence as runtime proof.
4. Define the receive/place/find/serve/count/reconcile journey, group/site boundary,
   one-depletion rule, offline behavior, and measurable pilot success criteria.
5. Amend `app_spec.txt` through the source-ledger process for approved requirements
   and regenerate the feature ledger. Do not hand-edit `docs/feature-ledger.json`.

### Phase 1: schema and migration design

1. Produce an entity and event model with stable record grain.
2. Map every current table and reader to keep, adapt, project, migrate, or retire.
3. Design the workspace compatibility path and RLS matrix.
   Map group, stock/legal owner, workspace, site, collection, and membership onto
   existing restaurant IDs before selecting a migration. Test site-limited access,
   group manager grants, and linked cross-site transfers; do not silently widen RLS.
4. Design producer, wine product, edition, format, lot, inventory-event, location,
   note, rating, and price-observation boundaries.
5. Define migration ordering, dual-read or compatibility views, rollback, and data
   quality reports.
6. Review the plan independently before writing migrations.

### Phase 2: minimum shared foundation for the restaurant pilot

1. Land only the workspace/site compatibility needed by the agreed pilot without
   changing existing restaurant behavior.
2. Reuse global identity structures; add only demonstrated gaps and resolution reports.
3. Adapt existing acquisition and inventory operations to the agreed event contract;
   avoid a wholesale rewrite when compatible extensions satisfy the pilot.
4. Add note, cost, and provenance contracts required by the restaurant pilot in
   separately reviewable slices; defer unrelated valuation/collector expansion.
5. Keep current application projections until each reader has moved and passed its
   regression suite.

### Phase 3: restaurant pilot and inventory cycle

Deliver receive, place, find, serve, count, and reconcile with the agreed site
permissions and group workflows. Keep sealed-stock counts and open-bottle volume
reconciliation distinct. Prove no double depletion from staff/POS records, retries,
and order revisions. Verify the offline and transfer cases that the pilot requires.
Measure staff task performance against its current baseline. A one-site rehearsal
does not establish multi-site readiness.

Before building, choose the metric unit, site scope, time period, baseline, target,
judge, and stop/descope conditions. Offline writes must pass replay after partial
failure, stocktake-cutoff, revoked-access, and concurrent-device cases. Q5 establishes
B as first-release behavior and C as the priority offline extension; specify the
remaining failure/authorization policies and C's acceptance gates before building it.

AI fixture experiments may run during discovery. Introduce successful helpers in
shadow mode before enabling their authorized actions. A new table family is not
a prerequisite to evaluation. Production decisions need the agreed audit/review
contract, a held-out evaluation, fallback behavior, and an operational owner.

### Phase 4: personal collection vertical slice

Deliver personal workspace creation, intake, confirmed or explicitly unresolved
identity, acquisition lot, quantity, location or unplaced state, private evidence,
notes, ratings, cost, and image-led collection browsing. Add collector-specific
custody, provenance, value, and drinking guidance according to its release scope.
Prove that existing restaurant journeys did not change.

### Phase 5: deeper intelligence and spatial work

Add price history, valuations, sourced ratings, drink guidance, Atlas, assisted grids,
voice, and 3D only after the shared entities and evidence contracts are stable.
Basic versions required by an approved earlier release can ship in that slice;
this phase covers deeper expansion. Enthusiast discovery follows the priority
markets; merchant-dependent promises require verified access and rights.

## 12. Verification requirements for future implementation

Every schema-affecting slice must include:

- an approved requirement ID and acceptance criteria;
- current-schema and production-shape data analysis;
- paired migration and down migration;
- schema snapshot and generated TypeScript types;
- RLS and cross-workspace containment tests;
- idempotency and concurrency tests for state-changing paths;
- migration tests for null, duplicate, unknown-vintage, non-vintage, multiple-lot,
  multiple-currency, and cross-workspace cases;
- API and UI regression coverage at the actual claim layer;
- exact changed-row and unresolved-row reports for backfills;
- independent review before merge;
- exact-SHA staging and release evidence before production promotion.

### Restaurant acceptance scenarios for approved implementation tickets

1. One 750 mL bottle opened and four 150 mL pours leave 150 mL open before waste;
   linked POS reporting never removes the same sealed bottle again.
2. A six-unit dispatch and five-unit receipt leave one explicitly unresolved unit
   under an accountable owner/custodian; unrelated site staff cannot access it.
3. Replaying a permitted offline write after partial failure yields one domain
   outcome, and a stocktake cutoff preserves later service activity.
4. A wrong suggested producer match leaves the import unresolved after rejection;
   a confirmed correction and reversal retain source evidence and history.
5. Comp, split, reopen, and refund updates preserve served wine consumption,
   including out-of-order delivery of those updates.

These scenarios operationalize the approved inventory/recovery requirements; they
are not passing test results. Q5 approves the B-to-C offline direction. The execution
contract records reversible engineering policies and required tests. Direction
approval does not prove either tier works.

## 13. Source reconciliation

| Source | What this document retains | Boundary retained |
|---|---|---|
| `app_spec.txt` and `docs/feature-ledger.json` | The 269-feature restaurant core | Active does not prove shipped; later requirements still need promotion |
| `docs/plans/_archive/2026-08-21-camera-first-personal-cellar-prd.md` | Personal tenancy, capture, cases, custody, purchase provenance, search, sharing, privacy | Archived plan was not implementation authority; PDR-001 now resolves its largest blocker |
| `docs/plans/2026-08-24-visual-wine-platform-prd.md` | Global editions, source-aware ratings, physical placement, voice, 3D substrate | Demo-specific targets and provisional migration numbers are not adopted as current implementation facts |
| `docs/plans/2026-08-30-terroir-product-prd.md` | One platform for collectors and restaurants, deep wine attributes, conversational access, 3D direction | Field-walk tiers are not a complete domain model |
| `docs/plans/2026-08-30-field-walk-decisions.md` | Export-first migration sources, visual-match direction, corpus boundary, 2D spatial v1, invoice deletion semantics | Delegated decisions remain reversible and do not settle the unified domain model |
| `docs/plans/2026-09-02-competitor-audit-adoption-plan.md` | Bulk capture, location documents, provenance, wine page, receiving, stocktakes | Competitor patterns remain evidence, not automatic scope |
| `docs/superpowers/specs/2026-09-03-wine-page-design.md` | Authored notes, confirmed descriptors, source-aware ratings and drink windows | Proposed aggregates require real notes and provenance |
| `docs/plans/2026-09-08-restaurant-mobile-journey.md` | Setup, import, service, reconciliation, and explicit sealed-stocktake gap | Selected journey verification does not prove the full product |
| Current schema and `docs/ARCHITECTURE.md` | Existing RLS, identity spine, inventory, notes, pricing, lists, pours, and reconciliation | Current restaurant-shaped implementation remains the compatibility baseline |
| `codex/mobile-demo-experience` at `b9a35266` | Candidate Home, Cellar, Atlas, Somm, and Menu navigation model | Branch is not on `main`; it is not treated as shipped in this document |

## 14. Document acceptance checklist

This draft is ready for owner review when:

- restaurant and personal-collector capabilities are both represented;
- the workspace decision is recorded separately from unresolved schema naming;
- producer, wine product, vintage, format, lot, physical unit, note, rating, price,
  location, and evidence grains are distinct;
- current implementation and proposed requirements are not conflated;
- every source document above has a stated contribution and boundary;
- open decisions are explicit enough to answer without reading the entire archive;
- no code, migration, provider, deployment, or production change is implied by approval
  of the document alone.

## 15. Change and decision history

- 2026-09-20: original consolidated draft, CAP-01 through CAP-20; existing PDR-001
  approval retained from the earlier document.
- 2026-09-22: recorded restaurant-first sequence, multi-location target, and Terroir
  inventory authority from owner answers. Added CAP-21/22/23 for AI, role-aware
  experiences, and the later enthusiast vision. Corrected POS authority and
  cross-source depletion rules. Collector-only schema choices remain open.
- 2026-09-22: Opus 5 challenged the proposed plan. The linked audit records findings,
  accepted/rejected recommendations, source limitations, and acceptance scenarios.
  The interview is incomplete; this revision is not a final approved build contract.
- 2026-09-23: owner accepted offline B for the first release and C as the intended
  outcome as quickly as possible. Added recommended answers to Q6–Q15 for batch
  approval; none of those recommendations or missing facts is silently accepted.
- 2026-09-23: owner identified Toast as the likely primary POS (Q8 partial answer).
  Recorded a provisional Toast-first target without assuming API access, exclusive
  vendor use, a depletion policy, or approval of the remaining recommendations.
- 2026-09-23: owner approved all Q6–Q15 recommendations and explicitly requested
  /goal implementation through production readiness, mobile optimization, arbitrary
  agent delegation, and JEV verification. Prior unapproved status is superseded;
  unknown facts, empirical pilot results, and the approved release gates remain.
