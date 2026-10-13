-- Local-only rollback regression. Invoke through the guarded CI Docker driver.
-- Canonical lineage confirmation is valid; conflicting derivation must refuse
-- the whole batch before writing accepted history. No manual override is added.
\set ON_ERROR_STOP on
\pset pager off

begin transaction isolation level repeatable read;
set local statement_timeout='30s';
set local lock_timeout='5s';
set local idle_in_transaction_session_timeout='30s';
set local search_path=pg_catalog;
set local row_security=off;



lock table auth.users,public.workspaces,public.restaurants,public.workspace_memberships,
 public.memberships,public.membership_capability_grants,public.wines,
 public.wine_lineages,public.bins,public.inventory_items,public.invoice_scans,
 public.reconcile_batches,public.reconcile_actions,
 public.inventory_command_receipts in share row exclusive mode nowait;

do $ids_unoccupied$
begin
  if exists(select 1 from auth.users where id in(
       '16680000-0000-4000-8000-000000000001','16680000-0000-4000-8000-000000000002')
       or email in ('c04-s18-governor@terroir.test','c04-s18-manager@terroir.test'))
     or exists(select 1 from public.workspaces where id='16680000-0000-4000-8000-000000000010')
     or exists(select 1 from public.restaurants where id='16680000-0000-4000-8000-000000000020')
     or exists(select 1 from public.workspace_memberships where id in(
       '16680000-0000-4000-8000-000000000011','16680000-0000-4000-8000-000000000012'))
     or exists(select 1 from public.memberships where id='16680000-0000-4000-8000-000000000030')
     or exists(select 1 from public.wines where id in(
       '16680000-0000-4000-8000-000000000040','16680000-0000-4000-8000-000000000041',
       '16680000-0000-4000-8000-000000000042'))
     or exists(select 1 from public.bins where id in(
       '16680000-0000-4000-8000-000000000050','16680000-0000-4000-8000-000000000051'))
     or exists(select 1 from public.inventory_items where id in(
       '16680000-0000-4000-8000-000000000060','16680000-0000-4000-8000-000000000061'))
     or exists(select 1 from public.invoice_scans where id='16680000-0000-4000-8000-000000000062')
     or exists(select 1 from public.reconcile_batches where id in(
       '16680000-0000-4000-8000-000000000070','16680000-0000-4000-8000-000000000071',
       '16680000-0000-4000-8000-000000000072','16680000-0000-4000-8000-000000000073',
       '16680000-0000-4000-8000-000000000074')) then
    raise exception 'C04_S18_ID_OCCUPIED';
  end if;
end;
$ids_unoccupied$;

do $receipt_baseline$
begin
  perform set_config('terroir.c04_0166_receipt_count',
    (select count(*)::text from public.inventory_command_receipts),true);
end;
$receipt_baseline$;

savepoint synthetic_fixture;

insert into auth.users(id,email) values
 ('16680000-0000-4000-8000-000000000001','c04-s18-governor@terroir.test'),
 ('16680000-0000-4000-8000-000000000002','c04-s18-manager@terroir.test');
insert into public.workspaces(id,kind,name) values
 ('16680000-0000-4000-8000-000000000010','restaurant','C04 S18 reconcile');
insert into public.restaurants(id,workspace_id,name) values
 ('16680000-0000-4000-8000-000000000020','16680000-0000-4000-8000-000000000010','C04 S18 site');
insert into public.workspace_memberships(id,workspace_id,user_id,governance_role) values
 ('16680000-0000-4000-8000-000000000011','16680000-0000-4000-8000-000000000010','16680000-0000-4000-8000-000000000001','workspace_owner'),
 ('16680000-0000-4000-8000-000000000012','16680000-0000-4000-8000-000000000010','16680000-0000-4000-8000-000000000002',null);
insert into public.memberships(id,user_id,restaurant_id,role,workspace_membership_id) values
 ('16680000-0000-4000-8000-000000000030','16680000-0000-4000-8000-000000000002','16680000-0000-4000-8000-000000000020','manager','16680000-0000-4000-8000-000000000012');
