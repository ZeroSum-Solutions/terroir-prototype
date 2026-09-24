\set ON_ERROR_STOP on
\pset pager off

begin;
do $legacy$
declare
  v_user uuid := gen_random_uuid();
  v_restaurant uuid := gen_random_uuid();
  v_wine uuid := gen_random_uuid();
  v_operation uuid := gen_random_uuid();
  v_result jsonb;
  v_replay jsonb;
  v_stored_request jsonb;
  v_stored_result jsonb;
begin
  insert into auth.users(id, email) values (v_user, 'c06-legacy-' || v_user || '@terroir.test');
  insert into public.restaurants(id, name) values (v_restaurant, 'C06 legacy fixture');
  insert into public.memberships(user_id, restaurant_id, role)
    values (v_user, v_restaurant, 'owner')
    on conflict (user_id, restaurant_id) do update set role = excluded.role;
  insert into public.wines(id, restaurant_id, name, producer, size_ml)
    values (v_wine, v_restaurant, 'Legacy fixture', 'C06', 750);
  insert into public.inventory_items(wine_id, restaurant_id, quantity, unit_cost)
    values (v_wine, v_restaurant, 1, 10);
  perform set_config('request.jwt.claim.sub', v_user::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);

  v_result := public.execute_inventory_command(
    v_operation, v_restaurant, 'open', v_wine,
    null, null, 'none', null, null, null, 0, null
  );
  select request_payload, result_payload
    into v_stored_request, v_stored_result
    from public.inventory_command_receipts
   where restaurant_id = v_restaurant and operation_id = v_operation;
  v_replay := public.execute_inventory_command(
    v_operation, v_restaurant, 'open', v_wine,
    null, null, 'none', null, null, null, 0, null
  );

  if v_result #>> '{open_bottle,identity_contract}' <> '1'
     or v_result #>> '{open_bottle,identity_origin}' <> 'legacy_slot'
     or v_result #>> '{open_bottle,source_provenance}' <> 'legacy_unknown'
     or v_result #>> '{open_bottle,state_version}' <> '0'
     or (v_result #> '{open_bottle,nominal_capacity_ml}') <> 'null'::jsonb
     or (v_result #> '{open_bottle,opening_operation_id}') <> 'null'::jsonb
     or (v_replay - 'replayed') is distinct from (v_stored_result - 'replayed')
     or (select request_payload from public.inventory_command_receipts
          where restaurant_id = v_restaurant and operation_id = v_operation)
        is distinct from v_stored_request
     or (select result_payload from public.inventory_command_receipts
          where restaurant_id = v_restaurant and operation_id = v_operation)
        is distinct from v_stored_result then
    raise exception 'C06_LEGACY_COMPATIBILITY_MISMATCH';
  end if;
end;
$legacy$;
rollback;

\echo C06_PHASE_A_LEGACY_COMPATIBILITY_PASS
