#!/usr/bin/env bash
# Runs only inside an already-restored, isolated PG17 container.
set -euo pipefail

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
repo_root=$(CDPATH= cd -- "$script_dir/../.." && pwd)
container=${C04_REHEARSAL_CONTAINER:?set C04_REHEARSAL_CONTAINER}
pg_user=${C04_REHEARSAL_PG_USER:-postgres}
source_db=${C04_REHEARSAL_SOURCE_DB:-postgres}

case "$container" in
  terroir-c04-rehearsal-[A-Za-z0-9-]*) ;;
  *) echo "REFUSING: unexpected disposable container name" >&2; exit 2 ;;
esac

inspect=$(docker inspect --format \
  '{{.HostConfig.NetworkMode}}|{{json .HostConfig.PortBindings}}|{{json .Mounts}}|{{.Config.Image}}' \
  "$container")
case "$inspect" in
  none\|\{\}\|\[\]\|*supabase/postgres:17*) ;;
  *) echo "REFUSING: container must be PG17 with network none, no ports, and no mounts" >&2; exit 2 ;;
esac

psql_cmd() {
  local database=$1
  shift
  docker exec "$container" psql -X -v ON_ERROR_STOP=1 -U "$pg_user" -d "$database" "$@"
}

psql_file() {
  local database=$1
  local file=$2
  local transaction_mode=${3:-plain}
  if [ "$transaction_mode" = "single" ]; then
    docker exec -i "$container" psql -X -v ON_ERROR_STOP=1 -1 -U "$pg_user" -d "$database" < "$file"
  else
    docker exec -i "$container" psql -X -v ON_ERROR_STOP=1 -U "$pg_user" -d "$database" < "$file"
  fi
}

psql_file_as_role() {
  local database=$1
  local role=$2
  local file=$3
  local transaction_mode=${4:-plain}
  if [ "$transaction_mode" = "single" ]; then
    docker exec -i "$container" psql -X -v ON_ERROR_STOP=1 -1 \
      -U "$pg_user" -d "$database" -c "set role $role" -f - < "$file"
  else
    docker exec -i "$container" psql -X -v ON_ERROR_STOP=1 \
      -U "$pg_user" -d "$database" -c "set role $role" -f - < "$file"
  fi
}

wait_for_pg_sleep() {
  local database=$1
  local application_name=$2
  local attempt
  local ready
  for attempt in $(seq 1 100); do
    ready=$(psql_cmd "$database" -Atc \
      "select count(*) from pg_catalog.pg_stat_activity where datname = current_database() and application_name = '$application_name' and wait_event = 'PgSleep'")
    if [ "$ready" = "1" ]; then
      return 0
    fi
    sleep 0.1
  done
  echo "FAIL: timed out waiting for controlled session $application_name" >&2
  return 1
}

terminate_named_session() {
  local database=$1
  local application_name=$2
  psql_cmd "$database" -Atc \
    "select pg_catalog.pg_terminate_backend(pid) from pg_catalog.pg_stat_activity where datname = current_database() and application_name = '$application_name'" \
    >/dev/null
}

max_version=$(psql_cmd "$source_db" -Atc \
  "select coalesce(max(version), '') from supabase_migrations.schema_migrations")
if [ "$max_version" != "0151" ]; then
  echo "REFUSING: source max migration is '$max_version', expected 0151" >&2
  exit 2
fi

fixture_count=$(psql_cmd "$source_db" -Atc "select count(*) from public.memberships")
if [ "$fixture_count" -lt 2 ]; then
  echo "REFUSING: restored source needs at least two membership fixtures" >&2
  exit 2
fi

proof_dir=$(mktemp -d "${TMPDIR:-/tmp}/terroir-c04-rehearsal.XXXXXX")
chmod 700 "$proof_dir"
run_id=$$
base_db="c04_base_${run_id}"
clean_db="c04_clean_${run_id}"
acceptance_db="c04_acceptance_${run_id}"
safe_delete_db="c04_safe_delete_${run_id}"
down_refusal_db="c04_down_refusal_${run_id}"
privilege_db="c04_privilege_${run_id}"
forward="$repo_root/supabase/migrations/0152_workspace_access_foundation.sql"
down="$repo_root/supabase/migrations/down/0152_workspace_access_foundation.down.sql"
operator_preflight="$repo_root/scripts/0152-production-preflight.sql"
proof_assets="$repo_root/supabase/tests/0152_workspace_access"
legacy="$proof_assets/workspace-access-conservation-legacy.sql"
containment="$proof_assets/workspace-access-containment-after.sql"
fingerprint="$proof_assets/workspace-access-state-fingerprint.sql"
preflight="$proof_assets/workspace-access-preflight-fingerprint.sql"
post_up="$proof_assets/workspace-access-post-up-acceptance.sql"
explain="$proof_assets/workspace-access-explain.sql"

