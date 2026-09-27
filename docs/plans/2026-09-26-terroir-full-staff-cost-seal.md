# Terroir full staff-cost seal

Date: 2026-09-26  
Status: accepted engineering scope; unimplemented  
Workstream: C04 / approved Q9 and Q11 completion dependency  
Authority: source and implementation preparation only. This plan is not Opus acceptance,
runtime proof, production certification, migration approval, merge approval, or release
approval.

## Outcome and authority

Terroir must prevent general staff, legacy owners/managers without an exact read grant,
revoked capability delegates, anonymous users, and cross-site callers from recovering
persisted acquisition cost, pricing strategy, cost-bearing invoice/import evidence,
historical copies, derived cost conclusions, idempotency-cache copies, or invoice images.

The implementation must preserve useful work. Current operational roles can capture
deliveries and costs, update physical stock, import and revert CSV batches, resolve rows,
commit or delete invoice scans, accept or undo reconciliation, merge wine identities, and
delete wines under their current role boundary. Those operations return cost-free receipts.
They do not grant cost visibility.

The accepted capability vocabulary remains fixed:

```text
cost.read
margin.read
pricing.manage
```

`cost.read` controls persisted acquisition cost and invoice/import cost evidence.
`margin.read` controls pricing targets, defaults, and mixed strategy history.
`pricing.manage` controls pricing strategy/default mutation and recompute. It does not
authorize acquisition-cost capture or imply either read capability. Workspace governance
can administer exact grants under 0154 but never supplies site access or protected data.

This plan implements the approved outcomes in
`docs/plans/2026-09-20-terroir-product-data-requirements.md` Q9 and Q11. Owners and explicitly
authorized beverage managers can see costs and margins. Service staff keep availability,
location, guest price, and service actions. Receiving staff can capture deliveries and counts
without gaining persisted-cost reads. Managers review uncertain invoice values and own
unresolved discrepancies. Invoice image/PDF/CSV capture and distinct shortage, damage,
return, and credit evidence remain available.

This plan consumes the exact-site authority accepted in
`docs/plans/2026-09-24-terroir-site-capability-cutover.md`. It does not reopen that design or
create a broader capability taxonomy.

## Protected stores and PostgreSQL boundary

The database contract covers the eleven tables listed in Appendix A and the private
`invoice-images` bucket. Market `retail_*` observations and public guest prices are not
acquisition cost.

RLS selects tenant rows. Column ACLs select which values an authenticated role can name,
filter, order, embed, or return. The contract migration must revoke table-level authenticated
SELECT and DML before granting exact safe columns. It must preserve schema-owner and
`service_role` privileges exactly unless a pinned operator dependency requires an explicit
function EXECUTE grant. Wildcard, protected filters/orders/embeds, and protected `RETURNING`
must fail as complete statements.

No dynamic SQL, schema-wide grant, future-column auto-grant, generic JSON reader, arbitrary
table/column/path argument, or browser service client is allowed.

### Transitive wine metadata

`wines.enrichment_metadata` and `wines.manual_overrides` become direct-safe only after an
effective database validator covers all historical and future values.

`manual_overrides` accepts only `drink_window`, `region`, `country`, or `varietal`.
`enrichment_metadata` is null or an object with exactly `source`, `fields_enriched`, and
`enriched_at`. `source` is `rule_engine` or `lwin_fallback`. `fields_enriched` contains unique
strings from the existing enum: `drink_window`, `serving_temp`, `decant`, `peak_year`,
`rating_source`, `review_excerpt`, `region`, `country`, `varietal`, and `colour`.

`enriched_at` is a bounded, valid RFC3339 UTC timestamp. The database-owned validator limits
its byte length, validates the calendar timestamp and `Z` offset, and rejects values outside
the documented operational range. It does not accept an arbitrary string. The additive
migration preflights every historical row and aborts on drift. It never silently drops,
rewrites, or exposes a nonconforming row.

`enrich_wines_batch` and `add_manual_overrides` become closed current-owner/manager writers.
They validate these exact shapes and return safe counts only. Route checks are not their
authorization boundary.

## Authorization inside definers

Every protected reader and mutation is owned by the existing `postgres` schema-owner role, uses
`SECURITY DEFINER`, sets an empty `search_path`, fully qualifies objects, derives the actor
from `(select auth.uid())`, and revokes default EXECUTE from `PUBLIC`, `anon`, and roles that
do not need it.

The migration must assign that owner explicitly, and postflight must assert `proowner`
alongside security mode, search path and grants. Do not let the executing administrator's
identity choose different definer owners. This changes only target-database object
ownership; it does not create or alter any cluster role.

Capability operations call the accepted 0154 evaluator. Operational mutations call one
internal, non-executable current-role helper. That helper joins the exact restaurant's site
membership to the same user's restaurant workspace membership, matches user, restaurant,
workspace, and membership-link identity, requires both parents active/unrevoked/unexpired at
`statement_timestamp()`, then applies the existing `staff`, `manager`, or `owner` threshold.
It does not use the active-site cookie, shadow access, `is_member`,
`is_member_with_role`, governance inheritance, or a new capability.

Retained direct safe-column RLS still uses lifecycle-blind legacy helpers. This release may
claim staff-cost secrecy after the ACL cut. It may not claim complete revoked-site denial or
full C04 completion until a separately evidenced RLS cutover lands.

### Current operational membership selection

The shared API and application-shell resolver must apply the same lifecycle decision
before choosing an active site. Its existing authenticated query cannot inspect
`workspace_memberships`: 0152 deliberately revokes that table from `authenticated`.
Filtering only the site membership would leave parent revocation and expiry unchecked.
Neither the observational shadow evaluator nor a pricing capability can substitute for
operational membership. A service-role resolver is not permitted.

Add the closed reader `read_current_operational_memberships(p_user_id uuid)` in a
separately reviewed additive follow-on after the frozen 0157 candidate. Do not change the
already tested 0157 files to insert this dependency. Reserve the follow-on migration
number using the repository numbering procedure; this plan does not reserve one.

