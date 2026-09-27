-- 0158 staff/manager/owner authorization, lifecycle and scalar bounds.
-- Exact disposable database only; every fixture write is rolled back.
\set ON_ERROR_STOP on
\pset pager off

begin;
do $authorization_input$
declare
  v_actor uuid := '15820000-0000-4000-8000-000000000001';
  v_workspace uuid := '15820000-0000-4000-8000-000000000002';
  v_wm uuid := '15820000-0000-4000-8000-000000000003';
  v_membership uuid := '15820000-0000-4000-8000-000000000004';
  v_site uuid := '15820000-0000-4000-8000-000000000005';
  v_foreign_site uuid := '15820000-0000-4000-8000-000000000006';
  v_key uuid;
  v_message text;
  v_before_wines integer;
  v_before_inventory integer;
  v_before_receipts integer;
begin
  if current_database()<>'terroir_cost_seal_20260926b'
     or to_regprocedure('public.save_bottle_inventory_private(uuid,uuid,text,text,integer,text,text,text,text,integer,numeric)') is null then
    raise exception 'C04_0158_TARGET_NOT_ADMITTED';
  end if;
  insert into auth.users(id,email) values(v_actor,'c04-0158-auth@terroir.test');
  insert into public.workspaces(id,kind,name) values(v_workspace,'restaurant','C04 0158 auth');
  insert into public.restaurants(id,name,workspace_id) values
    (v_site,'C04 0158 auth site',v_workspace),
    (v_foreign_site,'C04 0158 foreign site',v_workspace);
  insert into public.workspace_memberships(id,workspace_id,user_id) values(v_wm,v_workspace,v_actor);
  insert into public.memberships(id,user_id,restaurant_id,role,workspace_membership_id)
    values(v_membership,v_actor,v_site,'staff',v_wm);
  perform set_config('request.jwt.claim.sub',v_actor::text,true);

  if public.effective_site_capability(v_site,'cost.read')
     or public.effective_site_capability(v_site,'margin.read')
     or public.effective_site_capability(v_site,'pricing.manage') then
    raise exception 'C04_0158_AUTH_FIXTURE_HAS_PROTECTED_CAPABILITY';
  end if;

  foreach v_key in array array[
    '15820000-0000-4000-8000-000000000021'::uuid,
    '15820000-0000-4000-8000-000000000022'::uuid,
    '15820000-0000-4000-8000-000000000023'::uuid
  ] loop
    perform * from public.claim_scan_idempotency(v_site,v_key,'bottle_inventory_save');
    perform public.save_bottle_inventory_private(
      v_site,v_key,'Role '||v_key::text,'Bridge Producer',null,'','',null,null,1,0
    );
    if v_key='15820000-0000-4000-8000-000000000021'::uuid then
      update public.memberships set role='manager' where id=v_membership;
    elsif v_key='15820000-0000-4000-8000-000000000022'::uuid then
      update public.memberships set role='owner' where id=v_membership;
    end if;
  end loop;
  if (select count(*) from public.inventory_command_receipts
       where restaurant_id=v_site and command_version=3)<>3
     or (select count(*) from public.inventory_items where restaurant_id=v_site)<>3 then
    raise exception 'C04_0158_OPERATIONAL_ROLE_SUCCESS_FAILED';
  end if;
  update public.memberships set role='staff' where id=v_membership;

  select count(*) into v_before_wines from public.wines where restaurant_id=v_site;
  select count(*) into v_before_inventory from public.inventory_items where restaurant_id=v_site;
  select count(*) into v_before_receipts from public.inventory_command_receipts where restaurant_id=v_site;

  -- Invalid scalar calls use real unfinished claims and must leave no domain
  -- write or durable receipt. The transport claim itself remains unfinished.
  v_key:='15820000-0000-4000-8000-000000000031';
  perform * from public.claim_scan_idempotency(v_site,v_key,'bottle_inventory_save');
  begin
    perform public.save_bottle_inventory_private(
      v_site,v_key,'   ','Producer',null,'','',null,null,1,0
    );
    raise exception 'C04_EXPECTED_EMPTY_NAME_REFUSAL';
  exception when sqlstate 'P0001' then
    get stacked diagnostics v_message=message_text;
    if v_message<>'C04_BOTTLE_SAVE_INVALID' then raise; end if;
  end;

  v_key:='15820000-0000-4000-8000-000000000032';
  perform * from public.claim_scan_idempotency(v_site,v_key,'bottle_inventory_save');
  begin
    perform public.save_bottle_inventory_private(
      v_site,v_key,'Bounds','Producer',null,'','',null,repeat('x',101),0,0
    );
    raise exception 'C04_EXPECTED_BOUND_REFUSAL';
  exception when sqlstate 'P0001' then
    get stacked diagnostics v_message=message_text;
    if v_message<>'C04_BOTTLE_SAVE_INVALID' then raise; end if;
  end;

  v_key:='15820000-0000-4000-8000-000000000033';
  perform * from public.claim_scan_idempotency(v_site,v_key,'bottle_inventory_save');
  begin
    perform public.save_bottle_inventory_private(
      v_site,v_key,'Bounds','Producer',null,'','',null,null,100001,1000001
    );
    raise exception 'C04_EXPECTED_NUMERIC_BOUND_REFUSAL';
  exception when sqlstate 'P0001' then
    get stacked diagnostics v_message=message_text;
    if v_message<>'C04_BOTTLE_SAVE_INVALID' then raise; end if;
  end;
  if (select count(*) from public.wines where restaurant_id=v_site)<>v_before_wines
     or (select count(*) from public.inventory_items where restaurant_id=v_site)<>v_before_inventory
     or (select count(*) from public.inventory_command_receipts where restaurant_id=v_site)<>v_before_receipts then
    raise exception 'C04_0158_INVALID_INPUT_LEFT_DOMAIN_RESIDUE';
  end if;

  v_key:='15820000-0000-4000-8000-000000000041';
  perform * from public.claim_scan_idempotency(v_site,v_key,'bottle_inventory_save');
  update public.memberships set status='revoked',revoked_at=statement_timestamp() where id=v_membership;
  begin
    perform public.save_bottle_inventory_private(v_site,v_key,'Revoked','Producer',null,'','',null,null,1,0);
    raise exception 'C04_EXPECTED_REVOKED_SITE_REFUSAL';
  exception when sqlstate '42501' then
    get stacked diagnostics v_message=message_text;
    if v_message<>'forbidden' then raise; end if;
  end;
  update public.memberships set status='active',revoked_at=null where id=v_membership;
  update public.memberships set expires_at=statement_timestamp() where id=v_membership;
  begin
    perform public.save_bottle_inventory_private(v_site,v_key,'Expired','Producer',null,'','',null,null,1,0);
    raise exception 'C04_EXPECTED_EXPIRED_SITE_REFUSAL';
  exception when sqlstate '42501' then null;
  end;
  update public.memberships set expires_at=null where id=v_membership;

  update public.workspace_memberships set status='revoked',revoked_at=statement_timestamp() where id=v_wm;
  begin
    perform public.save_bottle_inventory_private(v_site,v_key,'Parent revoked','Producer',null,'','',null,null,1,0);
    raise exception 'C04_EXPECTED_REVOKED_PARENT_REFUSAL';
  exception when sqlstate '42501' then null;
  end;
  update public.workspace_memberships set status='active',revoked_at=null where id=v_wm;
  update public.workspace_memberships set expires_at=statement_timestamp() where id=v_wm;
  begin
    perform public.save_bottle_inventory_private(v_site,v_key,'Parent expired','Producer',null,'','',null,null,1,0);
    raise exception 'C04_EXPECTED_EXPIRED_PARENT_REFUSAL';
  exception when sqlstate '42501' then null;
  end;
  update public.workspace_memberships set expires_at=null where id=v_wm;

  begin
    perform public.save_bottle_inventory_private(v_foreign_site,v_key,'Foreign','Producer',null,'','',null,null,1,0);
    raise exception 'C04_EXPECTED_FOREIGN_SITE_REFUSAL';
  exception when sqlstate '42501' then null;
  end;
  perform set_config('request.jwt.claim.sub','',true);
  begin
    perform public.save_bottle_inventory_private(v_site,v_key,'Anonymous','Producer',null,'','',null,null,1,0);
    raise exception 'C04_EXPECTED_ANONYMOUS_REFUSAL';
  exception when sqlstate '42501' then null;
  end;
end;
$authorization_input$;
rollback;
\echo C04_0158_AUTHORIZATION_INPUT_PASS