psql_cmd "$source_db" -Atc \
  "select current_user||E'\\t'||session_user||E'\\t'||r.rolsuper::text||E'\\t'||r.rolbypassrls::text from pg_catalog.pg_roles r where r.rolname=current_user; select c.oid::regclass::text||E'\\t'||pg_catalog.pg_get_userbyid(c.relowner) from pg_catalog.pg_class c where c.oid in ('auth.users'::regclass,'public.restaurants'::regclass,'public.memberships'::regclass) order by 1; select 'public.handle_new_user()'||E'\\t'||pg_catalog.pg_get_userbyid(p.proowner) from pg_catalog.pg_proc p where p.oid='public.handle_new_user()'::regprocedure" \
  > "$proof_dir/executor-role-and-owners.txt"

# Both known old-writer lock orders must refuse before the first DDL statement.
# Readiness is proven from pg_stat_activity; no fixed-delay launch heuristic is
# used for either two-session case.
run_forward_refusal() {
  local case_name=$1
  local lock_sql=$2
  local application_name="c04_${case_name}_${run_id}"
  local holder_pid

  psql_file "$source_db" "$preflight" > "$proof_dir/${case_name}-before.txt"
  docker exec "$container" psql -X -v ON_ERROR_STOP=1 -U "$pg_user" -d "$source_db" \
    -c "set application_name = '$application_name'; begin; $lock_sql; select pg_sleep(30); commit;" \
    > "$proof_dir/${case_name}-holder.txt" 2>&1 &
  holder_pid=$!
  wait_for_pg_sleep "$source_db" "$application_name"

  if docker exec -i "$container" psql -X -v ON_ERROR_STOP=1 \
    -v VERBOSITY=verbose -1 -U "$pg_user" -d "$source_db" < "$forward" \
    > "$proof_dir/${case_name}-forward.txt" 2>&1; then
    terminate_named_session "$source_db" "$application_name"
    wait "$holder_pid" || true
    echo "FAIL: forward unexpectedly accepted active writer $case_name" >&2
    exit 1
  fi
  grep -q '55P03' "$proof_dir/${case_name}-forward.txt"
  terminate_named_session "$source_db" "$application_name"
  wait "$holder_pid" || true
  psql_file "$source_db" "$preflight" > "$proof_dir/${case_name}-after.txt"
  diff -u "$proof_dir/${case_name}-before.txt" "$proof_dir/${case_name}-after.txt" \
    > "$proof_dir/${case_name}.diff"
}

run_forward_refusal direct_membership_writer \
  "lock table public.memberships in row exclusive mode"
run_forward_refusal signup_restaurant_writer \
  "lock table auth.users in row exclusive mode; lock table public.restaurants in row exclusive mode"

psql_file "$source_db" "$legacy" > "$proof_dir/legacy-before.txt"
# A restored Supabase postgres database can have pg_cron/pg_net background
# connections. This container is disposable and network-isolated; terminate
# only other sessions in the restored source database so CREATE DATABASE ...
# TEMPLATE gets one atomic seed copy. No application session exists here.
psql_cmd "$source_db" -Atc \
  "select pg_catalog.pg_terminate_backend(pid) from pg_catalog.pg_stat_activity where datname=current_database() and pid<>pg_catalog.pg_backend_pid()" \
  > "$proof_dir/source-template-session-drain.txt"
docker exec "$container" createdb -U "$pg_user" -T "$source_db" "$base_db"
docker exec "$container" createdb -U "$pg_user" -T "$source_db" "$privilege_db"
psql_file "$base_db" "$forward" single
psql_file "$base_db" "$legacy" > "$proof_dir/legacy-after.txt"
diff -u "$proof_dir/legacy-before.txt" "$proof_dir/legacy-after.txt" \
  > "$proof_dir/legacy.diff"
