#!/usr/bin/env bash
set -euo pipefail

# Two-session proof for the 0157 invoice-scan migration barrier.
# Usage: bash additive-migration-scan-lock-race.sh terroir_cost_seal_20260926b \
#   /Users/zero/.claude/goal-state/terroir-production-20260923/proof/demo-staff-cost-20260926/additive/v2
readonly container_id="9c977bd272b79003bfbebc2d8971e1a9906d228a5ac4f531097dd6d2087ba360"
readonly expected_database_name="terroir_cost_seal_20260926b"
readonly expected_proof_root="/Users/zero/.claude/goal-state/terroir-production-20260923/proof/demo-staff-cost-20260926/additive/v2"
readonly database_name="${1:-}"
readonly proof_root="${2:-}"
if [[ "${database_name}" != "${expected_database_name}" \
   || "${proof_root}" != "${expected_proof_root}" \
   || ! -d "${proof_root}" || -L "${proof_root}" ]]; then
  echo 'C04_0157_TARGET_NOT_ADMITTED' >&2
  exit 64
fi

readonly proof_tmp="$(mktemp -d "${proof_root%/}/c04-0157-migration-scan-lock.XXXXXX")"
echo "C04_0157_MIGRATION_LOCK_LOG_DIR=${proof_tmp}"
setup_committed=0
cleanup() {
  local original_status=$?
  local database_cleanup_status=0
  trap - EXIT
  if [[ "${setup_committed}" -ne 1 ]]; then
    echo "C04_0157_MIGRATION_LOCK_LOG_DIR=${proof_tmp}"
    exit "${original_status}"
  fi
  set +e
  # Reap this script's bounded PostgreSQL clients before fixture cleanup.
  wait || true
  docker exec -i "${container_id}" env \
    PGOPTIONS='-c statement_timeout=10000 -c lock_timeout=5000' \
    psql -U postgres -d "${database_name}" -X -v ON_ERROR_STOP=1 -q <<'SQL'
begin;
do $owned_restaurants$
declare deleted_count integer;
begin
  delete from public.restaurants r where r.id='15750000-0000-4000-8000-000000000003'
    or r.id in (select m.restaurant_id from public.memberships m
      where m.user_id in ('15750000-0000-4000-8000-000000000001'));
  get diagnostics deleted_count=row_count;
  if deleted_count<>2 then
    raise exception 'C04_0157_MIGRATION_LOCK_OWNED_RESTAURANT_COUNT';
  end if;
end;
$owned_restaurants$;
delete from public.workspaces
 where id='15750000-0000-4000-8000-000000000002';
delete from auth.users
 where id='15750000-0000-4000-8000-000000000001';
do $cleanup_postcheck$
begin
  if false
     or exists(select 1 from auth.users)
     or exists(select 1 from public.workspaces)
     or exists(select 1 from public.restaurants)
     or exists(select 1 from public.workspace_memberships)
     or exists(select 1 from public.memberships)
     or exists(select 1 from public.scan_idempotency)
     or exists(select 1 from public.wines)
     or exists(select 1 from public.invoice_scans)
     or exists(select 1 from public.inventory_items)
     or exists(select 1 from public.identity_merge_log)
     or exists(select 1 from public.reconcile_actions)
     or exists(select 1 from public.reconcile_batches)
  then raise exception 'C04_0157_MIGRATION_LOCK_UNEXPECTED_RESIDUE'; end if;
  if exists(select 1 from auth.users where id='15750000-0000-4000-8000-000000000001')
     or exists(select 1 from public.workspaces where id='15750000-0000-4000-8000-000000000002')
     or exists(select 1 from public.restaurants where id='15750000-0000-4000-8000-000000000003')
     or exists(select 1 from public.invoice_scans where id='15750000-0000-4000-8000-000000000004')
     or exists(select 1 from pg_catalog.pg_stat_activity a
       where a.datname=current_database() and a.pid<>pg_backend_pid()) then
    raise exception 'C04_0157_MIGRATION_LOCK_CLEANUP_FAILED';
  end if;
end;
$cleanup_postcheck$;
commit;
SQL
  database_cleanup_status=$?
  set -e
  if [[ "${database_cleanup_status}" -ne 0 ]]; then
    echo 'C04_0157_MIGRATION_LOCK_DATABASE_CLEANUP_FAILED' >&2
  fi
  echo "C04_0157_MIGRATION_LOCK_LOG_DIR=${proof_tmp}"
  if [[ "${original_status}" -ne 0 ]]; then
    exit "${original_status}"
  fi
  if [[ "${database_cleanup_status}" -ne 0 ]]; then
    exit 1
  fi
  exit 0
}
trap cleanup EXIT

docker exec -i "${container_id}" env \
  PGOPTIONS='-c statement_timeout=10000 -c lock_timeout=5000' \
  psql -U postgres -d "${database_name}" -X -v ON_ERROR_STOP=1 <<'SQL'
