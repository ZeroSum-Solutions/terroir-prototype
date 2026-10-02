-- 0161 malformed-receipt refusal and transaction rollback matrix.
-- Every fixture write is rolled back.
\set ON_ERROR_STOP on
\pset pager off

\if :{?expected_database}
\else
  \echo C06_0161_EXPECTED_DATABASE_REQUIRED
  \quit 3
\endif
\if :{?target_admitted}
\else
  \echo C06_0161_TARGET_ADMISSION_REQUIRED
  \quit 3
\endif

select 1 / case when
  current_database() = :'expected_database'
  and current_user = 'postgres'
  and session_user = 'postgres'
  and :'target_admitted' = 'on'
  and pg_catalog.to_regprocedure(
    'public.receive_bottle_at_location_private(uuid,uuid,uuid,text,uuid)'
  ) is not null
then 1 else 0 end as c06_0161_atomic_target_admitted;

begin;
set local statement_timeout = '30s';
set local lock_timeout = '5s';

create function pg_temp.c06_0161_fail_inventory() returns trigger
language plpgsql as $function$
begin
  raise exception 'C06_0161_FORCED_INVENTORY_FAILURE';
end;
$function$;
create function pg_temp.c06_0161_fail_receipt_completion() returns trigger
language plpgsql as $function$
begin
  if new.command_type='bottle_location_receive'
     and old.result_payload is null
     and new.result_payload is not null then
    raise exception 'C06_0161_FORCED_RECEIPT_COMPLETION_FAILURE';
  end if;
  return new;
end;
$function$;

insert into auth.users(id,email) values
  ('16120000-0000-4000-8000-000000000001','c06-0161-atomic@terroir.test');
insert into public.workspaces(id,kind,name) values
  ('16120000-0000-4000-8000-000000000010','restaurant','C06 0161 atomic');
insert into public.restaurants(id,name,workspace_id) values
  ('16120000-0000-4000-8000-000000000020','C06 0161 atomic site','16120000-0000-4000-8000-000000000010');
insert into public.workspace_memberships(id,workspace_id,user_id) values
  ('16120000-0000-4000-8000-000000000030','16120000-0000-4000-8000-000000000010','16120000-0000-4000-8000-000000000001');
insert into public.memberships(id,user_id,restaurant_id,role,workspace_membership_id) values
  ('16120000-0000-4000-8000-000000000040','16120000-0000-4000-8000-000000000001','16120000-0000-4000-8000-000000000020','staff','16120000-0000-4000-8000-000000000030');
insert into public.wines(id,restaurant_id,name,producer,vintage,size_ml) values
  ('16120000-0000-4000-8000-000000000050','16120000-0000-4000-8000-000000000020','C06 0161 atomic wine','Contract',2020,750);
insert into public.bins(id,restaurant_id,code) values
  ('16120000-0000-4000-8000-000000000060','16120000-0000-4000-8000-000000000020','ATOMIC-01');

insert into public.inventory_command_receipts(
  restaurant_id,operation_id,actor_user_id,wine_id,command_type,
  request_payload,command_version,scope_kind,batch_entry_count
) values(
  '16120000-0000-4000-8000-000000000020',
  '16120000-0000-4000-8000-000000000070',
  '16120000-0000-4000-8000-000000000001',
  '16120000-0000-4000-8000-000000000050','bottle_location_receive',
  pg_catalog.jsonb_build_object(
    'version',3,'kind','bottle_location_receive',
    'wine_id','16120000-0000-4000-8000-000000000050'::uuid,
    'section','Atomic','bin_id','16120000-0000-4000-8000-000000000060'::uuid,
    'quantity',1
  ),3,'single_wine',null
);
insert into public.inventory_command_receipts(
  restaurant_id,operation_id,actor_user_id,wine_id,command_type,
  request_payload,result_payload,completed_at,command_version,scope_kind,batch_entry_count
) values(
  '16120000-0000-4000-8000-000000000020',
  '16120000-0000-4000-8000-000000000071',
  '16120000-0000-4000-8000-000000000001',
  '16120000-0000-4000-8000-000000000050','bottle_location_receive',
  pg_catalog.jsonb_build_object(
    'version',3,'kind','bottle_location_receive',
    'wine_id','16120000-0000-4000-8000-000000000050'::uuid,
    'section','Atomic','bin_id','16120000-0000-4000-8000-000000000060'::uuid,
    'quantity',1
  ),
  pg_catalog.jsonb_build_object(
    'version',1,'kind','bottle_location_receive','status','committed',
    'operationId','16120000-0000-4000-8000-000000000071'::uuid,
    'inventoryItemId','not-a-uuid','wineId','16120000-0000-4000-8000-000000000050'::uuid,
    'section','Atomic','binId','16120000-0000-4000-8000-000000000060'::uuid,
    'binCode','ATOMIC-01','quantity',1
  ),pg_catalog.statement_timestamp(),3,'single_wine',null
);

