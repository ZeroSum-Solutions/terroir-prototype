-- Supplemental 0158 scalar-bound and durable-receipt-insert failure matrix.
-- Every fixture write is inside this transaction and is rolled back.
\set ON_ERROR_STOP on
\pset pager off

begin;

create temp table c04_0158_failed_claims (
  key uuid primary key
) on commit drop;

create function pg_temp.c04_0158_expect_failure(
  p_label text,
  p_restaurant_id uuid,
  p_key uuid,
  p_name text,
  p_producer text,
  p_vintage integer,
  p_varietal text,
  p_region text,
  p_country text,
  p_format text,
  p_quantity integer,
  p_unit_cost numeric,
  p_claim boolean,
  p_expected_state text,
  p_expected_message text
) returns void
language plpgsql
as $function$
declare
  v_actor constant uuid := '15840000-0000-4000-8000-000000000001';
  v_state text;
  v_message text;
  v_wines bigint;
  v_inventory bigint;
  v_receipts bigint;
  v_canonical bigint;
  v_variants bigint;
  v_aliases bigint;
begin
  if p_claim then
    perform * from public.claim_scan_idempotency(
      p_restaurant_id, p_key, 'bottle_inventory_save'
    );
    insert into pg_temp.c04_0158_failed_claims values(p_key);
  end if;

  select
    (select count(*) from public.wines),
    (select count(*) from public.inventory_items),
    (select count(*) from public.inventory_command_receipts),
    (select count(*) from public.canonical_wines),
    (select count(*) from public.wine_variants),
    (select count(*) from public.wine_aliases)
  into v_wines, v_inventory, v_receipts, v_canonical, v_variants, v_aliases;

  begin
    perform public.save_bottle_inventory_private(
      p_restaurant_id, p_key, p_name, p_producer, p_vintage,
      p_varietal, p_region, p_country, p_format, p_quantity, p_unit_cost
    );
    raise exception 'C04_0158_EXPECTED_FAILURE_NOT_RAISED_%',p_label;
  exception when others then
    get stacked diagnostics v_state=returned_sqlstate,v_message=message_text;
    if v_state is distinct from p_expected_state
       or v_message is distinct from p_expected_message then
      raise exception 'C04_0158_UNEXPECTED_FAILURE_%_%_%',p_label,v_state,v_message;
    end if;
  end;

  if (select count(*) from public.wines)<>v_wines
     or (select count(*) from public.inventory_items)<>v_inventory
     or (select count(*) from public.inventory_command_receipts)<>v_receipts
     or (select count(*) from public.canonical_wines)<>v_canonical
     or (select count(*) from public.wine_variants)<>v_variants
     or (select count(*) from public.wine_aliases)<>v_aliases then
    raise exception 'C04_0158_FAILURE_LEFT_DOMAIN_RESIDUE_%',p_label;
  end if;

  if p_claim and not exists (
    select 1
      from public.scan_idempotency c
     where c.restaurant_id=p_restaurant_id
       and c.key=p_key
       and c.claimed_by_user_id=v_actor
       and c.response_status is null
       and c.response_body='{"version":1,"kind":"bottle_inventory_save","status":"claimed"}'::jsonb
  ) then
    raise exception 'C04_0158_FAILURE_CHANGED_TRANSPORT_%',p_label;
  end if;
end;
$function$;

create function pg_temp.c04_0158_fail_receipt_insert()
returns trigger
language plpgsql
as $function$
begin
  if new.command_version=3 then
    raise exception 'C04_0158_FORCED_RECEIPT_INSERT_FAILURE';
  end if;
  return new;
end;
$function$;

do $supplemental$
declare
  v_actor constant uuid := '15840000-0000-4000-8000-000000000001';
  v_workspace constant uuid := '15840000-0000-4000-8000-000000000002';
  v_wm constant uuid := '15840000-0000-4000-8000-000000000003';
  v_membership constant uuid := '15840000-0000-4000-8000-000000000004';
  v_site constant uuid := '15840000-0000-4000-8000-000000000005';
  v_key uuid;
