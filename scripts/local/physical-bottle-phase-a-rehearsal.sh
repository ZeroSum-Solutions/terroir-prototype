#!/usr/bin/env bash
# Future-only C06 Phase A rehearsal. Source review does not authorize running it.
set -euo pipefail

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
repo_root=$(CDPATH= cd -- "$script_dir/../.." && pwd)
container=${C06_REHEARSAL_CONTAINER:?set C06_REHEARSAL_CONTAINER}
source_db=${C06_REHEARSAL_SOURCE_DB:?set an explicit restored source database}
pg_user=${C06_REHEARSAL_PG_USER:-supabase_admin}
confirmation=${C06_REHEARSAL_CONFIRMED:-}
approved_image_ref=${C06_REHEARSAL_IMAGE_REF:?set the exact approved image reference}
approved_image_id=${C06_REHEARSAL_IMAGE_ID:?set the immutable approved image ID}
approved_manifest=${C06_REHEARSAL_SOURCE_MANIFEST:?set the reviewed exact-14 manifest path}
approved_manifest_sha256=${C06_REHEARSAL_SOURCE_MANIFEST_SHA256:?set the reviewed manifest SHA-256}

if [ "$confirmation" != "network-none-disposable-pg17" ]; then
  echo "REFUSING: set C06_REHEARSAL_CONFIRMED=network-none-disposable-pg17" >&2
  exit 2
fi
case "$container" in
  terroir-c06-phase-a-rehearsal-[A-Za-z0-9-]*) ;;
  *) echo "REFUSING: unexpected disposable container name" >&2; exit 2 ;;
esac
case "$source_db" in
  c06_source_[A-Za-z0-9_]*) ;;
  *) echo "REFUSING: source database must use the c06_source_ prefix" >&2; exit 2 ;;
esac

inspect=$(docker inspect --format \
  '{{.HostConfig.NetworkMode}}|{{json .HostConfig.PortBindings}}|{{json .Mounts}}|{{.Config.Image}}|{{.Image}}' \
  "$container")
if [ "$inspect" != "none|{}|[]|$approved_image_ref|$approved_image_id" ]; then
  echo "REFUSING: image reference/ID or network/port/mount identity mismatch" >&2
  exit 2
fi

forward="$repo_root/supabase/migrations/0153_physical_bottle_expansion.sql"
down="$repo_root/supabase/migrations/down/0153_physical_bottle_expansion.down.sql"
preflight="$repo_root/scripts/0153-production-preflight.sql"
assets="$repo_root/supabase/tests/0153_physical_bottle_expansion"
pre_fingerprint="$assets/phase-a-preflight-fingerprint.sql"
state_fingerprint="$assets/phase-a-state-fingerprint.sql"
post_up="$assets/phase-a-post-up-acceptance.sql"
legacy="$assets/phase-a-legacy-compatibility.sql"
acl="$assets/phase-a-acl-rls.sql"
down_acceptance="$assets/phase-a-down-acceptance.sql"
live_test="$repo_root/src/domains/pours/physical-bottle-phase-a-live.test.ts"

source_paths=(
  "docs/plans/2026-08-24-visual-wine-platform-spec-list.md"
  "supabase/migrations/0153_physical_bottle_expansion.sql"
  "supabase/migrations/down/0153_physical_bottle_expansion.down.sql"
  "scripts/0153-production-preflight.sql"
  "scripts/local/physical-bottle-phase-a-rehearsal.sh"
  "supabase/tests/0153_physical_bottle_expansion/README.md"
  "supabase/tests/0153_physical_bottle_expansion/phase-a-preflight-fingerprint.sql"
  "supabase/tests/0153_physical_bottle_expansion/phase-a-post-up-acceptance.sql"
  "supabase/tests/0153_physical_bottle_expansion/phase-a-legacy-compatibility.sql"
  "supabase/tests/0153_physical_bottle_expansion/phase-a-acl-rls.sql"
  "supabase/tests/0153_physical_bottle_expansion/phase-a-state-fingerprint.sql"
  "supabase/tests/0153_physical_bottle_expansion/phase-a-down-acceptance.sql"
  "src/domains/pours/physical-bottle-phase-a-live.test.ts"
  "src/test/contracts/physical-bottle-phase-a-admission-settlement.test.ts"
)

proof_dir=$(mktemp -d "${TMPDIR:-/tmp}/terroir-c06-phase-a.XXXXXX")
chmod 700 "$proof_dir"
if [ "$(shasum -a 256 "$approved_manifest" | awk '{print $1}')" != "$approved_manifest_sha256" ]; then
  echo "REFUSING: approved source manifest hash mismatch" >&2
  exit 2
fi
printf '%s\n' "${source_paths[@]}" | LC_ALL=C sort > "$proof_dir/expected-source-paths.txt"
awk 'NF == 2 { print $2 }' "$approved_manifest" | LC_ALL=C sort \
  > "$proof_dir/approved-source-paths.txt"
if ! diff -u "$proof_dir/expected-source-paths.txt" "$proof_dir/approved-source-paths.txt" \
  > "$proof_dir/approved-source-paths.diff"; then
  echo "REFUSING: approved manifest is not the exact 14-path source set" >&2
  exit 2
fi
while read -r expected_hash relative_path extra; do
  if [ -n "${extra:-}" ] || [ -z "${relative_path:-}" ]; then
    echo "REFUSING: malformed approved manifest line" >&2
    exit 2
  fi
  actual_hash=$(shasum -a 256 "$repo_root/$relative_path" | awk '{print $1}')
  if [ "$actual_hash" != "$expected_hash" ]; then
    echo "REFUSING: source hash mismatch for $relative_path" >&2
    exit 2
  fi
done < "$approved_manifest"
run_id=$$
base_db="c06_phase_a_base_${run_id}"
clean_db="c06_phase_a_clean_${run_id}"

psql_cmd() {
  local database=$1
  shift
  docker exec "$container" psql -X -v ON_ERROR_STOP=1 -U "$pg_user" -d "$database" "$@"
}

psql_file() {
  local database=$1
  local file=$2
  local mode=${3:-plain}
  if [ "$mode" = "single" ]; then
    docker exec -i "$container" psql -X -v ON_ERROR_STOP=1 -1 \
      -U "$pg_user" -d "$database" < "$file"
  else
    docker exec -i "$container" psql -X -v ON_ERROR_STOP=1 \
      -U "$pg_user" -d "$database" < "$file"
  fi
}

capture_pre0153_receipt() {
  local database=$1
  local label=$2
  psql_cmd "$database" -Atc \
    "select encode(convert_to(request_payload::text,'UTF8'),'hex')||E'\t'||encode(convert_to(result_payload::text,'UTF8'),'hex') from public.inventory_command_receipts where restaurant_id='$pre0153_restaurant'::uuid and operation_id='$pre0153_operation'::uuid" \
    > "$proof_dir/pre0153-receipt-${label}.txt"
  test "$(wc -l < "$proof_dir/pre0153-receipt-${label}.txt" | tr -d ' ')" = "1"
}