psql_file "$base_db" "$containment" > "$proof_dir/containment.txt"

# The down must acquire auth.users first and refuse before any teardown when an
# auth writer is active. The complete post-up fingerprint must remain identical.
docker exec "$container" createdb -U "$pg_user" -T "$base_db" "$down_refusal_db"
psql_file "$down_refusal_db" "$fingerprint" > "$proof_dir/auth-writer-down-before.txt"
down_application_name="c04_down_auth_writer_${run_id}"
docker exec "$container" psql -X -v ON_ERROR_STOP=1 -U "$pg_user" -d "$down_refusal_db" \
  -c "set application_name='$down_application_name'; begin; lock table auth.users in row exclusive mode; select pg_sleep(30); commit;" \
  > "$proof_dir/auth-writer-down-holder.txt" 2>&1 &
down_holder_pid=$!
wait_for_pg_sleep "$down_refusal_db" "$down_application_name"
if docker exec -i "$container" psql -X -v ON_ERROR_STOP=1 -v VERBOSITY=verbose \
  -U "$pg_user" -d "$down_refusal_db" < "$down" \
  > "$proof_dir/auth-writer-down.txt" 2>&1; then
  terminate_named_session "$down_refusal_db" "$down_application_name"
  wait "$down_holder_pid" || true
  echo "FAIL: down unexpectedly accepted active auth writer" >&2
  exit 1
fi
grep -q '55P03' "$proof_dir/auth-writer-down.txt"
terminate_named_session "$down_refusal_db" "$down_application_name"
wait "$down_holder_pid" || true
psql_file "$down_refusal_db" "$fingerprint" > "$proof_dir/auth-writer-down-after.txt"
diff -u "$proof_dir/auth-writer-down-before.txt" \
  "$proof_dir/auth-writer-down-after.txt" \
  > "$proof_dir/auth-writer-down.diff"

# Validate the production authority gate with non-superuser roles. Inherited
# ownership is enough for PostgreSQL DDL but is deliberately not enough here:
# CREATE OR REPLACE preserves handle_new_user()'s SECURITY DEFINER owner while
# new objects belong to current_user. The supported contract is an explicit
# SET ROLE to one shared direct owner before preflight and migration execution.
common_owner="c04_common_owner_${run_id}"
inherited_role="c04_inherited_${run_id}"
good_role="c04_direct_owner_${run_id}"
missing_table_role="c04_missing_table_${run_id}"
missing_function_role="c04_missing_function_${run_id}"
missing_create_role="c04_missing_create_${run_id}"
missing_references_role="c04_missing_references_${run_id}"
missing_select_role="c04_missing_select_${run_id}"
missing_bypass_role="c04_missing_bypass_${run_id}"

psql_cmd "$privilege_db" -c \
  "create role $common_owner nologin; create role $inherited_role nologin inherit; create role $good_role nologin bypassrls; create role $missing_table_role nologin; create role $missing_function_role nologin; create role $missing_create_role nologin; create role $missing_references_role nologin; create role $missing_select_role nologin; create role $missing_bypass_role nologin; revoke create on schema public from public; revoke select, references on table auth.users from public; grant $common_owner to $inherited_role; grant usage on schema public, auth to $common_owner, $inherited_role, $good_role, $missing_table_role, $missing_function_role, $missing_create_role, $missing_references_role, $missing_select_role, $missing_bypass_role; grant create on schema public to $common_owner, $inherited_role, $good_role, $missing_table_role, $missing_function_role, $missing_references_role, $missing_select_role, $missing_bypass_role; grant references on table auth.users to $common_owner, $inherited_role, $good_role, $missing_table_role, $missing_function_role, $missing_create_role, $missing_select_role, $missing_bypass_role; grant select on table auth.users to $common_owner, $inherited_role, $good_role, $missing_table_role, $missing_function_role, $missing_create_role, $missing_references_role, $missing_bypass_role; grant update on table auth.users to $common_owner, $inherited_role, $good_role, $missing_table_role, $missing_function_role, $missing_create_role, $missing_references_role, $missing_select_role, $missing_bypass_role" \
  > "$proof_dir/operator-fixture-setup.txt"

