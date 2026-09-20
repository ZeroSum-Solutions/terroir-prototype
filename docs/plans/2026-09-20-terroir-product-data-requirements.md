# Terroir Product and Data Requirements

**Status:** Draft for owner review. This document does not authorize implementation,
schema migrations, provider calls, deployment, or production data changes.

**Date:** 2026-09-20

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

### Decision PDR-001: shared workspace foundation

**Status:** Accepted by the owner on 2026-09-20.

Replace the product-level assumption that every tenant is a restaurant with a general
workspace or collection owner. The exact table and migration names remain a schema
design decision. The required behavior is:

- a workspace has a stable identity and a type such as `personal` or `restaurant`;
- users join workspaces through memberships and capabilities;
- both workspace types can own collections, inventory, notes, prices, locations, and
  evidence;
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
- Model transfers between restaurant sites only after multi-venue requirements are
  approved.
- Treat POS and supplier integrations as external adapters, not sources of truth.

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

| Current area | What is useful now | Gap against this document | Direction |
|---|---|---|---|
| `restaurants`, `memberships` | Proven RLS-backed restaurant tenancy | Personal workspaces and non-restaurant roles are unresolved | Generalize through a staged compatibility migration; do not rename blindly |
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
| invoice and import tables | Strong intake and review foundation | Purchase, lot, evidence, and inventory application are not one canonical lifecycle | Define one acquisition/intake state machine before expanding providers |
| pours and reconciliation | Strong restaurant operations | Not applicable to personal workspaces; sealed-stock count remains absent | Gate by capabilities and add separate stocktake domain |
| wine lists | Mature restaurant publishing | No effective history for published price/availability | Add publication snapshots only if operational or legal needs require them |

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
| PDR-011 | Is multi-venue restaurant support in the next horizon? | Defer until a real operator supplies requirements | Avoids premature organization hierarchy |
| PDR-012 | Is marketplace or sale execution part of Terroir? | No; retain acquisition and value data without transaction execution | Avoids compliance and tax scope entering the core model |
| PDR-013 | What offline writes are required? | Stocktake capture only after conflict behavior is specified | Offline inventory mutation has high reconciliation risk |
| PDR-014 | What does “why I bought this” mean? | User-authored acquisition note linked to the lot | Avoids confusing invoice context with personal rationale |

## 11. Delivery sequence

### Phase 0: approve the contract

1. Review this document and record PDR-002 through PDR-014.
2. Mark each capability as required now, later, deferred, or rejected.
3. Convert the approved subset into observable acceptance criteria.
4. Amend `app_spec.txt` through the source-ledger process and regenerate the feature
   ledger. Do not hand-edit `docs/feature-ledger.json`.

### Phase 1: schema and migration design

1. Produce an entity and event model with stable record grain.
2. Map every current table and reader to keep, adapt, project, migrate, or retire.
3. Design the workspace compatibility path and RLS matrix.
4. Design producer, wine product, edition, format, lot, inventory-event, location,
   note, rating, and price-observation boundaries.
5. Define migration ordering, dual-read or compatibility views, rollback, and data
   quality reports.
6. Review the plan independently before writing migrations.

### Phase 2: shared foundation

1. Land workspace compatibility without changing restaurant behavior.
2. Land global identity additions and resolution reports.
3. Land acquisition lots and inventory events behind existing workflows.
4. Land note, rating, price, and provenance contracts in separately reviewable slices.
5. Keep current application projections until each reader has moved and passed its
   regression suite.

### Phase 3: personal collection vertical slice

Deliver one complete path: personal workspace creation, one-bottle intake, confirmed
identity, acquisition lot, quantity, location or unplaced state, private evidence,
note, cost, and collection view. Prove that existing restaurant journeys did not
change.

### Phase 4: restaurant inventory cycle

Deliver receiving, bin-scoped stocktake, discrepancy review, conflict-safe apply, and
audit evidence. Keep open-bottle reconciliation as a separate workflow.

### Phase 5: deeper intelligence and spatial work

Add price history, valuations, sourced ratings, drink guidance, Atlas, assisted grids,
voice, and 3D only after the shared entities and evidence contracts are stable.

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