insert into public.wines(id,restaurant_id,name,producer,vintage,size_ml,lwin_id) values
 ('16680000-0000-4000-8000-000000000040','16680000-0000-4000-8000-000000000020','C04 S18 scan target','C04 S18 producer',2020,750,'1668001'),
 ('16680000-0000-4000-8000-000000000041','16680000-0000-4000-8000-000000000020','C04 S18 link subject','C04 S18 producer',2021,750,'1668002'),
 ('16680000-0000-4000-8000-000000000042','16680000-0000-4000-8000-000000000020','C04 S18 lineage target','C04 S18 producer',2022,750,'1668003');
insert into public.bins(id,restaurant_id,code) values
 ('16680000-0000-4000-8000-000000000050','16680000-0000-4000-8000-000000000020','S18-A'),
 ('16680000-0000-4000-8000-000000000051','16680000-0000-4000-8000-000000000020','S18-B');
insert into public.inventory_items(id,restaurant_id,wine_id,quantity,unit_cost,currency,added_via) values
 ('16680000-0000-4000-8000-000000000060','16680000-0000-4000-8000-000000000020','16680000-0000-4000-8000-000000000040',2,21.50,'USD','manual'),
 ('16680000-0000-4000-8000-000000000061','16680000-0000-4000-8000-000000000020','16680000-0000-4000-8000-000000000040',3,22.50,'USD','manual');
insert into public.invoice_scans(
 id,restaurant_id,created_by,distributor_name,parsed_line_items,
 final_line_items,edits,item_count,status
) values(
 '16680000-0000-4000-8000-000000000062','16680000-0000-4000-8000-000000000020',
 '16680000-0000-4000-8000-000000000002','C04 S18 distributor',
 jsonb_build_array(jsonb_build_object(
   'id','s18-line-1','name','C04 unresolved wine','producer','C04 source producer',
   'vintage',2020,'varietal','','region','','qty',1,'unitCost',18.75,'confidence',0.95
 )),
 jsonb_build_array(jsonb_build_object(
   'id','s18-line-1','name','C04 unresolved wine','producer','C04 source producer',
   'vintage',2020,'varietal','','region','','qty',1,'unitCost',18.75,'confidence',0.95
 )),
 '{}',1,'review'
);

do $grant_both_read$
begin
  perform set_config('request.jwt.claim.sub','16680000-0000-4000-8000-000000000001',true);
  perform * from public.replace_member_site_capabilities(
    '16680000-0000-4000-8000-000000000030',array['cost.read','margin.read'],null,
    'C04 S18 private immutable-history verification'
  );
end;
$grant_both_read$;

set local role authenticated;
set local row_security=on;
do $lineage_trigger_conflict$
declare v_target uuid; v_message text;
begin
  perform set_config('request.jwt.claim.sub','16680000-0000-4000-8000-000000000002',true);
  select lineage_id into strict v_target from public.wines
   where id='16680000-0000-4000-8000-000000000042';
  begin
    perform public.accept_reconcile_batch(
      '16680000-0000-4000-8000-000000000020',
      jsonb_build_array(
        jsonb_build_object('action_type','place_bin','subject_table','inventory_items',
          'subject_id','16680000-0000-4000-8000-000000000060',
          'patch',jsonb_build_object('bin_id','16680000-0000-4000-8000-000000000050')),
        jsonb_build_object('action_type','link_lineage','subject_table','wines',
          'subject_id','16680000-0000-4000-8000-000000000041',
          'patch',jsonb_build_object('lineage_id',v_target))),
      '16680000-0000-4000-8000-000000000073');
    raise exception 'C04_EXPECTED_LINEAGE_CONFLICT_REFUSAL_MISSING';
  exception when sqlstate 'P0001' then
    get stacked diagnostics v_message=message_text;
    if v_message<>'reconcile_subject_conflict' then raise; end if;
  end;
