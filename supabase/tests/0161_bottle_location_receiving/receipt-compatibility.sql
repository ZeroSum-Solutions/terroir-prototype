-- 0161 receipt-family compatibility, immutable replay, merge and bin drift.
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
  and public.current_inventory_contract_version() = 2
  and pg_catalog.to_regprocedure(
    'public.receive_bottle_at_location_private(uuid,uuid,uuid,text,uuid)'
  ) is not null
then 1 else 0 end as c06_0161_compatibility_target_admitted;

begin;
set local statement_timeout = '30s';
set local lock_timeout = '5s';

insert into auth.users(id,email) values
  ('16110000-0000-4000-8000-000000000001','c06-0161-compat-owner@terroir.test'),
  ('16110000-0000-4000-8000-000000000002','c06-0161-compat-staff@terroir.test');
insert into public.workspaces(id,kind,name) values
  ('16110000-0000-4000-8000-000000000010','restaurant','C06 0161 compatibility');
insert into public.restaurants(id,name,workspace_id) values
  ('16110000-0000-4000-8000-000000000020','C06 0161 compatibility site','16110000-0000-4000-8000-000000000010');
insert into public.workspace_memberships(
  id,workspace_id,user_id,governance_role
) values
  ('16110000-0000-4000-8000-000000000030','16110000-0000-4000-8000-000000000010','16110000-0000-4000-8000-000000000001','workspace_owner'),
  ('16110000-0000-4000-8000-000000000031','16110000-0000-4000-8000-000000000010','16110000-0000-4000-8000-000000000002',null);
insert into public.memberships(
  id,user_id,restaurant_id,role,workspace_membership_id
) values
  ('16110000-0000-4000-8000-000000000040','16110000-0000-4000-8000-000000000001','16110000-0000-4000-8000-000000000020','owner','16110000-0000-4000-8000-000000000030'),
  ('16110000-0000-4000-8000-000000000041','16110000-0000-4000-8000-000000000002','16110000-0000-4000-8000-000000000020','staff','16110000-0000-4000-8000-000000000031');
insert into public.wines(id,restaurant_id,name,producer,vintage,size_ml) values
  ('16110000-0000-4000-8000-000000000050','16110000-0000-4000-8000-000000000020','C06 0161 merge','Contract',2020,750),
  ('16110000-0000-4000-8000-000000000051','16110000-0000-4000-8000-000000000020','C06 0161 merge ','Contract',2020,750),
  ('16110000-0000-4000-8000-000000000052','16110000-0000-4000-8000-000000000020','C06 0161 old receipt','Contract',2021,750);
insert into public.bins(id,restaurant_id,code) values
  ('16110000-0000-4000-8000-000000000060','16110000-0000-4000-8000-000000000020','MERGE-01');

