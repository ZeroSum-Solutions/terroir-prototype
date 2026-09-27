-- 0158 completed-transport durable replay and refusal regression.
-- Every fixture write is inside this transaction and is rolled back.
\set ON_ERROR_STOP on
\pset pager off

begin;

do $completed_transport_replay$
declare
  v_actor constant uuid := '15850000-0000-4000-8000-000000000001';
  v_other_actor constant uuid := '15850000-0000-4000-8000-000000000007';
  v_workspace constant uuid := '15850000-0000-4000-8000-000000000002';
  v_workspace_membership constant uuid := '15850000-0000-4000-8000-000000000003';
  v_other_workspace_membership constant uuid := '15850000-0000-4000-8000-000000000008';
  v_membership constant uuid := '15850000-0000-4000-8000-000000000004';
  v_other_membership constant uuid := '15850000-0000-4000-8000-000000000009';
  v_site constant uuid := '15850000-0000-4000-8000-000000000005';
  v_marker_wine constant uuid := '15850000-0000-4000-8000-000000000006';
  v_replay_key constant uuid := '15850000-0000-4000-8000-000000000010';
  v_missing_key constant uuid := '15850000-0000-4000-8000-000000000011';
  v_malformed_key constant uuid := '15850000-0000-4000-8000-000000000012';
  v_wrong_kind_key constant uuid := '15850000-0000-4000-8000-000000000013';
  v_expired_key constant uuid := '15850000-0000-4000-8000-000000000014';
  v_first jsonb;
  v_replay jsonb;
  v_message text;
  v_inventory_count bigint;
  v_inventory_quantity bigint;
  v_wine_count bigint;
  v_request jsonb;
