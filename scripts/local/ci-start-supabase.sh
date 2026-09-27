#!/usr/bin/env bash
# Start the disposable CI Supabase stack without its statement-by-statement
# migration runner, then apply every forward migration and its ledger row in
# one transaction. Migration 0152 intentionally begins with LOCK TABLE and
# therefore requires this transaction boundary.

set -euo pipefail

repo_root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
cd "$repo_root"

if [ "${CI:-}" != "true" ]; then
  echo "ci-start-supabase: refusing outside CI" >&2
  exit 2
fi

config=supabase/config.toml
if [ ! -f "$config" ]; then
  echo "ci-start-supabase: missing $config" >&2
  exit 2
fi

project_id=$(awk -F '"' '/^project_id = / { print $2; exit }' "$config")
case "$project_id" in
  terroir-vw-local) ;;
  *) echo "ci-start-supabase: unexpected project id '$project_id'" >&2; exit 2 ;;
esac

db_container="supabase_db_${project_id}"
backup=$(mktemp "${TMPDIR:-/tmp}/terroir-ci-config.XXXXXX")
rewritten=$(mktemp "${TMPDIR:-/tmp}/terroir-ci-config-rewritten.XXXXXX")
cp "$config" "$backup"

restore_config() {
  cp "$backup" "$config"
  rm -f "$backup" "$rewritten"
}
trap restore_config EXIT HUP INT TERM

# A clean CI runner has no retained database. Disable only the CLI's automatic
# migration/seed phases for startup; the exact committed config is restored
# before this script applies any repository SQL.
awk '
  /^\[db\.migrations\]$/ { section = "migrations"; print; next }
  /^\[db\.seed\]$/ { section = "seed"; print; next }
  /^\[/ { section = "" }
  section == "migrations" && /^enabled = true$/ { print "enabled = false"; next }
  section == "seed" && /^enabled = true$/ { print "enabled = false"; next }
  { print }
' "$config" > "$rewritten"
cp "$rewritten" "$config"

supabase start
restore_config
trap - EXIT HUP INT TERM

inspect=$(docker inspect --format '{{.State.Status}}|{{.Config.Image}}' "$db_container")
case "$inspect" in
  running\|*supabase/postgres:17*) ;;
  *) echo "ci-start-supabase: unexpected database container '$inspect'" >&2; exit 2 ;;
esac

if docker exec "$db_container" psql -X -U postgres -d postgres -Atc \
  "select to_regclass('supabase_migrations.schema_migrations') is not null" \
  | grep -qx true; then
  echo "ci-start-supabase: refusing non-empty migration target" >&2
  exit 2
fi

docker exec -i "$db_container" psql -X -v ON_ERROR_STOP=1 -q \
  -U postgres -d postgres <<'SQL'
create schema supabase_migrations;
create table supabase_migrations.schema_migrations (
  version text primary key,
  statements text[],
  name text,
  created_by text,
  idempotency_key text,
  rollback text[]
);
SQL

if rg -n -i '^[[:space:]]*create[[:space:]]+(unique[[:space:]]+)?index[[:space:]]+concurrently' \
  supabase/migrations/[0-9]*.sql; then
  echo "ci-start-supabase: CREATE INDEX CONCURRENTLY cannot use the required transaction" >&2
  exit 2
fi

if rg -n -i '^[[:space:]]*(begin|commit)[[:space:]]*;' supabase/migrations/[0-9]*.sql; then
  echo "ci-start-supabase: a forward migration owns a conflicting transaction" >&2
  exit 2
fi

expected=0
ceiling=${CI_MIGRATION_CEILING:-}
if [ -n "$ceiling" ] && ! printf '%s' "$ceiling" | grep -Eq '^[0-9]{4}$'; then
  echo "ci-start-supabase: invalid CI_MIGRATION_CEILING '$ceiling'" >&2
  exit 2
fi
for file in supabase/migrations/[0-9]*.sql; do
  base=$(basename "$file" .sql)
  version=${base%%_*}
  if [ -n "$ceiling" ] && [ "$version" -gt "$ceiling" ]; then
    break
  fi
  name=${base#${version}_}
  docker exec -i "$db_container" psql -X -v ON_ERROR_STOP=1 \
    --single-transaction -q -U postgres -d postgres -f - \
    -c "insert into supabase_migrations.schema_migrations(version,name) values ('$version','$name');" \
    < "$file"
  expected=$((expected + 1))
done

actual=$(docker exec "$db_container" psql -X -U postgres -d postgres -Atc \
  "select count(*) from supabase_migrations.schema_migrations")
latest=$(docker exec "$db_container" psql -X -U postgres -d postgres -Atc \
  "select max(version) from supabase_migrations.schema_migrations")
source_latest=$(basename "$(find supabase/migrations -maxdepth 1 -type f -name '[0-9]*.sql' | sort | tail -1)" | cut -d_ -f1)
if [ -n "$ceiling" ]; then
  source_latest=$ceiling
fi

if [ "$actual" != "$expected" ] || [ "$latest" != "$source_latest" ]; then
  echo "ci-start-supabase: migration ledger mismatch expected=$expected actual=$actual latest=$latest source=$source_latest" >&2
  exit 1
fi

echo "ci-start-supabase: applied $actual migrations transactionally through $latest"