-- Exact historical rows exercise all pre-0161 scalar receipt versions.
insert into public.inventory_command_receipts(
  restaurant_id,operation_id,actor_user_id,wine_id,command_type,
  request_payload,result_payload,completed_at,command_version,scope_kind,batch_entry_count
) values
  (
    '16110000-0000-4000-8000-000000000020',
    '16110000-0000-4000-8000-000000000070',
    '16110000-0000-4000-8000-000000000002',
    '16110000-0000-4000-8000-000000000052','open',
    pg_catalog.jsonb_build_object(
      'version',1,'command','open','wine_id','16110000-0000-4000-8000-000000000052'::uuid,
      'ml',null,'note',null,'preservation_method','none',
      'expected_open_bottle_id',null,'expected_opened_at',null,
      'actual_remaining_ml',null,'written_off_ml',0,'reason_code_id',null
    ),
    pg_catalog.jsonb_build_object(
      'version',1,'operation_id','16110000-0000-4000-8000-000000000070'::uuid,
      'status','committed'
    ),pg_catalog.statement_timestamp(),1,'single_wine',null
  ),
  (
    '16110000-0000-4000-8000-000000000020',
    '16110000-0000-4000-8000-000000000071',
    '16110000-0000-4000-8000-000000000002',
    '16110000-0000-4000-8000-000000000052','open',
    pg_catalog.jsonb_build_object(
      'version',2,'command','open','wine_id','16110000-0000-4000-8000-000000000052'::uuid,
      'open_bottle_id',null,'predecessor_open_operation_id',null,'ml',null,
      'note',null,'preservation_method','none','actual_remaining_ml',null,
      'written_off_ml',0,'reason_code_id',null,'reversal_of_event_id',null,
      'correction_reason',null,'operator_confirms_same_bottle_present',false
    ),
    pg_catalog.jsonb_build_object(
      'version',2,'operation_id','16110000-0000-4000-8000-000000000071'::uuid,
      'status','committed'
    ),pg_catalog.statement_timestamp(),2,'single_wine',null
  ),
  (
    '16110000-0000-4000-8000-000000000020',
    '16110000-0000-4000-8000-000000000072',
    '16110000-0000-4000-8000-000000000002',
    '16110000-0000-4000-8000-000000000052','bottle_inventory_save',
    pg_catalog.jsonb_build_object(
      'version',3,'kind','bottle_inventory_save','name','C06 old save',
      'producer','Contract','vintage',2021,'varietal','Pinot','region','Region',
      'country',null,'size_ml',750,'format',null,'quantity',1,'unit_cost',0
    ),
    '{"status":"committed"}'::jsonb,pg_catalog.statement_timestamp(),
    3,'single_wine',null
  );
insert into public.scan_idempotency(
  key,restaurant_id,response_status,response_body,claimed_by_user_id
) values(
  '16110000-0000-4000-8000-000000000072',
  '16110000-0000-4000-8000-000000000020',200,
  pg_catalog.jsonb_build_object(
    'version',1,'kind','bottle_inventory_save',
    'wineId','16110000-0000-4000-8000-000000000052'::uuid,
    'status','committed','itemCount',1
  ),'16110000-0000-4000-8000-000000000002'
);
create temporary table c06_0161_old_receipts_before on commit drop as
select r.operation_id,r.request_payload,r.result_payload,r.completed_at,
       r.command_version,r.command_type,r.scope_kind,r.batch_entry_count,r.wine_id
  from public.inventory_command_receipts r
 where r.restaurant_id='16110000-0000-4000-8000-000000000020'
   and r.operation_id in (
     '16110000-0000-4000-8000-000000000070',
     '16110000-0000-4000-8000-000000000071',
     '16110000-0000-4000-8000-000000000072'
   );

set local role authenticated;
select pg_catalog.set_config(
  'request.jwt.claim.sub','16110000-0000-4000-8000-000000000002',true
);
do $c06_0161_existing_replays$
declare
  v_site constant uuid := '16110000-0000-4000-8000-000000000020';
  v_wine constant uuid := '16110000-0000-4000-8000-000000000052';
  v_bin constant uuid := '16110000-0000-4000-8000-000000000060';
  v_result jsonb;
