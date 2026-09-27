\set ON_ERROR_STOP on
\pset pager off

do $target$
begin
  if current_database() <> 'terroir_phase_c_20260926a' then
    raise exception 'C06_WRONG_DISPOSABLE_TARGET';
  end if;
  if public.current_inventory_contract_version() <> 2 then
    raise exception 'C06_DOWN_REFUSAL_REQUIRES_CONTRACT_2';
  end if;
end;
$target$;

insert into auth.users(id, email)
  values ('15600000-0000-4000-8000-000000000402', 'phase-c-down-refusal@terroir.test');
insert into public.restaurants(id, name)
  values ('15600000-0000-4000-8000-000000000401', 'Phase C down refusal fixture');
insert into public.memberships(user_id, restaurant_id, role)
  values (
    '15600000-0000-4000-8000-000000000402',
    '15600000-0000-4000-8000-000000000401',
    'owner'
  );
insert into public.wines(id, restaurant_id, name, producer, size_ml)
  values (
    '15600000-0000-4000-8000-000000000410',
    '15600000-0000-4000-8000-000000000401',
    'Down refusal wine', 'C06', 750
  );
insert into public.inventory_items(id, wine_id, restaurant_id, quantity, unit_cost)
  values (
    '15600000-0000-4000-8000-000000000420',
    '15600000-0000-4000-8000-000000000410',
    '15600000-0000-4000-8000-000000000401',
    1, 10
  );
select set_config(
  'request.jwt.claim.sub', '15600000-0000-4000-8000-000000000402', true
);

set local role authenticated;
select public.execute_physical_bottle_command(
  '15600000-0000-4000-8000-000000000430',
  '15600000-0000-4000-8000-000000000401',
  'open',
  '15600000-0000-4000-8000-000000000410'
)->>'command' as native_v2_fixture_command;
reset role;

select 'C06_0156_DOWN_REFUSAL_FIXTURE_READY' as evidence;
