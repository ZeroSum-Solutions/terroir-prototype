# Applying migrations to production

**Why this file exists.** On 2026-08-29 production was found sitting at `0111` while
the repo was at `0136` — ten unapplied migrations, including a HIGH-severity RLS fix.
Nothing was broken: there was simply no documented procedure, no gate, and nothing that
would ever have said so out loud. This is that procedure.

## The thing to understand first

**Railway deploys `main`. Nothing deploys migrations.** `railway.toml` sets
`startCommand = "pnpm start"` and that is the whole deploy. A merge to `main` ships
application code to *both* the `production` and `staging` Railway environments at the
same SHA — see the [staging smoke workflow](../../.github/workflows/staging-smoke.yml) —
and touches the database not at all.

**There is one Supabase project.** `terroir` / `qcfmwphlaekfkqwkfyth`, in the
`Zerosumsolutions-Projects` org. Railway production and staging both point at it, so
there is no database-level staging and no rehearsal environment. The local stack
(`docs/runbooks/local-stack.md`) is the only rehearsal you get.

That combination is why migrations must be applied **before** the code that depends on
them lands. The general old-code compatibility rule does not permit mixed callers
during the `0165`–`0167` seal: section 4d requires one continuously drained
maintenance window through exact compatible deployment, with no intermediate resume.

## Procedure

### 1. Find the gap

Put a PostgreSQL client compatible with the production database on `PATH` before
starting.

```bash
DB_URL=$(zsvault get terroir_supabase_admin_db_url)
psql "$DB_URL" -Atc "select max(version) from supabase_migrations.schema_migrations;"
ls supabase/migrations/*.sql | tail -1
```

Do not trust the max version alone — confirm with an object probe, because a migration
can be recorded without its effects surviving, and effects can exist without a record
(see *Drift* below):

```bash
psql "$DB_URL" -Atc "select proname from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname='public' and proname in ('<a function your top migration adds>');"
```

### 2. Check there is a restore point

```bash
curl -s -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
  "https://api.supabase.com/v1/projects/qcfmwphlaekfkqwkfyth/database/backups" \
  | jq -c '{pitr: .pitr_enabled, walg: .walg_enabled, latest: .backups[0].inserted_at}'
```

PITR is **off**; WAL-G daily physical backups are on. Your worst case is losing a day.
If the latest backup is stale relative to the risk you are about to take, stop and take
one first.

### 3. Dry-run against production, in a transaction you roll back

This is the step that matters, and it is not optional. Local data does not look like
production data — that is exactly how `0135` passed review, passed CI, and then failed
on the real table.

```bash
psql "$DB_URL" -v ON_ERROR_STOP=1 -q <<'SQL'
begin;
\i supabase/migrations/0135_identity_resolution_on_write.sql
rollback;
SQL
```

A migration that cannot survive this cannot be applied, and — because a restore drill
replays `0001..N` in order over restored data — it also cannot be *replayed*. Fix the
migration, not the invocation.

### 4. Apply, one transaction per migration, recording as you go

Each migration and its `schema_migrations` row go in **one** transaction, so a failure
leaves no half-state and no false record. Stop at the first failure.

```bash
for n in 0127 0128 0129; do
  f=$(ls supabase/migrations/${n}_*.sql)
  name=$(basename "$f" .sql); name=${name#${n}_}
  [ "$(psql "$DB_URL" -Atc "select 1 from supabase_migrations.schema_migrations where version='${n}';")" = "1" ] \
    && { echo "SKIP $n"; continue; }
  psql "$DB_URL" -v ON_ERROR_STOP=1 --single-transaction -q \
    -f "$f" \
    -c "insert into supabase_migrations.schema_migrations(version,name) values ('${n}','${name}');" \
    || { echo "FAIL $n — rolled back"; break; }
done
```

Note `--single-transaction` will not protect a migration containing
`CREATE INDEX CONCURRENTLY`. Check for it first; none exist as of `0151`.

