-- 0151_inventory_commands.sql
--
-- TER-CF-150 / TER-CF-270..273: one atomic, idempotent command boundary for
-- explicit bottle opening, pours, spills, lifecycle discard, and close-outs.
--
-- `open_bottles` is a reusable slot per (wine_id, restaurant_id), not a
-- physical-bottle identity: migration 0044 revives the same row id and resets
-- opened_at. Close commands therefore compare BOTH id and opened_at while the
-- slot is locked. Operation receipts are durable and transaction-local to the
-- domain write; they intentionally do not reuse the 24-hour scan cache.

create table public.inventory_command_receipts (
  restaurant_id  uuid        not null references public.restaurants(id) on delete cascade,
  operation_id   uuid        not null,
  actor_user_id  uuid        not null references auth.users(id) on delete restrict,
  wine_id         uuid        not null,
  command_type    text        not null check (command_type in ('open', 'pour', 'spill', 'discard', 'close')),
  request_payload jsonb       not null check (jsonb_typeof(request_payload) = 'object'),
  result_payload  jsonb,
  created_at      timestamptz not null default now(),
  completed_at    timestamptz,
  primary key (restaurant_id, operation_id),
  constraint inventory_command_receipts_wine_restaurant_fkey
    foreign key (wine_id, restaurant_id)
    references public.wines(id, restaurant_id) on delete restrict,
  constraint inventory_command_receipts_completion_pair check (
    (result_payload is null) = (completed_at is null)
  ),
  constraint inventory_command_receipts_result_object check (
    result_payload is null or jsonb_typeof(result_payload) = 'object'
  )
);

create index inventory_command_receipts_wine_idx
  on public.inventory_command_receipts (wine_id, restaurant_id, created_at desc);
create index inventory_command_receipts_actor_idx
  on public.inventory_command_receipts (actor_user_id, created_at desc);

comment on table public.inventory_command_receipts is
  'Durable, immutable receipts for open/pour/spill/discard/close commands. The primary '
  'key scopes an operation UUID to a restaurant; execute_inventory_command '
  'binds it to the current actor and a canonical payload before mutating stock.';

alter table public.inventory_command_receipts enable row level security;

-- No authenticated table policy: callers replay through the RPC, which first
-- revalidates current membership and then compares actor + canonical payload.
revoke all on table public.inventory_command_receipts from public, anon, authenticated;

-- C02 commands can emit more than one pour/spill row when service crosses a
-- physical-bottle boundary. The legacy undo RPC reverses one event, so it must
-- refuse those commands atomically rather than crediting a replacement bottle
-- or partially reversing one service action. Single-event legacy and command
-- pours remain reversible while they still belong to the current lifecycle.
create or replace function public.undo_last_pour(
  p_wine_id uuid
) returns public.open_bottles
language plpgsql
security definer
set search_path = public
as $$
declare
  v_restaurant_id uuid;
  v_event         public.pour_events%rowtype;
  v_current       public.open_bottles%rowtype;
  v_user          uuid := auth.uid();
  v_receipt_result jsonb;
  v_chunk_count    int;
begin
  select restaurant_id into v_restaurant_id
    from public.wines where id = p_wine_id;
  if v_restaurant_id is null then
    raise exception 'wine not found';
  end if;

  if not public.is_member_with_role(v_restaurant_id, 'staff') then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  -- Match execute_inventory_command's wine -> lifecycle lock order. NO KEY
  -- UPDATE still serializes C02 writers, but remains compatible with the
  -- wines FK KEY SHARE taken by legacy slot-first event writers during the
  -- expand/contract transition.
  perform 1
    from public.wines w
   where w.id = p_wine_id
     and w.restaurant_id = v_restaurant_id
   for no key update;
  if not found then
    raise exception 'wine not found';
  end if;

  select * into v_current
    from public.open_bottles
    where wine_id = p_wine_id and restaurant_id = v_restaurant_id
    for update;
  if not found then
    raise exception 'no open bottle found to restore for wine %', p_wine_id;
  end if;

  select * into v_event
    from public.pour_events
    where wine_id = p_wine_id
      and restaurant_id = v_restaurant_id
      and kind in ('pour', 'spill')
      and open_bottle_id is not null
    order by occurred_at desc, id desc
    limit 1
    for update;
  if not found then
    raise exception 'no recent pour to undo';
  end if;

  -- The reusable slot id is not a physical lifecycle identity. An event older
  -- than the slot's current opened_at belongs to a prior bottle and must never
  -- be credited onto the replacement.
  if v_event.occurred_at < v_current.opened_at then
    raise exception 'undo_inventory_command_not_reversible' using errcode = 'P0001';
  end if;

  -- Bound the receipt lookup by indexed tenant + wine columns before checking
  -- the stable event id stored in result_payload.
  select r.result_payload into v_receipt_result
    from public.inventory_command_receipts r
    where r.restaurant_id = v_restaurant_id
      and r.wine_id = p_wine_id
      and r.command_type in ('pour', 'spill')
      and r.result_payload is not null
      and r.result_payload -> 'pour_event_ids' @> jsonb_build_array(v_event.id)
    order by r.created_at desc
    limit 1;

  if found then
    select count(*)::int into v_chunk_count
      from jsonb_array_elements_text(v_receipt_result -> 'pour_event_ids') event_id
      join public.pour_events pe on pe.id = event_id.value::uuid
     where pe.kind in ('pour', 'spill');
    if v_chunk_count > 1 then
      raise exception 'undo_inventory_command_not_reversible' using errcode = 'P0001';
    end if;
  end if;

  delete from public.pour_events where id = v_event.id;

  insert into public.availability_events
    (wine_id, restaurant_id, direction, user_id, note)
  values
    (p_wine_id, v_restaurant_id, 'restored', v_user,
     'undo pour: ' || v_event.ml_delta || 'ml restored');

  select * into v_current
    from public.open_bottles
    where wine_id = p_wine_id and restaurant_id = v_restaurant_id;
  return v_current;
