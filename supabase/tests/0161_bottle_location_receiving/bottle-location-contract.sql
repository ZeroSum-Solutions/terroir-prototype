-- 0161 transactional functional, authority, error and conservation contract.
-- The root executor supplies a separately admitted disposable database name.
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
\if :{?source_0161_sha256}
\else
  \echo C06_0161_SOURCE_PIN_REQUIRED
  \quit 3
\endif

select 1 / case when
  current_database() = :'expected_database'
  and current_user = 'postgres'
  and session_user = 'postgres'
  and :'target_admitted' = 'on'
  and :'source_0161_sha256' = '7c13530124d26003caf478b65904e02934a5e232c3ebcf4343a1b75914e0fcf7'
  and public.current_inventory_contract_version() = 2
  and pg_catalog.to_regprocedure(
    'public.receive_bottle_at_location_private(uuid,uuid,uuid,text,uuid)'
  ) is not null
then 1 else 0 end as c06_0161_target_admitted;

begin;
set local statement_timeout = '30s';
set local lock_timeout = '5s';

do $c06_0161_catalog$
declare
  v_function pg_catalog.pg_proc%rowtype;
  v_definition text;
begin
  select p.* into strict v_function
    from pg_catalog.pg_proc p
   where p.oid = pg_catalog.to_regprocedure(
     'public.receive_bottle_at_location_private(uuid,uuid,uuid,text,uuid)'
   );
  select pg_catalog.pg_get_constraintdef(c.oid, true) into strict v_definition
    from pg_catalog.pg_constraint c
   where c.conrelid = pg_catalog.to_regclass('public.inventory_command_receipts')
     and c.conname = 'inventory_command_receipts_versioned_shape_check';

  if (select pg_catalog.count(*)
        from pg_catalog.pg_proc p
        join pg_catalog.pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public'
         and p.proname = 'receive_bottle_at_location_private') <> 1
     or pg_catalog.encode(
       pg_catalog.sha256(pg_catalog.convert_to(v_function.prosrc, 'UTF8')), 'hex'
     ) <> '6a24736e1a19541d567081f9cec72f32e4c72af371f6d62f0c8015480750af03'
     or pg_catalog.pg_get_userbyid(v_function.proowner) <> 'postgres'
     or v_function.prorettype <> pg_catalog.to_regtype('pg_catalog.jsonb')
     or not v_function.prosecdef
     or v_function.proconfig is distinct from array['search_path=""']::text[]
     or v_function.pronargdefaults <> 0
     or pg_catalog.to_jsonb(v_function.proargnames) is distinct from
       '["p_restaurant_id", "p_operation_id", "p_wine_id", "p_section", "p_bin_id"]'::jsonb
     or pg_catalog.to_jsonb(v_function.proacl) is distinct from
       '["postgres=X/postgres", "authenticated=X/postgres"]'::jsonb
     or pg_catalog.strpos(v_definition, 'bottle_inventory_save') = 0
     or pg_catalog.strpos(v_definition, 'bottle_location_receive') = 0
     or pg_catalog.has_table_privilege(
       'authenticated', 'public.inventory_command_receipts', 'SELECT,INSERT,UPDATE,DELETE'
     )
     or pg_catalog.has_table_privilege(
       'anon', 'public.inventory_command_receipts', 'SELECT,INSERT,UPDATE,DELETE'
     )
     or pg_catalog.has_table_privilege(
       'service_role', 'public.inventory_command_receipts', 'INSERT,UPDATE,DELETE'
     ) then
    raise exception 'C06_0161_CATALOG_CONTRACT_FAILED';
  end if;
end;
$c06_0161_catalog$;

insert into auth.users(id,email) values
  ('16100000-0000-4000-8000-000000000001','c06-0161-owner@terroir.test'),
  ('16100000-0000-4000-8000-000000000002','c06-0161-manager@terroir.test'),
  ('16100000-0000-4000-8000-000000000003','c06-0161-staff@terroir.test'),
  ('16100000-0000-4000-8000-000000000004','c06-0161-foreign@terroir.test');