### 4a. Special rollback boundary for 0151

The forward `0151` migration follows the one-transaction apply procedure above. Its
paired down is deliberately different: it owns its own `BEGIN`/`COMMIT`, takes an
exclusive lock on `inventory_command_receipts`, and refuses before changing any object
when even one receipt exists. Do not wrap that down in `--single-transaction`, and do
not run it while application traffic is active.

Receipts are the replay boundary for already-committed physical effects. If the guard
reports `cannot_down_0151_inventory_command_receipts_not_empty`, stop. Do not truncate,
delete, or bypass the guard to make the rollback run; retaining or reconciling those
receipts requires a separate reviewed migration and incident plan. The verified empty
down restores the prior Undo function before removing the receipt table; reapplying
`0151` then restores the RPC and an empty receipt table.

A code-only downgrade to an older inventory handler is not retry-safe merely because
the 0151 table remains. The older handler ignores the new `Idempotency-Key`, so an
outstanding new-client retry can apply its physical effect twice. Before any application
downgrade, quiesce affected inventory traffic and assess outstanding client operations;
otherwise keep the receipt-aware endpoint in service until those operations are resolved.

### 4b. Maintenance-window and operator boundary for 0152

Migration 0152 is backward-compatible after commit, but applying its schema is an
explicit maintenance-window operation. It does not promise zero downtime.

1. Pause application ingress, background jobs, invitation acceptance, and auth signup.
   Let in-flight writers drain. Do not terminate sessions without separate incident
   authority.
2. Resolve the exact production migration credential. Do not assume a role named
   `postgres` can lock or alter `auth.users`: table ownership and role membership vary
   by environment. With traffic still paused, use that same credential for the bundled
   no-DDL catalog and lock preflight, and retain its complete output:

   ```bash
   psql "$DB_URL" -X -v ON_ERROR_STOP=1 \
     -f scripts/0152-production-preflight.sql
   ```

   Before the forward migration, this proves that `current_user` is the **direct shared
   owner** of `public.restaurants`, `public.memberships`, and the existing
   `public.handle_new_user()` function; has `USAGE` plus `CREATE` on schema `public`;
   has `USAGE` on schema `auth`; has both `REFERENCES` and the narrowly required
   runtime `SELECT` on `auth.users`; can execute `auth.uid()` and
   `seed_reason_codes(uuid)`; can use `membership_role` and the SQL/PLpgSQL languages;
   has either `rolsuper` or `rolbypassrls` so the provenance trigger can distinguish an
   actually deleted auth parent from an RLS-hidden live one; and can obtain the exact
   forward lock set. The evidence also reports inherited authority with PostgreSQL's
   correctly spelled `pg_has_role(..., 'USAGE')`, but inherited-only ownership is
   rejected: `CREATE OR REPLACE` preserves the signup function's security-definer
   owner while new objects belong to `current_user`. If the connection login is only a
   member of the shared owner, explicitly `SET ROLE` to that owner before running both
   this preflight and the migration. The preflight records `rolsuper` and
   `rolbypassrls`; one must be true for auth-row visibility, but neither substitutes
   for the coherent direct-owner boundary. Ownership of `auth.users` is not required.

   Any failed catalog gate, permission error, or SQLSTATE `55P03` blocks the apply. Do
   not grant broader access ad hoc; resolve the approved migration operator and its
   established role membership with the provider, then repeat the complete preflight.
3. Apply through the direct PostgreSQL session used by this runbook. The migration and
   its `schema_migrations` row must share one outer transaction:

   ```bash
   psql "$DB_URL" -v ON_ERROR_STOP=1 --single-transaction -q \
     -f supabase/migrations/0152_workspace_access_foundation.sql \
     -c "insert into supabase_migrations.schema_migrations(version,name) values ('0152','workspace_access_foundation');"
   ```

