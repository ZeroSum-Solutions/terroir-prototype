#!/usr/bin/env bash
set -u

container='9c977bd272b79003bfbebc2d8971e1a9906d228a5ac4f531097dd6d2087ba360'
database='terroir_phase_c_20260926a'
tmpdir="$(mktemp -d /tmp/phase-c-undo-order.XXXXXX)"

cleanup() {
  docker exec -i "$container" psql -X -v ON_ERROR_STOP=1 -U postgres -d "$database" <<'SQL'
begin;
create temporary table _phase_c_default_restaurants on commit drop as
select distinct restaurant_id
  from public.memberships
 where user_id in (
   '15630000-0000-4000-8000-000000000002',
   '15630000-0000-4000-8000-000000000003'
 )
   and restaurant_id <> '15630000-0000-4000-8000-000000000001';
delete from public.inventory_command_bottle_effects
 where restaurant_id = '15630000-0000-4000-8000-000000000001';
delete from public.bottle_closeouts
 where restaurant_id = '15630000-0000-4000-8000-000000000001';
delete from public.pour_events
 where restaurant_id = '15630000-0000-4000-8000-000000000001';
delete from public.inventory_command_receipts
 where restaurant_id = '15630000-0000-4000-8000-000000000001';
delete from public.open_bottles
 where restaurant_id = '15630000-0000-4000-8000-000000000001';
delete from public.inventory_items
 where restaurant_id = '15630000-0000-4000-8000-000000000001';
delete from public.memberships
 where restaurant_id = '15630000-0000-4000-8000-000000000001';
delete from public.wines
 where restaurant_id = '15630000-0000-4000-8000-000000000001';
delete from public.restaurants
 where id = '15630000-0000-4000-8000-000000000001';
delete from auth.users
 where id in (
   '15630000-0000-4000-8000-000000000002',
   '15630000-0000-4000-8000-000000000003'
 );
delete from public.restaurants
 where id in (select restaurant_id from _phase_c_default_restaurants);
commit;
SQL
}

finish() {
  local exit_code="$1"
  cleanup
  rm -f "$tmpdir/blocker.out" "$tmpdir/a.out" "$tmpdir/b.out" "$tmpdir/undo.out"
  rmdir "$tmpdir"
  return "$exit_code"
}

cleanup >/dev/null 2>&1 || true

docker exec -i "$container" psql -X -v ON_ERROR_STOP=1 -U postgres -d "$database" <<'SQL'
do $$
begin
  if current_database() <> 'terroir_phase_c_20260926a'
     or public.current_inventory_contract_version() <> 2 then
    raise exception 'WRONG_TARGET_OR_CONTRACT';
  end if;
end;
$$;
begin;
insert into auth.users(id, email) values
  ('15630000-0000-4000-8000-000000000002', 'phase-c-order-a@terroir.test'),
  ('15630000-0000-4000-8000-000000000003', 'phase-c-order-b@terroir.test');
insert into public.restaurants(id, name)
values ('15630000-0000-4000-8000-000000000001', 'Phase C Undo ordering regression');
insert into public.memberships(user_id, restaurant_id, role) values
  ('15630000-0000-4000-8000-000000000002', '15630000-0000-4000-8000-000000000001', 'owner'),
  ('15630000-0000-4000-8000-000000000003', '15630000-0000-4000-8000-000000000001', 'owner');
insert into public.wines(id, restaurant_id, name, producer, size_ml)
values ('15630000-0000-4000-8000-000000000010', '15630000-0000-4000-8000-000000000001', 'Undo ordering wine', 'C06', 750);
insert into public.inventory_items(id, wine_id, restaurant_id, quantity, unit_cost)
values ('15630000-0000-4000-8000-000000000020', '15630000-0000-4000-8000-000000000010', '15630000-0000-4000-8000-000000000001', 1, 10);
select set_config('request.jwt.claim.sub', '15630000-0000-4000-8000-000000000002', true);
select public.execute_physical_bottle_command(
  '15630000-0000-4000-8000-000000000100',
  '15630000-0000-4000-8000-000000000001',
  'open',
  '15630000-0000-4000-8000-000000000010'
)->>'command' as initial_open;
commit;
SQL
setup_exit_code=$?
if [ "$setup_exit_code" -ne 0 ]; then
  finish "$setup_exit_code"
  exit "$setup_exit_code"
