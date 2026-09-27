-- Guarded Phase-C rollback. This is safe only before any native/exact-bottle
-- evidence exists. It restores the dormant Phase-A contract; it never merges,
-- deletes, rewrites, or relabels physical history.

do $static_admission$
begin
  if public.current_inventory_contract_version() <> 2 then
    raise exception 'C06_0156_DOWN_REQUIRES_CONTRACT_VERSION_2' using errcode = 'P0001';
  end if;
  if to_regprocedure('public.execute_inventory_command_pre_0156(uuid,uuid,text,uuid,integer,text,text,uuid,timestamp with time zone,integer,integer,uuid)') is null
     or to_regprocedure('public.execute_physical_bottle_command_phase_a_0156(uuid,uuid,text,uuid,uuid,uuid,integer,text,text,integer,integer,uuid,uuid,text,boolean)') is null
     or to_regprocedure('public.execute_physical_reconciliation_batch_phase_a_0156(uuid,uuid,jsonb)') is null
     or to_regprocedure('public.pour_events_maintain_open_bottle_pre_0156()') is null
     or to_regprocedure('public.open_bottles_enforce_capacity_pre_0156()') is null
     or to_regprocedure('public.auto_eightysix_on_low_inventory_pre_0156()') is null
     or to_regprocedure('public.import_batch_rows_reflect_inventory_delete_pre_0156()') is null
     or to_regprocedure('public.revert_import_batch_pre_0156(uuid)') is null
     or to_regprocedure('public.revert_import_session_pre_0156(uuid)') is null
     or to_regprocedure('public.delete_invoice_scan_pre_0156(uuid)') is null
     or to_regprocedure('public.merge_wines_pre_0156(uuid,uuid)') is null
     or to_regprocedure('public.list_open_bottle_items_pre_0156(uuid)') is null then
    raise exception 'C06_0156_DOWN_ROLLBACK_DEFINITIONS_MISSING' using errcode = 'P0001';
  end if;
end;
$static_admission$;

lock table public.inventory_items in access exclusive mode nowait;
lock table public.open_bottles in access exclusive mode nowait;
lock table public.pour_events in access exclusive mode nowait;
lock table public.bottle_closeouts in access exclusive mode nowait;
lock table public.inventory_command_receipts in access exclusive mode nowait;
lock table public.inventory_command_bottle_effects in access exclusive mode nowait;

do $refuse_before_mutation$
begin
  if exists (select 1 from public.inventory_command_bottle_effects)
     or exists (select 1 from public.inventory_command_receipts where command_version = 2)
     or exists (
       select 1 from public.pour_events
        where event_contract = 2 or reversal_of_event_id is not null
     )
     or exists (select 1 from public.bottle_closeouts where event_contract = 2)
     or exists (
       select 1 from public.open_bottles
        where identity_origin = 'native'
           or opening_operation_id is not null
     )
     or exists (
       select 1
         from public.open_bottles
        group by restaurant_id, wine_id
       having count(*) > 1
     )
     or exists (
       select 1
         from public.open_bottles ob
         left join public.wines w
           on w.id = ob.wine_id
          and w.restaurant_id = ob.restaurant_id
        where (
          ob.identity_contract = 2
          and (
            ob.identity_origin <> 'migrated_active'
            or ob.closed_at is not null
            or ob.remaining_ml <= 0
            or w.id is null
            or w.size_ml is null
            or w.size_ml <= 0
            or ob.remaining_ml > w.size_ml
          )
        )
        or (
          ob.identity_contract = 1
          and ob.identity_origin <> 'legacy_slot'
        )
     ) then
    raise exception 'unsafe_down_physical_bottle_data_present' using errcode = 'P0001';
  end if;
end;
$refuse_before_mutation$;

drop trigger pour_events_trigger on public.pour_events;
drop trigger pour_events_trigger_auto_eightysix on public.pour_events;
drop trigger open_bottles_enforce_capacity_trigger on public.open_bottles;
drop trigger inventory_items_reflect_import_delete on public.inventory_items;

drop function public.execute_inventory_command(
  uuid, uuid, text, uuid, int, text, text, uuid, timestamptz, int, int, uuid
);
drop function public.execute_physical_bottle_command(
  uuid, uuid, text, uuid, uuid, uuid, int, text, text, int, int, uuid, uuid, text, boolean
);
drop function public.execute_physical_reconciliation_batch(uuid, uuid, jsonb);
drop function public.pour_events_maintain_open_bottle();
drop function public.open_bottles_enforce_capacity();
drop function public.auto_eightysix_on_low_inventory();
drop function public.import_batch_rows_reflect_inventory_delete();
drop function public.revert_import_batch(uuid);
drop function public.revert_import_session(uuid);
drop function public.delete_invoice_scan(uuid);
drop function public.merge_wines(uuid, uuid);
drop function public.list_open_bottle_items(uuid);