set_operator_owners() {
  local table_role=$1
  local function_role=$2
  psql_cmd "$privilege_db" -c \
    "alter table public.restaurants owner to $table_role; alter table public.memberships owner to $table_role; alter function public.handle_new_user() owner to $function_role" \
    >> "$proof_dir/operator-owner-transitions.txt"
}

run_lock_probe_as_role() {
  local role=$1
  docker exec "$container" psql -X -v ON_ERROR_STOP=1 -U "$pg_user" -d "$privilege_db" \
    -c "set role $role; begin; lock table auth.users in share row exclusive mode nowait; lock table public.restaurants, public.memberships in access exclusive mode nowait; rollback" \
    > "$proof_dir/${role}-lock-probe.txt"
}

run_rejected_preflight() {
  local role=$1
  local marker=$2
  run_lock_probe_as_role "$role"
  if docker exec -i "$container" psql -X -v ON_ERROR_STOP=1 -v VERBOSITY=verbose \
    -U "$pg_user" -d "$privilege_db" -c "set role $role" -f - \
    < "$operator_preflight" > "$proof_dir/${role}-preflight.txt" 2>&1; then
    echo "FAIL: operator preflight unexpectedly accepted $role" >&2
    exit 1
  fi
  grep -q "$marker" "$proof_dir/${role}-preflight.txt"
}

# PostgreSQL 17 permits both table and function DDL through inherited ownership,
# but the preflight rejects that cross-owner runtime shape deterministically.
set_operator_owners "$common_owner" "$common_owner"
docker exec "$container" psql -X -v ON_ERROR_STOP=1 -U "$pg_user" -d "$privilege_db" \
  -c "set role $inherited_role; begin; alter table public.restaurants add column c04_inherited_owner_probe boolean; alter function public.handle_new_user() set search_path=public; rollback" \
  > "$proof_dir/operator-inherited-ddl-probe.txt"
run_rejected_preflight "$inherited_role" \
  'C04_OPERATOR_NOT_DIRECT_OWNER:'

set_operator_owners "$common_owner" "$missing_table_role"
psql_cmd "$privilege_db" -c \
  "grant update on table public.restaurants, public.memberships to $missing_table_role" \
  >> "$proof_dir/operator-owner-transitions.txt"
run_rejected_preflight "$missing_table_role" \
  'C04_OPERATOR_NOT_DIRECT_OWNER: table'

set_operator_owners "$missing_function_role" "$common_owner"
run_rejected_preflight "$missing_function_role" \
  'C04_OPERATOR_NOT_DIRECT_OWNER: function handle_new_user()'

set_operator_owners "$missing_create_role" "$missing_create_role"
run_rejected_preflight "$missing_create_role" \
  'C04_OPERATOR_MISSING_PUBLIC_SCHEMA_CREATE'

set_operator_owners "$missing_references_role" "$missing_references_role"
run_rejected_preflight "$missing_references_role" \
  'C04_OPERATOR_MISSING_AUTH_USERS_REFERENCES'

set_operator_owners "$missing_select_role" "$missing_select_role"
run_rejected_preflight "$missing_select_role" \
  'C04_OPERATOR_MISSING_AUTH_USERS_SELECT'

set_operator_owners "$missing_bypass_role" "$missing_bypass_role"
run_rejected_preflight "$missing_bypass_role" \
  'C04_OPERATOR_CANNOT_BYPASS_AUTH_USERS_RLS'

# The positive role is the direct owner of the legacy tables, signup function,
# and reason-code definer/data. Baseline signup, forward, post-up signup,
# direction-aware preflight, and down must all succeed under this shared owner.
set_operator_owners "$good_role" "$good_role"
psql_cmd "$privilege_db" -c \
  "alter table public.reason_codes owner to $good_role; alter function public.seed_reason_codes(uuid) owner to $good_role" \
  >> "$proof_dir/operator-owner-transitions.txt"
psql_cmd "$privilege_db" -c \
  "insert into auth.users(id,email,raw_user_meta_data) values (gen_random_uuid(),'c04-baseline-${run_id}@terroir.test',jsonb_build_object('restaurant_name','C04 operator baseline'))" \
  > "$proof_dir/operator-baseline-signup.txt"
baseline_signup_count=$(psql_cmd "$privilege_db" -Atc \
  "select count(*) from public.memberships m join auth.users u on u.id=m.user_id where u.email='c04-baseline-${run_id}@terroir.test' and m.role='owner'")