The reader derives `auth.uid()` and returns no rows unless it equals the non-null
`p_user_id`. It returns only `restaurant_id uuid`, `restaurant_name text`, and
`role public.membership_role`, ordered by site membership `created_at DESC, id DESC`.
At one statement time it checks the exact user, restaurant workspace, workspace-kind and
membership-link identities, both membership parents active/unrevoked/unexpired, and an
operational role of owner, manager or staff. Reuse the reviewed internal predicate where
that preserves the exact selected membership identity. Do not return workspace roles,
capabilities, lifecycle fields, private data or workspace identifiers. Use the definer
posture above and grant EXECUTE only to `authenticated`.

The resolver validates the entire response before selecting a site. RPC failure, null or
malformed data, duplicate sites, or unknown roles returns no membership and does not run
shadow observation. The signed cookie may select only among these current memberships;
an absent or invalid selection falls back to the first ordered row. Failure to access the
cookie provider or its secret must fail the request, not silently switch sites. Shadow
observation remains advisory and runs only after authoritative selection.

Verification must cover both membership parents' revocation and exact expiry boundary,
wrong-user and wrong-workspace links, anonymous/foreign actor arguments, role changes,
deterministic fallback and cookie selection, RPC/malformed-result failure, and unchanged
staff operational access without any pricing grant. Generate the database types from the
applied follow-on before integrating the resolver. This source requirement closes an
application selection dependency; it does not replace the separately required direct-safe
RLS lifecycle cutover or complete C04.

## Invoice retry-cache correction

The original draft assumed no new column. Durable actor binding makes one exception:
`scan_idempotency.claimed_by_user_id uuid null`. It has no `auth.users` foreign key or cascade
that could erase history. No other new schema authority follows from this exception.

New claims derive `auth.uid()` and store it in the scalar column. Existing null-actor claims
are legacy and nonreplayable. Claim, replay, complete, and abandon bind the same actor, exact
site, and operation kind under the current operational membership predicate. A claim stores
only the internally constructed `{version: 1, kind, status: "claimed"}` sentinel. The actor
and kind never change when another caller races the claim. Complete accepts typed scalar
arguments, never arbitrary JSON, status codes, error text, or response bodies.

The September 26 complete caller inventory found three operations sharing this cache.
Bottle saving creates no invoice scan; invoice saving also needs a distinct-wine count.
The earlier five-key-only receipt assumption would break these existing workflows. The
closed successful receipt union therefore contains exactly:

| Kind | Exact fields and values |
|---|---|
| `invoice_scan_upload` | `version: 1`, this `kind`, `scanId: uuid`, `status: "queued"`, `itemCount: 0` |
| `invoice_inventory_save` | `version: 1`, this `kind`, `scanId: uuid`, `status: "committed"`, integer `itemCount: 0..500`, integer `wineCount: 0..itemCount` |
| `bottle_inventory_save` | `version: 1`, this `kind`, `wineId: uuid`, `status: "committed"`, `itemCount: 1` |

No extra key is permitted. Unused typed completion arguments must be null. Referenced
scan/wine IDs must belong to the claim's site. A wine ID is never relabeled as a scan ID.
The upload receipt records successful enqueue, not completed extraction. It returns HTTP
202; inventory-save receipts return HTTP 200. Replay preserves that operation's receipt.

Claim returns typed `disposition` and nullable `receipt` columns. Dispositions are `claimed`,
`in_progress`, `expired`, or `replay`; only `replay` includes a receipt. Wrong actor or kind
returns a generic conflict with no cached body. Legacy or malformed rows never replay and
expire through the existing cleanup path. The application maps in-progress, expired, and
conflict to redacted HTTP 409 codes. Claim/storage errors fail closed before handler work.
These three mutation routes require a valid idempotency key rather than bypassing the
cache when it is missing. Completion failure is not acknowledged as a successful cached
operation. Failure handling may abandon only a matching unfinished claim; it must preserve
uncertain committed outcomes for recovery rather than blindly retrying the business write.

The existing 24-hour cache remains transport deduplication, not durable business-operation
idempotency. A separate completion call cannot make an earlier inventory write atomic.
Caller integration must prove the underlying commit/retry and crash behavior; the cache
alone cannot satisfy inventory conservation or C02/C06. No new capability or table grant
follows from this amendment.

The complete source inventory is recorded in
`proof/demo-staff-cost-20260926/operational-caller-inventory.md`, with exact source hashes and
search evidence beside it. It covers the sole cache implementation, all three HTTP callers
(four callsites), their UI result consumers, and the cleanup function/schedule. SQL
implementation may now proceed. The contract may not revoke direct DML until every caller
uses the closed functions and the complete scan-to-worker transition preserves multi-page
uploads, re-extraction, and authorized result retrieval.

## Application and migration sequence

### Durable bottle receiving follow-on

The September 26 caller review found that the transport cache and an in-memory
scanner key cannot satisfy C02/C06. Cleanup removes transport claims after 24
hours; a browser restart loses the current key. Either path can turn an uncertain
save into another inventory addition. Identical bottle details cannot serve as a
deduplication key because two identical deliveries are legitimate.

Reserve migration **0158** for the operational-membership reader above and a typed
staff-capable `save_bottle_inventory_private` writer. The repository tail was
0157 when reserved. One database author owns the forward/down pair, pre/postflight
and fixtures; frozen 0157 remains unchanged.

Reuse `inventory_command_receipts` with a narrow version-3
`bottle_inventory_save` variant. Preserve existing version-1/version-2 behavior,
private table privileges and merge participation. Bind the operation UUID to the
actor, exact site and canonical typed input. In one transaction, create or resolve
the wine, insert inventory, complete the durable receipt and complete the transport
claim. Follow the existing wine-before-receipt lock order. Durable replay returns
the current scalar receipt wine ID, including after a merge, with no stock effect.
Wrong actor, changed input and incomplete receipts refuse without private details.
Do not require manager status or a pricing grant for staff bottle receiving.

