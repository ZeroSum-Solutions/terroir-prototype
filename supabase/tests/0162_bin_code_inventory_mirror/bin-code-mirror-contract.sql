-- 0162 rollback-only functional, authorization and conservation contract.
\set ON_ERROR_STOP on
\pset pager off

\if :{?expected_database}
\else
  \echo C07_0162_EXPECTED_DATABASE_REQUIRED
  \quit 3
\endif
\if :{?target_admitted}
\else
  \echo C07_0162_TARGET_ADMISSION_REQUIRED
  \quit 3
\endif
\if :{?source_0162_sha256}
\else
  \echo C07_0162_SOURCE_PIN_REQUIRED
  \quit 3
\endif

select 1 / case when
  current_database() = :'expected_database'
  and current_user = 'postgres'
  and session_user = 'postgres'
  and :'target_admitted' = 'on'
  and :'source_0162_sha256' = 'c899f1f5113773f0cc826a227bc0c800c4303cc2a6bc5a945bd5b040ced01955'
  and pg_catalog.to_regprocedure(
    'public.mirror_bin_code_to_inventory_items()'
  ) is not null
then 1 else 0 end as c07_0162_target_admitted;

begin;
set local statement_timeout = '30s';
set local lock_timeout = '5s';

do $c07_0162_catalog$
declare
  v_function pg_catalog.pg_proc%rowtype;
  v_trigger pg_catalog.pg_trigger%rowtype;
  v_code_attnum smallint;
  v_search_path text;
  v_trigger_definition text;
begin
  select p.* into strict v_function
    from pg_catalog.pg_proc p
   where p.oid = pg_catalog.to_regprocedure(
     'public.mirror_bin_code_to_inventory_items()'
   );
  select t.* into strict v_trigger
    from pg_catalog.pg_trigger t
   where t.tgrelid = pg_catalog.to_regclass('public.bins')
     and t.tgname = 'bins_mirror_code_to_inventory_items'
     and not t.tgisinternal;
  select a.attnum into strict v_code_attnum
    from pg_catalog.pg_attribute a
   where a.attrelid = pg_catalog.to_regclass('public.bins')
     and a.attname = 'code'
     and a.attnum > 0
     and not a.attisdropped;

  v_search_path := pg_catalog.current_setting('search_path');
  begin
    perform pg_catalog.set_config('search_path', '', true);
    v_trigger_definition := pg_catalog.pg_get_triggerdef(v_trigger.oid, false);
  exception when others then
    perform pg_catalog.set_config('search_path', v_search_path, true);
    raise;
  end;
  perform pg_catalog.set_config('search_path', v_search_path, true);

  if pg_catalog.encode(
       pg_catalog.sha256(pg_catalog.convert_to(v_function.prosrc, 'UTF8')), 'hex'
     ) <> '39d03433e9ccd05bb77e01c9f313acb8e271a8cd923c3e92776187c3f8d639f9'
     or pg_catalog.pg_get_userbyid(v_function.proowner) <> 'postgres'
     or v_function.prorettype <> pg_catalog.to_regtype('pg_catalog.trigger')
     or not v_function.prosecdef
     or v_function.proconfig is distinct from array['search_path=""']::text[]
     or pg_catalog.to_jsonb(v_function.proacl) is distinct from
       '["postgres=X/postgres"]'::pg_catalog.jsonb
     or v_trigger.tgfoid <> v_function.oid
     or v_trigger.tgtype <> 17
     or v_trigger.tgenabled <> 'O'
     or v_trigger.tgattr::text <> v_code_attnum::text
     or v_trigger_definition <> 'CREATE TRIGGER bins_mirror_code_to_inventory_items AFTER UPDATE OF code ON public.bins FOR EACH ROW WHEN ((new.code IS DISTINCT FROM old.code)) EXECUTE FUNCTION public.mirror_bin_code_to_inventory_items()'
     or pg_catalog.has_function_privilege(
       'anon', 'public.mirror_bin_code_to_inventory_items()', 'EXECUTE'
     )
     or pg_catalog.has_function_privilege(
       'authenticated', 'public.mirror_bin_code_to_inventory_items()', 'EXECUTE'
     )
     or pg_catalog.has_function_privilege(
       'service_role', 'public.mirror_bin_code_to_inventory_items()', 'EXECUTE'
     ) then
    raise exception 'C07_0162_CATALOG_CONTRACT_FAILED';
  end if;