insert into public.workspaces(id,kind,name) values
  ('16100000-0000-4000-8000-000000000010','restaurant','C06 0161 workspace');
insert into public.restaurants(id,name,workspace_id) values
  ('16100000-0000-4000-8000-000000000020','C06 0161 site','16100000-0000-4000-8000-000000000010'),
  ('16100000-0000-4000-8000-000000000021','C06 0161 foreign site','16100000-0000-4000-8000-000000000010');
insert into public.workspace_memberships(
  id,workspace_id,user_id,governance_role
) values
  ('16100000-0000-4000-8000-000000000030','16100000-0000-4000-8000-000000000010','16100000-0000-4000-8000-000000000001','workspace_owner'),
  ('16100000-0000-4000-8000-000000000031','16100000-0000-4000-8000-000000000010','16100000-0000-4000-8000-000000000002','group_admin'),
  ('16100000-0000-4000-8000-000000000032','16100000-0000-4000-8000-000000000010','16100000-0000-4000-8000-000000000003',null),
  ('16100000-0000-4000-8000-000000000033','16100000-0000-4000-8000-000000000010','16100000-0000-4000-8000-000000000004',null);
insert into public.memberships(
  id,user_id,restaurant_id,role,workspace_membership_id
) values
  ('16100000-0000-4000-8000-000000000040','16100000-0000-4000-8000-000000000001','16100000-0000-4000-8000-000000000020','owner','16100000-0000-4000-8000-000000000030'),
  ('16100000-0000-4000-8000-000000000041','16100000-0000-4000-8000-000000000002','16100000-0000-4000-8000-000000000020','manager','16100000-0000-4000-8000-000000000031'),
  ('16100000-0000-4000-8000-000000000042','16100000-0000-4000-8000-000000000003','16100000-0000-4000-8000-000000000020','staff','16100000-0000-4000-8000-000000000032'),
  ('16100000-0000-4000-8000-000000000043','16100000-0000-4000-8000-000000000003','16100000-0000-4000-8000-000000000021','staff','16100000-0000-4000-8000-000000000032'),
  ('16100000-0000-4000-8000-000000000044','16100000-0000-4000-8000-000000000004','16100000-0000-4000-8000-000000000021','staff','16100000-0000-4000-8000-000000000033');

insert into public.wines(id,restaurant_id,name,producer,vintage,size_ml) values
  ('16100000-0000-4000-8000-000000000050','16100000-0000-4000-8000-000000000020','C06 0161 wine','Contract',2020,750),
  ('16100000-0000-4000-8000-000000000051','16100000-0000-4000-8000-000000000020','C06 0161 other wine','Contract',2021,750),
  ('16100000-0000-4000-8000-000000000052','16100000-0000-4000-8000-000000000021','C06 0161 foreign wine','Contract',2022,750);
insert into public.bins(id,restaurant_id,code) values
  ('16100000-0000-4000-8000-000000000060','16100000-0000-4000-8000-000000000020','A-01'),
  ('16100000-0000-4000-8000-000000000061','16100000-0000-4000-8000-000000000020','A-02'),
  ('16100000-0000-4000-8000-000000000062','16100000-0000-4000-8000-000000000021','F-01'),
  ('16100000-0000-4000-8000-000000000063','16100000-0000-4000-8000-000000000020','A-RETIRED');
update public.bins set retired_at=pg_catalog.statement_timestamp()
 where id='16100000-0000-4000-8000-000000000063';

