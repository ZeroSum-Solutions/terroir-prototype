\set ON_ERROR_STOP on
\pset pager off

begin;
insert into auth.users(id, email)
  values ('15600000-0000-4000-8000-000000000202', 'phase-c-acl@terroir.test');
insert into public.restaurants(id, name)
  values ('15600000-0000-4000-8000-000000000201', 'Phase C ACL fixture');
insert into public.memberships(user_id, restaurant_id, role)
  values (
    '15600000-0000-4000-8000-000000000202',
    '15600000-0000-4000-8000-000000000201',
    'owner'
  );
insert into public.wines(id, restaurant_id, name, producer, size_ml)
  values (
    '15600000-0000-4000-8000-000000000210',
    '15600000-0000-4000-8000-000000000201',
    'ACL wine', 'C06', 750
  );
insert into public.inventory_items(
  id, wine_id, restaurant_id, quantity, unit_cost
) values (
  '15600000-0000-4000-8000-000000000220',
  '15600000-0000-4000-8000-000000000210',
  '15600000-0000-4000-8000-000000000201',
  1, 10
);
select set_config(
  'request.jwt.claim.sub', '15600000-0000-4000-8000-000000000202', true
);

set local role authenticated;
select public.execute_physical_bottle_command(
  '15600000-0000-4000-8000-000000000230',
  '15600000-0000-4000-8000-000000000201',
  'open',
  '15600000-0000-4000-8000-000000000210'
)->>'command' as authenticated_physical_command;

do $authenticated_denials$
declare
  v_message text;
begin
  begin
    perform public.execute_physical_reconciliation_batch(
      '15600000-0000-4000-8000-000000000231',
      '15600000-0000-4000-8000-000000000201',
      '[]'::jsonb
    );
    raise exception 'C06_EXPECTED_BATCH_VALIDATION';
  exception when sqlstate 'P0001' then
    get stacked diagnostics v_message = message_text;
    if v_message <> 'invalid_reconciliation_batch' then raise; end if;
  end;

  begin
    perform public.record_pour(
      '15600000-0000-4000-8000-000000000210', 1, 'pour', null
    );
    raise exception 'C06_EXPECTED_RETIRED_RPC_DENIAL';
  exception when insufficient_privilege then null;
  end;

  begin
    update public.open_bottles set remaining_ml = remaining_ml;
    raise exception 'C06_EXPECTED_OPEN_BOTTLE_DML_DENIAL';
  exception when insufficient_privilege then null;
  end;

  begin
    delete from public.pour_events where false;
    raise exception 'C06_EXPECTED_EVENT_DELETE_DENIAL';
  exception when insufficient_privilege then null;
  end;

  begin
    insert into public.bottle_closeouts(
      restaurant_id, wine_id, preservation_method, opened_at,
      actual_remaining_ml, theoretical_remaining_ml, written_off_ml
    ) values (
      '15600000-0000-4000-8000-000000000201',
      '15600000-0000-4000-8000-000000000210',
      'none', now(), 0, 0, 0
    );
    raise exception 'C06_EXPECTED_CLOSEOUT_DML_DENIAL';
  exception when insufficient_privilege then null;
  end;

  begin
    execute 'truncate table public.bottle_closeouts';
    raise exception 'C06_EXPECTED_AUTHENTICATED_TRUNCATE_DENIAL';
  exception when insufficient_privilege then null;
  end;
end;
$authenticated_denials$;

reset role;
set local role service_role;
do $service_denials$
begin
  begin
    perform public.execute_physical_bottle_command(
      '15600000-0000-4000-8000-000000000232',
      '15600000-0000-4000-8000-000000000201',
      'open',
      '15600000-0000-4000-8000-000000000210'
    );
    raise exception 'C06_EXPECTED_SERVICE_PHYSICAL_RPC_DENIAL';
  exception when insufficient_privilege then null;
  end;

  begin
    perform public.record_pour(
      '15600000-0000-4000-8000-000000000210', 1, 'pour', null
    );
    raise exception 'C06_EXPECTED_SERVICE_RETIRED_RPC_DENIAL';
  exception when insufficient_privilege then null;
  end;

  begin
    update public.open_bottles set remaining_ml = remaining_ml;
    raise exception 'C06_EXPECTED_SERVICE_BOTTLE_DML_DENIAL';
  exception when insufficient_privilege then null;
  end;

  begin
    delete from public.pour_events where false;
    raise exception 'C06_EXPECTED_SERVICE_EVENT_DELETE_DENIAL';
  exception when insufficient_privilege then null;
  end;

  begin
    execute 'truncate table public.inventory_command_receipts';
    raise exception 'C06_EXPECTED_SERVICE_TRUNCATE_DENIAL';
  exception when insufficient_privilege then null;
  end;
end;
$service_denials$;
reset role;

select 'C06_0156_ACL_RUNTIME_PASS' as evidence;
rollback;

\echo C06_0156_ACL_RUNTIME_PASS
