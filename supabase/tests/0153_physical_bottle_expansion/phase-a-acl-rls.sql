\set ON_ERROR_STOP on
\pset pager off

do $acl$
declare
  v_writer regprocedure;
  v_function record;
  v_owner oid := (select oid from pg_catalog.pg_roles where rolname = current_user);
begin
  if not exists (
    select 1 from pg_catalog.pg_class c
     where c.oid = 'public.inventory_command_bottle_effects'::regclass
       and c.relrowsecurity
       and not c.relforcerowsecurity
  )
     or exists (
       select 1 from pg_catalog.pg_policy
        where polrelid = 'public.inventory_command_bottle_effects'::regclass
     )
     or not exists (
       select 1 from pg_catalog.pg_class c
        where c.oid = 'public.effective_service_pour_events'::regclass
          and c.reloptions = array['security_invoker=true']
     )
     or not exists (
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
    raise exception 'C06_RLS_POLICY_SHAPE_MISMATCH';
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
          pg_catalog.acldefault('r', v_owner)
        ) owner_acl
       where owner_acl.grantee = v_owner
      union all
      select 'relation', 'public.effective_service_pour_events'::regclass::oid,
             v_owner,
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
          pg_catalog.acldefault('f', v_owner)
        ) owner_acl
       where owner_acl.grantee = v_owner
      union all
      select 'function', object_oid, v_owner,
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
    raise exception 'C06_EXACT_ACL_TUPLE_MISMATCH';
  end if;
  if exists (
    select 1
      from pg_catalog.pg_class c,
           pg_catalog.aclexplode(coalesce(c.relacl, pg_catalog.acldefault('r', c.relowner))) acl
     where c.oid = 'public.inventory_command_bottle_effects'::regclass
       and (
         acl.grantee = 0
         or acl.grantee in (
           select oid from pg_catalog.pg_roles
            where rolname in ('anon', 'authenticated', 'service_role')
         )
       )
       and acl.privilege_type in ('SELECT', 'INSERT', 'UPDATE', 'DELETE')
  ) then
    raise exception 'C06_EFFECT_TABLE_GRANT_LEAK';
  end if;
  if exists (
    select 1
      from pg_catalog.pg_class c,
           pg_catalog.aclexplode(coalesce(c.relacl, pg_catalog.acldefault('r', c.relowner))) acl
     where c.oid = 'public.inventory_command_bottle_effects'::regclass
       and acl.grantee <> v_owner
  ) then
    raise exception 'C06_EFFECT_TABLE_UNLISTED_GRANTEE';
  end if;
  foreach v_writer in array array[
    'public.execute_physical_bottle_command(uuid,uuid,text,uuid,uuid,uuid,integer,text,text,integer,integer,uuid,uuid,text,boolean)'::regprocedure,
    'public.execute_physical_reconciliation_batch(uuid,uuid,jsonb)'::regprocedure
  ] loop
    if exists (
         select 1
           from pg_catalog.pg_proc p,
                pg_catalog.aclexplode(coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))) acl
          where p.oid = v_writer
            and acl.grantee = 0
            and acl.privilege_type = 'EXECUTE'
       )
       or has_function_privilege('anon', v_writer, 'EXECUTE')
       or has_function_privilege('authenticated', v_writer, 'EXECUTE')
       or has_function_privilege('service_role', v_writer, 'EXECUTE') then
      raise exception 'C06_WRITER_EXECUTE_LEAK: %', v_writer;
    end if;
  end loop;
  if not has_function_privilege('authenticated', 'public.current_inventory_contract_version()', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.list_active_physical_bottles(uuid)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.list_open_bottle_aggregates(uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'public.current_inventory_contract_version()', 'EXECUTE')
     or has_function_privilege('service_role', 'public.current_inventory_contract_version()', 'EXECUTE')
     or has_function_privilege('anon', 'public.list_active_physical_bottles(uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'public.list_open_bottle_aggregates(uuid)', 'EXECUTE')
     or has_function_privilege('service_role', 'public.list_active_physical_bottles(uuid)', 'EXECUTE')
     or has_function_privilege('service_role', 'public.list_open_bottle_aggregates(uuid)', 'EXECUTE') then
    raise exception 'C06_READER_ACL_MISMATCH';
  end if;
  if exists (
    select 1
      from pg_catalog.pg_proc p,
           pg_catalog.aclexplode(coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))) acl
     where p.oid in (
       'public.current_inventory_contract_version()'::regprocedure,
       'public.list_active_physical_bottles(uuid)'::regprocedure,
       'public.list_open_bottle_aggregates(uuid)'::regprocedure
     )
       and acl.grantee = 0
       and acl.privilege_type = 'EXECUTE'
  ) then
    raise exception 'C06_PUBLIC_READER_EXECUTE_LEAK';
  end if;
  if has_table_privilege('anon', 'public.effective_service_pour_events', 'SELECT')
     or has_table_privilege('service_role', 'public.effective_service_pour_events', 'SELECT')
     or not has_table_privilege('authenticated', 'public.effective_service_pour_events', 'SELECT') then
    raise exception 'C06_EFFECTIVE_VIEW_ACL_MISMATCH';
  end if;
  if exists (
    select 1
      from pg_catalog.pg_class c,
           pg_catalog.aclexplode(coalesce(c.relacl, pg_catalog.acldefault('r', c.relowner))) acl
     where c.oid = 'public.effective_service_pour_events'::regclass
       and (
         (acl.grantee = 0)
         or (
           acl.grantee in (
             select oid from pg_catalog.pg_roles
              where rolname in ('anon', 'service_role')
           )
         )
         or (
           acl.grantee = (select oid from pg_catalog.pg_roles where rolname = 'authenticated')
           and acl.privilege_type <> 'SELECT'
         )
       )
  ) then
    raise exception 'C06_EFFECTIVE_VIEW_GRANT_LEAK';
  end if;
  if exists (
    select 1
      from pg_catalog.pg_class c,
           pg_catalog.aclexplode(coalesce(c.relacl, pg_catalog.acldefault('r', c.relowner))) acl
     where c.oid = 'public.effective_service_pour_events'::regclass
       and acl.grantee <> v_owner
       and not (
         acl.grantee = (select oid from pg_catalog.pg_roles where rolname = 'authenticated')
         and acl.privilege_type = 'SELECT'
         and not acl.is_grantable
       )
  ) then
    raise exception 'C06_EFFECTIVE_VIEW_UNLISTED_GRANTEE';
  end if;
  if exists (
    select 1
      from pg_catalog.pg_proc p,
           pg_catalog.aclexplode(coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))) acl
     where p.oid in (
       'public.execute_physical_bottle_command(uuid,uuid,text,uuid,uuid,uuid,integer,text,text,integer,integer,uuid,uuid,text,boolean)'::regprocedure,
       'public.execute_physical_reconciliation_batch(uuid,uuid,jsonb)'::regprocedure
     )
       and acl.grantee <> v_owner
  )
     or exists (
       select 1
         from pg_catalog.pg_proc p,
              pg_catalog.aclexplode(coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))) acl
        where p.oid in (
          'public.current_inventory_contract_version()'::regprocedure,
          'public.list_active_physical_bottles(uuid)'::regprocedure,
          'public.list_open_bottle_aggregates(uuid)'::regprocedure
        )
          and acl.grantee <> v_owner
          and not (
            acl.grantee = (select oid from pg_catalog.pg_roles where rolname = 'authenticated')
            and acl.privilege_type = 'EXECUTE'
            and not acl.is_grantable
          )
     ) then
    raise exception 'C06_FUNCTION_UNLISTED_GRANTEE';
  end if;
  for v_function in
    select p.oid::regprocedure as identity, p.proowner, p.prosecdef,
           p.proconfig, p.provolatile
      from pg_catalog.pg_proc p
     where p.oid in (
       'public.current_inventory_contract_version()'::regprocedure,
       'public.execute_physical_bottle_command(uuid,uuid,text,uuid,uuid,uuid,integer,text,text,integer,integer,uuid,uuid,text,boolean)'::regprocedure,
       'public.execute_physical_reconciliation_batch(uuid,uuid,jsonb)'::regprocedure,
       'public.list_active_physical_bottles(uuid)'::regprocedure,
       'public.list_open_bottle_aggregates(uuid)'::regprocedure
     )
  loop
    if v_function.proowner <> v_owner
       or not exists (
         select 1 from unnest(coalesce(v_function.proconfig, array[]::text[])) setting
          where split_part(setting, '=', 1) = 'search_path'
             and split_part(setting, '=', 2) in ('', '""')
       )
       or cardinality(coalesce(v_function.proconfig, array[]::text[])) <> 1
       or (v_function.identity in (
         'public.execute_physical_bottle_command(uuid,uuid,text,uuid,uuid,uuid,integer,text,text,integer,integer,uuid,uuid,text,boolean)'::regprocedure,
         'public.execute_physical_reconciliation_batch(uuid,uuid,jsonb)'::regprocedure
       )) is distinct from v_function.prosecdef
       or (v_function.identity in (
         'public.current_inventory_contract_version()'::regprocedure,
         'public.list_active_physical_bottles(uuid)'::regprocedure,
         'public.list_open_bottle_aggregates(uuid)'::regprocedure
       )) is distinct from (v_function.provolatile = 's') then
      raise exception 'C06_FUNCTION_SECURITY_MISMATCH: %', v_function.identity;
    end if;
  end loop;
