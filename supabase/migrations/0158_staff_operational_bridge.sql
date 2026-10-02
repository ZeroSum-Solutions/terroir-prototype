-- 0158_staff_operational_bridge.sql
--
-- Additive bridge for lifecycle-current operational membership selection and
-- staff-capable atomic bottle receiving. The 24-hour scan cache remains only
-- the HTTP transport state machine; inventory_command_receipts is the durable
-- business-operation anchor.

do $static_admission$
begin
  if public.current_inventory_contract_version() <> 2
     or to_regprocedure('public.current_site_role_at_least(uuid,public.membership_role)') is null
     or to_regprocedure('public.claim_scan_idempotency(uuid,uuid,text)') is null
     or to_regprocedure('public.complete_scan_idempotency(uuid,uuid,text,uuid,integer,integer,uuid)') is null
     or to_regprocedure('public.cleanup_scan_idempotency()') is null
     or to_regprocedure('public.find_or_create_wines_batch(uuid,jsonb)') is null
     or to_regrole('postgres') is null then
    raise exception 'C04_0158_REQUIRED_BASELINE_MISSING' using errcode = 'P0001';
  end if;
  if to_regprocedure('public.read_current_operational_memberships(uuid)') is not null
     or to_regprocedure('public.save_bottle_inventory_private(uuid,uuid,text,text,integer,text,text,text,text,integer,numeric)') is not null then
    raise exception 'C04_0158_ALREADY_OR_PARTIALLY_APPLIED' using errcode = 'P0001';
  end if;
  if not exists (
    select 1 from pg_catalog.pg_constraint c
     where c.conrelid = 'public.inventory_command_receipts'::regclass
       and c.conname in (
         'inventory_command_receipts_command_version_check',
         'inventory_command_receipts_command_type_check',
         'inventory_command_receipts_versioned_shape_check'
       )
     group by c.conrelid having count(*) = 3
  ) or exists (
    select 1 from public.inventory_command_receipts r where r.command_version = 3
  ) then
    raise exception 'C04_0158_RECEIPT_BASELINE_MISMATCH' using errcode = 'P0001';
  end if;
end;
$static_admission$;

-- Promotion must drain the old bottle route before taking these locks and
-- keep it drained until the exact RPC caller is deployed. No old two-write
-- claim has enough canonical input to backfill honestly.
lock table public.scan_idempotency in share row exclusive mode nowait;
lock table public.inventory_command_receipts in access exclusive mode nowait;

do $locked_route_drain_admission$
begin
  if exists (
    select 1
      from public.scan_idempotency c
     where c.claimed_by_user_id is not null
       and jsonb_typeof(c.response_body) = 'object'
       and jsonb_typeof(c.response_body -> 'kind') = 'string'
       and c.response_body ->> 'kind' = 'bottle_inventory_save'
  ) then
    raise exception 'C04_0158_UNBACKFILLABLE_BOTTLE_TRANSPORT_CLAIM'
      using errcode = 'P0001';
  end if;
end;
$locked_route_drain_admission$;

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

create function public.read_current_operational_memberships(p_user_id uuid)
returns table (
  restaurant_id uuid,
  restaurant_name text,
  role public.membership_role
)
language sql
stable
security definer
set search_path = ''
as $function$
  select m.restaurant_id, r.name, m.role
    from public.memberships m
    join public.restaurants r
      on r.id = m.restaurant_id
    join public.workspaces w
      on w.id = r.workspace_id
     and w.kind = 'restaurant'
    join public.workspace_memberships wm
      on wm.id = m.workspace_membership_id
     and wm.workspace_id = w.id
     and wm.user_id = m.user_id
   where p_user_id is not null
     and p_user_id = (select auth.uid())
     and m.user_id = p_user_id
     and m.role in ('owner', 'manager', 'staff')
     and m.status = 'active'
     and m.revoked_at is null
     and (m.expires_at is null or m.expires_at > statement_timestamp())
     and wm.status = 'active'
     and wm.revoked_at is null
     and (wm.expires_at is null or wm.expires_at > statement_timestamp())
   order by m.created_at desc, m.id desc
$function$;