test "$baseline_signup_count" = "1"
psql_file_as_role "$privilege_db" "$good_role" "$operator_preflight" \
  > "$proof_dir/operator-good-forward-preflight.txt"
grep -q 'C04_PRODUCTION_PREFLIGHT_PASS' \
  "$proof_dir/operator-good-forward-preflight.txt"
grep -Eq "${good_role}.*t.*t" "$proof_dir/operator-good-forward-preflight.txt"
psql_file_as_role "$privilege_db" "$good_role" "$forward" single \
  > "$proof_dir/operator-good-forward.txt"
psql_cmd "$privilege_db" -c \
  "insert into auth.users(id,email,raw_user_meta_data) values (gen_random_uuid(),'c04-post-up-${run_id}@terroir.test',jsonb_build_object('restaurant_name','C04 operator post up'))" \
  > "$proof_dir/operator-post-up-signup.txt"
post_up_signup_count=$(psql_cmd "$privilege_db" -Atc \
  "select count(*) from public.memberships m join public.workspace_memberships wm on wm.id=m.workspace_membership_id join auth.users u on u.id=m.user_id where u.email='c04-post-up-${run_id}@terroir.test' and m.role='owner' and wm.governance_role='workspace_owner'")
test "$post_up_signup_count" = "1"
post_up_restaurant_id=$(psql_cmd "$privilege_db" -Atc \
  "select m.restaurant_id from public.memberships m join auth.users u on u.id=m.user_id where u.email='c04-post-up-${run_id}@terroir.test' and m.role='owner'")
test -n "$post_up_restaurant_id"
psql_cmd "$privilege_db" -c \
  "delete from public.restaurants where id='$post_up_restaurant_id'::uuid" \
  > "$proof_dir/operator-post-up-signup-cleanup.txt"
post_up_residue=$(psql_cmd "$privilege_db" -Atc \
  "select (select count(*) from public.restaurants where id='$post_up_restaurant_id'::uuid)+(select count(*) from public.memberships where restaurant_id='$post_up_restaurant_id'::uuid)+(select count(*) from public.workspaces where id='$post_up_restaurant_id'::uuid)+(select count(*) from public.workspace_memberships where workspace_id='$post_up_restaurant_id'::uuid)")
test "$post_up_residue" = "0"
psql_cmd "$privilege_db" -Atc \
  "set role $good_role; select count(*) >= 1 from auth.users" \
  > "$proof_dir/operator-good-auth-users-select.txt"
grep -q 't' "$proof_dir/operator-good-auth-users-select.txt"
psql_file_as_role "$privilege_db" "$good_role" "$operator_preflight" \
  > "$proof_dir/operator-good-down-preflight.txt"
grep -q 'C04_PRODUCTION_PREFLIGHT_PASS' \
  "$proof_dir/operator-good-down-preflight.txt"
psql_file_as_role "$privilege_db" "$good_role" "$down" \
  > "$proof_dir/operator-good-down.txt"
psql_cmd "$privilege_db" -Atc \
  "select current_user, pg_catalog.pg_get_userbyid((select relowner from pg_catalog.pg_class where oid='public.restaurants'::regclass)), pg_catalog.pg_get_userbyid((select relowner from pg_catalog.pg_class where oid='public.memberships'::regclass)), pg_catalog.pg_get_userbyid((select proowner from pg_catalog.pg_proc where oid='public.handle_new_user()'::regprocedure))" \
  > "$proof_dir/operator-good-after-down-owners.txt"
grep -Eq "supabase_admin\\|${good_role}\\|${good_role}\\|${good_role}" \
  "$proof_dir/operator-good-after-down-owners.txt"
psql_cmd "$privilege_db" -c \
  "insert into auth.users(id,email,raw_user_meta_data) values (gen_random_uuid(),'c04-post-down-${run_id}@terroir.test',jsonb_build_object('restaurant_name','C04 operator post down'))" \
  > "$proof_dir/operator-post-down-signup.txt"
post_down_signup_count=$(psql_cmd "$privilege_db" -Atc \
  "select count(*) from public.memberships m join auth.users u on u.id=m.user_id where u.email='c04-post-down-${run_id}@terroir.test' and m.role='owner'")