end;
$c07_0162_catalog$;

insert into auth.users(id,email) values
  ('16200000-0000-4000-8000-000000000001','c07-0162-owner@terroir.test'),
  ('16200000-0000-4000-8000-000000000002','c07-0162-manager@terroir.test'),
  ('16200000-0000-4000-8000-000000000003','c07-0162-staff@terroir.test'),
  ('16200000-0000-4000-8000-000000000004','c07-0162-foreign@terroir.test'),
  ('16200000-0000-4000-8000-000000000005','c07-0162-revoked@terroir.test');
insert into public.workspaces(id,kind,name) values
  ('16200000-0000-4000-8000-000000000010','restaurant','C07 0162 workspace');
insert into public.restaurants(id,name,workspace_id) values
  ('16200000-0000-4000-8000-000000000020','C07 0162 site','16200000-0000-4000-8000-000000000010'),
  ('16200000-0000-4000-8000-000000000021','C07 0162 foreign site','16200000-0000-4000-8000-000000000010');
insert into public.workspace_memberships(
  id,workspace_id,user_id,governance_role
) values
  ('16200000-0000-4000-8000-000000000030','16200000-0000-4000-8000-000000000010','16200000-0000-4000-8000-000000000001','workspace_owner'),
  ('16200000-0000-4000-8000-000000000031','16200000-0000-4000-8000-000000000010','16200000-0000-4000-8000-000000000002','group_admin'),
  ('16200000-0000-4000-8000-000000000032','16200000-0000-4000-8000-000000000010','16200000-0000-4000-8000-000000000003',null),
  ('16200000-0000-4000-8000-000000000033','16200000-0000-4000-8000-000000000010','16200000-0000-4000-8000-000000000004','group_admin'),
  ('16200000-0000-4000-8000-000000000034','16200000-0000-4000-8000-000000000010','16200000-0000-4000-8000-000000000005','group_admin');
insert into public.memberships(
  id,user_id,restaurant_id,role,workspace_membership_id
) values
  ('16200000-0000-4000-8000-000000000040','16200000-0000-4000-8000-000000000001','16200000-0000-4000-8000-000000000020','owner','16200000-0000-4000-8000-000000000030'),
  ('16200000-0000-4000-8000-000000000041','16200000-0000-4000-8000-000000000002','16200000-0000-4000-8000-000000000020','manager','16200000-0000-4000-8000-000000000031'),
  ('16200000-0000-4000-8000-000000000042','16200000-0000-4000-8000-000000000003','16200000-0000-4000-8000-000000000020','staff','16200000-0000-4000-8000-000000000032'),
  ('16200000-0000-4000-8000-000000000043','16200000-0000-4000-8000-000000000004','16200000-0000-4000-8000-000000000021','manager','16200000-0000-4000-8000-000000000033'),
  ('16200000-0000-4000-8000-000000000044','16200000-0000-4000-8000-000000000005','16200000-0000-4000-8000-000000000020','manager','16200000-0000-4000-8000-000000000034');

update public.memberships
   set status='revoked',
       revoked_at=pg_catalog.statement_timestamp()
 where id='16200000-0000-4000-8000-000000000044';
update public.workspace_memberships
   set status='revoked',
       revoked_at=pg_catalog.statement_timestamp()
 where id='16200000-0000-4000-8000-000000000034';

insert into public.wines(id,restaurant_id,name,producer,vintage,size_ml) values
  ('16200000-0000-4000-8000-000000000050','16200000-0000-4000-8000-000000000020','C07 0162 wine','Contract',2020,750),
  ('16200000-0000-4000-8000-000000000051','16200000-0000-4000-8000-000000000021','C07 0162 foreign wine','Contract',2021,750);
insert into public.bins(id,restaurant_id,code) values
  ('16200000-0000-4000-8000-000000000060','16200000-0000-4000-8000-000000000020','A-01'),
  ('16200000-0000-4000-8000-000000000061','16200000-0000-4000-8000-000000000020','B-01'),
  ('16200000-0000-4000-8000-000000000062','16200000-0000-4000-8000-000000000021','A-01');