replay_pre0153_receipt() {
  local database=$1
  local label=$2
  psql_cmd "$database" -Atc \
    "select set_config('request.jwt.claim.sub','$pre0153_user',false); select set_config('request.jwt.claim.role','authenticated',false); select (public.execute_inventory_command('$pre0153_operation'::uuid,'$pre0153_restaurant'::uuid,'open','$pre0153_wine'::uuid,null,'C06 pre-0153 receipt','none',null,null,null,0,null)-'replayed') is not distinct from (select result_payload from public.inventory_command_receipts where restaurant_id='$pre0153_restaurant'::uuid and operation_id='$pre0153_operation'::uuid)" \
    > "$proof_dir/pre0153-replay-${label}.txt"
  test "$(tail -n 1 "$proof_dir/pre0153-replay-${label}.txt")" = "t"
}

# C06_HOLDER_SETTLEMENT_BEGIN
c06_owned_count=0
c06_owned_local_pids=()
c06_owned_databases=()
c06_owned_applications=()
c06_owned_backends=()
c06_owned_evidence_prefixes=()
c06_owned_states=()
c06_owned_wait_exits=()
c06_owned_evidence_states=()
c06_settlement_receipt_written=0
c06_evidence_receipt_written=0
c06_registered_index=
c06_child_initial_wait_attempts=100
c06_child_term_wait_attempts=50
c06_child_kill_wait_attempts=50
c06_child_wait_delay=0.1

c06_record_owned_event() {
  local identity=$1
  local event=$2
  printf '%s\t%s\n' "$identity" "$event" >> "$proof_dir/owned-process-events.tsv"
}

c06_write_owned_registry() {
  local temporary="$proof_dir/owned-processes.tsv.tmp"
  local index
  {
    printf 'index\tlocal_pid\tdatabase\tapplication_name\tbackend_pid\tevidence_prefix\tstate\twait_exit\tevidence_state\n'
    index=0
    while [ "$index" -lt "$c06_owned_count" ]; do
      printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' \
        "$index" \
        "${c06_owned_local_pids[$index]}" \
        "${c06_owned_databases[$index]}" \
        "${c06_owned_applications[$index]}" \
        "${c06_owned_backends[$index]}" \
        "${c06_owned_evidence_prefixes[$index]}" \
        "${c06_owned_states[$index]}" \
        "${c06_owned_wait_exits[$index]}" \
        "${c06_owned_evidence_states[$index]}"
      index=$((index + 1))
    done
  } > "$temporary"
  mv "$temporary" "$proof_dir/owned-processes.tsv"
}

c06_register_owned_process() {
  local local_pid=$1
  local database=$2
  local application_name=$3
  local evidence_prefix=$4
  local index=$c06_owned_count
  case "$local_pid" in
    ''|*[!0-9]*) echo "FAIL: invalid owned local PID" >&2; return 1 ;;
  esac
  c06_owned_local_pids[$index]=$local_pid
  c06_owned_databases[$index]=$database
  c06_owned_applications[$index]=$application_name
  c06_owned_backends[$index]=
  c06_owned_evidence_prefixes[$index]=$evidence_prefix
  c06_owned_states[$index]=registered
  c06_owned_wait_exits[$index]=pending
  c06_owned_evidence_states[$index]=pending
  c06_owned_count=$((c06_owned_count + 1))
  c06_registered_index=$index
  c06_write_owned_registry
  c06_record_owned_event "$application_name" registered
}

c06_set_owned_backend() {
  local index=$1
  local backend_pid=$2
  case "$backend_pid" in
    ''|*[!0-9]*) echo "FAIL: invalid owned backend PID" >&2; return 1 ;;
  esac
  c06_owned_backends[$index]=$backend_pid
  c06_write_owned_registry
}

wait_for_session() {
  local database=$1
  local application_name=$2
  local attempt
  local backend_rows
  for attempt in $(seq 1 100); do
    if backend_rows=$(psql_cmd "$database" -Atc \
      "select pid::text from pg_catalog.pg_stat_activity where datname=current_database() and application_name='$application_name' and state='active' order by pid"); then
      case "$backend_rows" in
        '') ;;
        *$'\n'*)
          echo "FAIL: multiple controlled sessions became ready: $application_name" >&2
          return 1
          ;;
        *[!0-9]*)
          echo "FAIL: invalid controlled backend PID: $application_name" >&2
          return 1
          ;;
        *)
          printf '%s\n' "$backend_rows"
          return 0
          ;;
      esac
    fi
    sleep 0.1
  done
  echo "FAIL: controlled session did not become ready: $application_name" >&2
  return 1
}

c06_resolve_owned_backend() {
  local index=$1
  local database=${c06_owned_databases[$index]}
  local application_name=${c06_owned_applications[$index]}
  local backend_rows
  if [ -n "${c06_owned_backends[$index]}" ]; then
    return 0
  fi
  if ! backend_rows=$(psql_cmd "$database" -Atc \
    "select pid::text from pg_catalog.pg_stat_activity where datname=current_database() and application_name='$application_name' order by pid"); then
    return 1
  fi
  case "$backend_rows" in
    '') return 3 ;;
    *$'\n'*)
      echo "FAIL: refusing to choose among multiple exact owned sessions: $application_name" >&2
      return 4
      ;;
    *[!0-9]*)
      echo "FAIL: invalid owned backend PID: $application_name" >&2
      return 4
      ;;
    *) c06_set_owned_backend "$index" "$backend_rows" ;;
  esac
}

terminate_named_session() {
  local database=$1
  local application_name=$2
  local backend_pid=$3
  local terminated
  case "$backend_pid" in
    ''|*[!0-9]*) return 1 ;;
  esac
  terminated=$(psql_cmd "$database" -Atc \
    "select coalesce(bool_and(pg_catalog.pg_terminate_backend(pid)), true) from pg_catalog.pg_stat_activity where datname=current_database() and application_name='$application_name' and pid=$backend_pid") || return 1
  [ "$terminated" = "t" ]
}

c06_wait_for_local_child_exit() {
  local local_pid=$1
  local attempts=$2
  local attempt
  attempt=0
  while [ "$attempt" -lt "$attempts" ]; do
    if ! kill -0 "$local_pid" 2>/dev/null; then
      return 0
    fi
    sleep "$c06_child_wait_delay"
    attempt=$((attempt + 1))
  done
  ! kill -0 "$local_pid" 2>/dev/null
}

c06_wait_owned_local_child() {
  local index=$1
  local local_pid=${c06_owned_local_pids[$index]}
  local application_name=${c06_owned_applications[$index]}
  local wait_exit
  if ! c06_wait_for_local_child_exit \
    "$local_pid" "$c06_child_initial_wait_attempts"; then
    c06_record_owned_event "$application_name" local-child-term-requested
    kill -TERM "$local_pid" 2>/dev/null || true
    if ! c06_wait_for_local_child_exit \
      "$local_pid" "$c06_child_term_wait_attempts"; then
      c06_record_owned_event "$application_name" local-child-kill-requested
      kill -KILL "$local_pid" 2>/dev/null || true
      if ! c06_wait_for_local_child_exit \
        "$local_pid" "$c06_child_kill_wait_attempts"; then
        c06_owned_wait_exits[$index]=124
        c06_record_owned_event "$application_name" local-child-still-running
        c06_write_owned_registry
        return 1
      fi
    fi
  fi
  if wait "$local_pid"; then
    wait_exit=0
  else
    wait_exit=$?
  fi
  c06_owned_wait_exits[$index]=$wait_exit
  c06_record_owned_event "$application_name" local-child-waited
  c06_write_owned_registry
  return 0
}