test "$post_down_signup_count" = "1"
operator_clean=$(psql_cmd "$privilege_db" -Atc \
  "select (to_regclass('public.workspaces') is null and to_regclass('public.workspace_memberships') is null)::int")
test "$operator_clean" = "1"

# Clean, lossless down/up.
docker exec "$container" createdb -U "$pg_user" -T "$base_db" "$clean_db"
psql_file "$clean_db" "$down"
clean_absent=$(psql_cmd "$clean_db" -Atc \
  "select (to_regclass('public.workspaces') is null and to_regclass('public.workspace_memberships') is null)::int")
test "$clean_absent" = "1"
psql_file "$clean_db" "$legacy" > "$proof_dir/legacy-after-clean-down.txt"
diff -u "$proof_dir/legacy-before.txt" "$proof_dir/legacy-after-clean-down.txt" \
  > "$proof_dir/legacy-clean-down.diff"
psql_file "$clean_db" "$forward" single
psql_file "$clean_db" "$legacy" > "$proof_dir/legacy-after-clean-re-up.txt"
diff -u "$proof_dir/legacy-before.txt" "$proof_dir/legacy-after-clean-re-up.txt" \
  > "$proof_dir/legacy-clean-re-up.diff"
psql_file "$clean_db" "$containment" > "$proof_dir/clean-down-up.txt"

# Exact post-up capability/privilege fixtures and all helper query plans.
docker exec "$container" createdb -U "$pg_user" -T "$base_db" "$acceptance_db"
psql_file "$acceptance_db" "$post_up" > "$proof_dir/post-up-acceptance.txt"
grep -q 'C04_POST_UP_ACCEPTANCE_PASS' "$proof_dir/post-up-acceptance.txt"
psql_file "$acceptance_db" "$explain" > "$proof_dir/shadow-helper-explain.txt" 2>&1
for marker in \
  C04_EXPLAIN_EFFECTIVE_SITE_ACCESS \
  C04_EXPLAIN_HAS_SITE_CAPABILITY \
  C04_EXPLAIN_EFFECTIVE_SITE_IDS
do
  grep -q "$marker" "$proof_dir/shadow-helper-explain.txt"
done
grep -q 'memberships_user_id_idx' "$proof_dir/shadow-helper-explain.txt"
grep -q 'workspace_memberships_workspace_user_key' "$proof_dir/shadow-helper-explain.txt"

# A truly derived singleton can be removed without residue and does not poison
# a later guarded down.
docker exec "$container" createdb -U "$pg_user" -T "$base_db" "$safe_delete_db"
safe_restaurant_id=$(psql_cmd "$safe_delete_db" -Atc \
  "select r.id from public.restaurants r join public.workspaces w on w.id=r.workspace_id join public.memberships m on m.restaurant_id=r.id join public.workspace_memberships wm on wm.id=m.workspace_membership_id where r.id=r.workspace_id and w.expanded_at is null and m.role='owner' and wm.governance_role='workspace_owner' and not exists (select 1 from public.memberships x where x.restaurant_id=r.id and x.id<>m.id) order by r.id limit 1")
test -n "$safe_restaurant_id"
psql_cmd "$safe_delete_db" -c \
  "delete from public.restaurants where id='$safe_restaurant_id'::uuid" \
  > "$proof_dir/safe-singleton-delete.txt"
safe_residue=$(psql_cmd "$safe_delete_db" -Atc \
  "select (select count(*) from public.restaurants where id='$safe_restaurant_id'::uuid)+(select count(*) from public.memberships where restaurant_id='$safe_restaurant_id'::uuid)+(select count(*) from public.workspaces where id='$safe_restaurant_id'::uuid)+(select count(*) from public.workspace_memberships where workspace_id='$safe_restaurant_id'::uuid)")
test "$safe_residue" = "0"
psql_file "$safe_delete_db" "$down" > "$proof_dir/safe-singleton-down.txt"

