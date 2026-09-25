\set ON_ERROR_STOP on
\pset pager off

begin;

create temporary table c06_0155_reader_fixture (
  member_user_id uuid not null,
  restaurant_id uuid not null,
  foreign_restaurant_id uuid not null,
  own_legacy_event_id uuid not null,
  foreign_event_id uuid not null,
  reversed_event_id uuid not null,
  reversal_event_id uuid not null,
  effective_event_id uuid not null
) on commit drop;

do $setup$
declare
  v_member_user uuid := '15500000-0000-4000-8000-000000000101';
  v_foreign_user uuid := '15500000-0000-4000-8000-000000000102';
  v_restaurant uuid := '15500000-0000-4000-8000-000000000001';
  v_foreign_restaurant uuid := '15500000-0000-4000-8000-000000000002';
  v_wine uuid := '15500000-0000-4000-8000-000000000201';
  v_foreign_wine uuid := '15500000-0000-4000-8000-000000000202';
  v_bottle uuid := '15500000-0000-4000-8000-000000000301';
  v_own_legacy_event uuid := '15500000-0000-4000-8000-000000000401';
  v_foreign_event uuid := '15500000-0000-4000-8000-000000000402';
  v_original uuid := '15500000-0000-4000-8000-000000000403';
  v_reversal uuid := '15500000-0000-4000-8000-000000000404';
  v_effective uuid := '15500000-0000-4000-8000-000000000405';
  v_original_operation uuid := '15500000-0000-4000-8000-000000000501';
  v_reversal_operation uuid := '15500000-0000-4000-8000-000000000502';
  v_effective_operation uuid := '15500000-0000-4000-8000-000000000503';
begin
  insert into auth.users(id, email) values
    (v_member_user, 'c06-0155-member@terroir.test'),
    (v_foreign_user, 'c06-0155-foreign@terroir.test');
  insert into public.restaurants(id, name) values
    (v_restaurant, 'C06 0155 reader fixture'),
    (v_foreign_restaurant, 'C06 0155 foreign fixture');
  insert into public.memberships(user_id, restaurant_id, role) values
    (v_member_user, v_restaurant, 'owner'),
    (v_foreign_user, v_foreign_restaurant, 'owner');
  insert into public.wines(id, restaurant_id, name, producer, size_ml) values
    (v_wine, v_restaurant, 'C06 0155 fixture', 'Terroir', 750),
    (v_foreign_wine, v_foreign_restaurant, 'C06 0155 foreign', 'Terroir', 750);
  insert into public.open_bottles(
    id, wine_id, restaurant_id, remaining_ml, identity_contract,
    identity_origin, nominal_capacity_ml, source_provenance, state_version
  ) values (
    v_bottle, v_wine, v_restaurant, 650, 2,
    'migrated_active', 750, 'legacy_unknown', 0
  );
  insert into public.inventory_command_receipts(
    restaurant_id, operation_id, actor_user_id, wine_id, command_type,
    request_payload, result_payload, completed_at, command_version, scope_kind
  ) values
    (v_restaurant, v_original_operation, v_member_user, v_wine, 'pour',
     '{}'::jsonb, '{}'::jsonb, now(), 2, 'single_wine'),
    (v_restaurant, v_reversal_operation, v_member_user, v_wine, 'undo',
     '{}'::jsonb, '{}'::jsonb, now(), 2, 'single_wine'),
    (v_restaurant, v_effective_operation, v_member_user, v_wine, 'pour',
     '{}'::jsonb, '{}'::jsonb, now(), 2, 'single_wine');
  insert into public.pour_events(
    id, wine_id, restaurant_id, ml_delta, kind, actor_user_id,
    event_contract, operation_id
  ) values
    (v_own_legacy_event, v_wine, v_restaurant, 10, 'pour', v_member_user, 1, null),
    (v_foreign_event, v_foreign_wine, v_foreign_restaurant, 11, 'pour',
     v_foreign_user, 1, null);
  insert into public.pour_events(
    id, wine_id, restaurant_id, open_bottle_id, ml_delta, kind,
    actor_user_id, event_contract, operation_id, operation_entry_ordinal
  ) values
    (v_original, v_wine, v_restaurant, v_bottle, 50, 'pour',
     v_member_user, 2, v_original_operation, 0),
    (v_effective, v_wine, v_restaurant, v_bottle, 20, 'pour',
     v_member_user, 2, v_effective_operation, 0);
  insert into public.pour_events(
    id, wine_id, restaurant_id, open_bottle_id, ml_delta, kind,
    actor_user_id, event_contract, operation_id, operation_entry_ordinal,
    reversal_of_event_id
  ) values (
    v_reversal, v_wine, v_restaurant, v_bottle, -50, 'undo',
    v_member_user, 2, v_reversal_operation, 0, v_original
  );

  insert into c06_0155_reader_fixture values (
    v_member_user, v_restaurant, v_foreign_restaurant,
    v_own_legacy_event, v_foreign_event, v_original, v_reversal, v_effective
  );
end;
$setup$;

grant select on c06_0155_reader_fixture to authenticated, service_role;

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  (select member_user_id::text from c06_0155_reader_fixture),
  true
);
select set_config('request.jwt.claim.role', 'authenticated', true);

do $authenticated_containment$
declare
  v_fixture c06_0155_reader_fixture%rowtype;
  v_visible_ids uuid[];
begin
  select * into strict v_fixture from c06_0155_reader_fixture;
  select array_agg(id order by id) into v_visible_ids
    from public.effective_service_pour_events;

  if v_visible_ids is distinct from array[
       v_fixture.own_legacy_event_id,
       v_fixture.effective_event_id
     ]::uuid[]
     or v_fixture.foreign_event_id = any(v_visible_ids) then
    raise exception 'C06_0155_AUTHENTICATED_TENANT_CONTAINMENT_FAILURE';
  end if;
end;
$authenticated_containment$;

reset role;
set local role anon;

do $anon_denial$
begin
  perform 1 from public.effective_service_pour_events limit 1;
  raise exception 'C06_0155_ANON_SELECT_NOT_DENIED';
exception
  when sqlstate '42501' then null;
end;
$anon_denial$;

reset role;
select set_config('request.jwt.claim.sub', '', true);
set local role service_role;

do $service_role_semantics$
declare
  v_fixture c06_0155_reader_fixture%rowtype;
  v_visible_ids uuid[];
begin
  if not coalesce((
    select r.rolbypassrls
      from pg_catalog.pg_roles r
     where r.rolname = current_user
  ), false) then
    raise exception 'C06_0155_SERVICE_ROLE_NOT_BYPASSRLS';
  end if;

  select * into strict v_fixture from c06_0155_reader_fixture;
  select array_agg(id order by id) into v_visible_ids
    from public.effective_service_pour_events
   where restaurant_id = v_fixture.restaurant_id
     and id in (
       v_fixture.reversed_event_id,
       v_fixture.reversal_event_id,
       v_fixture.effective_event_id
     );

  if v_visible_ids is distinct from array[v_fixture.effective_event_id]::uuid[] then
    raise exception 'C06_0155_SERVICE_ROLE_UNDO_SEMANTICS_FAILURE';
  end if;
end;
$service_role_semantics$;

reset role;
rollback;

\echo C06_0155_READER_SEMANTICS_PASS
