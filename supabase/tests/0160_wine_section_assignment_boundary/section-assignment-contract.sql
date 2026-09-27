-- 0160 whole-wine section-assignment rollback-only database contract.
-- Exact disposable target only; every fixture and assignment is rolled back.
\set ON_ERROR_STOP on
\pset pager off

\if :{?baseline_b_schema_sha256}
\else
  \echo C04_0160_BASELINE_SCHEMA_PIN_REQUIRED
  do $c04_0160_control$ begin raise exception 'C04_0160_BASELINE_SCHEMA_PIN_REQUIRED'; end; $c04_0160_control$;
\endif
\if :{?source_0159_sha256}
\else
  \echo C04_0160_0159_SOURCE_PIN_REQUIRED
  do $c04_0160_control$ begin raise exception 'C04_0160_0159_SOURCE_PIN_REQUIRED'; end; $c04_0160_control$;
\endif
\if :{?source_0160_sha256}
\else
  \echo C04_0160_SOURCE_PIN_REQUIRED
  do $c04_0160_control$ begin raise exception 'C04_0160_SOURCE_PIN_REQUIRED'; end; $c04_0160_control$;
\endif
\if :{?target_admitted}
\else
  \echo C04_0160_TARGET_ADMISSION_REQUIRED
  do $c04_0160_control$ begin raise exception 'C04_0160_TARGET_ADMISSION_REQUIRED'; end; $c04_0160_control$;
\endif

select 1 / case when
  :'target_admitted' = 'on'
  and :'baseline_b_schema_sha256' =
    '2848957cd7e08dea5cc64f1b5c08aca3e5068a24b324e2a27bfdb131dbc1352b'
  and :'source_0159_sha256' =
    '17063cea072da9034d71af5a5ba3744a45bef872cc814dd95f62d0da668e1fba'
  and :'source_0160_sha256' =
    '7c236443bc305345d2aa925fedeeedeb0292883f9bb4b61072c7251a012e3ba5'
then 1 else 0 end as c04_0160_contract_source_state_admitted;

begin;
set local statement_timeout = '30s';
set local lock_timeout = '5s';

do $c04_0160_catalog_and_fixture$
declare
  v_owner constant uuid := '16000000-0000-4000-8000-000000000001';
  v_manager constant uuid := '16000000-0000-4000-8000-000000000002';
  v_staff constant uuid := '16000000-0000-4000-8000-000000000003';
  v_workspace constant uuid := '16000000-0000-4000-8000-000000000010';
  v_owner_wm constant uuid := '16000000-0000-4000-8000-000000000011';
  v_manager_wm constant uuid := '16000000-0000-4000-8000-000000000012';
  v_staff_wm constant uuid := '16000000-0000-4000-8000-000000000013';
  v_owner_membership constant uuid := '16000000-0000-4000-8000-000000000021';
  v_manager_membership constant uuid := '16000000-0000-4000-8000-000000000022';
  v_staff_membership constant uuid := '16000000-0000-4000-8000-000000000023';
  v_site constant uuid := '16000000-0000-4000-8000-000000000030';
  v_foreign_site constant uuid := '16000000-0000-4000-8000-000000000031';
  v_wine constant uuid := '16000000-0000-4000-8000-000000000040';
  v_zero_inventory_wine constant uuid := '16000000-0000-4000-8000-000000000041';
  v_foreign_wine constant uuid := '16000000-0000-4000-8000-000000000042';
  v_function pg_catalog.pg_proc%rowtype;