4. The migration's first statements take `SHARE ROW EXCLUSIVE NOWAIT` on `auth.users`
   and `ACCESS EXCLUSIVE NOWAIT` on `restaurants` plus `memberships`. SQLSTATE `55P03`
   is a clean pre-DDL refusal: keep the maintenance window in place, identify and drain
   the conflicting session, and make one deliberate retry. Never loop-retry against
   live traffic.
5. After commit, run containment, signup, old-writer, cascade, exact-capability,
   privilege, and query-plan smokes before restoring traffic. Existing application code
   may resume because omitted workspace/lifecycle columns are derived by compatibility
   triggers; application code that depends on the new schema must not deploy first.
   During the pre-deployment window, generate and check types only against the guarded
   local schema (`node scripts/generate-supabase-types.mjs --local` /
   `pnpm run types:check:local`). Hosted type generation is expected to fail closed until
   0152 has been separately authorized and applied there; never apply a production
   migration merely to resolve local compilation.
6. The paired down owns its own explicit transaction and must not be wrapped in
   `--single-transaction`. It also requires paused traffic and refuses any state that the
   legacy model cannot preserve. Re-run the bundled preflight with the exact rollback
   credential after 0152 exists; it then checks direct ownership of the four public
   tables and all C04 functions and probes the down lock set. The down itself first
   takes `ACCESS EXCLUSIVE NOWAIT` on `auth.users`, then on `workspaces`, `restaurants`,
   `workspace_memberships`, and `memberships`, before its first guard or DDL. SQLSTATE
   `55P03` is a clean no-change refusal; do not loop-retry it against traffic.

Generic migration runners are not approved for production 0152 unless their per-file
transaction boundary has been demonstrated. The local/disposable path uses `psql -1`;
the repository production path uses `psql --single-transaction`.

The first-line `DRAFT ONLY` comment in `0152_workspace_access_foundation.sql` is a
sealed historical marker, not the current release decision. Do not edit it: the
admission tests pin that migration's exact SHA-256. Production approval lives in this
runbook, the current preflight, the verified backup/restore evidence, and the explicit
maintenance-window execution record.

### 4c. Physical and operational cutover: 0153 through 0164

Migrations `0153`–`0155` are additive preparation. Migration `0156` retires fresh
version-1 inventory commands and seals direct writes to the physical-event tables;
`0158` retires the old two-write bottle receiving path. This is therefore one
maintenance window, not a series of live rolling changes.

1. Keep both Railway web environments and every worker that can write this database
   at zero replicas. Confirm in-flight sessions have drained. The same Supabase project
   serves staging and production, so pausing only one environment is insufficient.
2. Run the `0153`, `0154`, and `0156` preflights immediately before their matching
   migrations. Apply `0153`, `0154`, and `0155` one at a time using the atomic
   migration-plus-ledger-row procedure in step 4.
   Immediately after `0154`, run `scripts/0154-production-capability-bootstrap.sql`
   in one transaction with an owner-reviewed JSON manifest of exact
   `membership_id`/`actor_user_id` pairs and the exact expected entry count. The
   bootstrap refuses role-derived discovery, non-owner or stale identities,
   pre-existing grant history, duplicate memberships, or partial results. It calls
   the same governed replacement function as the application and grants the three
   accepted owner capabilities (`cost.read`, `margin.read`, `pricing.manage`). Do not
   proceed to `0157` until its `C04_0154_CAPABILITY_BOOTSTRAP_PASS` receipt reports
   three active grants for every manifest membership.
3. Apply `0156`, then run `scripts/0156-production-postflight.sql`. Do not restore the
   old application: fresh calls to `execute_inventory_command` now refuse with
   `legacy_inventory_command_retired` by design.
4. Before `0157`, every committed invoice line must name a valid same-tenant wine.
   If the reviewed preflight identifies the one known historical scan, run
   `scripts/0157-production-remediation.sql` in its own transaction with the exact
   reviewed scan id, line count, and preimage MD5. The script locks its target,
   requires a one-to-one inventory match, changes only missing `wine_id` fields, and
   refuses any preimage drift. Never generalize or bypass those guards during release.
