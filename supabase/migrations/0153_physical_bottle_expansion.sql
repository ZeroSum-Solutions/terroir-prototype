-- 0153_physical_bottle_expansion.sql
--
-- TER-CF-298..315, Phase A only: additive physical-bottle schema, dormant
-- version-2 writers, tenant-invoker readers, and a closed effect resolver.
-- The legacy one-slot-per-wine contract and every legacy writer remain active.
--
-- Apply in one explicit transaction. The five ACCESS EXCLUSIVE NOWAIT locks
-- are intentionally acquired before any mutable ownership, privilege, row, or
-- relationship check. This is a maintenance-window migration, not a
-- zero-downtime migration. A standalone operator preflight does not reserve
-- this window: this migration repeats every mutable check after taking the
-- locks and holds them through commit or rollback.

do $static_admission$
declare
  v_name text;
  v_present_column_pair_count integer := 0;
  v_present_object_count integer := 0;
  v_present_constraint_identity_count integer := 0;
  v_present_index_identity_count integer := 0;
  v_phase_state text;
begin
  foreach v_name in array array[
    'inventory_items',
    'open_bottles',
    'pour_events',
    'bottle_closeouts',
    'inventory_command_receipts'
  ] loop
    if to_regclass('public.' || v_name) is null then
      raise exception 'C06_REQUIRED_TABLE_MISSING: %', v_name using errcode = 'P0001';
    end if;
  end loop;

  select count(*) into v_present_object_count
    from (values
      -- C06_PHASE_A_OBJECT_IDENTITIES_BEGIN
      (to_regclass('public.inventory_command_bottle_effects') is not null),
      (to_regclass('public.effective_service_pour_events') is not null),
      (to_regprocedure('public.current_inventory_contract_version()') is not null),
      (to_regprocedure('public.execute_physical_bottle_command(uuid,uuid,text,uuid,uuid,uuid,integer,text,text,integer,integer,uuid,uuid,text,boolean)') is not null),
      (to_regprocedure('public.execute_physical_reconciliation_batch(uuid,uuid,jsonb)') is not null),
      (to_regprocedure('public.list_active_physical_bottles(uuid)') is not null),
      (to_regprocedure('public.list_open_bottle_aggregates(uuid)') is not null)
      -- C06_PHASE_A_OBJECT_IDENTITIES_END
    ) expected(occupied)
   where occupied;

  select count(*) into v_present_column_pair_count
    from (values
      -- C06_PHASE_A_COLUMN_PAIRS_BEGIN
      ('public.open_bottles'::regclass, 'identity_contract'),
      ('public.open_bottles'::regclass, 'identity_origin'),
      ('public.open_bottles'::regclass, 'nominal_capacity_ml'),
      ('public.open_bottles'::regclass, 'source_provenance'),
      ('public.open_bottles'::regclass, 'opening_operation_id'),
      ('public.open_bottles'::regclass, 'state_version'),
      ('public.inventory_command_receipts'::regclass, 'command_version'),
      ('public.inventory_command_receipts'::regclass, 'scope_kind'),
      ('public.inventory_command_receipts'::regclass, 'batch_entry_count'),
      ('public.pour_events'::regclass, 'event_contract'),
      ('public.pour_events'::regclass, 'operation_id'),
      ('public.pour_events'::regclass, 'operation_entry_ordinal'),
      ('public.pour_events'::regclass, 'reversal_of_event_id'),
      ('public.bottle_closeouts'::regclass, 'event_contract')
      -- C06_PHASE_A_COLUMN_PAIRS_END
    ) expected(relid, attname)
    join pg_catalog.pg_attribute a
      on a.attrelid = expected.relid
     and a.attname = expected.attname
     and a.attnum > 0
     and not a.attisdropped;

  select count(*) into v_present_constraint_identity_count
    from (values
      -- C06_PHASE_A_CONSTRAINT_IDENTITIES_BEGIN
      ('public.inventory_items'::regclass, 'inventory_items_id_restaurant_wine_key'),
      ('public.open_bottles'::regclass, 'open_bottles_id_restaurant_wine_key'),
      ('public.open_bottles'::regclass, 'open_bottles_identity_contract_check'),
      ('public.open_bottles'::regclass, 'open_bottles_identity_origin_check'),
      ('public.open_bottles'::regclass, 'open_bottles_nominal_capacity_check'),
      ('public.open_bottles'::regclass, 'open_bottles_source_provenance_check'),
      ('public.open_bottles'::regclass, 'open_bottles_state_version_check'),
      ('public.open_bottles'::regclass, 'open_bottles_physical_shape_check'),
      ('public.inventory_command_receipts'::regclass, 'inventory_command_receipts_command_version_check'),
      ('public.inventory_command_receipts'::regclass, 'inventory_command_receipts_scope_kind_check'),
      ('public.inventory_command_receipts'::regclass, 'inventory_command_receipts_batch_entry_count_check'),
      ('public.inventory_command_receipts'::regclass, 'inventory_command_receipts_versioned_shape_check'),
      ('public.pour_events'::regclass, 'pour_events_event_contract_check'),
      ('public.pour_events'::regclass, 'pour_events_operation_entry_ordinal_check'),
      ('public.pour_events'::regclass, 'pour_events_open_bottle_tenant_wine_fkey'),
      ('public.pour_events'::regclass, 'pour_events_operation_receipt_fkey'),
      ('public.pour_events'::regclass, 'pour_events_reversal_of_event_fkey'),
      ('public.pour_events'::regclass, 'pour_events_physical_shape_check'),
      ('public.bottle_closeouts'::regclass, 'bottle_closeouts_event_contract_check'),
      ('public.bottle_closeouts'::regclass, 'bottle_closeouts_open_bottle_tenant_wine_fkey'),
      ('public.bottle_closeouts'::regclass, 'bottle_closeouts_physical_shape_check')
      -- C06_PHASE_A_CONSTRAINT_IDENTITIES_END
    ) expected(relid, conname)
    join pg_catalog.pg_constraint c
      on c.conrelid = expected.relid
     and c.conname = expected.conname;

  select count(*) into v_present_index_identity_count
    from (values
      -- C06_PHASE_A_INDEX_IDENTITIES_BEGIN
      ('public.pour_events_operation_entry_key'),
      ('public.pour_events_reversal_key'),
      ('public.pour_events_open_bottle_tenant_wine_idx'),
      ('public.bottle_closeouts_open_bottle_tenant_wine_idx')
      -- C06_PHASE_A_INDEX_IDENTITIES_END
    ) expected(identity)
   where to_regclass(expected.identity) is not null;

  -- Pristine means none of the four exact collision classes is occupied.
  -- Complete identity also requires the 21 newly named constraints and four
  -- indexes on pre-existing relations. Two legacy constraints are replaced
  -- in place and are validated separately; the new table owns its definitions.
  -- C06_PHASE_A_STATE_CLASSIFIER_BEGIN
  v_phase_state := case
    when v_present_column_pair_count = 0
      and v_present_object_count = 0
      and v_present_constraint_identity_count = 0
      and v_present_index_identity_count = 0
      then 'pristine'
    when v_present_column_pair_count = 14
      and v_present_object_count = 7
      and v_present_constraint_identity_count = 21
      and v_present_index_identity_count = 4
      then 'complete_identity'
    else 'partial_mixed'
  end;
  -- C06_PHASE_A_STATE_CLASSIFIER_END

  if v_phase_state = 'complete_identity' then
    raise exception 'C06_0153_ALREADY_APPLIED' using errcode = 'P0001';
  elsif v_phase_state = 'partial_mixed' then
    raise exception 'C06_0153_PARTIAL_STATE' using errcode = 'P0001';
  end if;