c06_assert_owned_session_absent() {
  local index=$1
  local database=${c06_owned_databases[$index]}
  local application_name=${c06_owned_applications[$index]}
  local session_count
  session_count=$(psql_cmd "$database" -Atc \
    "select count(*) from pg_catalog.pg_stat_activity where datname=current_database() and application_name='$application_name'") || return 1
  if [ "$session_count" != "0" ]; then
    echo "FAIL: owned session remains active: $application_name" >&2
    return 1
  fi
  c06_record_owned_event "$application_name" zero-sessions
}

c06_settle_owned_process() {
  local index=$1
  local application_name=${c06_owned_applications[$index]}
  local resolve_exit=0
  local terminate_exit=0
  local local_child_exit=0
  local absent_exit=0
  if [ "${c06_owned_states[$index]}" = "settled" ]; then
    return 0
  fi

  if c06_resolve_owned_backend "$index"; then
    c06_record_owned_event "$application_name" termination-requested
    if ! terminate_named_session \
      "${c06_owned_databases[$index]}" \
      "$application_name" \
      "${c06_owned_backends[$index]}"; then
      terminate_exit=1
    fi
  else
    resolve_exit=$?
    if [ "$resolve_exit" -eq 3 ]; then
      resolve_exit=0
    fi
  fi

  if ! c06_wait_owned_local_child "$index"; then
    local_child_exit=1
  fi
  if ! c06_assert_owned_session_absent "$index"; then
    absent_exit=1
  fi
  if [ "$resolve_exit" -eq 0 ] && [ "$terminate_exit" -eq 0 ] \
    && [ "$local_child_exit" -eq 0 ] && [ "$absent_exit" -eq 0 ]; then
    c06_owned_states[$index]=settled
    c06_write_owned_registry
    return 0
  fi
  c06_owned_states[$index]=settlement_failed
  c06_write_owned_registry
  return 1
}

c06_mark_owned_evidence() {
  local index=$1
  local evidence_state=$2
  case "$evidence_state" in
    ready|failed) ;;
    *) return 1 ;;
  esac
  c06_owned_evidence_states[$index]=$evidence_state
  c06_write_owned_registry
}

c06_settle_all_owned_processes() {
  local index=0
  local settlement_exit=0
  local all_evidence_ready=1
  local temporary
  while [ "$index" -lt "$c06_owned_count" ]; do
    if ! c06_settle_owned_process "$index"; then
      settlement_exit=1
    fi
    if [ "${c06_owned_evidence_states[$index]}" != "ready" ]; then
      all_evidence_ready=0
    fi
    index=$((index + 1))
  done
  c06_write_owned_registry

  if [ "$settlement_exit" -eq 0 ] && [ "$c06_settlement_receipt_written" -eq 0 ]; then
    temporary="$proof_dir/owned-processes-settled.txt.tmp"
    printf 'COUNT=%s\n' "$c06_owned_count" > "$temporary"
    mv "$temporary" "$proof_dir/owned-processes-settled.txt"
    c06_settlement_receipt_written=1
    c06_record_owned_event finalizer settlement-complete
  fi
  if [ "$settlement_exit" -eq 0 ] && [ "$all_evidence_ready" -eq 1 ] && [ "$c06_evidence_receipt_written" -eq 0 ]; then
    temporary="$proof_dir/owned-process-evidence-ready.txt.tmp"
    printf 'COUNT=%s\n' "$c06_owned_count" > "$temporary"
    mv "$temporary" "$proof_dir/owned-process-evidence-ready.txt"
    c06_evidence_receipt_written=1
    c06_record_owned_event finalizer evidence-ready
  fi
  return "$settlement_exit"
}

c06_finalize_owned_processes() {
  local original_exit=$?
  local settlement_exit
  trap - EXIT INT TERM
  set +e
  c06_settle_all_owned_processes
  settlement_exit=$?
  if [ "$original_exit" -eq 0 ] && [ "$settlement_exit" -ne 0 ]; then
    original_exit=$settlement_exit
  fi
  exit "$original_exit"
}

run_lock_refusal() {
  local database=$1
  local direction=$2
  local table_name=$3
  local fingerprint_file=$4
  local migration_file=$5
  local transaction_mode=$6
  local app="c06_${direction}_${table_name}_${run_id}"
  local holder_pid
  local holder_index
  local holder_backend
  local migration_exit
  local sqlstate_exit
  local settlement_exit
  local evidence_exit=0

  psql_file "$database" "$fingerprint_file" > "$proof_dir/${app}-before.txt"
  docker exec "$container" psql -X -v ON_ERROR_STOP=1 -U "$pg_user" -d "$database" \
    -c "set application_name='$app'; begin; lock table public.$table_name in row exclusive mode; select pg_sleep(60); rollback" \
    > "$proof_dir/${app}-holder.txt" 2>&1 &
  holder_pid=$!
  c06_register_owned_process "$holder_pid" "$database" "$app" "$app"
  holder_index=$c06_registered_index
  if holder_backend=$(wait_for_session "$database" "$app"); then
    c06_set_owned_backend "$holder_index" "$holder_backend"
  else
    c06_record_owned_event "$app" readiness-failed
    c06_mark_owned_evidence "$holder_index" failed
    c06_settle_owned_process "$holder_index" || true
    return 1
  fi

  if [ "$transaction_mode" = "single" ]; then
    if docker exec -i "$container" psql -X -v ON_ERROR_STOP=1 -v VERBOSITY=verbose -1 \
      -U "$pg_user" -d "$database" < "$migration_file" \
      > "$proof_dir/${app}-migration.txt" 2>&1; then
      migration_exit=0
    else
      migration_exit=$?
    fi
  else
    if docker exec -i "$container" psql -X -v ON_ERROR_STOP=1 -v VERBOSITY=verbose \
      -U "$pg_user" -d "$database" < "$migration_file" \
      > "$proof_dir/${app}-migration.txt" 2>&1; then
      migration_exit=0
    else
      migration_exit=$?
    fi
  fi
  if [ "$migration_exit" -eq 0 ]; then
    c06_record_owned_event "$app" migration-succeeded
  else
    c06_record_owned_event "$app" migration-failed
  fi
  if [ "$migration_exit" -ne 0 ] && grep -q '55P03' "$proof_dir/${app}-migration.txt"; then
    sqlstate_exit=0
    c06_record_owned_event "$app" sqlstate-verified
  else
    sqlstate_exit=1
    c06_record_owned_event "$app" sqlstate-failed
  fi

  if c06_settle_owned_process "$holder_index"; then
    settlement_exit=0
  else
    settlement_exit=$?
  fi
  if [ "$settlement_exit" -eq 0 ]; then
    if psql_file "$database" "$fingerprint_file" > "$proof_dir/${app}-after.txt"; then
      c06_record_owned_event "$app" after-fingerprint
    else
      evidence_exit=1
    fi
    if [ "$evidence_exit" -eq 0 ] && diff -u \
      "$proof_dir/${app}-before.txt" "$proof_dir/${app}-after.txt" \
      > "$proof_dir/${app}.diff"; then
      c06_record_owned_event "$app" fingerprint-diff
      c06_mark_owned_evidence "$holder_index" ready
    else
      evidence_exit=1
      c06_record_owned_event "$app" fingerprint-diff-failed
      c06_mark_owned_evidence "$holder_index" failed
    fi
  else
    evidence_exit=1
    c06_mark_owned_evidence "$holder_index" failed
  fi

  if [ "$migration_exit" -eq 0 ]; then
    echo "FAIL: $direction unexpectedly accepted lock on $table_name" >&2
    return 1
  fi
  if [ "$sqlstate_exit" -ne 0 ]; then
    echo "FAIL: $direction lock refusal on $table_name did not report 55P03" >&2
    return 1
  fi
  if [ "$settlement_exit" -ne 0 ] || [ "$evidence_exit" -ne 0 ]; then
    return 1
  fi
  return 0
}
# C06_HOLDER_SETTLEMENT_END

