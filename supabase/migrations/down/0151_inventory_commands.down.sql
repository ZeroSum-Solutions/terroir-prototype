-- Reverse 0151_inventory_commands.sql.
--
-- Receipt rows are the durable replay boundary for already-committed physical
-- effects. Dropping them while retaining those effects would make a retried
-- operation execute twice. Refuse the entire down atomically when any receipt
-- exists; an operator must retain/reconcile that data in a separate reviewed
-- migration before this rollback is safe.

begin;

lock table public.inventory_command_receipts in access exclusive mode;

do $guard$
begin
  if exists (select 1 from public.inventory_command_receipts limit 1) then
    raise exception 'cannot_down_0151_inventory_command_receipts_not_empty'
      using errcode = 'P0001';
  end if;
end;
$guard$;

drop function if exists public.execute_inventory_command(
  uuid, uuid, text, uuid, int, text, text, uuid, timestamptz, int, int, uuid
);

-- Restore the exact 0088 single-event implementation. Its command-aware
-- guards depend on inventory_command_receipts and cannot survive the table
-- removal below.
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
begin
  -- Auth check: must be a member of this wine's restaurant.
  select restaurant_id into v_restaurant_id
    from public.wines where id = p_wine_id;
  if v_restaurant_id is null then
    raise exception 'wine not found';
  end if;

  if not public.is_member_with_role(v_restaurant_id, 'staff') then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  -- Find the most recent pour or spill event for this wine
  -- that has an open_bottle_id (i.e., was recorded against a specific bottle).
  select * into v_event
    from public.pour_events
    where wine_id = p_wine_id
      and restaurant_id = v_restaurant_id
      and kind in ('pour', 'spill')
      and open_bottle_id is not null
    order by occurred_at desc
    limit 1
    for update;

  if not found then
    raise exception 'no recent pour to undo';
  end if;

  -- Lock the current open_bottles row. C22 (db audit 2026-08-23): this
  -- row is not manually updated any more — the AFTER DELETE trigger
  -- (pour_events_reverse_open_bottle, 0050) is the sole reversal
  -- mechanism, fired by the delete below. Locking it here still
  -- serializes concurrent undo/pour calls on the same bottle.
  select * into v_current
    from public.open_bottles
    where wine_id = p_wine_id and restaurant_id = v_restaurant_id
    for update;

  if not found then
    -- Verified unreachable in the current schema (see migration 0088)
    -- — fail loudly rather than silently recreate a row the trigger
    -- below has nothing to reverse against.
    raise exception 'no open bottle found to restore for wine %', p_wine_id;
  end if;

  -- Delete the pour event (the undo action). The AFTER DELETE trigger
  -- (0050) reverses OLD.ml_delta back onto open_bottles.remaining_ml.
  delete from public.pour_events
    where id = v_event.id;

  -- Insert an availability event to record the undo.
  insert into public.availability_events
    (wine_id, restaurant_id, direction, user_id, note)
  values
    (p_wine_id, v_restaurant_id, 'restored', v_user, 'undo pour: ' || v_event.ml_delta || 'ml restored');

  -- Return the updated open_bottles row.
  select * into v_current
    from public.open_bottles
    where wine_id = p_wine_id and restaurant_id = v_restaurant_id;
  return v_current;
end;
$$;

grant execute on function public.undo_last_pour(uuid) to authenticated;

drop table if exists public.inventory_command_receipts;

commit;