begin
  if current_database() <> 'terroir_section_0160_20260927a'
     or current_user <> 'postgres'
     or session_user <> 'postgres'
     or public.current_inventory_contract_version() <> 2
     or pg_catalog.to_regprocedure(
       'public.accept_reconcile_batch(uuid,jsonb,uuid)'
     ) is null
     or pg_catalog.to_regprocedure('public.undo_reconcile_batch(uuid)') is null
     or pg_catalog.to_regprocedure(
       'public.assign_wine_sections_private(uuid,uuid[],text)'
     ) is null
     or exists (select 1 from auth.users)
     or exists (select 1 from public.workspaces)
     or exists (select 1 from public.restaurants)
     or exists (select 1 from public.workspace_memberships)
     or exists (select 1 from public.memberships)
     or exists (select 1 from public.wines)
     or exists (select 1 from public.inventory_items) then
    raise exception 'C04_0160_CONTRACT_TARGET_NOT_ADMITTED' using errcode = 'P0001';
  end if;

  select p.* into strict v_function
    from pg_catalog.pg_proc p
   where p.oid = 'public.assign_wine_sections_private(uuid,uuid[],text)'::pg_catalog.regprocedure;
  if (select pg_catalog.count(*)
        from pg_catalog.pg_proc p
        join pg_catalog.pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'assign_wine_sections_private') <> 1
     or pg_catalog.pg_get_userbyid(v_function.proowner) <> 'postgres'
     or v_function.prorettype <> pg_catalog.to_regtype('pg_catalog.jsonb')
     or v_function.prokind <> 'f'
     or v_function.provolatile <> 'v'
     or not v_function.prosecdef
     or v_function.proisstrict
     or v_function.proretset
     or v_function.proparallel <> 'u'
     or v_function.proleakproof
     or v_function.procost <> 100::real
     or v_function.prorows <> 0::real
     or v_function.proconfig is distinct from array['search_path=""']::text[]
     or v_function.pronargdefaults <> 0
     or v_function.provariadic <> 0::pg_catalog.oid
     or v_function.prosupport <> 0::pg_catalog.oid
     or v_function.proargdefaults is not null
     or v_function.proargmodes is not null
     or v_function.proallargtypes is not null
     or v_function.protrftypes is not null
     or v_function.prosqlbody is not null
     or v_function.probin is not null
     or pg_catalog.to_jsonb(v_function.proargnames) is distinct from
       '["p_restaurant_id", "p_wine_ids", "p_section"]'::pg_catalog.jsonb
     or pg_catalog.to_jsonb(v_function.proacl) is distinct from
       '["postgres=X/postgres", "authenticated=X/postgres"]'::pg_catalog.jsonb
     or pg_catalog.has_function_privilege(
       'anon', 'public.assign_wine_sections_private(uuid,uuid[],text)', 'EXECUTE'
     )
     or pg_catalog.has_function_privilege(
       'service_role', 'public.assign_wine_sections_private(uuid,uuid[],text)', 'EXECUTE'
     )
     or not pg_catalog.has_function_privilege(
       'authenticated', 'public.assign_wine_sections_private(uuid,uuid[],text)', 'EXECUTE'
     )
     or pg_catalog.strpos(v_function.prosrc,'order by w.id') = 0
     or pg_catalog.strpos(v_function.prosrc,'for no key update') = 0
     or pg_catalog.strpos(v_function.prosrc,'set section = v_section') = 0
     or pg_catalog.strpos(v_function.prosrc,'unit_cost') <> 0 then
    raise exception 'C04_0160_CATALOG_CONTRACT_FAILED' using errcode = 'P0001';
  end if;

  insert into auth.users(id,email) values
    (v_owner,'c04-0160-owner@terroir.test'),
    (v_manager,'c04-0160-manager@terroir.test'),
    (v_staff,'c04-0160-staff@terroir.test');
  insert into public.workspaces(id,kind,name)
    values(v_workspace,'restaurant','C04 0160 workspace');
  insert into public.restaurants(id,name,workspace_id) values
    (v_site,'C04 0160 site',v_workspace),
    (v_foreign_site,'C04 0160 foreign site',v_workspace);
  insert into public.workspace_memberships(
    id,workspace_id,user_id,governance_role
  ) values
    (v_owner_wm,v_workspace,v_owner,'workspace_owner'),
    (v_manager_wm,v_workspace,v_manager,'group_admin'),
    (v_staff_wm,v_workspace,v_staff,null);
  insert into public.memberships(
    id,user_id,restaurant_id,role,workspace_membership_id
  ) values
    (v_owner_membership,v_owner,v_site,'owner',v_owner_wm),
    (v_manager_membership,v_manager,v_site,'manager',v_manager_wm),
    (v_staff_membership,v_staff,v_site,'staff',v_staff_wm);
  insert into public.membership_capability_grants(
    workspace_id,restaurant_id,workspace_membership_id,membership_id,
    subject_user_id,site_lifecycle_generation,workspace_lifecycle_generation,
    capability_key,granted_by_user_id,grant_reason
  )
  select v_workspace,v_site,v_staff_wm,v_staff_membership,v_staff,
         m.lifecycle_generation,wm.lifecycle_generation,
         'cost.read',v_owner,'C04 0160 staff authority precedence'
    from public.memberships m
    join public.workspace_memberships wm on wm.id = m.workspace_membership_id
   where m.id = v_staff_membership;

  insert into public.wines(id,restaurant_id,name,producer,vintage,size_ml) values
    (v_wine,v_site,'C04 0160 multi-lot','Contract',2020,750),
    (v_zero_inventory_wine,v_site,'C04 0160 zero inventory','Contract',2021,750),
    (v_foreign_wine,v_foreign_site,'C04 0160 foreign','Contract',2022,750);
  insert into public.wines(id,restaurant_id,name,producer,vintage,size_ml)
  select pg_catalog.format(
           '16010000-0000-4000-8000-%s', pg_catalog.lpad(i::text,12,'0')
         )::uuid,
         v_site,
         'C04 0160 boundary ' || i,
         'Contract',
         2000 + (i % 25),
         750
    from pg_catalog.generate_series(1,200) i;
  insert into public.inventory_items(
    id,wine_id,restaurant_id,quantity,unit_cost,bin_location,added_via,
    section,format,currency
  ) values
    ('16000000-0000-4000-8000-000000000050',v_wine,v_site,3,12.34,
     'BIN-A','manual','Original A','750ml','USD'),
    ('16000000-0000-4000-8000-000000000051',v_wine,v_site,7,56.78,
     'BIN-B','invoice_scan','Original B','1.5L','EUR');
