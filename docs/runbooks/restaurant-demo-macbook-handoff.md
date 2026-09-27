# Restaurant demo MacBook handoff (draft)

> **Status — 2026-09-27:** draft only. The workflow below has **not** been
> reproduced on the MacBook, is not a release procedure, and is not evidence
> that restaurant-demo milestones M1–M5 are complete.

This is the smallest intended handoff for reproducing the restaurant inventory
story on a second Mac: receive two bottles, open one, pour four glasses,
reconcile the exact bottle, and prove that staff cannot reconcile it. It is
deliberately grounded in the current guarded local scripts and the isolated
browser proof. The missing portability work is listed before the procedure so
that nobody mistakes this draft for a runnable package.

## Source checkpoint and release status

Use the [current transfer ledger](../../.claude/handoffs/macbook-transfer.md#current-transfer-ledger)
for branch/publication status, the verified hosted release and safe resume steps.
The owner has authorized a `main` merge, but the required hosted schema and
release checks have not cleared. `main` deploys code to both Railway environments
without applying migrations; a healthy existing production URL does not expose
this unmerged demo work. This draft describes mobile-browser testing, not a
separately released native mobile application.

The portable package has seven passing source checks and intentionally refuses
execution. No MacBook runtime pass, production update or M1–M5 completion is
claimed. See the [milestone plan](../plans/2026-09-27-terroir-restaurant-demo-milestone.md)
and [production migration runbook](production-migrations.md) before promotion.

## Current evidence boundary

The 2026-09-27 isolated `0164` browser lane demonstrated:

- an owner at a 390 × 844 touch viewport received two 750 ml bottles into
  `Main Cellar` / `DEMO-A1`;
- the two receive commands created two distinct quantity-one inventory rows;
- the first owner attempt received two bottles and opened one, then stopped
  before its first pour. A guarded continuation admitted the exact saved
  inventory, receipt, event, and 750 ml / version 0 bottle state before it
  performed any further mutation. The continuation then poured 150 ml four
  times. The exact open
  bottle progressed through 600, 450, 300, and 150 ml remaining;
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

This is recovery evidence, not a clean first-pass owner journey. The first run
stopped after opening the bottle; the continuation preserved that failure and
used a separate mutation latch and result. The source now contains the bounded
contract-v2 reconciliation entry and responsive-header fixes. The header fix
has independent source review but has not yet received new browser geometry.
The full owner journey has not been rerun as one uninterrupted flow on the
final candidate.

Migration `0164_import_revert_cleanup.sql` has been applied to a local clone.
Its core functional, isolation, down/up, refusal and extended fixtures passed.
Independent runtime review also accepted both physical open/revert orders,
authority revocation during advisory and batch-row waits, both LWIN writer/revert
orders, and shared-source batch/inverse-session conflicts. Final checks conserved
23 protected-state records, the retained target and both browser clones. The full
TypeScript check passed. These results close the named migration-specific matrix,
not the canonical live-database suite or release gate.

The latest full unit run passed 5,589 tests, failed zero and skipped 182. Final live proof for bin
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

Items 2–6 now have an unfinished repo-owned source candidate under
`scripts/local/restaurant-demo/`. Its source checks pass, but execution is
intentionally disabled: the launcher does not yet prove that no stopped Docker
resources already own the caller-selected project namespace or record and
re-admit every resource it creates before cleanup. It has not been executed on
the MacBook or admitted by an independent lifecycle/security review. Until
those lifecycle checks exist and both reviews pass, this document remains a
draft handoff rather than a verified runbook.

The package has no automatic recovery or replay mode. If any mutation starts
and the journey fails, preserve its evidence and latch, inspect the exact
database/receipt state, and stop. A new execution must use a new disposable
project; it must not target or reseed a retained demo clone.

## Portable package setup and launch

The launcher accepts caller-selected disposable project identity, ports,
runtime directory, and evidence directory. It materializes Git-listed source
into the empty runtime while refusing every dotenv path, rewrites only the
isolated Supabase config, provisions synthetic users in memory, applies the
catalog-only fixture, starts the app through `scripts/local/dev-local.sh`, runs
the journey, and stops its owned app/stack. It prints or writes no password,
service key, signing key, or database URI.

In the clean candidate checkout, install only the locked project dependencies
and the repository's browser engine:

```bash
pnpm install --frozen-lockfile
pnpm exec playwright install chromium
```

First run its non-mutating argument/source check. The runtime and evidence
directories must be absolute, outside the checkout, distinct, and absent:

```sh
node scripts/local/restaurant-demo/launcher.mjs \
  --source-root="$PWD" \
  --runtime-root=/absolute/path/terroir-demo-runtime \
  --evidence-dir=/absolute/path/terroir-demo-evidence \
  --project-id=terroir-demo-macbook-a \
  --api-port=61321 --db-port=61322 --shadow-port=61320 \
  --studio-port=61323 --mail-port=61324 --app-port=3102 \
  --owner-email=owner+macbook-a@terroir.test \
  --staff-email=staff+macbook-a@terroir.test
```

That command reports `executionReady:false` and does not create a directory,
container, user, or listener. `--execute` is currently refused even with the
exact acknowledgement. Do not bypass that refusal. The next implementation
pass must prove the project namespace has no containers, networks, or volumes
before startup, record every created resource identity, and freshly re-admit
those exact resources before cleanup.

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
| Restaurant membership | active synthetic owner |
| Wine | synthetic `Restaurant Demo 750`, 750 ml |
| Bin | active `DEMO-A1` in `Main Cellar` |
| Wine list | unpublished synthetic list |
| List section | `By the glass` |
| List item | the fixture wine, fixed 150 ml pour |
| Inventory/open bottles/pours | zero rows for the fixture wine |

The fixture must fail closed if the target is not the admitted disposable
database, the current inventory contract is not 2, the owner membership is
missing, an identity is already occupied, or any mutable inventory already
exists. Receiving through the UI—not SQL—must create both inventory rows.

## Exact owner demo and expected numbers

1. Sign in as the synthetic owner and verify the active synthetic restaurant.
2. Open `/scan-bottle`, choose `Find wine by name`, select the fixture wine,
   confirm `Main Cellar` and `DEMO-A1`, then choose `Receive 1 bottle`.
3. Repeat step 2 once. Require two successful receive receipts with distinct
   operation IDs and distinct inventory item IDs, each with quantity 1.
4. Open Cellar, search for the fixture wine, and open its detail drawer. The
   row/drawer may say `2 in stock`: that is total on-hand bottles, not two
   sealed bottles after the next step.
5. Choose `Open bottle`. Require one open-bottle receipt for a 750 ml native
   physical bottle sourced from one of the two received inventory rows. The
   resulting state is one sealed bottle plus one open bottle at 750 ml.
6. Select the exact open bottle and choose the 150 ml (`5.1 oz`) pour four
   times. Require remaining volumes of 600, 450, 300, then 150 ml and state
   versions 1, 2, 3, then 4.
7. From Cellar, open `More cellar actions`, choose
   `Reconcile 1 open bottle`, enter 120 ml for the exact bottle, and save one
   change. Require HTTP 200, command `reconcile_batch`, remaining volume 120
   ml, and state version 5.
8. Reload the page, then open a fresh isolated owner session. Require the same
   bottle to remain selected and show `120 of 750 ml` in both cases.

Every mutation must carry a unique idempotency key and the expected actor and
restaurant identity headers. Each response must echo the operation identity
and satisfy its strict receipt schema. On failure, stop and report the last
completed step; do not rerun earlier mutations until database state is read
and reconciled with the saved receipts.

## Staff denial and responsive checks

Use a separate browser context and a separately provisioned synthetic staff
account. Do not downgrade the owner account.

1. Password-sign in the synthetic staff user and verify its actor, restaurant,
   active membership, and `staff` role.
2. Visit `/cellar/reconcile`. Require redirect to `/cellar` and no actual-volume
   form.
3. POST a valid-looking reconciliation for the exact bottle at version 5 with
   target 110 ml. Require HTTP 403, zero receipt rows for that operation, and
   unchanged bottle state at 120 ml / version 5.
4. Open the fixture wine drawer and require cost and margin controls to be
   absent.
5. In fresh owner contexts, inspect the exact-bottle drawer at widths 320, 390,
   768, and 1200 px. Require no horizontal overflow and at least 44 × 44 px
   controls. The latest isolated proof measured both primary drawer actions at
   52 px high.

The four-width check above covers the exact-bottle drawer only. It does not
prove the full milestone accessibility, contrast, loading/error, keyboard, or
cross-site matrix.

## Existing-source reuse assessment

| Current source | Reuse | Gap before MacBook use |
|---|---|---|
| `scripts/local/restaurant-demo/launcher.mjs`, `fixture.sql`, and `journey.mjs` | Repo-owned portable source candidate. It provides a non-mutating admission CLI plus the intended catalog-only fixture and owner/staff/viewport journey. | Execution is disabled pending exact Docker resource ownership and cleanup admission, then independent security/lifecycle review and one actual disposable MacBook execution. |
| `scripts/local/dev-local.sh` | Reuse directly after stack admission. It obtains current local keys and pins the local origin safely. | Requires an already-running instance of this repository's configured local stack; it does not create a disposable stack. |
| `scripts/local/assert-local-db.sh` | Reuse its exact-host-and-port refusal pattern. | It recognizes the retained repo ports and can fall back to `.env.local`; the disposable launcher needs its own explicit process-only target admission. |
| `scripts/local/dev-stack.sh` | Reuse its migration/readiness sequencing as design input only. | Do not execute for this handoff: it creates/reads `.env.local` and performs a destructive retained-stack reset. |
| `scripts/local/seed-local.mjs` | Reuse its local identity concepts. | It does not create the exact catalog-only fixture, separate staff proof identity, or disposable-stack admission required here. |
| `scripts/seed-local-supabase.mjs` | Reuse representative roles/data only for unrelated exploratory demos. | Its rich seed has existing inventory/history and no bin fixture, so it cannot prove that this journey begins at zero and receives through the UI. |
| `e2e-physical-v2/admission.ts` and `start-server.ts` | Reuse the fail-closed disposable-target and app-start patterns. | They are tied to the physical-v2 project contract and currently live in an uncommitted test slice; they are not the MacBook launcher. |
| `e2e-physical-v2/physical-bottle-fixture.ts` | Reuse typed entities and receipt-oriented assertions. | It inserts inventory directly, so it cannot be the restaurant receiving fixture. |
| `e2e-physical-v2/d1-physical-bottle.test.ts` | Reuse exact-bottle open/pour selectors and state assertions. | It does not perform two receives, owner reconciliation, fresh-login persistence, or staff denial as one journey. |
| `e2e/pour-flow.test.ts` | Reuse reconciliation selectors and accessibility checks. | It bootstraps through APIs and legacy-compatible data; it is not an isolated end-to-end restaurant demo. |

The successful 2026-09-27 proof-only sources live outside the repository under
the goal-state `proof/browser-demo-lane/journey/` directory:
`fixture.sql`, `run-owner-journey.mjs`, `continue-owner-from-opened.mjs`,
`staff-role-proof.mjs`, and `viewport-check.mjs`. Port their strict receipts,
failure markers, role denial, and viewport assertions. Do not port their fixed
database/container/network IDs, fixed actors, fixed bottle IDs, absolute
paths, ports, in-memory JWT implementation, or split continuation as the
normal journey. Retain the continuation only as an explicit operator recovery
tool whose exact-state admission must pass before another mutation.

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

Before this draft can become a verified runbook, the new package still needs
independent source/security review, a one-pass disposable browser execution on
the MacBook, and the root-owned database/release gates.
The launcher copies the candidate migration, snapshot, and generated-type
files from the admitted checkout and the fixture requires migration 0164, but
it does not independently regenerate or hash-compare those artifacts. Keep the
existing root-owned schema/type/source-pin gate; do not infer it from a browser
journey result.
Manager behavior, multi-site isolation, and the full M1–M5 acceptance matrix
remain outside the demonstrated slice.

## Evidence to retain after the first MacBook reproduction

Record the exact revision, Node/pnpm/Supabase/Playwright versions, admitted
loopback ports and disposable project name, migration/source/type checks,
fixture receipt, owner journey receipt, staff denial result, and screenshots.
Redact or omit all credentials and signing material. A passing MacBook run may
then replace this draft status; it must not retroactively claim any milestone
that was not separately verified.