create temporary table c06_0161_noninventory_before(value jsonb) on commit drop;
insert into c06_0161_noninventory_before(value)
select pg_catalog.jsonb_build_object(
  'openBottles', (select pg_catalog.count(*) from public.open_bottles),
  'pourEvents', (select pg_catalog.count(*) from public.pour_events),
  'closeouts', (select pg_catalog.count(*) from public.bottle_closeouts),
  'effects', (select pg_catalog.count(*) from public.inventory_command_bottle_effects),
  'adjustments', (select pg_catalog.count(*) from public.stock_adjustments),
  'availability', (select pg_catalog.count(*) from public.availability_events)
);

set local role authenticated;

do $c06_0161_success_replay_and_conflicts$
declare
  v_site constant uuid := '16100000-0000-4000-8000-000000000020';
  v_foreign_site constant uuid := '16100000-0000-4000-8000-000000000021';
  v_wine constant uuid := '16100000-0000-4000-8000-000000000050';
  v_other_wine constant uuid := '16100000-0000-4000-8000-000000000051';
  v_foreign_wine constant uuid := '16100000-0000-4000-8000-000000000052';
  v_bin constant uuid := '16100000-0000-4000-8000-000000000060';
  v_other_bin constant uuid := '16100000-0000-4000-8000-000000000061';
  v_foreign_bin constant uuid := '16100000-0000-4000-8000-000000000062';
  v_retired_bin constant uuid := '16100000-0000-4000-8000-000000000063';
  v_operation constant uuid := '16100000-0000-4000-8000-000000000070';
  v_cross_site_operation constant uuid := '16100000-0000-4000-8000-000000000071';
  v_result jsonb;
  v_replay jsonb;
  v_cross_a jsonb;
  v_cross_b jsonb;
  v_before_count bigint;
begin
  perform pg_catalog.set_config(
    'request.jwt.claim.sub','16100000-0000-4000-8000-000000000003',true
  );
  if public.effective_site_capability(v_site,'cost.read') then
    raise exception 'C06_0161_STAFF_FIXTURE_HAS_COST_READ';
  end if;

  v_result := public.receive_bottle_at_location_private(
    v_site,v_operation,v_wine,'  Main Cellar  ',v_bin
  );
  if (v_result - 'replayed') is distinct from pg_catalog.jsonb_build_object(
       'version',1,'kind','bottle_location_receive','status','committed',
       'operationId',v_operation,'inventoryItemId',v_result->>'inventoryItemId',
       'wineId',v_wine,'section','Main Cellar','binId',v_bin,
       'binCode','A-01','quantity',1
     )
     or v_result->'replayed' is distinct from 'false'::jsonb
     or (select pg_catalog.count(*) from pg_catalog.jsonb_object_keys(v_result)) <> 11 then
    raise exception 'C06_0161_FIRST_RECEIPT_FAILED';
  end if;
  select pg_catalog.count(*) into v_before_count
    from public.inventory_items ii
   where ii.restaurant_id=v_site;
  v_replay := public.receive_bottle_at_location_private(
    v_site,v_operation,v_wine,'Main Cellar',v_bin
  );
  if (v_replay - 'replayed') is distinct from (v_result - 'replayed')
     or v_replay->'replayed' is distinct from 'true'::jsonb
     or (select pg_catalog.count(*) from public.inventory_items ii
          where ii.restaurant_id=v_site) <> v_before_count then
    raise exception 'C06_0161_EXACT_REPLAY_FAILED';
  end if;

  foreach v_result in array array[
    pg_catalog.jsonb_build_object('case','wine'),
    pg_catalog.jsonb_build_object('case','section'),
    pg_catalog.jsonb_build_object('case','bin')
  ] loop
    begin
      perform public.receive_bottle_at_location_private(
        v_site,v_operation,
        case when v_result->>'case'='wine' then v_other_wine else v_wine end,
        case when v_result->>'case'='section' then 'Changed' else 'Main Cellar' end,
        case when v_result->>'case'='bin' then v_other_bin else v_bin end
      );
      raise exception 'C06_0161_EXPECTED_PAYLOAD_CONFLICT';
    exception when sqlstate 'P05C1' then null;
    end;
  end loop;
  perform pg_catalog.set_config(
    'request.jwt.claim.sub','16100000-0000-4000-8000-000000000001',true
  );
  begin
    perform public.receive_bottle_at_location_private(
      v_site,v_operation,v_wine,'Main Cellar',v_bin
    );
    raise exception 'C06_0161_EXPECTED_ACTOR_CONFLICT';
  exception when sqlstate 'P05C1' then null;
  end;

  -- The operation key is site-scoped. The same actor is current at both sites.
  perform pg_catalog.set_config(
    'request.jwt.claim.sub','16100000-0000-4000-8000-000000000003',true
  );
  v_cross_a := public.receive_bottle_at_location_private(
    v_site,v_cross_site_operation,v_wine,'Site A',v_bin
  );
  v_cross_b := public.receive_bottle_at_location_private(
    v_foreign_site,v_cross_site_operation,v_foreign_wine,'Site B',v_foreign_bin
  );
  if v_cross_a->>'inventoryItemId' = v_cross_b->>'inventoryItemId'
     or v_cross_a->>'operationId' is distinct from v_cross_b->>'operationId'
     or v_cross_a->>'binCode' is distinct from 'A-01'
     or v_cross_b->>'binCode' is distinct from 'F-01' then
    raise exception 'C06_0161_SITE_SCOPED_OPERATION_FAILED';
  end if;

  -- Two actual bottles use distinct UUIDs; matching payload is not deduped.
  perform public.receive_bottle_at_location_private(
    v_site,'16100000-0000-4000-8000-000000000072',v_wine,'Main Cellar',v_bin
  );
  perform public.receive_bottle_at_location_private(
    v_site,'16100000-0000-4000-8000-000000000073',v_wine,'Main Cellar',v_bin
  );
  if (select pg_catalog.count(*) from public.inventory_items ii
       where ii.restaurant_id=v_site and ii.wine_id=v_wine
         and ii.bin_id=v_bin and ii.section='Main Cellar') <> 3 then
    raise exception 'C06_0161_DISTINCT_BOTTLES_COLLAPSED';
  end if;