alter function public.execute_inventory_command_pre_0156(
  uuid, uuid, text, uuid, int, text, text, uuid, timestamptz, int, int, uuid
) rename to execute_inventory_command;
alter function public.execute_physical_bottle_command_phase_a_0156(
  uuid, uuid, text, uuid, uuid, uuid, int, text, text, int, int, uuid, uuid, text, boolean
) rename to execute_physical_bottle_command;
alter function public.execute_physical_reconciliation_batch_phase_a_0156(uuid, uuid, jsonb)
  rename to execute_physical_reconciliation_batch;
alter function public.pour_events_maintain_open_bottle_pre_0156()
  rename to pour_events_maintain_open_bottle;
alter function public.open_bottles_enforce_capacity_pre_0156()
  rename to open_bottles_enforce_capacity;
alter function public.auto_eightysix_on_low_inventory_pre_0156()
  rename to auto_eightysix_on_low_inventory;
alter function public.import_batch_rows_reflect_inventory_delete_pre_0156()
  rename to import_batch_rows_reflect_inventory_delete;
alter function public.revert_import_batch_pre_0156(uuid)
  rename to revert_import_batch;
alter function public.revert_import_session_pre_0156(uuid)
  rename to revert_import_session;
alter function public.delete_invoice_scan_pre_0156(uuid)
  rename to delete_invoice_scan;
alter function public.merge_wines_pre_0156(uuid, uuid)
  rename to merge_wines;
alter function public.list_open_bottle_items_pre_0156(uuid)
  rename to list_open_bottle_items;

update public.open_bottles
   set identity_contract = 1,
       identity_origin = 'legacy_slot',
       nominal_capacity_ml = null,
       source_provenance = 'legacy_unknown',
       opening_operation_id = null,
       state_version = 0
 where identity_contract = 2
   and identity_origin = 'migrated_active';

alter table public.open_bottles
  drop constraint open_bottles_source_inventory_item_tenant_wine_fkey,
  add constraint open_bottles_source_inventory_item_id_fkey
    foreign key (source_inventory_item_id)
    references public.inventory_items (id)
    on delete set null,
  add constraint open_bottles_wine_id_restaurant_id_key
    unique (wine_id, restaurant_id);

drop index public.open_bottles_active_restaurant_wine_idx;
drop index public.open_bottles_restaurant_wine_opened_idx;

-- Restore Phase A's intentionally not-valid state for contract-2-only checks.
alter table public.open_bottles
  drop constraint open_bottles_physical_shape_check,
  add constraint open_bottles_physical_shape_check check (
    identity_contract = 1
    or (
      nominal_capacity_ml is not null
      and identity_origin in ('migrated_active', 'native')
      and (
        identity_origin <> 'native'
        or (
          source_provenance = 'known'
          and source_inventory_item_id is not null
          and opening_operation_id is not null
        )
      )
    )
  ) not valid;

alter table public.pour_events
  drop constraint pour_events_physical_shape_check,
  add constraint pour_events_physical_shape_check check (
    (
      event_contract = 1
      and kind <> 'undo'
      and operation_id is null
      and operation_entry_ordinal is null
      and reversal_of_event_id is null
    )
    or (
      event_contract = 2
      and open_bottle_id is not null
      and operation_id is not null
      and operation_entry_ordinal is not null
      and ((kind = 'undo') = (reversal_of_event_id is not null))
    )
  ) not valid;

alter table public.bottle_closeouts
  drop constraint bottle_closeouts_physical_shape_check,
  add constraint bottle_closeouts_physical_shape_check check (
    event_contract = 1 or open_bottle_id is not null
  ) not valid;

do $restore_phase_a_constraint_seals$
declare
  v_constraint record;
begin
  for v_constraint in
    select c.conrelid::regclass as relation_identity, c.conname, c.oid
      from pg_catalog.pg_constraint c
     where (c.conrelid, c.conname) in (
       ('public.open_bottles'::regclass, 'open_bottles_physical_shape_check'),
       ('public.pour_events'::regclass, 'pour_events_physical_shape_check'),
       ('public.bottle_closeouts'::regclass, 'bottle_closeouts_physical_shape_check')
     )
  loop
    execute format(
      'comment on constraint %I on %s is %L',
      v_constraint.conname,
      v_constraint.relation_identity,
      'C06_DEFINITION_MD5:' || md5(pg_catalog.pg_get_constraintdef(v_constraint.oid, false))
    );
  end loop;