begin
  if current_database()<>'terroir_cost_seal_20260926b'
     or public.current_inventory_contract_version()<>2
     or to_regprocedure('public.save_bottle_inventory_private(uuid,uuid,text,text,integer,text,text,text,text,integer,numeric)') is null then
    raise exception 'C04_0158_TARGET_NOT_ADMITTED';
  end if;

  insert into auth.users(id,email) values
    (v_actor,'c04-0158-supplemental@terroir.test');
  insert into public.workspaces(id,kind,name) values
    (v_workspace,'restaurant','C04 0158 supplemental');
  insert into public.restaurants(id,name,workspace_id) values
    (v_site,'C04 0158 supplemental site',v_workspace);
  insert into public.workspace_memberships(id,workspace_id,user_id) values
    (v_wm,v_workspace,v_actor);
  insert into public.memberships(
    id,user_id,restaurant_id,role,workspace_membership_id
  ) values(v_membership,v_actor,v_site,'staff',v_wm);
  perform set_config('request.jwt.claim.sub',v_actor::text,true);

  -- Both nullable text inputs and nullable vintage remain accepted at the
  -- numeric lower bounds.
  v_key:='15840000-0000-4000-8000-000000000080';
  perform * from public.claim_scan_idempotency(v_site,v_key,'bottle_inventory_save');
  perform public.save_bottle_inventory_private(
    v_site,v_key,'Lower bound','Supplemental Producer',null,'','',null,null,1,0
  );

  -- Every scalar string exact maximum, plus both numeric maxima, is accepted.
  v_key:='15840000-0000-4000-8000-000000000081';
  perform * from public.claim_scan_idempotency(v_site,v_key,'bottle_inventory_save');
  perform public.save_bottle_inventory_private(
    v_site,v_key,repeat('n',500),repeat('p',500),2022,
    repeat('v',500),repeat('r',500),repeat('c',500),repeat('f',100),
    100000,1000000
  );
  if (select count(*) from public.inventory_command_receipts
       where restaurant_id=v_site and command_version=3
         and completed_at is not null)<>2
     or (select count(*) from public.inventory_items
       where restaurant_id=v_site)<>2 then
    raise exception 'C04_0158_VALID_BOUNDARY_WRITE_FAILED';
  end if;

  -- Required NULL matrix. Restaurant NULL fails authorization before scalar
  -- validation; key NULL and every other required scalar fail validation.
  perform pg_temp.c04_0158_expect_failure(
    'NULL_RESTAURANT',null,'15840000-0000-4000-8000-000000000101',
    'Null restaurant','Producer',2022,'Pinot','Region',null,null,1,0,
    false,'42501','forbidden'
  );
  perform pg_temp.c04_0158_expect_failure(
    'NULL_KEY',v_site,null,'Null key','Producer',2022,'Pinot','Region',null,null,1,0,
    false,'P0001','C04_BOTTLE_SAVE_INVALID'
  );
  perform pg_temp.c04_0158_expect_failure(
    'NULL_NAME',v_site,'15840000-0000-4000-8000-000000000103',
    null,'Producer',2022,'Pinot','Region',null,null,1,0,
    true,'P0001','C04_BOTTLE_SAVE_INVALID'
  );
  perform pg_temp.c04_0158_expect_failure(
    'NULL_PRODUCER',v_site,'15840000-0000-4000-8000-000000000104',
    'Null producer',null,2022,'Pinot','Region',null,null,1,0,
    true,'P0001','C04_BOTTLE_SAVE_INVALID'
  );
  perform pg_temp.c04_0158_expect_failure(
    'NULL_VARIETAL',v_site,'15840000-0000-4000-8000-000000000105',
    'Null varietal','Producer',2022,null,'Region',null,null,1,0,
    true,'P0001','C04_BOTTLE_SAVE_INVALID'
  );
  perform pg_temp.c04_0158_expect_failure(
    'NULL_REGION',v_site,'15840000-0000-4000-8000-000000000106',
    'Null region','Producer',2022,'Pinot',null,null,null,1,0,
    true,'P0001','C04_BOTTLE_SAVE_INVALID'
  );
  perform pg_temp.c04_0158_expect_failure(
    'NULL_QUANTITY',v_site,'15840000-0000-4000-8000-000000000107',
    'Null quantity','Producer',2022,'Pinot','Region',null,null,null,0,
    true,'P0001','C04_BOTTLE_SAVE_INVALID'
  );
  perform pg_temp.c04_0158_expect_failure(
    'NULL_UNIT_COST',v_site,'15840000-0000-4000-8000-000000000108',
    'Null cost','Producer',2022,'Pinot','Region',null,null,1,null,
    true,'P0001','C04_BOTTLE_SAVE_INVALID'
  );

  -- Each scalar string refuses one byte beyond its accepted maximum.
  perform pg_temp.c04_0158_expect_failure(
    'NAME_501',v_site,'15840000-0000-4000-8000-000000000111',
    repeat('n',501),'Producer',2022,'Pinot','Region',null,null,1,0,
    true,'P0001','C04_BOTTLE_SAVE_INVALID'
  );
  perform pg_temp.c04_0158_expect_failure(
    'PRODUCER_501',v_site,'15840000-0000-4000-8000-000000000112',
    'Producer over',repeat('p',501),2022,'Pinot','Region',null,null,1,0,
    true,'P0001','C04_BOTTLE_SAVE_INVALID'
  );
  perform pg_temp.c04_0158_expect_failure(
    'VARIETAL_501',v_site,'15840000-0000-4000-8000-000000000113',
    'Varietal over','Producer',2022,repeat('v',501),'Region',null,null,1,0,
    true,'P0001','C04_BOTTLE_SAVE_INVALID'
  );
  perform pg_temp.c04_0158_expect_failure(
    'REGION_501',v_site,'15840000-0000-4000-8000-000000000114',
    'Region over','Producer',2022,'Pinot',repeat('r',501),null,null,1,0,
    true,'P0001','C04_BOTTLE_SAVE_INVALID'
  );
  perform pg_temp.c04_0158_expect_failure(
    'COUNTRY_501',v_site,'15840000-0000-4000-8000-000000000115',
    'Country over','Producer',2022,'Pinot','Region',repeat('c',501),null,1,0,
    true,'P0001','C04_BOTTLE_SAVE_INVALID'
  );
  perform pg_temp.c04_0158_expect_failure(
    'FORMAT_101',v_site,'15840000-0000-4000-8000-000000000116',
    'Format over','Producer',2022,'Pinot','Region',null,repeat('f',101),1,0,
    true,'P0001','C04_BOTTLE_SAVE_INVALID'
  );

  -- Both numeric ends reject values immediately outside the closed interval.
  perform pg_temp.c04_0158_expect_failure(
    'QUANTITY_ZERO',v_site,'15840000-0000-4000-8000-000000000121',
    'Quantity zero','Producer',2022,'Pinot','Region',null,null,0,0,
    true,'P0001','C04_BOTTLE_SAVE_INVALID'
  );
  perform pg_temp.c04_0158_expect_failure(
    'QUANTITY_OVER',v_site,'15840000-0000-4000-8000-000000000122',
    'Quantity over','Producer',2022,'Pinot','Region',null,null,100001,0,
    true,'P0001','C04_BOTTLE_SAVE_INVALID'
  );
  perform pg_temp.c04_0158_expect_failure(
    'COST_NEGATIVE',v_site,'15840000-0000-4000-8000-000000000123',
    'Cost negative','Producer',2022,'Pinot','Region',null,null,1,-1,
    true,'P0001','C04_BOTTLE_SAVE_INVALID'
  );
  perform pg_temp.c04_0158_expect_failure(
    'COST_OVER',v_site,'15840000-0000-4000-8000-000000000124',
    'Cost over','Producer',2022,'Pinot','Region',null,null,1,1000001,
    true,'P0001','C04_BOTTLE_SAVE_INVALID'
  );

  -- Receipt INSERT occurs after wine resolution. Its forced failure must roll
  -- back every domain write while preserving the exact unfinished claim.
  execute 'create trigger c04_0158_force_receipt_insert '
       || 'before insert on public.inventory_command_receipts '
       || 'for each row execute function pg_temp.c04_0158_fail_receipt_insert()';
  perform pg_temp.c04_0158_expect_failure(
    'RECEIPT_INSERT',v_site,'15840000-0000-4000-8000-000000000131',
    'Forced receipt insert','Unique Forced Receipt Producer',2022,
    'Pinot','Region',null,null,1,10,
    true,'P0001','C04_0158_FORCED_RECEIPT_INSERT_FAILURE'
  );
  execute 'drop trigger c04_0158_force_receipt_insert on public.inventory_command_receipts';

  if (select count(*) from pg_temp.c04_0158_failed_claims)<>17
     or exists (
       select 1
         from pg_temp.c04_0158_failed_claims f
         left join public.scan_idempotency c
           on c.restaurant_id=v_site and c.key=f.key
        where c.key is null
           or c.claimed_by_user_id is distinct from v_actor
           or c.response_status is not null
           or c.response_body is distinct from
             '{"version":1,"kind":"bottle_inventory_save","status":"claimed"}'::jsonb
     )
     or exists (
       select 1 from public.inventory_command_receipts r
        where r.restaurant_id=v_site
          and r.operation_id in (select key from pg_temp.c04_0158_failed_claims)
     ) then
    raise exception 'C04_0158_FAILED_CLAIM_MATRIX_MISMATCH';
  end if;
end;
$supplemental$;

rollback;
\echo C04_0158_SUPPLEMENTAL_BOUNDS_RECEIPT_INSERT_PASS
