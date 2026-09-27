# Bottle-location receiving contract

## Status and authority

Accepted for bounded implementation on September 27, 2026. The contract is not yet
implemented or runtime-verified. It does not reserve a migration number, authorize a hosted
database change, or complete the broader placement program.

This document materializes the owner-approved CAP-07, C02, and C06 receive/place boundary.
The reviewed source contracts were `bottle-location-confirmation-contract-v2.json` at SHA-256
`0afd754c4beada505cc0933828d708e59fc5a77ae133fe194f45fccbb3e4559d` plus the 23-operation
v3 correction at SHA-256
`e0f1416f9d164093f9c9d9c3d0b9d4b7512cf48126a4befdddb6cd0a794f155c`. Independent
database reviews accepted the design at SHA-256
`3d1730e6e278a4de6cf0a95ebdadc0f8826fd71c4dccfaeba262732bcf9188ef` and
`c0b1800b89339c79388a2c18eb2e622f4b91557ba23416d5b62b8014841f85fe`.
The complete contract appears below so implementation does not depend on those machine-local
review paths.

## Scope

One operation receives exactly one previously uncounted sealed bottle of one already selected
current-site wine and places that unit in one explicitly selected active current-site bin. It is
not relocation, opening, pouring, counting, reconciliation, wine matching, bin creation, or bin
renaming.

The client may use typed text to filter active-bin choices. Text never becomes a bin identity,
creates a bin, or falls back to free-text placement. The existing broader unplaced-queue
requirement remains valid but does not change this location-required route.

This compatibility leaf does not define facility, room, fixture, zone, shelf, or slot hierarchy;
per-lot or per-bottle placement; grain-aware movement; placement history; transfer, return,
credit, or count workflows; sealed-unit tags; or cost entry. Those remain required later. This
leaf alone does not complete the full C06 workflow.

## Database boundary

The exact function is:

`public.receive_bottle_at_location_private(p_restaurant_id uuid, p_operation_id uuid,
p_wine_id uuid, p_section text, p_bin_id uuid) returns jsonb`

It has no defaults or overloads. It is PL/pgSQL `SECURITY DEFINER`, owned by `postgres`, uses
`SET search_path = ''`, and schema-qualifies every object and function. The migration revokes
`EXECUTE` on the exact signature from `PUBLIC`, `anon`, `authenticated`, and `service_role`,
then grants only `authenticated`. Receipt-table privileges remain private.

### Authorization and validation

The function requires non-null `auth.uid()` and
`public.current_site_role_at_least(p_restaurant_id, 'staff')` at execution time, including
replay. Removed, expired, revoked, foreign-site, and non-current members cannot create or replay
an operation.

All five arguments are non-null. The function applies `btrim` to `p_section`, requires a
non-empty result, and enforces `char_length(...) <= 200`. `p_wine_id` must identify an existing
wine at the exact site. `p_bin_id` must identify an existing active bin at the exact site, where
`retired_at is null`. The function performs no metadata matching, find-or-create, code lookup,
fuzzy lookup, case-insensitive identity inference, or bin creation.

Missing and foreign wines share one non-oracular refusal. Missing, foreign, and retired bins
share one non-oracular refusal.

### Receipt compatibility and exact shapes

Extend `public.inventory_command_receipts` with this exact version-3 variant:

- `command_version = 3`
- `command_type = 'bottle_location_receive'`
- `scope_kind = 'single_wine'`
- relational `wine_id is not null`
- `batch_entry_count is null`

Preserve every version-1 and version-2 branch, the version-3 `bottle_inventory_save` branch,
the completion pair, request and result object constraints, scope and batch-count constraints,
private table ACLs, existing readers, and existing function grants.

Receipt identity remains the site-scoped primary key `(restaurant_id, operation_id)`. Within
one site, command type and the exact request bind the operation. The same random operation UUID
at another authorized site is a different key. It is neither a replay nor a conflict, and no
function performs a cross-site UUID lookup.