end;
$lineage_trigger_conflict$;
reset role;
do $lineage_conflict_zero_effect$
begin
  if not exists(select 1 from public.inventory_items
       where id='16680000-0000-4000-8000-000000000060'
         and bin_id is null and bin_location is null and quantity=2 and unit_cost=21.50)
    or exists(select 1 from public.reconcile_batches where id='16680000-0000-4000-8000-000000000073')
    or exists(select 1 from public.reconcile_actions where batch_id='16680000-0000-4000-8000-000000000073')
    or not exists(select 1 from public.wines w join public.wine_lineages l on l.id=w.lineage_id
       where w.id='16680000-0000-4000-8000-000000000041' and l.lwin7='1668002') then
    raise exception 'C04_LINEAGE_CONFLICT_NOT_ATOMIC';
  end if;
end;
$lineage_conflict_zero_effect$;

set local role authenticated;
set local row_security=on;
do $valid_four_action_flow$
declare
  v_line jsonb;
  v_target_lineage uuid;
  v_actions jsonb;
  v_result jsonb;
  v_history_before jsonb;
  v_history_after jsonb;
  v_message text;
begin
  perform set_config('request.jwt.claim.sub','16680000-0000-4000-8000-000000000002',true);
  v_line:=jsonb_build_object(
    'id','s18-line-1','name','C04 unresolved wine','producer','C04 source producer',
    'vintage',2020,'varietal','','region','','qty',1,'unitCost',18.75,'confidence',0.95
  );
  select lineage_id into strict v_target_lineage from public.wines
   where id='16680000-0000-4000-8000-000000000041';
  v_actions:=jsonb_build_array(
    jsonb_build_object(
      'action_type','place_bin','subject_table','inventory_items',
      'subject_id','16680000-0000-4000-8000-000000000060',
      'patch',jsonb_build_object('bin_id','16680000-0000-4000-8000-000000000050')
    ),
    jsonb_build_object(
      'action_type','match_scan','subject_table','invoice_scans',
      'subject_id','16680000-0000-4000-8000-000000000062',
      'patch',jsonb_build_object(
        'line_index',0,'wine_id','16680000-0000-4000-8000-000000000040','expected_line',v_line
      )
    ),
    jsonb_build_object(
      'action_type','link_lineage','subject_table','wines',
      'subject_id','16680000-0000-4000-8000-000000000041',
      'patch',jsonb_build_object('lineage_id',v_target_lineage)
    ),
    jsonb_build_object(
      'action_type','dismiss','subject_table','wines',
      'subject_id','16680000-0000-4000-8000-000000000040','patch','{}'::jsonb
    )
  );

  v_result:=public.accept_reconcile_batch(
    '16680000-0000-4000-8000-000000000020',v_actions,
    '16680000-0000-4000-8000-000000000070'
  );
  if v_result is distinct from jsonb_build_object(
       'batchId','16680000-0000-4000-8000-000000000070'::uuid,
       'actionCount',4,'status','accepted'
     ) then
    raise exception 'C04_S18_VALID_ACCEPT_RECEIPT_MISMATCH';
  end if;
  if public.accept_reconcile_batch(
       '16680000-0000-4000-8000-000000000020',v_actions,
       '16680000-0000-4000-8000-000000000070'
     ) is distinct from v_result then
    raise exception 'C04_S18_VALID_ACCEPT_REPLAY_MISMATCH';
  end if;

  select jsonb_agg(to_jsonb(r) order by r.ordinal,r.action_id) into strict v_history_before
    from public.read_reconcile_action_private('16680000-0000-4000-8000-000000000070') r;
  if jsonb_array_length(v_history_before)<>4 then
    raise exception 'C04_S18_PRIVATE_HISTORY_COUNT_MISMATCH';
  end if;

  v_result:=public.undo_reconcile_batch('16680000-0000-4000-8000-000000000070');
  if v_result->>'batchId' is distinct from '16680000-0000-4000-8000-000000000070'
     or v_result->>'actionCount' is distinct from '4'
     or v_result->>'status' is distinct from 'undone'
     or jsonb_typeof(v_result->'undoneAt')<>'string'
     or (select count(*) from jsonb_object_keys(v_result))<>4 then
    raise exception 'C04_S18_VALID_UNDO_RECEIPT_MISMATCH';
  end if;
  select jsonb_agg(to_jsonb(r) order by r.ordinal,r.action_id) into strict v_history_after
    from public.read_reconcile_action_private('16680000-0000-4000-8000-000000000070') r;
  if v_history_after is distinct from v_history_before then
    raise exception 'C04_S18_HISTORY_MUTATED_BY_UNDO';
  end if;

  begin
    perform public.undo_reconcile_batch('16680000-0000-4000-8000-000000000070');
    raise exception 'C04_EXPECTED_REPEAT_UNDO_REFUSAL';
  exception when sqlstate 'P0001' then
    get stacked diagnostics v_message=message_text;
    if v_message<>'reconcile_batch_already_undone' then raise; end if;
  end;