end;
$$;

grant execute on function public.undo_last_pour(uuid) to authenticated;

create or replace function public.execute_inventory_command(
  p_operation_id             uuid,
  p_restaurant_id            uuid,
  p_command                  text,
  p_wine_id                  uuid,
  p_ml                       int default null,
  p_note                     text default null,
  p_preservation_method      text default null,
  p_expected_open_bottle_id  uuid default null,
  p_expected_opened_at       timestamptz default null,
  p_actual_remaining_ml      int default null,
  p_written_off_ml           int default 0,
  p_reason_code_id           uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user                 uuid := auth.uid();
  v_size_ml              int;
  v_note                  text := nullif(btrim(p_note), '');
  v_preservation          text;
  v_request               jsonb;
  v_receipt               public.inventory_command_receipts%rowtype;
  v_claimed_operation     uuid;
  v_current               public.open_bottles%rowtype;
  v_slot_exists           boolean := false;
  v_sealed_item           public.inventory_items%rowtype;
  v_previous_opened_at    timestamptz;
  v_new_opened_at         timestamptz;
  v_event_at              timestamptz;
  v_last_event_at         timestamptz;
  v_remaining_to_consume  int;
  v_chunk                 int;
  v_event_id              uuid;
  v_event_ids             uuid[] := array[]::uuid[];
  v_closeout              public.bottle_closeouts%rowtype;
  v_result                jsonb;
begin
  if v_user is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_operation_id is null
     or p_restaurant_id is null
     or p_wine_id is null
     or p_command is null
     or p_command not in ('open', 'pour', 'spill', 'discard', 'close') then
    raise exception 'invalid_inventory_command' using errcode = 'P0001';
  end if;
  if v_note is not null and char_length(v_note) > 500 then
    raise exception 'invalid_inventory_command' using errcode = 'P0001';
  end if;
  if p_preservation_method is not null
     and p_preservation_method not in ('coravin', 'argon', 'vacuum', 'none') then
    raise exception 'invalid_inventory_command' using errcode = 'P0001';
  end if;

  -- Every call, including replay, must still be authorized. FOR SHARE prevents
  -- a membership delete/role change from committing beside this command.
  perform 1
    from public.memberships m
   where m.user_id = v_user
     and m.restaurant_id = p_restaurant_id
     and m.role in ('owner', 'manager', 'staff')
   for share;
  if not found then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  -- Stable serialization point even when no open_bottles row exists yet.
  -- NO KEY UPDATE serializes C02 writers without deadlocking legacy writers
  -- that lock the bottle slot first and then take a wine FK KEY SHARE.
  select w.size_ml
    into v_size_ml
    from public.wines w
   where w.id = p_wine_id
     and w.restaurant_id = p_restaurant_id
   for no key update;
  if not found then
    raise exception 'wine_not_found' using errcode = 'P0001';
  end if;

  -- Reject irrelevant fields rather than silently giving two requests the same
  -- physical effect under different payloads.
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
       or p_written_off_ml > p_actual_remaining_ml then
      if p_actual_remaining_ml is not null
         and p_actual_remaining_ml < 0 then
        raise exception 'invalid_actual_remaining' using errcode = 'P0001';
      end if;
      if p_written_off_ml is not null
         and p_actual_remaining_ml is not null
         and (p_written_off_ml < 0 or p_written_off_ml > p_actual_remaining_ml) then
        raise exception 'invalid_writeoff_amount' using errcode = 'P0001';
      end if;
      raise exception 'invalid_inventory_command' using errcode = 'P0001';
    end if;
    if p_written_off_ml > 0 and p_reason_code_id is null then
      raise exception 'writeoff_reason_required' using errcode = 'P0001';
    end if;
  end if;

  v_request := jsonb_build_object(
    'version', 1,
    'command', p_command,
    'wine_id', p_wine_id,
    'ml', p_ml,
    'note', v_note,
    'preservation_method', case when p_command = 'open' then v_preservation else p_preservation_method end,
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

  -- The unique insert blocks a concurrent retry until the first transaction
  -- commits or aborts. An exception later rolls back both this claim and every
  -- domain mutation made below.
  insert into public.inventory_command_receipts (
    restaurant_id, operation_id, actor_user_id, wine_id, command_type,
    request_payload
  ) values (
    p_restaurant_id, p_operation_id, v_user, p_wine_id, p_command, v_request
  )
  on conflict (restaurant_id, operation_id) do nothing
  returning operation_id into v_claimed_operation;

  if v_claimed_operation is null then
    select *
      into v_receipt
      from public.inventory_command_receipts r
     where r.restaurant_id = p_restaurant_id
       and r.operation_id = p_operation_id;

    if not found or v_receipt.result_payload is null then
      raise exception 'inventory_operation_incomplete' using errcode = 'P0001';
    end if;
    if v_receipt.actor_user_id is distinct from v_user then
      raise exception 'inventory_operation_actor_conflict' using errcode = 'P0001';
    end if;
    if v_receipt.wine_id is distinct from p_wine_id
       or v_receipt.command_type is distinct from p_command
       or v_receipt.request_payload is distinct from v_request then
      raise exception 'inventory_operation_payload_conflict' using errcode = 'P0001';
    end if;

    return v_receipt.result_payload || jsonb_build_object('replayed', true);
  end if;

  -- Mutable wine attributes constrain only a fresh execution. A completed
  -- receipt remains exactly replayable if the wine's configured size changes
  -- later; current membership and wine identity were still revalidated above.
  if v_size_ml is null or v_size_ml <= 0 then
    raise exception 'wine_size_unknown' using errcode = 'P0001';
  end if;
  if p_command = 'close' and p_actual_remaining_ml > v_size_ml then
    raise exception 'invalid_actual_remaining' using errcode = 'P0001';
  end if;

  -- Lock the reusable slot, active or closed. A missing row is safe because
  -- the wine lock above serializes every command for this wine.
  select *
    into v_current
    from public.open_bottles ob
   where ob.wine_id = p_wine_id
     and ob.restaurant_id = p_restaurant_id
   for update;
  v_slot_exists := found;

  if p_command = 'open' then
    if v_slot_exists and v_current.closed_at is null then
      raise exception 'open_bottle_already_open' using errcode = 'P0001';
    end if;

    v_previous_opened_at := case
      when v_slot_exists then greatest(v_current.opened_at, v_current.closed_at)
      else null
    end;

    select *
      into v_sealed_item
      from public.inventory_items ii
     where ii.wine_id = p_wine_id
       and ii.restaurant_id = p_restaurant_id
       and ii.quantity > 0
     order by ii.added_at asc, ii.id asc
     limit 1
     for update;
    if not found then
      raise exception 'no_inventory' using errcode = 'P0001';
    end if;

    update public.inventory_items
       set quantity = quantity - 1
     where id = v_sealed_item.id;

    v_new_opened_at := clock_timestamp();
    if v_previous_opened_at is not null and v_new_opened_at <= v_previous_opened_at then
      v_new_opened_at := v_previous_opened_at + interval '1 microsecond';
    end if;

    insert into public.pour_events (
      wine_id, restaurant_id, ml_delta, kind, actor_user_id, note, occurred_at
    ) values (
      p_wine_id, p_restaurant_id, -v_size_ml, 'new_bottle', v_user, v_note,
      v_new_opened_at
    ) returning id into v_event_id;
    v_event_ids := array_append(v_event_ids, v_event_id);
    v_last_event_at := v_new_opened_at;

    update public.open_bottles
       set opened_at = v_new_opened_at,
           preservation_method = v_preservation,
           source_inventory_item_id = v_sealed_item.id
     where wine_id = p_wine_id
       and restaurant_id = p_restaurant_id
    returning * into v_current;

    v_result := jsonb_build_object(
      'operation_id', p_operation_id,
      'command', p_command,
      'pour_event_ids', to_jsonb(v_event_ids),
      'open_bottle', to_jsonb(v_current)
    );

  elsif p_command in ('pour', 'spill') then
    if p_expected_open_bottle_id is not null and (
      not v_slot_exists
      or v_current.closed_at is not null
      or v_current.id is distinct from p_expected_open_bottle_id
      or v_current.opened_at is distinct from p_expected_opened_at
    ) then
      raise exception 'open_bottle_changed' using errcode = 'P0001';
    end if;

    v_remaining_to_consume := p_ml;

    while v_remaining_to_consume > 0 loop
      if not v_slot_exists or v_current.closed_at is not null then
        v_previous_opened_at := case
          when v_slot_exists then greatest(v_current.opened_at, v_current.closed_at)
          else null
        end;

        select *
          into v_sealed_item
          from public.inventory_items ii
         where ii.wine_id = p_wine_id
           and ii.restaurant_id = p_restaurant_id
           and ii.quantity > 0
         order by ii.added_at asc, ii.id asc
         limit 1
         for update;
        if not found then
          raise exception 'no_inventory' using errcode = 'P0001';
        end if;

        update public.inventory_items
           set quantity = quantity - 1
         where id = v_sealed_item.id;

        v_new_opened_at := clock_timestamp();
        if v_previous_opened_at is not null and v_new_opened_at <= v_previous_opened_at then
          v_new_opened_at := v_previous_opened_at + interval '1 microsecond';
        end if;
        if v_last_event_at is not null and v_new_opened_at <= v_last_event_at then
          v_new_opened_at := v_last_event_at + interval '1 microsecond';
        end if;

        insert into public.pour_events (
          wine_id, restaurant_id, ml_delta, kind, actor_user_id, note, occurred_at
        ) values (
          p_wine_id, p_restaurant_id, -v_size_ml, 'new_bottle', v_user, v_note,
          v_new_opened_at
        ) returning id into v_event_id;
        v_event_ids := array_append(v_event_ids, v_event_id);
        v_last_event_at := v_new_opened_at;

        update public.open_bottles
           set opened_at = v_new_opened_at,
               preservation_method = coalesce(v_preservation, 'none'),
               source_inventory_item_id = v_sealed_item.id
         where wine_id = p_wine_id
           and restaurant_id = p_restaurant_id
        returning * into v_current;
        v_slot_exists := true;
      end if;

      if v_current.remaining_ml <= 0 then
        raise exception 'invalid_open_bottle_state' using errcode = 'P0001';
      end if;

      v_chunk := least(v_current.remaining_ml, v_remaining_to_consume);
      v_event_at := clock_timestamp();
      if v_event_at <= v_current.opened_at then
        v_event_at := v_current.opened_at + interval '1 microsecond';
      end if;
      if v_last_event_at is not null and v_event_at <= v_last_event_at then
        v_event_at := v_last_event_at + interval '1 microsecond';
      end if;
      insert into public.pour_events (
        wine_id, restaurant_id, open_bottle_id, ml_delta, kind,
        actor_user_id, note, occurred_at
      ) values (
        p_wine_id, p_restaurant_id, v_current.id, v_chunk, p_command,
        v_user, v_note, v_event_at
      ) returning id into v_event_id;
      v_event_ids := array_append(v_event_ids, v_event_id);
      v_last_event_at := v_event_at;

      v_remaining_to_consume := v_remaining_to_consume - v_chunk;
      select *
        into v_current
        from public.open_bottles ob
       where ob.wine_id = p_wine_id
         and ob.restaurant_id = p_restaurant_id;
      if v_current.remaining_ml = 0 then
        update public.open_bottles
           set closed_at = v_event_at
         where id = v_current.id
           and opened_at = v_current.opened_at
        returning * into v_current;
      end if;
    end loop;

    -- Preservation belongs to the final affected lifecycle. This update is
    -- transactionally coupled to the pour even when that lifecycle just closed.
    if v_preservation is not null then
      update public.open_bottles
         set preservation_method = v_preservation
       where id = v_current.id
         and opened_at = v_current.opened_at
      returning * into v_current;
    end if;

    v_result := jsonb_build_object(
      'operation_id', p_operation_id,
      'command', p_command,
      'pour_event_ids', to_jsonb(v_event_ids),
      'open_bottle', to_jsonb(v_current)
    );

  elsif p_command = 'discard' then
    if not v_slot_exists
       or v_current.id is distinct from p_expected_open_bottle_id
       or v_current.opened_at is distinct from p_expected_opened_at then
      raise exception 'open_bottle_changed' using errcode = 'P0001';
    end if;
    if v_current.closed_at is not null then
      raise exception 'open_bottle_already_closed' using errcode = 'P0001';
    end if;

    v_event_at := clock_timestamp();
    if v_event_at <= v_current.opened_at then
      v_event_at := v_current.opened_at + interval '1 microsecond';
    end if;
    insert into public.pour_events (
      wine_id, restaurant_id, open_bottle_id, ml_delta, kind,
      actor_user_id, note, occurred_at
    ) values (
      p_wine_id, p_restaurant_id, v_current.id, v_current.remaining_ml,
      'spill', v_user, coalesce(v_note, 'Bottle discarded'), v_event_at
    ) returning id into v_event_id;
    v_event_ids := array_append(v_event_ids, v_event_id);

    update public.open_bottles
       set closed_at = v_event_at
     where id = p_expected_open_bottle_id
       and opened_at = p_expected_opened_at
       and remaining_ml = 0
    returning * into v_current;

    v_result := jsonb_build_object(
      'operation_id', p_operation_id,
      'command', p_command,
      'pour_event_ids', to_jsonb(v_event_ids),
      'open_bottle', to_jsonb(v_current)
    );

  else
    if not v_slot_exists
       or v_current.closed_at is not null
       or v_current.id is distinct from p_expected_open_bottle_id
       or v_current.opened_at is distinct from p_expected_opened_at then
      raise exception 'open_bottle_changed' using errcode = 'P0001';
    end if;

    if p_reason_code_id is not null then
      perform 1
        from public.reason_codes rc
       where rc.id = p_reason_code_id
         and rc.restaurant_id = p_restaurant_id
         and rc.active
         and rc.category in ('spoilage', 'adjustment')
       for share;
      if not found then
        raise exception 'invalid_reason_code' using errcode = 'P0001';
      end if;
    end if;

    v_event_at := clock_timestamp();
    if v_event_at <= v_current.opened_at then
      v_event_at := v_current.opened_at + interval '1 microsecond';
    end if;

    insert into public.bottle_closeouts (
      restaurant_id, wine_id, open_bottle_id, preservation_method,
      opened_at, closed_by, closed_at, theoretical_remaining_ml,
      actual_remaining_ml, written_off_ml, reason_code_id
    ) values (
      p_restaurant_id, p_wine_id, v_current.id, v_current.preservation_method,
      v_current.opened_at, v_user, v_event_at, v_current.remaining_ml,
      p_actual_remaining_ml, p_written_off_ml, p_reason_code_id
    ) returning * into v_closeout;

    insert into public.pour_events (
      wine_id, restaurant_id, open_bottle_id, ml_delta, kind,
      actor_user_id, note, occurred_at
    ) values (
      p_wine_id, p_restaurant_id, v_current.id, v_current.remaining_ml,
      'finish_bottle', v_user, coalesce(v_note, 'Bottle close-out'), v_event_at
    ) returning id into v_event_id;
    v_event_ids := array_append(v_event_ids, v_event_id);

    update public.open_bottles
       set closed_at = v_event_at
     where id = p_expected_open_bottle_id
       and opened_at = p_expected_opened_at
       and remaining_ml = 0
    returning * into v_current;

    v_result := jsonb_build_object(
      'operation_id', p_operation_id,
      'command', p_command,
      'pour_event_ids', to_jsonb(v_event_ids),
      'open_bottle', to_jsonb(v_current),
      'closeout', to_jsonb(v_closeout)
    );
  end if;

  update public.inventory_command_receipts
     set result_payload = v_result,
         completed_at = clock_timestamp()
   where restaurant_id = p_restaurant_id
     and operation_id = p_operation_id
     and result_payload is null;

  if not found then
    raise exception 'inventory_operation_incomplete' using errcode = 'P0001';
  end if;

  return v_result || jsonb_build_object('replayed', false);
end;
$$;

comment on function public.execute_inventory_command(
  uuid, uuid, text, uuid, int, text, text, uuid, timestamptz, int, int, uuid
) is
  'Atomic TER-CF-150 open/pour/spill/discard/close command. Revalidates current '
  'membership before replay, binds operation UUID to actor and canonical '
  'payload, serializes per wine, and rejects stale bottle lifecycle versions.';

revoke execute on function public.execute_inventory_command(
  uuid, uuid, text, uuid, int, text, text, uuid, timestamptz, int, int, uuid
) from public, anon;
grant execute on function public.execute_inventory_command(
  uuid, uuid, text, uuid, int, text, text, uuid, timestamptz, int, int, uuid
) to authenticated;