The exact request payload is:

```json
{
  "version": 3,
  "kind": "bottle_location_receive",
  "wine_id": "<operation-time wine UUID>",
  "section": "<normalized section>",
  "bin_id": "<selected bin UUID>",
  "quantity": 1
}
```

The exact stored result has ten keys:

```json
{
  "version": 1,
  "kind": "bottle_location_receive",
  "status": "committed",
  "operationId": "<operation UUID>",
  "inventoryItemId": "<created inventory item UUID>",
  "wineId": "<operation-time wine UUID>",
  "section": "<normalized section>",
  "binId": "<selected bin UUID>",
  "binCode": "<canonical code locked at commit>",
  "quantity": 1
}
```

`request_payload` and `result_payload` are immutable historical facts. A legitimate wine merge
may repoint relational receipt and inventory-row `wine_id` values, but it does not rewrite the
JSON. Completed replay returns the original stored result without requiring the original wine
row or the bin's current code or active state.

The function returns those ten keys plus one internal boolean key, `replayed`. The HTTP route
validates all eleven keys, removes `replayed` from the response body, and exposes it only through
`Idempotency-Replayed`.

### Transaction and lock order

After current authorization and deterministic input normalization, the function locks the exact
same-site receipt row `FOR UPDATE` before consulting mutable wine or bin state. A found receipt
must match the actor, version, command type, scope, null batch count, and exact request. It must
also have `completed_at` and the exact stored-result shape. An incomplete or malformed receipt
fails closed as uncertain. A completed exact match returns the immutable result without
rechecking current wine or bin state.

A new operation uses this order in one transaction:

1. Lock the exact current-site wine `FOR NO KEY UPDATE`.
2. Insert the receipt claim with `ON CONFLICT (restaurant_id, operation_id) DO NOTHING`.
3. If another transaction won, lock that receipt and return only a completed exact replay.
   Every mismatch or incomplete result fails closed before mutable bin checks.
4. For a newly claimed operation, lock the exact active current-site bin `FOR SHARE` and capture
   its canonical code.
5. Insert exactly one `inventory_items` row and capture its generated ID.
6. Complete the receipt with the exact stored result and one statement timestamp.

Any failure rolls back the receipt claim and inventory insert together. Wine-before-receipt
ordering stays compatible with physical commands and wine merge. The bin lock serializes receive
against rename, retirement, and deletion, so committed `bin_id` and `bin_location` identify the
same active row.

Concurrent exact calls at one site with one operation UUID create one inventory row and return
the same result. Within that site and operation key, a changed actor, wine, section, bin, command
type, version, scope, batch count, or request conflicts without mutation. Two distinct UUIDs for
two physical bottles each create one row, even when their wine and bin details match.

### Inventory effect and cost boundary

The first committed execution inserts exactly these values:

| Column | Value |
|---|---|
| `id` | generated once and stored in the receipt |
| `restaurant_id` | `p_restaurant_id` |
| `wine_id` | `p_wine_id` |
| `invoice_scan_id` | `null` |
| `quantity` | `1` |
| `unit_cost` | `0` |
| `currency` | `null` |
| `format` | `null` |
| `section` | normalized `p_section` |
| `bin_id` | `p_bin_id` |
| `bin_location` | locked `bins.code` |
| `added_via` | `bottle_scan` |

Exact replay inserts nothing and changes no quantity. The operation creates no `open_bottles`,
`pour_events`, `bottle_closeouts`, `inventory_command_bottle_effects`, stock adjustments, or
cost-history effects. Only a later explicit physical-open command may consume the sealed unit.
The staff request, response, receipt, error, and log surfaces contain no cost or currency value.
The fixed internal `unit_cost = 0` satisfies the current non-null schema without granting cost
visibility.

## HTTP boundary

