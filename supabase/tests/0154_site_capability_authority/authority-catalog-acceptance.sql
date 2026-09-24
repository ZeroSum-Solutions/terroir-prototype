\set ON_ERROR_STOP on
\pset pager off

do $catalog$
declare
  v_role text;
  v_privilege text;
  v_definition text;
begin
  if not exists (
    select 1 from pg_catalog.pg_class c
     where c.oid = 'public.membership_capability_grants'::regclass
       and c.relrowsecurity
  ) or exists (
    select 1 from pg_catalog.pg_policy p
     where p.polrelid = 'public.membership_capability_grants'::regclass
  ) then
    raise exception 'C04_0154_LEDGER_RLS_NOT_CLOSED';
  end if;

  if (select count(*) from pg_catalog.pg_attribute a
       where (a.attrelid, a.attname) in (
         ('public.memberships'::regclass, 'lifecycle_generation'),
         ('public.workspace_memberships'::regclass, 'lifecycle_generation')
       ) and a.attnum > 0 and not a.attisdropped and a.attnotnull) <> 2 then
    raise exception 'C04_0154_LIFECYCLE_COLUMNS_MISSING';
  end if;

  if exists (
    select 1 from pg_catalog.pg_constraint c
     where c.conrelid = 'public.membership_capability_grants'::regclass
       and c.contype = 'f'
  ) then
    raise exception 'C04_0154_LEDGER_FOREIGN_KEY_UNEXPECTED';
  end if;

  select pg_catalog.pg_get_indexdef(c.oid) into v_definition
    from pg_catalog.pg_class c
   where c.oid = 'public.membership_capability_grants_current_key'::regclass;
  if v_definition not like '%(membership_id, capability_key)%WHERE (revoked_at IS NULL)' then
    raise exception 'C04_0154_CURRENT_UNIQUE_INDEX_DRIFT: %', v_definition;
  end if;

  if not exists (
    select 1 from pg_catalog.pg_trigger t
     where t.tgrelid = 'public.memberships'::regclass
       and t.tgname = 'memberships_z_capability_lifecycle'
       and not t.tgisinternal
  ) or not exists (
    select 1 from pg_catalog.pg_trigger t
     where t.tgrelid = 'public.workspace_memberships'::regclass
       and t.tgname = 'workspace_memberships_z_capability_lifecycle'
       and not t.tgisinternal
  ) or not exists (
    select 1
      from pg_catalog.pg_trigger prior
      join pg_catalog.pg_trigger later on later.tgrelid = prior.tgrelid
     where prior.tgrelid = 'public.memberships'::regclass
       and prior.tgname = 'memberships_link_workspace'
       and later.tgname = 'memberships_z_capability_lifecycle'
       and prior.tgname::text collate "C" < later.tgname::text collate "C"
       and not prior.tgisinternal and not later.tgisinternal
  ) or not exists (
    select 1
      from pg_catalog.pg_trigger prior
      join pg_catalog.pg_trigger later on later.tgrelid = prior.tgrelid
     where prior.tgrelid = 'public.workspace_memberships'::regclass
       and prior.tgname = 'workspace_memberships_guard_identity'
       and later.tgname = 'workspace_memberships_z_capability_lifecycle'
       and prior.tgname::text collate "C" < later.tgname::text collate "C"
       and not prior.tgisinternal and not later.tgisinternal
  ) then
    raise exception 'C04_0154_TRIGGER_ORDER_DRIFT';
  end if;

  if position('order by g.membership_id, g.capability_key, g.id' in lower(
    pg_get_functiondef(
      'public.retire_membership_capability_grants(uuid[],uuid,text,text)'::regprocedure
    )
  )) = 0 then
    raise exception 'C04_0154_CHILD_LOCK_ORDER_DRIFT';
  end if;

  if position('new.user_id is distinct from old.user_id' in lower(pg_get_functiondef(
    'public.enforce_site_membership_capability_lifecycle()'::regprocedure
  ))) = 0
     or position('new.restaurant_id is distinct from old.restaurant_id' in lower(
       pg_get_functiondef(
         'public.enforce_site_membership_capability_lifecycle()'::regprocedure
       )
     )) = 0
     or position('new.workspace_membership_id is distinct from old.workspace_membership_id'
       in lower(pg_get_functiondef(
         'public.enforce_site_membership_capability_lifecycle()'::regprocedure
       ))) = 0
     or position('new.user_id is distinct from old.user_id' in lower(pg_get_functiondef(
       'public.enforce_workspace_membership_capability_lifecycle()'::regprocedure
     ))) = 0
     or position('new.workspace_id is distinct from old.workspace_id' in lower(
       pg_get_functiondef(
         'public.enforce_workspace_membership_capability_lifecycle()'::regprocedure
       )
     )) = 0 then
    raise exception 'C04_0154_IDENTITY_ROTATION_FIELD_DRIFT';
  end if;

  if position('w.id = pr.wine_id' in lower(pg_get_functiondef(
    'public.read_pricing_recommendations(uuid)'::regprocedure
  ))) = 0
     or position('w.restaurant_id = pr.restaurant_id' in lower(pg_get_functiondef(
       'public.read_pricing_recommendations(uuid)'::regprocedure
     ))) = 0
     or position('order by pr.class asc, pr.computed_at desc, pr.wine_id asc'
       in lower(pg_get_functiondef(
         'public.read_pricing_recommendations(uuid)'::regprocedure
       ))) = 0 then
    raise exception 'C04_0154_PRICING_READER_DRIFT';
  end if;

  foreach v_role in array array['anon', 'authenticated', 'service_role'] loop
    foreach v_privilege in array array['SELECT', 'INSERT', 'UPDATE', 'DELETE'] loop
      if has_table_privilege(
        v_role, 'public.membership_capability_grants', v_privilege
      ) then
        raise exception 'C04_0154_LEDGER_PRIVILEGE_UNEXPECTED: % %',
          v_role, v_privilege;
      end if;
    end loop;
  end loop;

  if exists (
    select 1
      from pg_catalog.pg_class c
      cross join lateral pg_catalog.aclexplode(
        coalesce(c.relacl, pg_catalog.acldefault('r', c.relowner))
      ) acl
     where c.oid = 'public.membership_capability_grants'::regclass
       and acl.grantee = 0
       and acl.privilege_type in ('SELECT', 'INSERT', 'UPDATE', 'DELETE')
  ) then
    raise exception 'C04_0154_LEDGER_PUBLIC_PRIVILEGE_UNEXPECTED';
  end if;

  if not has_function_privilege(
    'authenticated', 'public.effective_site_capability(uuid,text)', 'EXECUTE'
  ) or not has_function_privilege(
    'authenticated', 'public.effective_site_ids(text)', 'EXECUTE'
  ) or not has_function_privilege(
    'authenticated',
    'public.replace_member_site_capabilities(uuid,text[],timestamp with time zone,text)',
    'EXECUTE'
  ) or not has_function_privilege(
    'authenticated', 'public.read_pricing_recommendations(uuid)', 'EXECUTE'
  ) then
    raise exception 'C04_0154_AUTHENTICATED_RPC_EXECUTE_MISSING';
  end if;

  if exists (
    select 1
      from unnest(array[
        'public.effective_site_capability(uuid,text)'::regprocedure,
        'public.effective_site_ids(text)'::regprocedure,
        'public.replace_member_site_capabilities(uuid,text[],timestamp with time zone,text)'::regprocedure,
        'public.read_pricing_recommendations(uuid)'::regprocedure
      ]) as routine(routine_oid)
      cross join unnest(array['anon', 'service_role']) as denied(role_name)
     where has_function_privilege(
       denied.role_name, routine.routine_oid::oid, 'EXECUTE'
     )
  ) or exists (
    select 1
      from unnest(array[
        'public.guard_membership_capability_grant_history()'::regprocedure,
        'public.retire_membership_capability_grants(uuid[],uuid,text,text)'::regprocedure,
        'public.enforce_site_membership_capability_lifecycle()'::regprocedure,
        'public.enforce_workspace_membership_capability_lifecycle()'::regprocedure
      ]) as routine(routine_oid)
      cross join unnest(
        array['anon', 'authenticated', 'service_role']
      ) as denied(role_name)
     where has_function_privilege(
       denied.role_name, routine.routine_oid::oid, 'EXECUTE'
     )
  ) or exists (
    select 1
      from pg_catalog.pg_proc p
      cross join lateral pg_catalog.aclexplode(
        coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))
      ) acl
     where p.oid in (
       'public.effective_site_capability(uuid,text)'::regprocedure,
       'public.effective_site_ids(text)'::regprocedure,
       'public.replace_member_site_capabilities(uuid,text[],timestamp with time zone,text)'::regprocedure,
       'public.read_pricing_recommendations(uuid)'::regprocedure,
       'public.guard_membership_capability_grant_history()'::regprocedure,
       'public.retire_membership_capability_grants(uuid[],uuid,text,text)'::regprocedure,
       'public.enforce_site_membership_capability_lifecycle()'::regprocedure,
       'public.enforce_workspace_membership_capability_lifecycle()'::regprocedure
     )
       and acl.grantee = 0
       and acl.privilege_type = 'EXECUTE'
  ) then
    raise exception 'C04_0154_RPC_PRIVILEGE_TOO_WIDE';
  end if;

  if not exists (
    select 1 from pg_catalog.pg_policy p
     where p.polrelid = 'public.pricing_recommendations'::regclass
       and p.polname = 'members can read pricing_recommendations'
       and p.polcmd = 'r'
       and p.polpermissive
       and p.polroles = array[0::oid]
       and pg_catalog.pg_get_expr(p.polqual, p.polrelid) =
         '(restaurant_id IN ( SELECT member_restaurant_ids() AS member_restaurant_ids))'
       and p.polwithcheck is null
  ) or not has_table_privilege(
    'authenticated', 'public.pricing_recommendations', 'SELECT'
  ) then
    raise exception 'C04_0154_LEGACY_PRICING_SELECT_NOT_PRESERVED';
  end if;

  if not exists (
    select 1 from pg_catalog.pg_trigger t
     where t.tgrelid = 'public.memberships'::regclass
       and t.tgname = 'memberships_link_workspace'
       and not t.tgisinternal
  ) or not exists (
    select 1 from pg_catalog.pg_trigger t
     where t.tgrelid = 'public.workspace_memberships'::regclass
       and t.tgname = 'workspace_memberships_guard_identity'
       and not t.tgisinternal
  ) then
    raise exception 'C04_0154_0152_GUARD_NOT_PRESERVED';
  end if;
end;
$catalog$;

\echo C04_0154_CATALOG_ACCEPTANCE_PASS