end;
$c04_0160_catalog_and_fixture$;

create temporary table c04_0160_state_before(value jsonb) on commit drop;
insert into c04_0160_state_before(value)
select pg_catalog.jsonb_build_object(
  'wines', coalesce((
    select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(w) order by w.id)
      from public.wines w
     where w.restaurant_id = '16000000-0000-4000-8000-000000000030'
  ), '[]'::jsonb),
  'inventoryWithoutSectionOrUpdatedAt', coalesce((
    select pg_catalog.jsonb_agg(
      pg_catalog.to_jsonb(ii) - 'section' - 'updated_at' order by ii.id
    ) from public.inventory_items ii
     where ii.restaurant_id = '16000000-0000-4000-8000-000000000030'
  ), '[]'::jsonb),
  'stockAdjustments', coalesce((
    select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(x) order by x.id)
      from public.stock_adjustments x
     where x.restaurant_id = '16000000-0000-4000-8000-000000000030'
  ), '[]'::jsonb),
  'availabilityEvents', coalesce((
    select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(x) order by x.id)
      from public.availability_events x
     where x.restaurant_id = '16000000-0000-4000-8000-000000000030'
  ), '[]'::jsonb),
  'openBottles', coalesce((
    select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(x) order by x.id)
      from public.open_bottles x
     where x.restaurant_id = '16000000-0000-4000-8000-000000000030'
  ), '[]'::jsonb),
  'pourEvents', coalesce((
    select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(x) order by x.id)
      from public.pour_events x
     where x.restaurant_id = '16000000-0000-4000-8000-000000000030'
  ), '[]'::jsonb),
  'bottleCloseouts', coalesce((
    select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(x) order by x.id)
      from public.bottle_closeouts x
     where x.restaurant_id = '16000000-0000-4000-8000-000000000030'
  ), '[]'::jsonb),
  'commandReceipts', coalesce((
    select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(x) order by x.operation_id)
      from public.inventory_command_receipts x
     where x.restaurant_id = '16000000-0000-4000-8000-000000000030'
  ), '[]'::jsonb),
  'bottleEffects', coalesce((
    select pg_catalog.jsonb_agg(
      pg_catalog.to_jsonb(x) order by x.operation_id,x.entry_ordinal
    )
      from public.inventory_command_bottle_effects x
     where x.restaurant_id = '16000000-0000-4000-8000-000000000030'
  ), '[]'::jsonb)
);