end;
$restore_phase_a_constraint_seals$;

create trigger open_bottles_enforce_capacity_trigger
  before insert or update on public.open_bottles
  for each row execute function public.open_bottles_enforce_capacity();
create trigger pour_events_trigger
  after insert on public.pour_events
  for each row execute function public.pour_events_maintain_open_bottle();
create trigger pour_events_trigger_auto_eightysix
  after insert on public.pour_events
  for each row execute function public.auto_eightysix_on_low_inventory();
create trigger pour_events_delete_trigger
  after delete on public.pour_events
  for each row execute function public.pour_events_reverse_open_bottle();
create trigger inventory_items_reflect_import_delete
  before delete on public.inventory_items
  for each row execute function public.import_batch_rows_reflect_inventory_delete();

create policy "members can insert bottle_closeouts"
  on public.bottle_closeouts for insert
  with check (
    restaurant_id in (select public.member_restaurant_ids())
    and exists (
      select 1 from public.wines w
       where w.id = bottle_closeouts.wine_id
         and w.restaurant_id = bottle_closeouts.restaurant_id
    )
    and (
      open_bottle_id is null
      or exists (
        select 1 from public.open_bottles ob
         where ob.id = bottle_closeouts.open_bottle_id
           and ob.restaurant_id = bottle_closeouts.restaurant_id
      )
    )
  );

grant insert, update, delete on table public.open_bottles
  to authenticated, service_role;
grant truncate, references, trigger on table public.open_bottles
  to anon;
grant truncate, references, trigger on table public.open_bottles
  to authenticated, service_role;
grant insert, update, delete on table public.pour_events
  to authenticated, service_role;
grant truncate, references, trigger on table public.pour_events
  to anon;
grant truncate, references, trigger on table public.pour_events
  to authenticated, service_role;
grant insert, update, delete on table public.bottle_closeouts
  to authenticated, service_role;
grant truncate, references, trigger on table public.bottle_closeouts
  to anon;
grant truncate, references, trigger on table public.bottle_closeouts
  to authenticated, service_role;
grant insert, update, delete on table public.inventory_command_receipts
  to service_role;
grant truncate, references, trigger on table public.inventory_command_receipts
  to service_role;

grant execute on function public.record_pour(uuid, int, text, text) to public, authenticated;
grant execute on function public.reconcile_open_bottle(uuid, int, text) to public, authenticated;
grant execute on function public.reconcile_open_bottles_batch(jsonb) to public, authenticated;
grant execute on function public.undo_last_pour(uuid) to public, authenticated;
grant execute on function public.pour_events_maintain_open_bottle() to public;
grant execute on function public.open_bottles_enforce_capacity() to public;
grant execute on function public.auto_eightysix_on_low_inventory() to public;
grant execute on function public.import_batch_rows_reflect_inventory_delete() to public;
revoke execute on function public.close_open_bottle(uuid, int, int, uuid) from public, anon;
grant execute on function public.close_open_bottle(uuid, int, int, uuid) to authenticated;

revoke all on function public.execute_inventory_command(
  uuid, uuid, text, uuid, int, text, text, uuid, timestamptz, int, int, uuid
) from public, anon, service_role;
grant execute on function public.execute_inventory_command(
  uuid, uuid, text, uuid, int, text, text, uuid, timestamptz, int, int, uuid
) to authenticated;

revoke all on function public.execute_physical_bottle_command(
  uuid, uuid, text, uuid, uuid, uuid, int, text, text, int, int, uuid, uuid, text, boolean
) from public, anon, authenticated, service_role;
revoke all on function public.execute_physical_reconciliation_batch(uuid, uuid, jsonb)
  from public, anon, authenticated, service_role;

revoke all on function public.revert_import_batch(uuid) from public, anon;
grant execute on function public.revert_import_batch(uuid) to authenticated;
revoke all on function public.revert_import_session(uuid) from public, anon;
grant execute on function public.revert_import_session(uuid) to authenticated;
revoke all on function public.delete_invoice_scan(uuid) from public, anon;
grant execute on function public.delete_invoice_scan(uuid) to authenticated;
grant execute on function public.merge_wines(uuid, uuid) to public;
grant execute on function public.list_open_bottle_items(uuid) to public, authenticated;

comment on function public.pour_events_reverse_open_bottle() is null;

-- Keep this final so the restored version-1 signal becomes visible only with
-- every legacy body, trigger, grant, policy, and uniqueness invariant.
create or replace function public.current_inventory_contract_version()
returns smallint
language sql
stable
security invoker
set search_path = ''
as $$ select 1::smallint $$;