end;
$c06_0161_success_replay_and_conflicts$;

do $c06_0161_authority_and_input$
declare
  v_site constant uuid := '16100000-0000-4000-8000-000000000020';
  v_wine constant uuid := '16100000-0000-4000-8000-000000000050';
  v_bin constant uuid := '16100000-0000-4000-8000-000000000060';
  v_operation uuid := '16100000-0000-4000-8000-000000000080';
begin
  -- All three current operational roles are admitted.
  perform pg_catalog.set_config(
    'request.jwt.claim.sub','16100000-0000-4000-8000-000000000001',true
  );
  perform public.receive_bottle_at_location_private(
    v_site,v_operation,v_wine,'Owner',v_bin
  );
  perform pg_catalog.set_config(
    'request.jwt.claim.sub','16100000-0000-4000-8000-000000000002',true
  );
  perform public.receive_bottle_at_location_private(
    v_site,'16100000-0000-4000-8000-000000000081',v_wine,'Manager',v_bin
  );

  perform pg_catalog.set_config(
    'request.jwt.claim.sub','16100000-0000-4000-8000-000000000004',true
  );
  begin
    perform public.receive_bottle_at_location_private(
      v_site,'16100000-0000-4000-8000-000000000082',v_wine,'Foreign',v_bin
    );
    raise exception 'C06_0161_EXPECTED_FOREIGN_AUTHORITY_REFUSAL';
  exception when sqlstate '42501' then null;
  end;
  perform pg_catalog.set_config('request.jwt.claim.sub','',true);
  begin
    perform public.receive_bottle_at_location_private(
      v_site,'16100000-0000-4000-8000-000000000083',v_wine,'Anonymous',v_bin
    );
    raise exception 'C06_0161_EXPECTED_ANONYMOUS_REFUSAL';
  exception when sqlstate '42501' then null;
  end;

  perform pg_catalog.set_config(
    'request.jwt.claim.sub','16100000-0000-4000-8000-000000000003',true
  );
  begin
    perform public.receive_bottle_at_location_private(
      v_site,null,v_wine,'Invalid',v_bin
    );
    raise exception 'C06_0161_EXPECTED_NULL_OPERATION_REFUSAL';
  exception when sqlstate 'P05V1' then null;
  end;
  begin
    perform public.receive_bottle_at_location_private(
      v_site,'16100000-0000-4000-8000-000000000084',null,'Invalid',v_bin
    );
    raise exception 'C06_0161_EXPECTED_NULL_WINE_REFUSAL';
  exception when sqlstate 'P05V1' then null;
  end;
  begin
    perform public.receive_bottle_at_location_private(
      v_site,'16100000-0000-4000-8000-000000000085',v_wine,null,v_bin
    );
    raise exception 'C06_0161_EXPECTED_NULL_SECTION_REFUSAL';
  exception when sqlstate 'P05V1' then null;
  end;
  begin
    perform public.receive_bottle_at_location_private(
      v_site,'16100000-0000-4000-8000-000000000086',v_wine,'   ',v_bin
    );
    raise exception 'C06_0161_EXPECTED_BLANK_SECTION_REFUSAL';
  exception when sqlstate 'P05V1' then null;
  end;
  begin
    perform public.receive_bottle_at_location_private(
      v_site,'16100000-0000-4000-8000-000000000087',v_wine,
      pg_catalog.repeat('x',201),v_bin
    );
    raise exception 'C06_0161_EXPECTED_LONG_SECTION_REFUSAL';
  exception when sqlstate 'P05V1' then null;
  end;
  begin
    perform public.receive_bottle_at_location_private(
      v_site,'16100000-0000-4000-8000-000000000088',v_wine,'Invalid',null
    );
    raise exception 'C06_0161_EXPECTED_NULL_BIN_REFUSAL';
  exception when sqlstate 'P05V1' then null;
  end;
  begin
    perform public.receive_bottle_at_location_private(
      v_site,'16100000-0000-4000-8000-000000000089',
      '16100000-0000-4000-8000-000000000099','Missing wine',v_bin
    );
    raise exception 'C06_0161_EXPECTED_MISSING_WINE_REFUSAL';
  exception when sqlstate 'P05W1' then null;
  end;
  begin
    perform public.receive_bottle_at_location_private(
      v_site,'16100000-0000-4000-8000-000000000090',
      '16100000-0000-4000-8000-000000000052','Foreign wine',v_bin
    );
    raise exception 'C06_0161_EXPECTED_FOREIGN_WINE_REFUSAL';
  exception when sqlstate 'P05W1' then null;
  end;
  begin
    perform public.receive_bottle_at_location_private(
      v_site,'16100000-0000-4000-8000-000000000091',v_wine,'Missing bin',
      '16100000-0000-4000-8000-000000000099'
    );
    raise exception 'C06_0161_EXPECTED_MISSING_BIN_REFUSAL';
  exception when sqlstate 'P05B1' then null;
  end;
  begin
    perform public.receive_bottle_at_location_private(
      v_site,'16100000-0000-4000-8000-000000000092',v_wine,'Foreign bin',
      '16100000-0000-4000-8000-000000000062'
    );
    raise exception 'C06_0161_EXPECTED_FOREIGN_BIN_REFUSAL';
  exception when sqlstate 'P05B1' then null;
  end;
  begin
    perform public.receive_bottle_at_location_private(
      v_site,'16100000-0000-4000-8000-000000000093',v_wine,'Retired bin',
      '16100000-0000-4000-8000-000000000063'
    );
    raise exception 'C06_0161_EXPECTED_RETIRED_BIN_REFUSAL';
  exception when sqlstate 'P05B1' then null;
  end;
