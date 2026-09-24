# Local Supabase Stack

Fully local, Docker-backed Supabase stack for this worktree. Nothing here
ever talks to hosted Supabase — see "Safety model" below.

## Bring-up

`dev-stack.sh` resets the configured retained local database. It drops local data and
replays every migration, so it is destructive and is not safe to run blindly or call
idempotent. Confirm that you intend to erase that exact local stack before invoking
it. This runbook does not provide a fresh-stack creation recipe.

```bash
scripts/local/dev-stack.sh
```

It will:

1. Create `.env.local` from `.env.local.example` with mode `0600` if it is missing.
2. Refuse to continue if the configured Supabase URL isn't local
   (`scripts/local/assert-local-db.sh`).
3. `supabase start` (no-op if already running).
4. `supabase db reset`, which drops and recreates the retained local DB and applies every
   migration in `supabase/migrations/` from scratch.
5. Wait for the API to actually be ready (see "Post-reset readiness"
   below) before touching it.
6. Seed the dev-login bypass user (`scripts/local/seed-local.mjs`).
7. Print connection info and next steps.

Then boot the app against it:

```bash
scripts/local/dev-local.sh
curl -i http://127.0.0.1:3000/api/dev-login   # expect a 30x + session cookies
```

`dev-local.sh` obtains local Supabase process values from `supabase status`; it does
not read `.env.local`. It pins those local values for Next, while Next may still load
unrelated variables through its normal dotenv handling. It derives
`NEXT_PUBLIC_APP_URL` from the effective Next port.
An explicit `--port`, `--port=<value>`, `-p`, or `-p<value>` wins over a nonempty
`PORT`, which wins over 3000. The wrapper refuses malformed or conflicting port flags
before reading local credentials or launching Next. For a non-3000 port, the isolated
Supabase config must also use matching `[auth].site_url` and
`additional_redirect_urls`; the wrapper does not rewrite auth redirect settings.

`pnpm test:e2e` uses the same guarded wrapper and starts a fresh server. It does
not reuse an unrelated process already listening on port 3000. The local auth
configuration allows 100 OTP verifications per five minutes because the full
suite performs more than the Supabase default of 30 dev-login verifications.

## Post-reset readiness

`supabase db reset` restarts the `auth` (GoTrue) container, which gets a new
internal Docker IP. Kong (the local API gateway) can keep routing
`/auth/v1/*` to the STALE IP for a few seconds afterward, returning
transient `502`s — which can break the seed step (or any test run) that
starts immediately after bring-up.

`dev-stack.sh` closes this race: after `supabase db reset` and before
seeding, it polls `http://127.0.0.1:57321/auth/v1/health` and
`http://127.0.0.1:57321/rest/v1/` (with the local anon/publishable key from
`.env.local`) until both return `200`, for up to ~30s. If it sees `502`s
persist past a few seconds, it automatically runs `docker restart` once on
this repo's Kong container (name derived from `supabase/config.toml`'s
`project_id`, e.g. `supabase_kong_terroir-vw-local`) to clear the stale
upstream IP, then keeps polling within the same overall timeout. If the API
still isn't healthy by the deadline, `dev-stack.sh` exits non-zero with a
loud message instead of seeding against a possibly-broken stack.

## Live-test identity conservation

Use `scripts/run-live-test-conservation.mjs` to wrap live Vitest files that
create database fixtures. Before invocation, the process environment must
contain local values for these three names:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`

The runner requires the guarded URL to use exactly `127.0.0.1` and the configured API
port. It derives `project_id`, the database port, and the API port from
`supabase/config.toml`; it never falls back to a retained default project or an
environment override. Before the child starts, it requires the exact running
`supabase_db_<project_id>` container, matching project labels, and database and API
bindings that cover IPv4 loopback. It rejects invalid or ambiguous config, wrong
labels and port mismatches. It accepts an IPv4 binding on `127.0.0.1` or
`0.0.0.0`; this retained-stack compatibility check does not prove loopback-only
exposure. A newly isolated demo stack must bind its API explicitly to
`127.0.0.1`.

The runner admits one immutable database container ID, applies read-only PostgreSQL
options and timeouts to its snapshots, and uses that same ID before and after the
child. It refuses container replacement or identity drift instead of switching to a
new target. The child always receives `CI=1`. The wrapper exits non-zero when the
local guard, Docker admission, either snapshot, the child command, or identity
comparison fails.

Run it with Node 20, pnpm 9, and one Vitest worker. List the intended live test
files explicitly:

```bash
mise exec node@20 -- node scripts/run-live-test-conservation.mjs -- \
  corepack pnpm@9 exec vitest run src/domains/import/p3-live.test.ts \
  --maxWorkers=1