Before its first POST, the scanner must durably record the authenticated user,
site, operation UUID and exact submitted payload. Restore that operation after
remount/restart. Preserve it on idempotency 409, network failure or uncertain 5xx;
clear it only after a strictly validated successful receipt or explicit user
abandonment under that existing `bottle_inventory_save` flow. That sentence does not authorize
abandoning the location-receiving operation defined below. Do not silently mint a new key after
an uncertain result. Validate
the entire record and its user/site scope before exposing any pending payload;
corrupt, colliding or unavailable storage refuses a new save. This is recovery for
an online bottle-receiving request, not approval for offline receiving or a general
cost-bearing offline cache.

Forward preflight must refuse new-format bottle transport claims without durable
receipts. The old caller did not retain their canonical input, so migration cannot
truthfully backfill them. Promotion requires draining this mutation across the
database-to-app transition. Down refuses while version-3 receipts exist; it never
deletes durable history to permit rollback. These are local implementation rules,
not approval for a hosted migration or deployment.

Required evidence includes staff success without pricing grants; current parent
membership and cross-site refusal; atomic rollback at each write stage; same-key
concurrency; complete, expire, actual transport cleanup, reclaim and replay with no
second stock effect; wrong-actor/input conflict after cleanup; merge then replay;
and exact empty-database down/up with populated-history down refusal. Client tests
must unmount/remount, reuse the persisted header and payload, retain uncertain
outcomes and reject wrong-user/site/corrupt storage. Apply and verify the frozen
SQL on the admitted disposable target and regenerate types before wiring either
new RPC into application callers. The direct-safe RLS and final ACL cuts remain
separate incomplete dependencies.

#### Accepted: bottle-location receiving compatibility

Root accepted the exact bottle-location receiving contract after the September 27
database reviews. The portable contract is
[`2026-09-27-terroir-bottle-location-receiving.md`](./2026-09-27-terroir-bottle-location-receiving.md).
It is accepted for bounded implementation but remains unimplemented and unverified. It reserves
no migration number and authorizes no hosted database change or deployment.

`POST /api/scan-bottle/confirm` must stop inserting `inventory_items` directly. Its replacement
is the exact staff-capable, cost-free
`public.receive_bottle_at_location_private(uuid,uuid,uuid,text,uuid) returns jsonb` boundary.
One command receives one previously uncounted sealed unit of an already selected current-site
wine into one explicitly selected active current-site bin. It never guesses wine identity or
placement, relocates an existing unit, opens a bottle, or exposes cost.

The durable receipt uses command version 3, command type `bottle_location_receive`, and the
site-scoped key `(restaurant_id, operation_id)`. Completed exact replay runs before mutable wine
or bin checks. A new operation follows wine `FOR NO KEY UPDATE`, receipt claim, and active-bin
`FOR SHARE` order, then inserts one quantity-1 row and completes the receipt atomically. First
success and exact replay both return the same strict cost-free HTTP 201 body.

The client persists and verifies the complete user, site, operation, and payload record under an
exclusive browser lock before fetch. Uncertain or conflicting outcomes keep the exact operation.
Only a strict SQLSTATE `P05B1` mapped to 409 `bin_unavailable` proves zero effect and permits
explicit active-bin reselection followed by a freshly persisted UUID. The function, route,
client, concurrency, compatibility, conservation, ACL, and paired-down requirements in the
portable contract are mandatory acceptance gates. This leaf does not waive the unplaced queue,
hierarchical placement, movement history, or full C06 work.

### Authorized invoice-image target

The current image service reads `raw_image_path` with the request-user client before
minting a signed URL. Revoking that column would also break authorized image viewing.
Postgres does not own the application's storage signing client. Preserve that client and
add one narrow target reader; do not introduce a service-role route client or database
access to signing credentials.

`read_invoice_image_target(p_scan_id uuid, p_page_index integer default 0)` returns
`TABLE(object_name text)`, at most one validated object name. It requires current exact-site
membership/lifecycle and the scan site's `cost.read`. Only `authenticated` can execute it.
The index is `0..7`; zero selects the primary image and the rest select the corresponding
extra page deterministically. The stored name must be bounded, have no control character,
backslash, URL, or traversal segment, and match the admitted existing site/scan/page and
file-extension convention. A malformed image array/path refuses without returning its
contents. Preflight must enumerate historical path shapes; do not silently invalidate
existing images or admit an unreviewed legacy exception at the contract cut.

This reader is an explicit exception to the earlier no-locator-output assumption: an
authorized `cost.read` caller can obtain one image locator through this typed RPC. General
scan readers and the image HTTP response still omit paths. The existing request-user
storage client mints a URL with a lifetime of at most 60 seconds under the final
cost-scoped private-bucket policy. Unauthorized staff cannot obtain the locator, mint a
URL, or read the object. No new capability, generic path argument, or raw JSON reader is
introduced.

### Ordered cutover

The first executable draft exposed a rollout conflict: the old dismissal caller expects
a timestamp, while the protected writer must return a cost-free receipt. Add
`dismiss_pricing_alert_private(p_wine_id uuid, p_days integer default 30)` alongside the
unchanged legacy `dismiss_pricing_alert(uuid,integer)`. The private writer accepts zero to
clear the dismissal and `1..365` to set it. It returns only `{wineId, updated: true}`.
The final contract migration must revoke the legacy callable entrypoint; leaving it
available would bypass the new boundary. Additive-down drops the new entrypoint and leaves
the original function's definition, owner, return type and ACL unchanged.