set local role authenticated;
do $c04_0160_authenticated_semantics$
declare
  v_owner constant uuid := '16000000-0000-4000-8000-000000000001';
  v_manager constant uuid := '16000000-0000-4000-8000-000000000002';
  v_staff constant uuid := '16000000-0000-4000-8000-000000000003';
  v_site constant uuid := '16000000-0000-4000-8000-000000000030';
  v_foreign_site constant uuid := '16000000-0000-4000-8000-000000000031';
  v_wine constant uuid := '16000000-0000-4000-8000-000000000040';
  v_zero_inventory_wine constant uuid := '16000000-0000-4000-8000-000000000041';
  v_foreign_wine constant uuid := '16000000-0000-4000-8000-000000000042';
  v_missing constant uuid := '16000000-0000-4000-8000-000000000099';
  v_boundary_ids uuid[];
  v_result jsonb;
  v_before jsonb;
  v_after jsonb;
begin
  perform pg_catalog.set_config('request.jwt.claim.sub',v_owner::text,true);
  if public.effective_site_capability(v_site,'cost.read') then
    raise exception 'C04_0160_OWNER_FIXTURE_HAS_COST_READ';
  end if;
  v_result := public.assign_wine_sections_private(v_site,array[v_wine],' Owner ');
  if v_result is distinct from
       pg_catalog.jsonb_build_object('requestedWineCount',1,'section','Owner')
     or (select pg_catalog.count(*) from pg_catalog.jsonb_object_keys(v_result)) <> 2
     or pg_catalog.jsonb_typeof(v_result->'requestedWineCount') <> 'number'
     or pg_catalog.jsonb_typeof(v_result->'section') <> 'string' then
    raise exception 'C04_0160_OWNER_RECEIPT_FAILED';
  end if;

  perform pg_catalog.set_config('request.jwt.claim.sub',v_manager::text,true);
  if public.effective_site_capability(v_site,'cost.read') then
    raise exception 'C04_0160_MANAGER_FIXTURE_HAS_COST_READ';
  end if;
  v_result := public.assign_wine_sections_private(
    v_site,array[v_zero_inventory_wine],'Manager'
  );
  if v_result is distinct from
       pg_catalog.jsonb_build_object('requestedWineCount',1,'section','Manager')
     or exists (
       select 1 from public.inventory_items ii
        where ii.restaurant_id=v_site and ii.wine_id=v_zero_inventory_wine
     ) then
    raise exception 'C04_0160_ZERO_INVENTORY_SUCCESS_FAILED';
  end if;

  select pg_catalog.array_agg(w.id order by w.id) into v_boundary_ids
    from public.wines w
   where w.restaurant_id = v_site and w.name like 'C04 0160 boundary %';
  if pg_catalog.cardinality(v_boundary_ids) <> 200 then
    raise exception 'C04_0160_BOUNDARY_FIXTURE_FAILED';
  end if;
  v_result := public.assign_wine_sections_private(v_site,v_boundary_ids,repeat('x',100));
  if v_result is distinct from pg_catalog.jsonb_build_object(
       'requestedWineCount',200,'section',repeat('x',100)
     ) then
    raise exception 'C04_0160_200_OR_100_BOUND_FAILED';
  end if;

  begin
    perform public.assign_wine_sections_private(
      v_site,pg_catalog.array_append(v_boundary_ids,v_boundary_ids[1]),'Too many'
    );
    raise exception 'C04_0160_EXPECTED_201_REFUSAL';
  exception when sqlstate 'P04V1' then null;
  end;
  begin
    perform public.assign_wine_sections_private(v_site,array[v_wine],repeat('x',101));
    raise exception 'C04_0160_EXPECTED_101_REFUSAL';
  exception when sqlstate 'P04V1' then null;
  end;
  begin
    perform public.assign_wine_sections_private(v_site,null,'Invalid');
    raise exception 'C04_0160_EXPECTED_NULL_ARRAY_REFUSAL';
  exception when sqlstate 'P04V1' then null;
  end;
  begin
    perform public.assign_wine_sections_private(v_site,array[]::uuid[],'Invalid');
    raise exception 'C04_0160_EXPECTED_EMPTY_ARRAY_REFUSAL';
  exception when sqlstate 'P04V1' then null;
  end;
  begin
    perform public.assign_wine_sections_private(v_site,array[v_wine,null::uuid],'Invalid');
    raise exception 'C04_0160_EXPECTED_NULL_ELEMENT_REFUSAL';
  exception when sqlstate 'P04V1' then null;
  end;
  begin
    perform public.assign_wine_sections_private(v_site,array[v_wine,v_wine],'Duplicate');
    raise exception 'C04_0160_EXPECTED_DUPLICATE_REFUSAL';
  exception when sqlstate 'P04W1' then null;
  end;

  select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'id',ii.id,'section',ii.section,'updated_at',ii.updated_at
  ) order by ii.id) into v_before
    from public.inventory_items ii
   where ii.restaurant_id=v_site and ii.wine_id=v_wine;
  begin
    perform public.assign_wine_sections_private(v_site,array[v_wine,v_missing],'Missing');
    raise exception 'C04_0160_EXPECTED_MISSING_REFUSAL';
  exception when sqlstate 'P04W1' then null;
  end;
  begin
    perform public.assign_wine_sections_private(
      v_site,array[v_wine,v_foreign_wine],'Foreign'
    );
    raise exception 'C04_0160_EXPECTED_FOREIGN_SET_REFUSAL';
  exception when sqlstate 'P04W1' then null;
  end;
  select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'id',ii.id,'section',ii.section,'updated_at',ii.updated_at
  ) order by ii.id) into v_after
    from public.inventory_items ii
   where ii.restaurant_id=v_site and ii.wine_id=v_wine;
  if v_after is distinct from v_before then
    raise exception 'C04_0160_SET_REFUSAL_WAS_NOT_ATOMIC';
  end if;

  v_result := public.assign_wine_sections_private(v_site,array[v_wine],'   ');
  if v_result is distinct from
       pg_catalog.jsonb_build_object('requestedWineCount',1,'section',null)
     or exists (
       select 1 from public.inventory_items ii
        where ii.restaurant_id=v_site and ii.wine_id=v_wine and ii.section is not null
     ) then
    raise exception 'C04_0160_BLANK_TO_NULL_FAILED';
  end if;
  perform public.assign_wine_sections_private(v_site,array[v_wine],'Multi lot');
  if (select pg_catalog.count(*) from public.inventory_items ii
       where ii.restaurant_id=v_site and ii.wine_id=v_wine
         and ii.section='Multi lot') <> 2 then
    raise exception 'C04_0160_MULTI_LOT_UPDATE_FAILED';
  end if;

  perform pg_catalog.set_config('request.jwt.claim.sub',v_owner::text,true);
  perform public.assign_wine_sections_private(v_site,array[v_wine],'First');
  perform pg_catalog.set_config('request.jwt.claim.sub',v_manager::text,true);
  perform public.assign_wine_sections_private(v_site,array[v_wine],'Second');
  if (select pg_catalog.count(*) from public.inventory_items ii
       where ii.restaurant_id=v_site and ii.wine_id=v_wine
         and ii.section='Second') <> 2 then
    raise exception 'C04_0160_SEQUENTIAL_LAST_WRITE_FAILED';
  end if;

  begin
    perform public.assign_wine_sections_private(v_foreign_site,array[v_foreign_wine],null);
    raise exception 'C04_0160_EXPECTED_CROSS_SITE_AUTHORITY_REFUSAL';
  exception when sqlstate '42501' then null;
  end;
  perform pg_catalog.set_config('request.jwt.claim.sub',v_staff::text,true);
  if not public.effective_site_capability(v_site,'cost.read') then
    raise exception 'C04_0160_STAFF_COST_READ_FIXTURE_FAILED';
  end if;
  begin
    perform public.assign_wine_sections_private(v_site,array[v_wine],'Staff');
    raise exception 'C04_0160_EXPECTED_STAFF_REFUSAL';
  exception when sqlstate '42501' then null;
  end;
  begin
    perform public.assign_wine_sections_private(v_site,null,repeat('x',101));
    raise exception 'C04_0160_EXPECTED_AUTHORITY_PRECEDENCE';
  exception when sqlstate '42501' then null;
  end;
