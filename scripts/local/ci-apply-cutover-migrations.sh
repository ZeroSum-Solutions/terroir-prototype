#!/usr/bin/env bash
# Complete the disposable CI schema after the legacy-contract live suites have
# run at 0155. This models the real cutover: legacy behavior is proved before
# 0156 retires it, then the current application and E2E run against 0164.

set -euo pipefail

repo_root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
cd "$repo_root"

if [ "${CI:-}" != "true" ]; then
  echo "ci-apply-cutover-migrations: refusing outside CI" >&2
  exit 2
fi

project_id=$(awk -F '"' '/^project_id = / { print $2; exit }' supabase/config.toml)
if [ "$project_id" != "terroir-vw-local" ]; then
  echo "ci-apply-cutover-migrations: unexpected project id '$project_id'" >&2
  exit 2
fi

db_container="supabase_db_${project_id}"
inspect=$(docker inspect --format '{{.State.Status}}|{{.Config.Image}}' "$db_container")
case "$inspect" in
  running\|*supabase/postgres:17*) ;;
  *) echo "ci-apply-cutover-migrations: unexpected database container '$inspect'" >&2; exit 2 ;;
esac

psql_local() {
  docker exec -i "$db_container" psql -X -v ON_ERROR_STOP=1 -q \
    -U postgres -d postgres "$@"
}

latest=$(psql_local -Atc "select max(version) from supabase_migrations.schema_migrations")
if [ "$latest" != "0155" ]; then
  echo "ci-apply-cutover-migrations: expected 0155, found '$latest'" >&2
  exit 2
fi

apply_migration() {
  file=$1
  base=$(basename "$file" .sql)
  version=${base%%_*}
  name=${base#${version}_}
  psql_local --single-transaction -f - \
    -c "insert into supabase_migrations.schema_migrations(version,name) values ('$version','$name');" \
    < "$file"
  echo "ci-apply-cutover-migrations: applied $version"
}

psql_local -f - < scripts/0156-production-preflight.sql
apply_migration supabase/migrations/0156_physical_bottle_cutover.sql
psql_local -f - < scripts/0156-production-postflight.sql

psql_local -f - < scripts/0157-production-preflight.sql
apply_migration supabase/migrations/0157_staff_cost_seal_additive.sql
psql_local -f - < scripts/0157-production-postflight.sql

psql_local -v bottle_route_drained=1 -f - < scripts/0158-production-preflight.sql
apply_migration supabase/migrations/0158_staff_operational_bridge.sql
psql_local -f - < scripts/0158-production-postflight.sql

for file in supabase/migrations/0159_*.sql supabase/migrations/016[0-4]_*.sql; do
  apply_migration "$file"
done

actual=$(psql_local -Atc "select count(*) from supabase_migrations.schema_migrations")
latest=$(psql_local -Atc "select max(version) from supabase_migrations.schema_migrations")
source_latest=$(basename "$(find supabase/migrations -maxdepth 1 -type f -name '[0-9]*.sql' | sort | tail -1)" | cut -d_ -f1)
if [ "$latest" != "$source_latest" ]; then
  echo "ci-apply-cutover-migrations: final ledger mismatch actual=$actual latest=$latest source=$source_latest" >&2
  exit 1
fi

echo "ci-apply-cutover-migrations: current schema verified through $latest"