begin
  v_result := public.execute_inventory_command(
    '16110000-0000-4000-8000-000000000070',v_site,'open',v_wine
  );
  if v_result->'replayed' is distinct from 'true'::jsonb
     or v_result->>'version' is distinct from '1' then
    raise exception 'C06_0161_V1_REPLAY_CHANGED';
  end if;

  v_result := public.execute_physical_bottle_command(
    '16110000-0000-4000-8000-000000000071',v_site,'open',v_wine
  );
  if v_result->'replayed' is distinct from 'true'::jsonb
     or v_result->>'version' is distinct from '2' then
    raise exception 'C06_0161_V2_REPLAY_CHANGED';
  end if;

  v_result := public.save_bottle_inventory_private(
    v_site,'16110000-0000-4000-8000-000000000072',
    'C06 old save','Contract',2021,'Pinot','Region',null,null,1,0
  );
  if v_result is distinct from pg_catalog.jsonb_build_object(
       'version',1,'kind','bottle_inventory_save','wineId',v_wine,
       'status','committed','itemCount',1
     ) then
    raise exception 'C06_0161_V3_SAVE_REPLAY_CHANGED';
  end if;

  -- The new RPC refuses every old scalar family before mutable wine/bin checks.
  foreach v_result in array array[
    pg_catalog.jsonb_build_object('operation','16110000-0000-4000-8000-000000000070'),
    pg_catalog.jsonb_build_object('operation','16110000-0000-4000-8000-000000000071'),
    pg_catalog.jsonb_build_object('operation','16110000-0000-4000-8000-000000000072')
  ] loop
    begin
      perform public.receive_bottle_at_location_private(
        v_site,(v_result->>'operation')::uuid,v_wine,'Compatibility',v_bin
      );
      raise exception 'C06_0161_EXPECTED_OLD_FAMILY_CONFLICT';
    exception when sqlstate 'P05C1' then null;
    end;
  end loop;
end;
$c06_0161_existing_replays$;

do $c06_0161_new_then_old_refusals$
declare
  v_site constant uuid := '16110000-0000-4000-8000-000000000020';
  v_wine constant uuid := '16110000-0000-4000-8000-000000000050';
  v_bin constant uuid := '16110000-0000-4000-8000-000000000060';
  v_operation constant uuid := '16110000-0000-4000-8000-000000000073';
  v_message text;
begin
  perform public.receive_bottle_at_location_private(
    v_site,v_operation,v_wine,'Merge Section',v_bin
  );

  begin
    perform public.execute_physical_bottle_command(
      v_operation,v_site,'open',v_wine
    );
    raise exception 'C06_0161_EXPECTED_PHYSICAL_FAMILY_REFUSAL';
  exception when sqlstate 'P0001' then
    get stacked diagnostics v_message=message_text;
    if v_message<>'physical_operation_payload_conflict' then raise; end if;
  end;
  begin
    perform public.execute_inventory_command(
      v_operation,v_site,'open',v_wine
    );
    raise exception 'C06_0161_EXPECTED_LEGACY_FAMILY_REFUSAL';
  exception when sqlstate 'P0001' then
    get stacked diagnostics v_message=message_text;
    if v_message<>'legacy_inventory_command_retired' then raise; end if;
  end;
end;
$c06_0161_new_then_old_refusals$;

reset role;
-- The old bottle-save RPC requires its transport claim before reaching the
-- durable type conflict. Establish that transport without changing the new receipt.
select pg_catalog.set_config(
  'request.jwt.claim.sub','16110000-0000-4000-8000-000000000002',true
);
select * from public.claim_scan_idempotency(
  '16110000-0000-4000-8000-000000000020',
  '16110000-0000-4000-8000-000000000073','bottle_inventory_save'
);
set local role authenticated;
do $c06_0161_save_family_refusal$
declare v_message text;
begin
  begin
    perform public.save_bottle_inventory_private(
      '16110000-0000-4000-8000-000000000020',
      '16110000-0000-4000-8000-000000000073',
      'Wrong family','Contract',2020,'Pinot','Region',null,null,1,0
    );
    raise exception 'C06_0161_EXPECTED_SAVE_FAMILY_REFUSAL';
  exception when sqlstate 'P0001' then
    get stacked diagnostics v_message=message_text;
    if v_message<>'C04_BOTTLE_OPERATION_CONFLICT' then raise; end if;
  end;
end;
$c06_0161_save_family_refusal$;

reset role;
-- Legitimate merge moves relational identities but leaves immutable JSON.
select pg_catalog.set_config(
  'request.jwt.claim.sub','16110000-0000-4000-8000-000000000001',true
);
set local role authenticated;
select public.merge_wines(
  '16110000-0000-4000-8000-000000000050',
  '16110000-0000-4000-8000-000000000051'
);
reset role;