trap c06_finalize_owned_processes EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

max_version=$(psql_cmd "$source_db" -Atc \
  "select coalesce(max(version),'') from supabase_migrations.schema_migrations")
if [ "$max_version" != "0152" ]; then
  echo "REFUSING: source max migration is '$max_version', expected 0152" >&2
  exit 2
fi
if [ "$(psql_cmd "$source_db" -Atc "select to_regclass('public.inventory_command_bottle_effects') is null")" != "t" ]; then
  echo "REFUSING: source already contains 0153 objects" >&2
  exit 2
fi
if [ "$(psql_cmd "$source_db" -Atc "select count(*) from public.inventory_items")" -lt 1 ]; then
  echo "REFUSING: stale-preflight proof requires one inventory item" >&2
  exit 2
fi

psql_cmd "$source_db" -Atc \
  "select current_user||E'\t'||session_user||E'\t'||rolsuper||E'\t'||rolbypassrls from pg_catalog.pg_roles where rolname=current_user" \
  > "$proof_dir/executor-role.txt"
psql_file "$source_db" "$preflight" > "$proof_dir/operator-preflight.txt"
grep -q 'C06_PRODUCTION_PREFLIGHT_PASS' "$proof_dir/operator-preflight.txt"

for table_name in \
  inventory_items open_bottles pour_events bottle_closeouts inventory_command_receipts
do
  run_lock_refusal "$source_db" forward "$table_name" \
    "$pre_fingerprint" "$forward" single
done

# Deterministic stale-preflight prevention: A holds all five migration locks;
# B starts only after A is visible and must wait on an affected-table write.
fixture_item=$(psql_cmd "$source_db" -Atc \
  "select id from public.inventory_items order by id limit 1")
lock_app="c06_all_forward_locks_${run_id}"
writer_app="c06_blocked_writer_${run_id}"
docker exec "$container" psql -X -v ON_ERROR_STOP=1 -U "$pg_user" -d "$source_db" \
  -c "set application_name='$lock_app'; begin; lock table public.inventory_items in access exclusive mode nowait; lock table public.open_bottles in access exclusive mode nowait; lock table public.pour_events in access exclusive mode nowait; lock table public.bottle_closeouts in access exclusive mode nowait; lock table public.inventory_command_receipts in access exclusive mode nowait; select count(*) from public.bottle_closeouts; select pg_sleep(60); rollback" \
  > "$proof_dir/stale-preflight-holder.txt" 2>&1 &
lock_pid=$!
c06_register_owned_process "$lock_pid" "$source_db" "$lock_app" stale-preflight-holder
lock_index=$c06_registered_index
lock_backend=$(wait_for_session "$source_db" "$lock_app")
c06_set_owned_backend "$lock_index" "$lock_backend"
docker exec "$container" psql -X -v ON_ERROR_STOP=1 -U "$pg_user" -d "$source_db" \
  -c "set application_name='$writer_app'; begin; update public.inventory_items set quantity=quantity where id='$fixture_item'::uuid; rollback" \
  > "$proof_dir/stale-preflight-writer.txt" 2>&1 &
writer_pid=$!
c06_register_owned_process "$writer_pid" "$source_db" "$writer_app" stale-preflight-writer
writer_index=$c06_registered_index
writer_backend=$(wait_for_session "$source_db" "$writer_app")
c06_set_owned_backend "$writer_index" "$writer_backend"
for attempt in $(seq 1 100); do
  writer_wait=$(psql_cmd "$source_db" -Atc \
    "select count(*) from pg_catalog.pg_stat_activity where datname=current_database() and application_name='$writer_app' and wait_event_type='Lock'")
  [ "$writer_wait" = "1" ] && break
  sleep 0.1
done
test "${writer_wait:-0}" = "1"
c06_settle_owned_process "$lock_index"
c06_settle_owned_process "$writer_index"
c06_mark_owned_evidence "$lock_index" ready
c06_mark_owned_evidence "$writer_index" ready

# The source database remains a read-only template. Drain only this verified
# disposable source database before copying it; never touch another database.
psql_cmd "$source_db" -Atc \
  "select pg_catalog.pg_terminate_backend(pid) from pg_catalog.pg_stat_activity where datname=current_database() and pid<>pg_catalog.pg_backend_pid()" \
  > "$proof_dir/source-session-drain.txt"