`POST /api/scan-bottle/confirm` authenticates and calls `requireMembership` before validating
headers or body. It then requires:

- `Idempotency-Key`: a UUID passed unchanged as `p_operation_id`
- `X-Expected-User-Id`: a UUID equal to the authenticated user
- `X-Expected-Restaurant-Id`: a UUID equal to the authenticated current site
- an exact body with `wine_id`, `section`, and `bin_id`

The body schema strips no hidden authority into RPC arguments: the route passes only the current
restaurant ID, idempotency key, parsed wine UUID, normalized section, and parsed bin UUID. It
does not pre-read wines or bins as an authoritative write check and performs no table DML.

First execution and exact replay both return HTTP 201 with the same strict ten-key body. The
response includes `Idempotency-Key` and `Idempotency-Replayed: false|true`. Missing, extra,
malformed, wrong-operation, wrong-wine, wrong-section, wrong-bin, wrong-quantity, or
wrong-type results become a redacted 500 and never become client success.

Known failures map by SQLSTATE, never raw message text:

| SQLSTATE | Meaning | HTTP behavior | Client disposition |
|---|---|---|---|
| `42501` | current staff authorization failed | existing safe 403 envelope | no mutation |
| `P05V1` | database input or shape refusal | redacted 500 contract drift | retain attempted operation if sent |
| `P05W1` | wine missing or foreign | 404 `wine_not_found` with the existing safe message | no receipt or item |
| `P05B1` | bin missing, foreign, or retired | strict 409 `bin_unavailable` with a non-oracular reselect-bin message | proven zero effect; use only the reselection flow below |
| `P05C1` | same-site operation belongs to another actor, command, payload, or version | 409 `bottle_location_operation_conflict` | retain the exact pending operation |
| `P05I1` | matching receipt is incomplete or structurally invalid | redacted 500 uncertain outcome | retain the exact pending operation |

Unexpected database failures are redacted 500s. A generic 409 never authorizes operation
replacement.

## Durable client and rapid scanning

Use a dedicated `terroir:pending-bottle-location-receive` storage and exclusive-lock namespace.
The exact persisted record is version 1 and contains `kind: bottle_location_receive`, the
authenticated user UUID, current-site UUID, a random operation UUID, `sendState` of `prepared` or
`attempted`, and the exact normalized `wine_id`, `section`, and selected `bin_id` payload.

Before any fetch, create and canonicalize the complete record under the exclusive browser lock,
persist it, and verify its read-back. Persist `sendState=attempted` before the fetch. Storage,
read-back, or lock failure sends nothing.

Reload exposes or replays a pending record only when its recorded user and site match the current
authenticated context. A user or site switch sends no request and blocks replacement until the
user returns to that context or follows a separately reviewed resolution path. Retry uses the
same operation UUID, expected-context headers, and exact payload.

Network failure, timeout, abort, offline transition, malformed or mismatched response, `P05C1`,
`P05I1`, every non-`P05B1` 409, and every unknown 5xx retain the exact pending record. None may
clear it or mint a replacement UUID.

The strict SQLSTATE-mapped `P05B1` 409 proves zero effect because its transaction rolled
back the receipt and item. Under the exclusive lock, retain the wine, section, and form intent;
resolve and clear the failed pending attempt; clear the invalid bin selection; require the user
to select an active bin explicitly; create a fresh operation UUID and exact payload; persist and
verify its read-back; then fetch. Failure to resolve, clear, lock, persist, or verify sends
nothing.

The strict SQLSTATE-mapped `P05W1` 404 also proves zero effect: completed replay is
checked before the wine lookup, and this exception occurs before any receipt/item
insertion. Independent September 27 DB review confirmed this ordering. Only its exact
`wine_not_found` envelope may clear the matching operation under the same lock and
return to explicit wine search, preserving the section but clearing wine/bin choices.
Never auto-submit a replacement. Authentication, context and operation-conflict refusals
retain the attempt and show specific recovery guidance, not a generic retry promise.