do $c06_0161_merge_state$
begin
  if exists (
       select 1 from public.wines w
        where w.id='16110000-0000-4000-8000-000000000050'
     )
     or not exists (
       select 1 from public.inventory_command_receipts r
        where r.restaurant_id='16110000-0000-4000-8000-000000000020'
          and r.operation_id='16110000-0000-4000-8000-000000000073'
          and r.wine_id='16110000-0000-4000-8000-000000000051'
          and r.request_payload->>'wine_id'='16110000-0000-4000-8000-000000000050'
          and r.result_payload->>'wineId'='16110000-0000-4000-8000-000000000050'
     )
     or not exists (
       select 1 from public.inventory_items ii
        where ii.id=(
          select (r.result_payload->>'inventoryItemId')::uuid
            from public.inventory_command_receipts r
           where r.restaurant_id='16110000-0000-4000-8000-000000000020'
             and r.operation_id='16110000-0000-4000-8000-000000000073'
        )
          and ii.wine_id='16110000-0000-4000-8000-000000000051'
     ) then
    raise exception 'C06_0161_MERGE_RELATION_OR_HISTORY_FAILED';
  end if;
end;
$c06_0161_merge_state$;

-- Mutable bin state may drift after commit; completed replay remains exact.
update public.bins
   set code='MERGE-RENAMED',retired_at=pg_catalog.statement_timestamp()
 where id='16110000-0000-4000-8000-000000000060';
set local role authenticated;
select pg_catalog.set_config(
  'request.jwt.claim.sub','16110000-0000-4000-8000-000000000002',true
);
do $c06_0161_immutable_replay_after_drift$
declare v_result jsonb;
begin
  v_result := public.receive_bottle_at_location_private(
    '16110000-0000-4000-8000-000000000020',
    '16110000-0000-4000-8000-000000000073',
    '16110000-0000-4000-8000-000000000050',
    'Merge Section',
    '16110000-0000-4000-8000-000000000060'
  );
  if v_result->'replayed' is distinct from 'true'::jsonb
     or v_result->>'wineId' is distinct from '16110000-0000-4000-8000-000000000050'
     or v_result->>'binCode' is distinct from 'MERGE-01' then
    raise exception 'C06_0161_IMMUTABLE_REPLAY_AFTER_DRIFT_FAILED';
  end if;
end;
$c06_0161_immutable_replay_after_drift$;

reset role;
do $c06_0161_old_receipt_conservation$
begin
  if exists (
    (select * from c06_0161_old_receipts_before
     except
     select r.operation_id,r.request_payload,r.result_payload,r.completed_at,
            r.command_version,r.command_type,r.scope_kind,r.batch_entry_count,r.wine_id
       from public.inventory_command_receipts r
      where r.restaurant_id='16110000-0000-4000-8000-000000000020'
        and r.operation_id in (
          '16110000-0000-4000-8000-000000000070',
          '16110000-0000-4000-8000-000000000071',
          '16110000-0000-4000-8000-000000000072'
        ))
    union all
    (select r.operation_id,r.request_payload,r.result_payload,r.completed_at,
            r.command_version,r.command_type,r.scope_kind,r.batch_entry_count,r.wine_id
       from public.inventory_command_receipts r
      where r.restaurant_id='16110000-0000-4000-8000-000000000020'
        and r.operation_id in (
          '16110000-0000-4000-8000-000000000070',
          '16110000-0000-4000-8000-000000000071',
          '16110000-0000-4000-8000-000000000072'
        )
     except
     select * from c06_0161_old_receipts_before)
  ) then
    raise exception 'C06_0161_OLD_RECEIPT_BYTES_CHANGED';
  end if;
end;
$c06_0161_old_receipt_conservation$;

rollback;
\echo C06_0161_RECEIPT_COMPATIBILITY_PASS