end;
$c06_0161_authority_and_input$;

reset role;

-- Every rejected input above must have rolled back its receipt claim.
do $c06_0161_zero_effect_and_exact_rows$
declare
  v_before jsonb;
  v_after jsonb;
begin
  select value into strict v_before from c06_0161_noninventory_before;
  select pg_catalog.jsonb_build_object(
    'openBottles', (select pg_catalog.count(*) from public.open_bottles),
    'pourEvents', (select pg_catalog.count(*) from public.pour_events),
    'closeouts', (select pg_catalog.count(*) from public.bottle_closeouts),
    'effects', (select pg_catalog.count(*) from public.inventory_command_bottle_effects),
    'adjustments', (select pg_catalog.count(*) from public.stock_adjustments),
    'availability', (select pg_catalog.count(*) from public.availability_events)
  ) into v_after;
  if v_after is distinct from v_before
     or exists (
       select 1
         from public.inventory_command_receipts r
        where r.operation_id between
          '16100000-0000-4000-8000-000000000082'::uuid and
          '16100000-0000-4000-8000-000000000093'::uuid
     )
     or exists (
       select 1
         from public.inventory_items ii
        where ii.restaurant_id in (
          '16100000-0000-4000-8000-000000000020',
          '16100000-0000-4000-8000-000000000021'
        )
          and (
            ii.quantity <> 1
            or ii.unit_cost <> 0
            or ii.currency is not null
            or ii.format is not null
            or ii.invoice_scan_id is not null
            or ii.added_via <> 'bottle_scan'::public.added_via
            or ii.bin_id is null
            or ii.bin_location is null
            or ii.section is null
          )
     ) then
    raise exception 'C06_0161_EFFECT_OR_CONSERVATION_FAILED';
  end if;
