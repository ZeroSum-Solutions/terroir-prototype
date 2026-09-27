#!/usr/bin/env bash
set -euo pipefail

# Run only after an independent reviewer admits this exact script hash.
# Usage: bash same-operation-race.sh terroir_cost_seal_20260926b \
#   /Users/zero/.claude/goal-state/terroir-production-20260923/proof/demo-staff-cost-20260926/operational-bridge-0158 \
#   same-input|changed-input
readonly container_id="9c977bd272b79003bfbebc2d8971e1a9906d228a5ac4f531097dd6d2087ba360"
readonly expected_database_name="terroir_cost_seal_20260926b"
readonly expected_proof_root="/Users/zero/.claude/goal-state/terroir-production-20260923/proof/demo-staff-cost-20260926/operational-bridge-0158"
readonly expected_repo_root="/Users/zero/projects/_archive/terroir-prototype"
readonly expected_schema_sha256="2848957cd7e08dea5cc64f1b5c08aca3e5068a24b324e2a27bfdb131dbc1352b"
readonly expected_data_sha256="bec6d526b83e9c1d5061ebc73f4269bb722f73659d41a1b3259c465b3238bcf4"
readonly database_name="${1:-}"
readonly proof_root="${2:-}"
readonly race_mode="${3:-}"
readonly script_path="${expected_repo_root}/supabase/tests/0158_staff_operational_bridge/same-operation-race.sh"
readonly admission_file="${expected_proof_root}/independent-race-repair-source-admission.md"
readonly invoked_script_path="$(cd "$(dirname "$0")" && pwd -P)/$(basename "$0")"

sha256_file() {
  shasum -a 256 "$1" | awk '{print $1}'
}

dump_hash() {
  docker exec "${container_id}" pg_dump -U supabase_admin -d "${database_name}" \
    "$1" --no-comments --no-publications --no-subscriptions --lock-wait-timeout=5000 \
    | sed -E '/^\\(un)?restrict /d' \
    | shasum -a 256 \
    | awk '{print $1}'
}

if [[ "${database_name}" != "${expected_database_name}" \
   || "${proof_root}" != "${expected_proof_root}" \
   || ( "${race_mode}" != "same-input" && "${race_mode}" != "changed-input" ) \
   || ! -d "${proof_root}" || -L "${proof_root}" \
   || "${invoked_script_path}" != "${script_path}" \
   || ! -f "${script_path}" || -L "${script_path}" \
   || ! -f "${admission_file}" || -L "${admission_file}" ]]; then
  echo 'C04_0158_TARGET_NOT_ADMITTED' >&2
  exit 64
fi

readonly script_sha256="$(sha256_file "${script_path}")"
if ! grep -Fqx "C04_0158_RACE_SOURCE_ADMITTED=${script_sha256}" "${admission_file}"; then
  echo 'C04_0158_RACE_SOURCE_NOT_ADMITTED' >&2
  exit 64
fi

readonly container_identity="$(docker inspect --format '{{.Id}}|{{.State.Running}}|{{index .Config.Labels "com.supabase.cli.project"}}' "${container_id}")"
if [[ "${container_identity}" != "${container_id}|true|terroir-fe9-c1-20260926a" ]]; then
  echo 'C04_0158_CONTAINER_NOT_ADMITTED' >&2
  exit 64
fi

if [[ "$(sha256_file "${expected_repo_root}/supabase/migrations/0158_staff_operational_bridge.sql")" != "05dc29c4e5b7f93fb4e9e4bcc94ab6cee1ec6c55d311a807a264db5e15e76b12" \
   || "$(sha256_file "${expected_repo_root}/supabase/migrations/down/0158_staff_operational_bridge.down.sql")" != "3c18ec0fd47c18ad8ee5116950cec6ea946440a4db7a62a12bdaf974ae0c08b3" \
   || "$(sha256_file "${expected_repo_root}/scripts/0158-production-preflight.sql")" != "9e994c077b87c05fd0f7e147d251c2f0c437d12f5510af52666e9f68d2e4be40" \
   || "$(sha256_file "${expected_repo_root}/scripts/0158-production-postflight.sql")" != "af89b23096e236dd350bd39adec0a994de6cc122cd29c65ffecdc30a4cb18390" ]]; then
  echo 'C04_0158_SOURCE_HASH_MISMATCH' >&2
  exit 64
fi

if [[ "$(dump_hash --schema-only)" != "${expected_schema_sha256}" \
   || "$(dump_hash --data-only)" != "${expected_data_sha256}" ]]; then
  echo 'C04_0158_APPLIED_STATE_NOT_ADMITTED' >&2
  exit 64
