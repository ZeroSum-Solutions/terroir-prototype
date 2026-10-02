# Terroir offline operation contract

Status: accepted engineering contract with a partial local implementation, September 23, 2026.
Implementation status: **PARTIAL, NOT C03 COMPLETE.** The frozen twelve-path lookup
leaf implements the local `GET /api/offline-context` source for TER-CF-297. Bounded
evidence records 81 passing tests, including three live loopback tenant-containment
tests, plus independent acceptance of this bounded leaf. Each relation rejects more
than 50,000 rows with a `500` and no partial projection. Keyset pages use separate
database snapshots, so projection `asOf` is the route's advisory read-start time, not
an atomic inventory timestamp. This evidence covers the endpoint only; deployment and
the full offline workflow are unverified. Completion status remains in the generated
feature ledger and product conformance report.

The native store policy and driver for TER-CF-291 through TER-CF-293 have 34 passing
deterministic tests and independent acceptance of that bounded implementation.
They are not yet connected to application flows. The bounded local session-boundary
leaf now unmounts private content before sign-out work, conservatively resolves raw
duplicate marker cookies, and keeps uncertain outcomes data-free and retryable. Its
focused unit and contract suite has 153 passing tests. A bounded
[17-case browser checkpoint](#session-boundary-browser-checkpoint) verifies the local
session leaf; four sign-out states run at both 320 px and 390 px, while the other nine
cases use the default viewport. Native projection provisioning still lacks browser
proof. The public shell, positive-eligibility provider, and cached search are not
implemented. C03 remains incomplete. This foundation adds no
mutation capture, queue, replay, recovery report, count, transfer, receiving flow,
provider call, schema migration, dependency, or production activation. Active source
requirements state scope; they do not prove that the behavior ships.

Two accepted limits remain explicit:

- A cached context grants local display only. It is never a credential, never
  authorizes a server request, and cannot reveal revocation until the browser
  reconnects and the server rechecks current membership.
- Browser storage is an application display boundary, not confidentiality from
  the device owner. Best-effort deletion is not secure erase.

## Lookup foundation decisions

### 1. Freeze v1 at two replaceable stores and no durability promise

`terroir-offline` version 1 contains only:

- `contexts`, keyed by `[userId, restaurantId]`; and
- `projections`, keyed by `[userId, restaurantId, projectionKind]`.

There are no `operations` or `receipts` stores, no `replay.ts`, no
`/api/offline-reports`, no manager-recovery endpoint, no Background Sync, and no
stock-changing `POST`. Do not call `navigator.storage.persist()`: this slice holds
only a replaceable projection and must not imply durable capture. Storage estimates
may be shown only as diagnostics, never as a correctness claim.

The context record contains only `schemaVersion`, `contextId`, `userId`,
`restaurantId`, server `issuedAt`, server `expiresAt`, `lastObservedWallClock`,
`lockedAt`, `lockReason`, and the accepted projection version. It contains no role,
capability, `allowedOperationKinds`, cost, note, or membership detail. A projection
is never readable without its matching usable context.

### 2. Provision one server-derived, cost-free allowlist payload

Add `GET /api/offline-context`. At the route's server decision point, call the
existing current-auth/current-active-membership path and derive both `userId` and
`restaurantId`; ignore any client query, header, or body claiming either identity.
Return `401/403` on missing or no-longer-authorized context, and `Cache-Control:
no-store` on every response.

The response is an explicit v1 shape:

```text
schemaVersion
context: contextId, userId, restaurantId, issuedAt, expiresAt
projection: kind="cellar_lookup", version, asOf, rows[]
row: wineId, displayName, producer, vintage, format, sealedQuantity,
     placements[], activeOpenBottleId, openedAt, remainingMl
placement: binId, label, sealedQuantity
```

`expiresAt` is server-generated and no more than 12 hours after `issuedAt`.
Define the response and row types field-by-field in
`src/domains/offline/contract.ts`; do not use `Pick<CellarWineRow, ...>`, spread a
cellar row, serialize `CellarShell` props, or reuse its pricing-enriched query.
The endpoint must map only the listed columns into its response. Queries may also
select their own primary-key `id` solely for stable, bounded keyset pagination;
query-only IDs never enter the response unless the response allowlist names them.
Every page retains the same site scope, and incomplete reads fail closed rather
than silently truncating the projection. In particular, unit cost,
bottle/glass price, list names/counts, target margins, notes, membership, settings,
staff data, and arbitrary API/RSC content never enter the response.

Do not derive `placements` from the current cellar aggregate. The existing cellar
page orders `inventory_items` and deliberately keeps only the first
`bin_location`; that shape is lossy for a wine stored in more than one bin. Use a
dedicated read shaped like the existing Bins relation instead: active
restaurant-scoped `bins` joined to restaurant-scoped `inventory_items`, selecting
only bin `id`/`code` and inventory `wine_id`/`quantity`. Aggregate duplicate
inventory lots by `(wineId, binId)`, summing their quantities, preserve every
distinct active bin as one structured placement, and sort deterministically by
complete bin label then bin ID. `sealedQuantity` still includes unplaced stock;
unbound or retired-bin stock has no authorized placement entry. Never substitute a
denormalized first-bin label, and do not select unit cost, section, note, price, or
other cellar-row fields for this mapping.

Pass the online `auth.user.id` from the [application layout](../../src/app/%28app%29/layout.tsx) into the offline
provider, alongside the existing server-resolved restaurant ID. The client compares
these expected values with the endpoint response before committing, but this is a
mix-up check only; server authorization remains authoritative. One IndexedDB
transaction locks every other context and replaces only the current actor/site
context and projection. Thus an offline restart has at most one eligible partition;
zero or multiple eligible partitions fail closed.

### 3. Make `/offline` genuinely public and cache only its exact public shell

Add `/offline` to `PUBLIC_PATHS` in `src/lib/supabase/proxy.ts`. The page performs no
server auth, membership, tenant, or cellar fetch and must return a non-redirecting
`200` without credentials. The planned service worker under existing `public/`
remains outside the proxy because the
current matcher excludes `.js`; preserve and test that assumption.

After an online `/offline` load, its client sends the worker only its same-origin,
same-build `/_next/static/` script/stylesheet URLs plus the declared public icons.
For every precache request use `credentials: "omit"`, `cache: "no-store"`, and
`redirect: "error"`; accept only same-origin `status === 200 && !redirected`
responses. Populate a build-specific staging cache, mark it ready only after every
entry passes, then retire the old cache. “Offline ready” is shown only after that
acknowledgment.

Navigation is network-first with one bounded timeout, then falls back to the cached
public `/offline` document. The worker never caches `/cellar`, authenticated HTML,
RSC requests, `/api/*`, Supabase traffic, uploads, provider traffic, non-GET requests,
or a redirect/login response.

### 4. Make lock, sign-out, proxy, and new sign-in one explicit state machine

Preserve the native sign-out form and add an offline-aware client boundary around
the entire private React tree. With JavaScript, sign-out intent first commits an
unmount and a generic, data-free view. After that commit, start the server request
before awaiting local storage; independently attempt bounded `lockAllContexts`
and write/read back `terroir_device_locked=1`. A local failure must not suppress
the request. Use a five-second request deadline and the existing IndexedDB
deadlines. Unmounting is not erasure of browser memory, router caches, or storage.

The readable cookie is a display-denial signal, not authentication or API
authorization. Use `Path=/`, `SameSite=Lax`, `Secure` in production, no `HttpOnly`,
and a 400-day maximum age; browser retention is not guaranteed.

| Device marker | Online private route | Offline cached display |
| --- | --- | --- |
| `1` | Deny except explicit auth/recovery paths | Deny before opening IndexedDB |
| `reprovision_required` | Apply verified session and membership checks | Deny before opening IndexedDB |
| Absent or unknown | Apply verified session and membership checks | Deny unless explicit positive current-context eligibility is proven |

The sign-out route must establish same-origin evidence before any cookie, active
restaurant, or provider side effect: accept `Sec-Fetch-Site: same-origin`, or an
exact configured-origin `Origin` only when Fetch Metadata is absent. Reject other
or missing evidence with a generic no-store 403 and no side effects. Native-form
support therefore requires these headers; real Chromium is the browser proof, not
a claim about every legacy or header-stripping client. After acceptance, attempt
active-restaurant clearing and global Supabase sign-out independently and write the
hard marker on every accepted response. Return 204 only for a confirmed internal
client request, 303 for confirmed native navigation, and a generic 503 otherwise.

The proxy never writes, refreshes, deletes, or expires the device marker. Signout,
callback, confirmation, and login POST reach their handlers before hard-marker
logic; reset-password GET/POST retains normal recovery-session verification. A
hard marker lets `/login` render without redirecting back to `/`; protected
requests redirect once to login without private HTML. Only same-origin top-level
documents may attempt deferred local-scope sign-out. RSC, prefetch, cross-site,
`none`, and missing-evidence requests perform no cleanup. Await cleanup within
1.5 seconds and apply accumulated auth-cookie writes before returning the chosen
response; late results cannot reopen content or mutate a returned response.
`/api/*` remains outside this proxy matcher and retains its own authorization.
The later public `/offline` shell remains a separate required implementation.

Every auth operation returning a non-null session writes `reprovision_required`:
password login, callback exchange, recovery confirmation, dev login, and signup
when it returns a session. No-session signup, request-only operations, and failed
authentication preserve the marker. No auth handler opens or unlocks IndexedDB.
No code in this session-boundary leaf deletes or expires the marker.

A later provider/public-shell leaf must persist positive eligibility bound to the
exact freshly authorized actor/site context atomically with its context and
projection, lock every non-current partition, and observe the committed success
before removing transition state. A fetched response, today's `stored` result,
a sole unlocked row, or cookie absence is not that evidence. Older records without
positive eligibility must fail closed. Its representation/versioning and the one
permitted post-provision marker-deletion path require separate review.

Track server sign-out, durable context locking, projection deletion, and verified
cookie persistence separately. Zero contexts cannot count as a durable context
lock, and deletion cannot promote a failed lock to success. Never remount private
children after sign-out intent. Navigate the whole document to login only after
server confirmation and at least one verified durable denial marker; otherwise
show the appropriate data-free warning and retry control. If all persistent denial
writes fail or their state is later lost, immediate unmounting and server revocation
do not establish durable cross-reload or device-handoff safety.

### 5. Specify honest storage, lock, reload, and clock-failure behavior

Every offline render first rejects recognized denial markers, then requires
explicit durable positive eligibility for exactly one matching context. Missing
eligibility, including the current schema's lack of it, denies display. Also verify
matching
projection schema/version, `lockedAt === null`, a current time not earlier than
`issuedAt` or `lastObservedWallClock`, and a current time before `expiresAt`. The read
and monotonic-clock update occur in one transaction. Expiry, detected rollback,
ambiguous partitions, corrupt/unknown records, or any IndexedDB read/transaction
error renders a data-free locked/unavailable screen: no restaurant name, wine name,
row, or count.

Detected expiry or rollback attempts to persist `lockedAt` before any display.
Failure to persist does not reopen the current UI. Because a browser wall clock and
storage are not trusted hardware, the 12-hour value is a bounded application-display
lease, not a security expiry; unobserved clock manipulation cannot be claimed
impossible.

Lock cleanup is ordered for safety: first commit the small context lock transaction;
only afterward best-effort delete that partition's replaceable projection. Never put
the delete in the same transaction where its failure could roll back the lock. If the
lock transaction fails, clear memory, attempt best-effort partition deletion, and
report the result honestly; do not claim the old bytes were erased.

Required failure matrix:

| Persistent result | Current UI | Reload/reconnect truth |
| --- | --- | --- |
| IndexedDB lock succeeds | Private data removed | Offline reload remains locked even if the JS cookie failed; reconnect still finishes server sign-out. |
| Cookie verifies, IndexedDB lock fails | Private data removed | The hard marker blocks private online render and cached display. A later verified login writes transition state, permitting only normal authorized online access; cached display stays denied until positive reprovision evidence. Projection deletion is only best effort. |
| Both local writes fail while offline | Private data removed for this tab | Show “lock could not be saved; server sign-out pending.” Do not claim durable local sign-out or erase; retry server sign-out first on reconnect. |
| IndexedDB open/read is denied | Data-free unavailable screen | Never fall back to cached React props, another partition, localStorage rows, or roles. |
| Remote sign-out succeeds | Data-free/login screen | Server session revocation and active-restaurant-cookie clearing are real. If both local writes failed, the old IndexedDB partition's lock/deletion remains unverified; keep warning that the local lock is not durable and do not hand the device to another person until local recovery verifies the lock/deletion or a fresh authorized reprovision atomically supersedes the old context and locks every non-current partition. Never describe this as secure erase. |

### 6. Keep mutation and Q10/C06 prerequisites as named release gates

This lookup foundation is not C03 completion and does not satisfy offline operation.
The next source promotion may add mutation capture only after C06 proves the Q10
physical model: immutable individual open-bottle identity, exact source-lot and
capacity snapshot, an open receipt that resolves the actual bottle ID plus
`opened_at`, immutable dependencies for pour/spill/close, and linked compensation
instead of deleting history. The current C02 one-open-slot model is not a
compatibility adapter for that contract.

C06 also remains incomplete until the named Q10 slices for tasting/pour presets,
flights and split pours, bottle/table holds, and optional sealed-bottle tags retain
their individual identities and conservation rules. Counts still require online
count sessions and cutoffs. Transfers still require C04 group/site grants and an
online transfer lifecycle; receiving and placement require their own online event
authority. Manager recovery enters only with a real retained-report model and remains
review-only—never an inventory application. These gates remain in the ledger as
required dependencies, not silently deferred features.

## Implementation boundary and order

| Order | Owned files | Exit gate before continuing |
| --- | --- | --- |
| 0. Source/contract promotion | `docs/plans/2026-09-23-terroir-offline-operation-contract.md` and `docs/plans/2026-09-23-terroir-production-execution.md` | Adopt this exact lookup-only scope first. Mark every new requirement **UNIMPLEMENTED** and preserve C03/C05/Q10/C04 dependencies; make no shipped/runtime claim. |
| 1. Pure contract | `src/domains/offline/contract.ts`, `contract.test.ts` | Exact v1 schema; forbidden fields cannot serialize; no role/capability/operation types. |
| 2. Authorized projection | `src/app/api/offline-context/route.ts` and test; a dedicated server query/mapper module | Actor/site derived from current auth; spoofed IDs ignored; revocation denied; lease <=12h; response `no-store`; every authorized placement preserved. |
| 3. Native store | [Store policy](../../src/domains/offline/database.ts), [IndexedDB driver](../../src/domains/offline/indexeddb.ts), and focused tests under `src/domains/offline/` | Local deterministic tests and independent review pass; real-browser proof remains required. IndexedDB v1 has exactly `contexts` and `projections`; atomic provision; sole-eligible-partition, lock, expiry, rollback, corruption and denial cases fail closed. |
| 4. Session boundary | [Offline session boundary](../../src/app/%28app%29/offline-session-boundary.tsx), [application layout](../../src/app/%28app%29/layout.tsx), and [settings dropdown](../../src/app/%28app%29/settings-dropdown.tsx); signout, callback, and confirmation routes under `src/app/auth/`; `src/app/login/actions.ts`; `src/app/api/dev-login/route.ts`; [proxy](../../src/lib/supabase/proxy.ts); [device marker](../../src/domains/offline/device-lock.ts); [same-origin helper](../../src/lib/auth/same-origin-request.ts); focused tests | Bounded local source and 153 focused unit and contract tests cover no locked-login loop, active-restaurant clearing, session-returning auth transition state, marker conservation, both local persistence failure branches, stable in-flight attempts, and raw duplicate-cookie denial. The 17-case browser checkpoint includes four sign-out states at both 320 px and 390 px; the other nine cases use the default viewport. |
| 5. Public shell | Planned offline route and client page under existing `src/app/`; planned offline provider under existing `src/app/(app)/`; [application layout](../../src/app/%28app%29/layout.tsx); `src/lib/context/restaurant.tsx`; planned service worker under existing `public/` | Worker cache allowlist and complete-shell acknowledgment pass before registration is called ready. No shell activation before orders 1–4 pass. |
| 6. Browser proof | focused Playwright spec | All proofs below pass before any implemented ledger assertion may be promoted to proved; lookup-only scope and C03/C05/Q10/C04 dependency states remain explicit. |

Do not add a PWA/IndexedDB wrapper dependency or reorganize unrelated auth/cellar
code. The dedicated endpoint, two-store adapter, small provider, public page, worker,
and sign-out boundary are the whole v1 implementation surface.

## Session-boundary browser checkpoint

The guarded, single-worker Chromium run passed all 17 released cases with no failures,
skips, or retries. Four sign-out states ran at both 320 px and 390 px. The three states
that held the data-free warning screen rendered readable status text without horizontal
overflow and retained a keyboard-focusable retry control with a 44 px minimum target.
The confirmed server sign-out with durable lock reached login with private application
content absent and no horizontal overflow; that login screen has no retry control. The
checkpoint covers durable-lock warnings, total local-persistence failure, confirmed
server sign-out without a verified local marker, and confirmed server sign-out with a
durable lock. Those states report what persisted; they do not turn a failed lock into a
successful result.

The duplicate-cookie case observed the original protected `/cellar` navigation for
both root/cellar marker-value orders. Each request carried both raw values in browser
wire order, received a `307` to `/login?next=%2Fcellar`, received no `Set-Cookie`, and
left the browser marker snapshot unchanged. A hard root marker kept the browser at
login; a transition root marker allowed the authenticated control surface. The proof
therefore exercises request-scope cookie behavior instead of inferring denial from the
final URL.

The run also preserved the exact six-table identity snapshot. Counts remained three
auth users, 361 restaurants, 364 workspaces, four memberships, four workspace
memberships, and four inventory command receipts. Browser fixture cleanup completed,
and no retry or source correction occurred during the run.

Only the wider status column is new runtime behavior in this checkpoint. The session
and authentication semantics were already implemented. Browser-seeded IndexedDB rows
remain test fixtures, not product provisioning evidence. This checkpoint does not
cover real-browser native projection provisioning, the public offline shell, positive
eligibility, cached lookup, durable replay, whole-C03 completion, deployment, or
production readiness.

## Positive eligibility and native provisioning design

Status: **PROPOSED, UNIMPLEMENTED, PENDING INDEPENDENT REVIEW.** This section defines
the next lookup-only source slice. It does not make the public shell, cached search,
service worker, or any offline mutation available.

The current source cannot establish positive eligibility. `OfflineContextResponseSchema`
strictly validates the server payload, `provisionOfflineContext` writes a context and
projection atomically, and IndexedDB v1 has only `contexts` and `projections`.
However, persisted contexts have no eligibility or authorization-generation fields,
projections have no `contextId`, and `readSoleUsableProjection` treats one unlocked
row as readable. `lockAllContexts` reports `locked: true` when any context row exists,
even if the current partition is absent and only another locked partition exists.
The layout mounts no provisioning provider. The marker module has no deletion
primitive, and `hasRecognizedDeviceDenial` has no production read consumer. These are
source gaps, not behavior proved by the endpoint, native-store, or session-boundary
checkpoints.

### Persisted shapes and durable denial fence

Keep IndexedDB at database version 1 with the same two stores and key paths. Add these
fields to the strict current record shapes:

    context:    eligibilityVersion=1, authorizationGeneration
    projection: contextId

Add one tagged `DeviceAccessFence` record to the existing `contexts` store. It uses
the reserved compound key
`["__terroir_device_access_fence__", "__v1__"]`. Neither sentinel is a valid UUID, so
it cannot collide with an actor/site context. The strict fence shape contains:

    recordType="device_access_fence"
    fenceVersion=1
    revision=<random UUID>
    state="denied" | "eligible"
    authorizationGeneration=<UUID or null>
    eligibleUserId=<UUID or null>
    eligibleRestaurantId=<UUID or null>
    eligibleContextId=<UUID or null>
    changedAt=<offset timestamp>
    reason="sign_out" | "access_changed" | "provisioned"

The `userId` and `restaurantId` key-path properties hold only the two sentinels.
The `eligible*` properties carry the bound actor, site, and context when `state` is
`eligible`. A denied fence carries no eligible binding. Its
`authorizationGeneration` records the exact generation observed by the denial
operation when one valid generation is available.

`lockAllContexts` and the session boundary dependency must use the distinct exported
`OfflineLockResult` type:

    export type OfflineLockResult = {
      locked: boolean
      denialFenceCommitted: boolean
      projectionsDeleted: boolean
    }

`locked` keeps its accepted legacy meaning. It is true only after the readwrite
transaction completes with at least one well-formed current or legacy context row in
the transaction, including an already locked row; the tagged fence is not a context
row for this count. It therefore remains false when there are zero contexts.
`denialFenceCommitted` is separate. It is true only after the same transaction locks
every well-formed current or legacy context, writes `state="denied"` with a fresh
`revision`, and emits `complete`. This fence write is required when the current
partition is absent, all contexts are legacy, there are zero contexts, or only
another already locked partition exists. A failed or aborted transaction returns
both `locked: false` and `denialFenceCommitted: false`, even if an earlier row was
already locked. Projection deletion remains a separate best-effort result because a
committed denied fence blocks every native read even when projection bytes remain.

The session boundary computes durable denial as
`denialFenceCommitted || locked || clientCookieVerified || responseCookieVerified`.
This preserves the accepted zero-context truth (`locked: false`) while allowing a
committed zero-context fence to select `locked_server_confirmed` or
`locked_server_unconfirmed` instead of the unlocked outcome. Tests must assert the
two booleans independently; neither may be inferred from the other.

After its cookie gates pass, the provider captures the fence revision before its
network request. The later provision transaction must compare the current fence with
that captured snapshot, including absent-versus-present state. A changed revision
aborts the transaction.
An initial provision may create an eligible fence when both the captured and
transaction-time fence are absent. A provision that starts from a denied fence also
requires the exact `reprovision_required` marker. If the fence records a denied
authorization generation, the candidate generation must differ. The transaction
changes the fence to `eligible` and binds its actor, site, context, and generation
only alongside the new context and projection writes. Every fence write, denied or
eligible, generates a fresh revision. An exact replay may return the existing result
without a fence write; if it writes, it must also use a fresh revision.

This compare-and-set rule is the transaction's denial fence. A same-generation
current-partition check alone is insufficient: there may be no current partition,
the current row may be legacy, or an unrelated locked partition may be the row that
made the old lock helper report success.

### Marker and authorization-generation rules

`authorizationGeneration` is a random UUID in a second readable cookie with
`Path=/`, `SameSite=Lax`, `Secure` in production, no `HttpOnly`, and a 400-day maximum
age. Every successful session-returning auth transition, accepted active-site change,
and hard-lock write rotates it while writing the transition or hard marker. It is
authorization-transition evidence, not the serialization primitive. The IndexedDB
fence supplies serialization when cookie or generation writes fail.

The marker, generation cookie, and fence are browser display and native-eligibility
state only. Server routes must continue to derive authentication and authorization
from the verified server session and membership. None of these browser values is
authentication evidence or permission to serve API data.

Generation parsing accepts exactly one UUID cookie. Missing, malformed, or duplicate
generation cookies are unavailable, including duplicates with the same value. An
existing valid server session with no exact generation keeps the online application
available but makes native provisioning and native reads unavailable. The UI reports
that offline setup requires a new sign-in or explicit site selection. It does not
invent a generation, use a legacy row, or open IndexedDB before the marker and
generation gate passes.

`setActiveRestaurant` is the explicit active-site marker writer. After it verifies
membership, the accepted response writes the signed active-site cookie, a fresh
authorization generation, and `reprovision_required`. Partial cookie persistence
cannot authorize a native read because the provider requires the current layout
actor/site, exact generation, fence binding, and marker state. The active-site route
and helper tests must prove all three writes for the accepted case and no transition
write for a rejected membership.

`resolveActiveMembership` remains a read-only resolver. Its deterministic fallback
does not write a marker, rotate a generation, or silently provision. If fallback
changes the layout's actor/site props, the provider invalidates the old attempt and
the marker-checked read requires the new exact site. A prior site's record cannot
render. With no matching eligible record and no `reprovision_required` marker, the
provider reports `site_transition_unacknowledged` and asks for explicit site
selection or a new sign-in. It does not treat fallback as consent to provision.
This behavior also covers a membership change that invalidates the signed active-site
cookie.

There is one permitted transition-marker deletion primitive,
`clearReprovisionMarkerAfterCommit`, and one production call site in
`src/app/(app)/offline-context-provider.tsx`. The provider calls it only after the
provision transaction commits. The primitive accepts the captured generation,
requires the exact
`reprovision_required` marker and unchanged generation, expires only the root marker,
then reads both cookies back. It succeeds only when the marker is absent and the
generation is unchanged. A hard marker, changed generation, duplicate stronger
marker, cookie failure, or readback failure leaves the marker in force. The
marker-conservation contract allowlists only this primitive and provider call site.
Proxy and auth handlers gain no deletion authority.

The marker-conservation test must keep its exact literal-owner and mutation checks
while making these bounded updates:

- the exact `device-lock` production importer set becomes
  `src/app/(app)/offline-context-provider.tsx`,
  `src/app/(app)/offline-session-boundary.tsx`,
  `src/app/api/dev-login/route.ts`, `src/app/auth/callback/route.ts`,
  `src/app/auth/confirm/route.ts`, `src/app/auth/signout/route.ts`,
  `src/app/login/actions.ts`, `src/domains/offline/eligibility.ts`,
  `src/lib/api/active-restaurant.ts`, and `src/lib/supabase/proxy.ts`;
- the exact `setDeviceLockCookie` helper-writer set adds only
  `src/lib/api/active-restaurant.ts` to the four existing session-returning auth
  writers;
- the exact `writeClientDeviceLock` caller remains
  `src/app/(app)/offline-session-boundary.tsx`, and the direct cookie-option writer
  remains `src/app/auth/signout/route.ts`;
- the former blanket assertion forbidding exported names containing
  `delete|clear|expire` becomes an exact assertion allowing only
  `clearReprovisionMarkerAfterCommit`; and
- the exact production caller set for that primitive contains only the private
  provider. Any other importer, writer, deletion primitive, or caller fails the
  contract.

### Marker-checked native read layer

Add `src/domains/offline/eligibility.ts` as the only production entry point for a
positive native read. `readEligibleOfflineContext` receives the current layout
`userId` and `restaurantId`. It checks the browser marker and exact generation before
opening IndexedDB. Any recognized marker, missing or invalid generation, or missing
current actor/site returns unavailable without returning private data.

The database read then parses each raw row independently as one exact current record,
one exact legacy record, or the single fence. It ignores well-formed legacy rows for
eligibility instead of letting one legacy row poison the whole array. It aborts on an
unknown or corrupt row, duplicate fences, or a corrupt current record. Projection
rows follow the same per-row current-or-legacy classification.

A ready result requires one eligible fence whose generation, actor, site, and
`contextId` match the caller and exactly one unlocked, time-valid current context.
The context must have `eligibilityVersion === 1` and the same generation. Exactly one
current projection must match its actor, site, `contextId`, kind, and version.
Everything else returns no private value. The private provider uses this entry point
for its readiness decision. The later public shell must use the same entry point; it
may not call `readSoleUsableProjection` directly.

A source contract test must establish `src/domains/offline/eligibility.ts` as the
only production caller of `readSoleUsableProjection`. Tests may exercise the database
helper directly. No provider, layout, public route, or future shell may import or call
it as a production read boundary. This private provider is deliberately implemented
before the public offline shell: it establishes the one positive-read gate that the
later shell must consume without making any public route or cached-search UI
available in this slice.

### Provider protocol and transaction order

Mount the private-tree provider inside `OfflineSessionBoundary` and pass the server
layout's exact `user.id` and `restaurantId`. One attempt follows this order:

1. Capture the actor/site props, raw marker and exact generation cookies, and an
   in-memory attempt number. Do not open IndexedDB.
2. Apply the cookie gates before every IndexedDB opening. A hard marker returns
   unavailable. A missing, malformed, or duplicate generation returns unavailable.
   With no recognized marker, call only `readEligibleOfflineContext`; that function
   repeats the marker and generation checks before opening IndexedDB. Do not fetch or
   provision after a read miss. Provision begins only from the exact
   `reprovision_required` marker.
3. Only after the exact reprovision marker and generation pass, capture the fence
   revision and state. Fence-read failure returns unavailable without fetching.
4. Run an abortable, bounded, `no-store` same-origin GET to
   `/api/offline-context`. Reject a non-200 response, invalid strict payload,
   actor/site mismatch, or invalid lease before the write transaction.
5. Immediately before opening the readwrite transaction, require unchanged props,
   attempt number, marker, and authorization generation.
6. In one transaction, classify every context and projection row, compare the
   captured fence revision, reject an older response for the same generation, reject
   equal-time different-context ambiguity, lock every non-current current or legacy
   partition, write the current context and projection, and bind the fence eligible.
7. Wait for the transaction's `complete` event. Then attempt the one marker
   acknowledgment. A fetch response or `stored` result alone never means ready.
8. Call `readEligibleOfflineContext`. Report ready only if that marker-checked read
   returns the exact committed value.

Unmount, sign-out intent, changed props, or a newer attempt aborts the fetch and
invalidates the callback. A late callback cannot start a valid transaction, report
readiness, or remove a marker. Server `issuedAt` orders responses within one
authorization generation. An exact replay may be idempotent. A newer response may
replace an older one. The fence revision, not `issuedAt` or the cookie alone,
serializes a denial against stale work.

The critical counterexample has this order: a provider captures revision F1, its
fetch returns, and its final cookie/prop precheck passes; sign-out then commits a
denied fence with revision F2; only after that commit does the stale provider create
its provision transaction. The transaction reads F2, detects the F1 mismatch, and
aborts. This remains denied even if both hard-marker writes and the generation
rotation fail. The stale transaction cannot recreate an unlocked partition or
acknowledge a marker.

Two concurrent provisions that capture the same fence revision do not both commit.
IndexedDB serializes their readwrite transactions. The first eligible write creates
a fresh revision. The second transaction then sees a revision mismatch and aborts,
even when both responses carry the same generation and payload. The loser never
acknowledges the marker or reports its failed transaction as ready. After the winner
commits and acknowledges the marker, a later marker-checked read may observe the
winner's exact record. If the winner cannot acknowledge the marker, both tabs remain
unavailable even though eligible bytes exist. A newer response that lost this race
requires a fresh attempt from the new revision; response time cannot bypass the
fence comparison.

### Required race and failure outcomes

| Race or failure | Required result |
| --- | --- |
| Zero contexts when sign-out starts | The transaction returns `locked: false`, `denialFenceCommitted: true`, and a fresh denied fence. The durable-denial expression selects a locked outcome; a stale provision with the captured absent fence aborts. |
| Current partition absent but another current context exists | The transaction preserves legacy `locked: true`, commits `denialFenceCommitted: true`, and denies every native read. The missing current partition does not weaken the fence. |
| Current partition is legacy | The transaction locks the legacy row, returns `locked: true`, commits `denialFenceCommitted: true`, and never treats legacy bytes as eligible. |
| Only another partition is already locked | Legacy `locked` remains true because a context row exists. `denialFenceCommitted` independently proves the fresh fence commit; the unrelated row must not be mistaken for that proof. |
| Fence transaction aborts | Both `locked: false` and `denialFenceCommitted: false`, even if a context was already locked. Sign-out navigation still needs another verified durable denial. |
| Sign-out commits between precheck and transaction creation | The stale provision aborts on the fence revision mismatch. Marker and generation write failure do not weaken this outcome. |
| Sign-out or actor/site change before fetch settles | The attempt is invalidated. No late transaction, readiness report, or marker deletion occurs. |
| Two tabs capture one fence revision | The first eligible transaction writes a fresh revision. The second aborts on mismatch, never acknowledges the marker, and can become ready only through a later marker-checked read of the winner or a fresh attempt. |
| Actor A signs out and actor B signs in | B needs a fresh exact generation and reprovision marker. A's captured fence revision or generation cannot acknowledge or become eligible for B. |
| Marker deletion or readback fails | The marker-checked read returns unavailable although eligible bytes may exist. |
| Storage denial, quota, timeout, abort, or version change | The transaction rolls back, no eligibility is acknowledged, and the marker remains. |
| Reload before commit or acknowledgment | The marker-checked layer denies before returning private data. |
| Silent membership fallback selects a different site | The expected-site check rejects the prior site. Without an explicit transition marker, no automatic provision occurs. |
| A valid existing session has no generation | Online use continues; native read and provision return unavailable without opening IndexedDB until a new acknowledged transition. |
| A well-formed legacy row shares the array | Per-row classification skips it for reads and can lock or replace it during provision. One legacy row does not poison unrelated current rows. |

The fence remains browser application state. A device owner can edit it, storage can
be evicted, and simultaneous failure or loss of every denial write remains the
limitation stated earlier. It does not provide secure erase, trusted time,
instantaneous remote revocation while offline, or confidentiality from the device
owner. The implementation does not depend on Web Locks, BroadcastChannel, or another
coordination service. Missing IndexedDB, cookies, `crypto.randomUUID`, or abort
support keeps provisioning unavailable.

### Frozen implementation and proof paths

The minimal path set is:

- marker, generation, and transition writers:
  `src/domains/offline/device-lock.ts`,
  `src/domains/offline/device-lock.test.ts`,
  `src/app/auth/signout/route.ts`,
  `src/app/auth/signout/route.test.ts`,
  `src/lib/api/active-restaurant.ts`,
  `src/lib/api/active-restaurant.test.ts`,
  `src/app/api/restaurant/[id]/route.test.ts`, and
  `src/test/contracts/offline-device-marker-conservation.test.ts`;
- native fence, record, and read policy:
  `src/domains/offline/database.ts`,
  `src/domains/offline/database.test.ts`,
  new `src/domains/offline/eligibility.ts`, and
  new `src/domains/offline/eligibility.test.ts`, plus
  new `src/test/contracts/offline-positive-read-boundary.test.ts`;
- private integration:
  new `src/app/(app)/offline-context-provider.tsx`,
  new `src/app/(app)/offline-context-provider.test.tsx`,
  `src/app/(app)/offline-session-boundary.tsx`,
  `src/app/(app)/offline-session-boundary.test.tsx`,
  `src/app/(app)/layout.tsx`, and `src/app/(app)/layout.test.tsx`;
- unchanged auth-flow call sites with generation assertions in their existing tests:
  `src/app/login/actions.test.ts`,
  `src/app/auth/callback/route.test.ts`,
  `src/app/auth/confirm/route.test.ts`, and
  `src/app/api/dev-login/route.test.ts`; and
- real-browser proof:
  existing `e2e/offline-session-boundary.test.ts` and new
  `e2e/offline-positive-eligibility.test.ts`, using the existing guarded fixture and
  cleanup harness.

Do not change the offline endpoint response, IndexedDB version, store list, key paths,
proxy, public routes, service worker, or dependency graph in this slice. If
implementation needs another production path, stop and amend this design before
coding.

The deterministic matrix must cover current and legacy per-row classification,
unknown-row refusal, strict actor/site/context/projection/generation/fence matching,
initial absent-fence provision, every denied-fence case in the table, the exact
precheck-then-denial-then-transaction race, same-generation stale-response rejection,
idempotent replay, equal-time ambiguity, two concurrent provisions from one fence
revision, all-or-nothing faults at each write, and zero private output for malformed,
expired, rollback, ambiguous, or storage-failure states. Database and session-boundary
tests must assert `locked` and `denialFenceCommitted` separately, including the exact
zero-context result `{ locked: false, denialFenceCommitted: true }` and abort result
`{ locked: false, denialFenceCommitted: false }`. Provider tests must prove that hard
markers and invalid generations return before any IndexedDB call, then cover
commit-before-delete, post-ack marker-checked read, no delete after late fetch or
invalidated props, no delete after transaction failure, hard-marker precedence,
failed-deletion denial, missing-generation unavailability, silent site fallback, and
no readiness claim from a fetched response alone. The positive-read boundary
contract must fail for any production caller of `readSoleUsableProjection` other than
`src/domains/offline/eligibility.ts`. Marker tests must cover generation rotation on
hard, session, and explicit site transitions, duplicate-generation denial,
exact-generation deletion refusal, and missing browser primitive refusal.

The existing 17-case `e2e/offline-session-boundary.test.ts` checkpoint must be rerun
without retry or skip after its fixture helpers distinguish user context rows from
the tagged fence. Its zero-context case must assert zero user contexts, one denied
fence, and the locked-server-unconfirmed visible outcome when server sign-out is
unconfirmed; the focused database test owns the exact `locked: false` and
`denialFenceCommitted: true` return assertion. Its context-bearing cases must assert
the expected locked user rows and one denied fence rather than weakening raw row-count
checks. The earlier 17-case proof remains revision-scoped; prose is not a substitute
for this rerun.

The guarded single-worker Chromium matrix must inspect real cookies and IndexedDB for
fresh provision, an existing session with no generation, reload before
acknowledgment, transaction abort, marker-write failure, marker-deletion failure,
actor A to actor B, explicit site switch, silent membership fallback, sign-out during
a delayed fetch, the exact post-precheck fence race, absent and legacy current
partitions, an unrelated locked partition, and a two-tab older-response race. Each
case must prove that no stale row renders, the legacy `locked` value reflects context
row truth, `denialFenceCommitted` reflects the separate fresh fence commit, and the
marker disappears only after the exact committed generation-bound record exists.
This browser leaf may prove native provisioning only.
The later public shell and cached-search slice must consume the marker-checked read
entry point, preserve the `asOf` label, and pass their own cache/offline UX matrix
before any offline-ready claim.

## Concrete acceptance proof

1. **Contract/API tests:** unauthenticated, revoked, cross-site and spoofed-identity
   requests cannot obtain a context; valid output has only the explicit fields,
   contains none of `current_unit_cost`, price/list/target-margin/note/member/staff
   keys, is `no-store`, and never includes role or operations. A wine in two active
   bins emits both structured placements; two inventory lots in one bin emit one
   placement with their summed quantity; identical-looking labels remain distinct
   by bin ID; cross-restaurant, retired-bin, and unbound rows cannot fabricate a
   placement. No test may accept the first location only.
2. **Storage tests in a real browser:** object-store enumeration is exactly
   `contexts, projections`; provisioning locks every other partition; zero/multiple
   eligible contexts, schema corruption, denied open, aborted transaction, quota,
   expiry and clock rollback reveal no private value. No success/“offline ready” state
   appears after a failed projection commit.
3. **Cache inspection:** with service-worker requests observed, `/offline` precache
   carries no Cookie header, returns a direct 200, and all cached URLs are `/offline`,
   same-build `/_next/static/*`, or declared icons. Assert no `/cellar`, RSC, `/api/*`,
   Supabase, upload, mutation, redirect, or tenant/cost content in Cache Storage.
4. **Offline reload UX:** after a successful provision, Chromium
   `context.setOffline(true)` hard reloads to `/offline` at 320/390/768, shows the
   correct projection and `asOf`/stale label, remains keyboard/focus usable, and never
   claims real-time availability.
5. **Session matrix:** actor A sign-out immediately unmounts A; actor B/new site sees
   no A rows; active-restaurant is cleared; hard marker plus still-valid auth reaches
   `/login` without a loop. Session-returning callback, confirm, password login,
   dev login, and signup write transition state; no-session signup and failed auth
   preserve it. Prove same-origin signout acceptance, cross-site/missing-evidence
   refusal without side effects, recovery precedence, and no proxy marker writes.
   With A's IDB lock/deletion failing, B login and reload before provisioning must
   remain offline-denied. The later provider leaf must prove positive eligibility
   and committed-provision-before-marker-deletion ordering. Exercise IDB-lock success
   with cookie failure, cookie success with IDB failure, zero contexts, and both local
   writes failing, then verify the truthful messages and reconnect behavior above.
   Browser-seeded IndexedDB is fixture evidence, not product provisioning evidence.
6. **Clock/expiry and cache truth:** before-`issuedAt`, backwards-from-last-read and
   at/after-`expiresAt` all produce the data-free screen and require online
   reprovision. Inspect IndexedDB and rendered controls to prove no cached role or
   capability. Finally rerun targeted TypeScript, ESLint, unit/route tests, and the
   single-worker Chromium spec through the guarded local proof runner.

Passing these proofs establishes only the C03 lookup/context/storage/session
foundation. It does not certify offline writes, counts, recovery, Q10 physical-bottle
tracking, C04 transfers, C05 completion, deployment, or production readiness.

## Required later slices, not part of IndexedDB v1

The following approved B/C outcomes remain required. They describe future server
and durable-capture contracts, not available functionality or authority to create
operation stores in this lookup slice. Promote their detailed requirements before
implementation once the named dependencies have proof.

## Approved operation allowlist

### B — required restaurant service slice

| Operation | Offline capture | Commit/review rule |
|---|---|---|
| Find wine/location | Read sanitized site projection | Always show `asOf`; never promise last-bottle exclusivity |
| Open bottle | C02 `open` payload with observed stock/version | Current service capability; receipt must return the resolved bottle lifecycle for dependent reports |
| Pour | Immutable intended wine/volume plus any preceding local operation dependency | Before offline open→pour can ship, the server contract must resolve and return the actual bottle ID + `opened_at`; exact UUID replay returns one receipt |
| Waste/spill | Immutable intended wine/volume/reason, or C02 `close` with actual/write-off/reason | Spill needs the same server lifecycle-resolution contract as pour; close remains bound to the selected bottle ID + `opened_at` |
| Count sealed/open stock | Observation bound to an existing count session | Session open, cutoff/version valid, movement review and manager resolution |

No offline 86ing, reconciliation approval, delete, pricing or role change is implied.

### C — bounded follow-on

| Operation | Offline capture | Prerequisite before implementation |
|---|---|---|
| Delivery receipt observation | Source reference, identity/format/quantity, damage/shortage exception | Canonical receiving lifecycle and review rules; no offline cost/credit approval |
| Transfer dispatch | Source/destination site, subject, quantity, UUID | C04 group/site grants, same-owner policy and transfer state machine |
| Transfer receipt | Actual quantity against transfer UUID | Accepted dispatch dependency and destination authority |
| Within-site placement/move | Subject, from/to location, quantity, observed allocation version | Placement/allocation event authority and capacity/conservation checks |
| Discrepancy note | Explanation linked to report/observation | Review-inbox foundation; note alone never changes stock |

Authorization/membership administration, price/margin changes, purchase commitments,
supplier-credit settlement, legal-owner changes, deletes and final discrepancy approval
are online-only. Central purchasing and warehouses remain deferred.

## Conflict, count and transfer rules

A physical report survives stock, lifecycle, version or permission conflict. A
needs-review report changes no committed quantity and marks the affected subject as
disputed only after the server has accepted that review record. The local UI may say
“pending conflict”; it must not globally mark inventory disputed before the server
knows. Resolution creates a linked correction or a recorded rejection reason and
retains original actor, UUID, observation, lease and payload hash.

Counts require a server-created `count_session` with site, scope, baseline cutoff,
status and creator. Version 1 cannot start a count offline. Each observation records
session ID, subject, sealed units or open mL, observation time, local sequence and
observed projection version. Replay compares all committed movements since cutoff and
late pending reports. A completed/expired session never auto-applies a late absolute
count; it needs review or recount. The repository has no such model, so C03 remains
incomplete after the service-command slice until this foundation and live tests land.

Transfers require group/site containment, owner/custodian semantics and a state machine
before offline work. Receipt-before-dispatch waits on its dependency. Dispatch six /
receive five leaves one in transit or disputed; it never disappears or appears at both
sites. A rejected dispatch cannot create destination stock. These dependencies place
C04 and the online transfer lifecycle before the transfer portion of C05.
