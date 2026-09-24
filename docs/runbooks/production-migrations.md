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
them lands, and why every migration has to be safe to run against a database the old
code is still talking to.

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