begin;
do $target_admission$
begin
  if current_database()<>'terroir_cost_seal_20260926b'
     or current_user<>'postgres' or session_user<>'postgres'
     or exists(select 1 from auth.users)
     or exists(select 1 from public.workspaces)
     or exists(select 1 from public.restaurants)
     or exists(select 1 from public.workspace_memberships)
     or exists(select 1 from public.memberships)
     or exists(select 1 from public.scan_idempotency)
     or exists(select 1 from public.wines)
     or exists(select 1 from public.invoice_scans)
     or exists(select 1 from public.inventory_items)
     or exists(select 1 from public.identity_merge_log)
     or exists(select 1 from public.reconcile_actions)
     or exists(select 1 from public.reconcile_batches)
     or public.current_inventory_contract_version()<>2
     or to_regprocedure('public.current_site_role_at_least(uuid,public.membership_role)') is null
     or not exists(select 1 from pg_catalog.pg_attribute a
       where a.attrelid='public.scan_idempotency'::regclass
         and a.attname='claimed_by_user_id' and a.attnum>0 and not a.attisdropped)
     or exists(select 1 from pg_catalog.pg_stat_activity a
       where a.datname=current_database() and a.pid<>pg_backend_pid())
     or exists(select 1 from auth.users where id='15750000-0000-4000-8000-000000000001')
     or exists(select 1 from public.workspaces where id='15750000-0000-4000-8000-000000000002')
     or exists(select 1 from public.restaurants where id='15750000-0000-4000-8000-000000000003')
     or exists(select 1 from public.invoice_scans where id='15750000-0000-4000-8000-000000000004') then
    raise exception 'C04_0157_TARGET_NOT_ADMITTED' using errcode='P0001';
  end if;
end;
$target_admission$;
insert into auth.users(id,email) values
  ('15750000-0000-4000-8000-000000000001','c04-migration-lock@terroir.test');
insert into public.workspaces(id,kind,name) values
  ('15750000-0000-4000-8000-000000000002','restaurant','C04 migration lock');
insert into public.restaurants(id,name,workspace_id) values
  ('15750000-0000-4000-8000-000000000003','C04 migration lock site','15750000-0000-4000-8000-000000000002');
insert into public.invoice_scans(
  id,restaurant_id,created_by,distributor_name,parsed_line_items,
  final_line_items,edits,item_count,status
) values (
  '15750000-0000-4000-8000-000000000004',
  '15750000-0000-4000-8000-000000000003',
  '15750000-0000-4000-8000-000000000001',
  'C04 original','[]','[]','{}',0,'processing'
);
commit;
SQL
setup_committed=1

# An old application write already in flight makes the NOWAIT migration lock
# refuse the upgrade instead of validating a moving historical snapshot.
docker exec -i "${container_id}" env \
  PGAPPNAME='c04_0157_old_scan_writer_holder' \
  PGOPTIONS='-c statement_timeout=15000 -c lock_timeout=8000' \
  psql -U postgres -d "${database_name}" -X -v ON_ERROR_STOP=1 \
  >"${proof_tmp}/old-writer-holder.out" 2>&1 <<'SQL' &
begin;
update public.invoice_scans set distributor_name='C04 uncommitted old write'
 where id='15750000-0000-4000-8000-000000000004';
select pg_sleep(5);
rollback;
SQL
readonly old_writer_holder_pid=$!
old_writer_ready=0
for _ in {1..40}; do
  if [[ "$(docker exec "${container_id}" env \
    PGOPTIONS='-c statement_timeout=10000 -c lock_timeout=5000' \
    psql -U postgres -d "${database_name}" -X -Atc \
    "select count(*) from pg_catalog.pg_stat_activity where datname=current_database() and application_name='c04_0157_old_scan_writer_holder' and state='active' and wait_event_type='Timeout' and query like '%pg_sleep(5)%'")" -eq 1 ]]; then
    old_writer_ready=1
    break
  fi
  sleep 0.1
done
if [[ "${old_writer_ready}" -ne 1 ]]; then
  wait "${old_writer_holder_pid}" || true
  cat "${proof_tmp}/old-writer-holder.out" >&2
  echo 'C04_0157_OLD_SCAN_WRITER_HOLDER_NOT_OBSERVED' >&2
  exit 1
fi

set +e
docker exec -i "${container_id}" env \
  PGAPPNAME='c04_0157_migration_nowait_contender' \
  PGOPTIONS='-c statement_timeout=10000 -c lock_timeout=5000' \
  psql -U postgres -d "${database_name}" -X -v ON_ERROR_STOP=1 \
  >"${proof_tmp}/migration-nowait-contender.out" 2>&1 <<'SQL'