apply_fixture() {
  local database=$1
  local fixture=$2
  case "$fixture" in
    personal)
      psql_cmd "$database" -c \
        "insert into public.workspaces(kind,name) values ('personal','C04 refusal personal')" >/dev/null ;;
    expanded)
      psql_cmd "$database" -c \
        "update public.workspaces set expanded_at=statement_timestamp() where id=(select id from public.workspaces where kind='restaurant' order by id limit 1)" >/dev/null ;;
    two_site)
      psql_cmd "$database" -c \
        "insert into public.restaurants(name,workspace_id) select 'C04 refusal second site',id from public.workspaces where kind='restaurant' order by id limit 1" >/dev/null ;;
    former_empty)
      psql_cmd "$database" -c \
        "update public.workspaces set expanded_at=statement_timestamp() where id=(select id from public.workspaces where kind='restaurant' order by id limit 1); delete from public.restaurants where id=(select id from public.workspaces where kind='restaurant' order by id limit 1); delete from public.workspace_memberships where workspace_id=(select id from public.workspaces where kind='restaurant' order by id limit 1)" >/dev/null ;;
    group_only)
      psql_cmd "$database" -c \
        "delete from public.memberships where id=(select id from public.memberships order by id limit 1)" >/dev/null ;;
    group_admin)
      psql_cmd "$database" -c \
        "update public.workspace_memberships set governance_role='group_admin' where id=(select id from public.workspace_memberships order by id limit 1)" >/dev/null ;;
    workspace_revoked)
      psql_cmd "$database" -c \
        "update public.workspace_memberships set status='revoked',revoked_at=statement_timestamp() where id=(select id from public.workspace_memberships order by id limit 1)" >/dev/null ;;
    workspace_expiry)
      psql_cmd "$database" -c \
        "update public.workspace_memberships set expires_at=statement_timestamp()+interval '1 day' where id=(select id from public.workspace_memberships order by id limit 1)" >/dev/null ;;
    site_revoked)
      psql_cmd "$database" -c \
        "update public.memberships set status='revoked',revoked_at=statement_timestamp() where id=(select id from public.memberships order by id limit 1)" >/dev/null ;;
    site_expiry)
      psql_cmd "$database" -c \
        "update public.memberships set expires_at=statement_timestamp()+interval '1 day' where id=(select id from public.memberships order by id limit 1)" >/dev/null ;;
    created_by)
      psql_cmd "$database" -c \
        "update public.workspace_memberships set created_by=user_id where id=(select id from public.workspace_memberships order by id limit 1)" >/dev/null ;;
    granted_by)
      psql_cmd "$database" -c \
        "alter table public.memberships disable trigger memberships_link_workspace; update public.memberships set granted_by=user_id where id=(select id from public.memberships order by id limit 1); alter table public.memberships enable trigger memberships_link_workspace" >/dev/null ;;
    governance_mismatch)
      target_membership_id=$(psql_cmd "$database" -Atc \
        "select m.id from public.memberships m join public.workspace_memberships wm on wm.id=m.workspace_membership_id where m.role='owner' and wm.governance_role='workspace_owner' order by m.id limit 1")
      test -n "$target_membership_id"
      psql_cmd "$database" -c \
        "update public.memberships set role='manager' where id='$target_membership_id'::uuid" >/dev/null
      mismatch_count=$(psql_cmd "$database" -Atc \
        "select count(*) from public.memberships m join public.workspace_memberships wm on wm.id=m.workspace_membership_id where m.id='$target_membership_id'::uuid and m.role='manager' and wm.governance_role='workspace_owner'")
      test "$mismatch_count" = "1" ;;
    link_mismatch)
      psql_cmd "$database" -c \
        "alter table public.memberships disable trigger memberships_link_workspace; with pair as (select id,workspace_membership_id,row_number() over(order by id) as n from public.memberships order by id limit 2), links as (select array_agg(workspace_membership_id order by id) as ids from pair) update public.memberships m set workspace_membership_id=case p.n when 1 then l.ids[2] else l.ids[1] end from pair p cross join links l where m.id=p.id; alter table public.memberships enable trigger memberships_link_workspace" >/dev/null ;;
    *) echo "unknown fixture: $fixture" >&2; exit 2 ;;
  esac
}

for fixture in \
  personal expanded two_site former_empty group_only group_admin \
  workspace_revoked workspace_expiry site_revoked site_expiry created_by granted_by \
  governance_mismatch link_mismatch
