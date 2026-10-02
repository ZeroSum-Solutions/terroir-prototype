#!/usr/bin/env bash
set -euo pipefail

# Disposable PostgreSQL race regression for the 0157 scan -> wine lock order.
# Usage: bash additive-identity-lock-race.sh terroir_cost_seal_20260926b \
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

readonly proof_tmp="$(mktemp -d "${proof_root%/}/c04-0157-identity-lock.XXXXXX")"
echo "C04_0157_IDENTITY_RACE_LOG_DIR=${proof_tmp}"
setup_committed=0
cleanup() {
  local original_status=$?
  local database_cleanup_status=0
  trap - EXIT
  if [[ "${setup_committed}" -ne 1 ]]; then
    echo "C04_0157_IDENTITY_RACE_LOG_DIR=${proof_tmp}"
    exit "${original_status}"
  fi
  set +e
  # Reap this script's bounded PostgreSQL clients before fixture cleanup.
  wait || true
  docker exec -i "${container_id}" env \
    PGOPTIONS='-c statement_timeout=10000 -c lock_timeout=5000' \
    psql -U postgres -d "${database_name}" -X -v ON_ERROR_STOP=1 -q <<'SQL'
begin;
delete from public.identity_merge_log
 where source_id in (
   '15730000-0000-4000-8000-000000000010',
   '15730000-0000-4000-8000-000000000011',
   '15730000-0000-4000-8000-000000000012',
   '15730000-0000-4000-8000-000000000013'
 ) or target_id in (
   '15730000-0000-4000-8000-000000000010',
   '15730000-0000-4000-8000-000000000011',
   '15730000-0000-4000-8000-000000000012',
   '15730000-0000-4000-8000-000000000013'
 );
delete from public.reconcile_actions
 where batch_id in (
   '15730000-0000-4000-8000-000000000030',
   '15730000-0000-4000-8000-000000000031'
 );
delete from public.reconcile_batches
 where id in (
   '15730000-0000-4000-8000-000000000030',
   '15730000-0000-4000-8000-000000000031'
 );
do $owned_restaurants$
declare deleted_count integer;
begin
  delete from public.restaurants r where r.id='15730000-0000-4000-8000-000000000003'
    or r.id in (select m.restaurant_id from public.memberships m
      where m.user_id in ('15730000-0000-4000-8000-000000000001'));
  get diagnostics deleted_count=row_count;
  if deleted_count<>2 then
    raise exception 'C04_0157_IDENTITY_RACE_OWNED_RESTAURANT_COUNT';
  end if;
end;
$owned_restaurants$;
delete from public.workspaces
 where id='15730000-0000-4000-8000-000000000002';
delete from auth.users
 where id='15730000-0000-4000-8000-000000000001';
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
  then raise exception 'C04_0157_IDENTITY_RACE_UNEXPECTED_RESIDUE'; end if;
  if exists(select 1 from auth.users where id='15730000-0000-4000-8000-000000000001')
     or exists(select 1 from public.workspaces where id='15730000-0000-4000-8000-000000000002')
     or exists(select 1 from public.restaurants where id='15730000-0000-4000-8000-000000000003')
     or exists(select 1 from public.workspace_memberships where id='15730000-0000-4000-8000-000000000004')
     or exists(select 1 from public.memberships where id='15730000-0000-4000-8000-000000000005')
     or exists(select 1 from public.wines where id in (
       '15730000-0000-4000-8000-000000000010',
       '15730000-0000-4000-8000-000000000011',
       '15730000-0000-4000-8000-000000000012',
       '15730000-0000-4000-8000-000000000013'
     ))
     or exists(select 1 from public.invoice_scans where id in (
       '15730000-0000-4000-8000-000000000020',
       '15730000-0000-4000-8000-000000000021'
     ))
     or exists(select 1 from public.reconcile_batches where id in (
       '15730000-0000-4000-8000-000000000030',
       '15730000-0000-4000-8000-000000000031'
     ))
     or exists(select 1 from public.reconcile_actions where batch_id in (
       '15730000-0000-4000-8000-000000000030',
       '15730000-0000-4000-8000-000000000031'
     ))
     or exists(select 1 from public.identity_merge_log where source_id in (
       '15730000-0000-4000-8000-000000000010',
       '15730000-0000-4000-8000-000000000011',
       '15730000-0000-4000-8000-000000000012',
       '15730000-0000-4000-8000-000000000013'
     ) or target_id in (
       '15730000-0000-4000-8000-000000000010',
       '15730000-0000-4000-8000-000000000011',
       '15730000-0000-4000-8000-000000000012',
       '15730000-0000-4000-8000-000000000013'
     ))
     or exists(select 1 from pg_catalog.pg_stat_activity a
       where a.datname=current_database() and a.pid<>pg_backend_pid()) then
    raise exception 'C04_0157_IDENTITY_RACE_CLEANUP_FAILED';
  end if;
end;
$cleanup_postcheck$;
commit;
SQL
  database_cleanup_status=$?
  set -e

  if [[ "${database_cleanup_status}" -ne 0 ]]; then
    echo 'C04_0157_IDENTITY_RACE_DATABASE_CLEANUP_FAILED' >&2
  fi
  echo "C04_0157_IDENTITY_RACE_LOG_DIR=${proof_tmp}"
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
     or exists(select 1 from auth.users where id='15730000-0000-4000-8000-000000000001')
     or exists(select 1 from public.workspaces where id='15730000-0000-4000-8000-000000000002')
     or exists(select 1 from public.restaurants where id='15730000-0000-4000-8000-000000000003')
     or exists(select 1 from public.workspace_memberships where id='15730000-0000-4000-8000-000000000004')
     or exists(select 1 from public.memberships where id='15730000-0000-4000-8000-000000000005')
     or exists(select 1 from public.wines where id in (
       '15730000-0000-4000-8000-000000000010',
       '15730000-0000-4000-8000-000000000011',
       '15730000-0000-4000-8000-000000000012',
       '15730000-0000-4000-8000-000000000013'
     ))
     or exists(select 1 from public.invoice_scans where id in (
       '15730000-0000-4000-8000-000000000020',
       '15730000-0000-4000-8000-000000000021'
     ))
     or exists(select 1 from public.reconcile_batches where id in (
       '15730000-0000-4000-8000-000000000030',
       '15730000-0000-4000-8000-000000000031'
     ))
     or exists(select 1 from public.reconcile_actions where batch_id in (
       '15730000-0000-4000-8000-000000000030',
       '15730000-0000-4000-8000-000000000031'
     ))
     or exists(select 1 from public.identity_merge_log where source_id in (
       '15730000-0000-4000-8000-000000000010',
       '15730000-0000-4000-8000-000000000011',
       '15730000-0000-4000-8000-000000000012',
       '15730000-0000-4000-8000-000000000013'
     ) or target_id in (
       '15730000-0000-4000-8000-000000000010',
       '15730000-0000-4000-8000-000000000011',
       '15730000-0000-4000-8000-000000000012',
       '15730000-0000-4000-8000-000000000013'
     )) then
    raise exception 'C04_0157_TARGET_NOT_ADMITTED' using errcode='P0001';
  end if;
end;
$target_admission$;
insert into auth.users(id,email) values
  ('15730000-0000-4000-8000-000000000001','c04-race@terroir.test');
insert into public.workspaces(id,kind,name) values
  ('15730000-0000-4000-8000-000000000002','restaurant','C04 race');
insert into public.restaurants(id,name,workspace_id) values
  ('15730000-0000-4000-8000-000000000003','C04 race site','15730000-0000-4000-8000-000000000002');
insert into public.workspace_memberships(id,workspace_id,user_id) values
  ('15730000-0000-4000-8000-000000000004','15730000-0000-4000-8000-000000000002','15730000-0000-4000-8000-000000000001');
insert into public.memberships(id,user_id,restaurant_id,role,workspace_membership_id) values
  ('15730000-0000-4000-8000-000000000005','15730000-0000-4000-8000-000000000001','15730000-0000-4000-8000-000000000003','owner','15730000-0000-4000-8000-000000000004');
insert into public.wines(id,restaurant_id,name,producer,vintage,size_ml,lwin_id) values
  ('15730000-0000-4000-8000-000000000010','15730000-0000-4000-8000-000000000003','Race A source','C04',2020,750,'3333333'),
  ('15730000-0000-4000-8000-000000000011','15730000-0000-4000-8000-000000000003','Race A target','C04',2020,750,'3333333'),
  ('15730000-0000-4000-8000-000000000012','15730000-0000-4000-8000-000000000003','Race B source','C04',2021,750,'4444444'),
  ('15730000-0000-4000-8000-000000000013','15730000-0000-4000-8000-000000000003','Race B target','C04',2021,750,'4444444');
insert into public.invoice_scans(
  id,restaurant_id,created_by,distributor_name,parsed_line_items,final_line_items,edits,item_count,status
) values
  ('15730000-0000-4000-8000-000000000020','15730000-0000-4000-8000-000000000003','15730000-0000-4000-8000-000000000001','Race A','[]',
   '[{"id":"race-a","name":"Race A source","producer":"C04","vintage":2020,"varietal":"","region":"","qty":1,"unitCost":1,"confidence":1}]','{}',1,'complete'),
  ('15730000-0000-4000-8000-000000000021','15730000-0000-4000-8000-000000000003','15730000-0000-4000-8000-000000000001','Race B','[]',
   '[{"id":"race-b","name":"Race B source","producer":"C04","vintage":2021,"varietal":"","region":"","qty":1,"unitCost":1,"confidence":1}]','{}',1,'complete');
commit;
SQL
setup_committed=1

# Direction A: reconciliation already owns the scan lock. Merge must wait on
# that scan before taking wine locks, then rewrite the newly accepted source.
docker exec -i "${container_id}" env \
  PGAPPNAME='c04_0157_reconcile_first_holder' \
  PGOPTIONS='-c statement_timeout=15000 -c lock_timeout=8000' \
  psql -U postgres -d "${database_name}" -X -v ON_ERROR_STOP=1 \
  >"${proof_tmp}/reconcile-first.out" 2>&1 <<'SQL' &
begin;
select set_config('request.jwt.claim.sub','15730000-0000-4000-8000-000000000001',true);
select id from public.invoice_scans
 where id='15730000-0000-4000-8000-000000000020' for update;
select pg_sleep(5);
select public.accept_reconcile_batch(
  '15730000-0000-4000-8000-000000000003',
  '[{"action_type":"match_scan","subject_table":"invoice_scans","subject_id":"15730000-0000-4000-8000-000000000020","patch":{"line_index":0,"wine_id":"15730000-0000-4000-8000-000000000010","expected_line":{"id":"race-a","name":"Race A source","producer":"C04","vintage":2020,"varietal":"","region":"","qty":1,"unitCost":1,"confidence":1}}}]',
  '15730000-0000-4000-8000-000000000030'
);
commit;
SQL
readonly reconcile_first_pid=$!
reconcile_first_ready=0
for _ in {1..40}; do
  if [[ "$(docker exec "${container_id}" env \
    PGOPTIONS='-c statement_timeout=10000 -c lock_timeout=5000' \
    psql -U postgres -d "${database_name}" -X -Atc \
    "select count(*) from pg_catalog.pg_stat_activity where datname=current_database() and application_name='c04_0157_reconcile_first_holder' and state='active' and wait_event_type='Timeout' and query like '%pg_sleep(5)%'")" -eq 1 ]]; then
    reconcile_first_ready=1
    break
  fi
  sleep 0.1
done
if [[ "${reconcile_first_ready}" -ne 1 ]]; then
  wait "${reconcile_first_pid}" || true
  cat "${proof_tmp}/reconcile-first.out" >&2
  echo 'C04_0157_RECONCILE_FIRST_HOLDER_NOT_OBSERVED' >&2
  exit 1
fi

docker exec "${container_id}" env \
  PGAPPNAME='c04_0157_merge_second_waiter' \
  PGOPTIONS='-c statement_timeout=15000 -c lock_timeout=8000' \
  psql -U postgres -d "${database_name}" -X -v ON_ERROR_STOP=1 \
  -c "select set_config('request.jwt.claim.sub','15730000-0000-4000-8000-000000000001',false); select public.merge_wines('15730000-0000-4000-8000-000000000010','15730000-0000-4000-8000-000000000011');" \
  >"${proof_tmp}/merge-second.out" 2>&1 &
readonly merge_second_pid=$!
merge_second_wait_observed=0
for _ in {1..40}; do
  if [[ "$(docker exec "${container_id}" env \
    PGOPTIONS='-c statement_timeout=10000 -c lock_timeout=5000' \
    psql -U postgres -d "${database_name}" -X -Atc \
    "select count(*) from pg_catalog.pg_stat_activity where datname=current_database() and application_name='c04_0157_merge_second_waiter' and wait_event_type='Lock'")" -eq 1 ]]; then
    merge_second_wait_observed=1
    docker exec "${container_id}" env \
      PGOPTIONS='-c statement_timeout=10000 -c lock_timeout=5000' \
      psql -U postgres -d "${database_name}" -X -Atc \
      "select application_name,state,wait_event_type,wait_event from pg_catalog.pg_stat_activity where datname=current_database() and application_name='c04_0157_merge_second_waiter'" \
      >"${proof_tmp}/direction-a-lock-observed.out"
    break
  fi
  sleep 0.1
done
if [[ "${merge_second_wait_observed}" -ne 1 ]]; then
  wait "${reconcile_first_pid}" || true
  wait "${merge_second_pid}" || true
  cat "${proof_tmp}/merge-second.out" >&2
  echo 'C04_0157_MERGE_SECOND_LOCK_WAIT_NOT_OBSERVED' >&2
  exit 1
fi
wait "${reconcile_first_pid}"
wait "${merge_second_pid}"

docker exec "${container_id}" env \
  PGOPTIONS='-c statement_timeout=10000 -c lock_timeout=5000' \
  psql -U postgres -d "${database_name}" -X -v ON_ERROR_STOP=1 -Atc \
  "select case when
     (select final_line_items->0->>'wine_id' from public.invoice_scans where id='15730000-0000-4000-8000-000000000020')='15730000-0000-4000-8000-000000000011'
     and exists(select 1 from public.reconcile_actions where batch_id='15730000-0000-4000-8000-000000000030' and new_state->'final_line_items'->0->>'wine_id'='15730000-0000-4000-8000-000000000010')
     then 'RECONCILE_FIRST_PASS' else 'RECONCILE_FIRST_FAIL' end;" \
  | grep -qx RECONCILE_FIRST_PASS

# Direction B: merge already owns the scan lock. Reconciliation must wait,
# then fail closed because its requested source identity was merged away.
docker exec -i "${container_id}" env \
  PGAPPNAME='c04_0157_merge_first_holder' \
  PGOPTIONS='-c statement_timeout=15000 -c lock_timeout=8000' \
  psql -U postgres -d "${database_name}" -X -v ON_ERROR_STOP=1 \
  >"${proof_tmp}/merge-first.out" 2>&1 <<'SQL' &
begin;
select set_config('request.jwt.claim.sub','15730000-0000-4000-8000-000000000001',true);
select id from public.invoice_scans
 where id='15730000-0000-4000-8000-000000000021' for update;
select pg_sleep(5);
select public.merge_wines(
  '15730000-0000-4000-8000-000000000012',
  '15730000-0000-4000-8000-000000000013'
);
commit;
SQL
readonly merge_first_pid=$!
merge_first_ready=0
for _ in {1..40}; do
  if [[ "$(docker exec "${container_id}" env \
    PGOPTIONS='-c statement_timeout=10000 -c lock_timeout=5000' \
    psql -U postgres -d "${database_name}" -X -Atc \
    "select count(*) from pg_catalog.pg_stat_activity where datname=current_database() and application_name='c04_0157_merge_first_holder' and state='active' and wait_event_type='Timeout' and query like '%pg_sleep(5)%'")" -eq 1 ]]; then
    merge_first_ready=1
    break
  fi
  sleep 0.1
done
if [[ "${merge_first_ready}" -ne 1 ]]; then
  wait "${merge_first_pid}" || true
  cat "${proof_tmp}/merge-first.out" >&2
  echo 'C04_0157_MERGE_FIRST_HOLDER_NOT_OBSERVED' >&2
  exit 1
fi

docker exec "${container_id}" env \
  PGAPPNAME='c04_0157_reconcile_second_waiter' \
  PGOPTIONS='-c statement_timeout=15000 -c lock_timeout=8000' \
  psql -U postgres -d "${database_name}" -X -v ON_ERROR_STOP=1 \
  -c "select set_config('request.jwt.claim.sub','15730000-0000-4000-8000-000000000001',false); select public.accept_reconcile_batch('15730000-0000-4000-8000-000000000003','[{\"action_type\":\"match_scan\",\"subject_table\":\"invoice_scans\",\"subject_id\":\"15730000-0000-4000-8000-000000000021\",\"patch\":{\"line_index\":0,\"wine_id\":\"15730000-0000-4000-8000-000000000012\",\"expected_line\":{\"id\":\"race-b\",\"name\":\"Race B source\",\"producer\":\"C04\",\"vintage\":2021,\"varietal\":\"\",\"region\":\"\",\"qty\":1,\"unitCost\":1,\"confidence\":1}}}]','15730000-0000-4000-8000-000000000031');" \
  >"${proof_tmp}/reconcile-second.out" 2>&1 &
readonly reconcile_second_pid=$!
reconcile_second_wait_observed=0
for _ in {1..40}; do
  if [[ "$(docker exec "${container_id}" env \
    PGOPTIONS='-c statement_timeout=10000 -c lock_timeout=5000' \
    psql -U postgres -d "${database_name}" -X -Atc \
    "select count(*) from pg_catalog.pg_stat_activity where datname=current_database() and application_name='c04_0157_reconcile_second_waiter' and wait_event_type='Lock'")" -eq 1 ]]; then
    reconcile_second_wait_observed=1
    docker exec "${container_id}" env \
      PGOPTIONS='-c statement_timeout=10000 -c lock_timeout=5000' \
      psql -U postgres -d "${database_name}" -X -Atc \
      "select application_name,state,wait_event_type,wait_event from pg_catalog.pg_stat_activity where datname=current_database() and application_name='c04_0157_reconcile_second_waiter'" \
      >"${proof_tmp}/direction-b-lock-observed.out"
    break
  fi
  sleep 0.1
done
if [[ "${reconcile_second_wait_observed}" -ne 1 ]]; then
  wait "${merge_first_pid}" || true
  wait "${reconcile_second_pid}" || true
  cat "${proof_tmp}/reconcile-second.out" >&2
  echo 'C04_0157_RECONCILE_SECOND_LOCK_WAIT_NOT_OBSERVED' >&2
  exit 1
fi
wait "${merge_first_pid}"
set +e
wait "${reconcile_second_pid}"
readonly reconcile_second_status=$?
set -e
if [[ "${reconcile_second_status}" -eq 0 ]] || ! grep -q C04_RECONCILE_ACCEPT_REFUSED "${proof_tmp}/reconcile-second.out"; then
  cat "${proof_tmp}/reconcile-second.out" >&2
  exit 1
fi

docker exec "${container_id}" env \
  PGOPTIONS='-c statement_timeout=10000 -c lock_timeout=5000' \
  psql -U postgres -d "${database_name}" -X -v ON_ERROR_STOP=1 -Atc \
  "select case when not exists(select 1 from public.reconcile_batches where id='15730000-0000-4000-8000-000000000031')
     and (select final_line_items->0 ? 'wine_id' from public.invoice_scans where id='15730000-0000-4000-8000-000000000021')=false
     then 'MERGE_FIRST_PASS' else 'MERGE_FIRST_FAIL' end;" \
  | grep -qx MERGE_FIRST_PASS

echo C04_0157_IDENTITY_LOCK_RACE_PASS
