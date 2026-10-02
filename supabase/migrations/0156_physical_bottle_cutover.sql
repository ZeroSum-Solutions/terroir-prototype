-- 0156_physical_bottle_cutover.sql
--
-- Phase C for the accepted physical-bottle contract. This migration is an
-- atomic maintenance-window cutover: it promotes valid active legacy slots,
-- removes one-slot-per-wine semantics, activates exact-bottle writers, retires
-- every legacy writer, protects source provenance, and flips the normative
-- contract version only in the final statement.

do $static_admission$
begin
  if public.current_inventory_contract_version() <> 1 then
    raise exception 'C06_0156_REQUIRES_CONTRACT_VERSION_1' using errcode = 'P0001';
  end if;

  if to_regclass('public.inventory_command_bottle_effects') is null
     or to_regclass('public.effective_service_pour_events') is null
     or to_regprocedure('public.execute_physical_bottle_command(uuid,uuid,text,uuid,uuid,uuid,integer,text,text,integer,integer,uuid,uuid,text,boolean)') is null
     or to_regprocedure('public.execute_physical_reconciliation_batch(uuid,uuid,jsonb)') is null
     or to_regprocedure('public.list_active_physical_bottles(uuid)') is null
     or to_regprocedure('public.list_open_bottle_aggregates(uuid)') is null then
    raise exception 'C06_0156_PHASE_A_INCOMPLETE' using errcode = 'P0001';
  end if;

  if to_regprocedure('public.execute_inventory_command_pre_0156(uuid,uuid,text,uuid,integer,text,text,uuid,timestamp with time zone,integer,integer,uuid)') is not null
     or to_regprocedure('public.execute_physical_bottle_command_phase_a_0156(uuid,uuid,text,uuid,uuid,uuid,integer,text,text,integer,integer,uuid,uuid,text,boolean)') is not null
     or to_regprocedure('public.execute_physical_reconciliation_batch_phase_a_0156(uuid,uuid,jsonb)') is not null
     or to_regprocedure('public.pour_events_maintain_open_bottle_pre_0156()') is not null
     or to_regclass('public.open_bottles_restaurant_wine_opened_idx') is not null
     or to_regclass('public.open_bottles_active_restaurant_wine_idx') is not null then
    raise exception 'C06_0156_ALREADY_OR_PARTIALLY_APPLIED' using errcode = 'P0001';
  end if;

  if not exists (
    select 1
      from pg_catalog.pg_constraint c
     where c.conrelid = 'public.open_bottles'::regclass
       and c.conname = 'open_bottles_wine_id_restaurant_id_key'
       and c.contype = 'u'
  ) or not exists (
    select 1
      from pg_catalog.pg_constraint c
     where c.conrelid = 'public.open_bottles'::regclass
       and c.conname = 'open_bottles_source_inventory_item_id_fkey'
       and c.contype = 'f'
       and c.confdeltype = 'n'
  ) then
    raise exception 'C06_0156_LEGACY_CONTRACT_MISMATCH' using errcode = 'P0001';
  end if;
end;
$static_admission$;

-- This order matches the Phase A rehearsal and blocks every legacy inventory
-- writer before mutable admission is repeated.
lock table public.inventory_items in access exclusive mode nowait;
lock table public.open_bottles in access exclusive mode nowait;
lock table public.pour_events in access exclusive mode nowait;
lock table public.bottle_closeouts in access exclusive mode nowait;
lock table public.inventory_command_receipts in access exclusive mode nowait;
lock table public.inventory_command_bottle_effects in access exclusive mode nowait;

do $locked_preflight$
begin
  if public.current_inventory_contract_version() <> 1 then
    raise exception 'C06_0156_REQUIRES_CONTRACT_VERSION_1' using errcode = 'P0001';
  end if;

  if exists (select 1 from public.inventory_command_bottle_effects)
     or exists (
       select 1 from public.inventory_command_receipts
        where command_version = 2
           or scope_kind <> 'single_wine'
           or batch_entry_count is not null
     )
     or exists (
       select 1 from public.pour_events
        where event_contract = 2
           or operation_id is not null
           or operation_entry_ordinal is not null
           or reversal_of_event_id is not null
     )
     or exists (select 1 from public.bottle_closeouts where event_contract = 2)
     or exists (
       select 1 from public.open_bottles
        where identity_contract <> 1
           or identity_origin <> 'legacy_slot'
           or nominal_capacity_ml is not null
           or source_provenance <> 'legacy_unknown'
           or opening_operation_id is not null
           or state_version <> 0
     ) then
    raise exception 'C06_0156_DORMANT_PHASE_A_STATE_MISMATCH' using errcode = 'P0001';
  end if;

  if exists (
    select 1
      from public.open_bottles ob
      left join public.wines w
        on w.id = ob.wine_id
       and w.restaurant_id = ob.restaurant_id
      left join public.inventory_items ii
        on ii.id = ob.source_inventory_item_id
     where ob.closed_at is null
       and (
         w.id is null
         or w.size_ml is null
         or w.size_ml <= 0
         or ob.remaining_ml <= 0
         or ob.remaining_ml > w.size_ml
         or (
           ob.source_inventory_item_id is not null
           and (
             ii.id is null
             or ii.restaurant_id is distinct from ob.restaurant_id
             or ii.wine_id is distinct from ob.wine_id
           )
         )
       )
  ) then
    raise exception 'C06_0156_ACTIVE_SLOT_PREFLIGHT_FAILED' using errcode = 'P0001';
  end if;
end;
$locked_preflight$;

-- Preserve the exact Phase A / legacy definitions as revoked database-local
-- rollback helpers. They are never granted or called while contract 2 is live.
alter function public.execute_inventory_command(
  uuid, uuid, text, uuid, int, text, text, uuid, timestamptz, int, int, uuid
) rename to execute_inventory_command_pre_0156;
revoke all on function public.execute_inventory_command_pre_0156(
  uuid, uuid, text, uuid, int, text, text, uuid, timestamptz, int, int, uuid
) from public, anon, authenticated, service_role;

alter function public.execute_physical_bottle_command(
  uuid, uuid, text, uuid, uuid, uuid, int, text, text, int, int, uuid, uuid, text, boolean
) rename to execute_physical_bottle_command_phase_a_0156;
revoke all on function public.execute_physical_bottle_command_phase_a_0156(
  uuid, uuid, text, uuid, uuid, uuid, int, text, text, int, int, uuid, uuid, text, boolean
) from public, anon, authenticated, service_role;

alter function public.execute_physical_reconciliation_batch(uuid, uuid, jsonb)
  rename to execute_physical_reconciliation_batch_phase_a_0156;
revoke all on function public.execute_physical_reconciliation_batch_phase_a_0156(uuid, uuid, jsonb)
  from public, anon, authenticated, service_role;

alter function public.pour_events_maintain_open_bottle()
  rename to pour_events_maintain_open_bottle_pre_0156;
alter function public.open_bottles_enforce_capacity()
  rename to open_bottles_enforce_capacity_pre_0156;
alter function public.auto_eightysix_on_low_inventory()
  rename to auto_eightysix_on_low_inventory_pre_0156;
alter function public.import_batch_rows_reflect_inventory_delete()
  rename to import_batch_rows_reflect_inventory_delete_pre_0156;
alter function public.revert_import_batch(uuid)
  rename to revert_import_batch_pre_0156;
alter function public.revert_import_session(uuid)
  rename to revert_import_session_pre_0156;
alter function public.delete_invoice_scan(uuid)
  rename to delete_invoice_scan_pre_0156;
alter function public.merge_wines(uuid, uuid)
  rename to merge_wines_pre_0156;
alter function public.list_open_bottle_items(uuid)
  rename to list_open_bottle_items_pre_0156;

revoke all on function public.pour_events_maintain_open_bottle_pre_0156()
  from public, anon, authenticated, service_role;
revoke all on function public.open_bottles_enforce_capacity_pre_0156()
  from public, anon, authenticated, service_role;
revoke all on function public.auto_eightysix_on_low_inventory_pre_0156()
  from public, anon, authenticated, service_role;
revoke all on function public.import_batch_rows_reflect_inventory_delete_pre_0156()
  from public, anon, authenticated, service_role;