end;
$static_admission$;

lock table public.inventory_items in access exclusive mode nowait;
lock table public.open_bottles in access exclusive mode nowait;
lock table public.pour_events in access exclusive mode nowait;
lock table public.bottle_closeouts in access exclusive mode nowait;
lock table public.inventory_command_receipts in access exclusive mode nowait;

do $locked_preflight$
declare
  v_current_role_oid oid;
  v_table record;
  v_table_count int := 0;
begin
  select oid into strict v_current_role_oid
    from pg_catalog.pg_roles
   where rolname = current_user;

  for v_table in
    select c.oid::regclass::text as identity, c.relowner
      from pg_catalog.pg_class c
      join pg_catalog.pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and c.relname in (
         'inventory_items', 'open_bottles', 'pour_events',
         'bottle_closeouts', 'inventory_command_receipts'
       )
       and c.relkind in ('r', 'p')
  loop
    v_table_count := v_table_count + 1;
    if v_table.relowner <> v_current_role_oid then
      raise exception 'C06_OPERATOR_NOT_DIRECT_OWNER: %', v_table.identity
        using errcode = 'P0001';
    end if;
    if not has_table_privilege(current_user, v_table.identity, 'REFERENCES') then
      raise exception 'C06_OPERATOR_MISSING_REFERENCES: %', v_table.identity
        using errcode = 'P0001';
    end if;
  end loop;
  if v_table_count <> 5 then
    raise exception 'C06_REQUIRED_TABLE_SHAPE_MISMATCH' using errcode = 'P0001';
  end if;

  if not has_schema_privilege(current_user, 'public', 'USAGE')
     or not has_schema_privilege(current_user, 'public', 'CREATE') then
    raise exception 'C06_OPERATOR_MISSING_PUBLIC_SCHEMA_AUTHORITY' using errcode = 'P0001';
  end if;
  if not has_schema_privilege(current_user, 'auth', 'USAGE')
     or not has_function_privilege(current_user, 'auth.uid()', 'EXECUTE') then
    raise exception 'C06_OPERATOR_MISSING_AUTH_UID_AUTHORITY' using errcode = 'P0001';
  end if;
  if not has_type_privilege(current_user, 'public.membership_role', 'USAGE')
     or not has_language_privilege(current_user, 'sql', 'USAGE')
     or not has_language_privilege(current_user, 'plpgsql', 'USAGE') then
    raise exception 'C06_OPERATOR_MISSING_TYPE_OR_LANGUAGE_AUTHORITY' using errcode = 'P0001';
  end if;

  if not exists (
    select 1
      from pg_catalog.pg_constraint c
     where c.conrelid = 'public.open_bottles'::regclass
       and c.conname = 'open_bottles_wine_id_restaurant_id_key'
       and c.contype = 'u'
       and not c.condeferrable
       and not c.condeferred
       and (
         select array_agg(a.attname::text order by key.ordinality)
           from unnest(c.conkey) with ordinality key(attnum, ordinality)
           join pg_catalog.pg_attribute a
             on a.attrelid = c.conrelid and a.attnum = key.attnum
       ) = array['wine_id', 'restaurant_id']
  )
     or not exists (
       select 1
         from pg_catalog.pg_constraint c
        where c.conrelid = 'public.open_bottles'::regclass
          and c.conname = 'open_bottles_source_inventory_item_id_fkey'
          and c.contype = 'f'
          and c.confrelid = 'public.inventory_items'::regclass
          and c.confdeltype = 'n'
          and not c.condeferrable
          and pg_catalog.pg_get_constraintdef(c.oid, true) =
            'FOREIGN KEY (source_inventory_item_id) REFERENCES inventory_items(id) ON DELETE SET NULL'
     )
     or not exists (
       select 1 from pg_catalog.pg_constraint c
        where c.conrelid = 'public.pour_events'::regclass
          and c.conname = 'pour_events_open_bottle_id_fkey'
          and c.contype = 'f'
          and c.confrelid = 'public.open_bottles'::regclass
          and c.confdeltype = 'n'
          and not c.condeferrable
          and pg_catalog.pg_get_constraintdef(c.oid, true) =
            'FOREIGN KEY (open_bottle_id) REFERENCES open_bottles(id) ON DELETE SET NULL'
     )
     or not exists (
       select 1 from pg_catalog.pg_constraint c
        where c.conrelid = 'public.bottle_closeouts'::regclass
          and c.conname = 'bottle_closeouts_open_bottle_id_fkey'
          and c.contype = 'f'
          and c.confrelid = 'public.open_bottles'::regclass
          and c.confdeltype = 'n'
          and not c.condeferrable
          and pg_catalog.pg_get_constraintdef(c.oid, true) =
            'FOREIGN KEY (open_bottle_id) REFERENCES open_bottles(id) ON DELETE SET NULL'
     )
     or exists (
       select 1
         from (values
           ('public.open_bottles'::regclass, 'open_bottles_remaining_ml_check',
             'CHECK (remaining_ml >= 0)'),
           ('public.open_bottles'::regclass, 'open_bottles_preservation_method_check',
             'CHECK (preservation_method = ANY (ARRAY[''coravin''::text, ''argon''::text, ''vacuum''::text, ''none''::text]))'),
           ('public.pour_events'::regclass, 'pour_events_kind_check',
             'CHECK (kind = ANY (ARRAY[''pour''::text, ''spill''::text, ''reconcile''::text, ''new_bottle''::text, ''finish_bottle''::text]))'),
           ('public.bottle_closeouts'::regclass, 'bottle_closeouts_writeoff_requires_reason',
             'CHECK (written_off_ml = 0 OR reason_code_id IS NOT NULL)'),
           ('public.inventory_command_receipts'::regclass, 'inventory_command_receipts_completion_pair',
             'CHECK ((result_payload IS NULL) = (completed_at IS NULL))'),
           ('public.inventory_command_receipts'::regclass, 'inventory_command_receipts_result_object',
             'CHECK (result_payload IS NULL OR jsonb_typeof(result_payload) = ''object''::text)'),
           ('public.inventory_command_receipts'::regclass, 'inventory_command_receipts_command_type_check',
             'CHECK (command_type = ANY (ARRAY[''open''::text, ''pour''::text, ''spill''::text, ''discard''::text, ''close''::text]))')
         ) expected(relid, conname, definition)
         left join pg_catalog.pg_constraint c
           on c.conrelid = expected.relid
          and c.conname = expected.conname
          and c.contype = 'c'
          and pg_catalog.pg_get_constraintdef(c.oid, true) = expected.definition
        where c.oid is null
     ) then
    raise exception 'C06_LEGACY_CATALOG_MISMATCH' using errcode = 'P0001';
  end if;

  if exists (
    select 1
      from (values
        ('public.pour_events_maintain_open_bottle()'::text, '3c332a9ca14b6d4ceda236fe781d523f', false, null::text),
        ('public.pour_events_reverse_open_bottle()'::text, 'b76aa11a1e25f9619cd2c2f0f3b91578', false, null::text),
        ('public.open_bottles_enforce_capacity()'::text, '3229387cea973b91bdf1d34e1f99b6c8', false, null::text),
        ('public.record_pour(uuid,integer,text,text)'::text, 'a36891d363afca3e15fee2c77b625285', true, 'public'::text),
        ('public.reconcile_open_bottle(uuid,integer,text)'::text, '26824f46b3e8b6c4d0692fe21cb8d246', true, 'public'::text),
        ('public.reconcile_open_bottles_batch(jsonb)'::text, 'fe0ee6e79deb385f655c95aa59bb8806', true, 'public'::text),
        ('public.undo_last_pour(uuid)'::text, 'c213196b31d20f2a556ed6a0623738f4', true, 'public'::text),
        ('public.execute_inventory_command(uuid,uuid,text,uuid,integer,text,text,uuid,timestamp with time zone,integer,integer,uuid)'::text,
          'e94dc3bc06bd5d838bd02e4fefd01353', true, 'public'::text)
      ) expected(identity, body_md5, security_definer, search_path)
      left join pg_catalog.pg_proc p
        on p.oid = to_regprocedure(expected.identity)
     where p.oid is null
        or md5(p.prosrc) <> expected.body_md5
        or p.prosecdef is distinct from expected.security_definer
        or p.provolatile <> 'v'
        or coalesce(p.proconfig, array[]::text[]) is distinct from
          case when expected.search_path is null then array[]::text[]
               else array['search_path=' || expected.search_path]
          end
  ) then
    raise exception 'C06_LEGACY_FUNCTION_MISMATCH' using errcode = 'P0001';
  end if;

  if exists (
    select 1
      from (values
        ('public.pour_events'::regclass, 'pour_events_trigger',
          'public.pour_events_maintain_open_bottle()'::text, 5::smallint),
        ('public.pour_events'::regclass, 'pour_events_delete_trigger',
          'public.pour_events_reverse_open_bottle()'::text, 9::smallint),
        ('public.open_bottles'::regclass, 'open_bottles_enforce_capacity_trigger',
          'public.open_bottles_enforce_capacity()'::text, 23::smallint)
      ) expected(relid, trigger_name, function_identity, trigger_type)
      left join pg_catalog.pg_trigger t
        on t.tgrelid = expected.relid
       and t.tgname = expected.trigger_name
       and t.tgfoid = to_regprocedure(expected.function_identity)
       and t.tgtype = expected.trigger_type
       and t.tgenabled = 'O'
       and not t.tgisinternal
       and t.tgnargs = 0
       and t.tgqual is null
     where t.oid is null
  ) then
    raise exception 'C06_LEGACY_TRIGGER_MISMATCH' using errcode = 'P0001';
  end if;

  if exists (
    select 1
      from public.pour_events pe
      left join public.open_bottles ob on ob.id = pe.open_bottle_id
     where pe.open_bottle_id is not null
       and (
         ob.id is null
         or ob.restaurant_id is distinct from pe.restaurant_id
         or ob.wine_id is distinct from pe.wine_id
       )
  ) then
    raise exception 'C06_POUR_EVENT_BOTTLE_CONTAINMENT_MISMATCH' using errcode = 'P0001';
  end if;

  if exists (
    select 1
      from public.bottle_closeouts bc
      left join public.open_bottles ob on ob.id = bc.open_bottle_id
     where bc.open_bottle_id is not null
       and (
         ob.id is null
         or ob.restaurant_id is distinct from bc.restaurant_id
         or ob.wine_id is distinct from bc.wine_id
       )
  ) then
    raise exception 'C06_CLOSEOUT_BOTTLE_CONTAINMENT_MISMATCH' using errcode = 'P0001';
  end if;

  if exists (
    select 1
      from public.open_bottles ob
      join public.inventory_items ii on ii.id = ob.source_inventory_item_id
     where ob.source_inventory_item_id is not null
       and (
         ii.restaurant_id is distinct from ob.restaurant_id
         or ii.wine_id is distinct from ob.wine_id
       )
  ) then
    raise exception 'C06_SOURCE_LOT_CONTAINMENT_MISMATCH' using errcode = 'P0001';
  end if;
