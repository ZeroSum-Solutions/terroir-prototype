-- 0158 write-stage failure matrix. Each forced failure is caught in a
-- subtransaction; the surrounding fixture transaction is rolled back.
\set ON_ERROR_STOP on
\pset pager off

begin;
create function pg_temp.c04_0158_fail_wine() returns trigger
language plpgsql as $$begin raise exception 'C04_0158_FORCED_WINE_FAILURE'; end$$;
create function pg_temp.c04_0158_fail_inventory() returns trigger
language plpgsql as $$begin raise exception 'C04_0158_FORCED_INVENTORY_FAILURE'; end$$;
create function pg_temp.c04_0158_fail_receipt_completion() returns trigger
language plpgsql as $$begin
  if new.command_version=3 and old.result_payload is null and new.result_payload is not null then
    raise exception 'C04_0158_FORCED_RECEIPT_COMPLETION_FAILURE';
  end if;
  return new;
end$$;
create function pg_temp.c04_0158_fail_transport_completion() returns trigger
language plpgsql as $$begin
  if new.key='15810000-0000-4000-8000-000000000024'::uuid
     and old.response_status is null and new.response_status is not null then
    raise exception 'C04_0158_FORCED_TRANSPORT_COMPLETION_FAILURE';
  end if;
  return new;
end$$;

do $atomic_failure$
declare
  v_actor uuid := '15810000-0000-4000-8000-000000000001';
  v_workspace uuid := '15810000-0000-4000-8000-000000000002';
  v_wm uuid := '15810000-0000-4000-8000-000000000003';
  v_membership uuid := '15810000-0000-4000-8000-000000000004';
  v_site uuid := '15810000-0000-4000-8000-000000000005';
  v_wine_key uuid := '15810000-0000-4000-8000-000000000021';
  v_inventory_key uuid := '15810000-0000-4000-8000-000000000022';
  v_receipt_key uuid := '15810000-0000-4000-8000-000000000023';
  v_transport_key uuid := '15810000-0000-4000-8000-000000000024';