do
  case_db="c04_${fixture}_${run_id}"
  docker exec "$container" createdb -U "$pg_user" -T "$base_db" "$case_db"
  apply_fixture "$case_db" "$fixture"
  psql_file "$case_db" "$fingerprint" > "$proof_dir/${fixture}-before.txt"
  if psql_file "$case_db" "$down" > "$proof_dir/${fixture}-down.txt" 2>&1; then
    echo "FAIL: down unexpectedly accepted fixture $fixture" >&2
    exit 1
  fi
  psql_file "$case_db" "$fingerprint" > "$proof_dir/${fixture}-after.txt"
  diff -u "$proof_dir/${fixture}-before.txt" "$proof_dir/${fixture}-after.txt" \
    > "$proof_dir/${fixture}.diff"
  object_count=$(psql_cmd "$case_db" -Atc \
    "select ((to_regclass('public.workspaces') is not null)::int + (to_regprocedure('public.shadow_effective_site_access(uuid)') is not null)::int)")
  test "$object_count" = "2"
done

# Restaurant deletion and auth-user deletion must complete in either order.
# The first statement reaches pg_sleep only after its DELETE has completed, so
# the second session starts from a deterministic lock-held state.
run_auth_restaurant_delete_race() {
  local first=$1
  local race_db="c04_auth_restaurant_${first}_${run_id}"
  local application_name="c04_auth_restaurant_${first}_${run_id}"
  local user_id
  local restaurant_id
  local workspace_id
  local first_sql
  local second_sql
  local holder_pid
  local residue

  docker exec "$container" createdb -U "$pg_user" -T "$base_db" "$race_db"
  psql_cmd "$race_db" -c \
    "insert into auth.users(id,email,raw_user_meta_data) values (gen_random_uuid(),'$application_name@terroir.test',jsonb_build_object('restaurant_name','$application_name'))" \
    > "$proof_dir/${first}-fixture.txt"
  user_id=$(psql_cmd "$race_db" -Atc \
    "select id from auth.users where email='$application_name@terroir.test'")
  restaurant_id=$(psql_cmd "$race_db" -Atc \
    "select restaurant_id from public.memberships where user_id='$user_id'::uuid and role='owner'")
  workspace_id=$(psql_cmd "$race_db" -Atc \
    "select workspace_id from public.restaurants where id='$restaurant_id'::uuid")
  test -n "$restaurant_id"
  test -n "$workspace_id"

  if [ "$first" = "auth_first" ]; then
    first_sql="delete from auth.users where id='$user_id'::uuid"
    second_sql="delete from public.restaurants where id='$restaurant_id'::uuid"
  else
    first_sql="delete from public.restaurants where id='$restaurant_id'::uuid"
    second_sql="delete from auth.users where id='$user_id'::uuid"
  fi

  docker exec "$container" psql -X -v ON_ERROR_STOP=1 -U "$pg_user" -d "$race_db" \
    -c "set application_name='$application_name'; begin; set local statement_timeout='10s'; $first_sql; select pg_sleep(3); commit;" \
    > "$proof_dir/${first}-holder.txt" 2>&1 &
  holder_pid=$!
  wait_for_pg_sleep "$race_db" "$application_name"
  psql_cmd "$race_db" -c \
    "begin; set local statement_timeout='10s'; $second_sql; commit;" \
    > "$proof_dir/${first}-second.txt"
  wait "$holder_pid"

  residue=$(psql_cmd "$race_db" -Atc \
    "select (select count(*) from auth.users where id='$user_id'::uuid)+(select count(*) from public.restaurants where id='$restaurant_id'::uuid)+(select count(*) from public.memberships where user_id='$user_id'::uuid or restaurant_id='$restaurant_id'::uuid)+(select count(*) from public.workspace_memberships where user_id='$user_id'::uuid or workspace_id='$workspace_id'::uuid)+(select count(*) from public.workspaces where id='$workspace_id'::uuid)")
  test "$residue" = "0"
}

run_auth_restaurant_delete_race auth_first
run_auth_restaurant_delete_race restaurant_first

shasum -a 256 \
  "$forward" "$down" "$legacy" "$containment" "$fingerprint" \
  "$preflight" "$post_up" "$explain" \
  "$repo_root/src/domains/auth/workspace-access-live.test.ts" \
  "$script_dir/workspace-access-down-rehearsal.sh" "$proof_assets/README.md" \
  "$repo_root/docs/runbooks/production-migrations.md" "$operator_preflight" \
  > "$proof_dir/draft-hashes.txt"
echo "C04_REHEARSAL_PASS proof_dir=$proof_dir"