end;
$c04_0160_authenticated_semantics$;
reset role;

update public.memberships
   set status='revoked',revoked_at=statement_timestamp()
 where id='16000000-0000-4000-8000-000000000022';
set local role authenticated;
do $c04_0160_revoked_site$
begin
  perform pg_catalog.set_config(
    'request.jwt.claim.sub','16000000-0000-4000-8000-000000000002',true
  );
  begin
    perform public.assign_wine_sections_private(
      '16000000-0000-4000-8000-000000000030',
      array['16000000-0000-4000-8000-000000000040'::uuid],null
    );
    raise exception 'C04_0160_EXPECTED_REVOKED_SITE_REFUSAL';
  exception when sqlstate '42501' then null;
  end;
end;
$c04_0160_revoked_site$;
reset role;
update public.memberships
   set status='active',revoked_at=null,expires_at=statement_timestamp()
 where id='16000000-0000-4000-8000-000000000022';
set local role authenticated;
do $c04_0160_expired_site$
begin
  perform pg_catalog.set_config(
    'request.jwt.claim.sub','16000000-0000-4000-8000-000000000002',true
  );
  begin
    perform public.assign_wine_sections_private(
      '16000000-0000-4000-8000-000000000030',
      array['16000000-0000-4000-8000-000000000040'::uuid],null
    );
    raise exception 'C04_0160_EXPECTED_EXPIRED_SITE_REFUSAL';
  exception when sqlstate '42501' then null;
  end;