Other replaced entrypoints must preserve the result fields and safe, stable failure codes
consumed by existing authorized callers. In particular, import apply retains its
`error_message` column with closed codes instead of raw database text; session revert
retains its bounded per-batch results; scan deletion, batch creation/revert and wine merge
retain their expected receipt fields and fixed refusal codes. A generic catch must not
erase stale-write, dependency or idempotency-conflict outcomes. Stronger authorization
refusal remains required; compatibility does not justify false zero counts or restored
access for revoked users. New callers must not rely on raw error text.

The same-name recommendation reader and service-only cache cleanup may change only with
verified result/signature/grant compatibility. Down migration checks compare the actual
baseline function definitions and ACLs, including grantors; never infer PUBLIC execution
from an old function's age or name.

1. **Source promotion.** Land this plan and the four active, unimplemented source assertions.
2. **Additive database.** Preflight 0154/0156 objects, grants, storage policy, metadata/cache
   rows, and callers. Add validators, typed readers/mutations, actor binding, and candidate
   policy while legacy table privileges remain.
3. **Complete application cutover.** Move every protected read and useful mutation to the
   additive boundary. A TypeScript capability precheck does not restore SQL column privilege.
   Do not translate permission errors into zero inventory, missing cost, empty history,
   default targets, or a successful no-op. Do not add a route-level service client.
4. **Contract database.** After an immutable operator receipt names the compatible app and
   caller-contract artifact, revoke broad authenticated privileges and install exact safe
   columns/storage policy in one bounded transaction.
5. **Independent verification.** Use real JWT, Data API, RPC, and storage requests on the
   immutable candidate. Database-owner SQL and UI absence do not prove privacy.

SQL cannot detect the deployed application revision. Rollback is a quiesced operator
procedure: drain affected traffic/workers, apply contract-down, restore and verify the named
legacy app, then apply additive-down only when database dependency/history guards and the
external app receipt permit it. Contract-down restores legacy exposure, so the maintenance
interval is not sealed.

### Cost-free staff import display

The batch and pending-row screens use only `raw.producer` and `raw.name`; their other
display/action fields are in the direct-safe column allowlist. Preserve those names through
`read_import_batch_display_rows(p_batch_id uuid, p_after_row_number integer default 0,
p_limit integer default 100)`. It requires the lifecycle-current exact-site staff predicate
and returns exactly `row_id, batch_id, restaurant_id, row_number, producer, name`.
Producer/name are nullable text extracted only from JSON string fields. Null, missing, or
non-string fields produce null, never stringified JSON. It cannot return raw rows, cost,
validation details, or error text. The cursor is nonnegative, the limit is `1..500`, and
ordering is `row_number, id` within the authorized batch.

The route joins this typed display data to explicit safe columns by row identity and returns
top-level `producer` and `name`, not a reconstructed `raw` object. Missing/failed reader
results must not become fabricated empty rows. Staff still cannot read stored unit cost.
The separate private cost-row reader remains gated by `cost.read`.

## Ownership and completion

1. Source owner: this plan, `app_spec.txt`, feature-ledger generator/count contracts, and
   generated ledger only.
2. Database additive owner: migrations/downs, pre/postflights, database fixtures, snapshot,
   and one generated type update.
3. Read/projection owner: app projections, DTOs, readers, pricing paths, and image route.
4. Operational owner: inventory, scan, idempotency, import, reconcile, delete, and workflow
   tests.
5. Database contract owner: final ACL/storage cut after immutable caller admission.
6. Independent verifier: frozen-range security review and executable matrix, separate from
   implementers and required Opus acceptance.

Implementation is complete only when additive database, complete application, and contract
database form one admitted immutable chain; every source assertion and S01-S22 passes; 0154
and 0156 behavior remains green; and independent security/down-up/conservation evidence has
no unresolved Critical/High finding.

Until then, report the work as unimplemented or incomplete. Do not report a staff-safe demo,
C04 completion, Opus acceptance, production certification, or release approval. Q15 keeps
production data/migrations, merge, deployment, paid services, and live release behind their
separate owner gates.

## Appendix A: exact direct table privileges

The following is the complete direct authenticated SELECT allowlist. A conditional column is
granted only after the historical preflight and validator described above pass.

| Surface | Direct safe columns granted to `authenticated` | Protected boundary |
|---|---|---|
| `inventory_items` | `added_at, added_via, bin_id, bin_location, currency, format, id, invoice_scan_id, quantity, restaurant_id, section, updated_at, wine_id` | `unit_cost` requires `cost.read`. |
| `wines` | `alert_snoozed_until, canonical_wine_id, colour, country, created_at, decant_minutes, drink_window_basis, drink_window_end, drink_window_set_at, drink_window_set_by, drink_window_start, eightysixed_at, eightysixed_by, enrichment_metadata` (conditional), `hero_image_url, id, is_eightysixed, last_enriched_at, lineage_id, lwin_id, lwin_match_score, manual_overrides` (conditional), `name, peak_year, producer, rating, rating_source, region, restaurant_id, retail_max, retail_median, retail_min, retail_refreshed_at, retail_retailer_count, review_excerpt, serving_temp_label, serving_temp_max, serving_temp_min, size_ml, tasting_notes, updated_at, varietal, vintage, wine_variant_id` | `pricing_target_pour_cost_pct, pricing_target_markup_ratio, pricing_dismissed_until` require `margin.read`. `overpaid_flag` requires `cost.read`. |
| `restaurants` | `auto_eightysix_from_inventory, created_at, eightysix_ml_threshold, eightysix_strategy, id, logo_url, name, updated_at, workspace_id, workspace_kind` | `default_target_markup_ratio, default_target_pour_cost_pct` require `margin.read`. |
| `pricing_recommendations` | none | Entire row remains available only through `read_pricing_recommendations`, which requires both reads. |
| `invoice_scans` | `accuracy_score, committed_at, created_at, created_by, distributor_name, id, invoice_date, invoice_number, item_count, restaurant_id, status, status_reason, updated_at` | `parsed_line_items, final_line_items, edits, ocr_text` require `cost.read`; image paths stay out of general readers, with one validated locator available only through `read_invoice_image_target` under `cost.read`. |
| `invoice_scan_deletions` | `bottles_removed, deleted_at, deleted_by, distributor_name, id, inventory_rows_deleted, invoice_number, invoice_scan_id, item_count, restaurant_id, scan_status` | `final_line_items` requires `cost.read`. |
| `reconcile_actions` | `action_type, batch_id, created_at, id, ordinal, restaurant_id, subject_id, subject_table` | `prior_state, new_state` require both reads. |
| `identity_merge_log` | `id, merge_type, merged_at, merged_by, moved_counts, restaurant_id, source_id, target_id` | `source_snapshot` requires both reads. |
| `import_batch_rows` | `applied_inventory_item_id, applied_wine_id, apply_attempts, apply_status, batch_id, cost_status, created_at, duplicate_reason, id, lwin_id, lwin_score, lwin_status, resolution, resolved_at, resolved_by, restaurant_id, row_number, row_state, updated_at` | `raw, manual_unit_cost, validation_errors, last_error_message` require `cost.read`. |
| `cellar_health` | `computed_at, id, restaurant_id, wine_id` | `segment, reason` require `cost.read`. |
| `scan_idempotency` | none | Whole table is available only through actor-bound claim/replay/complete/abandon and operator cleanup. |