fi

readonly proof_tmp="$(mktemp -d "${proof_root%/}/c04-0158-race.XXXXXX")"
echo "C04_0158_RACE_LOG_DIR=${proof_tmp}"
setup_committed=0
winner_pid=''
waiter_pid=''

cleanup() {
  local original_status=$?
  local database_cleanup_status=0
  local state_cleanup_status=0
  trap - EXIT
  if [[ "${setup_committed}" -ne 1 ]]; then
    echo "C04_0158_RACE_LOG_DIR=${proof_tmp}"
    exit "${original_status}"
  fi

  set +e
  # Both clients carry server-side timeouts; reap them before cleanup.
  if [[ -n "${winner_pid}" ]]; then wait "${winner_pid}" >/dev/null 2>&1 || true; fi
  if [[ -n "${waiter_pid}" ]]; then wait "${waiter_pid}" >/dev/null 2>&1 || true; fi
  docker exec -i "${container_id}" env \
    PGOPTIONS='-c statement_timeout=10000 -c lock_timeout=5000' \
    psql -U postgres -d "${database_name}" -X -v ON_ERROR_STOP=1 -q \
    >"${proof_tmp}/cleanup.out" 2>&1 <<'SQL'
begin;
create temp table c04_0158_owned_restaurants on commit drop as
select distinct m.restaurant_id
  from public.memberships m
 where m.user_id='15830000-0000-4000-8000-000000000001'
union
select '15830000-0000-4000-8000-000000000004'::uuid;
create temp table c04_0158_owned_workspaces on commit drop as
select distinct r.workspace_id
  from public.restaurants r
  join c04_0158_owned_restaurants o on o.restaurant_id=r.id;
create temp table c04_0158_owned_canonical on commit drop as
select cw.id
  from public.canonical_wines cw
 where cw.created_by_restaurant_id in (
   select restaurant_id from c04_0158_owned_restaurants
 );
do $owned_before$
begin
  if (select count(*) from c04_0158_owned_restaurants)<>2
     or (select count(*) from c04_0158_owned_workspaces)<>2
     or (select count(*) from c04_0158_owned_canonical)>1 then
    raise exception 'C04_0158_RACE_OWNERSHIP_CAPTURE_MISMATCH';
  end if;
end;
$owned_before$;
do $delete_restaurants$
declare deleted_count integer;
begin
  delete from public.restaurants r
   where r.id in (select restaurant_id from c04_0158_owned_restaurants);
  get diagnostics deleted_count=row_count;
  if deleted_count<>2 then
    raise exception 'C04_0158_RACE_OWNED_RESTAURANT_COUNT';
  end if;
end;
$delete_restaurants$;
do $delete_canonical$
declare
  deleted_count integer;
  expected_count integer;
begin
  select count(*) into expected_count from c04_0158_owned_canonical;
  delete from public.canonical_wines cw
   where cw.id in (select id from c04_0158_owned_canonical);
  get diagnostics deleted_count=row_count;
  if deleted_count<>expected_count then
    raise exception 'C04_0158_RACE_OWNED_CANONICAL_COUNT';
  end if;
end;
$delete_canonical$;
do $delete_workspaces$
declare deleted_count integer;
begin
  -- The derived singleton workspace is removed by restaurant cleanup; the
  -- explicitly grouped workspace remains and is deleted here.
  delete from public.workspaces w
   where w.id in (select workspace_id from c04_0158_owned_workspaces);
  get diagnostics deleted_count=row_count;
  if deleted_count<>1 then
    raise exception 'C04_0158_RACE_OWNED_WORKSPACE_COUNT';
  end if;
end;
$delete_workspaces$;
do $delete_user$
declare deleted_count integer;
begin
  delete from auth.users where id='15830000-0000-4000-8000-000000000001';
  get diagnostics deleted_count=row_count;
  if deleted_count<>1 then
    raise exception 'C04_0158_RACE_OWNED_USER_COUNT';
  end if;
end;
$delete_user$;
do $cleanup_postcheck$
begin
  if exists(select 1 from auth.users)
     or exists(select 1 from public.workspaces)
     or exists(select 1 from public.restaurants)
     or exists(select 1 from public.workspace_memberships)
     or exists(select 1 from public.memberships)
     or exists(select 1 from public.reason_codes)
     or exists(select 1 from public.scan_idempotency)
     or exists(select 1 from public.wines)
     or exists(select 1 from public.wine_lineages)
     or exists(select 1 from public.wine_variants)
     or exists(select 1 from public.wine_aliases)
     or exists(select 1 from public.canonical_wines)
     or exists(select 1 from public.invoice_scans)
     or exists(select 1 from public.inventory_items)
     or exists(select 1 from public.inventory_command_receipts)
     or exists(select 1 from public.identity_merge_log)
     or exists(select 1 from public.reconcile_actions)
     or exists(select 1 from public.reconcile_batches)
     or exists(select 1 from pg_catalog.pg_stat_activity a
       where a.datname=current_database() and a.pid<>pg_backend_pid()) then
    raise exception 'C04_0158_RACE_UNEXPECTED_RESIDUE';
  end if;
end;
$cleanup_postcheck$;
commit;
SQL
  database_cleanup_status=$?
  if [[ "${database_cleanup_status}" -eq 0 ]]; then
    if [[ "$(dump_hash --schema-only)" != "${expected_schema_sha256}" \
       || "$(dump_hash --data-only)" != "${expected_data_sha256}" ]]; then
      state_cleanup_status=1
      echo 'C04_0158_RACE_POST_CLEANUP_STATE_MISMATCH' >&2
    fi
  fi
  set -e

  if [[ "${database_cleanup_status}" -ne 0 ]]; then
    cat "${proof_tmp}/cleanup.out" >&2
    echo 'C04_0158_RACE_DATABASE_CLEANUP_FAILED' >&2
  fi
  echo "C04_0158_RACE_LOG_DIR=${proof_tmp}"
  if [[ "${original_status}" -ne 0 ]]; then exit "${original_status}"; fi
  if [[ "${database_cleanup_status}" -ne 0 || "${state_cleanup_status}" -ne 0 ]]; then exit 1; fi
  exit 0
}
trap cleanup EXIT