end;
$c04_0160_expired_site$;
reset role;
update public.memberships
   set expires_at=null
 where id='16000000-0000-4000-8000-000000000022';

update public.workspace_memberships
   set status='revoked',revoked_at=statement_timestamp()
 where id='16000000-0000-4000-8000-000000000012';
set local role authenticated;
do $c04_0160_revoked_workspace$
begin
  perform pg_catalog.set_config(
    'request.jwt.claim.sub','16000000-0000-4000-8000-000000000002',true
  );
  begin
    perform public.assign_wine_sections_private(
      '16000000-0000-4000-8000-000000000030',
      array['16000000-0000-4000-8000-000000000040'::uuid],null
    );
    raise exception 'C04_0160_EXPECTED_REVOKED_WORKSPACE_REFUSAL';
  exception when sqlstate '42501' then null;
  end;
end;
$c04_0160_revoked_workspace$;
reset role;
update public.workspace_memberships
   set status='active',revoked_at=null,expires_at=statement_timestamp()
 where id='16000000-0000-4000-8000-000000000012';
set local role authenticated;
do $c04_0160_expired_workspace$
begin
  perform pg_catalog.set_config(
    'request.jwt.claim.sub','16000000-0000-4000-8000-000000000002',true
  );
  begin
    perform public.assign_wine_sections_private(
      '16000000-0000-4000-8000-000000000030',
      array['16000000-0000-4000-8000-000000000040'::uuid],null
    );
    raise exception 'C04_0160_EXPECTED_EXPIRED_WORKSPACE_REFUSAL';
  exception when sqlstate '42501' then null;
  end;
end;
$c04_0160_expired_workspace$;
reset role;
update public.workspace_memberships
   set expires_at=null
 where id='16000000-0000-4000-8000-000000000012';

set local role anon;
do $c04_0160_anon_acl$
begin
  perform pg_catalog.set_config('request.jwt.claim.sub','',true);
  begin
    perform public.assign_wine_sections_private(
      '16000000-0000-4000-8000-000000000030',array[]::uuid[],null
    );
    raise exception 'C04_0160_EXPECTED_ANON_EXECUTE_REFUSAL';
  exception when sqlstate '42501' then null;
  end;
end;
$c04_0160_anon_acl$;
reset role;