fi

docker exec --env 'PGOPTIONS=-c application_name=phase-c-order-blocker -c statement_timeout=20000' -i "$container" \
  psql -X -v ON_ERROR_STOP=1 -U postgres -d "$database" >"$tmpdir/blocker.out" 2>&1 <<'SQL' &
begin;
select 'BLOCKER_LOCKED', clock_timestamp(), pg_backend_pid()
  from public.memberships
 where user_id = '15630000-0000-4000-8000-000000000002'
   and restaurant_id = '15630000-0000-4000-8000-000000000001'
 for update;
select pg_sleep(6);
commit;
select 'BLOCKER_RELEASED', clock_timestamp();
SQL
blocker_pid=$!
sleep 0.5

docker exec --env 'PGOPTIONS=-c application_name=phase-c-order-a -c statement_timeout=20000 -c lock_timeout=15000' -i "$container" \
  psql -X -v ON_ERROR_STOP=1 -U postgres -d "$database" >"$tmpdir/a.out" 2>&1 <<'SQL' &
begin;
select set_config('request.jwt.claim.sub', '15630000-0000-4000-8000-000000000002', true);
set local role authenticated;
select 'A_RESULT' as label,
       public.execute_physical_bottle_command(
         p_operation_id => '15630000-0000-4000-8000-000000000111',
         p_restaurant_id => '15630000-0000-4000-8000-000000000001',
         p_command => 'pour',
         p_wine_id => '15630000-0000-4000-8000-000000000010',
         p_open_bottle_id => (
           select id from public.open_bottles
            where restaurant_id = '15630000-0000-4000-8000-000000000001'
              and wine_id = '15630000-0000-4000-8000-000000000010'
              and closed_at is null
         ),
         p_ml => 100
       ) as result;
commit;
SQL
a_pid=$!
sleep 0.7

docker exec --env 'PGOPTIONS=-c application_name=phase-c-order-b -c statement_timeout=20000 -c lock_timeout=15000' -i "$container" \
  psql -X -v ON_ERROR_STOP=1 -U postgres -d "$database" >"$tmpdir/b.out" 2>&1 <<'SQL' &
begin;
select set_config('request.jwt.claim.sub', '15630000-0000-4000-8000-000000000003', true);
set local role authenticated;
select 'B_RESULT' as label,
       public.execute_physical_bottle_command(
         p_operation_id => '15630000-0000-4000-8000-000000000112',
         p_restaurant_id => '15630000-0000-4000-8000-000000000001',
         p_command => 'pour',
         p_wine_id => '15630000-0000-4000-8000-000000000010',
         p_open_bottle_id => (
           select id from public.open_bottles
            where restaurant_id = '15630000-0000-4000-8000-000000000001'
              and wine_id = '15630000-0000-4000-8000-000000000010'
              and closed_at is null
         ),
         p_ml => 100
       ) as result;
commit;
SQL
b_pid=$!

wait "$b_pid"
b_exit_code=$?
wait "$blocker_pid"
blocker_exit_code=$?
wait "$a_pid"
a_exit_code=$?
cat "$tmpdir/b.out"
cat "$tmpdir/blocker.out"
cat "$tmpdir/a.out"

docker exec --env 'PGOPTIONS=-c application_name=phase-c-order-undo -c statement_timeout=15000 -c lock_timeout=5000' -i "$container" \
  psql -X -v ON_ERROR_STOP=1 -U postgres -d "$database" >"$tmpdir/undo.out" 2>&1 <<'SQL'
begin;
select set_config('request.jwt.claim.sub', '15630000-0000-4000-8000-000000000003', true);
set local role authenticated;
do $undo$
declare
  v_event_id uuid;
  v_message text;