For authenticated DML, first revoke table-level INSERT, UPDATE, and DELETE on all eleven
tables. Restore only:

- `wines` INSERT:
  `alert_snoozed_until, canonical_wine_id, colour, country, decant_minutes,
  drink_window_basis, drink_window_end, drink_window_set_at, drink_window_set_by,
  drink_window_start, eightysixed_at, eightysixed_by, hero_image_url, id, is_eightysixed,
  last_enriched_at, lineage_id, lwin_id, lwin_match_score, name, peak_year, producer, rating,
  rating_source, region, restaurant_id, retail_max, retail_median, retail_min,
  retail_refreshed_at, retail_retailer_count, review_excerpt, serving_temp_label,
  serving_temp_max, serving_temp_min, size_ml, tasting_notes, varietal, vintage,
  wine_variant_id`. Defaults own timestamps. The validated metadata columns remain closed-
  writer-only.
- `wines` UPDATE:
  `alert_snoozed_until, canonical_wine_id, colour, country, decant_minutes,
  drink_window_basis, drink_window_end, drink_window_set_at, drink_window_set_by,
  drink_window_start, eightysixed_at, eightysixed_by, hero_image_url, is_eightysixed,
  last_enriched_at, lineage_id, lwin_id, lwin_match_score, name, peak_year, producer, rating,
  rating_source, region, retail_max, retail_median, retail_min, retail_refreshed_at,
  retail_retailer_count, review_excerpt, serving_temp_label, serving_temp_max,
  serving_temp_min, size_ml, tasting_notes, updated_at, varietal, vintage, wine_variant_id`.
  The validated metadata and protected pricing fields remain closed-writer-only.
- `restaurants` INSERT:
  `auto_eightysix_from_inventory, eightysix_ml_threshold, eightysix_strategy, id, logo_url,
  name, workspace_id, workspace_kind`; UPDATE:
  `auto_eightysix_from_inventory, eightysix_ml_threshold, eightysix_strategy, logo_url, name,
  updated_at`. Protected defaults use the pricing RPC.
- all other sealed tables: no direct authenticated DML.

The migration must spell out column and sequence grants. A column REVOKE is ineffective while
a table-level privilege remains. Safe projections must also cover every WHERE, ORDER, and JOIN
column used by retained callers.

## Appendix B: exact reader and mutation contracts

### Readers

All readers use the definer and authorization rules above. `p_wine_ids = null` means the
whole authorized site, an empty array means no rows, and a supplied list is limited to 500
unique UUIDs. Every ID joins back to the authorized site. A multi-site request compares the
complete requested set with `effective_site_ids` for every required capability and refuses
the whole result when any site is absent.

| Function | Authority | Exact result and bound |
|---|---|---|
| `read_inventory_costs(p_restaurant_id uuid, p_wine_ids uuid[] default null)` | `cost.read` | `inventory_item_id, wine_id, invoice_scan_id, unit_cost, currency, added_at`; site-filtered, stable ordered. |
| `read_wine_pricing_strategy(p_restaurant_id uuid, p_wine_ids uuid[] default null)` | `margin.read` | wine ID plus three protected target/dismissal fields; no cost/flag. |
| `read_wine_cost_flags(p_restaurant_id uuid, p_wine_ids uuid[] default null)` | `cost.read` | wine ID plus `overpaid_flag`; no numeric cost/targets. |
| `read_restaurant_pricing_defaults(p_restaurant_id uuid)` | `margin.read` | restaurant ID and two protected defaults. |
| `read_pricing_recommendations(p_restaurant_id uuid)` | both reads | Accepted 0154 result, tenant join, `class ASC, computed_at DESC, wine_id ASC`, 1,000-row application paging. |
| `read_invoice_scan_private(p_scan_id uuid)` | scan site's `cost.read` | Protected scan JSON plus safe metadata and `has_image, image_count`; no path/URL. |
| `read_invoice_image_target(p_scan_id uuid, p_page_index integer default 0)` | current scan-site member plus `cost.read` | At most one validated `object_name`; `0 <= p_page_index <= 7`; no other scan fields or arbitrary path input. |
| `read_invoice_scan_deletion_private(p_deletion_id uuid)` | exact-site `cost.read` | deletion metadata plus `final_line_items`. |
| `read_reconcile_action_private(p_batch_id uuid)` | both reads | ordered immutable action history including states. |
| `read_identity_merge_private(p_merge_id uuid)` | both reads | merge metadata plus whole source snapshot; null/global site rows never expose. |
| `read_import_batch_cost_rows(p_batch_id uuid, p_after_row_number integer default 0, p_limit integer default 100)` | batch site's `cost.read` | ordered protected rows; `p_after_row_number >= 0`, `1 <= p_limit <= 500`. |
| `read_import_batch_display_rows(p_batch_id uuid, p_after_row_number integer default 0, p_limit integer default 100)` | lifecycle-current batch-site staff | `row_id, batch_id, restaurant_id, row_number, producer, name` only; nullable string-only name fields, no raw JSON/cost/error; stable `row_number, id`, nonnegative cursor, limit `1..500`. |
| `read_cellar_health_private(p_restaurant_id uuid, p_wine_ids uuid[] default null)` | `cost.read` | health identity plus `segment, reason`; stable ordered. |

