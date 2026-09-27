-- 0158 lifecycle reader, durable replay, conflicts, cleanup, ACL and merge.
-- Exact disposable database only; every fixture write is rolled back.
\set ON_ERROR_STOP on
\pset pager off

begin;
do $core_acceptance$
declare
  v_actor_a uuid := '15800000-0000-4000-8000-000000000001';
  v_actor_b uuid := '15800000-0000-4000-8000-000000000002';
  v_auto_site_a uuid;
  v_workspace uuid := '15800000-0000-4000-8000-000000000003';
  v_other_workspace uuid := '15800000-0000-4000-8000-000000000004';
  v_wm_a uuid := '15800000-0000-4000-8000-000000000005';
  v_wm_b uuid := '15800000-0000-4000-8000-000000000006';
  v_wm_wrong uuid := '15800000-0000-4000-8000-000000000007';
  v_site uuid := '15800000-0000-4000-8000-000000000010';
  v_recent_site uuid := '15800000-0000-4000-8000-000000000011';
  v_membership uuid := '15800000-0000-4000-8000-000000000012';
  v_recent_membership uuid := '15800000-0000-4000-8000-000000000013';
  v_actor_b_membership uuid := '15800000-0000-4000-8000-000000000014';
  v_key uuid := '15800000-0000-4000-8000-000000000020';
  v_wine uuid;
  v_target_wine uuid := '15800000-0000-4000-8000-000000000021';
  v_result jsonb;
  v_replay jsonb;
  v_message text;
  v_sites uuid[];
  v_inventory_count integer;
  v_inventory_quantity bigint;