end;
$valid_four_action_flow$;
reset role;

do $valid_flow_postimage$
declare v_line jsonb;
begin
  v_line:=jsonb_build_object(
    'id','s18-line-1','name','C04 unresolved wine','producer','C04 source producer',
    'vintage',2020,'varietal','','region','','qty',1,'unitCost',18.75,'confidence',0.95
  );
  if not exists(select 1 from public.inventory_items
       where id='16680000-0000-4000-8000-000000000060'
         and bin_id is null and bin_location is null and quantity=2 and unit_cost=21.50)
     or (select final_line_items from public.invoice_scans
          where id='16680000-0000-4000-8000-000000000062')
        is distinct from jsonb_build_array(v_line)
     or not exists(select 1 from public.wines w join public.wine_lineages l on l.id=w.lineage_id
          where w.id='16680000-0000-4000-8000-000000000041' and l.lwin7='1668002')
     or not exists(select 1 from public.reconcile_batches
          where id='16680000-0000-4000-8000-000000000070'
            and action_count=4 and undone_at is not null
            and undone_by='16680000-0000-4000-8000-000000000002')
     or (select array_agg(action_type order by ordinal) from public.reconcile_actions
          where batch_id='16680000-0000-4000-8000-000000000070')
        is distinct from array['place_bin','match_scan','link_lineage','dismiss']::text[] then
    raise exception 'C04_S18_VALID_FLOW_POSTIMAGE_MISMATCH';
  end if;
end;
$valid_flow_postimage$;

set local role authenticated;
set local row_security=on;
do $invalid_mixed_batch$
declare v_line jsonb; v_actions jsonb; v_message text;
begin
  perform set_config('request.jwt.claim.sub','16680000-0000-4000-8000-000000000002',true);
  v_line:=jsonb_build_object(
    'id','s18-line-1','name','C04 wrong expected wine','producer','C04 source producer',
    'vintage',2020,'varietal','','region','','qty',1,'unitCost',18.75,'confidence',0.95
  );
  v_actions:=jsonb_build_array(
    jsonb_build_object(
      'action_type','place_bin','subject_table','inventory_items',
      'subject_id','16680000-0000-4000-8000-000000000061',
      'patch',jsonb_build_object('bin_id','16680000-0000-4000-8000-000000000050')
    ),
    jsonb_build_object(
      'action_type','match_scan','subject_table','invoice_scans',
      'subject_id','16680000-0000-4000-8000-000000000062',
      'patch',jsonb_build_object(
        'line_index',0,'wine_id','16680000-0000-4000-8000-000000000040','expected_line',v_line
      )
    )
  );
  begin
    perform public.accept_reconcile_batch(
      '16680000-0000-4000-8000-000000000020',v_actions,
      '16680000-0000-4000-8000-000000000071'
    );
    raise exception 'C04_EXPECTED_INVALID_MIXED_BATCH_REFUSAL';
  exception when sqlstate 'P0001' then
    get stacked diagnostics v_message=message_text;
    if v_message<>'reconcile_subject_conflict' then raise; end if;
  end;