begin
  if current_database()<>'terroir_cost_seal_20260926b'
     or public.current_inventory_contract_version()<>2
     or to_regprocedure('public.save_bottle_inventory_private(uuid,uuid,text,text,integer,text,text,text,text,integer,numeric)') is null
     or to_regprocedure('public.claim_scan_idempotency(uuid,uuid,text)') is null
     or to_regprocedure('public.complete_scan_idempotency(uuid,uuid,text,uuid,integer,integer,uuid)') is null then
    raise exception 'C04_0158_TARGET_NOT_ADMITTED';
  end if;

  insert into auth.users(id,email) values
    (v_actor,'c04-0158-completed-replay@terroir.test'),
    (v_other_actor,'c04-0158-completed-replay-other@terroir.test');
  insert into public.workspaces(id,kind,name) values
    (v_workspace,'restaurant','C04 0158 completed replay');
  insert into public.restaurants(id,name,workspace_id) values
    (v_site,'C04 0158 completed replay site',v_workspace);
  insert into public.workspace_memberships(id,workspace_id,user_id) values
    (v_workspace_membership,v_workspace,v_actor),
    (v_other_workspace_membership,v_workspace,v_other_actor);
  insert into public.memberships(
    id,user_id,restaurant_id,role,workspace_membership_id
  ) values
    (v_membership,v_actor,v_site,'staff',v_workspace_membership),
    (v_other_membership,v_other_actor,v_site,'staff',v_other_workspace_membership);
  insert into public.wines(
    id,restaurant_id,name,producer,vintage,size_ml
  ) values(
    v_marker_wine,v_site,'Transport marker','Fixture Producer',2021,750
  );
  perform set_config('request.jwt.claim.sub',v_actor::text,true);

  -- Establish one real completed transport and durable version-3 operation.
  perform * from public.claim_scan_idempotency(
    v_site,v_replay_key,'bottle_inventory_save'
  );
  v_first:=public.save_bottle_inventory_private(
    v_site,v_replay_key,'Replay Wine','Replay Producer',2022,
    'Pinot Noir','Willamette',null,null,2,15
  );
  select count(*),coalesce(sum(quantity),0)
    into v_inventory_count,v_inventory_quantity
    from public.inventory_items where restaurant_id=v_site;
  select count(*) into v_wine_count
    from public.wines where restaurant_id=v_site;

  -- R2 contract: a completed current transport must still enter the durable
  -- validator. Exact input returns the same receipt with no second stock effect.
  v_replay:=public.save_bottle_inventory_private(
    v_site,v_replay_key,'Replay Wine','Replay Producer',2022,
    'Pinot Noir','Willamette',null,null,2,15
  );
  if v_replay is distinct from v_first
     or (select count(*) from public.inventory_items where restaurant_id=v_site)<>v_inventory_count
     or (select coalesce(sum(quantity),0) from public.inventory_items where restaurant_id=v_site)<>v_inventory_quantity
     or (select count(*) from public.wines where restaurant_id=v_site)<>v_wine_count then
    raise exception 'C04_0158_COMPLETED_REPLAY_MUTATED_STOCK';
  end if;

  -- A different current staff actor cannot reuse another actor's completed
  -- transport, even with identical input.
  perform set_config('request.jwt.claim.sub',v_other_actor::text,true);
  begin
    perform public.save_bottle_inventory_private(
      v_site,v_replay_key,'Replay Wine','Replay Producer',2022,
      'Pinot Noir','Willamette',null,null,2,15
    );
    raise exception 'C04_0158_EXPECTED_COMPLETED_ACTOR_REFUSAL';
  exception when sqlstate 'P0001' then
    get stacked diagnostics v_message=message_text;
    if v_message<>'C04_BOTTLE_TRANSPORT_CLAIM_REQUIRED' then raise; end if;
  end;
  perform set_config('request.jwt.claim.sub',v_actor::text,true);

  -- The same completed transport cannot hide changed quantity.
  begin
    perform public.save_bottle_inventory_private(
      v_site,v_replay_key,'Replay Wine','Replay Producer',2022,
      'Pinot Noir','Willamette',null,null,3,15
    );
    raise exception 'C04_0158_EXPECTED_COMPLETED_QUANTITY_CONFLICT';
  exception when sqlstate 'P0001' then
    get stacked diagnostics v_message=message_text;
    if v_message<>'C04_BOTTLE_OPERATION_CONFLICT' then raise; end if;
  end;

  -- The same completed transport cannot hide changed unit cost.
  begin
    perform public.save_bottle_inventory_private(
      v_site,v_replay_key,'Replay Wine','Replay Producer',2022,
      'Pinot Noir','Willamette',null,null,2,99
    );
    raise exception 'C04_0158_EXPECTED_COMPLETED_COST_CONFLICT';
  exception when sqlstate 'P0001' then
    get stacked diagnostics v_message=message_text;
    if v_message<>'C04_BOTTLE_OPERATION_CONFLICT' then raise; end if;
  end;

  -- A closed transport receipt without its durable business receipt must not
  -- fall through to wine resolution or inventory creation.
  perform * from public.claim_scan_idempotency(
    v_site,v_missing_key,'bottle_inventory_save'
  );
  perform public.complete_scan_idempotency(
    v_site,v_missing_key,'bottle_inventory_save',null,1,null,v_marker_wine
  );
  begin
    perform public.save_bottle_inventory_private(
      v_site,v_missing_key,'Missing Durable','Fixture Producer',2021,
      'Pinot Noir','Region',null,null,1,10
    );
    raise exception 'C04_0158_EXPECTED_MISSING_DURABLE_REFUSAL';
  exception when sqlstate 'P0001' then
    get stacked diagnostics v_message=message_text;
    if v_message<>'C04_BOTTLE_OPERATION_INCOMPLETE' then raise; end if;
  end;

  -- An exact durable request with a malformed completion marker also refuses
  -- before stock.
  perform * from public.claim_scan_idempotency(
    v_site,v_malformed_key,'bottle_inventory_save'
  );
  perform public.complete_scan_idempotency(
    v_site,v_malformed_key,'bottle_inventory_save',null,1,null,v_marker_wine
  );
  v_request:=jsonb_build_object(
    'version',3,'kind','bottle_inventory_save',
    'name','Malformed Durable','producer','Fixture Producer','vintage',2021,
    'varietal','Pinot Noir','region','Region','country',null,
    'size_ml',750,'format',null,'quantity',1,'unit_cost',10
  );
  insert into public.inventory_command_receipts(
    restaurant_id,operation_id,actor_user_id,wine_id,command_type,
    request_payload,command_version,scope_kind,batch_entry_count
  ) values(
    v_site,v_malformed_key,v_actor,v_marker_wine,'bottle_inventory_save',
    v_request,3,'single_wine',null
  );
  update public.inventory_command_receipts
     set result_payload='{"status":"unexpected"}'::jsonb,
         completed_at=statement_timestamp()
   where restaurant_id=v_site and operation_id=v_malformed_key;
  begin
    perform public.save_bottle_inventory_private(
      v_site,v_malformed_key,'Malformed Durable','Fixture Producer',2021,
      'Pinot Noir','Region',null,null,1,10
    );
    raise exception 'C04_0158_EXPECTED_MALFORMED_DURABLE_REFUSAL';
  exception when sqlstate 'P0001' then
    get stacked diagnostics v_message=message_text;
    if v_message<>'C04_BOTTLE_OPERATION_INCOMPLETE' then raise; end if;
  end;

  -- Completed state for another kind is never admitted by the bottle writer.
  insert into public.scan_idempotency(
    key,restaurant_id,response_status,response_body,claimed_by_user_id
  ) values(
    v_wrong_kind_key,v_site,200,
    jsonb_build_object(
      'version',1,'kind','invoice_inventory_save','scanId',v_wrong_kind_key,
      'status','committed','itemCount',0,'wineCount',0
    ),v_actor
  );
  begin
    perform public.save_bottle_inventory_private(
      v_site,v_wrong_kind_key,'Wrong Kind','Fixture Producer',2021,
      'Pinot Noir','Region',null,null,1,10
    );
    raise exception 'C04_0158_EXPECTED_COMPLETED_KIND_REFUSAL';
  exception when sqlstate 'P0001' then
    get stacked diagnostics v_message=message_text;
    if v_message<>'C04_BOTTLE_TRANSPORT_CLAIM_REQUIRED' then raise; end if;
  end;

  -- The existing TTL is inclusive: exactly 24 hours old is not admitted.
  perform * from public.claim_scan_idempotency(
    v_site,v_expired_key,'bottle_inventory_save'
  );
  perform public.complete_scan_idempotency(
    v_site,v_expired_key,'bottle_inventory_save',null,1,null,v_marker_wine
  );
  update public.scan_idempotency
     set created_at=statement_timestamp()-interval '24 hours'
   where restaurant_id=v_site and key=v_expired_key;
  begin
    perform public.save_bottle_inventory_private(
      v_site,v_expired_key,'Expired Transport','Fixture Producer',2021,
      'Pinot Noir','Region',null,null,1,10
    );
    raise exception 'C04_0158_EXPECTED_COMPLETED_TTL_REFUSAL';
  exception when sqlstate 'P0001' then
    get stacked diagnostics v_message=message_text;
    if v_message<>'C04_BOTTLE_TRANSPORT_CLAIM_REQUIRED' then raise; end if;
  end;

  if (select count(*) from public.inventory_items where restaurant_id=v_site)<>v_inventory_count
     or (select coalesce(sum(quantity),0) from public.inventory_items where restaurant_id=v_site)<>v_inventory_quantity
     or (select count(*) from public.wines where restaurant_id=v_site)<>v_wine_count
     or (select count(*) from public.inventory_command_receipts
          where restaurant_id=v_site and command_version=3)<>2 then
    raise exception 'C04_0158_COMPLETED_REFUSAL_LEFT_STOCK_EFFECT';
  end if;
end;
$completed_transport_replay$;

rollback;
\echo C04_0158_COMPLETED_TRANSPORT_REPLAY_PASS