docker exec -i "${container_id}" env \
  PGOPTIONS='-c statement_timeout=10000 -c lock_timeout=5000' \
  psql -U postgres -d "${database_name}" -X -v ON_ERROR_STOP=1 -At \
  >"${proof_tmp}/setup.out" 2>&1 <<'SQL'
begin;
do $target_admission$
begin
  if current_database()<>'terroir_cost_seal_20260926b'
     or current_user<>'postgres' or session_user<>'postgres'
     or public.current_inventory_contract_version()<>2
     or to_regprocedure('public.read_current_operational_memberships(uuid)') is null
     or to_regprocedure('public.save_bottle_inventory_private(uuid,uuid,text,text,integer,text,text,text,text,integer,numeric)') is null
     or exists(select 1 from auth.users)
     or exists(select 1 from public.workspaces)
     or exists(select 1 from public.restaurants)
     or exists(select 1 from public.workspace_memberships)
     or exists(select 1 from public.memberships)
     or exists(select 1 from public.reason_codes)
     or exists(select 1 from public.scan_idempotency)
     or exists(select 1 from public.wines)
     or exists(select 1 from public.wine_lineages)
     or exists(select 1 from public.wine_variants)
     or exists(select 1 from public.wine_aliases)
     or exists(select 1 from public.canonical_wines)
     or exists(select 1 from public.invoice_scans)
     or exists(select 1 from public.inventory_items)
     or exists(select 1 from public.inventory_command_receipts)
     or exists(select 1 from public.identity_merge_log)
     or exists(select 1 from public.reconcile_actions)
     or exists(select 1 from public.reconcile_batches)
     or exists(select 1 from pg_catalog.pg_stat_activity a
       where a.datname=current_database() and a.pid<>pg_backend_pid()) then
    raise exception 'C04_0158_TARGET_NOT_ADMITTED' using errcode='P0001';
  end if;
end;
$target_admission$;
insert into auth.users(id,email) values
  ('15830000-0000-4000-8000-000000000001','c04-0158-race@terroir.test');
select 'C04_0158_AUTO|'||m.restaurant_id::text||'|'||r.workspace_id::text
  from public.memberships m
  join public.restaurants r on r.id=m.restaurant_id
 where m.user_id='15830000-0000-4000-8000-000000000001'
   and m.role='owner';
insert into public.workspaces(id,kind,name) values
  ('15830000-0000-4000-8000-000000000002','restaurant','C04 0158 race');
insert into public.restaurants(id,name,workspace_id) values
  ('15830000-0000-4000-8000-000000000004','C04 0158 race site','15830000-0000-4000-8000-000000000002');