run_forward_catalog_refusal() {
  local fixture=$1
  local expected_error=$2
  local database="c06_forward_${fixture}_${run_id}"
  docker exec "$container" createdb -U "$pg_user" -T "$source_db" "$database"
  case "$fixture" in
    constraint_collision)
      psql_cmd "$database" -c \
        "alter table public.open_bottles add constraint open_bottles_identity_contract_check check(remaining_ml>=0) not valid" \
        > "$proof_dir/forward-${fixture}-setup.txt" ;;
    index_wrong_kind)
      psql_cmd "$database" -c \
        "create sequence public.pour_events_open_bottle_tenant_wine_idx" \
        > "$proof_dir/forward-${fixture}-setup.txt" ;;
    constraint)
      psql_cmd "$database" -c \
        "alter table public.open_bottles drop constraint open_bottles_source_inventory_item_id_fkey" \
        > "$proof_dir/forward-${fixture}-setup.txt" ;;
    function)
      psql_cmd "$database" -c \
        "create or replace function public.reconcile_open_bottles_batch(p_entries jsonb) returns int language plpgsql security definer set search_path=public as 'begin return 0; end;'" \
        > "$proof_dir/forward-${fixture}-setup.txt" ;;
    function_extra_guc)
      psql_cmd "$database" -c \
        "alter function public.reconcile_open_bottles_batch(jsonb) set statement_timeout='1ms'" \
        > "$proof_dir/forward-${fixture}-setup.txt" ;;
    deferrable_unique)
      psql_cmd "$database" -c \
        "alter table public.open_bottles drop constraint open_bottles_wine_id_restaurant_id_key; alter table public.open_bottles add constraint open_bottles_wine_id_restaurant_id_key unique(wine_id,restaurant_id) deferrable initially immediate" \
        > "$proof_dir/forward-${fixture}-setup.txt" ;;
    trigger)
      psql_cmd "$database" -c \
        "alter table public.pour_events disable trigger pour_events_trigger" \
        > "$proof_dir/forward-${fixture}-setup.txt" ;;
    source_lot)
      psql_cmd "$database" -c \
        "with r as (insert into public.restaurants(name) values ('C06 source-lot drift') returning id), w1 as (insert into public.wines(restaurant_id,name,producer,size_ml) select id,'C06 lot one','C06',750 from r returning id,restaurant_id), w2 as (insert into public.wines(restaurant_id,name,producer,size_ml) select id,'C06 lot two','C06',750 from r returning id,restaurant_id), i as (insert into public.inventory_items(wine_id,restaurant_id,quantity,unit_cost) select id,restaurant_id,1,10 from w1 returning id) insert into public.open_bottles(wine_id,restaurant_id,remaining_ml,source_inventory_item_id) select w2.id,w2.restaurant_id,750,i.id from w2 cross join i" \
        > "$proof_dir/forward-${fixture}-setup.txt" ;;
    *) echo "unknown forward catalog fixture: $fixture" >&2; exit 2 ;;
  esac
  case "$fixture" in
    constraint_collision|index_wrong_kind)
      if psql_file "$database" "$preflight" \
        > "$proof_dir/forward-${fixture}-preflight.txt" 2>&1; then
        echo "FAIL: preflight unexpectedly accepted $fixture" >&2
        exit 1
      fi
      grep -q "$expected_error" "$proof_dir/forward-${fixture}-preflight.txt"
      ;;
  esac
  psql_file "$database" "$pre_fingerprint" > "$proof_dir/forward-${fixture}-before.txt"
  if docker exec -i "$container" psql -X -v ON_ERROR_STOP=1 -v VERBOSITY=verbose -1 \
    -U "$pg_user" -d "$database" < "$forward" \
    > "$proof_dir/forward-${fixture}-migration.txt" 2>&1; then
    echo "FAIL: forward unexpectedly accepted $fixture drift" >&2
    exit 1
  fi
  grep -q "$expected_error" "$proof_dir/forward-${fixture}-migration.txt"
  psql_file "$database" "$pre_fingerprint" > "$proof_dir/forward-${fixture}-after.txt"
  diff -u "$proof_dir/forward-${fixture}-before.txt" \
    "$proof_dir/forward-${fixture}-after.txt" > "$proof_dir/forward-${fixture}.diff"
}

run_forward_catalog_refusal constraint_collision C06_0153_PARTIAL_STATE
run_forward_catalog_refusal index_wrong_kind C06_0153_PARTIAL_STATE
run_forward_catalog_refusal constraint C06_LEGACY_CATALOG_MISMATCH
run_forward_catalog_refusal function C06_LEGACY_FUNCTION_MISMATCH
run_forward_catalog_refusal function_extra_guc C06_LEGACY_FUNCTION_MISMATCH
run_forward_catalog_refusal deferrable_unique C06_LEGACY_CATALOG_MISMATCH
run_forward_catalog_refusal trigger C06_LEGACY_TRIGGER_MISMATCH
run_forward_catalog_refusal source_lot C06_SOURCE_LOT_CONTAINMENT_MISMATCH

docker exec "$container" createdb -U "$pg_user" -T "$source_db" "$base_db"

# Create a completed version-1 receipt before 0153. Its request/result bytes and
# replay behavior are checked after up, down, and re-up.
pre0153_restaurant=$(psql_cmd "$base_db" -qAtc \
  "insert into public.restaurants(name) values ('C06 pre-0153 receipt') returning id")
pre0153_user=$(psql_cmd "$base_db" -qAtc \
  "insert into auth.users(id,email) values (gen_random_uuid(),'c06-pre0153-${run_id}@terroir.test') returning id")
pre0153_wine=$(psql_cmd "$base_db" -qAtc \
  "insert into public.wines(restaurant_id,name,producer,size_ml) values ('$pre0153_restaurant'::uuid,'C06 pre-0153 receipt','C06',750) returning id")
pre0153_operation=$(psql_cmd "$base_db" -Atc "select gen_random_uuid()")
psql_cmd "$base_db" -c \
  "insert into public.memberships(user_id,restaurant_id,role) values ('$pre0153_user'::uuid,'$pre0153_restaurant'::uuid,'owner') on conflict (user_id,restaurant_id) do update set role=excluded.role; insert into public.inventory_items(wine_id,restaurant_id,quantity,unit_cost) values ('$pre0153_wine'::uuid,'$pre0153_restaurant'::uuid,1,10); select set_config('request.jwt.claim.sub','$pre0153_user',false); select set_config('request.jwt.claim.role','authenticated',false); select public.execute_inventory_command('$pre0153_operation'::uuid,'$pre0153_restaurant'::uuid,'open','$pre0153_wine'::uuid,null,'C06 pre-0153 receipt','none',null,null,null,0,null)" \
  > "$proof_dir/pre0153-seed.txt"
capture_pre0153_receipt "$base_db" before

# A default-only contract-1 fixture makes safe-down and refusal cases
# independent of whatever open-bottle rows happened to exist in the backup.
fixture_restaurant=$(psql_cmd "$base_db" -qAtc \
  "insert into public.restaurants(name) values ('C06 Phase A fixture') returning id")
fixture_wine=$(psql_cmd "$base_db" -qAtc \
  "insert into public.wines(restaurant_id,name,producer,size_ml) values ('$fixture_restaurant'::uuid,'C06 Phase A fixture','C06',750) returning id")
fixture_bottle=$(psql_cmd "$base_db" -qAtc \
  "insert into public.open_bottles(restaurant_id,wine_id,remaining_ml) values ('$fixture_restaurant'::uuid,'$fixture_wine'::uuid,750) returning id")
fixture_user=$(psql_cmd "$base_db" -qAtc \
  "insert into auth.users(id,email) values (gen_random_uuid(),'c06-rehearsal-${run_id}@terroir.test') returning id")
psql_cmd "$base_db" -c \
  "insert into public.memberships(user_id,restaurant_id,role) values ('$fixture_user'::uuid,'$fixture_restaurant'::uuid,'owner') on conflict (user_id,restaurant_id) do update set role=excluded.role" \
  > "$proof_dir/default-fixture.txt"

psql_file "$base_db" "$pre_fingerprint" > "$proof_dir/safe-cycle-pre-up.txt"
psql_file "$base_db" "$forward" single > "$proof_dir/forward.txt"
psql_file "$base_db" "$preflight" > "$proof_dir/operator-preflight-post-up.txt"
grep -q 'C06_PRODUCTION_PREFLIGHT_PASS' "$proof_dir/operator-preflight-post-up.txt"
replay_pre0153_receipt "$base_db" after-up
capture_pre0153_receipt "$base_db" after-up
diff -u "$proof_dir/pre0153-receipt-before.txt" \
  "$proof_dir/pre0153-receipt-after-up.txt" > "$proof_dir/pre0153-after-up.diff"