end;
$locked_preflight$;

alter table public.inventory_items
  add constraint inventory_items_id_restaurant_wine_key
  unique (id, restaurant_id, wine_id);

alter table public.open_bottles
  add column identity_contract smallint not null default 1,
  add column identity_origin text not null default 'legacy_slot',
  add column nominal_capacity_ml int,
  add column source_provenance text not null default 'legacy_unknown',
  add column opening_operation_id uuid,
  add column state_version bigint not null default 0,
  add constraint open_bottles_id_restaurant_wine_key
    unique (id, restaurant_id, wine_id),
  add constraint open_bottles_identity_contract_check
    check (identity_contract in (1, 2)),
  add constraint open_bottles_identity_origin_check
    check (identity_origin in ('legacy_slot', 'migrated_active', 'native')),
  add constraint open_bottles_nominal_capacity_check
    check (nominal_capacity_ml is null or nominal_capacity_ml > 0),
  add constraint open_bottles_source_provenance_check
    check (source_provenance in ('known', 'legacy_unknown')),
  add constraint open_bottles_state_version_check
    check (state_version >= 0),
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

alter table public.inventory_command_receipts
  drop constraint inventory_command_receipts_command_type_check,
  alter column wine_id drop not null,
  add column command_version smallint not null default 1,
  add column scope_kind text not null default 'single_wine',
  add column batch_entry_count int,
  add constraint inventory_command_receipts_command_version_check
    check (command_version in (1, 2)),
  add constraint inventory_command_receipts_command_type_check check (
    command_type in (
      'open', 'pour', 'spill', 'discard', 'close', 'reconcile_batch', 'undo'
    )
  ),
  add constraint inventory_command_receipts_scope_kind_check
    check (scope_kind in ('single_wine', 'exact_bottle_batch')),
  add constraint inventory_command_receipts_batch_entry_count_check
    check (batch_entry_count is null or batch_entry_count > 0),
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