end;
$acl$;

do $owner_dormancy$
declare
  v_before jsonb;
  v_after jsonb;
begin
  select jsonb_build_object(
    'inventory_items', (select array_agg(to_jsonb(t) order by id) from public.inventory_items t),
    'open_bottles', (select array_agg(to_jsonb(t) order by id) from public.open_bottles t),
    'pour_events', (select array_agg(to_jsonb(t) order by id) from public.pour_events t),
    'bottle_closeouts', (select array_agg(to_jsonb(t) order by id) from public.bottle_closeouts t),
    'receipts', (select array_agg(to_jsonb(t) order by restaurant_id, operation_id)
                   from public.inventory_command_receipts t),
    'effects', (select array_agg(to_jsonb(t) order by restaurant_id, operation_id, entry_ordinal)
                  from public.inventory_command_bottle_effects t)
  ) into v_before;

  begin
    perform public.execute_physical_bottle_command(
      gen_random_uuid(), gen_random_uuid(), 'pour', gen_random_uuid(),
      null, null, 1, null, null, null, 0, null, null, null, false
    );
    raise exception 'C06_OWNER_SCALAR_GUARD_NOT_ENFORCED';
  exception
    when sqlstate 'P0001' then
      if sqlerrm <> 'physical_inventory_contract_inactive' then
        raise;
      end if;
  end;

  begin
    perform public.execute_physical_reconciliation_batch(
      gen_random_uuid(), gen_random_uuid(), '[]'::jsonb
    );
    raise exception 'C06_OWNER_BATCH_GUARD_NOT_ENFORCED';
  exception
    when sqlstate 'P0001' then
      if sqlerrm <> 'physical_inventory_contract_inactive' then
        raise;
      end if;
  end;

  select jsonb_build_object(
    'inventory_items', (select array_agg(to_jsonb(t) order by id) from public.inventory_items t),
    'open_bottles', (select array_agg(to_jsonb(t) order by id) from public.open_bottles t),
    'pour_events', (select array_agg(to_jsonb(t) order by id) from public.pour_events t),
    'bottle_closeouts', (select array_agg(to_jsonb(t) order by id) from public.bottle_closeouts t),
    'receipts', (select array_agg(to_jsonb(t) order by restaurant_id, operation_id)
                   from public.inventory_command_receipts t),
    'effects', (select array_agg(to_jsonb(t) order by restaurant_id, operation_id, entry_ordinal)
                  from public.inventory_command_bottle_effects t)
  ) into v_after;
  if v_after is distinct from v_before then
    raise exception 'C06_OWNER_DORMANT_GUARD_MUTATED_STATE';
  end if;
end;
$owner_dormancy$;

\echo C06_PHASE_A_ACL_RLS_PASS