begin
  select id into strict v_event_id
    from public.pour_events
   where restaurant_id = '15630000-0000-4000-8000-000000000001'
     and operation_id = '15630000-0000-4000-8000-000000000112';
  begin
    perform public.execute_physical_bottle_command(
      p_operation_id => '15630000-0000-4000-8000-000000000113',
      p_restaurant_id => '15630000-0000-4000-8000-000000000001',
      p_command => 'undo',
      p_wine_id => '15630000-0000-4000-8000-000000000010',
      p_reversal_of_event_id => v_event_id
    );
    raise exception 'C06_EXPECTED_UNDO_REVIEW';
  exception when sqlstate 'P0001' then
    get stacked diagnostics v_message = message_text;
    if v_message <> 'undo_requires_review' then raise; end if;
  end;
end;
$undo$;
commit;
SQL
undo_exit_code=$?
cat "$tmpdir/undo.out"

docker exec --env 'PGOPTIONS=-c default_transaction_read_only=on -c statement_timeout=5000' -i "$container" \
  psql -X -v ON_ERROR_STOP=1 -U postgres -d "$database" <<'SQL'
select operation_id, kind, ml_delta, occurred_at, reversal_of_event_id
  from public.pour_events
 where restaurant_id = '15630000-0000-4000-8000-000000000001'
 order by occurred_at, id;

do $verify$
declare
  v_a_version bigint;
  v_b_version bigint;
  v_a_time timestamptz;
  v_b_time timestamptz;
begin
  select (result_payload #>> '{open_bottle,state_version}')::bigint
    into strict v_a_version
    from public.inventory_command_receipts
   where operation_id = '15630000-0000-4000-8000-000000000111';
  select (result_payload #>> '{open_bottle,state_version}')::bigint
    into strict v_b_version
    from public.inventory_command_receipts
   where operation_id = '15630000-0000-4000-8000-000000000112';
  select occurred_at into strict v_a_time from public.pour_events
   where operation_id = '15630000-0000-4000-8000-000000000111';
  select occurred_at into strict v_b_time from public.pour_events
   where operation_id = '15630000-0000-4000-8000-000000000112';

  if (v_b_version, v_a_version) is distinct from row(1::bigint, 2::bigint)
     or not (v_b_time < v_a_time)
     or exists (
       select 1 from public.pour_events
        where operation_id = '15630000-0000-4000-8000-000000000113'
     )
     or exists (
       select 1 from public.inventory_command_receipts
        where operation_id = '15630000-0000-4000-8000-000000000113'
     )
     or exists (
       select 1 from public.inventory_command_bottle_effects
        where operation_id = '15630000-0000-4000-8000-000000000113'
     )
     or (select (remaining_ml, state_version) from public.open_bottles
          where restaurant_id = '15630000-0000-4000-8000-000000000001')
        is distinct from row(550, 2::bigint) then
    raise exception 'C06_UNDO_ORDERING_REGRESSION';
  end if;

  raise notice 'C06_0156_UNDO_ORDERING_PASS b_mutation_version=1 a_mutation_version=2 b_timestamp_lt_a=true undo_b_rejected=true remaining=550 state_version=2';
end;
$verify$;
SQL
verify_exit_code=$?

overall_exit_code=0
if [ "$blocker_exit_code" -ne 0 ] || [ "$a_exit_code" -ne 0 ] \
   || [ "$b_exit_code" -ne 0 ] || [ "$undo_exit_code" -ne 0 ] \
   || [ "$verify_exit_code" -ne 0 ]; then
  overall_exit_code=1
fi

finish "$overall_exit_code"
cleanup_exit_code=$?
docker exec --env 'PGOPTIONS=-c default_transaction_read_only=on -c statement_timeout=5000' "$container" \
  psql -X -v ON_ERROR_STOP=1 -U postgres -d "$database" -At -c \
  "select 'C06_0156_UNDO_ORDERING_CLEANUP',public.current_inventory_contract_version(),(select count(*) from public.restaurants where id='15630000-0000-4000-8000-000000000001'),(select count(*) from public.open_bottles where restaurant_id='15630000-0000-4000-8000-000000000001'),(select count(*) from public.pour_events where restaurant_id='15630000-0000-4000-8000-000000000001'),(select count(*) from public.inventory_command_receipts where restaurant_id='15630000-0000-4000-8000-000000000001');"
exit "$cleanup_exit_code"
