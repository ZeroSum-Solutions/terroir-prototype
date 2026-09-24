# Toast corroboration contract

Status: bounded implementation contract for approved Q8 / C08, September 23,
2026, incorporating two Opus reviews and a Sol adversarial re-plan. No live Toast
access verified; no connector enabled. Slice A is fixture/manual-only and cannot
close live C08. Source promotion precedes implementation; Slice B activation
requires the independent provider evidence listed below.

## Verified documentation and remaining wire-level inference

Standard access is read-only, can cover several configured locations, and excludes
sandbox access. API requests remain location-specific. The customer's actual
entitlements and credential configuration are unknown.
[Standard access](https://doc.toasttab.com/doc/devguide/devApiAccessUserGuide.html)

A webhook subscription uses one credential set and can deliver events for all its
linked locations. The guide requires Restaurant Management Suite Essentials or
higher at included locations and Manage Integrations permission. Neither is
verified for the pilot.
[Subscriptions](https://doc.toasttab.com/doc/devguide/devApiAccessWebhookSubscriptions.html)

Orders events carry event GUID, timestamp, restaurant GUID and a complete order
snapshot. They are not physical-depletion commands; payloads can exceed 600 KB.
[Orders webhook](https://doc.toasttab.com/doc/devguide/devOrdersWebhookRef.html)

The signing example concatenates body and timestamp, computes HMAC-SHA256 using
the subscription secret, then Base64-encodes the result in Toast-Signature.
Preserving original bytes is Terroir's implementation requirement. The body has a
timestamp; the documented header list names no separate signing-timestamp header.
Using the body timestamp is an inference to verify with a real signed event before
activation, not a confirmed wire-level guarantee.
[Signing](https://doc.toasttab.com/doc/devguide/apiMessageSigning.html)
[Headers](https://doc.toasttab.com/doc/devguide/apiHttpHeaders.html)

Acknowledgment is required within two seconds. Timeouts, 404, 429 and 5xx trigger
retries after five minutes and then ten minutes; other 4xx and redirects do not.
These published rules do not establish unlimited redelivery or outage recovery.
[Timeouts](https://doc.toasttab.com/doc/devguide/apiTimeouts.html)
[Retries](https://doc.toasttab.com/doc/devguide/apiRetrySupport.html)

The full Selection schema documents item/option references, decimal quantity,
units, modification dates, split-origin references, void flags and refund details.
An API schema field is not proof it appears in every webhook; the short webhook
sample omits some fields.
[Selection](https://doc.toasttab.com/openapi/orders/tag/Data-definitions/schema/Selection/)

Standard scopes include orders:read and menus:read. This documents capability,
not the pilot's entitlement. Do not request guest, delivery-address, payment-write
or staff scopes for corroboration, or fetch omitted guest details.
[Scopes](https://doc.toasttab.com/doc/devguide/devApiAccessScopes.html)

## Ingestion and containment

Staff physical events remain the initial depletion authority. POS observations,
including comp, refund, void and delete, never write `pour_events`, `open_bottles`,
`inventory_items`, `bottle_closeouts`, `stock_adjustments`, or
`inventory_command_receipts`. This prohibition includes import, mapping and
conflict resolution. Use a
separate integrations/pos/toast domain and POS route namespace, not notification
toasts or existing bottle-volume/invoice reconciliation routes. Do not reuse
inventory command receipts: their actor is an authenticated person.

Each subscription endpoint resolves one configured connection and server-side
secret reference. The endpoint token is routing, not authentication. After
verification, only the signed body's `details.restaurantGuid` may bind a site
through that connection's administrator-approved allowlist. Restaurant, event,
retry and Content-Length headers are untrusted metadata, not tenant authority.
Never accept a Terroir tenant ID from an
event, infer a site from wine identity, or try every stored secret. Confine the
non-session service-role path to one module/RPC with explicit connection/site
containment: service-role access bypasses RLS and needs direct cross-site tests.
Ordinary staff cannot configure connections, secret references or mappings.

Read the body once with a stream byte limit, strict UTF-8 and JSON validation.
Do not consume it through shared parseJson and then reserialize. The proposed
initial cap is 2 MiB: an engineering limit above the documented 600-KB warning,
not a provider maximum. Test accepted payloads above 600 KB and over-limit failure.
Extract only the bounded, still-untrusted timestamp needed for verification;
business fields have no authority until the signature passes. Compare decoded
equal-length signatures in constant time. Never log body, signature or secret.

Local fixtures test the body-timestamp interpretation; live activation stays
blocked until a signed sample confirms it. Do not build a speculative alternative
header scheme. Record signed-event age without an arbitrary rejection window;
durable event-ID deduplication provides replay safety. Future rotation uses explicit
subscription identities and approved secret provisioning, not automatic rotation.

The pre-ack path resolves the connection/secret, streams once up to 2 MiB + 1
actual bytes, performs strict decoding and timestamp extraction, verifies the
preserved body, and makes one bounded persistence RPC. No mapping, comparison,
outbound request, physical-ledger access or awaited Sentry/network call belongs
on that path. Persist an allowlisted observation envelope and body hash atomically
before 2xx; mapping/comparison runs afterward. Retain source IDs/timestamps, quantity/unit
tokens and necessary status flags, not raw payload, guest text, arbitrary display
names, tab names, payment objects or staff details. A signed unknown-site event
stores only connection-scoped quarantine metadata/hash, never a guessed site's
sales. Test-mode events never corroborate real sales.

Missing/unreadable configured secret or persistence failure returns 503. Invalid
UTF-8/JSON/timestamp shape returns 400; missing/malformed/mismatched signature
returns 401; actual streamed bytes above the cap returns 413. Before a terminal
400/401/413, update a bounded UTC-hour failure bucket keyed by connection and
allowlisted failure class. Retain buckets for 30 days with count, first/last time
and bounded byte-count metadata, not bodies, hashes, event IDs, restaurant IDs or
claimed sites. Unknown endpoint tokens create no durable records. A bucket-write
failure returns 503. Thus unauthenticated requests cannot create unlimited rows.

Terminal 4xx deliberately creates a provider non-redelivery coverage gap visible
to operators, with manual recovery guidance; it is not silently treated as sync
success. A durably recorded duplicate, conflict or verified quarantine returns
2xx without inventory effects. No unverifiable payload is accepted to obtain 2xx.
No redirects. Local timing is not proof the deployed receiver meets the two-second
acknowledgment requirement.

## Snapshots, quantities and mappings

- Enforce unique (connection_id, restaurant_guid, event_guid). Exact replay returns
  the original receipt; changed bytes under the same ID create a separate conflict
  relation unique on (receipt_id, conflicting_body_sha256). Repeat conflicts
  update first/last-seen/count metadata, not original evidence or row cardinality.
  Observed time is not part of the unique key. Persist a schema version.
- Interpret full snapshots, not additive sale deltas. Materialize one accepted
  interpretation per order; never sum old and new snapshots. Receipt order is not
  source revision. Preserve event and modification timestamps separately.
  Demonstrably older snapshots cannot replace newer ones. Contradictory clocks,
  equal source version with changed normalized business content, or missing
  required identity/time become needs-review. No receipt-sequence/GUID/AI tie-break.
  The local conservative version is (event timestamp, maximum available order/
  check/selection modification timestamp), requiring the order modification time.
  A candidate supersedes only when neither component regresses and at least one
  advances. Equal pairs with equal normalized content are equivalent; changed
  content conflicts. Mixed-direction pairs abstain. This is a Terroir comparison
  rule, not a promised provider revision counter; tests must prove each branch.
- Scope selection identity to restaurant/order, not permanently to its containing
  check: moving the same selection must not duplicate it. Retain check/splitOrigin
  provenance. Split-origin presence does not establish quantity apportionment.
  Ambiguous split/merged identities remain needs-review until a complete snapshot
  and verified conversion reconcile them.
- Traverse recursive Selection.modifiers with parent GUID and depth, bounded at
  an engineering limit of eight. Overflow makes the order incomplete; descendants
  are never silently dropped. Composition of parent/modifier quantity is unknown
  without a reviewed conversion rule. An ancestor and descendant mapped to the
  same liquid may contribute at most once. Use Toast GUIDs, never names, PLU,
  external IDs or multi-location IDs as identity. Deferred and gift-card sale/
  reload selections are nonphysical and excluded; OPEN_ITEM and SPECIAL_REQUEST
  need reason-coded manual review without persisting free-text names.
- Preserve bounded decimal quantity tokens losslessly and persist exact numeric
  values plus source unit. Never round to bottles or accidentally convert floats
  to ml. Unknown units/nonrepresentable values are needs-review; a fractional
  quantity alone proves neither liquid volume nor a valid split.
- Effective-dated, reviewed mappings bind item/option IDs to variant, format and
  an explicit conversion. Interpret with the mapping effective at POS occurrence
  time, not replay time. Missing occurrence time abstains. A mapping edit never
  mutates old observations; authorized reinterpretation creates a linked version.
  For a newly observed selection use its documented createdDate when present;
  absent/invalid dates need review, not the newer order-update timestamp. Later
  snapshots retain that selection's original mapping binding. A verified split
  descendant inherits its source binding, otherwise it also needs review.
  AI can propose mappings, not approve them.
- Automated mapping requires stable selection and item/option GUIDs, exact
  quantity, explicit source unit, selection.createdDate, and a reviewed effective
  conversion. Do not substitute check/order dates for selection occurrence time.
  Missing detail yields insufficient_selection_detail: unambiguous selections
  may display, but the order is incomplete and cannot claim full reconciliation.
  Slice A permits a privileged operator to supply missing mapping, conversion
  and occurrence time with reviewer/provenance metadata as a linked interpretation
  version; the receipt remains immutable. Slice B may enrich the same verified
  order/selection via per-order Orders GET only after acknowledgment and verified
  orders:read/site entitlement, real response shape and minimization. No raw
  response or guest, payment or staff data is retained.
- Financial reversal and physical service are separate facts. A void flag alone
  cannot establish whether wine was served. Comp/refund fixtures use documented
  fields where available and label invented examples synthetic. Unknown shapes
  abstain. Delete differs from void; neither restores liquid.
- Preserve the exact POS fulfillment enum separately from physical service.
  SENT/READY is POS/KDS post-fire evidence, not proof wine was served; NEW/HOLD is
  current pre-fire state, not proof the item was never fired. Missing/unrecognized
  is unknown. Before/after physical service classification requires a qualifying
  linked physical event or authorized operator decision. No financial reversal
  restores liquid.
- POS-side comparison links observations to physical events without changing them.
  Expose unmatched sale, unmatched physical event, quantity mismatch, mapping
  uncertainty and stale/unknown synchronization separately.

## Operator truth and delivery slices

Distinguish disabled, configured-but-unverified, capability-blocked, live-active
and live-degraded/unknown connection states. Fixture/manual-import is a provenance label, not a way
to promote a connection. Show last verified receipt time and failures; silence
does not prove health. Surface permanent-rejection coverage gaps and incomplete
selection detail. If real webhooks systematically lack required identity/unit/time
and the gated GET fallback is unavailable, mark capability-blocked, not live-active
or merely degraded; C08 remains incomplete. Staff see service status, while
privileged users manage mappings and conflicts.

Slice A: local adapter, durable fixture/manual-import path and operator UI, with
live activation disabled and no public endpoint provisioned. Source assertions
and route-ledger entries precede code. No Orders pull runs in Slice A.
Choose additive migrations after the C02/C04 checkpoint; do not modify physical
events or inventory receipts for POS observations. Manual backfill is explicitly
non-live. API-pull backfill is gated on actual entitlements, limits and minimization.

## Required evidence

Slice A tests: preserved-byte signing; missing/wrong/tampered signatures; above-
600-KB and over-limit bodies; duplicate and conflicting event IDs; out-of-order/
equal-version snapshots; moved/split/merged selections; decimal/unknown units;
void/delete/comp/refund distinctions; mapping effective time; unknown/cross-site
containment; test-mode and PII omission; connection-state truth; persistence before
acknowledgment and failure recovery; bounded failure-bucket cardinality/retention;
recursive modifiers and depth overflow; insufficient-detail UI; and fulfillment
history that cannot misstate physical service. Replay exercises real local
persistence. Row-and-value comparison of all six forbidden relations listed
above proves zero physical changes across these cases.

Slice B activation: confirmed entitlements/scopes and GUID bindings; safely
provisioned secrets; a real signed event confirming timestamp handling; real
selection/split/void/refund samples; operator-reviewed order comparison; observed
acknowledgment timing and outage/backfill recovery. Documentation and synthetic
fixtures cannot substitute. No account creation, credential rotation, purchase
or production configuration occurred here.