### Pricing mutations

- `set_wine_pricing_strategy(p_restaurant_id uuid, p_wine_id uuid,
  p_target_pour_cost_pct numeric, p_target_markup_ratio numeric)`: exact-site
  `pricing.manage`; enforce existing column bounds; return `{wineId, updated: true}`.
- `set_restaurant_pricing_defaults(p_restaurant_id uuid,
  p_target_pour_cost_pct numeric, p_target_markup_ratio numeric)`: exact-site
  `pricing.manage`; existing bounds; return `{restaurantId, updated: true}`.
- Add `dismiss_pricing_alert_private(p_wine_id uuid, p_days integer default 30)` as a
  `pricing.manage` definer with a cost-free receipt; zero clears, `1..365` sets. Keep the
  legacy timestamp-returning function through application rollout, then revoke its
  execution at the contract cut. Return a timestamp to the new caller only after a
  separate `margin.read` decision.
- `set_wine_overpaid_flag(p_restaurant_id uuid, p_wine_id uuid, p_flag boolean)`:
  `pricing.manage`; return `{wineId, updated: true}`. Reading remains `cost.read`.

### Inventory, wine delete, and metadata

- `create_inventory_item_private(p_restaurant_id uuid, p_wine_id uuid,
  p_quantity integer, p_unit_cost numeric, p_currency text, p_bin_id uuid,
  p_bin_location text, p_section text, p_format text, p_invoice_scan_id uuid,
  p_added_via public.added_via)`: current owner/manager; validate exact-site references and
  existing numeric/text bounds; omitted application cost maps to `0`, explicit null refuses;
  return `{inventoryItemId, quantity, updated: true}`.
- `patch_inventory_item_private(p_inventory_item_id uuid,
  p_expected_updated_at timestamptz, p_set_quantity boolean, p_quantity integer,
  p_set_unit_cost boolean, p_unit_cost numeric, p_set_currency boolean, p_currency text,
  p_set_bin_id boolean, p_bin_id uuid, p_set_bin_location boolean, p_bin_location text,
  p_set_section boolean, p_section text, p_set_format boolean, p_format text)`: current
  owner/manager; lock/CAS exact row; false flags preserve values; true cost plus null refuses;
  validate the complete resulting row and 0156 conservation; return the same safe receipt.
- `delete_wine_private(p_restaurant_id uuid, p_wine_id uuid,
  p_expected_updated_at timestamptz)`: current **owner only**; perform inventory, list, scan,
  physical, pour, and history refusal checks atomically; return `{wineId, deleted: true}`.
- `add_manual_overrides(p_wine_id uuid, p_fields text[])`: current owner/manager; maximum
  four unique fields from the existing enum; return `{wineId, updated: true}`.
- `enrich_wines_batch(p_restaurant_id uuid, p_enrichments jsonb)`: current owner/manager;
  maximum 2,000 rows, exact existing enrichment keys, strict per-field source bounds, exact
  metadata validator; return affected count.

#### Accepted: legacy whole-wine section assignment compatibility

Root accepted this additive contract after the final database and HTTP/TypeScript reviews
on September 27. It authorizes bounded implementation and verification, not deployment or
criterion completion. TER-CF-086 and TER-CF-087 preserve existing whole-wine drag and bulk
assignment; they do not require rowwise CAS.

The exact boundary is
`public.assign_wine_sections_private(p_restaurant_id uuid, p_wine_ids uuid[], p_section text)
returns jsonb`. It has no defaults or overloads. It is PL/pgSQL `SECURITY DEFINER`, uses
`search_path = ''` and fully qualified names, and is owned by `postgres`. The migration must
revoke `EXECUTE` on that exact signature from `PUBLIC`, `anon`, `authenticated`, and
`service_role`, then grant it only to `authenticated`.

The function first requires non-null `auth.uid()` and
`public.current_site_role_at_least(p_restaurant_id, 'manager')`; refusal uses SQLSTATE
`42501`. This is a current-at-check authorization decision, not serialization against a
concurrent membership revocation. It then sets `v_section = nullif(btrim(p_section), '')` and
rejects a section over 100 characters, a null wine array, an array outside `1..200`, or any
null element with SQLSTATE `P04V1`. It rejects duplicate IDs with `P04W1`; it never deduplicates
submitted input.

In one transaction, the function selects all matching site-owned wines in ID order `FOR NO
KEY UPDATE` and requires the locked row count to equal the submitted array cardinality.
Missing or foreign-site IDs raise `P04W1` before any mutation. One set-based `UPDATE` then sets
`inventory_items.section` for the exact site and submitted wine IDs. There is no separate
inventory pre-read, per-row write, expected timestamp, or CAS. A valid wine with zero
inventory rows succeeds. The existing `updated_at` trigger advances on rows the statement
updates. The exact JSON result has two keys: `{requestedWineCount, section}`. It exposes the
submitted wine count, never inventory affected-row counts, row values, or acquisition cost.

Overlapping calls serialize on the ordered wine locks; the later lock holder's update wins.
This makes no request-order or general serializability promise. Migration 0158's
`public.save_bottle_inventory_private(...)` locks the exact-site `public.wines` row
`FOR NO KEY UPDATE`: a new lot is included when that insert commits first, while an insert
that commits after section assignment is not included.
Migration 0157's `create_inventory_item_private` does not take the wine lock, so section
assignment covers only rows visible to its update statement.

