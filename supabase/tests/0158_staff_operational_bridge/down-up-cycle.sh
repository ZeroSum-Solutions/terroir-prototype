#!/usr/bin/env bash
set -euo pipefail

# Exact empty-database down/up plus populated-history down refusal.
# Usage: bash down-up-cycle.sh <container-id> terroir_cost_seal_20260926b <proof-dir>
readonly container_id="${1:-}"
readonly database_name="${2:-}"
readonly proof_root="${3:-}"
readonly repo_root="$(cd "$(dirname "$0")/../../.." && pwd)"
readonly forward="${repo_root}/supabase/migrations/0158_staff_operational_bridge.sql"
readonly down="${repo_root}/supabase/migrations/down/0158_staff_operational_bridge.down.sql"
if [[ -z "${container_id}" \
   || "${database_name}" != "terroir_cost_seal_20260926b" \
   || ! -d "${proof_root}" || -L "${proof_root}" \
   || ! -f "${forward}" || ! -f "${down}" ]]; then
  echo 'C04_0158_TARGET_NOT_ADMITTED' >&2
  exit 64
fi
readonly proof_tmp="$(mktemp -d "${proof_root%/}/c04-0158-down-up.XXXXXX")"
echo "C04_0158_DOWN_UP_LOG_DIR=${proof_tmp}"

psql_stdin() {
  docker exec -i "${container_id}" env \
    PGOPTIONS='-c statement_timeout=30000 -c lock_timeout=5000' \
    psql -U postgres -d "${database_name}" -X -v ON_ERROR_STOP=1 "$@"
}

psql_stdin -Atc \
  "select case when current_database()='terroir_cost_seal_20260926b'
     and to_regprocedure('public.save_bottle_inventory_private(uuid,uuid,text,text,integer,text,text,text,text,integer,numeric)') is not null
     and not exists(select 1 from public.inventory_command_receipts where command_version=3)
     and not exists(select 1 from auth.users where id='15840000-0000-4000-8000-000000000001')
     then 'C04_0158_EMPTY_CYCLE_ADMITTED' else 'C04_0158_TARGET_NOT_ADMITTED' end" \
  | tee "${proof_tmp}/admission.out" | grep -qx C04_0158_EMPTY_CYCLE_ADMITTED

psql_stdin -1 >"${proof_tmp}/empty-down.out" 2>&1 <"${down}"
psql_stdin -Atc \
  "select case when
     to_regprocedure('public.read_current_operational_memberships(uuid)') is null
     and to_regprocedure('public.save_bottle_inventory_private(uuid,uuid,text,text,integer,text,text,text,text,integer,numeric)') is null
     and (select count(*) from pg_catalog.pg_constraint where conrelid='public.inventory_command_receipts'::regclass and conname in ('inventory_command_receipts_command_version_check','inventory_command_receipts_command_type_check','inventory_command_receipts_versioned_shape_check'))=3
     and not exists(select 1 from pg_catalog.pg_constraint where conrelid='public.inventory_command_receipts'::regclass and conname in ('inventory_command_receipts_command_version_check','inventory_command_receipts_command_type_check','inventory_command_receipts_versioned_shape_check') and pg_catalog.pg_get_constraintdef(oid,false) like '%bottle_inventory_save%')
     then 'C04_0158_EMPTY_DOWN_PASS' else 'C04_0158_EMPTY_DOWN_FAIL' end" \
  | tee "${proof_tmp}/empty-down-postcheck.out" | grep -qx C04_0158_EMPTY_DOWN_PASS
psql_stdin -1 >"${proof_tmp}/empty-up.out" 2>&1 <"${forward}"
psql_stdin -Atc \
  "select case when
     to_regprocedure('public.read_current_operational_memberships(uuid)') is not null
     and to_regprocedure('public.save_bottle_inventory_private(uuid,uuid,text,text,integer,text,text,text,text,integer,numeric)') is not null
     then 'C04_0158_EMPTY_DOWN_UP_PASS' else 'C04_0158_EMPTY_DOWN_UP_FAIL' end" \
  | tee "${proof_tmp}/empty-up-postcheck.out" | grep -qx C04_0158_EMPTY_DOWN_UP_PASS