insert into public.inventory_items(
  id,wine_id,restaurant_id,quantity,unit_cost,bin_location,bin_id,added_via
) values
  ('16200000-0000-4000-8000-000000000070','16200000-0000-4000-8000-000000000050','16200000-0000-4000-8000-000000000020',1,10,'A-01','16200000-0000-4000-8000-000000000060','manual'),
  ('16200000-0000-4000-8000-000000000071','16200000-0000-4000-8000-000000000050','16200000-0000-4000-8000-000000000020',2,20,'A-01','16200000-0000-4000-8000-000000000060','manual'),
  ('16200000-0000-4000-8000-000000000072','16200000-0000-4000-8000-000000000050','16200000-0000-4000-8000-000000000020',3,30,'A-01',null,'manual'),
  ('16200000-0000-4000-8000-000000000073','16200000-0000-4000-8000-000000000050','16200000-0000-4000-8000-000000000020',4,40,'A-01','16200000-0000-4000-8000-000000000061','manual'),
  ('16200000-0000-4000-8000-000000000074','16200000-0000-4000-8000-000000000051','16200000-0000-4000-8000-000000000021',5,50,'A-01','16200000-0000-4000-8000-000000000060','manual');

insert into public.inventory_command_receipts(
  restaurant_id,operation_id,actor_user_id,wine_id,command_type,
  request_payload,result_payload,completed_at,command_version,scope_kind,
  batch_entry_count
) values (
  '16200000-0000-4000-8000-000000000020',
  '16200000-0000-4000-8000-000000000080',
  '16200000-0000-4000-8000-000000000003',
  '16200000-0000-4000-8000-000000000050',
  'bottle_location_receive',
  '{"version":3,"kind":"bottle_location_receive","wine_id":"16200000-0000-4000-8000-000000000050","section":"Cellar","bin_id":"16200000-0000-4000-8000-000000000060","quantity":1}'::jsonb,
  '{"version":1,"kind":"bottle_location_receive","status":"committed","operationId":"16200000-0000-4000-8000-000000000080","inventoryItemId":"16200000-0000-4000-8000-000000000070","wineId":"16200000-0000-4000-8000-000000000050","section":"Cellar","binId":"16200000-0000-4000-8000-000000000060","binCode":"A-01","quantity":1}'::jsonb,
  pg_catalog.statement_timestamp(),3,'single_wine',null
);
insert into public.reconcile_batches(
  id,restaurant_id,created_by,action_count
) values (
  '16200000-0000-4000-8000-000000000081',
  '16200000-0000-4000-8000-000000000020',
  '16200000-0000-4000-8000-000000000001',1
);
insert into public.reconcile_actions(
  id,batch_id,restaurant_id,action_type,subject_table,subject_id,
  prior_state,new_state
) values (
  '16200000-0000-4000-8000-000000000082',
  '16200000-0000-4000-8000-000000000081',
  '16200000-0000-4000-8000-000000000020',
  'place_bin','inventory_items','16200000-0000-4000-8000-000000000070',
  '{"bin_id":null,"bin_location":null}'::jsonb,
  '{"bin_id":"16200000-0000-4000-8000-000000000060","bin_location":"A-01"}'::jsonb
);

create temporary table c07_0162_conserved_before(value jsonb) on commit drop;
insert into c07_0162_conserved_before(value)
select pg_catalog.jsonb_build_object(
  'receipt',(
    select pg_catalog.to_jsonb(r)
      from public.inventory_command_receipts r
     where r.restaurant_id='16200000-0000-4000-8000-000000000020'
       and r.operation_id='16200000-0000-4000-8000-000000000080'
  ),
  'reconcileBatch',(
    select pg_catalog.to_jsonb(b)
      from public.reconcile_batches b
     where b.id='16200000-0000-4000-8000-000000000081'
  ),
  'reconcileAction',(
    select pg_catalog.to_jsonb(a)
      from public.reconcile_actions a
     where a.id='16200000-0000-4000-8000-000000000082'
  ),
  'unrelatedInventory',(
    select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(ii) order by ii.id)
      from public.inventory_items ii
     where ii.id in (
       '16200000-0000-4000-8000-000000000072',
       '16200000-0000-4000-8000-000000000073',
       '16200000-0000-4000-8000-000000000074'
     )
  )
);

set local role authenticated;

select pg_catalog.set_config(
  'request.jwt.claim.sub','16200000-0000-4000-8000-000000000001',true
);
update public.bins
   set code='A-OWNER'
 where id='16200000-0000-4000-8000-000000000060'
   and restaurant_id='16200000-0000-4000-8000-000000000020';