\set VERBOSITY verbose
begin;
lock table public.invoice_scans in share row exclusive mode nowait;
rollback;
SQL
readonly migration_contender_status=$?
set -e
wait "${old_writer_holder_pid}"
if [[ "${migration_contender_status}" -eq 0 ]] \
   || ! grep -q '55P03' "${proof_tmp}/migration-nowait-contender.out" \
   || ! grep -q 'invoice_scans' "${proof_tmp}/migration-nowait-contender.out"; then
  cat "${proof_tmp}/migration-nowait-contender.out" >&2
  exit 1
fi

# Once the migration owns SHARE ROW EXCLUSIVE, an old application update must
# actually wait on a PostgreSQL lock until the migration transaction releases.
docker exec -i "${container_id}" env \
  PGAPPNAME='c04_0157_migration_lock_holder' \
  PGOPTIONS='-c statement_timeout=15000 -c lock_timeout=8000' \
  psql -U postgres -d "${database_name}" -X -v ON_ERROR_STOP=1 \
  >"${proof_tmp}/migration-lock-holder.out" 2>&1 <<'SQL' &
begin;
lock table public.invoice_scans in share row exclusive mode nowait;
select pg_sleep(5);
rollback;
SQL
readonly migration_lock_holder_pid=$!
migration_lock_ready=0
for _ in {1..40}; do
  if [[ "$(docker exec "${container_id}" env \
    PGOPTIONS='-c statement_timeout=10000 -c lock_timeout=5000' \
    psql -U postgres -d "${database_name}" -X -Atc \
    "select count(*) from pg_catalog.pg_stat_activity where datname=current_database() and application_name='c04_0157_migration_lock_holder' and state='active' and wait_event_type='Timeout' and query like '%pg_sleep(5)%'")" -eq 1 ]]; then
    migration_lock_ready=1
    break
  fi
  sleep 0.1
done
if [[ "${migration_lock_ready}" -ne 1 ]]; then
  wait "${migration_lock_holder_pid}" || true
  cat "${proof_tmp}/migration-lock-holder.out" >&2
  echo 'C04_0157_MIGRATION_LOCK_HOLDER_NOT_OBSERVED' >&2
  exit 1
fi

docker exec -i "${container_id}" env \
  PGAPPNAME='c04_0157_old_scan_writer_waiter' \
  PGOPTIONS='-c statement_timeout=15000 -c lock_timeout=8000' \
  psql -U postgres -d "${database_name}" -X -v ON_ERROR_STOP=1 \
  >"${proof_tmp}/old-writer-waiter.out" 2>&1 <<'SQL' &
begin;
update public.invoice_scans set distributor_name='C04 rolled back waiter'
 where id='15750000-0000-4000-8000-000000000004';
rollback;
SQL
readonly old_writer_waiter_pid=$!
old_writer_wait_observed=0
for _ in {1..40}; do
  if [[ "$(docker exec "${container_id}" env \
    PGOPTIONS='-c statement_timeout=10000 -c lock_timeout=5000' \
    psql -U postgres -d "${database_name}" -X -Atc \
    "select count(*) from pg_catalog.pg_stat_activity where datname=current_database() and application_name='c04_0157_old_scan_writer_waiter' and wait_event_type='Lock'")" -eq 1 ]]; then
    old_writer_wait_observed=1
    docker exec "${container_id}" env \
      PGOPTIONS='-c statement_timeout=10000 -c lock_timeout=5000' \
      psql -U postgres -d "${database_name}" -X -Atc \
      "select application_name,state,wait_event_type,wait_event from pg_catalog.pg_stat_activity where datname=current_database() and application_name='c04_0157_old_scan_writer_waiter'" \
      >"${proof_tmp}/old-writer-lock-observed.out"
    break
  fi
  sleep 0.1
done
if [[ "${old_writer_wait_observed}" -ne 1 ]]; then
  wait "${migration_lock_holder_pid}" || true
  wait "${old_writer_waiter_pid}" || true
  cat "${proof_tmp}/old-writer-waiter.out" >&2
  echo 'C04_0157_OLD_SCAN_WRITER_LOCK_WAIT_NOT_OBSERVED' >&2
  exit 1
fi
wait "${migration_lock_holder_pid}"
wait "${old_writer_waiter_pid}"

docker exec "${container_id}" env \
  PGOPTIONS='-c statement_timeout=10000 -c lock_timeout=5000' \
  psql -U postgres -d "${database_name}" -X -v ON_ERROR_STOP=1 -Atc \
  "select case when distributor_name='C04 original'
     then 'C04_0157_MIGRATION_SCAN_LOCK_RACE_PASS'
     else 'C04_0157_MIGRATION_SCAN_LOCK_RACE_FAIL' end
   from public.invoice_scans
   where id='15750000-0000-4000-8000-000000000004';" \
  | grep -qx C04_0157_MIGRATION_SCAN_LOCK_RACE_PASS

echo C04_0157_MIGRATION_SCAN_LOCK_RACE_PASS