5. Run the `0157` preflight, apply `0157`, and run its postflight. Then acknowledge the
   still-drained bottle route explicitly when running the `0158` preflight:

   ```bash
   psql "$DB_URL" -X -v ON_ERROR_STOP=1 -v bottle_route_drained=1 \
     -f scripts/0158-production-preflight.sql
   ```

6. Apply `0158`, run its postflight, then apply `0159` through `0164` individually.
   Keep the route drained until the application containing the exact physical-bottle
   and receiving RPC callers is deployed successfully.
7. Verify a contiguous hosted ledger through `0164`, physical inventory contract
   version 2, the remediated scan postimage, and the object/capability assertions in
   the postflights. Only then merge/deploy the application. Resume web replicas after
   both Railway environments report the merged release SHA and `/api/health` confirms
   database connectivity.

The CI lifecycle intentionally mirrors this boundary: legacy live suites execute at
`0155`, then the repository cutover helper applies and verifies `0156`–`0164` before
current-schema E2E. A green local cutover is necessary but does not replace the hosted
backup, maintenance-window, preflight, or postflight evidence above.

### 4d. Staff-cost privacy seal: 0165

The hosted project is already at `0164`; do not replay earlier migrations.
`0165_staff_cost_seal_contract.sql` seals direct cost-bearing reads and inventory
writes while retaining capability-checked application commands. It owns its own
`BEGIN`/`COMMIT` and migration-ledger insert. Do not wrap it in another transaction
or append a second ledger insert.

Its catalog gates recognize only two reviewed preimages: the disposable local
baseline and the independently captured hosted baseline in
`supabase/tests/0165_staff_cost_seal_contract/hosted-baseline.json`. The latter
includes 352 relation-ACL tuples, six Storage policies, two restaurant-column
UPDATE grants and the hosted invoice bucket's existing MIME list. They are not
interchangeable. A changed preimage must stop the release, not select a looser
profile. Routine bodies and constraints remain pinned separately.

The selected hosted preimage is recorded atomically as a non-executing marker in
the existing `schema_migrations.statements` column. The paired down and postflight
derive their profile from that locked marker; an unknown marker fails closed.
Rollback restores that profile's original grants and policies, not the disposable
database's permissions. It does not erase application inventory or history.

Before permanent apply:

1. Verify a current backup and the separately retained restore-drill evidence.
   The successful `0164` data-recovery drill did not certify ownership or grant
   recovery; do not confuse it with the migration's own catalog rollback check.
2. Pause BOTH production and staging web environments and ALL shared-database
   workers. Drain in-flight writers and preserve their exact replica configuration
   for recovery. Keep them continuously drained through the `0165` postflight,
   `0166`, `0167` and deployment of the exact compatible merged SHA. Never
   resume between migrations; neither old web callers nor workers may run during
   this window.
3. Use the same existing operator connection for the bundled preflight, all three
   history gates and the rollback-only dry-run. Storage-policy authority is not
   proved or disproved by role membership alone: hosted Supabase can delegate
   policy DDL through `supautils.policy_grants`. Verify the registered provider
   setting and the required lock privileges without changing owners or roles.
4. Review and hash the exact migration source. The bounded
   `supabase/tests/0165_staff_cost_seal_contract/prepare-hosted-dry-run.mjs`
   checks that hash and produces a derivative that changes only the terminal
   commit to rollback and the receipt label to `DRY_RUN`. It prints SQL; it does
   not execute it. Retain the source, derivative and actual executor output.
   A `DRY_RUN` receipt is never an `APPLIED` receipt.
