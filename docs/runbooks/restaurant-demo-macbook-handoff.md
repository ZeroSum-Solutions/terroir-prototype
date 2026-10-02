# Restaurant demo MacBook handoff (failed candidate)

> **Status: October 2 closeout.** Mobile attempt C is **FAILED**, not pending.
> It reached a healthy local application after 136 migrations through `0164`, then
> completed two real receives and the committed receive replay before the journey
> stopped on a stale Cellar search locator. A source-only repair now targets the
> current accessible Cellar search contract and the portable suite passes 30 tests
> with zero skips. Independent review is pending, and no browser journey was rerun.
> Nobody has reproduced the package on the MacBook. The independent staff-cost
> probe also failed confidentiality. Restaurant-demo milestones M1–M5 and production
> readiness remain incomplete.

This is the smallest intended handoff for reproducing the restaurant inventory
story on a second Mac: receive two bottles, open one, pour four glasses,
count sealed and open stock, record a measured volume, and reconcile the exact
bottle. A separate staff session must pour successfully but fail reconciliation.
The launcher runs an automated isolated Chromium demo; it does not publish a
mobile URL or keep an interactive application running after success.

## Source checkpoint and release status

Use the [current transfer ledger](../../.claude/handoffs/macbook-transfer.md#current-transfer-ledger)
for branch/publication status, the verified hosted release and safe resume steps.
Fresh GitHub checks confirm [PR #229](https://github.com/ZeroSum-Solutions/terroir-prototype/pull/229)
merged at `85f6ac5f` and [PR #230](https://github.com/ZeroSum-Solutions/terroir-prototype/pull/230)
merged at `2d76a701` on September 27. The current closeout branch is
`feat/restaurant-demo-closeout-20261001`, starting at `c4bf61b4`. It preserves
the Cellar layout repair, which has not merged into `main`. Partial import-caller
checkpoint `ffced31d0964082c2554b1e566d5762e4c36619a` is pushed and matches the
remote feature branch at evidence capture. It is the verified application
checkpoint, not a permanent claim about the latest feature-branch tip. The
portable source snapshot documented here is the commit containing this file.
Resolve its exact `HEAD` and verify the remote feature-branch ref before MacBook
use. A pushed checkpoint does not complete the milestone.

The resumed approval covers isolated local testing and feature-branch commit/push.
It does not authorize a new `main` merge, hosted migration or production deployment.
`main` deploys code to both Railway environments without applying migrations.
Do not infer the hosted release SHA from local Git or a healthy production page.
Use the [milestone plan](../plans/2026-09-27-terroir-restaurant-demo-milestone.md)
for current scope and the [production migration runbook](production-migrations.md)
for separate release gates. This package tests mobile browser layouts, not a native app.

## Current evidence boundary

### October 2 source-only locator repair (independent source review passed)

Against branch base `e115b54b1903b9880da270df4856130e0e368f43`, the portable
journey's single Cellar filter lookup now uses Playwright role `searchbox` with the
exact accessible name `Filter this cellar`. That matches the current
[Cellar input](<../../src/app/(app)/cellar/cellar-shell.tsx>) instead of relying on
the obsolete placeholder `Search name, producer, region…`.

The new regression asserts that the journey contains the current role-and-name
locator and rejects the stale placeholder selector. Before the source repair, the
focused test run passed two tests and failed this new regression. After the one-line
repair, all three focused tests passed. The complete portable source suite then
passed 30 of 30 tests with zero skips.

These are source-only results. No browser, application runtime, Docker service, SQL,
credential, dotenv file, failed-target restart or adoption, mutation replay, commit,
or push was used. Independent Codex source review passed. Attempt C remains
failed, and its evidence below is unchanged. Do not launch a fourth portable target
or restart, adopt, reseed, delete, or replay attempts A, B, or C. Any later runtime
attempt still requires a reviewed locator, a fresh namespace, and the separate raw
cost privacy seal. M1–M5 remain incomplete.

### October 2 mobile attempt C

The fresh `terroir-demo-20261001-mobile-c` run proved the bounded startup path
through the application layer:

- the launcher applied all 136 source migrations through `0164`, admitted the
  zero-stock catalog fixture, created only synthetic users and data, and started
  the database-backed app on loopback;
- the owner received the main wine twice through the browser. Both receives
  committed with distinct operation and inventory-item identities;
- the explicit replay of the first committed receive returned the original
  result without a second inventory mutation (`receiveReplayVerified: true`);
- the journey then failed at `received-main-2-of-2`, before opening a bottle.
  `scripts/local/restaurant-demo/journey.mjs:179` still looks for placeholder
  `Search name, producer, region…`, while the current
  [Cellar input](<../../src/app/(app)/cellar/cellar-shell.tsx>) at line 510
  exposes the accessible name `Filter this cellar` and placeholder
  `Filter this cellar…`; and
- the journey reported no in-flight mutation, and its result contains no
  success-step screenshots. The retained failure screenshot was captured by the
  closeout wrapper. This failure shows selector drift in the portable journey.
  It does not show a stock,
  opening, pouring, reconciliation, permission, persistence, or responsive-layout
  defect in the application.

Repo-owned closeout proof:

- [mobile-C journey result](../evidence/restaurant-demo-20261001/mobile-c-journey-result.json)
- [mobile-C failure screenshot](../evidence/restaurant-demo-20261001/mobile-c-failure.png)
- [independent 0162/0163 functional contracts](../evidence/restaurant-demo-20261001/functional-contracts.md)
- [staff raw-cost failure](../evidence/restaurant-demo-20261001/staff-raw-cost-failure.md)

The launcher preserved the attempt-C runtime and owned Docker resources after
failure. Attempts A and B also remain preserved. Do not stop, delete, reseed,
adopt, or rerun any of those targets. Successful runs preserve their external
runtime directory under the goal safety freeze; owned Docker service cleanup is
eligible only after a passing journey and exact cleanup re-admission.

Independent database checks against the fresh attempt-C database passed the
bounded `0162` bin-mirror and `0163` stalled-scan functional contracts. Both
checks rolled back, and the post-check prefix queries found no residual fixture
rows. This does not establish their concurrency, HTTP, or canonical live-suite
gates.

The independent staff acquisition-cost probe **FAILED**. A synthetic staff member
had `effective cost.read = false`, and the governed reader returned zero rows, but
a direct authenticated `inventory_items` SELECT returned `unit_cost = 47.75`.
The probe rolled back and left no user, wine, or inventory rows. Hidden browser
controls and a denied governed RPC do not seal the raw table path. M1 therefore
remains incomplete until a forward privacy seal and its negative/positive runtime
matrix pass.

Current source checks passed 29 portable tests with zero skips. The normal
Turbopack build completed 73 pages, the focused import/session regression set
passed 36 tests, and the full unit run passed 5,633 with 141 skips. Those results
do not replace the failed browser journey or the skipped live-database coverage.

The failed replan exhausts the authorized startup attempts. There is no fourth
launch and no automatic replay. Hold the portable run until a separately reviewed
stable accessible locator and the staff raw-cost privacy seal are ready. Do not
roll the application UI back to the stale placeholder. M1–M5 remain incomplete.

### September 27 historical evidence

Historical evidence from the September 27 isolated `0164` browser lane:

- an owner at a 390 × 844 touch viewport received two 750 ml bottles into
  `Main Cellar` / `DEMO-A1`;
- the two receive commands created two distinct quantity-one inventory rows;
- the first owner attempt stopped after opening a 750 ml / version 0 bottle.
  A separate exact-state-admitted continuation poured four 150 ml glasses,
  leaving 600, 450, 300, then 150 ml;
- the owner reconciled that same bottle to 120 ml. Its state version advanced
  from 4 to 5, and both a reload and a fresh owner login still showed
  `120 of 750 ml`;
- a separately created synthetic staff user was authorized to find and pour
  150 ml from a separate exact bottle, advancing it to 600 ml / version 1.
  The staff user was redirected away from the reconciliation form. A direct
  reconciliation request returned HTTP 403 and created no command receipt.
  Cost and margin controls were absent for that staff user; and
- the exact-bottle drawer had no horizontal overflow at widths 320, 390, 768,
  and 1200 px. Its `Open another bottle` and `Pour 5.1 oz` actions were each
  52 px high.

Keep the failed first run and its continuation as recovery evidence. Neither
proves an uninterrupted journey or the current candidate's header geometry.
The current mobile one-pass run failed before the opening step. A current desktop
one-pass run did not occur.

Historical local-clone checks applied `0164_import_revert_cleanup.sql`.
Its core functional, isolation, down/up, refusal and extended fixtures passed.
Independent runtime review also accepted both physical open/revert orders,
authority revocation during advisory and batch-row waits, both LWIN writer/revert
orders, and shared-source batch/inverse-session conflicts. Final checks conserved
23 protected-state records, the retained target and both browser clones. The full
TypeScript check passed. These results close the named migration-specific matrix,
not the canonical live-database suite or release gate.

The September 27 full unit run passed 5,589 tests, failed zero and skipped 182. Final live proof for bin
PATCH, import-revert HTTP callers and stalled-scan housekeeping remains open.
The active-site preflight repairs passed 85 focused tests; they do not complete
the raw-cost/Storage privacy cutover or provide an atomic authority seal.

## Non-negotiable safety boundary

- Use a disposable, loopback-only Supabase project and synthetic users. Never
  point this workflow at a hosted project or a retained development database.
- Never read, source, copy, or create `.env.local` for this handoff. It contains
  production credentials in the current checkout.
- Never start the application with bare `pnpm dev`. After the local stack has
  been admitted, use `scripts/local/dev-local.sh`; it reads local Supabase
  credentials from `supabase status`, pins them in the child process, and runs
  the repository's exact local-database guard.
- Do not copy credentials, JWT signing secrets, passwords, container IDs, user
  IDs, or database names from the Mac mini evidence. Provision new local-only
  values on the MacBook and keep secrets in memory.
- Do not use `scripts/local/dev-stack.sh` for this handoff as written. It
  creates/reads `.env.local` and resets the retained repository stack.
- Use the name-search receiving path. The label-photo route needs an external
  model provider key and is not required for this inventory demonstration.

## Readiness gate before attempting the MacBook run

Do not begin the browser journey until all of these are true:

1. The MacBook has the exact candidate revision, Node 20 or newer, pnpm 9 or
   newer, Docker, the Supabase CLI, and Playwright Chromium. The runnable
   source materialization contains no `.env.local`; admission must fail if one
   appears.
2. A reviewed launcher has created a disposable, uniquely named Supabase stack
   bound only to loopback. Its admission check proves the project identity,
   ports, database name, container identity, and network before any write.
3. The disposable database was built from the candidate migrations through
   `0164_import_revert_cleanup.sql`; the schema snapshot, generated database
   types, migration ledger, and source migration hashes match the candidate.
4. A portable fixture has provisioned one synthetic owner and one separate
   synthetic staff user in the same synthetic restaurant. No real credentials
   are involved.
5. The fixture has inserted only the catalog/location metadata described below
   and has proved zero matching inventory, open-bottle, and pour-event rows.
6. A single portable Playwright journey includes owner receiving through fresh
   login verification plus the staff denial checks. It records the last
   completed mutation so a failure never causes a blind replay of receiving,
   opening, pouring, or reconciliation.

The reviewed package under `scripts/local/restaurant-demo/` now provides these
source contracts. It admits a real local Unix Docker socket, pins that endpoint
into all child processes, and refuses a changed socket identity. Before creating
the stack, it rejects any existing resource in the exact disposable namespace,
including stopped containers, networks and volumes.

The launcher creates a nonce-owned loopback bridge network. It records container
and network IDs, volume creation times, project labels and resource references,
then freshly re-admits the complete ledger before every cleanup action. It uses
exact container/network IDs rather than project-name `supabase stop`. Docker
volume removal uses names because Docker exposes no immutable volume ID; the
launcher checks creation time, labels and all container references immediately
before removal. Source acceptance does not prove actual cleanup or MacBook execution.

The package has no automatic recovery mode. Failed runs preserve the runtime,
Docker resources, evidence and mutation latch; unsafe cleanup also preserves them.
Inspect exact database and receipt state before doing any further work. A new
execution requires a new disposable project and unused ports. Never reseed or
blindly rerun a failed clone. The journey's explicit same-key replay checks test
committed idempotency; they do not authorize replay of an uncertain mutation.
The three failed targets A, B, and C are closed evidence, not reusable launch
targets.

## Portable package setup and launch

The launcher accepts caller-selected disposable project identity, ports,
runtime directory, and evidence directory. It materializes Git-listed source
into the empty runtime, omitting all dotenv files without reading them. It rewrites
only the isolated Supabase config and disables the CLI's automatic migration and
seed phases. After database admission, it applies each of the 136 forward migrations
and its ledger insert in one transaction through `0164`, including the existing
0156–0158 pre/post probes. This preserves 0152's required `LOCK TABLE` transaction.
It then provisions synthetic users in memory, applies the catalog-only fixture,
starts the app through `scripts/local/dev-local.sh`, and runs the journey. On
success it stops its app, re-admits and removes only the owned Docker services,
and preserves the external runtime directory under the goal safety freeze.
Evidence survives. On failure it preserves both runtime and Docker resources. It
prints or writes no password, service key, signing key or database URI.

The runtime contains its own copied `node_modules` directory so Turbopack can
resolve dependencies inside the isolated project root. The copy preserves only
contained relative package links; absolute or escaping links and dotenv entries
fail before copying. It requests filesystem cloning where available, with a normal
copy fallback. It does not install into, rewrite or chmod canonical dependencies.
Allow disk space for the dependency copy, disposable database and evidence.

In the clean candidate checkout, install only the locked project dependencies
and the repository's browser engine:

```bash
pnpm install --frozen-lockfile
pnpm exec playwright install chromium
```

First run its non-mutating argument/source check. Set `TERROIR_DEMO_RUNTIME` and
`TERROIR_DEMO_EVIDENCE` in your shell to absolute paths whose parents already exist.
Runtime and evidence paths must end
in dedicated `terroir-demo-*` names, sit outside the checkout, be distinct and
absent, and contain neither one another nor the source checkout:

```sh
node scripts/local/restaurant-demo/launcher.mjs \
  --source-root="$PWD" \
  --runtime-root="${TERROIR_DEMO_RUNTIME:?}" \
  --evidence-dir="${TERROIR_DEMO_EVIDENCE:?}" \
  --project-id=terroir-demo-macbook-a \
  --api-port=61321 --db-port=61322 --shadow-port=61320 \
  --studio-port=61323 --mail-port=61324 --app-port=3102 \
  --journey-width=390 \
  --owner-email=owner+macbook-a@terroir.test \
  --staff-email=staff+macbook-a@terroir.test
```

That command reports `status:SOURCE_ONLY_UNEXECUTED` and `executionReady:true`.
It creates no directory, container, user or listener, and does not prove that
Docker or the requested ports are available. To execute the same command,
append both `--execute` and
`--ack=I_ACKNOWLEDGE_DISPOSABLE_RESTAURANT_DEMO`.

The execution form is documented for a future reviewed checkpoint. Do not run it
against attempts A, B, or C, and do not launch another target from the current
failed candidate. A new execution requires a reviewed stable accessible locator,
the staff
raw-cost privacy seal, a new disposable namespace, new paths, and unused ports.

The default complete journey uses a 390 × 844 touch viewport. For a separate
desktop journey, set `--journey-width=1200`, choose a new disposable project,
new runtime/evidence paths and a fresh unused port block. Do not replay either
journey against the other run's database.

The launcher requires exact IPv4-loopback API/database URLs, exact
loopback-only Docker bindings, an unused port set, the disposable
`terroir-demo-*` project namespace, migrations through 0164, inventory contract
2, and a healthy database-backed app owned by the process group it started.
The journey verifies the signed-in actor and active restaurant before its first
mutation and retains the demonstrated 20-second assertion timeout.

## Fixture contract

Create unique identities for each run rather than reusing the fixed IDs from
the isolated proof. The fixture contains exactly:

| Entity | Required value |
|---|---|
| Restaurant memberships | separate active synthetic owner and staff |
| Owner capabilities | explicit `cost.read`, `margin.read`, `pricing.manage` grants for that named synthetic owner |
| Staff capabilities | operational staff membership; no pricing/cost/margin grants or management role |
| Wines | `Restaurant Demo 750` and a separate deliberately long-label staff wine, both 750 ml |
| Bin | active `DEMO-A1` in `Main Cellar` |
| Wine list | unpublished synthetic list |
| List section | `By the glass` |
| List items | one per fixture wine, fixed 150 ml pour |
| Other site | separate synthetic restaurant, no owner membership |
| Inventory/open bottles/pours/receipts | zero rows for either fixture wine and the demo site |

The fixture must fail closed if the target is not the admitted disposable
database, the current inventory contract is not 2, the owner membership is
missing, an identity is already occupied, or any mutable inventory already
exists. The fixture neither weakens production authority nor invents stock.
Receiving through the UI must create all inventory rows.

## Exact owner demo and expected numbers

1. Sign in as the synthetic owner and verify the active synthetic restaurant.
2. Open `/scan-bottle`, choose `Find wine by name`, select the fixture wine,
   confirm `Main Cellar` and `DEMO-A1`, then choose `Receive 1 bottle`.
3. Repeat step 2 once. Require two successful receive receipts with distinct
   operation IDs and distinct inventory item IDs, each with quantity 1.
   The automated journey replays the first committed receive with the same
   request body and key. Require the same response, `Idempotency-Replayed: true`,
   and no inventory, history or receipt-count change.
4. Open Cellar, search for the fixture wine, and open its detail drawer. The
   row/drawer may say `2 in stock`: that is total on-hand bottles, not two
   sealed bottles after the next step.
5. Choose `Open bottle`. Require one open-bottle receipt for a 750 ml native
   physical bottle sourced from one of the two received inventory rows. The
   resulting state is one sealed bottle plus one open bottle at 750 ml.
6. Select the exact open bottle and choose the 150 ml (`5.1 oz`) pour four
   times. Require remaining volumes of 600, 450, 300, then 150 ml and state
   versions 1, 2, 3, then 4. The first committed pour receives the same-key
   replay check; require no second event or volume change.
7. Count one sealed bottle and one exact open bottle at 150 ml / version 4.
   From Cellar, open `More cellar actions`, choose
   `Reconcile 1 open bottle`, enter 120 ml for the exact bottle, and save one
   change. Require HTTP 200, command `reconcile_batch`, remaining volume 120
   ml, and state version 5. The journey captures the measured 120 ml form
   before saving, distinguishing the recorded count from the expected 150 ml.
8. Reload the page, then open a fresh isolated owner session. Require the same
   bottle to remain selected and show `120 of 750 ml` in both cases.

Every new mutation must carry a unique idempotency key and the expected actor and
restaurant identity headers. Each response must echo the operation identity
and satisfy its strict receipt schema. On failure, stop and report the last
completed step; do not rerun earlier mutations until database state is read
and reconciled with the saved receipts. Only an explicit committed replay reuses a key.

## Staff denial and responsive checks

Use a separate browser context and a separately provisioned synthetic staff
account. Do not downgrade the owner account.

1. As owner, receive two bottles of the separate long-label staff wine through
   the UI and open one.
2. Password-sign in the synthetic staff user and verify its actor, restaurant,
   active membership, and `staff` role. Select that exact bottle and
   successfully pour 150 ml, leaving 600 ml / version 1.
3. Visit `/cellar/reconcile`. Require redirect to `/cellar` and no actual-volume
   form.
4. POST a valid-looking reconciliation for the main exact bottle at version 5 with
   target 110 ml. Require HTTP 403, zero receipt rows for that operation, and
   unchanged bottle state at 120 ml / version 5.
5. Open the fixture wine drawer and require cost and margin controls to be
   absent.
6. As owner, attempt to rename the unrelated synthetic restaurant. Require
   HTTP 403 and unchanged inventory/history state.
7. In fresh owner contexts, inspect the long-label exact-bottle drawer at widths 320, 390,
   768, and 1200 px. Require no horizontal overflow and at least 44 × 44 px
   controls. Require keyboard access and visible focus on a primary action,
   the active-site context, and the expected desktop/mobile navigation.

These checks cover the specified drawer/header/navigation and one rejected
cross-site mutation. They do not prove all-page accessibility, light/dark contrast,
loading/error states, the full cross-site matrix or raw API/database/Storage privacy.
Hidden cost controls alone never prove a cost boundary.

## Existing-source reuse assessment

| Current source | Reuse | Gap before MacBook use |
|---|---|---|
| `scripts/local/restaurant-demo/launcher.mjs`, `docker-lifecycle.mjs`, `fixture.sql`, and `journey.mjs` | Reviewed local-only source package, with explicit execution acknowledgement. | Mobile C failed on a stale Cellar locator before opening. Cleanup did not run; staff raw-cost privacy and MacBook reproduction remain open. |
| `scripts/local/dev-local.sh` | Reuse directly after stack admission. It obtains current local keys and pins the local origin safely. | Requires an already-running instance of this repository's configured local stack; it does not create a disposable stack. |
| `scripts/local/assert-local-db.sh` | Reuse its exact-host-and-port refusal pattern. | It recognizes the retained repo ports and can fall back to `.env.local`; the disposable launcher needs its own explicit process-only target admission. |
| `scripts/local/dev-stack.sh` | Reuse its migration/readiness sequencing as design input only. | Do not execute for this handoff: it creates/reads `.env.local` and performs a destructive retained-stack reset. |
| `scripts/local/seed-local.mjs` | Reuse its local identity concepts. | It does not create the exact catalog-only fixture, separate staff proof identity, or disposable-stack admission required here. |
| `scripts/seed-local-supabase.mjs` | Reuse representative roles/data only for unrelated exploratory demos. | Its rich seed has existing inventory/history and no bin fixture, so it cannot prove that this journey begins at zero and receives through the UI. |
| `e2e-physical-v2/admission.ts` and `start-server.ts` | Reuse the fail-closed disposable-target and app-start patterns. | They belong to the physical-v2 test contract; they are not the MacBook launcher. |
| `e2e-physical-v2/physical-bottle-fixture.ts` | Reuse typed entities and receipt-oriented assertions. | It inserts inventory directly, so it cannot be the restaurant receiving fixture. |
| `e2e-physical-v2/d1-physical-bottle.test.ts` | Reuse exact-bottle open/pour selectors and state assertions. | It does not perform two receives, owner reconciliation, fresh-login persistence, or staff denial as one journey. |
| `e2e/pour-flow.test.ts` | Reuse reconciliation selectors and accessibility checks. | It bootstraps through APIs and legacy-compatible data; it is not an isolated end-to-end restaurant demo. |

The successful 2026-09-27 proof-only sources live outside the repository under
the goal-state `proof/browser-demo-lane/journey/` directory:
`fixture.sql`, `run-owner-journey.mjs`, `continue-owner-from-opened.mjs`,
`staff-role-proof.mjs`, and `viewport-check.mjs`. Port their strict receipts,
failure markers, role denial, and viewport assertions. Do not port their fixed
database/container/network IDs, fixed actors, fixed bottle IDs, absolute
paths, ports, in-memory JWT implementation or split continuation into a new run.
The portable package has no continuation mode. Keep the old continuation as
historical recovery evidence, not as instructions to resume a failed new clone.

## Remaining portability gates

The three bounded repo-owned pieces now exist without introducing a new test
framework:

1. **Disposable stack launcher:** process-only local configuration, exact
   target/network admission, migrations through `0164`, local auth, owned
   cleanup, and no `.env.local` dependency.
2. **Catalog-only fixture:** runtime owner/restaurant inputs, unique per-run
   IDs, wine/bin/list/section/150 ml item, strict zero-inventory precondition,
   and a machine-readable non-secret receipt.
3. **One Playwright journey:** owner receive/open/pour/reconcile/reload/fresh
   login, separate staff denial, four viewport checks, screenshots, strict
   receipts, and mutation-aware resume refusal.

Before this failed candidate can become a verified MacBook runbook, the package
needs a reviewed stable accessible locator, a raw-cost privacy seal, clean mobile and desktop
current-candidate browser execution, independent runtime/cleanup review, a MacBook
reproduction and the root-owned database/release gates.
The launcher copies the candidate migration, snapshot, and generated-type
files from the admitted checkout and the fixture requires migration 0164, but
it does not independently regenerate or hash-compare those artifacts. Keep the
existing root-owned schema/type/source-pin gate; do not infer it from a browser
journey result.
The journey uses an owner-authorized reconciliation and a staff denial. It does
not separately establish the full manager-role matrix or multi-site workflows.
All M1–M5 criteria still require their own passing evidence.

## Evidence to retain after the first MacBook reproduction

Record the exact revision, Node/pnpm/Supabase/Playwright versions, admitted
loopback ports and disposable project name, migration/source/type checks,
fixture receipt, owner journey receipt, staff denial result, and screenshots.
Redact or omit all credentials and signing material. A passing MacBook run may
then replace this draft status; it must not retroactively claim any milestone
that was not separately verified.
