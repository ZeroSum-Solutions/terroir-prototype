-- 0158_staff_operational_bridge.down.sql
--
-- Roll back the application first and keep bottle receiving drained. This
-- down refuses durable version-3 history; it never deletes business evidence.

do $down_admission$
begin
  if to_regprocedure('public.read_current_operational_memberships(uuid)') is null
     or to_regprocedure('public.save_bottle_inventory_private(uuid,uuid,text,text,integer,text,text,text,text,integer,numeric)') is null then
    raise exception 'C04_0158_DOWN_REQUIRES_APPLIED_BRIDGE' using errcode = 'P0001';
  end if;
end;
$down_admission$;

lock table public.scan_idempotency in share row exclusive mode nowait;
lock table public.inventory_command_receipts in access exclusive mode nowait;

do $durable_history_guard$
begin
  if exists (
    select 1 from public.inventory_command_receipts r
     where r.command_version = 3
  ) then
    raise exception 'C04_0158_DOWN_REFUSES_DURABLE_HISTORY' using errcode = 'P0001';
  end if;
end;
$durable_history_guard$;

drop function public.save_bottle_inventory_private(
  uuid,uuid,text,text,integer,text,text,text,text,integer,numeric
);
drop function public.read_current_operational_memberships(uuid);

alter table public.inventory_command_receipts
  drop constraint inventory_command_receipts_command_version_check,
  drop constraint inventory_command_receipts_command_type_check,
  drop constraint inventory_command_receipts_versioned_shape_check,
  add constraint inventory_command_receipts_command_version_check
    check (command_version in (1, 2)),
  add constraint inventory_command_receipts_command_type_check check (
    command_type in (
      'open', 'pour', 'spill', 'discard', 'close', 'reconcile_batch', 'undo'
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
  );