5. Confirm the rolled-back ledger and complete catalog preimage are unchanged.
   Only then apply the reviewed original file once and run its bundled postflight
   before `0166`/`0167`, which change routines that postflight pins. Keep all
   writers drained while applying `0166` and `0167` with their atomic ledger
   records and reviewed postconditions.
6. Deploy the exact compatible protected-main merge while both web environments
   and all workers remain drained. Verify successful build/deployment metadata and
   the exact merged SHA for BOTH web environments and every worker image that will
   start or resume BEFORE ANY scale-up. An older healthy response, branch SHA or
   successful local test cannot satisfy this gate. Only then restore the approved
   replicas and verify that deployed SHA, connected health and real low-privilege
   application/Data API/Storage behavior. Hosted worker activation needs its own
   verified compatible image and runtime evidence.
7. On any failure, keep traffic and workers stopped. Restore the reviewed compatible
   old caller in maintenance, then apply `0167` down, `0166` down and `0165`
   down in that order. Remove the `0167` and `0166` ledger rows atomically with
   their downs; `0165` down owns its transaction/ledger reversal. Verify the exact
   old caller against the restored schema, ledger, ACL/policy preimage and unchanged
   business data/history before any resume. Do not delete receipts, widen grants or
   restore the unsafe six-argument creator grant as a mixed-caller workaround.