set local role service_role;
do $c04_0160_service_acl$
begin
  perform pg_catalog.set_config(
    'request.jwt.claim.sub','16000000-0000-4000-8000-000000000001',true
  );
  begin
    perform public.assign_wine_sections_private(
      '16000000-0000-4000-8000-000000000030',
      array['16000000-0000-4000-8000-000000000040'::uuid],null
    );
    raise exception 'C04_0160_EXPECTED_SERVICE_EXECUTE_REFUSAL';
  exception when sqlstate '42501' then null;
  end;
end;
$c04_0160_service_acl$;
reset role;

do $c04_0160_anonymous_authority_precedence$
begin
  perform pg_catalog.set_config('request.jwt.claim.sub','',true);
  begin
    perform public.assign_wine_sections_private(
      '16000000-0000-4000-8000-000000000030',null,repeat('x',101)
    );
    raise exception 'C04_0160_EXPECTED_ANONYMOUS_AUTHORITY_PRECEDENCE';
  exception when sqlstate '42501' then null;
  end;
end;
$c04_0160_anonymous_authority_precedence$;

do $c04_0160_final_conservation$
declare
  v_before jsonb;
  v_after jsonb;
begin
  select value into strict v_before from c04_0160_state_before;
  select pg_catalog.jsonb_build_object(
    'wines', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(w) order by w.id)
        from public.wines w
       where w.restaurant_id = '16000000-0000-4000-8000-000000000030'
    ), '[]'::jsonb),
    'inventoryWithoutSectionOrUpdatedAt', coalesce((
      select pg_catalog.jsonb_agg(
        pg_catalog.to_jsonb(ii) - 'section' - 'updated_at' order by ii.id
      ) from public.inventory_items ii
       where ii.restaurant_id = '16000000-0000-4000-8000-000000000030'
    ), '[]'::jsonb),
    'stockAdjustments', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(x) order by x.id)
        from public.stock_adjustments x
       where x.restaurant_id = '16000000-0000-4000-8000-000000000030'
    ), '[]'::jsonb),
    'availabilityEvents', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(x) order by x.id)
        from public.availability_events x
       where x.restaurant_id = '16000000-0000-4000-8000-000000000030'
    ), '[]'::jsonb),
    'openBottles', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(x) order by x.id)
        from public.open_bottles x
       where x.restaurant_id = '16000000-0000-4000-8000-000000000030'
    ), '[]'::jsonb),
    'pourEvents', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(x) order by x.id)
        from public.pour_events x
       where x.restaurant_id = '16000000-0000-4000-8000-000000000030'
    ), '[]'::jsonb),
    'bottleCloseouts', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(x) order by x.id)
        from public.bottle_closeouts x
       where x.restaurant_id = '16000000-0000-4000-8000-000000000030'
    ), '[]'::jsonb),
    'commandReceipts', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(x) order by x.operation_id)
        from public.inventory_command_receipts x
       where x.restaurant_id = '16000000-0000-4000-8000-000000000030'
    ), '[]'::jsonb),
    'bottleEffects', coalesce((
      select pg_catalog.jsonb_agg(
        pg_catalog.to_jsonb(x) order by x.operation_id,x.entry_ordinal
      )
        from public.inventory_command_bottle_effects x
       where x.restaurant_id = '16000000-0000-4000-8000-000000000030'
    ), '[]'::jsonb)
  ) into v_after;

  if v_after is distinct from v_before
     or (select pg_catalog.count(*) from public.inventory_items ii
          where ii.restaurant_id='16000000-0000-4000-8000-000000000030'
            and ii.wine_id='16000000-0000-4000-8000-000000000040'
            and ii.section='Second') <> 2
     or exists (
       select 1 from public.inventory_items ii
        where ii.restaurant_id='16000000-0000-4000-8000-000000000030'
          and ii.wine_id='16000000-0000-4000-8000-000000000041'
     ) then
    raise exception 'C04_0160_STOCK_COST_OR_PHYSICAL_CONSERVATION_FAILED';
  end if;
end;
$c04_0160_final_conservation$;

rollback;
\echo C04_0160_SECTION_ASSIGNMENT_CONTRACT_PASS