alter table public.pour_events
  drop constraint pour_events_open_bottle_id_fkey,
  drop constraint pour_events_kind_check,
  add column event_contract smallint not null default 1,
  add column operation_id uuid,
  add column operation_entry_ordinal int,
  add column reversal_of_event_id uuid,
  add constraint pour_events_kind_check check (
    kind in ('pour', 'spill', 'reconcile', 'new_bottle', 'finish_bottle', 'undo')
  ),
  add constraint pour_events_event_contract_check
    check (event_contract in (1, 2)),
  add constraint pour_events_operation_entry_ordinal_check
    check (operation_entry_ordinal is null or operation_entry_ordinal >= 0),
  add constraint pour_events_open_bottle_tenant_wine_fkey
    foreign key (open_bottle_id, restaurant_id, wine_id)
    references public.open_bottles (id, restaurant_id, wine_id)
    on delete set null (open_bottle_id)
    deferrable initially deferred,
  add constraint pour_events_operation_receipt_fkey
    foreign key (restaurant_id, operation_id)
    references public.inventory_command_receipts (restaurant_id, operation_id)
    on delete restrict
    deferrable initially deferred,
  add constraint pour_events_reversal_of_event_fkey
    foreign key (reversal_of_event_id)
    references public.pour_events (id)
    on delete restrict,
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