psql_stdin <<'SQL' >"${proof_tmp}/history-fixture.out" 2>&1
begin;
insert into auth.users(id,email) values
  ('15840000-0000-4000-8000-000000000001','c04-0158-down@terroir.test');
insert into public.workspaces(id,kind,name) values
  ('15840000-0000-4000-8000-000000000002','restaurant','C04 0158 down');
insert into public.restaurants(id,name,workspace_id) values
  ('15840000-0000-4000-8000-000000000004','C04 0158 down site','15840000-0000-4000-8000-000000000002');
insert into public.workspace_memberships(id,workspace_id,user_id) values
  ('15840000-0000-4000-8000-000000000003','15840000-0000-4000-8000-000000000002','15840000-0000-4000-8000-000000000001');
insert into public.memberships(id,user_id,restaurant_id,role,workspace_membership_id) values
  ('15840000-0000-4000-8000-000000000005','15840000-0000-4000-8000-000000000001','15840000-0000-4000-8000-000000000004','staff','15840000-0000-4000-8000-000000000003');
select set_config('request.jwt.claim.sub','15840000-0000-4000-8000-000000000001',true);
select * from public.claim_scan_idempotency(
  '15840000-0000-4000-8000-000000000004','15840000-0000-4000-8000-000000000006','bottle_inventory_save'
);
select public.save_bottle_inventory_private(
  '15840000-0000-4000-8000-000000000004','15840000-0000-4000-8000-000000000006',
  'Down History','Bridge Producer',2022,'Pinot','Willamette',null,null,1,10
);
commit;
SQL

set +e
psql_stdin -1 >"${proof_tmp}/history-down-refusal.out" 2>&1 <"${down}"
readonly refusal_status=$?
set -e
if [[ "${refusal_status}" -eq 0 ]] \
   || ! grep -q C04_0158_DOWN_REFUSES_DURABLE_HISTORY "${proof_tmp}/history-down-refusal.out"; then
  cat "${proof_tmp}/history-down-refusal.out" >&2
  exit 1
fi
psql_stdin -Atc \
  "select case when
     to_regprocedure('public.save_bottle_inventory_private(uuid,uuid,text,text,integer,text,text,text,text,integer,numeric)') is not null
     and exists(select 1 from public.inventory_command_receipts where restaurant_id='15840000-0000-4000-8000-000000000004' and operation_id='15840000-0000-4000-8000-000000000006' and command_version=3 and result_payload='{\"status\":\"committed\"}'::jsonb)
     then 'C04_0158_POPULATED_DOWN_REFUSAL_PASS' else 'C04_0158_POPULATED_DOWN_REFUSAL_FAIL' end" \
  | tee "${proof_tmp}/history-down-postcheck.out" | grep -qx C04_0158_POPULATED_DOWN_REFUSAL_PASS

psql_stdin <<'SQL' >"${proof_tmp}/fixture-cleanup.out" 2>&1
begin;
delete from public.restaurants where id='15840000-0000-4000-8000-000000000004';
delete from public.workspaces where id='15840000-0000-4000-8000-000000000002';
delete from auth.users where id='15840000-0000-4000-8000-000000000001';
commit;
SQL
psql_stdin -1 >"${proof_tmp}/final-down.out" 2>&1 <"${down}"
psql_stdin -1 >"${proof_tmp}/final-up.out" 2>&1 <"${forward}"
psql_stdin -Atc \
  "select case when
     to_regprocedure('public.save_bottle_inventory_private(uuid,uuid,text,text,integer,text,text,text,text,integer,numeric)') is not null
     and not exists(select 1 from auth.users where id='15840000-0000-4000-8000-000000000001')
     and not exists(select 1 from public.inventory_command_receipts where operation_id='15840000-0000-4000-8000-000000000006')
     then 'C04_0158_DOWN_UP_CYCLE_PASS' else 'C04_0158_DOWN_UP_CYCLE_FAIL' end" \
  | tee "${proof_tmp}/final-postcheck.out" | grep -qx C04_0158_DOWN_UP_CYCLE_PASS

echo C04_0158_DOWN_UP_CYCLE_PASS
