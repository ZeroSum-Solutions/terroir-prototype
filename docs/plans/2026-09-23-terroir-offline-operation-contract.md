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
They are not yet connected to application flows. Real-browser persistence and
session integration remain unverified; these requirements are not complete.
TER-CF-294 through TER-CF-296 public-shell, session-boundary, and cached-search work
is incomplete. This lookup slice adds no mutation capture, queue, replay, recovery
report, count, transfer, receiving flow, provider call, schema migration, dependency,
or production activation. Active source requirements state scope; they do not prove
that the behavior ships.

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

Replace the bare sign-out form with a small offline-aware client boundary. On user
intent it immediately clears private React state and renders a generic locked view;
then it starts a bounded IndexedDB `lockAllContexts` attempt, writes and reads back
`terroir_device_locked=1`, and attempts the existing server sign-out whenever the
network is available. Local storage failure must not prevent that network request.

The readable lock cookie is an application display signal, not authentication. Use
`Path=/`, `SameSite=Lax`, `Secure` in production, and deliberately no `HttpOnly` so
offline code can set/check it. The server sign-out route also sets the lock cookie,
calls `clearActiveRestaurant()` regardless of the local IndexedDB outcome, and then
completes the Supabase sign-out. An offline result may say “locked on this device;
server sign-out pending” only when at least one local lock marker was verified.

In `updateSession`, evaluate the lock cookie before the existing authenticated-user
`/login` redirect:

- `/offline` stays public.
- `/login` renders and never redirects a locked request back to `/`.
- a locked protected request returns one redirect to `/login`; it never emits private
  HTML even if a Supabase user cookie is still present.
- auth-cookie invalidation/deferred sign-out is attempted on reconnect, but failure
  leaves the lock in place rather than opening a redirect loop.

Successful `/auth/callback` exchange and successful `/api/dev-login` verification
clear the lock cookie in their outgoing response. Failed authentication does not.
Clearing the cookie permits the new online session; it does not unlock old IndexedDB
partitions. Only a fresh authorized `/api/offline-context` response may atomically
unlock the exact new actor/site partition, with all others remaining locked.

### 5. Specify honest storage, lock, reload, and clock-failure behavior

Every offline render first verifies: exactly one eligible context, matching
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
| Cookie verifies, IndexedDB lock fails | Private data removed | `/offline` honors the cookie and proxy blocks private online render; projection deletion is only best effort. |
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
| 4. Session boundary | Planned offline-aware sign-out component under existing `src/app/(app)/`; [settings dropdown](../../src/app/%28app%29/settings-dropdown.tsx); `src/app/auth/signout/route.ts`; `src/app/auth/callback/route.ts`; `src/app/api/dev-login/route.ts`; `src/lib/supabase/proxy.ts`; existing focused tests | No locked-login loop; active restaurant cleared; success-only unlock cookie; both local persistence failure branches render honestly. |
| 5. Public shell | Planned offline route and client page under existing `src/app/`; planned offline provider under existing `src/app/(app)/`; [application layout](../../src/app/%28app%29/layout.tsx); `src/lib/context/restaurant.tsx`; planned service worker under existing `public/` | Worker cache allowlist and complete-shell acknowledgment pass before registration is called ready. No shell activation before orders 1–4 pass. |
| 6. Browser proof | focused Playwright spec | All proofs below pass before any implemented ledger assertion may be promoted to proved; lookup-only scope and C03/C05/Q10/C04 dependency states remain explicit. |

Do not add a PWA/IndexedDB wrapper dependency or reorganize unrelated auth/cellar
code. The dedicated endpoint, two-store adapter, small provider, public page, worker,
and sign-out boundary are the whole v1 implementation surface.

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
5. **Session matrix:** actor A sign-out immediately blanks A; actor B/new site sees no
   A rows; active-restaurant is cleared; lock cookie plus still-valid auth reaches
   `/login` without a loop; successful callback/dev login clears the cookie; failed
   login does not. Exercise IDB-lock success with cookie failure, cookie success with
   IDB failure, and both local writes failing while offline, then verify the exact
   messages and reconnect behavior above.
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
