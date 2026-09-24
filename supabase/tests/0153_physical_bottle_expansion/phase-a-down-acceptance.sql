\set ON_ERROR_STOP on
\pset pager off

do $down$
begin
  if to_regclass('public.inventory_command_bottle_effects') is not null
     or to_regclass('public.effective_service_pour_events') is not null
     or to_regprocedure('public.current_inventory_contract_version()') is not null
     or to_regprocedure('public.execute_physical_bottle_command(uuid,uuid,text,uuid,uuid,uuid,integer,text,text,integer,integer,uuid,uuid,text,boolean)') is not null
     or to_regprocedure('public.execute_physical_reconciliation_batch(uuid,uuid,jsonb)') is not null
     or to_regprocedure('public.list_active_physical_bottles(uuid)') is not null
     or to_regprocedure('public.list_open_bottle_aggregates(uuid)') is not null
     or to_regclass('public.pour_events_operation_entry_key') is not null
     or to_regclass('public.pour_events_reversal_key') is not null
     or to_regclass('public.pour_events_open_bottle_tenant_wine_idx') is not null
     or to_regclass('public.bottle_closeouts_open_bottle_tenant_wine_idx') is not null
     or to_regclass('public.inventory_command_bottle_effects_open_operation_key') is not null
     or to_regclass('public.inventory_command_bottle_effects_bottle_idx') is not null
     or to_regclass('public.inventory_command_bottle_effects_wine_idx') is not null then
    raise exception 'C06_DOWN_OBJECT_RESIDUE';
  end if;
  if exists (
    select 1
      -- C06_PHASE_A_DOWN_COLUMN_PAIRS_BEGIN
      from (values
        ('public.open_bottles'::regclass, 'identity_contract'::name),
        ('public.open_bottles'::regclass, 'identity_origin'::name),
        ('public.open_bottles'::regclass, 'nominal_capacity_ml'::name),
        ('public.open_bottles'::regclass, 'source_provenance'::name),
        ('public.open_bottles'::regclass, 'opening_operation_id'::name),
        ('public.open_bottles'::regclass, 'state_version'::name),
        ('public.pour_events'::regclass, 'event_contract'::name),
        ('public.pour_events'::regclass, 'operation_id'::name),
        ('public.pour_events'::regclass, 'operation_entry_ordinal'::name),
        ('public.pour_events'::regclass, 'reversal_of_event_id'::name),
        ('public.bottle_closeouts'::regclass, 'event_contract'::name),
        ('public.inventory_command_receipts'::regclass, 'command_version'::name),
        ('public.inventory_command_receipts'::regclass, 'scope_kind'::name),
        ('public.inventory_command_receipts'::regclass, 'batch_entry_count'::name)
      ) forbidden(attrelid, attname)
      -- C06_PHASE_A_DOWN_COLUMN_PAIRS_END
      join pg_catalog.pg_attribute a
        on a.attrelid = forbidden.attrelid
       and a.attname = forbidden.attname
     where a.attnum > 0 and not a.attisdropped
  ) then
    raise exception 'C06_DOWN_COLUMN_RESIDUE';
  end if;
  if not exists (
    select 1 from pg_catalog.pg_constraint
     where conrelid = 'public.pour_events'::regclass
       and conname = 'pour_events_open_bottle_id_fkey'
       and pg_get_constraintdef(oid, true) =
         'FOREIGN KEY (open_bottle_id) REFERENCES open_bottles(id) ON DELETE SET NULL'
  )
     or not exists (
       select 1 from pg_catalog.pg_constraint
        where conrelid = 'public.bottle_closeouts'::regclass
          and conname = 'bottle_closeouts_open_bottle_id_fkey'
          and pg_get_constraintdef(oid, true) =
            'FOREIGN KEY (open_bottle_id) REFERENCES open_bottles(id) ON DELETE SET NULL'
     ) then
    raise exception 'C06_DOWN_LEGACY_FK_MISMATCH';
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
  ) then
    raise exception 'C06_DOWN_LEGACY_UNIQUENESS_MISSING';
  end if;
  if not exists (
    select 1 from pg_catalog.pg_class c
     where c.oid = 'public.pour_events'::regclass
       and c.relrowsecurity
       and not c.relforcerowsecurity
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
    raise exception 'C06_DOWN_LEGACY_POLICY_DRIFT';
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
    raise exception 'C06_DOWN_LEGACY_FUNCTION_DRIFT';
  end if;
end;
$down$;

\echo C06_PHASE_A_DOWN_ACCEPTANCE_PASS