The routes retain their public contracts and construct RPC arguments only from parsed fields.
Authorization stays before path/body parsing, and both non-strict body schemas continue to
strip unknown keys. Empty and 201-item batch arrays and 101-character sections fail route
validation before the RPC. PATCH still trims blank text to `null`; POST still requires a
nonempty section and passes the submitted array without deduplication.

Each route must accept only an RPC result that is one non-array JSON object with exactly the
two keys above. The requested count must be a safe integer equal to `1` for PATCH or the
submitted array length for POST, and the returned section must exactly equal the
server-normalized input. Missing,
extra, malformed, unsafe, non-integral, count-mismatched, or section-mismatched receipts are
captured as redacted 500s. PATCH constructs `{wine_id: <validated path id>, section}`; POST
constructs `{updated: requestedWineCount, section}`. Neither accepts a database-provided wine
ID. POST must join PATCH under `withApiHandler` or an equivalent thrown-error boundary.

Typed error mapping uses error codes, never SQL message parsing. `P04W1` maps to PATCH's
`404 not_found` / `Wine not found.` and POST's `400 bad_request` /
`One or more wines not found in your restaurant.`. A post-validation `P04V1` is contract drift
and becomes a captured redacted 500. SQLSTATE `42501` maps to 403. Unknown and thrown failures
also become redacted 500s. No response, log, or report includes raw SQL text, cost, inventory
row data, or an inventory affected-row count. Existing drag rollback, error and success toasts,
selection clearing, and `router.refresh()` behavior remain unchanged.

Source and bounded loopback acceptance must cover owner and manager success without
`cost.read`; staff even with `cost.read`; anonymous, cross-site, revoked, and expired access;
duplicate and null-element arrays; cardinalities 1, 200, and 201; section lengths 100 and 101;
blank-to-null PATCH; empty batch validation without RPC; multi-lot all-row update;
zero-inventory success; missing/foreign all-or-none refusal; overlapping-call last-lock-holder
behavior; strict receipt cardinality and shape; and returned plus thrown RPC failures on both
routes. Tests must also prove authorization-before-input precedence, parsed-field-only RPC
arguments, stable error envelopes, and unchanged caller rollback/refresh behavior.

Before/after evidence must show no change to quantity, unit cost, currency, bin, format,
invoice linkage, stock adjustments, open bottles, pour events, closeouts, receipts, or other
physical-bottle state. This proposal closes only the two legacy section routes needed for
staff-cost-seal compatibility. It does not define facility, room, fixture, zone, shelf, or
slot hierarchy; per-lot or per-bottle placement; grain-aware moves; placement history; or the
full D2 workflow. Those capabilities remain required in the later placement work; this
compatibility change does not waive them.

### Invoice scan, image, and idempotency

- `create_invoice_scan_upload(p_restaurant_id uuid, p_scan_id uuid,
  p_object_name text, p_distributor_name text, p_invoice_number text,
  p_invoice_date date)`: current member; validate a single private bucket object under the
  exact site/scan convention, MIME set, 10 MiB/page, and at most eight pages in the complete
  upload; enqueue extraction; return `{scanId, status}` with no path.
- `review_invoice_scan(p_scan_id uuid, p_expected_updated_at timestamptz,
  p_distributor_name text, p_invoice_number text, p_invoice_date date,
  p_final_line_items jsonb, p_edits jsonb)`: current manager plus scan site's `cost.read`;
  at most 500 line objects and 500 edit keys, exact line/edit schema, and a 2 MiB aggregate
  JSON limit; return `{scanId, status, itemCount, updated: true}`.
- `commit_invoice_scan(p_scan_id uuid)`: current manager plus `cost.read`; lock and validate
  scan/site/final payload, create inventory and physical effects, and commit exactly once;
  replay returns the identical cost-free receipt.
- `delete_invoice_scan(p_scan_id uuid)`: retain 0156 name; current owner/manager; preserve
  inventory/bottle conservation and private history; return
  `{scanId, inventoryRowsDeleted, bottlesRemoved}`.
- Re-extract is a manager+`cost.read` request/enqueue; the tenant-filtered service worker owns
  protected writes. Provider payloads never enter the API result.
- `claim_scan_idempotency(p_restaurant_id uuid, p_key uuid, p_kind text)` returns
  `TABLE(disposition text, receipt jsonb)`: current member; actor/kind-bound claim, with the
  closed result states and receipt union above. Unknown kinds refuse before mutation.
- `complete_scan_idempotency(p_restaurant_id uuid, p_key uuid, p_kind text,
  p_scan_id uuid, p_item_count integer, p_wine_count integer, p_wine_id uuid)` returns
  `jsonb`: same claim actor/site/kind, typed null and range rules above, exact-site reference
  validation, and an internally constructed closed receipt. It cannot accept arbitrary
  status/body/error arguments. Re-completion must match the stored receipt exactly or refuse.
- `abandon_scan_idempotency(p_restaurant_id uuid, p_key uuid, p_kind text)` returns
  `boolean`: same claim actor/site/kind and unfinished claims only; zero affected rows is not
  success. Legacy null-actor/generic-body rows are nonreplayable.

### CSV import

Retain current staff-or-better authority. Convert `create_import_batch`, row-resolution
mutations, `apply_import_batch_chunk`, `revert_import_batch`, and `revert_import_session` to
closed definers. Preserve the existing `MAX_ROWS = 5000`, apply chunk size 100, row attempt
limit 3, sibling locks, exact-site/session checks, idempotency, linkage, 0156 physical guards,
and exact refusal/count semantics. Derive creator from `auth.uid()`. Return batch/row/status/
count IDs and closed error codes only, never raw rows, `SQLERRM`, or echoed values.

### Reconciliation and merge

