-- 0161_bottle_location_receiving.down.sql
--
-- Remove only the exact 0161 boundary. Durable location-receive history is a
-- hard rollback refusal: this down never deletes evidence and never cascades.

do $c06_0161_down_preflight$
declare
  v_function pg_catalog.pg_proc%rowtype;
  v_overload_count integer;
  v_receipt_definition text;
begin
  if pg_catalog.to_regprocedure(
    'public.receive_bottle_at_location_private(uuid,uuid,uuid,text,uuid)'
  ) is null then
    raise exception 'C06_0161_DOWN_BASELINE_MISMATCH' using errcode = 'P0001';
  end if;

  select p.* into strict v_function
    from pg_catalog.pg_proc p
   where p.oid = pg_catalog.to_regprocedure(
     'public.receive_bottle_at_location_private(uuid,uuid,uuid,text,uuid)'
   );
  select pg_catalog.count(*) into v_overload_count
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname = 'receive_bottle_at_location_private';
  select pg_catalog.pg_get_constraintdef(c.oid, true) into strict v_receipt_definition
    from pg_catalog.pg_constraint c
   where c.conrelid = pg_catalog.to_regclass('public.inventory_command_receipts')
     and c.conname = 'inventory_command_receipts_versioned_shape_check';

  if v_overload_count <> 1
     or pg_catalog.encode(
       pg_catalog.sha256(pg_catalog.convert_to(v_function.prosrc, 'UTF8')),
       'hex'
     ) <> '6a24736e1a19541d567081f9cec72f32e4c72af371f6d62f0c8015480750af03'
     or pg_catalog.pg_get_userbyid(v_function.proowner) <> 'postgres'
     or v_function.proconfig is distinct from array['search_path=""']::text[]
     or pg_catalog.to_jsonb(v_function.proacl) is distinct from
       '["postgres=X/postgres", "authenticated=X/postgres"]'::pg_catalog.jsonb
     or pg_catalog.strpos(v_receipt_definition, 'bottle_inventory_save') = 0
     or pg_catalog.strpos(v_receipt_definition, 'bottle_location_receive') = 0 then
    raise exception 'C06_0161_DOWN_BASELINE_MISMATCH' using errcode = 'P0001';
  end if;
end;
$c06_0161_down_preflight$;

lock table public.inventory_command_receipts in access exclusive mode nowait;

do $c06_0161_durable_history_guard$
begin
  if exists (
    select 1
      from public.inventory_command_receipts r
     where r.command_version = 3
       and r.command_type = 'bottle_location_receive'
  ) then
    raise exception 'C06_0161_DOWN_REFUSES_DURABLE_HISTORY' using errcode = 'P0001';
  end if;
end;
$c06_0161_durable_history_guard$;

drop function public.receive_bottle_at_location_private(uuid,uuid,uuid,text,uuid)
  restrict;

alter table public.inventory_command_receipts
  drop constraint inventory_command_receipts_command_version_check,
  drop constraint inventory_command_receipts_command_type_check,
  drop constraint inventory_command_receipts_versioned_shape_check,
  add constraint inventory_command_receipts_command_version_check
    check (command_version in (1, 2, 3)),
  add constraint inventory_command_receipts_command_type_check check (
    command_type in (
      'open', 'pour', 'spill', 'discard', 'close', 'reconcile_batch', 'undo',
      'bottle_inventory_save'
    )
  ),
  add constraint inventory_command_receipts_versioned_shape_check check (
    (
      command_version = 1
      and command_type in ('open', 'pour', 'spill', 'discard', 'close')
      and scope_kind = 'single_wine'
      and wine_id is not null
      and batch_entry_count is null
    )
    or (
      command_version = 2
      and command_type in ('open', 'pour', 'spill', 'discard', 'close', 'undo')
      and scope_kind = 'single_wine'
      and wine_id is not null
      and batch_entry_count is null
    )
    or (
      command_version = 2
      and command_type = 'reconcile_batch'
      and scope_kind = 'exact_bottle_batch'
      and wine_id is null
      and batch_entry_count > 0
    )
    or (
      command_version = 3
      and command_type = 'bottle_inventory_save'
      and scope_kind = 'single_wine'
      and wine_id is not null
      and batch_entry_count is null
    )
  );

do $c06_0161_down_postflight$
declare
  v_receipt_definition text;
begin
  select pg_catalog.pg_get_constraintdef(c.oid, true) into strict v_receipt_definition
    from pg_catalog.pg_constraint c
   where c.conrelid = pg_catalog.to_regclass('public.inventory_command_receipts')
     and c.conname = 'inventory_command_receipts_versioned_shape_check';

  if exists (
       select 1
         from pg_catalog.pg_proc p
         join pg_catalog.pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and p.proname = 'receive_bottle_at_location_private'
     )
     or pg_catalog.strpos(v_receipt_definition, 'bottle_inventory_save') = 0
     or pg_catalog.strpos(v_receipt_definition, 'bottle_location_receive') <> 0
     or (select pg_catalog.count(*)
           from pg_catalog.pg_constraint c
          where c.conrelid = pg_catalog.to_regclass('public.inventory_command_receipts')
            and c.conname in (
              'inventory_command_receipts_completion_pair',
              'inventory_command_receipts_result_object',
              'inventory_command_receipts_command_version_check',
              'inventory_command_receipts_command_type_check',
              'inventory_command_receipts_scope_kind_check',
              'inventory_command_receipts_batch_entry_count_check',
              'inventory_command_receipts_versioned_shape_check'
            )
            and c.contype = 'c'
            and c.convalidated) <> 7
     or pg_catalog.has_table_privilege(
       'authenticated', 'public.inventory_command_receipts', 'SELECT,INSERT,UPDATE,DELETE'
     )
     or pg_catalog.has_table_privilege(
       'anon', 'public.inventory_command_receipts', 'SELECT,INSERT,UPDATE,DELETE'
     )
     or pg_catalog.has_table_privilege(
       'service_role', 'public.inventory_command_receipts', 'INSERT,UPDATE,DELETE'
     ) then
    raise exception 'C06_0161_DOWN_POSTFLIGHT_MISMATCH' using errcode = 'P0001';
  end if;
end;
$c06_0161_down_postflight$;