create unique index pour_events_operation_entry_key
  on public.pour_events (restaurant_id, operation_id, operation_entry_ordinal)
  where operation_id is not null;
create unique index pour_events_reversal_key
  on public.pour_events (reversal_of_event_id)
  where reversal_of_event_id is not null;
create index pour_events_open_bottle_tenant_wine_idx
  on public.pour_events (open_bottle_id, restaurant_id, wine_id)
  where open_bottle_id is not null;

alter table public.bottle_closeouts
  drop constraint bottle_closeouts_open_bottle_id_fkey,
  add column event_contract smallint not null default 1,
  add constraint bottle_closeouts_event_contract_check
    check (event_contract in (1, 2)),
  add constraint bottle_closeouts_open_bottle_tenant_wine_fkey
    foreign key (open_bottle_id, restaurant_id, wine_id)
    references public.open_bottles (id, restaurant_id, wine_id)
    on delete set null (open_bottle_id)
    deferrable initially deferred,
  add constraint bottle_closeouts_physical_shape_check check (
    event_contract = 1 or open_bottle_id is not null
  ) not valid;

create index bottle_closeouts_open_bottle_tenant_wine_idx
  on public.bottle_closeouts (open_bottle_id, restaurant_id, wine_id);

create table public.inventory_command_bottle_effects (
  restaurant_id uuid not null,
  operation_id uuid not null,
  entry_ordinal int not null check (entry_ordinal >= 0),
  open_bottle_id uuid not null,
  wine_id uuid not null,
  effect_type text not null check (
    effect_type in ('open', 'pour', 'spill', 'reconcile', 'close', 'discard', 'undo')
  ),
  primary key (restaurant_id, operation_id, entry_ordinal),
  constraint inventory_command_bottle_effects_operation_bottle_effect_key
    unique (restaurant_id, operation_id, open_bottle_id, effect_type),
  constraint inventory_command_bottle_effects_receipt_fkey
    foreign key (restaurant_id, operation_id)
    references public.inventory_command_receipts (restaurant_id, operation_id)
    on delete restrict,
  constraint inventory_command_bottle_effects_bottle_fkey
    foreign key (open_bottle_id, restaurant_id, wine_id)
    references public.open_bottles (id, restaurant_id, wine_id)
    on delete restrict
    deferrable initially deferred
);