```

The snapshot covers exact identities in six tables: `auth.users`,
`restaurants`, `workspaces`, `memberships`, `workspace_memberships`, and
`inventory_command_receipts` (the last uses restaurant/operation ID pairs). It
does not compare row contents, other tables, or the whole database. The CLI also
does not prove that a broader requested test inventory ran or that Vitest
reported zero skipped tests. Gates that need those claims must verify the exact
file set and result counts separately.

## Teardown

```bash
supabase stop
```

Data lives in a Docker volume and survives `supabase stop` / `supabase
start` cycles. To wipe it, run `supabase db reset` again (or `supabase stop
--no-backup` to drop the volume entirely).

## Ports

This repo's `supabase/config.toml` uses `project_id = "terroir-vw-local"`
and a `573xx` port block instead of the supabase-cli defaults (`543xx`),
because other local Supabase stacks for sibling worktrees/projects on this
machine already occupy `543xx`, `553xx`, and `563xx`. If you see a port
conflict, check `docker ps` for other `supabase_*` containers before
assuming this stack is broken.

| Service          | Port  |
|------------------|-------|
| API (Kong)       | 57321 |
| Postgres         | 57322 |
| Studio           | 57323 |
| Inbucket/Mailpit | 57324 |
| Analytics        | 57327 |
| DB pooler        | 57329 |
| DB shadow (diff) | 57320 |

## Seed data

`scripts/local/seed-local.mjs` is intentionally minimal: it ensures the
dev-login user (`DEV_BYPASS_EMAIL`, default `devlocal@terroir.test`) exists
and has a restaurant + owner membership, via the existing
`handle_new_user()` signup trigger
(`supabase/migrations/0001_auth_boundary.sql`). That's enough for
`/api/dev-login` to land in a working, empty venue. It's safe to re-run —
it no-ops if the user and membership already exist.

For a richer dataset (250 wines, invoice scans, inventory, wine lists, pour
history, etc.) for manual QA or demo purposes, see `docs/LOCAL-SUPABASE.md`
and run `pnpm run supabase:seed:local:apply` afterward — that script seeds
its own set of users (`owner+local@terroir.test` etc.) against the
deterministic restaurant id documented there. The two seeds are
independent and can both be applied to the same local DB. `LOCAL-SUPABASE.md`
is canonical for that seed script's contents and usage only — this doc
remains canonical for the stack's ports, bring-up, and safety model.

## Safety model

- Nothing in `scripts/local/` can reach the hosted production Supabase
  project.
- `scripts/local/assert-local-db.sh` is a hard gate: it reads
  `NEXT_PUBLIC_SUPABASE_URL` (env, falling back to `.env.local`) and exits
  non-zero unless it matches exactly THIS repo's local API endpoint —
  `127.0.0.1`/`localhost` on the port `supabase/config.toml`'s `[api]`
  section declares (`57321`). It deliberately does not accept "any"
  localhost port, because other local Supabase stacks for sibling
  worktrees/projects on this machine occupy their own `543xx`/`553xx`/
  `563xx` port blocks. Every script that mutates the local DB sources it
  first — see `scripts/local/assert-local-db.test.sh` for the probe matrix.
- `scripts/seed-local-supabase.mjs` (the richer demo seed, run via `pnpm run
  supabase:seed:local:apply`) requires `NEXT_PUBLIC_SUPABASE_URL` to be set
  explicitly — no hardcoded fallback — and runs the same
  `assert-local-db.sh` gate before any write.
- `.env.local` is gitignored and must never be copied from another checkout.
  `dev-local.sh` does not read it. `.env.local.example` commits well-known local
  supabase-cli default keys (anon/publishable + service-role), which are public
  constants for local development, not secrets.
- Local-only CLI operations: `supabase init | start | stop | status | db
  reset`. Never `supabase db push` or `supabase link` from these scripts —
  those talk to a hosted project and are out of scope for anything under
  `scripts/local/`.
- `scripts/backup/*` and `scripts/restore-drill.mjs` are NOT wired to this
  local stack — they hard-require the supabase-cli default DB port
  (`54322`) and fail closed against this repo's `57322` port, so backup/
  restore drills against this stack aren't currently possible. That's safe
  (they refuse rather than run against the wrong database) but means those
  drills need separate follow-up if this local stack is meant to exercise
  them.