begin
  if current_database()<>'terroir_cost_seal_20260926b'
     or to_regprocedure('public.save_bottle_inventory_private(uuid,uuid,text,text,integer,text,text,text,text,integer,numeric)') is null then
    raise exception 'C04_0158_TARGET_NOT_ADMITTED';
  end if;
  insert into auth.users(id,email) values(v_actor,'c04-0158-failure@terroir.test');
  insert into public.workspaces(id,kind,name) values(v_workspace,'restaurant','C04 0158 failure');
  insert into public.restaurants(id,name,workspace_id) values(v_site,'C04 0158 failure site',v_workspace);
  insert into public.workspace_memberships(id,workspace_id,user_id) values(v_wm,v_workspace,v_actor);
  insert into public.memberships(id,user_id,restaurant_id,role,workspace_membership_id)
    values(v_membership,v_actor,v_site,'staff',v_wm);
  perform set_config('request.jwt.claim.sub',v_actor::text,true);

  perform * from public.claim_scan_idempotency(v_site,v_wine_key,'bottle_inventory_save');
  execute 'create trigger c04_0158_force_wine before insert on public.wines '
       || 'for each row execute function pg_temp.c04_0158_fail_wine()';
  begin
    perform public.save_bottle_inventory_private(
      v_site,v_wine_key,'Forced Wine','Bridge Producer',2022,'Pinot','Willamette',null,null,1,10
    );
    raise exception 'C04_EXPECTED_FORCED_WINE_FAILURE';
  exception when raise_exception then
    if sqlerrm<>'C04_0158_FORCED_WINE_FAILURE' then raise; end if;
  end;
  execute 'drop trigger c04_0158_force_wine on public.wines';
  if exists(select 1 from public.wines where restaurant_id=v_site and name='Forced Wine')
     or exists(select 1 from public.inventory_command_receipts where restaurant_id=v_site and operation_id=v_wine_key)
     or exists(select 1 from public.inventory_items where restaurant_id=v_site)
     or not exists(select 1 from public.scan_idempotency where restaurant_id=v_site and key=v_wine_key and response_status is null) then
    raise exception 'C04_0158_WINE_FAILURE_LEFT_RESIDUE';
  end if;

  perform * from public.claim_scan_idempotency(v_site,v_inventory_key,'bottle_inventory_save');
  execute 'create trigger c04_0158_force_inventory before insert on public.inventory_items '
       || 'for each row execute function pg_temp.c04_0158_fail_inventory()';
  begin
    perform public.save_bottle_inventory_private(
      v_site,v_inventory_key,'Forced Inventory','Bridge Producer',2022,'Pinot','Willamette',null,null,1,10
    );
    raise exception 'C04_EXPECTED_FORCED_INVENTORY_FAILURE';
  exception when raise_exception then
    if sqlerrm<>'C04_0158_FORCED_INVENTORY_FAILURE' then raise; end if;
  end;
  execute 'drop trigger c04_0158_force_inventory on public.inventory_items';
  if exists(select 1 from public.wines where restaurant_id=v_site and name='Forced Inventory')
     or exists(select 1 from public.inventory_command_receipts where restaurant_id=v_site and operation_id=v_inventory_key)
     or exists(select 1 from public.inventory_items where restaurant_id=v_site)
     or not exists(select 1 from public.scan_idempotency where restaurant_id=v_site and key=v_inventory_key and response_status is null) then
    raise exception 'C04_0158_INVENTORY_FAILURE_LEFT_RESIDUE';
  end if;

  perform * from public.claim_scan_idempotency(v_site,v_receipt_key,'bottle_inventory_save');
  execute 'create trigger c04_0158_force_receipt before update on public.inventory_command_receipts '
       || 'for each row execute function pg_temp.c04_0158_fail_receipt_completion()';
  begin
    perform public.save_bottle_inventory_private(
      v_site,v_receipt_key,'Forced Receipt','Bridge Producer',2022,'Pinot','Willamette',null,null,1,10
    );
    raise exception 'C04_EXPECTED_FORCED_RECEIPT_FAILURE';
  exception when raise_exception then
    if sqlerrm<>'C04_0158_FORCED_RECEIPT_COMPLETION_FAILURE' then raise; end if;
  end;
  execute 'drop trigger c04_0158_force_receipt on public.inventory_command_receipts';
  if exists(select 1 from public.wines where restaurant_id=v_site and name='Forced Receipt')
     or exists(select 1 from public.inventory_command_receipts where restaurant_id=v_site and operation_id=v_receipt_key)
     or exists(select 1 from public.inventory_items where restaurant_id=v_site)
     or not exists(select 1 from public.scan_idempotency where restaurant_id=v_site and key=v_receipt_key and response_status is null) then
    raise exception 'C04_0158_RECEIPT_FAILURE_LEFT_RESIDUE';
  end if;

  perform * from public.claim_scan_idempotency(v_site,v_transport_key,'bottle_inventory_save');
  execute 'create trigger c04_0158_force_transport before update on public.scan_idempotency '
       || 'for each row execute function pg_temp.c04_0158_fail_transport_completion()';
  begin
    perform public.save_bottle_inventory_private(
      v_site,v_transport_key,'Forced Transport','Bridge Producer',2022,'Pinot','Willamette',null,null,1,10
    );
    raise exception 'C04_EXPECTED_FORCED_TRANSPORT_FAILURE';
  exception when raise_exception then
    if sqlerrm<>'C04_0158_FORCED_TRANSPORT_COMPLETION_FAILURE' then raise; end if;
  end;
  execute 'drop trigger c04_0158_force_transport on public.scan_idempotency';
  if exists(select 1 from public.wines where restaurant_id=v_site and name='Forced Transport')
     or exists(select 1 from public.inventory_command_receipts where restaurant_id=v_site and operation_id=v_transport_key)
     or exists(select 1 from public.inventory_items where restaurant_id=v_site)
     or not exists(select 1 from public.scan_idempotency where restaurant_id=v_site and key=v_transport_key and response_status is null) then
    raise exception 'C04_0158_TRANSPORT_FAILURE_LEFT_RESIDUE';
  end if;
end;
$atomic_failure$;
rollback;
\echo C04_0158_ATOMIC_FAILURE_ROLLBACK_PASS
