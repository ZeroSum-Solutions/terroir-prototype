#!/usr/bin/env bash
# Disposable CI candidate only. Collect this target's real receipts, then run
# the transaction-owned 0165 packet without the generic ledger-row wrapper.
set -euo pipefail
repo_root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
cd "$repo_root"
if [ "${CI:-}" != "true" ]; then
  echo "ci-apply-staff-cost-seal: refusing outside CI" >&2
  exit 2
fi
project_id=$(awk -F '"' '/^project_id = / { print $2; exit }' supabase/config.toml)
[ "$project_id" = "terroir-vw-local" ] || {
  echo "ci-apply-staff-cost-seal: unexpected project id" >&2
  exit 2
}
db_container="supabase_db_${project_id}"
inspect=$(docker inspect --format '{{.State.Status}}|{{.Config.Image}}' "$db_container")
case "$inspect" in
  running\|*supabase/postgres:17*) ;;
  *) echo "ci-apply-staff-cost-seal: unexpected database container" >&2; exit 2 ;;
esac
psql_local() {
  docker exec -i "$db_container" psql -X --no-password -v ON_ERROR_STOP=1 -q \
    -U postgres -d postgres "$@"
}
[ "$(psql_local -Atc "select count(*) || '/' || max(version) from supabase_migrations.schema_migrations")" = "136/0164" ] || {
  echo "ci-apply-staff-cost-seal: expected 136/0164" >&2
  exit 2
}
umask 077
evidence=$(mktemp -d "${RUNNER_TEMP:-${TMPDIR:-/tmp}}/terroir-ci-staff-cost-0165.XXXXXX")
app_sha=$(git rev-parse HEAD)
printf '%s\n' "C04_0165_CI_CANDIDATE_CALLER_CHECKS app_sha=$app_sha" > "$evidence/caller.stdout"
node supabase/tests/0165_staff_cost_seal_contract/source-contract.mjs >> "$evidence/caller.stdout"
pnpm exec vitest run src/lib/staff-cost/protected-readers.test.ts \
  src/lib/api/scan-idempotency-contract.test.ts \
  src/lib/pricing/price-comparison-data.test.ts \
  src/lib/insights/snapshot-data.test.ts >> "$evidence/caller.stdout" 2> "$evidence/caller.stderr"
psql_local -f - < scripts/staff-cost-seal-baseline-preflight.sql \
  > "$evidence/structural.stdout" 2> "$evidence/structural.stderr"
psql_local -f - < scripts/staff-cost-background-jobs-preflight.sql \
  > "$evidence/history.stdout" 2> "$evidence/history.stderr"
psql_local -f - < supabase/tests/0165_staff_cost_seal_contract/preflight.sql \
  > "$evidence/preflight.stdout" 2> "$evidence/preflight.stderr"
structural_sha=$(sha256sum "$evidence/structural.stdout" | awk '{print $1}')
history_sha=$(sha256sum "$evidence/history.stdout" | awk '{print $1}')
caller_sha=$(sha256sum "$evidence/caller.stdout" | awk '{print $1}')
# CI owns this disposable target; no web app or worker has been started.
# These are CI candidate receipts, not a hosted application admission.
staff_cost_pgoptions="-c terroir.c04_0165_traffic_quiesced=on -c terroir.c04_0165_compatible_app_sha=$app_sha -c terroir.c04_0165_structural_receipt_sha256=$structural_sha -c terroir.c04_0165_history_receipt_sha256=$history_sha -c terroir.c04_0165_caller_receipt_sha256=$caller_sha"
docker exec -i -e "PGOPTIONS=$staff_cost_pgoptions" "$db_container" \
  psql -X --no-password -v ON_ERROR_STOP=1 -qAt -U supabase_admin -d postgres -f - \
  < supabase/migrations/0165_staff_cost_seal_contract.sql \
  > "$evidence/apply.stdout" 2> "$evidence/apply.stderr"
policy_sha=$(sed -n 's/^C04_0165_APPLIED_STORAGE_POLICY_SHA256|\([0-9a-f]\{64\}\)$/\1/p' "$evidence/apply.stdout")
[ "${#policy_sha}" = "64" ] || {
  echo "ci-apply-staff-cost-seal: missing successful apply policy receipt" >&2
  exit 1
}
docker exec -i -e "PGOPTIONS=-c terroir.c04_0165_contract_policy_sha256=$policy_sha" \
  "$db_container" psql -X --no-password -v ON_ERROR_STOP=1 -q -U postgres -d postgres -f - \
  < supabase/tests/0165_staff_cost_seal_contract/postflight.sql \
  > "$evidence/postflight.stdout" 2> "$evidence/postflight.stderr"
[ "$(psql_local -Atc "select count(*) || '/' || max(version) from supabase_migrations.schema_migrations")" = "137/0165" ] || {
  echo "ci-apply-staff-cost-seal: final ledger mismatch" >&2
  exit 1
}
echo "ci-apply-staff-cost-seal: candidate 137/0165 verified; receipts=$evidence"