psql_file "$base_db" "$post_up" > "$proof_dir/post-up.txt"
psql_file "$base_db" "$legacy" > "$proof_dir/legacy.txt"
psql_file "$base_db" "$acl" > "$proof_dir/acl.txt"
grep -q 'C06_PHASE_A_POST_UP_ACCEPTANCE_PASS' "$proof_dir/post-up.txt"
grep -q 'C06_PHASE_A_LEGACY_COMPATIBILITY_PASS' "$proof_dir/legacy.txt"
grep -q 'C06_PHASE_A_ACL_RLS_PASS' "$proof_dir/acl.txt"
psql_file "$base_db" "$state_fingerprint" > "$proof_dir/safe-cycle-post-up.txt"

for table_name in \
  inventory_items open_bottles pour_events bottle_closeouts \
  inventory_command_receipts inventory_command_bottle_effects
do
  run_lock_refusal "$base_db" down "$table_name" \
    "$state_fingerprint" "$down" plain
done

apply_unsafe_fixture() {
  local database=$1
  local fixture=$2
  local operation_id
  local seal
  operation_id=$(psql_cmd "$database" -Atc "select gen_random_uuid()")
  case "$fixture" in
    state_version)
      psql_cmd "$database" -c \
        "update public.open_bottles set state_version=1 where id='$fixture_bottle'::uuid" >/dev/null ;;
    identity_origin)
      psql_cmd "$database" -c \
        "update public.open_bottles set identity_origin='migrated_active' where id='$fixture_bottle'::uuid" >/dev/null ;;
    nominal_capacity)
      psql_cmd "$database" -c \
        "update public.open_bottles set nominal_capacity_ml=750 where id='$fixture_bottle'::uuid" >/dev/null ;;
    source_provenance)
      psql_cmd "$database" -c \
        "update public.open_bottles set source_provenance='known' where id='$fixture_bottle'::uuid" >/dev/null ;;
    opening_operation)
      psql_cmd "$database" -c \
        "update public.open_bottles set opening_operation_id='$operation_id'::uuid where id='$fixture_bottle'::uuid" >/dev/null ;;
    physical_bottle)
      psql_cmd "$database" -c \
        "update public.open_bottles set identity_contract=2,identity_origin='migrated_active',nominal_capacity_ml=750 where id='$fixture_bottle'::uuid" >/dev/null ;;
    version2_receipt)
      psql_cmd "$database" -c \
        "insert into public.inventory_command_receipts(restaurant_id,operation_id,actor_user_id,wine_id,command_type,request_payload,result_payload,completed_at,command_version,scope_kind) values ('$fixture_restaurant'::uuid,'$operation_id'::uuid,'$fixture_user'::uuid,'$fixture_wine'::uuid,'open','{}','{}',now(),2,'single_wine')" >/dev/null ;;
    batch_receipt)
      psql_cmd "$database" -c \
        "insert into public.inventory_command_receipts(restaurant_id,operation_id,actor_user_id,wine_id,command_type,request_payload,result_payload,completed_at,command_version,scope_kind,batch_entry_count) values ('$fixture_restaurant'::uuid,'$operation_id'::uuid,'$fixture_user'::uuid,null,'reconcile_batch','{}','{}',now(),2,'exact_bottle_batch',1)" >/dev/null ;;
    version2_event)
      psql_cmd "$database" -c \
        "insert into public.inventory_command_receipts(restaurant_id,operation_id,actor_user_id,wine_id,command_type,request_payload,result_payload,completed_at,command_version,scope_kind) values ('$fixture_restaurant'::uuid,'$operation_id'::uuid,'$fixture_user'::uuid,'$fixture_wine'::uuid,'pour','{}','{}',now(),2,'single_wine'); insert into public.pour_events(wine_id,restaurant_id,open_bottle_id,ml_delta,kind,actor_user_id,event_contract,operation_id,operation_entry_ordinal) values ('$fixture_wine'::uuid,'$fixture_restaurant'::uuid,'$fixture_bottle'::uuid,1,'pour','$fixture_user'::uuid,2,'$operation_id'::uuid,0)" >/dev/null ;;
    version2_closeout)
      psql_cmd "$database" -c \
        "insert into public.bottle_closeouts(restaurant_id,wine_id,open_bottle_id,preservation_method,opened_at,closed_by,theoretical_remaining_ml,actual_remaining_ml,event_contract) select restaurant_id,wine_id,id,preservation_method,opened_at,'$fixture_user'::uuid,remaining_ml,remaining_ml,2 from public.open_bottles where id='$fixture_bottle'::uuid" >/dev/null ;;
    reversal_event)
      original_operation=$(psql_cmd "$database" -Atc "select gen_random_uuid()")
      original_event=$(psql_cmd "$database" -Atc "select gen_random_uuid()")
      psql_cmd "$database" -c \
        "insert into public.inventory_command_receipts(restaurant_id,operation_id,actor_user_id,wine_id,command_type,request_payload,result_payload,completed_at,command_version,scope_kind) values ('$fixture_restaurant'::uuid,'$original_operation'::uuid,'$fixture_user'::uuid,'$fixture_wine'::uuid,'pour','{}','{}',now(),2,'single_wine'),('$fixture_restaurant'::uuid,'$operation_id'::uuid,'$fixture_user'::uuid,'$fixture_wine'::uuid,'undo','{}','{}',now(),2,'single_wine'); insert into public.pour_events(id,wine_id,restaurant_id,open_bottle_id,ml_delta,kind,actor_user_id,event_contract,operation_id,operation_entry_ordinal) values ('$original_event'::uuid,'$fixture_wine'::uuid,'$fixture_restaurant'::uuid,'$fixture_bottle'::uuid,1,'pour','$fixture_user'::uuid,2,'$original_operation'::uuid,0); insert into public.pour_events(wine_id,restaurant_id,open_bottle_id,ml_delta,kind,actor_user_id,event_contract,operation_id,operation_entry_ordinal,reversal_of_event_id) values ('$fixture_wine'::uuid,'$fixture_restaurant'::uuid,'$fixture_bottle'::uuid,-1,'undo','$fixture_user'::uuid,2,'$operation_id'::uuid,0,'$original_event'::uuid)" >/dev/null ;;
    effect)
      psql_cmd "$database" -c \
        "insert into public.inventory_command_receipts(restaurant_id,operation_id,actor_user_id,wine_id,command_type,request_payload,result_payload,completed_at,command_version,scope_kind) values ('$fixture_restaurant'::uuid,'$operation_id'::uuid,'$fixture_user'::uuid,'$fixture_wine'::uuid,'pour','{}','{}',now(),2,'single_wine'); insert into public.inventory_command_bottle_effects(restaurant_id,operation_id,entry_ordinal,open_bottle_id,wine_id,effect_type) values ('$fixture_restaurant'::uuid,'$operation_id'::uuid,0,'$fixture_bottle'::uuid,'$fixture_wine'::uuid,'pour')" >/dev/null ;;
    duplicate_slot)
      psql_cmd "$database" -c \
        "alter table public.open_bottles drop constraint open_bottles_wine_id_restaurant_id_key; insert into public.open_bottles(restaurant_id,wine_id,remaining_ml) values ('$fixture_restaurant'::uuid,'$fixture_wine'::uuid,750)" >/dev/null ;;
    invalid_legacy_command_type)
      psql_cmd "$database" -c \
        "alter table public.inventory_command_receipts drop constraint inventory_command_receipts_versioned_shape_check; alter table public.inventory_command_receipts drop constraint inventory_command_receipts_command_type_check; update public.inventory_command_receipts set command_type='reconcile_batch' where restaurant_id='$pre0153_restaurant'::uuid and operation_id='$pre0153_operation'::uuid" >/dev/null ;;
    legacy_unique_missing)
      psql_cmd "$database" -c \
        "alter table public.open_bottles drop constraint open_bottles_wine_id_restaurant_id_key" >/dev/null ;;
    legacy_unique_deferrable)
      psql_cmd "$database" -c \
        "alter table public.open_bottles drop constraint open_bottles_wine_id_restaurant_id_key; alter table public.open_bottles add constraint open_bottles_wine_id_restaurant_id_key unique(wine_id,restaurant_id) deferrable initially immediate" >/dev/null ;;
    legacy_constraint_drift)
      psql_cmd "$database" -c \
        "alter table public.open_bottles drop constraint open_bottles_remaining_ml_check; alter table public.open_bottles add constraint open_bottles_remaining_ml_check check(remaining_ml>=-1)" >/dev/null ;;
    legacy_function_drift)
      psql_cmd "$database" -c \
        "alter function public.record_pour(uuid,integer,text,text) stable" >/dev/null ;;
    legacy_function_extra_guc)
      psql_cmd "$database" -c \
        "alter function public.reconcile_open_bottles_batch(jsonb) set statement_timeout='1ms'" >/dev/null ;;
    legacy_trigger_drift)
      psql_cmd "$database" -c \
        "alter table public.pour_events disable trigger pour_events_trigger" >/dev/null ;;
    legacy_policy_drift)
      psql_cmd "$database" -c \
        "alter policy \"members can read pour_events\" on public.pour_events using (public.is_member(restaurant_id))" >/dev/null ;;
    writer_acl_drift)
      psql_cmd "$database" -c \
        "create role c06_extra_writer_${run_id} nologin; grant execute on function public.execute_physical_bottle_command(uuid,uuid,text,uuid,uuid,uuid,integer,text,text,integer,integer,uuid,uuid,text,boolean) to c06_extra_writer_${run_id}" >/dev/null ;;
    reader_acl_drift)
      psql_cmd "$database" -c \
        "create role c06_extra_reader_${run_id} nologin; grant execute on function public.current_inventory_contract_version() to c06_extra_reader_${run_id}" >/dev/null ;;
    effect_acl_drift)
      psql_cmd "$database" -c \
        "create role c06_extra_effect_${run_id} nologin; grant select on public.inventory_command_bottle_effects to c06_extra_effect_${run_id}" >/dev/null ;;
    view_acl_drift)
      psql_cmd "$database" -c \
        "create role c06_extra_view_${run_id} nologin; grant select on public.effective_service_pour_events to c06_extra_view_${run_id}" >/dev/null ;;
    index_drift)
      psql_cmd "$database" -c \
        "drop index public.bottle_closeouts_open_bottle_tenant_wine_idx; create index bottle_closeouts_open_bottle_tenant_wine_idx on public.bottle_closeouts(restaurant_id,open_bottle_id,wine_id)" >/dev/null ;;
    view_drift)
      psql_cmd "$database" -c \
        "create or replace view public.effective_service_pour_events with (security_invoker=true) as select pe.id,pe.wine_id,pe.restaurant_id,pe.open_bottle_id,pe.ml_delta,pe.kind,pe.actor_user_id,pe.occurred_at,pe.note,pe.event_contract,pe.operation_id,pe.operation_entry_ordinal from public.pour_events pe where false" >/dev/null ;;
    constraint_drift)
      psql_cmd "$database" -c \
        "alter table public.open_bottles drop constraint open_bottles_state_version_check; alter table public.open_bottles add constraint open_bottles_state_version_check check(state_version>=-1)" >/dev/null ;;
    extra_sealed_constraint)
      psql_cmd "$database" -c \
        "alter table public.open_bottles add constraint c06_extra_sealed_constraint check(state_version>=0) not valid" >/dev/null
      seal=$(psql_cmd "$database" -Atc \
        "select 'C06_DEFINITION_MD5:'||md5(pg_catalog.pg_get_constraintdef(oid,false)) from pg_catalog.pg_constraint where conrelid='public.open_bottles'::regclass and conname='c06_extra_sealed_constraint'")
      psql_cmd "$database" -c \
        "comment on constraint c06_extra_sealed_constraint on public.open_bottles is '$seal'" >/dev/null ;;
    renamed_sealed_constraint)
      psql_cmd "$database" -c \
        "alter table public.open_bottles rename constraint open_bottles_state_version_check to open_bottles_state_version_check_renamed" >/dev/null ;;
    function_drift)
      psql_cmd "$database" -c \
        "create or replace function public.current_inventory_contract_version() returns smallint language sql stable security invoker set search_path='' as 'select (1)::smallint'" >/dev/null ;;
    policy_drift)
      psql_cmd "$database" -c \
        "create policy c06_unexpected_effect_read on public.inventory_command_bottle_effects for select using (true)" >/dev/null ;;
    rls_drift)
      psql_cmd "$database" -c \
        "alter table public.inventory_command_bottle_effects force row level security" >/dev/null ;;
    dependent_view)
      psql_cmd "$database" -c \
        "create view public.c06_unexpected_effect_dependency as select * from public.inventory_command_bottle_effects" >/dev/null ;;
    *) echo "unknown unsafe fixture: $fixture" >&2; exit 2 ;;
  esac
}