- `accept_reconcile_batch(p_restaurant_id uuid, p_actions jsonb,
  p_idempotency_key uuid)`: current owner/manager; one to 100 actions; exact schemas for
  `place_bin`, `match_scan`, `link_lineage`, and `dismiss`; exact-site subjects,
  deterministic locks, one immutable before/after action per effect, all or none.
- `undo_reconcile_batch(p_batch_id uuid)`: current owner/manager; lock batch/actions/subjects,
  refuse replay or stale/mismatched state, reverse strict ordinal order, and mark undone in
  the same transaction.
- Reconciliation receipts contain batch ID, action count, status, and undo timestamp only.
- Keep current 0156 `merge_wines`: current owner/manager, deterministic locks, immutable
  private snapshot, safe moved-count receipt, existing source-only repoint, `23505` when both
  pricing rows exist, and cross-site refusal.

## Appendix C: executable S01-S22 acceptance matrix

Run every case on a disposable logical database with synthetic users/sites/rows, bounded
timeouts, captured command/stdout/stderr/exit, rollback or exact cleanup, and before/after
schema/data/role/global conservation. Use actual JWT/Data API/storage requests for S01-S05
and image cases.

| ID | Case | Required result |
|---|---|---|
| S01 | Staff explicitly select every protected scalar/JSON/cache column, including `inventory_items.unit_cost`, both conditional wine metadata fields with poisoned historical fixtures, and `scan_idempotency.response_body` | Denied at SQL/Data API privilege or admitted metadata validator; zero protected value bytes. |
| S02 | Staff `SELECT *` / `select=*` on all eleven sealed tables | Whole request fails; explicit safe projections succeed under RLS. |
| S03 | Staff wildcard and protected embeds across inventory, wines, scans, imports, and retry cache relations | Protected/wildcard embed fails; exact safe embed has no protected key. |
| S04 | Staff filter/order/range on protected numeric/JSON paths, including boolean inference probes | Denied without revealing match status through count/status/timing. |
| S05 | Staff protected INSERT/UPDATE/DELETE `RETURNING`, including otherwise valid bodies | Statement fails unchanged; authorized closed mutation plus safe receipt succeeds. |
| S06 | Historical rows in all JSON/history/cache/metadata stores | Direct staff read/replay denies; nonconforming wine metadata blocks admission; authorized readers return only exact-site rows. |
| S07 | Exact-site `cost.read` across inventory, scan/deletion, import, health, and the narrow image-target reader | Correct typed stable results; only the image-target reader returns one validated locator; all other readers omit storage paths. |
| S08 | Exact-site `margin.read` across wine/default readers, plus both-read merge snapshot | Correct; margin-only gets no cost/flag; either single read denies mixed snapshot. |
| S09 | Both-read delegate on recommendations and reconcile history | Correct; each single read denies mixed readers. |
| S10 | `pricing.manage` delegate writes strategy/default/dismissal/flag and recomputes without read grants | Writes succeed with cost-free receipts; protected reads deny. |
| S11 | Legacy owner, manager, staff, and service role without exact read grant | Ordinary protected reads deny; safe service paths work; service maintenance stays tenant-filtered. |
| S12 | Workspace owner/group admin without site capability | Governance only; no pricing/cost read or mutation side effect. |
| S13 | Cross-site IDs, forged site, foreign row, and null/global merge rows | Denied with no existence oracle, partial result, or mutation. |
| S14 | Multi-site request where one site lacks/loses a required grant | Entire request refuses; zero partial rows. |
| S15 | Grant/membership revoke, expiry, identity generation rotation, or membership removal during operation | New protected operation and image mint fail closed; existing signed URL expires within 60 seconds. |
| S16 | Member multi-page upload/enqueue, three-kind actor-bound retry/replay, invoice/bottle save, manager+cost review/update/commit, re-extract request, and manager delete | Each receipt preserves its real IDs/counts; wrong actor/kind and legacy/malformed cache never replay; claim errors run no handler; uncertain completion never implies a safe duplicate business write; worker/re-extraction and authorized result retrieval remain usable; commit exactly once; delete conserves stock and writes private history. |
| S17 | Staff import cost-free row display, create/resolve/apply/replay/revert batch/session | Producer/name and safe status/action fields remain usable; malformed name fields never serialize raw JSON; flow works with locks/0156 guards; historical cost stays unreadable; errors are closed codes. |
| S18 | Manager reconcile every action, invalid mixed batch, concurrent/stale action, undo/replay undo | Valid batch atomic; invalid/stale zero-effect; history immutable; undo exact reverse or fail closed. |
| S19 | Manager inventory create/quantity-only/bin-only/cost-only patches and merge without read grants; owner and manager wine deletion attempts | Hidden cost survives omitted patch; explicit null refuses; merge safe; owner delete follows checks; manager delete denies. |
| S20 | Service-role maintenance regression | Existing allowlisted jobs perform tenant-filtered recompute/extraction/health; no app/browser route gains service role; ACL hashes conserve except explicit contract delta. |
| S21 | Quiesced down/up cycle with operator app receipt | Exact legacy ACL/policy restored only during maintenance; additive-down guards work; up restores seal; all data/history conserved. |
| S22 | Anonymous and malformed JWT/session | No tenant rows, functions, objects, signed URLs, safe replay, or mutation. |

## Appendix D: source and release gates

Source tests must verify exact column ACLs, function owners/security/search paths, full
qualification, EXECUTE closure, actor derivation, current operational predicate, capability
calls, bounds, stable ordering, metadata timestamp/category/field validators, complete retry-
cache consumer inventory, caller projections, and safe logs/errors.

Implementation remains unaccepted until:

- additive, complete application, and contract slices are one immutable dependency chain;
- the accepted compatible pricing assertions stay green;
- all new source assertions and S01-S22 pass;
- down/up, data, schema, ACL, role, membership, and global conservation evidence is complete;
- formal independent security review has no unresolved Critical/High finding; and
- required Opus review signs the same immutable source/evidence range.
