-- Read-only operator and maintenance-window preflight for 0153.
-- Run with the exact role that will execute the forward or guarded down.
-- This probe takes the same NOWAIT locks as the migration and rolls back. It
-- is non-mutating, but it is not passive: run only after writers have drained.
-- The real migration repeats and holds these locks while revalidating.
\set ON_ERROR_STOP on
\pset pager off

select
  'C06_EXECUTOR' as evidence,
  current_user,
  session_user,
  r.rolsuper,
  r.rolbypassrls
from pg_catalog.pg_roles r
where r.rolname = current_user;

select
  'C06_OBJECT_AUTHORITY' as evidence,
  c.oid::regclass::text as object_identity,
  pg_catalog.pg_get_userbyid(c.relowner) as owner,
  c.relowner = (select oid from pg_catalog.pg_roles where rolname = current_user)
    as direct_owner,
  pg_catalog.pg_has_role(current_user, c.relowner, 'USAGE') as effective_owner
from pg_catalog.pg_class c
join pg_catalog.pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relkind in ('r', 'p')
  and c.relname in (
    'inventory_items', 'open_bottles', 'pour_events',
    'bottle_closeouts', 'inventory_command_receipts',
    'inventory_command_bottle_effects'
  )
order by object_identity;

select
  'C06_ROUTINE_AUTHORITY' as evidence,
  p.oid::regprocedure::text as object_identity,
  pg_catalog.pg_get_userbyid(p.proowner) as owner,
  p.proowner = (select oid from pg_catalog.pg_roles where rolname = current_user)
    as direct_owner,
  pg_catalog.pg_has_role(current_user, p.proowner, 'USAGE') as effective_owner
from pg_catalog.pg_proc p
join pg_catalog.pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.oid in (
    to_regprocedure('public.current_inventory_contract_version()'),
    to_regprocedure('public.execute_physical_bottle_command(uuid,uuid,text,uuid,uuid,uuid,integer,text,text,integer,integer,uuid,uuid,text,boolean)'),
    to_regprocedure('public.execute_physical_reconciliation_batch(uuid,uuid,jsonb)'),
    to_regprocedure('public.list_active_physical_bottles(uuid)'),
    to_regprocedure('public.list_open_bottle_aggregates(uuid)')
  )
order by object_identity;

select
  'C06_VIEW_AUTHORITY' as evidence,
  c.oid::regclass::text as object_identity,
  pg_catalog.pg_get_userbyid(c.relowner) as owner,
  c.relowner = (select oid from pg_catalog.pg_roles where rolname = current_user)
    as direct_owner,
  pg_catalog.pg_has_role(current_user, c.relowner, 'USAGE') as effective_owner
from pg_catalog.pg_class c
where c.oid = to_regclass('public.effective_service_pour_events');

select
  'C06_REQUIRED_PRIVILEGE' as evidence,
  has_schema_privilege(current_user, 'public', 'USAGE') as public_schema_usage,
  has_schema_privilege(current_user, 'public', 'CREATE') as public_schema_create,
  has_schema_privilege(current_user, 'auth', 'USAGE') as auth_schema_usage,
  has_function_privilege(current_user, 'auth.uid()', 'EXECUTE') as auth_uid_execute,
  has_type_privilege(current_user, 'public.membership_role', 'USAGE') as membership_role_usage,
  has_language_privilege(current_user, 'sql', 'USAGE') as sql_language_usage,
  has_language_privilege(current_user, 'plpgsql', 'USAGE') as plpgsql_language_usage;

begin;

do $lock_probe$
begin
  execute 'lock table public.inventory_items in access exclusive mode nowait';
  execute 'lock table public.open_bottles in access exclusive mode nowait';
  execute 'lock table public.pour_events in access exclusive mode nowait';
  execute 'lock table public.bottle_closeouts in access exclusive mode nowait';
  execute 'lock table public.inventory_command_receipts in access exclusive mode nowait';
  if to_regclass('public.inventory_command_bottle_effects') is not null then
    execute 'lock table public.inventory_command_bottle_effects in access exclusive mode nowait';
  end if;
end;
$lock_probe$;