for fixture in \
  state_version identity_origin nominal_capacity source_provenance opening_operation \
  physical_bottle version2_receipt batch_receipt version2_event reversal_event \
  version2_closeout effect duplicate_slot invalid_legacy_command_type \
  legacy_unique_missing legacy_unique_deferrable legacy_constraint_drift \
  legacy_function_drift legacy_function_extra_guc \
  legacy_trigger_drift legacy_policy_drift writer_acl_drift reader_acl_drift \
  effect_acl_drift view_acl_drift index_drift \
  view_drift constraint_drift extra_sealed_constraint renamed_sealed_constraint \
  function_drift policy_drift rls_drift dependent_view
do
  case_db="c06_${fixture}_${run_id}"
  docker exec "$container" createdb -U "$pg_user" -T "$base_db" "$case_db"
  apply_unsafe_fixture "$case_db" "$fixture"
  psql_file "$case_db" "$state_fingerprint" > "$proof_dir/${fixture}-before.txt"
  if psql_file "$case_db" "$down" > "$proof_dir/${fixture}-down.txt" 2>&1; then
    echo "FAIL: down unexpectedly accepted $fixture" >&2
    exit 1
  fi
  case "$fixture" in
    duplicate_slot|invalid_legacy_command_type|legacy_unique_missing|legacy_unique_deferrable|legacy_constraint_drift|legacy_function_drift|legacy_function_extra_guc|legacy_trigger_drift|legacy_policy_drift|writer_acl_drift|reader_acl_drift|effect_acl_drift|view_acl_drift|index_drift|view_drift|constraint_drift|extra_sealed_constraint|renamed_sealed_constraint|function_drift|policy_drift|rls_drift|dependent_view)
    grep -q 'unsafe_down_physical_bottle_catalog_drift' \
      "$proof_dir/${fixture}-down.txt"
      ;;
    *)
    grep -q 'unsafe_down_physical_bottle_data_present' \
      "$proof_dir/${fixture}-down.txt"
      ;;
  esac
  psql_file "$case_db" "$state_fingerprint" > "$proof_dir/${fixture}-after.txt"
  diff -u "$proof_dir/${fixture}-before.txt" "$proof_dir/${fixture}-after.txt" \
    > "$proof_dir/${fixture}.diff"