end;
$c06_0161_zero_effect_and_exact_rows$;

-- Current lifecycle authorization is rechecked even for completed replay.
update public.memberships
   set status='revoked',revoked_at=pg_catalog.statement_timestamp()
 where id='16100000-0000-4000-8000-000000000042';
set local role authenticated;
select pg_catalog.set_config(
  'request.jwt.claim.sub','16100000-0000-4000-8000-000000000003',true
);
do $c06_0161_revoked_replay$
begin
  begin
    perform public.receive_bottle_at_location_private(
      '16100000-0000-4000-8000-000000000020',
      '16100000-0000-4000-8000-000000000070',
      '16100000-0000-4000-8000-000000000050',
      'Main Cellar',
      '16100000-0000-4000-8000-000000000060'
    );
    raise exception 'C06_0161_EXPECTED_REVOKED_REPLAY_REFUSAL';
  exception when sqlstate '42501' then null;
  end;
end;
$c06_0161_revoked_replay$;
reset role;
update public.memberships set status='active',revoked_at=null
 where id='16100000-0000-4000-8000-000000000042';
update public.workspace_memberships
   set expires_at=pg_catalog.statement_timestamp()
 where id='16100000-0000-4000-8000-000000000032';
set local role authenticated;
select pg_catalog.set_config(
  'request.jwt.claim.sub','16100000-0000-4000-8000-000000000003',true
);
do $c06_0161_expired_parent$
begin
  begin
    perform public.receive_bottle_at_location_private(
      '16100000-0000-4000-8000-000000000020',
      '16100000-0000-4000-8000-000000000094',
      '16100000-0000-4000-8000-000000000050',
      'Expired parent',
      '16100000-0000-4000-8000-000000000060'
    );
    raise exception 'C06_0161_EXPECTED_EXPIRED_PARENT_REFUSAL';
  exception when sqlstate '42501' then null;
  end;
end;
$c06_0161_expired_parent$;

rollback;
\echo C06_0161_BOTTLE_LOCATION_CONTRACT_PASS