The original local `0165` apply/down/reapply and the later local `0166`/`0167`
rehearsals/activation passed. Current candidate `2630de5f` and CI37099223190
reach local ledger139/0167; accepted bounded local criteria are S01–S20, S22,
M3 and M4. The no-app M2 seed rehearsal captured exactly 17 added transaction
rows/full 490, then rolled back to the conserved 473-row state. The later local
no-seed M2 recovery and independent bounded M2 union are accepted; fresh postflight
conserves the prior 473 plus 14 retained owned rows at 487. The
[demo handoff](restaurant-demo-macbook-handoff.md#latest-release-status-october-3)
owns the caller scope and manual/synthetic limitations. Those local receipts do
not activate hosted code. The latest backup restore,
run37093730653/artifact11263433507, compared 87 tables, two sequences and ten
checksums at `0164`; ownership/grant and extension-owned-table recovery remain
excluded, and backup freshness must be rechecked at cutover.

Local M1 functional, retry, concurrency, types/snapshot/TSC and mandatory six
live-CI-suite assertions are covered. Whole M1/S21 still needs populated-history,
quiesced `0165` down/up and an actual `0157` actor-bound-history guard refusal with
conservation; source assertions alone do not satisfy those safety cases. The
already-required admitted hosted R1 rehearsal can cover these exact remaining
assertions. Do not replay accepted local business operations to create a generic
second rehearsal. M2, M3 and bounded M4 are accepted; M5/R1–R4 remain open.

Hosted dry-run/apply, worker activation and exact compatible deployment remain
NOT RUN. Four HIGH security/operator conditions remain STOPPED, including the
continuous-drain rollout requirement above. The native release goal is ACTIVE,
but ZS Vault is LOCKED. Do not bypass that credential boundary or infer
a hosted apply, whole-demo completion or release approval from local checks.

### 4e. Reconciliation lineage post-state: 0166

`0166_reconcile_lineage_poststate.sql` follows the privacy seal. It changes only
the acceptance and undo routines to verify the lineage actually returned by an
update. It does not bypass lineage derivation, change grants, or rewrite history.
Its admission and postcondition gates pin routine bodies, owner, privileges and
interface metadata; an unexpected preimage stops the migration.

Unlike `0165`, this file does not own a transaction or ledger insert. Apply its
SQL and its migration-ledger record together in one caller-owned transaction.
Run the `0165` postflight before applying `0166`: that earlier postflight pins
the pre-0166 routine bodies and is not a valid final-state check afterward.

Before hosted apply, retain a reviewed rollback-only rehearsal and exact
catalog/data conservation evidence. The canonical regression at
`supabase/tests/0166_reconcile_lineage_poststate/regression.sql` owns its own
transaction and terminal rollback. Run it separately; do not nest it unchanged
inside a migration rehearsal. Any savepoint adaptation needs separate review.
The regression covers a valid mixed batch, conflicting lineage acceptance,
replay, stale undo and trigger-rejected legacy restoration.

For a full rollback of the current stack, first roll back `0167`, then restore
`0166` with its paired down and remove its ledger entry atomically before
rolling back `0165`. Keep all web and worker writers drained throughout. The down requires the exact new
routine definitions and restores the previous definitions; it does not delete
inventory or reconciliation history. CI applies `0166` after `0165` and then
runs the standalone regression. Local or CI success is not hosted apply proof.

### 4f. Immutable invoice upload and resume: 0167

`0167_invoice_upload_resume.sql` follows `0165` and `0166`. The privacy seal
intentionally does not grant invoice-image UPDATE or unrestricted SELECT.
Compatible callers insert pages with `upsert: false` and record a SHA-256 digest
in object user metadata. A narrow boolean reader admits a pending page only
for its current actor, live upload claim, exact path and recorded digest/size/MIME.
The digest is caller-recorded metadata, not a Storage-service byte attestation.

The seven-argument upload creator binds exactly the submitted page names and
requires all bound objects to belong to the actor. Missing, extra, stale or
cross-actor pages fail before a scan or extraction job is created. The original
six-argument creator retains its body but is no longer callable by users. JSON
uploads provide a one-object manifest even when their transport key differs
from the object's scan ID.

Apply the SQL and ledger record atomically in a caller-owned transaction. Run
the `0165` postflight before this migration, since that postflight pins the old
creator grant. Rehearse forward/down in a rollback-only window and verify
unchanged data, history and image policies. Run the standalone local regression
`supabase/tests/0167_invoice_upload_resume/regression.sql` separately.
Keep both web environments and all workers drained for forward application and
rollback. In maintenance, restore the reviewed compatible old caller before
applying the paired down and removing its ledger entry atomically, then follow
`0166` down and `0165` down. This restores the old creator grant only with the
restored schema; it deletes no data and permits no mixed-caller interval.
Verify exact caller/schema compatibility before resume. The accepted real local
two-page VISION worker flow is local evidence, not hosted activation or an Azure
OCR claim.

### 5. Verify the effect, not the record

Assert the thing the migration was for. A `schema_migrations` row proves only that an
insert ran.

```bash
psql "$DB_URL" -Atc "select polname,
    pg_get_expr(polwithcheck, polrelid) ilike '%exists%' as has_ownership_check
  from pg_policy
  where polrelid in ('public.stock_adjustments'::regclass,'public.bottle_closeouts'::regclass)
    and polcmd = 'a';"
curl -s https://terroir-web-staging.up.railway.app/api/health
```

## Drift

Production can contain objects no migration created — made by hand in the dashboard,
usually to unblock something. `0130` hit exactly this: its bucket and all three storage
policies already existed, so the migration failed on `policy ... already exists`.

Do not force it and do not skip it. Compare the live object against what the migration
declares:

```bash
psql "$DB_URL" -Atc "select polname, polcmd,
    pg_get_expr(polqual, polrelid), pg_get_expr(polwithcheck, polrelid)
  from pg_policy where polrelid = 'storage.objects'::regclass order by polname;"
```

Then apply only the genuine difference and record the version. Anything you leave
different is drift you now owe a follow-up migration for — record it in the plan rather
than in your memory.

**Known open drift as of 2026-08-29:** production's `wine-images` bucket allows
`image/heic` and `image/heif`; `0130` declares only jpeg/png/webp. A fresh environment
built from migrations will therefore reject HEIC uploads that production accepts.

## What would have caught this earlier

Nothing did, and nothing yet does. CI verifies migrations against a *local* Postgres;
no gate compares the repo's ceiling to production's. Until one exists, run step 1 as
part of any release that includes a migration.