begin
  if current_database() <> 'terroir_cost_seal_20260926b'
     or public.current_inventory_contract_version() <> 2
     or to_regprocedure('public.save_bottle_inventory_private(uuid,uuid,text,text,integer,text,text,text,text,integer,numeric)') is null then
    raise exception 'C04_0158_TARGET_NOT_ADMITTED';
  end if;

  insert into auth.users(id,email) values
    (v_actor_a,'c04-0158-a@terroir.test'),
    (v_actor_b,'c04-0158-b@terroir.test');
  select restaurant_id into strict v_auto_site_a
    from public.memberships where user_id=v_actor_a;
  insert into public.workspaces(id,kind,name) values
    (v_workspace,'restaurant','C04 0158 workspace'),
    (v_other_workspace,'restaurant','C04 0158 wrong workspace');
  insert into public.restaurants(id,name,workspace_id) values
    (v_site,'C04 0158 site',v_workspace),
    (v_recent_site,'C04 0158 recent site',v_workspace);
  insert into public.workspace_memberships(id,workspace_id,user_id) values
    (v_wm_a,v_workspace,v_actor_a),
    (v_wm_b,v_workspace,v_actor_b),
    (v_wm_wrong,v_other_workspace,v_actor_a);
  insert into public.memberships(
    id,user_id,restaurant_id,role,workspace_membership_id,created_at
  ) values
    (v_membership,v_actor_a,v_site,'staff',v_wm_a,statement_timestamp()-interval '2 days'),
    (v_recent_membership,v_actor_a,v_recent_site,'owner',v_wm_a,statement_timestamp()-interval '1 day'),
    (v_actor_b_membership,v_actor_b,v_site,'staff',v_wm_b,statement_timestamp());

  perform set_config('request.jwt.claim.sub',v_actor_a::text,true);
  select array_agg(x.restaurant_id order by x.ordinality)
    into v_sites
    from public.read_current_operational_memberships(v_actor_a)
         with ordinality x(restaurant_id,restaurant_name,role,ordinality);
  if v_sites is distinct from array[v_auto_site_a,v_recent_site,v_site]::uuid[] then
    raise exception 'C04_0158_READER_ORDER_OR_PROJECTION_FAILED';
  end if;
  if exists(select 1 from public.read_current_operational_memberships(v_actor_b))
     or (select count(*) from public.read_current_operational_memberships(null))<>0 then
    raise exception 'C04_0158_READER_FOREIGN_ARGUMENT_FAILED';
  end if;
  perform set_config('request.jwt.claim.sub','',true);
  if exists(select 1 from public.read_current_operational_memberships(v_actor_a)) then
    raise exception 'C04_0158_READER_ANONYMOUS_FAILED';
  end if;
  perform set_config('request.jwt.claim.sub',v_actor_a::text,true);

  update public.memberships set expires_at=statement_timestamp()
   where id=v_recent_membership;
  if exists(select 1 from public.read_current_operational_memberships(v_actor_a)
             where restaurant_id=v_recent_site) then
    raise exception 'C04_0158_READER_SITE_EXPIRY_BOUNDARY_FAILED';
  end if;
  update public.memberships set expires_at=null,status='revoked',revoked_at=statement_timestamp()
   where id=v_recent_membership;
  if exists(select 1 from public.read_current_operational_memberships(v_actor_a)
             where restaurant_id=v_recent_site) then
    raise exception 'C04_0158_READER_SITE_REVOCATION_FAILED';
  end if;
  update public.memberships set status='active',revoked_at=null where id=v_recent_membership;

  update public.workspace_memberships set expires_at=statement_timestamp() where id=v_wm_a;
  if (select array_agg(restaurant_id) from public.read_current_operational_memberships(v_actor_a))
     is distinct from array[v_auto_site_a]::uuid[] then
    raise exception 'C04_0158_READER_WORKSPACE_EXPIRY_BOUNDARY_FAILED';
  end if;
  update public.workspace_memberships set expires_at=null,status='revoked',revoked_at=statement_timestamp()
   where id=v_wm_a;
  if (select array_agg(restaurant_id) from public.read_current_operational_memberships(v_actor_a))
     is distinct from array[v_auto_site_a]::uuid[] then
    raise exception 'C04_0158_READER_WORKSPACE_REVOCATION_FAILED';
  end if;
  update public.workspace_memberships set status='active',revoked_at=null where id=v_wm_a;

  execute 'alter table public.memberships disable trigger memberships_link_workspace';
  update public.memberships set workspace_membership_id=v_wm_wrong where id=v_membership;
  execute 'alter table public.memberships enable trigger memberships_link_workspace';
  if exists(select 1 from public.read_current_operational_memberships(v_actor_a)
             where restaurant_id=v_site) then
    raise exception 'C04_0158_READER_WRONG_LINK_FAILED';
  end if;
  execute 'alter table public.memberships disable trigger memberships_link_workspace';
  update public.memberships set workspace_membership_id=v_wm_a where id=v_membership;
  execute 'alter table public.memberships enable trigger memberships_link_workspace';

  if public.effective_site_capability(v_site,'cost.read')
     or public.effective_site_capability(v_site,'pricing.manage') then
    raise exception 'C04_0158_STAFF_FIXTURE_HAS_PRICING_AUTHORITY';
  end if;
  perform * from public.claim_scan_idempotency(v_site,v_key,'bottle_inventory_save');
  v_result:=public.save_bottle_inventory_private(
    v_site,v_key,' Bridge Wine ',' Bridge Producer ',2022,'','',null,null,3,12.50
  );
  v_wine:=(v_result->>'wineId')::uuid;
  if v_result is distinct from jsonb_build_object(
       'version',1,'kind','bottle_inventory_save','wineId',v_wine,
       'status','committed','itemCount',1
     )
     or not exists(select 1 from public.inventory_items ii
                    where ii.restaurant_id=v_site and ii.wine_id=v_wine
                      and ii.quantity=3 and ii.unit_cost=12.50
                      and ii.invoice_scan_id is null and ii.added_via='bottle_scan')
     or not exists(select 1 from public.inventory_command_receipts r
                    where r.restaurant_id=v_site and r.operation_id=v_key
                      and r.actor_user_id=v_actor_a and r.wine_id=v_wine
                      and r.command_version=3 and r.command_type='bottle_inventory_save'
                      and r.scope_kind='single_wine' and r.batch_entry_count is null
                      and r.result_payload='{"status":"committed"}'::jsonb
                      and r.completed_at is not null) then
    raise exception 'C04_0158_STAFF_SAVE_FAILED';
  end if;
  select count(*),coalesce(sum(quantity),0) into v_inventory_count,v_inventory_quantity
    from public.inventory_items where restaurant_id=v_site;

  update public.scan_idempotency set created_at=statement_timestamp()-interval '25 hours'
   where restaurant_id=v_site and key=v_key;
  perform public.cleanup_scan_idempotency();
  if exists(select 1 from public.scan_idempotency where restaurant_id=v_site and key=v_key)
     or not exists(select 1 from public.inventory_command_receipts
                    where restaurant_id=v_site and operation_id=v_key) then
    raise exception 'C04_0158_TRANSPORT_CLEANUP_REMOVED_DURABLE_RECEIPT';
  end if;
  perform * from public.claim_scan_idempotency(v_site,v_key,'bottle_inventory_save');
  v_replay:=public.save_bottle_inventory_private(
    v_site,v_key,'Bridge Wine','Bridge Producer',2022,'','',null,null,3,12.50
  );
  if v_replay is distinct from v_result
     or (select count(*) from public.inventory_items where restaurant_id=v_site)<>v_inventory_count
     or (select coalesce(sum(quantity),0) from public.inventory_items where restaurant_id=v_site)<>v_inventory_quantity then
    raise exception 'C04_0158_DURABLE_REPLAY_MUTATED_STOCK';
  end if;

  update public.scan_idempotency set created_at=statement_timestamp()-interval '25 hours'
   where restaurant_id=v_site and key=v_key;
  perform public.cleanup_scan_idempotency();
  perform set_config('request.jwt.claim.sub',v_actor_b::text,true);
  perform * from public.claim_scan_idempotency(v_site,v_key,'bottle_inventory_save');
  begin
    perform public.save_bottle_inventory_private(
      v_site,v_key,'Bridge Wine','Bridge Producer',2022,'','',null,null,3,12.50
    );
    raise exception 'C04_EXPECTED_BOTTLE_ACTOR_CONFLICT';
  exception when sqlstate 'P0001' then
    get stacked diagnostics v_message=message_text;
    if v_message<>'C04_BOTTLE_OPERATION_CONFLICT' then raise; end if;
  end;

  update public.scan_idempotency set created_at=statement_timestamp()-interval '25 hours'
   where restaurant_id=v_site and key=v_key;
  perform public.cleanup_scan_idempotency();
  perform set_config('request.jwt.claim.sub',v_actor_a::text,true);
  perform * from public.claim_scan_idempotency(v_site,v_key,'bottle_inventory_save');
  begin
    perform public.save_bottle_inventory_private(
      v_site,v_key,'Bridge Wine','Bridge Producer',2022,'','',null,null,4,12.50
    );
    raise exception 'C04_EXPECTED_BOTTLE_PAYLOAD_CONFLICT';
  exception when sqlstate 'P0001' then
    get stacked diagnostics v_message=message_text;
    if v_message<>'C04_BOTTLE_OPERATION_CONFLICT' then raise; end if;
  end;
  if (select count(*) from public.inventory_items where restaurant_id=v_site)<>v_inventory_count
     or (select coalesce(sum(quantity),0) from public.inventory_items where restaurant_id=v_site)<>v_inventory_quantity then
    raise exception 'C04_0158_CONFLICT_MUTATED_STOCK';
  end if;

  update public.scan_idempotency set created_at=statement_timestamp()-interval '25 hours'
   where restaurant_id=v_site and key=v_key;
  perform public.cleanup_scan_idempotency();
  update public.memberships set role='manager' where id=v_membership;
  update public.wines set lwin_id='1580000' where id=v_wine;
  insert into public.wines(id,restaurant_id,name,producer,vintage,size_ml,lwin_id)
    values(v_target_wine,v_site,'Bridge Wine Alias','Bridge Producer',2022,750,'1580000');
  perform public.merge_wines(v_wine,v_target_wine);
  if exists(select 1 from public.wines where id=v_wine)
     or not exists(select 1 from public.inventory_command_receipts
                    where restaurant_id=v_site and operation_id=v_key
                      and wine_id=v_target_wine) then
    raise exception 'C04_0158_MERGE_DID_NOT_MOVE_RECEIPT';
  end if;
  perform * from public.claim_scan_idempotency(v_site,v_key,'bottle_inventory_save');
  v_replay:=public.save_bottle_inventory_private(
    v_site,v_key,'Bridge Wine','Bridge Producer',2022,'','',null,null,3,12.50
  );
  if v_replay->>'wineId' is distinct from v_target_wine::text
     or (select count(*) from public.inventory_items where restaurant_id=v_site)<>v_inventory_count
     or (select coalesce(sum(quantity),0) from public.inventory_items where restaurant_id=v_site)<>v_inventory_quantity then
    raise exception 'C04_0158_POST_MERGE_REPLAY_FAILED';
  end if;

  if has_table_privilege('authenticated','public.inventory_command_receipts','SELECT')
     or has_table_privilege('anon','public.inventory_command_receipts','SELECT') then
    raise exception 'C04_0158_RECEIPT_ACL_WIDENED';
  end if;
end;
$core_acceptance$;
rollback;
\echo C04_0158_CORE_ACCEPTANCE_PASS