revoke all on function public.revert_import_batch_pre_0156(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.revert_import_session_pre_0156(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.delete_invoice_scan_pre_0156(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.merge_wines_pre_0156(uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.list_open_bottle_items_pre_0156(uuid)
  from public, anon, authenticated, service_role;

drop trigger pour_events_trigger on public.pour_events;
drop trigger pour_events_trigger_auto_eightysix on public.pour_events;
drop trigger pour_events_delete_trigger on public.pour_events;
drop trigger open_bottles_enforce_capacity_trigger on public.open_bottles;
drop trigger inventory_items_reflect_import_delete on public.inventory_items;

-- Promote only active legacy slots. Closed rows remain explicitly contract-1
-- history, because their slot IDs may span multiple physical lifecycles.
update public.open_bottles ob
   set identity_contract = 2,
       identity_origin = 'migrated_active',
       nominal_capacity_ml = w.size_ml,
       source_provenance = case
         when ob.source_inventory_item_id is null then 'legacy_unknown'
         else 'known'
       end,
       state_version = 0
  from public.wines w
 where ob.closed_at is null
   and w.id = ob.wine_id
   and w.restaurant_id = ob.restaurant_id;

alter table public.open_bottles
  drop constraint open_bottles_source_inventory_item_id_fkey,
  add constraint open_bottles_source_inventory_item_tenant_wine_fkey
    foreign key (source_inventory_item_id, restaurant_id, wine_id)
    references public.inventory_items (id, restaurant_id, wine_id)
    on delete restrict
    deferrable initially deferred
    not valid;

alter table public.open_bottles
  validate constraint open_bottles_source_inventory_item_tenant_wine_fkey,
  validate constraint open_bottles_physical_shape_check;
alter table public.pour_events
  validate constraint pour_events_physical_shape_check;
alter table public.bottle_closeouts
  validate constraint bottle_closeouts_physical_shape_check;

alter table public.open_bottles
  drop constraint open_bottles_wine_id_restaurant_id_key;

create index open_bottles_restaurant_wine_opened_idx
  on public.open_bottles (restaurant_id, wine_id, opened_at desc);
create index open_bottles_active_restaurant_wine_idx
  on public.open_bottles (restaurant_id, wine_id, opened_at desc)
  where closed_at is null;

create function public.open_bottles_enforce_capacity()
returns trigger
language plpgsql
set search_path = ''
as $function$
declare
  v_size_ml int;
begin
  if new.identity_contract = 2 then
    if new.nominal_capacity_ml is null
       or new.nominal_capacity_ml <= 0
       or new.remaining_ml > new.nominal_capacity_ml then
      raise exception 'physical_bottle_capacity_exceeded' using errcode = 'P0003';
    end if;
  else
    select w.size_ml into v_size_ml
      from public.wines w
     where w.id = new.wine_id;
    if v_size_ml is not null and new.remaining_ml > v_size_ml then
      raise exception 'open_bottles.remaining_ml (%) would exceed wine % size_ml (%)',
        new.remaining_ml, new.wine_id, v_size_ml using errcode = 'P0003';
    end if;
  end if;
  return new;
end;
$function$;

create function public.import_batch_rows_reflect_inventory_delete()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  if exists (
    select 1
      from public.open_bottles ob
     where ob.source_inventory_item_id = old.id
  ) then
    raise exception 'physical_bottle_dependency' using errcode = 'P0001';
  end if;

  update public.import_batch_rows
     set apply_status = 'reverted',
         applied_inventory_item_id = null,
         updated_at = now()
   where applied_inventory_item_id = old.id
     and apply_status = 'applied';
  return old;
end;
$function$;

create trigger inventory_items_reflect_import_delete
  before delete on public.inventory_items
  for each row execute function public.import_batch_rows_reflect_inventory_delete();

create function public.revert_import_batch(p_batch_id uuid)
returns integer
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_restaurant_id uuid;
  v_status text;
  v_row record;
  v_count integer := 0;
begin
  select b.restaurant_id, b.status
    into v_restaurant_id, v_status
    from public.import_batches b
   where b.id = p_batch_id
   for update;
  if not found then
    raise exception 'import batch % not found', p_batch_id using errcode = 'P0002';
  end if;
  if v_status = 'reverted' then
    raise exception 'import batch % is already reverted', p_batch_id using errcode = 'P0001';
  end if;

  if exists (
    select 1
      from public.import_batch_rows row_to_revert
      join public.open_bottles ob
        on ob.source_inventory_item_id = row_to_revert.applied_inventory_item_id
     where row_to_revert.batch_id = p_batch_id
       and row_to_revert.apply_status = 'applied'
  ) then
    raise exception 'physical_bottle_dependency' using errcode = 'P0001';
  end if;

  for v_row in
    select r.id, r.applied_inventory_item_id
      from public.import_batch_rows r
     where r.batch_id = p_batch_id
       and r.apply_status = 'applied'
     order by r.id
     for update
  loop
    update public.import_batch_rows
       set apply_status = 'reverted',
           applied_inventory_item_id = null,
           updated_at = now()
     where id = v_row.id;
    delete from public.inventory_items
     where id = v_row.applied_inventory_item_id
       and restaurant_id = v_restaurant_id;
    v_count := v_count + 1;
  end loop;

  update public.import_batches
     set status = 'reverted',
         reverted_at = now(),
         reverted_by = auth.uid()
   where id = p_batch_id;
  return v_count;
end;
$function$;

revoke all on function public.revert_import_batch(uuid) from public, anon;
grant execute on function public.revert_import_batch(uuid) to authenticated;

create function public.revert_import_session(p_session_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_batch record;
  v_results jsonb := '[]'::jsonb;
  v_reverted_count integer;
  v_session_exists boolean := false;
  v_blocked boolean := false;
  v_reason text;
begin
  select true into v_session_exists
    from public.import_sessions s
   where s.id = p_session_id;
  if not v_session_exists then
    raise exception 'import session % not found', p_session_id using errcode = 'P0002';
  end if;

  for v_batch in
    select b.id, b.status, b.chunk_index
      from public.import_batches b
     where b.session_id = p_session_id
     order by coalesce(b.chunk_index, 0) desc, b.created_at desc
  loop
    if v_batch.status = 'reverted' then
      v_results := v_results || jsonb_build_object(
        'batchId', v_batch.id, 'chunkIndex', v_batch.chunk_index,
        'skipped', true, 'reason', 'already reverted'
      );
      continue;
    end if;

    begin
      select public.revert_import_batch(v_batch.id) into v_reverted_count;
      v_results := v_results || jsonb_build_object(
        'batchId', v_batch.id, 'chunkIndex', v_batch.chunk_index,
        'skipped', false, 'revertedCount', v_reverted_count
      );
    exception when others then
      v_blocked := true;
      v_reason := case
        when sqlstate = 'P0001' and sqlerrm = 'physical_bottle_dependency'
          then 'physical_bottle_dependency'
        else sqlerrm
      end;
      v_results := v_results || jsonb_build_object(
        'batchId', v_batch.id, 'chunkIndex', v_batch.chunk_index,
        'skipped', true, 'reason', v_reason
      );
    end;
  end loop;

  if exists (
    select 1 from public.import_batches b
     where b.session_id = p_session_id
       and b.status <> 'reverted'
  ) then
    v_blocked := true;
  end if;

  update public.import_sessions
     set status = case when v_blocked then 'in_progress' else 'reverted' end,
         updated_at = now()
   where id = p_session_id;

  return jsonb_build_object(
    'sessionId', p_session_id,
    'status', case when v_blocked then 'in_progress' else 'reverted' end,
    'batches', v_results
  );
end;
$function$;

revoke all on function public.revert_import_session(uuid) from public, anon;
grant execute on function public.revert_import_session(uuid) to authenticated;

create function public.delete_invoice_scan(p_scan_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_restaurant_id uuid;
  v_distributor text;
  v_invoice_number text;
  v_status text;
  v_item_count int;
  v_final jsonb;
  v_rows int := 0;
  v_bottles int := 0;
begin
  select s.restaurant_id, s.distributor_name, s.invoice_number, s.status,
         s.item_count, s.final_line_items
    into v_restaurant_id, v_distributor, v_invoice_number, v_status,
         v_item_count, v_final
    from public.invoice_scans s
   where s.id = p_scan_id
   for update;
  if not found then
    raise exception 'invoice scan % not found', p_scan_id using errcode = 'P0002';
  end if;
  if not public.is_member_with_role(v_restaurant_id, 'manager') then
    raise exception 'insufficient privilege to delete invoice scan %', p_scan_id
      using errcode = 'P0003';
  end if;

  if exists (
    select 1
      from public.inventory_items ii
      join public.open_bottles ob on ob.source_inventory_item_id = ii.id
     where ii.invoice_scan_id = p_scan_id
       and ii.restaurant_id = v_restaurant_id
  ) then
    raise exception 'physical_bottle_dependency' using errcode = 'P0001';
  end if;

  select count(*), coalesce(sum(ii.quantity), 0)
    into v_rows, v_bottles
    from public.inventory_items ii
   where ii.invoice_scan_id = p_scan_id
     and ii.restaurant_id = v_restaurant_id;

  delete from public.inventory_items
   where invoice_scan_id = p_scan_id
     and restaurant_id = v_restaurant_id;

  insert into public.invoice_scan_deletions (
    restaurant_id, invoice_scan_id, deleted_by, distributor_name,
    invoice_number, scan_status, item_count, inventory_rows_deleted,
    bottles_removed, final_line_items
  ) values (
    v_restaurant_id, p_scan_id, auth.uid(), v_distributor,
    v_invoice_number, v_status, v_item_count, v_rows,
    v_bottles, coalesce(v_final, '[]'::jsonb)
  );

  delete from public.invoice_scans where id = p_scan_id;
  if not found then
    raise exception 'invoice scan % could not be deleted', p_scan_id
      using errcode = 'P0001';
  end if;

  return jsonb_build_object(
    'scanId', p_scan_id,
    'inventoryRowsDeleted', v_rows,
    'bottlesRemoved', v_bottles
  );
end;
$function$;

revoke all on function public.delete_invoice_scan(uuid) from public, anon;
grant execute on function public.delete_invoice_scan(uuid) to authenticated;

create function public.merge_wines(p_source_wine_id uuid, p_target_wine_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_source public.wines%rowtype;
  v_target public.wines%rowtype;
  v_restaurant_id uuid;
  v_moved_inventory int;
  v_moved_pours int;
  v_moved_bottles int;
  v_moved_list_items int;
  v_deduped_list_items int;
  v_moved_avail int;
  v_moved_bottle_closeouts int;
  v_moved_stock_adjustments int;
  v_moved_pricing_recs int;
  v_moved_cellar_health int;
  v_dropped_cellar_health int;
  v_moved_import_batch_rows int;
  v_moved_receipts int;
  v_moved_bottle_effects int;
begin
  if p_source_wine_id = p_target_wine_id then
    raise exception 'identical_merge: source and target are the same wine';
  end if;

  perform 1
    from public.wines w
   where w.id in (p_source_wine_id, p_target_wine_id)
   order by w.id
   for update;

  select * into v_source from public.wines where id = p_source_wine_id;
  select * into v_target from public.wines where id = p_target_wine_id;
  if v_source.id is null or v_target.id is null
     or v_source.restaurant_id <> v_target.restaurant_id then
    raise exception 'wine_not_found: both wines must exist in the same restaurant';
  end if;

  v_restaurant_id := v_source.restaurant_id;
  if not public.is_member_with_role(v_restaurant_id, 'manager') then
    raise exception 'forbidden: manager role required to merge wines';
  end if;
  if v_source.lineage_id is null or v_target.lineage_id is null
     or v_source.lineage_id <> v_target.lineage_id then
    raise exception 'lineage_mismatch_merge: wines are not the same producer-cuvée — merging is only for true duplicates';
  end if;
  if coalesce(v_source.vintage, 0) <> coalesce(v_target.vintage, 0) then
    raise exception 'cross_vintage_merge: % and % are distinct vintages — they are already linked as vintage siblings, not duplicates',
      coalesce(v_source.vintage::text, 'NV'), coalesce(v_target.vintage::text, 'NV');
  end if;
  if v_source.size_ml <> v_target.size_ml then
    raise exception 'format_mismatch_merge: % ml and % ml are distinct formats',
      v_source.size_ml, v_target.size_ml;
  end if;
  if v_source.wine_variant_id is not null
     and v_target.wine_variant_id is not null
     and v_source.wine_variant_id <> v_target.wine_variant_id then
    raise exception 'variant_identity_conflict: source wine_variant_id % and target wine_variant_id % disagree — run merge_canonical_wines to reconcile the underlying identities first',
      v_source.wine_variant_id, v_target.wine_variant_id;
  end if;

  set constraints
    public.open_bottles_source_inventory_item_tenant_wine_fkey,
    public.pour_events_open_bottle_tenant_wine_fkey,
    public.bottle_closeouts_open_bottle_tenant_wine_fkey,
    public.inventory_command_bottle_effects_bottle_fkey
  deferred;

  if v_target.wine_variant_id is null and v_source.wine_variant_id is not null then
    update public.wines set wine_variant_id = v_source.wine_variant_id
     where id = p_target_wine_id;
  end if;

  update public.inventory_items set wine_id = p_target_wine_id
   where wine_id = p_source_wine_id;
  get diagnostics v_moved_inventory = row_count;

  update public.open_bottles set wine_id = p_target_wine_id
   where wine_id = p_source_wine_id;
  get diagnostics v_moved_bottles = row_count;

  update public.pour_events set wine_id = p_target_wine_id
   where wine_id = p_source_wine_id;
  get diagnostics v_moved_pours = row_count;

  update public.bottle_closeouts set wine_id = p_target_wine_id
   where wine_id = p_source_wine_id;
  get diagnostics v_moved_bottle_closeouts = row_count;

  update public.inventory_command_receipts set wine_id = p_target_wine_id
   where wine_id = p_source_wine_id
     and scope_kind = 'single_wine';
  get diagnostics v_moved_receipts = row_count;

  update public.inventory_command_bottle_effects set wine_id = p_target_wine_id
   where wine_id = p_source_wine_id;
  get diagnostics v_moved_bottle_effects = row_count;

  delete from public.wine_list_items source_item
   where source_item.wine_id = p_source_wine_id
     and exists (
       select 1 from public.wine_list_items target_item
        where target_item.section_id = source_item.section_id
          and target_item.wine_id = p_target_wine_id
     );
  get diagnostics v_deduped_list_items = row_count;

  update public.wine_list_items set wine_id = p_target_wine_id
   where wine_id = p_source_wine_id;
  get diagnostics v_moved_list_items = row_count;

  update public.availability_events set wine_id = p_target_wine_id
   where wine_id = p_source_wine_id;
  get diagnostics v_moved_avail = row_count;

  update public.stock_adjustments set wine_id = p_target_wine_id
   where wine_id = p_source_wine_id;
  get diagnostics v_moved_stock_adjustments = row_count;

  update public.pricing_recommendations set wine_id = p_target_wine_id
   where wine_id = p_source_wine_id;
  get diagnostics v_moved_pricing_recs = row_count;

  delete from public.cellar_health source_health
   where source_health.wine_id = p_source_wine_id
     and exists (
       select 1 from public.cellar_health target_health
        where target_health.wine_id = p_target_wine_id
          and target_health.restaurant_id = source_health.restaurant_id
     );
  get diagnostics v_dropped_cellar_health = row_count;

  update public.cellar_health set wine_id = p_target_wine_id
   where wine_id = p_source_wine_id;
  get diagnostics v_moved_cellar_health = row_count;

  update public.import_batch_rows set applied_wine_id = p_target_wine_id
   where applied_wine_id = p_source_wine_id;
  get diagnostics v_moved_import_batch_rows = row_count;

  insert into public.identity_merge_log (
    merge_type, source_id, target_id, restaurant_id,
    source_snapshot, moved_counts, merged_by
  ) values (
    'wine', p_source_wine_id, p_target_wine_id, v_restaurant_id,
    to_jsonb(v_source),
    jsonb_build_object(
      'moved_inventory_items', v_moved_inventory,
      'moved_pour_events', v_moved_pours,
      'moved_open_bottles', v_moved_bottles,
      'moved_wine_list_items', v_moved_list_items,
      'deduped_wine_list_items', v_deduped_list_items,
      'moved_availability_events', v_moved_avail,
      'moved_bottle_closeouts', v_moved_bottle_closeouts,
      'moved_stock_adjustments', v_moved_stock_adjustments,
      'moved_pricing_recommendations', v_moved_pricing_recs,
      'moved_cellar_health', v_moved_cellar_health,
      'dropped_cellar_health', v_dropped_cellar_health,
      'moved_import_batch_rows', v_moved_import_batch_rows,
      'moved_inventory_command_receipts', v_moved_receipts,
      'moved_inventory_command_bottle_effects', v_moved_bottle_effects
    ),
    auth.uid()
  );

  delete from public.wines where id = p_source_wine_id;

  return jsonb_build_object(
    'target_id', p_target_wine_id,
    'moved_inventory_items', v_moved_inventory,
    'moved_pour_events', v_moved_pours,
    'moved_open_bottles', v_moved_bottles,
    'moved_wine_list_items', v_moved_list_items,
    'deduped_wine_list_items', v_deduped_list_items,
    'moved_availability_events', v_moved_avail,
    'moved_bottle_closeouts', v_moved_bottle_closeouts,
    'moved_stock_adjustments', v_moved_stock_adjustments,
    'moved_pricing_recommendations', v_moved_pricing_recs,
    'moved_cellar_health', v_moved_cellar_health,
    'dropped_cellar_health', v_dropped_cellar_health,
    'moved_import_batch_rows', v_moved_import_batch_rows,
    'moved_inventory_command_receipts', v_moved_receipts,
    'moved_inventory_command_bottle_effects', v_moved_bottle_effects
  );
end;
$function$;

revoke all on function public.merge_wines(uuid, uuid) from public, anon;
grant execute on function public.merge_wines(uuid, uuid) to authenticated;

create function public.execute_inventory_command(
  p_operation_id uuid,
  p_restaurant_id uuid,
  p_command text,
  p_wine_id uuid,
  p_ml int default null,
  p_note text default null,
  p_preservation_method text default null,
  p_expected_open_bottle_id uuid default null,
  p_expected_opened_at timestamptz default null,
  p_actual_remaining_ml int default null,
  p_written_off_ml int default 0,
  p_reason_code_id uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user uuid := auth.uid();
  v_note text := nullif(btrim(p_note), '');
  v_preservation text;
  v_request jsonb;
  v_receipt public.inventory_command_receipts%rowtype;
begin
  if v_user is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_operation_id is null
     or p_restaurant_id is null
     or p_wine_id is null
     or p_command is null
     or p_command not in ('open', 'pour', 'spill', 'discard', 'close')
     or (v_note is not null and char_length(v_note) > 500)
     or (p_preservation_method is not null
         and p_preservation_method not in ('coravin', 'argon', 'vacuum', 'none')) then
    raise exception 'invalid_inventory_command' using errcode = 'P0001';
  end if;

  if p_command = 'open' then
    if p_ml is not null
       or p_expected_open_bottle_id is not null
       or p_expected_opened_at is not null
       or p_actual_remaining_ml is not null
       or p_written_off_ml is null
       or p_written_off_ml <> 0
       or p_reason_code_id is not null then
      raise exception 'invalid_inventory_command' using errcode = 'P0001';
    end if;
    v_preservation := coalesce(p_preservation_method, 'none');
  elsif p_command in ('pour', 'spill') then
    if p_ml is null or p_ml <= 0 or p_ml > 2000
       or p_actual_remaining_ml is not null
       or p_written_off_ml is null
       or p_written_off_ml <> 0
       or p_reason_code_id is not null
       or ((p_expected_open_bottle_id is null) <> (p_expected_opened_at is null)) then
      raise exception 'invalid_inventory_command' using errcode = 'P0001';
    end if;
    v_preservation := p_preservation_method;
  elsif p_command = 'discard' then
    if p_ml is not null
       or p_preservation_method is not null
       or p_expected_open_bottle_id is null
       or p_expected_opened_at is null
       or p_actual_remaining_ml is not null
       or p_written_off_ml is null
       or p_written_off_ml <> 0
       or p_reason_code_id is not null then
      raise exception 'invalid_inventory_command' using errcode = 'P0001';
    end if;
  else
    if p_ml is not null
       or p_preservation_method is not null
       or p_expected_open_bottle_id is null
       or p_expected_opened_at is null
       or p_actual_remaining_ml is null
       or p_actual_remaining_ml < 0
       or p_written_off_ml is null
       or p_written_off_ml < 0
       or p_written_off_ml > p_actual_remaining_ml
       or (p_written_off_ml > 0 and p_reason_code_id is null) then
      raise exception 'invalid_inventory_command' using errcode = 'P0001';
    end if;
  end if;

  perform 1
    from public.memberships m
   where m.user_id = v_user
     and m.restaurant_id = p_restaurant_id
     and m.role in ('owner', 'manager', 'staff')
   for share;
  if not found then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  v_request := jsonb_build_object(
    'version', 1,
    'command', p_command,
    'wine_id', p_wine_id,
    'ml', p_ml,
    'note', v_note,
    'preservation_method', case
      when p_command = 'open' then v_preservation
      else p_preservation_method
    end,
    'expected_open_bottle_id', p_expected_open_bottle_id,
    'expected_opened_at', case
      when p_expected_opened_at is null then null
      else to_char(
        p_expected_opened_at at time zone 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
      )
    end,
    'actual_remaining_ml', p_actual_remaining_ml,
    'written_off_ml', p_written_off_ml,
    'reason_code_id', p_reason_code_id
  );

  select * into v_receipt
    from public.inventory_command_receipts r
   where r.restaurant_id = p_restaurant_id
     and r.operation_id = p_operation_id;

  if not found
     or v_receipt.command_version <> 1
     or v_receipt.result_payload is null
     or v_receipt.completed_at is null then
    raise exception 'legacy_inventory_command_retired' using errcode = 'P0001';
  end if;
  if v_receipt.actor_user_id is distinct from v_user then
    raise exception 'inventory_operation_actor_conflict' using errcode = 'P0001';
  end if;
  if v_receipt.command_type is distinct from p_command
     or v_receipt.request_payload is distinct from v_request then
    raise exception 'inventory_operation_payload_conflict' using errcode = 'P0001';
  end if;

  return v_receipt.result_payload || jsonb_build_object('replayed', true);
end;
$function$;

create function public.auto_eightysix_on_low_inventory()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_enabled boolean;
  v_threshold int;
  v_size_ml int;
  v_already_eightysixed boolean;
  v_open_ml bigint;
  v_sealed_total_ml bigint;
  v_total_ml bigint;
begin
  if new.kind not in ('pour', 'spill', 'finish_bottle', 'reconcile', 'undo') then
    return new;
  end if;

  select r.auto_eightysix_from_inventory, r.eightysix_ml_threshold
    into v_enabled, v_threshold
    from public.restaurants r
   where r.id = new.restaurant_id;
  if not v_enabled then
    return new;
  end if;

  select w.is_eightysixed, w.size_ml
    into v_already_eightysixed, v_size_ml
    from public.wines w
   where w.id = new.wine_id
     and w.restaurant_id = new.restaurant_id;
  if v_already_eightysixed then
    return new;
  end if;

  select coalesce(sum(ob.remaining_ml) filter (where ob.closed_at is null), 0)
    into v_open_ml
    from public.open_bottles ob
   where ob.wine_id = new.wine_id
     and ob.restaurant_id = new.restaurant_id;

  select coalesce(sum(ii.quantity::bigint * v_size_ml::bigint), 0)
    into v_sealed_total_ml
    from public.inventory_items ii
   where ii.wine_id = new.wine_id
     and ii.restaurant_id = new.restaurant_id;

  v_total_ml := v_open_ml + v_sealed_total_ml;
  if v_total_ml < v_threshold then
    update public.wines
       set is_eightysixed = true,
           eightysixed_at = now(),
           eightysixed_by = null
     where id = new.wine_id
       and restaurant_id = new.restaurant_id
       and is_eightysixed = false;
    if found then
      insert into public.availability_events (
        wine_id, restaurant_id, direction, user_id, note
      ) values (
        new.wine_id, new.restaurant_id, 'eightysixed', null,
        'auto: below threshold'
      );
    end if;
  end if;
  return new;
end;
$function$;

create trigger pour_events_trigger_auto_eightysix
  after insert on public.pour_events
  for each row execute function public.auto_eightysix_on_low_inventory();

create function public.list_open_bottle_items(p_restaurant_id uuid)
returns table (
  wine_list_item_id uuid,
  glass_pour_ml int,
  pour_size_mode text,
  wine_id uuid,
  name text,
  producer text,
  vintage int,
  size_ml int,
  open_remaining_ml bigint,
  active_bottle_count bigint,
  opened_at timestamptz,
  sealed_count bigint
)
language sql
stable
security definer
set search_path = ''
as $function$
  select
    wli.id,
    wli.glass_pour_ml,
    wli.pour_size_mode,
    w.id,
    w.name,
    w.producer,
    w.vintage,
    w.size_ml,
    coalesce(ob.open_remaining_ml, 0),
    coalesce(ob.active_bottle_count, 0),
    ob.opened_at,
    coalesce((
      select sum(ii.quantity)::bigint
        from public.inventory_items ii
       where ii.wine_id = w.id
         and ii.restaurant_id = p_restaurant_id
    ), 0)
  from public.wine_list_items wli
  join public.wine_list_sections s on s.id = wli.section_id
  join public.wine_lists wl on wl.id = s.wine_list_id
  join public.wines w on w.id = wli.wine_id
  left join lateral (
    select
      sum(active.remaining_ml)::bigint as open_remaining_ml,
      count(*)::bigint as active_bottle_count,
      min(active.opened_at) as opened_at
    from public.open_bottles active
    where active.wine_id = w.id
      and active.restaurant_id = p_restaurant_id
      and active.closed_at is null
  ) ob on true
  where wl.restaurant_id = p_restaurant_id
    and wli.glass_pour_ml is not null
    and public.is_member(p_restaurant_id)
  order by w.producer, w.name
$function$;

revoke all on function public.list_open_bottle_items(uuid)
  from public, anon, service_role;
grant execute on function public.list_open_bottle_items(uuid) to authenticated;

create trigger open_bottles_enforce_capacity_trigger
  before insert or update on public.open_bottles
  for each row execute function public.open_bottles_enforce_capacity();

create function public.pour_events_maintain_open_bottle()
returns trigger
language plpgsql
set search_path = ''
as $function$
declare
  v_bottle public.open_bottles%rowtype;
  v_next_remaining int;
  v_prior_occurred_at timestamptz;
begin
  if new.event_contract <> 2 then
    raise exception 'legacy_writer_retired' using errcode = 'P0001';
  end if;

  select * into v_bottle
    from public.open_bottles ob
   where ob.id = new.open_bottle_id
     and ob.restaurant_id = new.restaurant_id
     and ob.wine_id = new.wine_id
     and ob.identity_contract = 2
   for update;
  if not found then
    raise exception 'open_bottle_not_found' using errcode = 'P0001';
  end if;

  -- The bottle row is the serialization point for every physical mutation.
  -- Clamp the persisted event time under that lock so equal/backward wall-clock
  -- readings and callers that began before they blocked cannot invert the
  -- per-bottle event order.
  select max(pe.occurred_at) into v_prior_occurred_at
    from public.pour_events pe
   where pe.open_bottle_id = v_bottle.id;
  if new.occurred_at is null then
    raise exception 'invalid_physical_command' using errcode = 'P0001';
  end if;
  if v_prior_occurred_at is not null
     and new.occurred_at <= v_prior_occurred_at then
    new.occurred_at := v_prior_occurred_at + interval '1 microsecond';
  end if;

  if new.kind = 'new_bottle' then
    if v_bottle.identity_origin <> 'native'
       or v_bottle.opening_operation_id is distinct from new.operation_id
       or v_bottle.state_version <> 0
       or v_bottle.closed_at is not null
       or new.ml_delta <> -v_bottle.nominal_capacity_ml
       or v_bottle.remaining_ml <> v_bottle.nominal_capacity_ml then
      raise exception 'invalid_physical_command' using errcode = 'P0001';
    end if;
    return new;
  end if;

  if new.kind in ('pour', 'spill', 'finish_bottle') then
    if v_bottle.closed_at is not null or new.ml_delta <= 0 then
      raise exception 'open_bottle_closed' using errcode = 'P0001';
    end if;
    if new.kind = 'finish_bottle' and new.ml_delta <> v_bottle.remaining_ml then
      raise exception 'open_bottle_changed' using errcode = 'P0001';
    end if;
    if new.ml_delta > v_bottle.remaining_ml then
      raise exception 'insufficient_bottle_volume' using errcode = 'P0001';
    end if;
    v_next_remaining := v_bottle.remaining_ml - new.ml_delta;
  elsif new.kind = 'reconcile' then
    if v_bottle.closed_at is not null then
      raise exception 'open_bottle_closed' using errcode = 'P0001';
    end if;
    v_next_remaining := v_bottle.remaining_ml - new.ml_delta;
    if v_next_remaining < 0 or v_next_remaining > v_bottle.nominal_capacity_ml then
      raise exception 'reconciliation_batch_stale' using errcode = 'P0001';
    end if;
  elsif new.kind = 'undo' then
    if new.ml_delta >= 0 then
      raise exception 'invalid_physical_command' using errcode = 'P0001';
    end if;
    v_next_remaining := v_bottle.remaining_ml - new.ml_delta;
    if v_next_remaining > v_bottle.nominal_capacity_ml then
      raise exception 'undo_requires_review' using errcode = 'P0001';
    end if;
  else
    raise exception 'invalid_physical_command' using errcode = 'P0001';
  end if;

  update public.open_bottles
     set remaining_ml = v_next_remaining,
         closed_at = case
           when v_next_remaining = 0 then new.occurred_at
           when new.kind = 'undo' then null
           else closed_at
         end,
         state_version = state_version + 1
   where id = v_bottle.id;
  return new;
end;
$function$;

create trigger pour_events_trigger
  before insert on public.pour_events
  for each row execute function public.pour_events_maintain_open_bottle();

create function public.execute_physical_bottle_command(
  p_operation_id uuid,
  p_restaurant_id uuid,
  p_command text,
  p_wine_id uuid,
  p_open_bottle_id uuid default null,
  p_predecessor_open_operation_id uuid default null,
  p_ml int default null,
  p_note text default null,
  p_preservation_method text default null,
  p_actual_remaining_ml int default null,
  p_written_off_ml int default 0,
  p_reason_code_id uuid default null,
  p_reversal_of_event_id uuid default null,
  p_correction_reason text default null,
  p_operator_confirms_same_bottle_present boolean default false
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user uuid := auth.uid();
  v_role public.membership_role;
  v_note text := nullif(btrim(p_note), '');
  v_request jsonb;
  v_receipt public.inventory_command_receipts%rowtype;
  v_claimed uuid;
  v_size_ml int;
  v_bottle public.open_bottles%rowtype;
  v_source public.inventory_items%rowtype;
  v_selected_bottle_id uuid;
  v_event public.pour_events%rowtype;
  v_new_event_id uuid;
  v_closeout public.bottle_closeouts%rowtype;
  v_effect_type text;
  v_occurred_at timestamptz;
  v_event_state_version bigint;
  v_result jsonb;
  v_is_discard boolean;
begin
  if public.current_inventory_contract_version() <> 2 then
    raise exception 'physical_inventory_contract_inactive' using errcode = 'P0001';
  end if;
  if v_user is null
     or p_operation_id is null
     or p_restaurant_id is null
     or p_wine_id is null
     or p_command is null
     or p_command not in ('open', 'pour', 'spill', 'close', 'discard', 'undo')
     or (v_note is not null and char_length(v_note) > 500)
     or p_written_off_ml is null
     or p_operator_confirms_same_bottle_present is null then
    raise exception 'invalid_physical_command' using errcode = 'P0001';
  end if;

  if p_command = 'open' then
    if p_open_bottle_id is not null
       or p_predecessor_open_operation_id is not null
       or p_ml is not null
       or p_actual_remaining_ml is not null
       or p_written_off_ml <> 0
       or p_reason_code_id is not null
       or p_reversal_of_event_id is not null
       or p_correction_reason is not null
       or p_operator_confirms_same_bottle_present
       or coalesce(p_preservation_method, 'none') not in ('coravin', 'argon', 'vacuum', 'none') then
      raise exception 'invalid_physical_command' using errcode = 'P0001';
    end if;
  elsif p_command in ('pour', 'spill') then
    if (p_open_bottle_id is null) = (p_predecessor_open_operation_id is null)
       or p_ml is null or p_ml <= 0 or p_ml > 2000
       or p_preservation_method is not null
       or p_actual_remaining_ml is not null
       or p_written_off_ml <> 0
       or p_reason_code_id is not null
       or p_reversal_of_event_id is not null
       or p_correction_reason is not null
       or p_operator_confirms_same_bottle_present then
      raise exception 'invalid_physical_command' using errcode = 'P0001';
    end if;
  elsif p_command in ('close', 'discard') then
    if (p_open_bottle_id is null) = (p_predecessor_open_operation_id is null)
       or p_ml is not null
       or p_preservation_method is not null
       or p_reversal_of_event_id is not null
       or p_correction_reason is not null
       or p_operator_confirms_same_bottle_present then
      raise exception 'invalid_physical_command' using errcode = 'P0001';
    end if;
    if p_command = 'discard' and (
      p_actual_remaining_ml is not null or p_written_off_ml <> 0 or p_reason_code_id is not null
    ) then
      raise exception 'invalid_physical_command' using errcode = 'P0001';
    end if;
    if p_command = 'close' and (
      p_actual_remaining_ml is null or p_actual_remaining_ml < 0
      or p_written_off_ml < 0 or p_written_off_ml > p_actual_remaining_ml
      or (p_written_off_ml > 0 and p_reason_code_id is null)
    ) then
      raise exception 'invalid_physical_command' using errcode = 'P0001';
    end if;
  else
    if p_open_bottle_id is not null
       or p_predecessor_open_operation_id is not null
       or p_ml is not null
       or p_preservation_method is not null
       or p_actual_remaining_ml is not null
       or p_written_off_ml <> 0
       or p_reason_code_id is not null
       or p_reversal_of_event_id is null then
      raise exception 'invalid_physical_command' using errcode = 'P0001';
    end if;
  end if;

  select m.role into v_role
    from public.memberships m
   where m.user_id = v_user
     and m.restaurant_id = p_restaurant_id
   for share;
  if not found then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  v_request := jsonb_build_object(
    'version', 2,
    'command', p_command,
    'wine_id', p_wine_id,
    'open_bottle_id', p_open_bottle_id,
    'predecessor_open_operation_id', p_predecessor_open_operation_id,
    'ml', p_ml,
    'note', v_note,
    'preservation_method', case when p_command = 'open' then coalesce(p_preservation_method, 'none') else null end,
    'actual_remaining_ml', p_actual_remaining_ml,
    'written_off_ml', p_written_off_ml,
    'reason_code_id', p_reason_code_id,
    'reversal_of_event_id', p_reversal_of_event_id,
    'correction_reason', p_correction_reason,
    'operator_confirms_same_bottle_present', p_operator_confirms_same_bottle_present
  );

  select * into v_receipt
    from public.inventory_command_receipts r
   where r.restaurant_id = p_restaurant_id
     and r.operation_id = p_operation_id;
  if found then
    if v_receipt.result_payload is null then
      raise exception 'physical_operation_incomplete' using errcode = 'P0001';
    end if;
    if v_receipt.actor_user_id is distinct from v_user then
      raise exception 'physical_operation_actor_conflict' using errcode = 'P0001';
    end if;
    if v_receipt.command_version <> 2
       or v_receipt.scope_kind <> 'single_wine'
       or v_receipt.command_type is distinct from p_command
       or v_receipt.request_payload is distinct from v_request then
      raise exception 'physical_operation_payload_conflict' using errcode = 'P0001';
    end if;
    return v_receipt.result_payload || jsonb_build_object('replayed', true);
  end if;

  select w.size_ml into v_size_ml
    from public.wines w
   where w.id = p_wine_id
     and w.restaurant_id = p_restaurant_id
   for no key update;
  if not found then
    raise exception 'wine_not_found' using errcode = 'P0001';
  end if;

  insert into public.inventory_command_receipts (
    restaurant_id, operation_id, actor_user_id, wine_id, command_type,
    request_payload, command_version, scope_kind, batch_entry_count
  ) values (
    p_restaurant_id, p_operation_id, v_user, p_wine_id, p_command,
    v_request, 2, 'single_wine', null
  )
  on conflict (restaurant_id, operation_id) do nothing
  returning operation_id into v_claimed;

  if v_claimed is null then
    select * into v_receipt
      from public.inventory_command_receipts r
     where r.restaurant_id = p_restaurant_id
       and r.operation_id = p_operation_id;
    if not found or v_receipt.result_payload is null then
      raise exception 'physical_operation_incomplete' using errcode = 'P0001';
    end if;
    if v_receipt.actor_user_id is distinct from v_user then
      raise exception 'physical_operation_actor_conflict' using errcode = 'P0001';
    end if;
    if v_receipt.command_version <> 2
       or v_receipt.scope_kind <> 'single_wine'
       or v_receipt.command_type is distinct from p_command
       or v_receipt.request_payload is distinct from v_request then
      raise exception 'physical_operation_payload_conflict' using errcode = 'P0001';
    end if;
    return v_receipt.result_payload || jsonb_build_object('replayed', true);
  end if;

  if p_command = 'open' then
    if v_size_ml is null or v_size_ml <= 0 then
      raise exception 'wine_size_unknown' using errcode = 'P0001';
    end if;
    select * into v_source
      from public.inventory_items ii
     where ii.restaurant_id = p_restaurant_id
       and ii.wine_id = p_wine_id
       and ii.quantity > 0
     order by ii.added_at, ii.id
     limit 1
     for update;
    if not found then
      raise exception 'no_inventory' using errcode = 'P0001';
    end if;
    v_occurred_at := clock_timestamp();
    update public.inventory_items
       set quantity = quantity - 1
     where id = v_source.id and quantity > 0;
    if not found then
      raise exception 'no_inventory' using errcode = 'P0001';
    end if;

    insert into public.open_bottles (
      wine_id, restaurant_id, remaining_ml, opened_at, opened_by,
      source_inventory_item_id, preservation_method, identity_contract,
      identity_origin, nominal_capacity_ml, source_provenance,
      opening_operation_id, state_version
    ) values (
      p_wine_id, p_restaurant_id, v_size_ml, v_occurred_at, v_user,
      v_source.id, coalesce(p_preservation_method, 'none'), 2,
      'native', v_size_ml, 'known', p_operation_id, 0
    ) returning * into v_bottle;

    insert into public.pour_events (
      wine_id, restaurant_id, open_bottle_id, ml_delta, kind,
      actor_user_id, occurred_at, note, event_contract, operation_id,
      operation_entry_ordinal
    ) values (
      p_wine_id, p_restaurant_id, v_bottle.id, -v_size_ml, 'new_bottle',
      v_user, v_occurred_at, v_note, 2, p_operation_id, 0
    ) returning id into v_new_event_id;
    v_effect_type := 'open';
  else
    if p_command = 'undo' then
      select * into v_event
        from public.pour_events pe
       where pe.id = p_reversal_of_event_id
         and pe.restaurant_id = p_restaurant_id
         and pe.wine_id = p_wine_id
         and pe.event_contract = 2
         and pe.kind in ('pour', 'spill')
         and pe.ml_delta > 0
         and pe.open_bottle_id is not null
       for update;
      if not found then
        raise exception 'open_bottle_not_found' using errcode = 'P0001';
      end if;
      v_selected_bottle_id := v_event.open_bottle_id;
    elsif p_open_bottle_id is not null then
      v_selected_bottle_id := p_open_bottle_id;
    else
      select e.open_bottle_id into v_selected_bottle_id
        from public.inventory_command_bottle_effects e
        join public.inventory_command_receipts r
          on r.restaurant_id = e.restaurant_id
         and r.operation_id = e.operation_id
       where e.restaurant_id = p_restaurant_id
         and e.operation_id = p_predecessor_open_operation_id
         and e.effect_type = 'open'
         and r.command_version = 2
         and r.completed_at is not null;
      if not found then
        raise exception 'physical_dependency_not_found' using errcode = 'P0001';
      end if;
    end if;

    select * into v_bottle
      from public.open_bottles ob
     where ob.id = v_selected_bottle_id
       and ob.restaurant_id = p_restaurant_id
       and ob.wine_id = p_wine_id
       and ob.identity_contract = 2
     for update;
    if not found then
      if p_predecessor_open_operation_id is not null then
        raise exception 'physical_dependency_stale' using errcode = 'P0001';
      end if;
      raise exception 'open_bottle_not_found' using errcode = 'P0001';
    end if;

    -- Match the trigger's per-bottle ordering while the same serialization
    -- lock is held. Scalar close/open response timestamps therefore remain
    -- equal to their event timestamps; the trigger independently protects
    -- batch and any future event writer.
    v_occurred_at := clock_timestamp();
    select greatest(
      v_occurred_at,
      coalesce(max(pe.occurred_at) + interval '1 microsecond', v_occurred_at)
    ) into v_occurred_at
      from public.pour_events pe
     where pe.open_bottle_id = v_bottle.id;

    if p_command <> 'undo' and v_bottle.closed_at is not null then
      raise exception 'open_bottle_closed' using errcode = 'P0001';
    end if;

    if p_command in ('pour', 'spill') then
      if v_bottle.remaining_ml < p_ml then
        raise exception 'insufficient_bottle_volume' using errcode = 'P0001';
      end if;
      insert into public.pour_events (
        wine_id, restaurant_id, open_bottle_id, ml_delta, kind,
        actor_user_id, occurred_at, note, event_contract, operation_id,
        operation_entry_ordinal
      ) values (
        p_wine_id, p_restaurant_id, v_bottle.id, p_ml, p_command,
        v_user, v_occurred_at, v_note, 2, p_operation_id, 0
      ) returning id into v_new_event_id;
      v_effect_type := p_command;
    elsif p_command = 'close' then
      if p_actual_remaining_ml > v_bottle.nominal_capacity_ml then
        raise exception 'invalid_actual_remaining' using errcode = 'P0001';
      end if;
      if p_reason_code_id is not null then
        perform 1 from public.reason_codes rc
         where rc.id = p_reason_code_id
           and rc.restaurant_id = p_restaurant_id
           and rc.active
           and rc.category in ('spoilage', 'adjustment')
         for share;
        if not found then
          raise exception 'invalid_reason_code' using errcode = 'P0001';
        end if;
      end if;
      insert into public.bottle_closeouts (
        restaurant_id, wine_id, open_bottle_id, preservation_method,
        opened_at, closed_by, closed_at, theoretical_remaining_ml,
        actual_remaining_ml, written_off_ml, reason_code_id, event_contract
      ) values (
        p_restaurant_id, p_wine_id, v_bottle.id, v_bottle.preservation_method,
        v_bottle.opened_at, v_user, v_occurred_at, v_bottle.remaining_ml,
        p_actual_remaining_ml, p_written_off_ml, p_reason_code_id, 2
      ) returning * into v_closeout;
      insert into public.pour_events (
        wine_id, restaurant_id, open_bottle_id, ml_delta, kind,
        actor_user_id, occurred_at, note, event_contract, operation_id,
        operation_entry_ordinal
      ) values (
        p_wine_id, p_restaurant_id, v_bottle.id, v_bottle.remaining_ml,
        'finish_bottle', v_user, v_occurred_at, coalesce(v_note, 'Bottle close-out'),
        2, p_operation_id, 0
      ) returning id into v_new_event_id;
      v_effect_type := 'close';
    elsif p_command = 'discard' then
      -- A zero-mL discard cannot produce the contract's positive depletion
      -- event. Reject it before event/effect/receipt completion or state change.
      if v_bottle.remaining_ml <= 0 then
        raise exception 'open_bottle_changed' using errcode = 'P0001';
      end if;
      insert into public.pour_events (
        wine_id, restaurant_id, open_bottle_id, ml_delta, kind,
        actor_user_id, occurred_at, note, event_contract, operation_id,
        operation_entry_ordinal
      ) values (
        p_wine_id, p_restaurant_id, v_bottle.id, v_bottle.remaining_ml,
        'spill', v_user, v_occurred_at, coalesce(v_note, 'Bottle discarded'),
        2, p_operation_id, 0
      ) returning id into v_new_event_id;
      v_effect_type := 'discard';
    else
      if v_event.occurred_at + interval '15 minutes' < v_occurred_at then
        raise exception 'undo_window_expired' using errcode = 'P0001';
      end if;
      if v_event.actor_user_id is distinct from v_user
         and v_role not in ('owner', 'manager') then
        raise exception 'forbidden' using errcode = '42501';
      end if;
      select case
        when jsonb_typeof(r.result_payload #> '{open_bottle,state_version}') = 'number' then
          case
            when (r.result_payload #>> '{open_bottle,state_version}') ~ '^[0-9]+$' then
              case
                when (r.result_payload #>> '{open_bottle,state_version}')::numeric
                       <= 9223372036854775807
                then (r.result_payload #>> '{open_bottle,state_version}')::bigint
                else null
              end
            else null
          end
        else null
      end
        into v_event_state_version
        from public.inventory_command_receipts r
        join public.inventory_command_bottle_effects e
          on e.restaurant_id = r.restaurant_id
         and e.operation_id = r.operation_id
         and e.entry_ordinal = v_event.operation_entry_ordinal
       where r.restaurant_id = p_restaurant_id
         and r.operation_id = v_event.operation_id
         and r.command_version = 2
         and r.scope_kind = 'single_wine'
         and r.completed_at is not null
         and r.result_payload #>> '{operation_id}' = v_event.operation_id::text
         and e.open_bottle_id = v_bottle.id
         and e.wine_id = p_wine_id
         and r.result_payload #>> '{open_bottle,id}' = v_bottle.id::text;
      if not found or v_event_state_version is null then
        raise exception 'undo_requires_review' using errcode = 'P0001';
      end if;
      if exists (
        select 1 from public.pour_events pe
         where pe.reversal_of_event_id = v_event.id
      ) then
        raise exception 'undo_already_applied' using errcode = 'P0001';
      end if;
      -- The receipt snapshot is the authoritative post-mutation sequence.
      -- Timestamps remain presentation/audit data and cannot authorize Undo.
      if v_bottle.state_version is distinct from v_event_state_version
         or exists (
        select 1 from public.bottle_closeouts bc
         where bc.open_bottle_id = v_bottle.id
      ) then
        raise exception 'undo_requires_review' using errcode = 'P0001';
      end if;
      if v_bottle.remaining_ml + v_event.ml_delta > v_bottle.nominal_capacity_ml then
        raise exception 'undo_requires_review' using errcode = 'P0001';
      end if;
      select exists (
        select 1 from public.inventory_command_bottle_effects e
         where e.restaurant_id = p_restaurant_id
           and e.operation_id = v_event.operation_id
           and e.open_bottle_id = v_bottle.id
           and e.effect_type = 'discard'
      ) into v_is_discard;
      if v_is_discard and (
        p_correction_reason is distinct from 'mistaken_report'
        or not p_operator_confirms_same_bottle_present
      ) then
        raise exception 'undo_requires_review' using errcode = 'P0001';
      end if;
      if not v_is_discard and (
        p_correction_reason is not null or p_operator_confirms_same_bottle_present
      ) then
        raise exception 'invalid_physical_command' using errcode = 'P0001';
      end if;
      insert into public.pour_events (
        wine_id, restaurant_id, open_bottle_id, ml_delta, kind,
        actor_user_id, occurred_at, note, event_contract, operation_id,
        operation_entry_ordinal, reversal_of_event_id
      ) values (
        p_wine_id, p_restaurant_id, v_bottle.id, -v_event.ml_delta, 'undo',
        v_user, v_occurred_at, v_note, 2, p_operation_id, 0, v_event.id
      ) returning id into v_new_event_id;
      v_effect_type := 'undo';
    end if;

    select * into v_bottle
      from public.open_bottles ob where ob.id = v_selected_bottle_id;
  end if;

  insert into public.inventory_command_bottle_effects (
    restaurant_id, operation_id, entry_ordinal, open_bottle_id, wine_id, effect_type
  ) values (
    p_restaurant_id, p_operation_id, 0, v_bottle.id, p_wine_id, v_effect_type
  );

  v_result := jsonb_build_object(
    'operation_id', p_operation_id,
    'command', p_command,
    'open_bottle', jsonb_build_object(
      'id', v_bottle.id,
      'restaurant_id', v_bottle.restaurant_id,
      'wine_id', v_bottle.wine_id,
      'remaining_ml', v_bottle.remaining_ml,
      'nominal_capacity_ml', v_bottle.nominal_capacity_ml,
      'opened_at', v_bottle.opened_at,
      'closed_at', v_bottle.closed_at,
      'preservation_method', v_bottle.preservation_method,
      'source_inventory_item_id', v_bottle.source_inventory_item_id,
      'source_provenance', v_bottle.source_provenance,
      'identity_contract', v_bottle.identity_contract,
      'identity_origin', v_bottle.identity_origin,
      'state_version', v_bottle.state_version
    ),
    'pour_event_ids', jsonb_build_array(v_new_event_id),
    'closeout', case when p_command = 'close' then jsonb_build_object(
      'id', v_closeout.id,
      'restaurant_id', v_closeout.restaurant_id,
      'wine_id', v_closeout.wine_id,
      'open_bottle_id', v_closeout.open_bottle_id,
      'preservation_method', v_closeout.preservation_method,
      'opened_at', v_closeout.opened_at,
      'closed_at', v_closeout.closed_at,
      'theoretical_remaining_ml', v_closeout.theoretical_remaining_ml,
      'actual_remaining_ml', v_closeout.actual_remaining_ml,
      'variance_ml', v_closeout.variance_ml,
      'written_off_ml', v_closeout.written_off_ml,
      'reason_code_id', v_closeout.reason_code_id,
      'event_contract', v_closeout.event_contract
    ) else null end
  );

  update public.inventory_command_receipts
     set result_payload = v_result,
         completed_at = clock_timestamp()
   where restaurant_id = p_restaurant_id
     and operation_id = p_operation_id
     and result_payload is null;
  if not found then
    raise exception 'physical_operation_incomplete' using errcode = 'P0001';
  end if;

  return v_result || jsonb_build_object('replayed', false);
end;
$function$;

create function public.execute_physical_reconciliation_batch(
  p_operation_id uuid,
  p_restaurant_id uuid,
  p_entries jsonb
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user uuid := auth.uid();
  v_entry jsonb;
  v_canonical_entries jsonb;
  v_request jsonb;
  v_entry_count int;
  v_distinct_count int;
  v_receipt public.inventory_command_receipts%rowtype;
  v_claimed uuid;
  v_pre_wines uuid[];
  v_locked_wines uuid[];
  v_bottle public.open_bottles%rowtype;
  v_event_id uuid;
  v_ordinal int := 0;
  v_occurred_at timestamptz;
  v_results jsonb := '[]'::jsonb;
  v_result jsonb;
begin
  if public.current_inventory_contract_version() <> 2 then
    raise exception 'physical_inventory_contract_inactive' using errcode = 'P0001';
  end if;
  if v_user is null or p_operation_id is null or p_restaurant_id is null
     or jsonb_typeof(p_entries) <> 'array' then
    raise exception 'invalid_reconciliation_batch' using errcode = 'P0001';
  end if;

  v_entry_count := jsonb_array_length(p_entries);
  if v_entry_count < 1 or v_entry_count > 100 then
    raise exception 'invalid_reconciliation_batch' using errcode = 'P0001';
  end if;

  for v_entry in select value from jsonb_array_elements(p_entries)
  loop
    if jsonb_typeof(v_entry) <> 'object'
       or (select count(*) from jsonb_object_keys(v_entry)) <> 4
       or exists (
         select 1 from jsonb_object_keys(v_entry) k
          where k not in ('open_bottle_id', 'expected_state_version', 'target_remaining_ml', 'note')
       )
       or not (v_entry ?& array['open_bottle_id', 'expected_state_version', 'target_remaining_ml', 'note'])
       or jsonb_typeof(v_entry->'open_bottle_id') <> 'string'
       or (v_entry->>'open_bottle_id') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
       or jsonb_typeof(v_entry->'expected_state_version') <> 'number'
       or (v_entry->>'expected_state_version') !~ '^[0-9]+$'
       or jsonb_typeof(v_entry->'target_remaining_ml') <> 'number'
       or (v_entry->>'target_remaining_ml') !~ '^[0-9]+$'
       or jsonb_typeof(v_entry->'note') not in ('string', 'null')
       or (jsonb_typeof(v_entry->'note') = 'string' and char_length(v_entry->>'note') > 500) then
      raise exception 'invalid_reconciliation_batch' using errcode = 'P0001';
    end if;
    if (v_entry->>'expected_state_version')::numeric > 9223372036854775807
       or (v_entry->>'target_remaining_ml')::numeric > 2147483647 then
      raise exception 'invalid_reconciliation_batch' using errcode = 'P0001';
    end if;
  end loop;

  select count(distinct (value->>'open_bottle_id')::uuid)
    into v_distinct_count
    from jsonb_array_elements(p_entries);
  if v_distinct_count <> v_entry_count then
    raise exception 'duplicate_reconciliation_bottle' using errcode = 'P0001';
  end if;

  select jsonb_agg(
    jsonb_build_object(
      'open_bottle_id', (value->>'open_bottle_id')::uuid,
      'expected_state_version', (value->>'expected_state_version')::bigint,
      'target_remaining_ml', (value->>'target_remaining_ml')::int,
      'note', case when jsonb_typeof(value->'note') = 'null' then null else value->>'note' end
    ) order by (value->>'open_bottle_id')::uuid
  ) into v_canonical_entries
    from jsonb_array_elements(p_entries);

  v_request := jsonb_build_object(
    'version', 2,
    'command', 'reconcile_batch',
    'entries', v_canonical_entries
  );

  perform 1 from public.memberships m
   where m.user_id = v_user
     and m.restaurant_id = p_restaurant_id
     and m.role in ('owner', 'manager')
   for share;
  if not found then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select * into v_receipt
    from public.inventory_command_receipts r
   where r.restaurant_id = p_restaurant_id
     and r.operation_id = p_operation_id;
  if found then
    if v_receipt.result_payload is null then
      raise exception 'physical_operation_incomplete' using errcode = 'P0001';
    end if;
    if v_receipt.actor_user_id is distinct from v_user then
      raise exception 'physical_operation_actor_conflict' using errcode = 'P0001';
    end if;
    if v_receipt.command_version <> 2
       or v_receipt.command_type <> 'reconcile_batch'
       or v_receipt.scope_kind <> 'exact_bottle_batch'
       or v_receipt.wine_id is not null
       or v_receipt.batch_entry_count <> v_entry_count
       or v_receipt.request_payload is distinct from v_request then
      raise exception 'physical_operation_payload_conflict' using errcode = 'P0001';
    end if;
    return v_receipt.result_payload || jsonb_build_object('replayed', true);
  end if;

  select array_agg(distinct ob.wine_id order by ob.wine_id)
    into v_pre_wines
    from jsonb_array_elements(v_canonical_entries) e
    join public.open_bottles ob
      on ob.id = (e->>'open_bottle_id')::uuid
     and ob.restaurant_id = p_restaurant_id;
  if coalesce(array_length(v_pre_wines, 1), 0) = 0
     or (select count(*) from public.open_bottles ob
          where ob.restaurant_id = p_restaurant_id
            and ob.id in (
              select (e->>'open_bottle_id')::uuid
                from jsonb_array_elements(v_canonical_entries) e
            )) <> v_entry_count then
    raise exception 'open_bottle_not_found' using errcode = 'P0001';
  end if;

  perform 1 from public.wines w
   where w.restaurant_id = p_restaurant_id
     and w.id = any(v_pre_wines)
   order by w.id
   for no key update;
  if not found then
    raise exception 'reconciliation_batch_stale' using errcode = 'P0001';
  end if;

  insert into public.inventory_command_receipts (
    restaurant_id, operation_id, actor_user_id, wine_id, command_type,
    request_payload, command_version, scope_kind, batch_entry_count
  ) values (
    p_restaurant_id, p_operation_id, v_user, null, 'reconcile_batch',
    v_request, 2, 'exact_bottle_batch', v_entry_count
  )
  on conflict (restaurant_id, operation_id) do nothing
  returning operation_id into v_claimed;
  if v_claimed is null then
    select * into v_receipt
      from public.inventory_command_receipts r
     where r.restaurant_id = p_restaurant_id
       and r.operation_id = p_operation_id;
    if not found or v_receipt.result_payload is null then
      raise exception 'physical_operation_incomplete' using errcode = 'P0001';
    end if;
    if v_receipt.actor_user_id is distinct from v_user then
      raise exception 'physical_operation_actor_conflict' using errcode = 'P0001';
    end if;
    if v_receipt.command_version <> 2
       or v_receipt.command_type <> 'reconcile_batch'
       or v_receipt.scope_kind <> 'exact_bottle_batch'
       or v_receipt.wine_id is not null
       or v_receipt.batch_entry_count <> v_entry_count
       or v_receipt.request_payload is distinct from v_request then
      raise exception 'physical_operation_payload_conflict' using errcode = 'P0001';
    end if;
    return v_receipt.result_payload || jsonb_build_object('replayed', true);
  end if;

  for v_entry in
    select value from jsonb_array_elements(v_canonical_entries)
     order by (value->>'open_bottle_id')::uuid
  loop
    perform 1 from public.open_bottles ob
     where ob.id = (v_entry->>'open_bottle_id')::uuid
       and ob.restaurant_id = p_restaurant_id
     for update;
    if not found then
      raise exception 'reconciliation_batch_stale' using errcode = 'P0001';
    end if;
  end loop;

  select array_agg(distinct ob.wine_id order by ob.wine_id)
    into v_locked_wines
    from public.open_bottles ob
   where ob.restaurant_id = p_restaurant_id
     and ob.id in (
       select (e->>'open_bottle_id')::uuid
         from jsonb_array_elements(v_canonical_entries) e
     );
  if v_locked_wines is distinct from v_pre_wines then
    raise exception 'reconciliation_batch_stale' using errcode = 'P0001';
  end if;

  for v_entry in
    select value from jsonb_array_elements(v_canonical_entries)
     order by (value->>'open_bottle_id')::uuid
  loop
    select * into strict v_bottle
      from public.open_bottles ob
     where ob.id = (v_entry->>'open_bottle_id')::uuid
       and ob.restaurant_id = p_restaurant_id;
    if v_bottle.identity_contract <> 2
       or v_bottle.closed_at is not null
       or v_bottle.nominal_capacity_ml is null
       or v_bottle.state_version <> (v_entry->>'expected_state_version')::bigint
       or (v_entry->>'target_remaining_ml')::int > v_bottle.nominal_capacity_ml then
      raise exception 'reconciliation_batch_stale' using errcode = 'P0001';
    end if;
  end loop;

  -- Every selected bottle is locked. Choose one timestamp that is newer than
  -- every selected bottle's prior event so the batch retains a shared
  -- occurrence time even under equal or backward wall-clock readings.
  v_occurred_at := clock_timestamp();
  select greatest(
    v_occurred_at,
    coalesce(max(pe.occurred_at) + interval '1 microsecond', v_occurred_at)
  ) into v_occurred_at
    from public.pour_events pe
   where pe.open_bottle_id in (
     select (e->>'open_bottle_id')::uuid
       from jsonb_array_elements(v_canonical_entries) e
   );

  for v_entry in
    select value from jsonb_array_elements(v_canonical_entries)
     order by (value->>'open_bottle_id')::uuid
  loop
    select * into strict v_bottle
      from public.open_bottles ob
     where ob.id = (v_entry->>'open_bottle_id')::uuid
       and ob.restaurant_id = p_restaurant_id;
    insert into public.pour_events (
      wine_id, restaurant_id, open_bottle_id, ml_delta, kind,
      actor_user_id, occurred_at, note, event_contract, operation_id,
      operation_entry_ordinal
    ) values (
      v_bottle.wine_id, p_restaurant_id, v_bottle.id,
      v_bottle.remaining_ml - (v_entry->>'target_remaining_ml')::int,
      'reconcile', v_user, v_occurred_at,
      case when jsonb_typeof(v_entry->'note') = 'null' then null else v_entry->>'note' end,
      2, p_operation_id, v_ordinal
    ) returning id into v_event_id;
    insert into public.inventory_command_bottle_effects (
      restaurant_id, operation_id, entry_ordinal, open_bottle_id, wine_id, effect_type
    ) values (
      p_restaurant_id, p_operation_id, v_ordinal, v_bottle.id,
      v_bottle.wine_id, 'reconcile'
    );
    select * into strict v_bottle
      from public.open_bottles ob where ob.id = v_bottle.id;
    v_results := v_results || jsonb_build_array(jsonb_build_object(
      'entry_ordinal', v_ordinal,
      'open_bottle_id', v_bottle.id,
      'wine_id', v_bottle.wine_id,
      'pour_event_id', v_event_id,
      'open_bottle', jsonb_build_object(
        'id', v_bottle.id,
        'restaurant_id', v_bottle.restaurant_id,
        'wine_id', v_bottle.wine_id,
        'remaining_ml', v_bottle.remaining_ml,
        'nominal_capacity_ml', v_bottle.nominal_capacity_ml,
        'opened_at', v_bottle.opened_at,
        'closed_at', v_bottle.closed_at,
        'preservation_method', v_bottle.preservation_method,
        'source_inventory_item_id', v_bottle.source_inventory_item_id,
        'source_provenance', v_bottle.source_provenance,
        'identity_contract', v_bottle.identity_contract,
        'identity_origin', v_bottle.identity_origin,
        'state_version', v_bottle.state_version
      )
    ));
    v_ordinal := v_ordinal + 1;
  end loop;

  v_result := jsonb_build_object(
    'operation_id', p_operation_id,
    'command', 'reconcile_batch',
    'entries', v_results
  );
  update public.inventory_command_receipts
     set result_payload = v_result,
         completed_at = clock_timestamp()
   where restaurant_id = p_restaurant_id
     and operation_id = p_operation_id
     and result_payload is null;
  if not found then
    raise exception 'physical_operation_incomplete' using errcode = 'P0001';
  end if;
  return v_result || jsonb_build_object('replayed', false);
end;
$function$;

-- The physical RPCs become the only application write boundary.
revoke all on function public.execute_physical_bottle_command(
  uuid, uuid, text, uuid, uuid, uuid, int, text, text, int, int, uuid, uuid, text, boolean
) from public, anon, authenticated, service_role;
grant execute on function public.execute_physical_bottle_command(
  uuid, uuid, text, uuid, uuid, uuid, int, text, text, int, int, uuid, uuid, text, boolean
) to authenticated;

revoke all on function public.execute_physical_reconciliation_batch(uuid, uuid, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.execute_physical_reconciliation_batch(uuid, uuid, jsonb)
  to authenticated;

revoke all on function public.execute_inventory_command(
  uuid, uuid, text, uuid, int, text, text, uuid, timestamptz, int, int, uuid
) from public, anon, service_role;
grant execute on function public.execute_inventory_command(
  uuid, uuid, text, uuid, int, text, text, uuid, timestamptz, int, int, uuid
) to authenticated;

revoke execute on function public.record_pour(uuid, int, text, text)
  from public, anon, authenticated, service_role;
revoke execute on function public.reconcile_open_bottle(uuid, int, text)
  from public, anon, authenticated, service_role;
revoke execute on function public.reconcile_open_bottles_batch(jsonb)
  from public, anon, authenticated, service_role;
revoke execute on function public.close_open_bottle(uuid, int, int, uuid)
  from public, anon, authenticated, service_role;
revoke execute on function public.undo_last_pour(uuid)
  from public, anon, authenticated, service_role;

drop policy "members can insert bottle_closeouts" on public.bottle_closeouts;

revoke insert, update, delete, truncate, references, trigger on table public.open_bottles
  from public, anon, authenticated, service_role;
revoke insert, update, delete, truncate, references, trigger on table public.pour_events
  from public, anon, authenticated, service_role;
revoke insert, update, delete, truncate, references, trigger on table public.bottle_closeouts
  from public, anon, authenticated, service_role;
revoke insert, update, delete, truncate, references, trigger on table public.inventory_command_receipts
  from public, anon, authenticated, service_role;
revoke insert, update, delete, truncate, references, trigger on table public.inventory_command_bottle_effects
  from public, anon, authenticated, service_role;

revoke all on function public.open_bottles_enforce_capacity()
  from public, anon, authenticated, service_role;
revoke all on function public.pour_events_maintain_open_bottle()
  from public, anon, authenticated, service_role;
revoke all on function public.auto_eightysix_on_low_inventory()
  from public, anon, authenticated, service_role;
revoke all on function public.import_batch_rows_reflect_inventory_delete()
  from public, anon, authenticated, service_role;

comment on function public.execute_inventory_command(
  uuid, uuid, text, uuid, int, text, text, uuid, timestamptz, int, int, uuid
) is 'Contract-2 cutover: completed version-1 receipt replay only. Fresh legacy writes raise legacy_inventory_command_retired.';
comment on function public.pour_events_reverse_open_bottle() is
  'Retained without a trigger for guarded Phase-C rollback/forensics. Contract-2 evidence is never deleted.';
comment on constraint open_bottles_source_inventory_item_tenant_wine_fkey
  on public.open_bottles is
  'Physical bottle source provenance is same-restaurant/same-wine and deletion-restricted.';

-- This must remain the final statement. The transaction exposes version 2
-- only after promotion, exact triggers, RPC grants, provenance guards, legacy
-- retirement, readers, and ACLs are all installed.
create or replace function public.current_inventory_contract_version()
returns smallint
language sql
stable
security invoker
set search_path = ''
as $$ select 2::smallint $$;