insert into public.workspace_memberships(id,workspace_id,user_id) values
  ('15830000-0000-4000-8000-000000000003','15830000-0000-4000-8000-000000000002','15830000-0000-4000-8000-000000000001');
insert into public.memberships(id,user_id,restaurant_id,role,workspace_membership_id) values
  ('15830000-0000-4000-8000-000000000005','15830000-0000-4000-8000-000000000001','15830000-0000-4000-8000-000000000004','staff','15830000-0000-4000-8000-000000000003');
select set_config('request.jwt.claim.sub','15830000-0000-4000-8000-000000000001',true);
select * from public.claim_scan_idempotency(
  '15830000-0000-4000-8000-000000000004',
  '15830000-0000-4000-8000-000000000006','bottle_inventory_save'
);
commit;
SQL
setup_committed=1

readonly auto_capture="$(grep '^C04_0158_AUTO|' "${proof_tmp}/setup.out" || true)"
if [[ ! "${auto_capture}" =~ ^C04_0158_AUTO\|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$ ]]; then
  echo 'C04_0158_AUTO_OWNERSHIP_CAPTURE_FAILED' >&2
  exit 1
fi
printf '%s\n' "${auto_capture}" >"${proof_tmp}/auto-owned-ids.out"

docker exec -i "${container_id}" env \
  PGAPPNAME='c04_0158_race_winner' \
  PGOPTIONS='-c statement_timeout=15000 -c lock_timeout=8000' \
  psql -U postgres -d "${database_name}" -X -v ON_ERROR_STOP=1 -At \
  >"${proof_tmp}/winner.out" 2>&1 <<'SQL' &
begin;
select set_config('request.jwt.claim.sub','15830000-0000-4000-8000-000000000001',true);
select 'C04_0158_RACE_RECEIPT|'||public.save_bottle_inventory_private(
  '15830000-0000-4000-8000-000000000004','15830000-0000-4000-8000-000000000006',
  'Race Wine','C04 0158 Unique Race Producer',2022,'Pinot Noir','Willamette',null,null,2,15
)::text;
select pg_sleep(5);
commit;
SQL
winner_pid=$!

winner_ready=0
for _ in {1..40}; do
  if [[ "$(docker exec "${container_id}" env PGOPTIONS='-c statement_timeout=10000 -c lock_timeout=5000' \
    psql -U postgres -d "${database_name}" -X -Atc \
    "select count(*) from pg_catalog.pg_stat_activity where datname=current_database() and application_name='c04_0158_race_winner' and state='active' and wait_event_type='Timeout' and query like '%pg_sleep(5)%'")" -eq 1 ]]; then
    winner_ready=1
    break
  fi
  sleep 0.1
done
if [[ "${winner_ready}" -ne 1 ]]; then
  wait "${winner_pid}" || true
  cat "${proof_tmp}/winner.out" >&2
  echo 'C04_0158_RACE_WINNER_HOLDER_NOT_OBSERVED' >&2
  exit 1
fi

if [[ "${race_mode}" == "same-input" ]]; then
  docker exec "${container_id}" env \
    PGAPPNAME='c04_0158_race_waiter' \
    PGOPTIONS='-c statement_timeout=15000 -c lock_timeout=8000' \
    psql -U postgres -d "${database_name}" -X -v ON_ERROR_STOP=1 -At \
    -c "select set_config('request.jwt.claim.sub','15830000-0000-4000-8000-000000000001',false); select 'C04_0158_RACE_RECEIPT|'||public.save_bottle_inventory_private('15830000-0000-4000-8000-000000000004','15830000-0000-4000-8000-000000000006','Race Wine','C04 0158 Unique Race Producer',2022,'Pinot Noir','Willamette',null,null,2,15)::text;" \
    >"${proof_tmp}/waiter.out" 2>&1 &
else
  docker exec "${container_id}" env \
    PGAPPNAME='c04_0158_race_waiter' \
    PGOPTIONS='-c statement_timeout=15000 -c lock_timeout=8000' \
    psql -U postgres -d "${database_name}" -X -v ON_ERROR_STOP=1 -At \
    -c "select set_config('request.jwt.claim.sub','15830000-0000-4000-8000-000000000001',false); select public.save_bottle_inventory_private('15830000-0000-4000-8000-000000000004','15830000-0000-4000-8000-000000000006','Race Wine','C04 0158 Unique Race Producer',2022,'Pinot Noir','Willamette',null,null,3,15);" \
    >"${proof_tmp}/waiter.out" 2>&1 &
fi
waiter_pid=$!