done

unrelated_constraint_db="c06_unrelated_same_named_constraint_${run_id}"
docker exec "$container" createdb -U "$pg_user" -T "$base_db" \
  "$unrelated_constraint_db"
psql_cmd "$unrelated_constraint_db" -c \
  "alter table public.restaurants add constraint open_bottles_state_version_check check(name is not null) not valid" \
  > "$proof_dir/unrelated-same-named-constraint-setup.txt"
psql_file "$unrelated_constraint_db" "$down" \
  > "$proof_dir/unrelated-same-named-constraint-down.txt"
psql_file "$unrelated_constraint_db" "$down_acceptance" \
  > "$proof_dir/unrelated-same-named-constraint-acceptance.txt"
grep -q 'C06_PHASE_A_DOWN_ACCEPTANCE_PASS' \
  "$proof_dir/unrelated-same-named-constraint-acceptance.txt"
test "$(psql_cmd "$unrelated_constraint_db" -Atc \
  "select count(*) from pg_catalog.pg_constraint where conrelid='public.restaurants'::regclass and conname='open_bottles_state_version_check'")" = "1"

# PostgreSQL inherited ownership is intentionally insufficient for this leaf.
# The supported executor must SET ROLE to the single direct owner. CREATE is a
# separate admission requirement; REFERENCES on the five altered tables follows
# from that direct ownership and is still printed/asserted by the preflight.
authority_db="c06_authority_${run_id}"
docker exec "$container" createdb -U "$pg_user" -T "$source_db" "$authority_db"
owner_role="c06_owner_${run_id}"
inherited_role="c06_inherited_${run_id}"
no_create_role="c06_no_create_${run_id}"
psql_cmd "$authority_db" -c \
  "create role $owner_role nologin; create role $inherited_role nologin inherit; create role $no_create_role nologin; grant $owner_role to $inherited_role; grant usage on schema public,auth to $owner_role,$inherited_role,$no_create_role; grant create on schema public to $owner_role,$inherited_role; grant execute on function auth.uid() to $owner_role,$inherited_role,$no_create_role; alter table public.inventory_items owner to $owner_role; alter table public.open_bottles owner to $owner_role; alter table public.pour_events owner to $owner_role; alter table public.bottle_closeouts owner to $owner_role; alter table public.inventory_command_receipts owner to $owner_role" \
  > "$proof_dir/authority-setup.txt"
if docker exec -i "$container" psql -X -v ON_ERROR_STOP=1 -v VERBOSITY=verbose \
  -U "$pg_user" -d "$authority_db" -c "set role $inherited_role" -f - \
  < "$preflight" > "$proof_dir/inherited-owner-preflight.txt" 2>&1; then
  echo "FAIL: inherited owner unexpectedly passed preflight" >&2
  exit 1
fi
grep -q 'C06_OPERATOR_NOT_DIRECT_OWNER' "$proof_dir/inherited-owner-preflight.txt"
psql_cmd "$authority_db" -c \
  "alter table public.inventory_items owner to $no_create_role; alter table public.open_bottles owner to $no_create_role; alter table public.pour_events owner to $no_create_role; alter table public.bottle_closeouts owner to $no_create_role; alter table public.inventory_command_receipts owner to $no_create_role" \
  > "$proof_dir/no-create-owner-setup.txt"
if docker exec -i "$container" psql -X -v ON_ERROR_STOP=1 -v VERBOSITY=verbose \
  -U "$pg_user" -d "$authority_db" -c "set role $no_create_role" -f - \
  < "$preflight" > "$proof_dir/no-create-preflight.txt" 2>&1; then
  echo "FAIL: direct owner without CREATE unexpectedly passed preflight" >&2
  exit 1
fi
grep -q 'C06_OPERATOR_MISSING_PUBLIC_SCHEMA_AUTHORITY' "$proof_dir/no-create-preflight.txt"

docker exec "$container" createdb -U "$pg_user" -T "$base_db" "$clean_db"
psql_file "$clean_db" "$down" > "$proof_dir/down.txt"
replay_pre0153_receipt "$clean_db" after-down
capture_pre0153_receipt "$clean_db" after-down
diff -u "$proof_dir/pre0153-receipt-before.txt" \
  "$proof_dir/pre0153-receipt-after-down.txt" > "$proof_dir/pre0153-after-down.diff"
psql_file "$clean_db" "$pre_fingerprint" > "$proof_dir/safe-cycle-after-down.txt"
diff -u "$proof_dir/safe-cycle-pre-up.txt" "$proof_dir/safe-cycle-after-down.txt" \
  > "$proof_dir/safe-cycle-after-down.diff"
psql_file "$clean_db" "$down_acceptance" > "$proof_dir/down-acceptance.txt"
grep -q 'C06_PHASE_A_DOWN_ACCEPTANCE_PASS' "$proof_dir/down-acceptance.txt"
psql_file "$clean_db" "$forward" single > "$proof_dir/re-up.txt"
psql_file "$clean_db" "$preflight" > "$proof_dir/operator-preflight-after-re-up.txt"
grep -q 'C06_PRODUCTION_PREFLIGHT_PASS' "$proof_dir/operator-preflight-after-re-up.txt"
replay_pre0153_receipt "$clean_db" after-re-up
capture_pre0153_receipt "$clean_db" after-re-up
diff -u "$proof_dir/pre0153-receipt-before.txt" \
  "$proof_dir/pre0153-receipt-after-re-up.txt" > "$proof_dir/pre0153-after-re-up.diff"
psql_file "$clean_db" "$post_up" > "$proof_dir/re-up-acceptance.txt"
psql_file "$clean_db" "$state_fingerprint" > "$proof_dir/safe-cycle-after-re-up.txt"
grep -v '^catalog' "$proof_dir/safe-cycle-post-up.txt" \
  > "$proof_dir/safe-cycle-post-up-data.txt"
grep -v '^catalog' "$proof_dir/safe-cycle-after-re-up.txt" \
  > "$proof_dir/safe-cycle-after-re-up-data.txt"
diff -u "$proof_dir/safe-cycle-post-up-data.txt" "$proof_dir/safe-cycle-after-re-up-data.txt" \
  > "$proof_dir/safe-cycle-after-re-up.diff"

c06_settle_all_owned_processes
test -f "$proof_dir/owned-processes-settled.txt"
test -f "$proof_dir/owned-process-evidence-ready.txt"

(cd "$repo_root" && shasum -a 256 "${source_paths[@]}") \
  > "$proof_dir/source-hashes.txt"
diff -u "$approved_manifest" "$proof_dir/source-hashes.txt" \
  > "$proof_dir/source-hashes.diff"

echo "C06_PHASE_A_REHEARSAL_PASS proof_dir=$proof_dir"
echo "PRESERVE all c06_*_${run_id} disposable databases and proof artifacts"
