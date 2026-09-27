-- Read-only Phase-C catalog/data postflight.
\set ON_ERROR_STOP on
\pset pager off

do $postflight$
begin
  if public.current_inventory_contract_version() <> 2 then
    raise exception 'C06_0156_VERSION_NOT_TWO';
  end if;
  if exists (
    select 1 from pg_catalog.pg_constraint c
     where c.conrelid = 'public.open_bottles'::regclass
       and c.conname = 'open_bottles_wine_id_restaurant_id_key'
  )
     or not exists (
       select 1 from pg_catalog.pg_constraint c
        where c.conrelid = 'public.open_bottles'::regclass
          and c.conname = 'open_bottles_source_inventory_item_tenant_wine_fkey'
          and c.contype = 'f'
          and c.confdeltype = 'r'
          and c.condeferrable
          and c.convalidated
     )
     or to_regclass('public.open_bottles_restaurant_wine_opened_idx') is null
     or to_regclass('public.open_bottles_active_restaurant_wine_idx') is null then
    raise exception 'C06_0156_CATALOG_MISMATCH';
  end if;
  if exists (
    select 1 from public.open_bottles ob
     where ob.closed_at is null
       and (
         ob.identity_contract <> 2
         or ob.identity_origin <> 'migrated_active'
         or ob.nominal_capacity_ml is null
         or ob.remaining_ml <= 0
         or ob.remaining_ml > ob.nominal_capacity_ml
         or ob.state_version <> 0
       )
  ) then
    raise exception 'C06_0156_PROMOTION_MISMATCH';
  end if;
  if exists (
    select 1 from pg_catalog.pg_trigger t
     where t.tgrelid = 'public.pour_events'::regclass
       and t.tgname = 'pour_events_delete_trigger'
       and not t.tgisinternal
  ) then
    raise exception 'C06_0156_DELETE_REVERSAL_STILL_ACTIVE';
  end if;
  if not exists (
    select 1 from pg_catalog.pg_trigger t
     where t.tgrelid = 'public.pour_events'::regclass
       and t.tgname = 'pour_events_trigger'
       and not t.tgisinternal
       and pg_catalog.pg_get_triggerdef(t.oid, false)
           like 'CREATE TRIGGER pour_events_trigger BEFORE INSERT ON public.pour_events%'
  ) then
    raise exception 'C06_0156_EVENT_SERIALIZATION_TRIGGER_MISMATCH';
  end if;
  if not has_function_privilege(
       'authenticated',
       'public.execute_physical_bottle_command(uuid,uuid,text,uuid,uuid,uuid,integer,text,text,integer,integer,uuid,uuid,text,boolean)',
       'EXECUTE'
     )
     or not has_function_privilege(
       'authenticated',
       'public.execute_physical_reconciliation_batch(uuid,uuid,jsonb)',
       'EXECUTE'
     )
     or to_regprocedure(
       'public.execute_physical_reconciliation_batch_phase_a_0156(uuid,uuid,jsonb)'
     ) is null
     or has_function_privilege(
       'authenticated',
       'public.execute_physical_reconciliation_batch_phase_a_0156(uuid,uuid,jsonb)',
       'EXECUTE'
     )
     or has_function_privilege(
       'service_role',
       'public.execute_physical_reconciliation_batch_phase_a_0156(uuid,uuid,jsonb)',
       'EXECUTE'
     )
     or has_function_privilege('authenticated', 'public.record_pour(uuid,integer,text,text)', 'EXECUTE')
     or has_function_privilege('service_role', 'public.record_pour(uuid,integer,text,text)', 'EXECUTE')
     or exists (
       select 1
         from unnest(array[
           'public.open_bottles',
           'public.pour_events',
           'public.bottle_closeouts',
           'public.inventory_command_receipts',
           'public.inventory_command_bottle_effects'
         ]) as protected_table(table_name)
         cross join unnest(array['anon', 'authenticated', 'service_role']) as protected_role(role_name)
        where has_table_privilege(
          protected_role.role_name,
          protected_table.table_name,
          'INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER'
        )
     ) then
    raise exception 'C06_0156_ACL_MISMATCH';
  end if;
  if exists (
    select 1 from pg_catalog.pg_policy p
     where p.polrelid = 'public.bottle_closeouts'::regclass
       and p.polcmd = 'a'
  ) then
    raise exception 'C06_0156_CLOSEOUT_INSERT_POLICY_PRESENT';
  end if;
end;
$postflight$;

select
  'C06_0156_POSTFLIGHT' as evidence,
  current_database(),
  public.current_inventory_contract_version() as contract_version,
  count(*) filter (where closed_at is null) as active_bottles,
  count(*) filter (where identity_origin = 'native') as native_bottles
from public.open_bottles;

\echo C06_0156_PRODUCTION_POSTFLIGHT_PASS