select pg_catalog.set_config(
  'request.jwt.claim.sub','16200000-0000-4000-8000-000000000002',true
);
update public.bins
   set code='A-FINAL'
 where id='16200000-0000-4000-8000-000000000060'
   and restaurant_id='16200000-0000-4000-8000-000000000020';

reset role;

do $c07_0162_success_and_conservation$
declare
  v_before jsonb;
  v_after jsonb;
begin
  if not exists (
       select 1 from public.bins b
        where b.id='16200000-0000-4000-8000-000000000060'
          and b.restaurant_id='16200000-0000-4000-8000-000000000020'
          and b.code='A-FINAL'
     )
     or (select pg_catalog.count(*) from public.inventory_items ii
          where ii.restaurant_id='16200000-0000-4000-8000-000000000020'
            and ii.bin_id='16200000-0000-4000-8000-000000000060'
            and ii.bin_location='A-FINAL') <> 2 then
    raise exception 'C07_0162_EXACT_SITE_MIRROR_FAILED';
  end if;

  select value into strict v_before from c07_0162_conserved_before;
  select pg_catalog.jsonb_build_object(
    'receipt',(
      select pg_catalog.to_jsonb(r)
        from public.inventory_command_receipts r
       where r.restaurant_id='16200000-0000-4000-8000-000000000020'
         and r.operation_id='16200000-0000-4000-8000-000000000080'
    ),
    'reconcileBatch',(
      select pg_catalog.to_jsonb(b)
        from public.reconcile_batches b
       where b.id='16200000-0000-4000-8000-000000000081'
    ),
    'reconcileAction',(
      select pg_catalog.to_jsonb(a)
        from public.reconcile_actions a
       where a.id='16200000-0000-4000-8000-000000000082'
    ),
    'unrelatedInventory',(
      select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(ii) order by ii.id)
        from public.inventory_items ii
       where ii.id in (
         '16200000-0000-4000-8000-000000000072',
         '16200000-0000-4000-8000-000000000073',
         '16200000-0000-4000-8000-000000000074'
       )
    )
  ) into v_after;
  if v_after is distinct from v_before then
    raise exception 'C07_0162_UNRELATED_OR_HISTORY_CHANGED';
  end if;
end;
$c07_0162_success_and_conservation$;

-- Existing table authorization remains the entry point. Neither the trigger
-- nor its function creates a callable bypass.
set local role authenticated;
select pg_catalog.set_config(
  'request.jwt.claim.sub','16200000-0000-4000-8000-000000000003',true
);
with attempted as (
  update public.bins set code='STAFF-FORBIDDEN'
   where id='16200000-0000-4000-8000-000000000060'
  returning id
)
select 1 / case when (select pg_catalog.count(*) from attempted)=0 then 1 else 0 end
  as c07_0162_staff_refused;

select pg_catalog.set_config(
  'request.jwt.claim.sub','16200000-0000-4000-8000-000000000002',true
);
with attempted as (
  update public.bins set code='CROSS-SITE-FORBIDDEN'
   where id='16200000-0000-4000-8000-000000000062'
  returning id
)
select 1 / case when (select pg_catalog.count(*) from attempted)=0 then 1 else 0 end
  as c07_0162_cross_site_refused;

select pg_catalog.set_config(
  'request.jwt.claim.sub','16200000-0000-4000-8000-000000000005',true
);
reset role;
select 1 / case when not public.current_site_role_at_least(
  '16200000-0000-4000-8000-000000000020','manager'
) then 1 else 0 end as c07_0162_revoked_authority_refused;

do $c07_0162_final_state$
begin
  if not exists (
       select 1 from public.bins b
        where b.id='16200000-0000-4000-8000-000000000060'
          and b.code='A-FINAL'
     )
     or exists (
       select 1 from public.inventory_items ii
        where ii.restaurant_id='16200000-0000-4000-8000-000000000020'
          and ii.bin_id='16200000-0000-4000-8000-000000000060'
          and ii.bin_location is distinct from 'A-FINAL'
     ) then
    raise exception 'C07_0162_AUTHORIZATION_CHANGED_STATE';
  end if;
end;
$c07_0162_final_state$;

rollback;
\echo C07_0162_BIN_CODE_MIRROR_CONTRACT_PASS