create function public.save_bottle_inventory_private(
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
  p_unit_cost numeric
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_actor uuid := (select auth.uid());
  v_name text := btrim(p_name);
  v_producer text := btrim(p_producer);
  v_varietal text := nullif(p_varietal, '');
  v_region text := nullif(p_region, '');
  v_claim jsonb := jsonb_build_object(
    'version', 1, 'kind', 'bottle_inventory_save', 'status', 'claimed'
  );
  v_request jsonb;
  v_transport public.scan_idempotency%rowtype;
  v_transport_completed boolean := false;
  v_receipt public.inventory_command_receipts%rowtype;
  v_wine_ids uuid[];
  v_wine_id uuid;
  v_claimed uuid;
  v_result jsonb;
begin
  if v_actor is null or not public.current_site_role_at_least(p_restaurant_id, 'staff') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_restaurant_id is null or p_key is null
     or p_name is null or v_name = '' or octet_length(v_name) > 500
     or p_producer is null or v_producer = '' or octet_length(v_producer) > 500
     or p_varietal is null or octet_length(p_varietal) > 500
     or p_region is null or octet_length(p_region) > 500
     or (p_country is not null and octet_length(p_country) > 500)
     or (p_format is not null and octet_length(p_format) > 100)
     or p_quantity is null or p_quantity not between 1 and 100000
     or p_unit_cost is null or p_unit_cost not between 0 and 1000000 then
    raise exception 'C04_BOTTLE_SAVE_INVALID' using errcode = 'P0001';
  end if;

  -- This row is the outer HTTP state machine, not the durable receipt. Lock it
  -- first and admit only the exact unfinished claim or a strict current bottle
  -- completion. A completed transport still has to pass the durable validator.
  select * into v_transport
    from public.scan_idempotency c
   where c.key = p_key and c.restaurant_id = p_restaurant_id
   for update;
  if not found
     or v_transport.created_at <= statement_timestamp() - interval '24 hours' then
    raise exception 'C04_BOTTLE_TRANSPORT_CLAIM_REQUIRED' using errcode = 'P0001';
  end if;
  if v_transport.claimed_by_user_id is distinct from v_actor then
    raise exception 'C04_BOTTLE_TRANSPORT_CLAIM_REQUIRED' using errcode = 'P0001';
  end if;
  if v_transport.response_status is null
     and v_transport.response_body = v_claim then
    v_transport_completed := false;
  elsif v_transport.response_status = 200
     and jsonb_typeof(v_transport.response_body) = 'object'
     and (select count(*) from jsonb_object_keys(v_transport.response_body)) = 5
     and jsonb_typeof(v_transport.response_body -> 'version') = 'number'
     and v_transport.response_body ->> 'version' = '1'
     and jsonb_typeof(v_transport.response_body -> 'kind') = 'string'
     and v_transport.response_body ->> 'kind' = 'bottle_inventory_save'
     and jsonb_typeof(v_transport.response_body -> 'status') = 'string'
     and v_transport.response_body ->> 'status' = 'committed'
     and jsonb_typeof(v_transport.response_body -> 'wineId') = 'string'
     and jsonb_typeof(v_transport.response_body -> 'itemCount') = 'number'
     and v_transport.response_body ->> 'itemCount' = '1' then
    v_transport_completed := true;
  else
    raise exception 'C04_BOTTLE_TRANSPORT_CLAIM_REQUIRED' using errcode = 'P0001';
  end if;

  v_request := jsonb_build_object(
    'version', 3,
    'kind', 'bottle_inventory_save',
    'name', v_name,
    'producer', v_producer,
    'vintage', p_vintage,
    'varietal', v_varietal,
    'region', v_region,
    'country', p_country,
    'size_ml', 750,
    'format', p_format,
    'quantity', p_quantity,
    'unit_cost', p_unit_cost
  );

  -- Completed replay is checked before touching a wine. The scalar wine_id is
  -- merge-current; result_payload is only a fixed completion marker.
  select * into v_receipt
    from public.inventory_command_receipts r
   where r.restaurant_id = p_restaurant_id and r.operation_id = p_key
   for update;
  if found then
    if v_receipt.actor_user_id is distinct from v_actor
       or v_receipt.command_version <> 3
       or v_receipt.command_type is distinct from 'bottle_inventory_save'
       or v_receipt.scope_kind is distinct from 'single_wine'
       or v_receipt.batch_entry_count is not null
       or v_receipt.request_payload is distinct from v_request then
      raise exception 'C04_BOTTLE_OPERATION_CONFLICT' using errcode = 'P0001';
    end if;
    if v_receipt.wine_id is null
       or v_receipt.completed_at is null
       or v_receipt.result_payload is distinct from '{"status":"committed"}'::jsonb
       or (v_transport_completed and v_transport.response_body is distinct from
         jsonb_build_object(
           'version', 1, 'kind', 'bottle_inventory_save',
           'wineId', v_receipt.wine_id, 'status', 'committed', 'itemCount', 1
         )) then
      raise exception 'C04_BOTTLE_OPERATION_INCOMPLETE' using errcode = 'P0001';
    end if;
    return public.complete_scan_idempotency(
      p_restaurant_id, p_key, 'bottle_inventory_save',
      null, 1, null, v_receipt.wine_id
    );
  end if;

  if v_transport_completed then
    raise exception 'C04_BOTTLE_OPERATION_INCOMPLETE' using errcode = 'P0001';
  end if;

  select public.find_or_create_wines_batch(
    p_restaurant_id,
    jsonb_build_array(jsonb_build_object(
      'name', v_name, 'producer', v_producer, 'vintage', p_vintage,
      'varietal', v_varietal, 'region', v_region, 'country', p_country,
      'size_ml', 750
    ))
  ) into v_wine_ids;
  if cardinality(v_wine_ids) <> 1 or v_wine_ids[1] is null then
    raise exception 'C04_BOTTLE_WINE_REFUSED' using errcode = 'P0001';
  end if;
  v_wine_id := v_wine_ids[1];

  -- Match the established physical-command order: wine, then durable receipt.
  perform 1 from public.wines w
   where w.id = v_wine_id and w.restaurant_id = p_restaurant_id
   for no key update;
  if not found then
    raise exception 'C04_BOTTLE_WINE_REFUSED' using errcode = 'P0001';
  end if;

  insert into public.inventory_command_receipts (
    restaurant_id, operation_id, actor_user_id, wine_id, command_type,
    request_payload, command_version, scope_kind, batch_entry_count
  ) values (
    p_restaurant_id, p_key, v_actor, v_wine_id, 'bottle_inventory_save',
    v_request, 3, 'single_wine', null
  )
  on conflict (restaurant_id, operation_id) do nothing
  returning operation_id into v_claimed;

  if v_claimed is null then
    select * into v_receipt
      from public.inventory_command_receipts r
     where r.restaurant_id = p_restaurant_id and r.operation_id = p_key
     for update;
    if not found
       or v_receipt.actor_user_id is distinct from v_actor
       or v_receipt.command_version <> 3
       or v_receipt.command_type is distinct from 'bottle_inventory_save'
       or v_receipt.scope_kind is distinct from 'single_wine'
       or v_receipt.batch_entry_count is not null
       or v_receipt.request_payload is distinct from v_request then
      raise exception 'C04_BOTTLE_OPERATION_CONFLICT' using errcode = 'P0001';
    end if;
    if v_receipt.wine_id is null
       or v_receipt.completed_at is null
       or v_receipt.result_payload is distinct from '{"status":"committed"}'::jsonb then
      raise exception 'C04_BOTTLE_OPERATION_INCOMPLETE' using errcode = 'P0001';
    end if;
    return public.complete_scan_idempotency(
      p_restaurant_id, p_key, 'bottle_inventory_save',
      null, 1, null, v_receipt.wine_id
    );
  end if;

  insert into public.inventory_items (
    wine_id, restaurant_id, invoice_scan_id, quantity, unit_cost, format, added_via
  ) values (
    v_wine_id, p_restaurant_id, null, p_quantity, p_unit_cost, p_format,
    'bottle_scan'::public.added_via
  );

  update public.inventory_command_receipts r
     set result_payload = '{"status":"committed"}'::jsonb,
         completed_at = statement_timestamp()
   where r.restaurant_id = p_restaurant_id
     and r.operation_id = p_key
     and r.command_version = 3
     and r.result_payload is null
     and r.completed_at is null;
  if not found then
    raise exception 'C04_BOTTLE_OPERATION_INCOMPLETE' using errcode = 'P0001';
  end if;

  v_result := public.complete_scan_idempotency(
    p_restaurant_id, p_key, 'bottle_inventory_save',
    null, 1, null, v_wine_id
  );
  return v_result;
end;
$function$;

comment on function public.read_current_operational_memberships(uuid) is
  'Closed lifecycle-current operational membership projection for the calling user.';
comment on function public.save_bottle_inventory_private(
  uuid,uuid,text,text,integer,text,text,text,text,integer,numeric
) is
  'Atomic staff bottle receiving with a durable version-3 business receipt.';

revoke all on function public.read_current_operational_memberships(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.save_bottle_inventory_private(
  uuid,uuid,text,text,integer,text,text,text,text,integer,numeric
) from public, anon, authenticated, service_role;
grant execute on function public.read_current_operational_memberships(uuid)
  to authenticated;
grant execute on function public.save_bottle_inventory_private(
  uuid,uuid,text,text,integer,text,text,text,text,integer,numeric
) to authenticated;

alter function public.read_current_operational_memberships(uuid) owner to postgres;
alter function public.save_bottle_inventory_private(
  uuid,uuid,text,text,integer,text,text,text,text,integer,numeric
) owner to postgres;