Clear a successful pending record only after validating the exact HTTP 201 body and headers.
Deliver that validated result synchronously under the same lock after verified removal,
before resolving its promise; an intervening component unmount must not silently discard
a result whose recovery was already cleared. Then append exactly one bottle to the session summary. The user may immediately scan another
bottle and receives a fresh UUID only after the first operation has a validated committed result
and its pending record is clear. Preserve the existing Scan another bottle and End session flow,
keyboard access, touch targets, and visible inline errors.

## Migration and rollback boundary

Implementation first rechecks the repository migration tail and concurrent ownership, then
reserves a new forward/down pair. No number is reserved by this document.

The forward migration adds only the exact function, command-type admission, and version-3 shape
branch above. It preserves existing receipt readers, constraints, ACLs, merge behavior, delete
dependencies, and function grants.

The paired down migration locks the receipt table and refuses while any
`command_version = 3 and command_type = 'bottle_location_receive'` receipt exists. It deletes no
history, uses no `CASCADE`, and restores the exact prior constraints and ACLs only after the
refusal passes. It does not weaken or replace the existing 0158 down guard for remaining
version-3 history.

## Required acceptance evidence

Implementation remains incomplete until all of the following pass against the same frozen source
and disposable database state:

- Current staff, manager, and owner succeed without cost grants. Anonymous, foreign-site,
  removed, expired, revoked, and non-current actors fail with no receipt or item.
- Null, malformed, blank, and overlength inputs refuse before mutation. Missing or foreign wine
  and missing, foreign, or retired bin cases remain non-oracular.
- One valid receive creates one completed receipt and one exact quantity-1 row. Exact sequential
  replay returns the same stored result and changes no count or sealed total.
- Real concurrent same-site calls with the same UUID create one item and return the same result.
  Changed same-site actor, payload, type, version, scope, or shape conflicts without mutation.
- The same UUID at two separately authorized sites creates two independent site-scoped receipts
  without cross-site lookup or disclosure. Distinct UUIDs for two real bottles create two rows.
- Wine merge preserves replay from immutable JSON while relational wine IDs move current.
  Concurrent bin rename or retirement serializes without a mismatched `bin_id` and
  `bin_location`.
- Version-1, version-2, and version-3 `bottle_inventory_save` receipts replay unchanged. Existing
  RPCs reject a same-site `bottle_location_receive` UUID as a type or payload conflict, and the
  new RPC rejects same-site UUIDs owned by existing command families.
- `P05B1` proves that receipt and item both rolled back; `P05W1` occurs before either is inserted
  and after completed replay. Their exact 409/404 envelopes permit explicit bin/wine reselection,
  respectively, with a fresh persisted UUID. Forced failure at every replacement step
  sends no request. `P05C1`, `P05I1`, generic 409, unknown 5xx, and malformed responses retain
  the original operation.
- Route tests prove authentication-before-parsing, expected-context refusal before RPC, strict
  headers and body, exactly five RPC arguments, no direct table read or write, SQLSTATE-only
  mapping, exact 201 response validation, and redacted unexpected failures.
- Client tests prove persistence and read-back before fetch, attempted state before fetch,
  reload recovery, exact retry, switched-context blocking, corruption and lock failure refusal,
  one session-summary increment, and immediate next-scan usability.
- Before and after evidence proves one sealed-unit effect on first commit only and no open-bottle,
  event, effect, closeout, adjustment, cost-history, protected ACL, role, or unrelated database
  change.
- Catalog checks prove exact signature, owner, language, security definer, empty search path,
  grants, receipt constraints, and private receipt ACLs. Paired down/up proof includes empty-state
  success, populated-history refusal, no `CASCADE`, and exact schema/data/ACL conservation.

Implementation, generated artifacts, runtime proof, hosted migration, and deployment remain
separate authorization gates.