wait_observed=0
for _ in {1..40}; do
  if [[ "$(docker exec "${container_id}" env PGOPTIONS='-c statement_timeout=10000 -c lock_timeout=5000' \
    psql -U postgres -d "${database_name}" -X -Atc \
    "select count(*) from pg_catalog.pg_stat_activity where datname=current_database() and application_name='c04_0158_race_waiter' and wait_event_type='Lock'")" -eq 1 ]]; then
    wait_observed=1
    docker exec "${container_id}" env PGOPTIONS='-c statement_timeout=10000 -c lock_timeout=5000' \
      psql -U postgres -d "${database_name}" -X -Atc \
      "select application_name,state,wait_event_type,wait_event from pg_catalog.pg_stat_activity where datname=current_database() and application_name='c04_0158_race_waiter'" \
      >"${proof_tmp}/lock-observed.out"
    break
  fi
  sleep 0.1
done
if [[ "${wait_observed}" -ne 1 ]]; then
  wait "${winner_pid}" || true
  wait "${waiter_pid}" || true
  cat "${proof_tmp}/waiter.out" >&2
  echo 'C04_0158_RACE_WAITER_LOCK_NOT_OBSERVED' >&2
  exit 1
fi

wait "${winner_pid}"
set +e
wait "${waiter_pid}"
waiter_status=$?
set -e
readonly waiter_status
readonly winner_receipt="$(grep '^C04_0158_RACE_RECEIPT|' "${proof_tmp}/winner.out" || true)"
if [[ -z "${winner_receipt}" \
   || "$(grep -c '^C04_0158_RACE_RECEIPT|' "${proof_tmp}/winner.out" || true)" -ne 1 ]]; then
  cat "${proof_tmp}/winner.out" >&2
  exit 1
fi
if [[ "${race_mode}" == "same-input" ]]; then
  readonly waiter_receipt="$(grep '^C04_0158_RACE_RECEIPT|' "${proof_tmp}/waiter.out" || true)"
  if [[ "${waiter_status}" -ne 0 \
     || -z "${waiter_receipt}" \
     || "$(grep -c '^C04_0158_RACE_RECEIPT|' "${proof_tmp}/waiter.out" || true)" -ne 1 \
     || "${waiter_receipt}" != "${winner_receipt}" ]]; then
    cat "${proof_tmp}/waiter.out" >&2
    exit 1
  fi
elif [[ "${waiter_status}" -eq 0 ]] \
   || ! grep -q C04_BOTTLE_OPERATION_CONFLICT "${proof_tmp}/waiter.out"; then
  cat "${proof_tmp}/waiter.out" >&2
  exit 1
fi

docker exec "${container_id}" env PGOPTIONS='-c statement_timeout=10000 -c lock_timeout=5000' \
  psql -U postgres -d "${database_name}" -X -v ON_ERROR_STOP=1 -Atc \
  "select case when
     (select count(*) from public.inventory_command_receipts where restaurant_id='15830000-0000-4000-8000-000000000004' and operation_id='15830000-0000-4000-8000-000000000006' and command_version=3 and result_payload='{\"status\":\"committed\"}'::jsonb and completed_at is not null)=1
     and (select count(*) from public.inventory_items where restaurant_id='15830000-0000-4000-8000-000000000004')=1
     and (select coalesce(sum(quantity),0) from public.inventory_items where restaurant_id='15830000-0000-4000-8000-000000000004')=2
     and (select count(*) from public.inventory_items where restaurant_id='15830000-0000-4000-8000-000000000004' and quantity=2 and unit_cost=15)=1
     and (select count(*) from public.wines where restaurant_id='15830000-0000-4000-8000-000000000004')=1
     and exists(select 1 from public.scan_idempotency c join public.inventory_command_receipts r on r.restaurant_id=c.restaurant_id and r.operation_id=c.key where c.restaurant_id='15830000-0000-4000-8000-000000000004' and c.key='15830000-0000-4000-8000-000000000006' and c.claimed_by_user_id='15830000-0000-4000-8000-000000000001' and c.response_status=200 and c.response_body=jsonb_build_object('version',1,'kind','bottle_inventory_save','wineId',r.wine_id,'status','committed','itemCount',1))
     then 'C04_0158_SAME_OPERATION_RACE_PASS' else 'C04_0158_SAME_OPERATION_RACE_FAIL' end" \
  | tee "${proof_tmp}/postcheck.out" | grep -qx C04_0158_SAME_OPERATION_RACE_PASS

echo "C04_0158_SAME_OPERATION_RACE_PASS|${race_mode}"