end;
$invalid_mixed_batch$;
reset role;

do $invalid_mixed_postimage$
begin
  if not exists(select 1 from public.inventory_items
       where id='16680000-0000-4000-8000-000000000061'
         and bin_id is null and bin_location is null and quantity=3 and unit_cost=22.50)
     or exists(select 1 from public.reconcile_batches
          where id='16680000-0000-4000-8000-000000000071')
     or exists(select 1 from public.reconcile_actions
          where batch_id='16680000-0000-4000-8000-000000000071') then
    raise exception 'C04_S18_INVALID_MIXED_BATCH_NOT_ATOMIC';
  end if;
end;
$invalid_mixed_postimage$;

set local role authenticated;
set local row_security=on;
do $stale_setup$
declare v_result jsonb;
begin
  perform set_config('request.jwt.claim.sub','16680000-0000-4000-8000-000000000002',true);
  v_result:=public.accept_reconcile_batch(
    '16680000-0000-4000-8000-000000000020',
    jsonb_build_array(jsonb_build_object(
      'action_type','place_bin','subject_table','inventory_items',
      'subject_id','16680000-0000-4000-8000-000000000061',
      'patch',jsonb_build_object('bin_id','16680000-0000-4000-8000-000000000050')
    )),
    '16680000-0000-4000-8000-000000000072'
  );
  if v_result->>'status' is distinct from 'accepted'
     or v_result->>'actionCount' is distinct from '1' then
    raise exception 'C04_S18_STALE_SETUP_RECEIPT_MISMATCH';
  end if;
end;
$stale_setup$;
reset role;

update public.inventory_items
   set bin_id='16680000-0000-4000-8000-000000000051',bin_location='S18-B'
 where id='16680000-0000-4000-8000-000000000061'
   and restaurant_id='16680000-0000-4000-8000-000000000020';

set local role authenticated;
set local row_security=on;
do $stale_undo_negative$
declare v_message text;
begin
  perform set_config('request.jwt.claim.sub','16680000-0000-4000-8000-000000000002',true);
  begin
    perform public.undo_reconcile_batch('16680000-0000-4000-8000-000000000072');
    raise exception 'C04_EXPECTED_STALE_UNDO_REFUSAL';
  exception when sqlstate 'P0001' then
    get stacked diagnostics v_message=message_text;
    if v_message<>'reconcile_subject_changed' then raise; end if;
  end;
end;
$stale_undo_negative$;
reset role;

do $stale_postimage$
begin
  if not exists(select 1 from public.inventory_items
       where id='16680000-0000-4000-8000-000000000061'
         and bin_id='16680000-0000-4000-8000-000000000051'
         and bin_location='S18-B' and quantity=3 and unit_cost=22.50)
     or not exists(select 1 from public.reconcile_batches
       where id='16680000-0000-4000-8000-000000000072'
         and action_count=1 and undone_at is null and undone_by is null)
     or not exists(select 1 from public.reconcile_actions
       where batch_id='16680000-0000-4000-8000-000000000072' and ordinal=0
         and action_type='place_bin' and subject_table='inventory_items'
         and subject_id='16680000-0000-4000-8000-000000000061'
         and prior_state=jsonb_build_object('bin_id',null,'bin_location',null)
         and new_state=jsonb_build_object(
           'bin_id','16680000-0000-4000-8000-000000000050'::uuid,'bin_location','S18-A'
         )) then
    raise exception 'C04_S18_STALE_UNDO_SIDE_EFFECT';
  end if;
end;
$stale_postimage$;