do $locked_checks$
declare
  v_role_oid oid;
  v_table record;
  v_object record;
  v_table_count int := 0;
  v_object_count int := 0;
  v_present_column_pair_count int := 0;
  v_present_object_count int := 0;
  v_present_constraint_identity_count int := 0;
  v_present_index_identity_count int := 0;
  v_phase_state text;
begin
  select oid into strict v_role_oid
    from pg_catalog.pg_roles where rolname = current_user;

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

  if v_phase_state = 'partial_mixed' then
    raise exception 'C06_0153_PARTIAL_STATE' using errcode = 'P0001';
  end if;

  for v_table in
    select c.oid::regclass::text as identity, c.relowner
      from pg_catalog.pg_class c
      join pg_catalog.pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and c.relname in (
         'inventory_items', 'open_bottles', 'pour_events',
         'bottle_closeouts', 'inventory_command_receipts',
         'inventory_command_bottle_effects'
       )
       and c.relkind in ('r', 'p')
  loop
    v_table_count := v_table_count + 1;
    if v_table.relowner <> v_role_oid then
      raise exception 'C06_OPERATOR_NOT_DIRECT_OWNER: %', v_table.identity
        using errcode = 'P0001';
    end if;
    if not has_table_privilege(current_user, v_table.identity, 'REFERENCES') then
      raise exception 'C06_OPERATOR_MISSING_REFERENCES: %', v_table.identity
        using errcode = 'P0001';
    end if;
  end loop;
  if (v_phase_state = 'pristine' and v_table_count <> 5)
     or (v_phase_state = 'complete_identity' and v_table_count <> 6) then
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

  if v_phase_state = 'pristine' then
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
         select 1 from pg_catalog.pg_constraint c
          where c.conrelid = 'public.open_bottles'::regclass
            and c.conname = 'open_bottles_source_inventory_item_id_fkey'
            and pg_catalog.pg_get_constraintdef(c.oid, true) =
              'FOREIGN KEY (source_inventory_item_id) REFERENCES inventory_items(id) ON DELETE SET NULL'
       )
       or not exists (
         select 1 from pg_catalog.pg_constraint c
          where c.conrelid = 'public.pour_events'::regclass
            and c.conname = 'pour_events_open_bottle_id_fkey'
            and pg_catalog.pg_get_constraintdef(c.oid, true) =
              'FOREIGN KEY (open_bottle_id) REFERENCES open_bottles(id) ON DELETE SET NULL'
       )
       or not exists (
         select 1 from pg_catalog.pg_constraint c
          where c.conrelid = 'public.bottle_closeouts'::regclass
            and c.conname = 'bottle_closeouts_open_bottle_id_fkey'
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
        left join pg_catalog.pg_proc p on p.oid = to_regprocedure(expected.identity)
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
  else
    for v_object in
      select c.oid::regclass::text as identity, c.relowner as owner_oid
        from pg_catalog.pg_class c
       where c.oid = to_regclass('public.effective_service_pour_events')
         and c.relkind = 'v'
      union all
      select p.oid::regprocedure::text as identity, p.proowner as owner_oid
        from pg_catalog.pg_proc p
        join pg_catalog.pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public'
         and p.oid in (
           to_regprocedure('public.current_inventory_contract_version()'),
           to_regprocedure('public.execute_physical_bottle_command(uuid,uuid,text,uuid,uuid,uuid,integer,text,text,integer,integer,uuid,uuid,text,boolean)'),
           to_regprocedure('public.execute_physical_reconciliation_batch(uuid,uuid,jsonb)'),
           to_regprocedure('public.list_active_physical_bottles(uuid)'),
           to_regprocedure('public.list_open_bottle_aggregates(uuid)')
         )
    loop
      v_object_count := v_object_count + 1;
      if v_object.owner_oid <> v_role_oid then
        raise exception 'C06_OPERATOR_NOT_DIRECT_OWNER: %', v_object.identity
          using errcode = 'P0001';
      end if;
    end loop;
    if v_object_count <> 6 then
      raise exception 'C06_0153_CATALOG_MISMATCH' using errcode = 'P0001';
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
       or (
         select array_agg(c.conname::text collate "C" order by c.conname::text collate "C")
           from pg_catalog.pg_constraint c
          where c.conrelid in (
            'public.inventory_items'::regclass,
            'public.open_bottles'::regclass,
            'public.inventory_command_receipts'::regclass,
            'public.pour_events'::regclass,
            'public.bottle_closeouts'::regclass,
            'public.inventory_command_bottle_effects'::regclass
          )
            and pg_catalog.obj_description(c.oid, 'pg_constraint') like
              'C06_DEFINITION_MD5:%'
       ) is distinct from (
         select array_agg(name collate "C" order by name collate "C")
           from unnest(array[
             'inventory_items_id_restaurant_wine_key',
             'open_bottles_id_restaurant_wine_key',
             'open_bottles_identity_contract_check',
             'open_bottles_identity_origin_check',
             'open_bottles_nominal_capacity_check',
             'open_bottles_source_provenance_check',
             'open_bottles_state_version_check',
             'open_bottles_physical_shape_check',
             'inventory_command_receipts_command_version_check',
             'inventory_command_receipts_command_type_check',
             'inventory_command_receipts_scope_kind_check',
             'inventory_command_receipts_batch_entry_count_check',
             'inventory_command_receipts_versioned_shape_check',
             'pour_events_kind_check',
             'pour_events_event_contract_check',
             'pour_events_operation_entry_ordinal_check',
             'pour_events_open_bottle_tenant_wine_fkey',
             'pour_events_operation_receipt_fkey',
             'pour_events_reversal_of_event_fkey',
             'pour_events_physical_shape_check',
             'bottle_closeouts_event_contract_check',
             'bottle_closeouts_open_bottle_tenant_wine_fkey',
             'bottle_closeouts_physical_shape_check',
             'inventory_command_bottle_effects_pkey',
             'inventory_command_bottle_effects_entry_ordinal_check',
             'inventory_command_bottle_effects_effect_type_check',
             'inventory_command_bottle_effects_operation_bottle_effect_key',
             'inventory_command_bottle_effects_receipt_fkey',
             'inventory_command_bottle_effects_bottle_fkey'
           ]) name
       )
       or exists (
         select 1
           from pg_catalog.pg_constraint c
          where c.conrelid in (
                  'public.inventory_items'::regclass,
                  'public.open_bottles'::regclass,
                  'public.inventory_command_receipts'::regclass,
                  'public.pour_events'::regclass,
                  'public.bottle_closeouts'::regclass,
                  'public.inventory_command_bottle_effects'::regclass
                )
            and pg_catalog.obj_description(c.oid, 'pg_constraint') like
                'C06_DEFINITION_MD5:%'
            and pg_catalog.obj_description(c.oid, 'pg_constraint') is distinct from
              'C06_DEFINITION_MD5:' || md5(pg_catalog.pg_get_constraintdef(c.oid, false))
       )
       or (select count(*)
             from pg_catalog.pg_class c
            where c.oid in (
              to_regclass('public.pour_events_operation_entry_key'),
              to_regclass('public.pour_events_reversal_key'),
              to_regclass('public.pour_events_open_bottle_tenant_wine_idx'),
              to_regclass('public.bottle_closeouts_open_bottle_tenant_wine_idx'),
              to_regclass('public.inventory_command_bottle_effects_open_operation_key'),
              to_regclass('public.inventory_command_bottle_effects_bottle_idx'),
              to_regclass('public.inventory_command_bottle_effects_wine_idx')
            )) <> 7
       or exists (
         select 1
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
            and pg_catalog.obj_description(c.oid, 'pg_class') is distinct from
              'C06_DEFINITION_MD5:' || md5(pg_catalog.pg_get_indexdef(c.oid))
       )
       or pg_catalog.obj_description(
         'public.effective_service_pour_events'::regclass, 'pg_class'
       ) is distinct from 'C06_DEFINITION_MD5:' || md5(pg_catalog.pg_get_viewdef(
         'public.effective_service_pour_events'::regclass, false
       ))
       or exists (
         select 1
           from (values
             ('public.current_inventory_contract_version()'::regprocedure, '8fa2f7e41390b52527e0afb63fc8283d', false, 's'::"char"),
             ('public.execute_physical_bottle_command(uuid,uuid,text,uuid,uuid,uuid,integer,text,text,integer,integer,uuid,uuid,text,boolean)'::regprocedure, '3ddc0587d989370a51e2092b8a869345', true, 'v'::"char"),
             ('public.execute_physical_reconciliation_batch(uuid,uuid,jsonb)'::regprocedure, '9800270b4fdf9c635c5a1c845d79916e', true, 'v'::"char"),
             ('public.list_active_physical_bottles(uuid)'::regprocedure, '211841061248dcfbd43385825bd7f9f7', false, 's'::"char"),
             ('public.list_open_bottle_aggregates(uuid)'::regprocedure, '3f4d350659664a38e28c040642a65691', false, 's'::"char")
           ) expected(identity, body_md5, security_definer, volatility)
           join pg_catalog.pg_proc p on p.oid = expected.identity
          where p.prokind is distinct from 'f'
             or md5(p.prosrc) <> expected.body_md5
             or p.prosecdef is distinct from expected.security_definer
             or p.provolatile is distinct from expected.volatility
             or cardinality(coalesce(p.proconfig, array[]::text[])) <> 1
             or not exists (
               select 1 from unnest(coalesce(p.proconfig, array[]::text[])) setting
                where split_part(setting, '=', 1) = 'search_path'
                  and split_part(setting, '=', 2) in ('', '""')
             )
       )
       or exists (
         select 1 from pg_catalog.pg_class c
          where c.oid = 'public.inventory_command_bottle_effects'::regclass
            and (not c.relrowsecurity or c.relforcerowsecurity)
       )
       or exists (
         select 1 from pg_catalog.pg_policy
          where polrelid = 'public.inventory_command_bottle_effects'::regclass
       )
       or not exists (
         select 1 from pg_catalog.pg_class c
          where c.oid = 'public.effective_service_pour_events'::regclass
            and c.reloptions = array['security_invoker=true']
    ) then
      raise exception 'C06_0153_CATALOG_MISMATCH' using errcode = 'P0001';
    end if;

    if not exists (
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
       or exists (
         select 1
           from (values
             ('public.open_bottles'::regclass, 'open_bottles_remaining_ml_check',
               'CHECK (remaining_ml >= 0)'),
             ('public.open_bottles'::regclass, 'open_bottles_preservation_method_check',
               'CHECK (preservation_method = ANY (ARRAY[''coravin''::text, ''argon''::text, ''vacuum''::text, ''none''::text]))'),
             ('public.bottle_closeouts'::regclass, 'bottle_closeouts_writeoff_requires_reason',
               'CHECK (written_off_ml = 0 OR reason_code_id IS NOT NULL)'),
             ('public.inventory_command_receipts'::regclass, 'inventory_command_receipts_completion_pair',
               'CHECK ((result_payload IS NULL) = (completed_at IS NULL))'),
             ('public.inventory_command_receipts'::regclass, 'inventory_command_receipts_result_object',
               'CHECK (result_payload IS NULL OR jsonb_typeof(result_payload) = ''object''::text)')
           ) expected(relid, conname, definition)
           left join pg_catalog.pg_constraint c
             on c.conrelid = expected.relid
            and c.conname = expected.conname
            and c.contype = 'c'
            and pg_catalog.pg_get_constraintdef(c.oid, true) = expected.definition
          where c.oid is null
       )
       or exists (
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
           left join pg_catalog.pg_proc p on p.oid = to_regprocedure(expected.identity)
          where p.oid is null
             or md5(p.prosrc) <> expected.body_md5
             or p.prosecdef is distinct from expected.security_definer
             or p.provolatile <> 'v'
             or coalesce(p.proconfig, array[]::text[]) is distinct from
               case when expected.search_path is null then array[]::text[]
                    else array['search_path=' || expected.search_path]
               end
       )
       or exists (
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
      raise exception 'C06_LEGACY_CATALOG_MISMATCH' using errcode = 'P0001';
    end if;

    if exists (
      with actual as (
        select 'relation'::text as object_kind, c.oid as object_oid,
               acl.grantor, acl.grantee, acl.privilege_type, acl.is_grantable
          from pg_catalog.pg_class c
          cross join lateral pg_catalog.aclexplode(
            coalesce(c.relacl, pg_catalog.acldefault('r', c.relowner))
          ) acl
         where c.oid in (
           'public.inventory_command_bottle_effects'::regclass,
           'public.effective_service_pour_events'::regclass
         )
        union all
        select 'function'::text, p.oid,
               acl.grantor, acl.grantee, acl.privilege_type, acl.is_grantable
          from pg_catalog.pg_proc p
          cross join lateral pg_catalog.aclexplode(
            coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))
          ) acl
         where p.oid in (
           'public.current_inventory_contract_version()'::regprocedure,
           'public.execute_physical_bottle_command(uuid,uuid,text,uuid,uuid,uuid,integer,text,text,integer,integer,uuid,uuid,text,boolean)'::regprocedure,
           'public.execute_physical_reconciliation_batch(uuid,uuid,jsonb)'::regprocedure,
           'public.list_active_physical_bottles(uuid)'::regprocedure,
           'public.list_open_bottle_aggregates(uuid)'::regprocedure
         )
      ), expected as (
        select 'relation'::text as object_kind, object_oid,
               owner_acl.grantor, owner_acl.grantee,
               owner_acl.privilege_type, owner_acl.is_grantable
          from (values
            ('public.inventory_command_bottle_effects'::regclass::oid),
            ('public.effective_service_pour_events'::regclass::oid)
          ) objects(object_oid)
          cross join lateral pg_catalog.aclexplode(
            pg_catalog.acldefault('r', v_role_oid)
          ) owner_acl
         where owner_acl.grantee = v_role_oid
        union all
        select 'relation', 'public.effective_service_pour_events'::regclass::oid,
               v_role_oid,
               (select oid from pg_catalog.pg_roles where rolname = 'authenticated'),
               'SELECT', false
        union all
        select 'function', object_oid,
               owner_acl.grantor, owner_acl.grantee,
               owner_acl.privilege_type, owner_acl.is_grantable
          from (values
            ('public.current_inventory_contract_version()'::regprocedure::oid),
            ('public.execute_physical_bottle_command(uuid,uuid,text,uuid,uuid,uuid,integer,text,text,integer,integer,uuid,uuid,text,boolean)'::regprocedure::oid),
            ('public.execute_physical_reconciliation_batch(uuid,uuid,jsonb)'::regprocedure::oid),
            ('public.list_active_physical_bottles(uuid)'::regprocedure::oid),
            ('public.list_open_bottle_aggregates(uuid)'::regprocedure::oid)
          ) functions(object_oid)
          cross join lateral pg_catalog.aclexplode(
            pg_catalog.acldefault('f', v_role_oid)
          ) owner_acl
         where owner_acl.grantee = v_role_oid
        union all
        select 'function', object_oid, v_role_oid,
               (select oid from pg_catalog.pg_roles where rolname = 'authenticated'),
               'EXECUTE', false
          from (values
            ('public.current_inventory_contract_version()'::regprocedure::oid),
            ('public.list_active_physical_bottles(uuid)'::regprocedure::oid),
            ('public.list_open_bottle_aggregates(uuid)'::regprocedure::oid)
          ) readers(object_oid)
      ), mismatch as (
        (select * from actual except select * from expected)
        union all
        (select * from expected except select * from actual)
      )
      select 1 from mismatch
    ) then
      raise exception 'C06_0153_CATALOG_MISMATCH' using errcode = 'P0001';
    end if;

    if exists (
      select 1 from pg_catalog.pg_class c
       where c.oid = 'public.pour_events'::regclass
         and (not c.relrowsecurity or c.relforcerowsecurity)
    )
       or (select count(*) from pg_catalog.pg_policy
            where polrelid = 'public.pour_events'::regclass) <> 1
       or not exists (
         select 1 from pg_catalog.pg_policy pol
          where pol.polrelid = 'public.pour_events'::regclass
            and pol.polname = 'members can read pour_events'
            and pol.polcmd = 'r'
            and pol.polpermissive
            and pol.polroles = array[(select oid from pg_catalog.pg_roles where rolname = 'authenticated')]
            and pg_catalog.pg_get_expr(pol.polqual, pol.polrelid) =
              '(restaurant_id IN ( SELECT member_restaurant_ids() AS member_restaurant_ids))'
            and pol.polwithcheck is null
       ) then
      raise exception 'C06_0153_CATALOG_MISMATCH' using errcode = 'P0001';
    end if;

    if exists (
      select 1
        from pg_catalog.pg_depend d
        join pg_catalog.pg_rewrite rw
          on d.classid = 'pg_catalog.pg_rewrite'::regclass
         and rw.oid = d.objid
        join pg_catalog.pg_class dependent_view on dependent_view.oid = rw.ev_class
       where d.refobjid in (
         'public.inventory_command_bottle_effects'::regclass,
         'public.effective_service_pour_events'::regclass
       )
         and dependent_view.oid not in (
           'public.inventory_command_bottle_effects'::regclass,
           'public.effective_service_pour_events'::regclass
         )
    )
       or exists (
         select 1 from pg_catalog.pg_constraint c
          where c.confrelid = 'public.inventory_command_bottle_effects'::regclass
            and c.conrelid <> 'public.inventory_command_bottle_effects'::regclass
       )
       or exists (
         select 1
           from pg_catalog.pg_depend d
           join pg_catalog.pg_proc dependent_function
             on d.classid = 'pg_catalog.pg_proc'::regclass
            and dependent_function.oid = d.objid
          where d.refclassid = 'pg_catalog.pg_proc'::regclass
            and d.refobjid in (
              'public.current_inventory_contract_version()'::regprocedure,
              'public.execute_physical_bottle_command(uuid,uuid,text,uuid,uuid,uuid,integer,text,text,integer,integer,uuid,uuid,text,boolean)'::regprocedure,
              'public.execute_physical_reconciliation_batch(uuid,uuid,jsonb)'::regprocedure,
              'public.list_active_physical_bottles(uuid)'::regprocedure,
              'public.list_open_bottle_aggregates(uuid)'::regprocedure
            )
            and dependent_function.oid not in (
              'public.current_inventory_contract_version()'::regprocedure,
              'public.execute_physical_bottle_command(uuid,uuid,text,uuid,uuid,uuid,integer,text,text,integer,integer,uuid,uuid,text,boolean)'::regprocedure,
              'public.execute_physical_reconciliation_batch(uuid,uuid,jsonb)'::regprocedure,
              'public.list_active_physical_bottles(uuid)'::regprocedure,
              'public.list_open_bottle_aggregates(uuid)'::regprocedure
            )
       ) then
      raise exception 'C06_0153_CATALOG_MISMATCH' using errcode = 'P0001';
    end if;

    if exists (select 1 from public.inventory_command_bottle_effects limit 1)
       or exists (
         select 1 from public.open_bottles
          where identity_contract <> 1
             or identity_origin <> 'legacy_slot'
             or nominal_capacity_ml is not null
             or source_provenance <> 'legacy_unknown'
             or opening_operation_id is not null
             or state_version <> 0
       )
       or exists (
         select 1 from public.pour_events
          where event_contract <> 1
             or operation_id is not null
             or operation_entry_ordinal is not null
             or reversal_of_event_id is not null
             or kind = 'undo'
       )
       or exists (select 1 from public.bottle_closeouts where event_contract <> 1)
       or exists (
         select 1 from public.inventory_command_receipts
          where command_version <> 1
             or scope_kind <> 'single_wine'
             or batch_entry_count is not null
             or wine_id is null
             or command_type not in ('open', 'pour', 'spill', 'discard', 'close')
       ) then
      raise exception 'unsafe_down_physical_bottle_data_present' using errcode = 'P0001';
    end if;
    if exists (
      select 1 from public.open_bottles
       group by restaurant_id, wine_id having count(*) > 1
    ) then
      raise exception 'unsafe_down_physical_bottle_data_present' using errcode = 'P0001';
    end if;
  end if;
end;
$locked_checks$;

rollback;
\echo C06_PRODUCTION_PREFLIGHT_PASS