create unique index inventory_command_bottle_effects_open_operation_key
  on public.inventory_command_bottle_effects (restaurant_id, operation_id)
  where effect_type = 'open';
create index inventory_command_bottle_effects_bottle_idx
  on public.inventory_command_bottle_effects (open_bottle_id, restaurant_id, wine_id);
create index inventory_command_bottle_effects_wine_idx
  on public.inventory_command_bottle_effects (restaurant_id, wine_id, operation_id);

alter table public.inventory_command_bottle_effects enable row level security;
revoke all on table public.inventory_command_bottle_effects
  from public, anon, authenticated, service_role;

create function public.current_inventory_contract_version()
returns smallint
language sql
stable
security invoker
set search_path = ''
as $$ select 1::smallint $$;

revoke all on function public.current_inventory_contract_version()
  from public, anon, service_role;
grant execute on function public.current_inventory_contract_version()
  to authenticated;

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
  v_occurred_at timestamptz := clock_timestamp();
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
      if exists (
        select 1 from public.pour_events pe
         where pe.reversal_of_event_id = v_event.id
      ) then
        raise exception 'undo_already_applied' using errcode = 'P0001';
      end if;
      if exists (
        select 1 from public.pour_events pe
         where pe.open_bottle_id = v_bottle.id
           and pe.id <> v_event.id
           and (pe.occurred_at, pe.id) > (v_event.occurred_at, v_event.id)
      ) or exists (
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

revoke all on function public.execute_physical_bottle_command(
  uuid, uuid, text, uuid, uuid, uuid, int, text, text, int, int, uuid, uuid, text, boolean
) from public, anon, authenticated, service_role;

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
  v_occurred_at timestamptz := clock_timestamp();
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

revoke all on function public.execute_physical_reconciliation_batch(uuid, uuid, jsonb)
  from public, anon, authenticated, service_role;

create function public.list_active_physical_bottles(p_restaurant_id uuid)
returns table (
  id uuid,
  restaurant_id uuid,
  wine_id uuid,
  remaining_ml int,
  nominal_capacity_ml int,
  opened_at timestamptz,
  preservation_method text,
  source_inventory_item_id uuid,
  source_provenance text,
  source_bin_location text,
  identity_contract smallint,
  identity_origin text,
  state_version bigint
)
language sql
stable
security invoker
set search_path = ''
as $function$
  select
    ob.id,
    ob.restaurant_id,
    ob.wine_id,
    ob.remaining_ml,
    ob.nominal_capacity_ml,
    ob.opened_at,
    ob.preservation_method,
    ob.source_inventory_item_id,
    ob.source_provenance,
    ii.bin_location as source_bin_location,
    ob.identity_contract,
    ob.identity_origin,
    ob.state_version
  from public.open_bottles ob
  left join public.inventory_items ii
    on ii.id = ob.source_inventory_item_id
   and ii.restaurant_id = ob.restaurant_id
   and ii.wine_id = ob.wine_id
  where ob.restaurant_id = p_restaurant_id
    and ob.closed_at is null
  order by ob.wine_id, ob.opened_at, ob.id
$function$;

revoke all on function public.list_active_physical_bottles(uuid)
  from public, anon, service_role;
grant execute on function public.list_active_physical_bottles(uuid)
  to authenticated;

create function public.list_open_bottle_aggregates(p_restaurant_id uuid)
returns table (
  wine_id uuid,
  active_bottle_count bigint,
  open_remaining_ml bigint
)
language sql
stable
security invoker
set search_path = ''
as $function$
  select
    ob.wine_id,
    count(*)::bigint as active_bottle_count,
    sum(ob.remaining_ml)::bigint as open_remaining_ml
  from public.open_bottles ob
  where ob.restaurant_id = p_restaurant_id
    and ob.closed_at is null
  group by ob.wine_id
  order by ob.wine_id
$function$;

revoke all on function public.list_open_bottle_aggregates(uuid)
  from public, anon, service_role;
grant execute on function public.list_open_bottle_aggregates(uuid)
  to authenticated;

create view public.effective_service_pour_events
with (security_invoker = true)
as
select
  pe.id,
  pe.wine_id,
  pe.restaurant_id,
  pe.open_bottle_id,
  pe.ml_delta,
  pe.kind,
  pe.actor_user_id,
  pe.occurred_at,
  pe.note,
  pe.event_contract,
  pe.operation_id,
  pe.operation_entry_ordinal
from public.pour_events pe
where not (pe.event_contract = 2 and pe.kind = 'undo')
  and not (
    pe.event_contract = 2
    and exists (
    select 1
      from public.pour_events reversal
     where reversal.event_contract = 2
       and reversal.kind = 'undo'
       and reversal.reversal_of_event_id = pe.id
       and pe.kind in ('pour', 'spill')
       and reversal.restaurant_id = pe.restaurant_id
       and reversal.wine_id = pe.wine_id
       and reversal.open_bottle_id = pe.open_bottle_id
       and reversal.ml_delta::bigint = -(pe.ml_delta::bigint)
    )
  );

revoke all on table public.effective_service_pour_events
  from public, anon, service_role;
grant select on table public.effective_service_pour_events
  to authenticated;

-- Seal the server-normalized definitions that guarded down must observe. These
-- comments make a rename, drop/recreate, or definition change fail closed
-- without depending on PostgreSQL pretty-printer formatting in this source.
do $catalog_seal$
declare
  v_constraint record;
  v_constraint_count integer := 0;
  v_index record;
  v_index_count integer := 0;
  v_view record;
begin
  for v_constraint in
    select c.conrelid::regclass as relation_identity, c.conname, c.oid
      from pg_catalog.pg_constraint c
     where (c.conrelid, c.conname) in (
       ('public.inventory_items'::regclass, 'inventory_items_id_restaurant_wine_key'),
       ('public.open_bottles'::regclass, 'open_bottles_id_restaurant_wine_key'),
       ('public.open_bottles'::regclass, 'open_bottles_identity_contract_check'),
       ('public.open_bottles'::regclass, 'open_bottles_identity_origin_check'),
       ('public.open_bottles'::regclass, 'open_bottles_nominal_capacity_check'),
       ('public.open_bottles'::regclass, 'open_bottles_source_provenance_check'),
       ('public.open_bottles'::regclass, 'open_bottles_state_version_check'),
       ('public.open_bottles'::regclass, 'open_bottles_physical_shape_check'),
       ('public.inventory_command_receipts'::regclass, 'inventory_command_receipts_command_version_check'),
       ('public.inventory_command_receipts'::regclass, 'inventory_command_receipts_command_type_check'),
       ('public.inventory_command_receipts'::regclass, 'inventory_command_receipts_scope_kind_check'),
       ('public.inventory_command_receipts'::regclass, 'inventory_command_receipts_batch_entry_count_check'),
       ('public.inventory_command_receipts'::regclass, 'inventory_command_receipts_versioned_shape_check'),
       ('public.pour_events'::regclass, 'pour_events_kind_check'),
       ('public.pour_events'::regclass, 'pour_events_event_contract_check'),
       ('public.pour_events'::regclass, 'pour_events_operation_entry_ordinal_check'),
       ('public.pour_events'::regclass, 'pour_events_open_bottle_tenant_wine_fkey'),
       ('public.pour_events'::regclass, 'pour_events_operation_receipt_fkey'),
       ('public.pour_events'::regclass, 'pour_events_reversal_of_event_fkey'),
       ('public.pour_events'::regclass, 'pour_events_physical_shape_check'),
       ('public.bottle_closeouts'::regclass, 'bottle_closeouts_event_contract_check'),
       ('public.bottle_closeouts'::regclass, 'bottle_closeouts_open_bottle_tenant_wine_fkey'),
       ('public.bottle_closeouts'::regclass, 'bottle_closeouts_physical_shape_check'),
       ('public.inventory_command_bottle_effects'::regclass, 'inventory_command_bottle_effects_pkey'),
       ('public.inventory_command_bottle_effects'::regclass, 'inventory_command_bottle_effects_entry_ordinal_check'),
       ('public.inventory_command_bottle_effects'::regclass, 'inventory_command_bottle_effects_effect_type_check'),
       ('public.inventory_command_bottle_effects'::regclass, 'inventory_command_bottle_effects_operation_bottle_effect_key'),
       ('public.inventory_command_bottle_effects'::regclass, 'inventory_command_bottle_effects_receipt_fkey'),
       ('public.inventory_command_bottle_effects'::regclass, 'inventory_command_bottle_effects_bottle_fkey')
     )
  loop
    v_constraint_count := v_constraint_count + 1;
    execute format(
      'comment on constraint %I on %s is %L',
      v_constraint.conname,
      v_constraint.relation_identity,
      'C06_DEFINITION_MD5:' || md5(pg_catalog.pg_get_constraintdef(v_constraint.oid, false))
    );
  end loop;
  if v_constraint_count <> 29 then
    raise exception 'C06_0153_CONSTRAINT_SEAL_MISSING' using errcode = 'P0001';
  end if;

  for v_index in
    select c.oid::regclass as index_identity, c.oid
      from pg_catalog.pg_class c
     where c.oid in (
       'public.pour_events_operation_entry_key'::regclass,
       'public.pour_events_reversal_key'::regclass,
       'public.pour_events_open_bottle_tenant_wine_idx'::regclass,
       'public.bottle_closeouts_open_bottle_tenant_wine_idx'::regclass,
       'public.inventory_command_bottle_effects_open_operation_key'::regclass,
       'public.inventory_command_bottle_effects_bottle_idx'::regclass,
       'public.inventory_command_bottle_effects_wine_idx'::regclass
     )
  loop
    v_index_count := v_index_count + 1;
    execute format(
      'comment on index %s is %L',
      v_index.index_identity,
      'C06_DEFINITION_MD5:' || md5(pg_catalog.pg_get_indexdef(v_index.oid))
    );
  end loop;
  if v_index_count <> 7 then
    raise exception 'C06_0153_INDEX_SEAL_MISSING' using errcode = 'P0001';
  end if;

  select c.oid::regclass as view_identity, c.oid
    into strict v_view
    from pg_catalog.pg_class c
   where c.oid = 'public.effective_service_pour_events'::regclass
     and c.relkind = 'v';
  execute format(
    'comment on view %s is %L',
    v_view.view_identity,
    'C06_DEFINITION_MD5:' || md5(pg_catalog.pg_get_viewdef(v_view.oid, false))
  );
end;
$catalog_seal$;

comment on function public.current_inventory_contract_version() is
  'Normative inventory contract gate. Phase A is deliberately version 1.';
comment on table public.inventory_command_bottle_effects is
  'Closed, non-client-writable operation-to-physical-bottle resolver for version-2 commands.';