set local role authenticated;
select pg_catalog.set_config(
  'request.jwt.claim.sub','16120000-0000-4000-8000-000000000001',true
);
do $c06_0161_malformed_receipts$
declare v_operation uuid;
begin
  foreach v_operation in array array[
    '16120000-0000-4000-8000-000000000070'::uuid,
    '16120000-0000-4000-8000-000000000071'::uuid
  ] loop
    begin
      perform public.receive_bottle_at_location_private(
        '16120000-0000-4000-8000-000000000020',v_operation,
        '16120000-0000-4000-8000-000000000050','Atomic',
        '16120000-0000-4000-8000-000000000060'
      );
      raise exception 'C06_0161_EXPECTED_INCOMPLETE_RECEIPT_REFUSAL';
    exception when sqlstate 'P05I1' then null;
    end;
  end loop;
end;
$c06_0161_malformed_receipts$;
reset role;

create trigger c06_0161_force_inventory
  before insert on public.inventory_items
  for each row execute function pg_temp.c06_0161_fail_inventory();
set local role authenticated;
do $c06_0161_inventory_failure$
declare v_message text;
begin
  begin
    perform public.receive_bottle_at_location_private(
      '16120000-0000-4000-8000-000000000020',
      '16120000-0000-4000-8000-000000000072',
      '16120000-0000-4000-8000-000000000050','Atomic',
      '16120000-0000-4000-8000-000000000060'
    );
    raise exception 'C06_0161_EXPECTED_FORCED_INVENTORY_FAILURE';
  exception when raise_exception then
    get stacked diagnostics v_message=message_text;
    if v_message<>'C06_0161_FORCED_INVENTORY_FAILURE' then raise; end if;
  end;
end;
$c06_0161_inventory_failure$;
reset role;
drop trigger c06_0161_force_inventory on public.inventory_items;

create trigger c06_0161_force_receipt_completion
  before update on public.inventory_command_receipts
  for each row execute function pg_temp.c06_0161_fail_receipt_completion();
set local role authenticated;
do $c06_0161_receipt_failure$
declare v_message text;
begin
  begin
    perform public.receive_bottle_at_location_private(
      '16120000-0000-4000-8000-000000000020',
      '16120000-0000-4000-8000-000000000073',
      '16120000-0000-4000-8000-000000000050','Atomic',
      '16120000-0000-4000-8000-000000000060'
    );
    raise exception 'C06_0161_EXPECTED_FORCED_RECEIPT_FAILURE';
  exception when raise_exception then
    get stacked diagnostics v_message=message_text;
    if v_message<>'C06_0161_FORCED_RECEIPT_COMPLETION_FAILURE' then raise; end if;
  end;
end;
$c06_0161_receipt_failure$;
reset role;
drop trigger c06_0161_force_receipt_completion on public.inventory_command_receipts;

do $c06_0161_failure_conservation$
begin
  if exists (
       select 1 from public.inventory_items ii
        where ii.restaurant_id='16120000-0000-4000-8000-000000000020'
     )
     or exists (
       select 1 from public.inventory_command_receipts r
        where r.restaurant_id='16120000-0000-4000-8000-000000000020'
          and r.operation_id in (
            '16120000-0000-4000-8000-000000000072',
            '16120000-0000-4000-8000-000000000073'
          )
     )
     or (select pg_catalog.count(*) from public.inventory_command_receipts r
          where r.restaurant_id='16120000-0000-4000-8000-000000000020') <> 2 then
    raise exception 'C06_0161_FORCED_FAILURE_LEFT_RESIDUE';
  end if;
end;
$c06_0161_failure_conservation$;

rollback;
\echo C06_0161_ATOMIC_AND_MALFORMED_PASS
