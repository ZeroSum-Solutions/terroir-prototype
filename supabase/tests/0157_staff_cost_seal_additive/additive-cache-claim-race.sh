#!/usr/bin/env bash
set -euo pipefail

# Concurrent actor-binding regression for the 24-hour transport cache.
# Usage: bash additive-cache-claim-race.sh terroir_cost_seal_20260926b \
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

readonly proof_tmp="$(mktemp -d "${proof_root%/}/c04-0157-cache-claim.XXXXXX")"
echo "C04_0157_CACHE_RACE_LOG_DIR=${proof_tmp}"
setup_committed=0
cleanup() {
  local original_status=$?
  local database_cleanup_status=0
  trap - EXIT
  if [[ "${setup_committed}" -ne 1 ]]; then
    echo "C04_0157_CACHE_RACE_LOG_DIR=${proof_tmp}"
    exit "${original_status}"
  fi
  set +e
  # Reap this script's bounded PostgreSQL clients before fixture cleanup.
  wait || true
  docker exec -i "${container_id}" env \
    PGOPTIONS='-c statement_timeout=10000 -c lock_timeout=5000' \
    psql -U postgres -d "${database_name}" -X -v ON_ERROR_STOP=1 -q <<'SQL'
begin;
delete from public.scan_idempotency
 where restaurant_id='15740000-0000-4000-8000-000000000004'
   and key='15740000-0000-4000-8000-000000000009';
do $owned_restaurants$
declare deleted_count integer;
begin
  delete from public.restaurants r where r.id='15740000-0000-4000-8000-000000000004'
    or r.id in (select m.restaurant_id from public.memberships m
      where m.user_id in ('15740000-0000-4000-8000-000000000001','15740000-0000-4000-8000-000000000002'));
  get diagnostics deleted_count=row_count;
  if deleted_count<>3 then
    raise exception 'C04_0157_CACHE_RACE_OWNED_RESTAURANT_COUNT';
  end if;
end;
$owned_restaurants$;
delete from public.workspaces
 where id='15740000-0000-4000-8000-000000000003';
delete from auth.users
 where id in (
   '15740000-0000-4000-8000-000000000001',
   '15740000-0000-4000-8000-000000000002'
 );
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
  then raise exception 'C04_0157_CACHE_RACE_UNEXPECTED_RESIDUE'; end if;
  if exists(select 1 from auth.users where id in (
       '15740000-0000-4000-8000-000000000001',
       '15740000-0000-4000-8000-000000000002'
     ))
     or exists(select 1 from public.workspaces where id='15740000-0000-4000-8000-000000000003')
     or exists(select 1 from public.restaurants where id='15740000-0000-4000-8000-000000000004')
     or exists(select 1 from public.workspace_memberships where id in (
       '15740000-0000-4000-8000-000000000005',
       '15740000-0000-4000-8000-000000000006'
     ))
     or exists(select 1 from public.memberships where id in (
       '15740000-0000-4000-8000-000000000007',
       '15740000-0000-4000-8000-000000000008'
     ))
     or exists(select 1 from public.scan_idempotency
       where restaurant_id='15740000-0000-4000-8000-000000000004'
         and key='15740000-0000-4000-8000-000000000009')
     or exists(select 1 from pg_catalog.pg_stat_activity a
       where a.datname=current_database() and a.pid<>pg_backend_pid()) then
    raise exception 'C04_0157_CACHE_RACE_CLEANUP_FAILED';
  end if;
end;
$cleanup_postcheck$;
commit;
SQL
  database_cleanup_status=$?
  set -e
  if [[ "${database_cleanup_status}" -ne 0 ]]; then
    echo 'C04_0157_CACHE_RACE_DATABASE_CLEANUP_FAILED' >&2
  fi
  echo "C04_0157_CACHE_RACE_LOG_DIR=${proof_tmp}"
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
     or exists(select 1 from auth.users where id in (
       '15740000-0000-4000-8000-000000000001',
       '15740000-0000-4000-8000-000000000002'
     ))
     or exists(select 1 from public.workspaces where id='15740000-0000-4000-8000-000000000003')
     or exists(select 1 from public.restaurants where id='15740000-0000-4000-8000-000000000004')
     or exists(select 1 from public.workspace_memberships where id in (
       '15740000-0000-4000-8000-000000000005',
       '15740000-0000-4000-8000-000000000006'
     ))
     or exists(select 1 from public.memberships where id in (
       '15740000-0000-4000-8000-000000000007',
       '15740000-0000-4000-8000-000000000008'
     ))
     or exists(select 1 from public.scan_idempotency
       where restaurant_id='15740000-0000-4000-8000-000000000004'
         and key='15740000-0000-4000-8000-000000000009') then
    raise exception 'C04_0157_TARGET_NOT_ADMITTED' using errcode='P0001';
  end if;
end;
$target_admission$;
insert into auth.users(id,email) values
  ('15740000-0000-4000-8000-000000000001','c04-cache-race-a@terroir.test'),
  ('15740000-0000-4000-8000-000000000002','c04-cache-race-b@terroir.test');
insert into public.workspaces(id,kind,name) values
  ('15740000-0000-4000-8000-000000000003','restaurant','C04 cache race');
insert into public.restaurants(id,name,workspace_id) values
  ('15740000-0000-4000-8000-000000000004','C04 cache race site','15740000-0000-4000-8000-000000000003');
insert into public.workspace_memberships(id,workspace_id,user_id) values
  ('15740000-0000-4000-8000-000000000005','15740000-0000-4000-8000-000000000003','15740000-0000-4000-8000-000000000001'),
  ('15740000-0000-4000-8000-000000000006','15740000-0000-4000-8000-000000000003','15740000-0000-4000-8000-000000000002');
insert into public.memberships(id,user_id,restaurant_id,role,workspace_membership_id) values
  ('15740000-0000-4000-8000-000000000007','15740000-0000-4000-8000-000000000001','15740000-0000-4000-8000-000000000004','staff','15740000-0000-4000-8000-000000000005'),
  ('15740000-0000-4000-8000-000000000008','15740000-0000-4000-8000-000000000002','15740000-0000-4000-8000-000000000004','staff','15740000-0000-4000-8000-000000000006');
commit;
SQL
setup_committed=1

docker exec -i "${container_id}" env \
  PGAPPNAME='c04_0157_cache_actor_a_holder' \
  PGOPTIONS='-c statement_timeout=15000 -c lock_timeout=8000' \
  psql -U postgres -d "${database_name}" -X -v ON_ERROR_STOP=1 \
  >"${proof_tmp}/actor-a.out" 2>&1 <<'SQL' &
begin;
select set_config('request.jwt.claim.sub','15740000-0000-4000-8000-000000000001',true);
select * from public.claim_scan_idempotency(
  '15740000-0000-4000-8000-000000000004',
  '15740000-0000-4000-8000-000000000009',
  'invoice_scan_upload'
);
select pg_sleep(5);
commit;
SQL
readonly actor_a_pid=$!
actor_a_ready=0
for _ in {1..40}; do
  if [[ "$(docker exec "${container_id}" env \
    PGOPTIONS='-c statement_timeout=10000 -c lock_timeout=5000' \
    psql -U postgres -d "${database_name}" -X -Atc \
    "select count(*) from pg_catalog.pg_stat_activity where datname=current_database() and application_name='c04_0157_cache_actor_a_holder' and state='active' and wait_event_type='Timeout' and query like '%pg_sleep(5)%'")" -eq 1 ]]; then
    actor_a_ready=1
    break
  fi
  sleep 0.1
done
if [[ "${actor_a_ready}" -ne 1 ]]; then
  wait "${actor_a_pid}" || true
  cat "${proof_tmp}/actor-a.out" >&2
  echo 'C04_0157_CACHE_ACTOR_A_HOLDER_NOT_OBSERVED' >&2
  exit 1
fi

docker exec "${container_id}" env \
  PGAPPNAME='c04_0157_cache_actor_b_waiter' \
  PGOPTIONS='-c statement_timeout=15000 -c lock_timeout=8000' \
  psql -U postgres -d "${database_name}" -X -v ON_ERROR_STOP=1 \
  -c "select set_config('request.jwt.claim.sub','15740000-0000-4000-8000-000000000002',false); select * from public.claim_scan_idempotency('15740000-0000-4000-8000-000000000004','15740000-0000-4000-8000-000000000009','invoice_scan_upload');" \
  >"${proof_tmp}/actor-b.out" 2>&1 &
readonly actor_b_pid=$!
actor_b_wait_observed=0
for _ in {1..40}; do
  if [[ "$(docker exec "${container_id}" env \
    PGOPTIONS='-c statement_timeout=10000 -c lock_timeout=5000' \
    psql -U postgres -d "${database_name}" -X -Atc \
    "select count(*) from pg_catalog.pg_stat_activity where datname=current_database() and application_name='c04_0157_cache_actor_b_waiter' and wait_event_type='Lock'")" -eq 1 ]]; then
    actor_b_wait_observed=1
    docker exec "${container_id}" env \
      PGOPTIONS='-c statement_timeout=10000 -c lock_timeout=5000' \
      psql -U postgres -d "${database_name}" -X -Atc \
      "select application_name,state,wait_event_type,wait_event from pg_catalog.pg_stat_activity where datname=current_database() and application_name='c04_0157_cache_actor_b_waiter'" \
      >"${proof_tmp}/actor-b-lock-observed.out"
    break
  fi
  sleep 0.1
done
if [[ "${actor_b_wait_observed}" -ne 1 ]]; then
  wait "${actor_a_pid}" || true
  wait "${actor_b_pid}" || true
  cat "${proof_tmp}/actor-b.out" >&2
  echo 'C04_0157_CACHE_ACTOR_B_LOCK_WAIT_NOT_OBSERVED' >&2
  exit 1
fi
wait "${actor_a_pid}"
set +e
wait "${actor_b_pid}"
readonly actor_b_status=$?
set -e

if [[ "${actor_b_status}" -eq 0 ]] || ! grep -q C04_IDEMPOTENCY_CONFLICT "${proof_tmp}/actor-b.out"; then
  cat "${proof_tmp}/actor-b.out" >&2
  exit 1
fi
docker exec "${container_id}" env \
  PGOPTIONS='-c statement_timeout=10000 -c lock_timeout=5000' \
  psql -U postgres -d "${database_name}" -X -v ON_ERROR_STOP=1 -Atc \
  "select case when claimed_by_user_id='15740000-0000-4000-8000-000000000001'
     and response_status is null
     and response_body='{\"kind\":\"invoice_scan_upload\",\"status\":\"claimed\",\"version\":1}'::jsonb
     then 'C04_0157_CACHE_CLAIM_RACE_PASS' else 'C04_0157_CACHE_CLAIM_RACE_FAIL' end
   from public.scan_idempotency
   where restaurant_id='15740000-0000-4000-8000-000000000004'
     and key='15740000-0000-4000-8000-000000000009';" \
  | grep -qx C04_0157_CACHE_CLAIM_RACE_PASS

echo C04_0157_CACHE_CLAIM_RACE_PASS
