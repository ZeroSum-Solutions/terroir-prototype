-- 0161_bottle_location_receiving.sql
--
-- Add the location-required, one-sealed-bottle receiving boundary. The
-- durable receipt is the business-operation anchor; the existing scan cache
-- and cost-bearing bottle_inventory_save command are not part of this RPC.

do $c06_0161_preflight$
begin
  if public.current_inventory_contract_version() <> 2
     or pg_catalog.to_regclass('public.inventory_command_receipts') is null
     or pg_catalog.to_regclass('public.inventory_items') is null
     or pg_catalog.to_regclass('public.wines') is null
     or pg_catalog.to_regclass('public.bins') is null
     or pg_catalog.to_regprocedure(
       'public.current_site_role_at_least(uuid,public.membership_role)'
     ) is null
     or pg_catalog.to_regrole('postgres') is null
     or pg_catalog.to_regrole('authenticated') is null then
    raise exception 'C06_0161_REQUIRED_BASELINE_MISSING' using errcode = 'P0001';
  end if;

  if exists (
    select 1
      from pg_catalog.pg_proc p
      join pg_catalog.pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname = 'receive_bottle_at_location_private'
  ) then
    raise exception 'C06_0161_TARGET_IDENTITY_OCCUPIED' using errcode = 'P0001';
  end if;

  if (select pg_catalog.count(*)
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
    raise exception 'C06_0161_RECEIPT_BASELINE_MISMATCH' using errcode = 'P0001';
  end if;
end;
$c06_0161_preflight$;

lock table public.inventory_command_receipts in access exclusive mode nowait;

do $c06_0161_locked_preflight$
begin
  if exists (
    select 1
      from pg_catalog.pg_proc p
      join pg_catalog.pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname = 'receive_bottle_at_location_private'
  ) or exists (
    select 1
      from public.inventory_command_receipts r
     where r.command_type = 'bottle_location_receive'
  ) then
    raise exception 'C06_0161_LOCKED_BASELINE_MISMATCH' using errcode = 'P0001';
  end if;
end;
$c06_0161_locked_preflight$;

alter table public.inventory_command_receipts
  drop constraint inventory_command_receipts_command_version_check,
  drop constraint inventory_command_receipts_command_type_check,
  drop constraint inventory_command_receipts_versioned_shape_check,
  add constraint inventory_command_receipts_command_version_check
    check (command_version in (1, 2, 3)),
  add constraint inventory_command_receipts_command_type_check check (
    command_type in (
      'open', 'pour', 'spill', 'discard', 'close', 'reconcile_batch', 'undo',
      'bottle_inventory_save', 'bottle_location_receive'
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
    or (
      command_version = 3
      and command_type = 'bottle_location_receive'
      and scope_kind = 'single_wine'
      and wine_id is not null
      and batch_entry_count is null
    )
  );

create function public.receive_bottle_at_location_private(
  p_restaurant_id uuid,
  p_operation_id uuid,
  p_wine_id uuid,
  p_section text,
  p_bin_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_actor uuid := (select auth.uid());
  v_section text;
  v_request jsonb;
  v_receipt public.inventory_command_receipts%rowtype;
  v_claimed uuid;
  v_bin_code text;
  v_inventory_item_id uuid;
  v_result jsonb;
begin
  if v_actor is null
     or not public.current_site_role_at_least(p_restaurant_id, 'staff') then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  v_section := pg_catalog.btrim(p_section);
  if p_restaurant_id is null
     or p_operation_id is null
     or p_wine_id is null
     or p_section is null
     or v_section = ''
     or pg_catalog.char_length(v_section) > 200
     or p_bin_id is null then
    raise exception 'bottle_location_receive_invalid' using errcode = 'P05V1';
  end if;

  v_request := pg_catalog.jsonb_build_object(
    'version', 3,
    'kind', 'bottle_location_receive',
    'wine_id', p_wine_id,
    'section', v_section,
    'bin_id', p_bin_id,
    'quantity', 1
  );

  -- Replay is checked before mutable wine/bin state. Historical JSON remains
  -- authoritative after a legitimate wine merge, bin rename, or retirement.
  select * into v_receipt
    from public.inventory_command_receipts r
   where r.restaurant_id = p_restaurant_id
     and r.operation_id = p_operation_id
   for update;
  if found then
    if v_receipt.actor_user_id is distinct from v_actor
       or v_receipt.command_version is distinct from 3
       or v_receipt.command_type is distinct from 'bottle_location_receive'
       or v_receipt.scope_kind is distinct from 'single_wine'
       or v_receipt.batch_entry_count is not null
       or v_receipt.request_payload is distinct from v_request then
      raise exception 'bottle_location_operation_conflict' using errcode = 'P05C1';
    end if;
    if v_receipt.completed_at is null
       or pg_catalog.jsonb_typeof(v_receipt.result_payload) is distinct from 'object'
       or (select pg_catalog.count(*) from pg_catalog.jsonb_object_keys(v_receipt.result_payload)) <> 10
       or pg_catalog.jsonb_typeof(v_receipt.result_payload -> 'version') is distinct from 'number'
       or v_receipt.result_payload ->> 'version' is distinct from '1'
       or pg_catalog.jsonb_typeof(v_receipt.result_payload -> 'kind') is distinct from 'string'
       or v_receipt.result_payload ->> 'kind' is distinct from 'bottle_location_receive'
       or pg_catalog.jsonb_typeof(v_receipt.result_payload -> 'status') is distinct from 'string'
       or v_receipt.result_payload ->> 'status' is distinct from 'committed'
       or pg_catalog.jsonb_typeof(v_receipt.result_payload -> 'operationId') is distinct from 'string'
       or v_receipt.result_payload ->> 'operationId' is distinct from p_operation_id::text
       or pg_catalog.jsonb_typeof(v_receipt.result_payload -> 'inventoryItemId') is distinct from 'string'
       or v_receipt.result_payload ->> 'inventoryItemId'
            !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
       or pg_catalog.jsonb_typeof(v_receipt.result_payload -> 'wineId') is distinct from 'string'
       or v_receipt.result_payload ->> 'wineId' is distinct from p_wine_id::text
       or pg_catalog.jsonb_typeof(v_receipt.result_payload -> 'section') is distinct from 'string'
       or v_receipt.result_payload ->> 'section' is distinct from v_section
       or pg_catalog.jsonb_typeof(v_receipt.result_payload -> 'binId') is distinct from 'string'
       or v_receipt.result_payload ->> 'binId' is distinct from p_bin_id::text
       or pg_catalog.jsonb_typeof(v_receipt.result_payload -> 'binCode') is distinct from 'string'
       or pg_catalog.jsonb_typeof(v_receipt.result_payload -> 'quantity') is distinct from 'number'
       or v_receipt.result_payload ->> 'quantity' is distinct from '1' then
      raise exception 'bottle_location_operation_incomplete' using errcode = 'P05I1';
    end if;
    return v_receipt.result_payload || pg_catalog.jsonb_build_object('replayed', true);
  end if;

  -- Match the established physical-command and merge order: wine, receipt,
  -- then location. NO KEY UPDATE serializes writers without blocking FK reads.
  perform 1
    from public.wines w
   where w.id = p_wine_id
     and w.restaurant_id = p_restaurant_id
   for no key update;
  if not found then
    raise exception 'bottle_location_wine_not_found' using errcode = 'P05W1';
  end if;

  insert into public.inventory_command_receipts (
    restaurant_id, operation_id, actor_user_id, wine_id, command_type,
    request_payload, command_version, scope_kind, batch_entry_count
  ) values (
    p_restaurant_id, p_operation_id, v_actor, p_wine_id,
    'bottle_location_receive', v_request, 3, 'single_wine', null
  )
  on conflict (restaurant_id, operation_id) do nothing
  returning operation_id into v_claimed;

  if v_claimed is null then
    select * into v_receipt
      from public.inventory_command_receipts r
     where r.restaurant_id = p_restaurant_id
       and r.operation_id = p_operation_id
     for update;
    if not found
       or v_receipt.actor_user_id is distinct from v_actor
       or v_receipt.command_version is distinct from 3
       or v_receipt.command_type is distinct from 'bottle_location_receive'
       or v_receipt.scope_kind is distinct from 'single_wine'
       or v_receipt.batch_entry_count is not null
       or v_receipt.request_payload is distinct from v_request then
      raise exception 'bottle_location_operation_conflict' using errcode = 'P05C1';
    end if;
    if v_receipt.completed_at is null
       or pg_catalog.jsonb_typeof(v_receipt.result_payload) is distinct from 'object'
       or (select pg_catalog.count(*) from pg_catalog.jsonb_object_keys(v_receipt.result_payload)) <> 10
       or pg_catalog.jsonb_typeof(v_receipt.result_payload -> 'version') is distinct from 'number'
       or v_receipt.result_payload ->> 'version' is distinct from '1'
       or pg_catalog.jsonb_typeof(v_receipt.result_payload -> 'kind') is distinct from 'string'
       or v_receipt.result_payload ->> 'kind' is distinct from 'bottle_location_receive'
       or pg_catalog.jsonb_typeof(v_receipt.result_payload -> 'status') is distinct from 'string'
       or v_receipt.result_payload ->> 'status' is distinct from 'committed'
       or pg_catalog.jsonb_typeof(v_receipt.result_payload -> 'operationId') is distinct from 'string'
       or v_receipt.result_payload ->> 'operationId' is distinct from p_operation_id::text
       or pg_catalog.jsonb_typeof(v_receipt.result_payload -> 'inventoryItemId') is distinct from 'string'
       or v_receipt.result_payload ->> 'inventoryItemId'
            !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
       or pg_catalog.jsonb_typeof(v_receipt.result_payload -> 'wineId') is distinct from 'string'
       or v_receipt.result_payload ->> 'wineId' is distinct from p_wine_id::text
       or pg_catalog.jsonb_typeof(v_receipt.result_payload -> 'section') is distinct from 'string'
       or v_receipt.result_payload ->> 'section' is distinct from v_section
       or pg_catalog.jsonb_typeof(v_receipt.result_payload -> 'binId') is distinct from 'string'
       or v_receipt.result_payload ->> 'binId' is distinct from p_bin_id::text
       or pg_catalog.jsonb_typeof(v_receipt.result_payload -> 'binCode') is distinct from 'string'
       or pg_catalog.jsonb_typeof(v_receipt.result_payload -> 'quantity') is distinct from 'number'
       or v_receipt.result_payload ->> 'quantity' is distinct from '1' then
      raise exception 'bottle_location_operation_incomplete' using errcode = 'P05I1';
    end if;
    return v_receipt.result_payload || pg_catalog.jsonb_build_object('replayed', true);
  end if;

  select b.code into v_bin_code
    from public.bins b
   where b.id = p_bin_id
     and b.restaurant_id = p_restaurant_id
     and b.retired_at is null
   for share;
  if not found then
    raise exception 'bottle_location_bin_unavailable' using errcode = 'P05B1';
  end if;

  insert into public.inventory_items (
    wine_id, restaurant_id, invoice_scan_id, quantity, unit_cost, currency,
    format, section, bin_id, bin_location, added_via
  ) values (
    p_wine_id, p_restaurant_id, null, 1, 0, null,
    null, v_section, p_bin_id, v_bin_code, 'bottle_scan'::public.added_via
  )
  returning id into v_inventory_item_id;

  v_result := pg_catalog.jsonb_build_object(
    'version', 1,
    'kind', 'bottle_location_receive',
    'status', 'committed',
    'operationId', p_operation_id,
    'inventoryItemId', v_inventory_item_id,
    'wineId', p_wine_id,
    'section', v_section,
    'binId', p_bin_id,
    'binCode', v_bin_code,
    'quantity', 1
  );

  update public.inventory_command_receipts r
     set result_payload = v_result,
         completed_at = pg_catalog.statement_timestamp()
   where r.restaurant_id = p_restaurant_id
     and r.operation_id = p_operation_id
     and r.command_version = 3
     and r.command_type = 'bottle_location_receive'
     and r.result_payload is null
     and r.completed_at is null;
  if not found then
    raise exception 'bottle_location_operation_incomplete' using errcode = 'P05I1';
  end if;

  return v_result || pg_catalog.jsonb_build_object('replayed', false);
end;
$function$;

comment on function public.receive_bottle_at_location_private(uuid,uuid,uuid,text,uuid) is
  'Idempotent staff receive of one new sealed bottle into one exact active site bin.';

revoke all on function public.receive_bottle_at_location_private(uuid,uuid,uuid,text,uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.receive_bottle_at_location_private(uuid,uuid,uuid,text,uuid)
  to authenticated;
alter function public.receive_bottle_at_location_private(uuid,uuid,uuid,text,uuid)
  owner to postgres;

do $c06_0161_postflight$
declare
  v_function pg_catalog.pg_proc%rowtype;
  v_overload_count integer;
  v_receipt_definition text;
begin
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
     or v_function.prolang <> (
       select l.oid from pg_catalog.pg_language l where l.lanname = 'plpgsql'
     )
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
     or v_function.pronargdefaults <> 0
     or v_function.provariadic <> 0::pg_catalog.oid
     or v_function.prosupport <> 0::pg_catalog.oid
     or v_function.proconfig is distinct from array['search_path=""']::text[]
     or pg_catalog.to_jsonb(v_function.proargnames) is distinct from
       '["p_restaurant_id", "p_operation_id", "p_wine_id", "p_section", "p_bin_id"]'::pg_catalog.jsonb
     or v_function.proargmodes is not null
     or v_function.proallargtypes is not null
     or v_function.protrftypes is not null
     or v_function.proargdefaults is not null
     or v_function.prosqlbody is not null
     or v_function.probin is not null
     or pg_catalog.to_jsonb(v_function.proacl) is distinct from
       '["postgres=X/postgres", "authenticated=X/postgres"]'::pg_catalog.jsonb
     or pg_catalog.strpos(v_receipt_definition, 'bottle_inventory_save') = 0
     or pg_catalog.strpos(v_receipt_definition, 'bottle_location_receive') = 0
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
    raise exception 'C06_0161_POSTFLIGHT_MISMATCH' using errcode = 'P0001';
  end if;
end;
$c06_0161_postflight$;