-- A synthetic legacy action describes a prior lineage that derivation will
-- reject. Undo must not mark it undone while the actual wine remains unchanged.
insert into public.reconcile_batches(id,restaurant_id,created_by,action_count)
values('16680000-0000-4000-8000-000000000074',
 '16680000-0000-4000-8000-000000000020','16680000-0000-4000-8000-000000000002',1);
insert into public.reconcile_actions(batch_id,restaurant_id,action_type,subject_table,
 subject_id,ordinal,prior_state,new_state)
select '16680000-0000-4000-8000-000000000074','16680000-0000-4000-8000-000000000020',
 'link_lineage','wines','16680000-0000-4000-8000-000000000041',0,
 jsonb_build_object('lineage_id',other.lineage_id),jsonb_build_object('lineage_id',own.lineage_id)
from public.wines own cross join public.wines other
where own.id='16680000-0000-4000-8000-000000000041'
 and other.id='16680000-0000-4000-8000-000000000042';

set local role authenticated;
set local row_security=on;
do $undo_trigger_conflict$
declare v_message text;
begin
  perform set_config('request.jwt.claim.sub','16680000-0000-4000-8000-000000000002',true);
  begin
    perform public.undo_reconcile_batch('16680000-0000-4000-8000-000000000074');
    raise exception 'C04_EXPECTED_UNDO_LINEAGE_CONFLICT_REFUSAL_MISSING';
  exception when sqlstate 'P0001' then
    get stacked diagnostics v_message=message_text;
    if v_message<>'reconcile_subject_changed' then raise; end if;
  end;
end;
$undo_trigger_conflict$;
reset role;
do $undo_trigger_conflict_zero_effect$
begin
  if not exists(select 1 from public.reconcile_batches
      where id='16680000-0000-4000-8000-000000000074'
        and undone_at is null and undone_by is null)
    or not exists(select 1 from public.wines w join public.wine_lineages l on l.id=w.lineage_id
       where w.id='16680000-0000-4000-8000-000000000041' and l.lwin7='1668002')
    or not exists(select 1 from public.reconcile_actions a
      join public.wines own on own.id=a.subject_id
      cross join public.wines other
      where a.batch_id='16680000-0000-4000-8000-000000000074'
        and other.id='16680000-0000-4000-8000-000000000042'
        and a.prior_state=jsonb_build_object('lineage_id',other.lineage_id)
        and a.new_state=jsonb_build_object('lineage_id',own.lineage_id)) then
    raise exception 'C04_UNDO_LINEAGE_CONFLICT_NOT_ATOMIC';
  end if;
end;
$undo_trigger_conflict_zero_effect$;

rollback to savepoint synthetic_fixture;

do $rollback_check$
begin
  if (select count(*) from public.inventory_command_receipts)<>
       current_setting('terroir.c04_0166_receipt_count')::bigint
     or exists(select 1 from auth.users where id in(
       '16680000-0000-4000-8000-000000000001','16680000-0000-4000-8000-000000000002'))
     or exists(select 1 from public.workspaces where id='16680000-0000-4000-8000-000000000010')
     or exists(select 1 from public.restaurants where id='16680000-0000-4000-8000-000000000020')
     or exists(select 1 from public.wines where id in(
       '16680000-0000-4000-8000-000000000040','16680000-0000-4000-8000-000000000041',
       '16680000-0000-4000-8000-000000000042'))
     or exists(select 1 from public.inventory_items where id in(
       '16680000-0000-4000-8000-000000000060','16680000-0000-4000-8000-000000000061'))
     or exists(select 1 from public.reconcile_batches where id in(
       '16680000-0000-4000-8000-000000000070','16680000-0000-4000-8000-000000000071',
       '16680000-0000-4000-8000-000000000072','16680000-0000-4000-8000-000000000073',
       '16680000-0000-4000-8000-000000000074')) then
    raise exception 'C04_S18_ROLLBACK_FAILED';
  end if;
end;
$rollback_check$;

rollback;
select 'C04_0166_RECONCILE_LINEAGE_REGRESSION_ROLLBACK_PASS' as evidence;
