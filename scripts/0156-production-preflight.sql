-- Read-only Phase-C admission probe. Run with the exact migration executor in
-- the maintenance window. The migration repeats every mutable check under the
-- same NOWAIT locks.
\set ON_ERROR_STOP on
\pset pager off

select
  'C06_0156_EXECUTOR' as evidence,
  current_database(), current_user, session_user,
  r.rolsuper, r.rolbypassrls
from pg_catalog.pg_roles r
where r.rolname = current_user;

select
  'C06_0156_BASELINE' as evidence,
  public.current_inventory_contract_version() as contract_version,
  (select count(*) from public.open_bottles where closed_at is null) as active_slots,
  (select count(*) from public.inventory_command_bottle_effects) as effect_rows,
  (select count(*) from public.inventory_command_receipts where command_version = 2) as version_2_receipts,
  (select count(*) from public.pour_events where event_contract = 2) as version_2_events,
  (select count(*) from public.bottle_closeouts where event_contract = 2) as version_2_closeouts;

begin;
lock table public.inventory_items in access exclusive mode nowait;
lock table public.open_bottles in access exclusive mode nowait;
lock table public.pour_events in access exclusive mode nowait;
lock table public.bottle_closeouts in access exclusive mode nowait;
lock table public.inventory_command_receipts in access exclusive mode nowait;
lock table public.inventory_command_bottle_effects in access exclusive mode nowait;

do $locked_checks$
begin
  if public.current_inventory_contract_version() <> 1 then
    raise exception 'C06_0156_REQUIRES_CONTRACT_VERSION_1' using errcode = 'P0001';
  end if;
  if to_regclass('public.inventory_command_bottle_effects') is null
     or to_regprocedure('public.execute_physical_bottle_command(uuid,uuid,text,uuid,uuid,uuid,integer,text,text,integer,integer,uuid,uuid,text,boolean)') is null
     or to_regprocedure('public.execute_physical_reconciliation_batch(uuid,uuid,jsonb)') is null
     or to_regprocedure('public.execute_physical_reconciliation_batch_phase_a_0156(uuid,uuid,jsonb)') is not null then
    raise exception 'C06_0156_PHASE_A_INCOMPLETE' using errcode = 'P0001';
  end if;
  if not exists (
    select 1 from pg_catalog.pg_constraint c
     where c.conrelid = 'public.open_bottles'::regclass
       and c.conname = 'open_bottles_wine_id_restaurant_id_key'
       and c.contype = 'u'
  ) then
    raise exception 'C06_0156_LEGACY_UNIQUENESS_MISSING' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.inventory_command_bottle_effects)
     or exists (select 1 from public.inventory_command_receipts where command_version = 2)
     or exists (select 1 from public.pour_events where event_contract = 2)
     or exists (select 1 from public.bottle_closeouts where event_contract = 2)
     or exists (select 1 from public.open_bottles where identity_contract <> 1) then
    raise exception 'C06_0156_DORMANT_PHASE_A_STATE_MISMATCH' using errcode = 'P0001';
  end if;
  if exists (
    select 1
      from public.open_bottles ob
      left join public.wines w
        on w.id = ob.wine_id and w.restaurant_id = ob.restaurant_id
      left join public.inventory_items ii on ii.id = ob.source_inventory_item_id
     where ob.closed_at is null
       and (
         w.id is null or w.size_ml is null or w.size_ml <= 0
         or ob.remaining_ml <= 0 or ob.remaining_ml > w.size_ml
         or (ob.source_inventory_item_id is not null and (
           ii.id is null
           or ii.restaurant_id is distinct from ob.restaurant_id
           or ii.wine_id is distinct from ob.wine_id
         ))
       )
  ) then
    raise exception 'C06_0156_ACTIVE_SLOT_PREFLIGHT_FAILED' using errcode = 'P0001';
  end if;
end;
$locked_checks$;
rollback;

\echo C06_0156_PRODUCTION_PREFLIGHT_PASS
