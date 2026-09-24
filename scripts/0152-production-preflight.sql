-- DRAFT ONLY -- read-only operator/lock gate for migration 0152.
-- Run this file with the exact credential that will execute the forward or down.
\set ON_ERROR_STOP on
\pset pager off

select
  'C04_EXECUTOR' as evidence,
  current_user as current_user,
  session_user as session_user,
  r.rolsuper,
  r.rolbypassrls
from pg_catalog.pg_roles r
where r.rolname = current_user;

select
  'C04_OBJECT_AUTHORITY' as evidence,
  'table' as object_kind,
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
    'restaurants', 'memberships', 'workspaces', 'workspace_memberships'
  )
union all
select
  'C04_OBJECT_AUTHORITY',
  'function',
  p.oid::regprocedure::text,
  pg_catalog.pg_get_userbyid(p.proowner),
  p.proowner = (select oid from pg_catalog.pg_roles where rolname = current_user),
  pg_catalog.pg_has_role(current_user, p.proowner, 'USAGE')
from pg_catalog.pg_proc p
join pg_catalog.pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in (
    'handle_new_user',
    'ensure_restaurant_workspace',
    'guard_restaurant_workspace_assignment',
    'guard_workspace_membership_identity',
    'link_membership_to_workspace',
    'prepare_derived_workspace_cleanup',
    'finish_derived_workspace_cleanup',
    'shadow_effective_site_access',
    'shadow_has_site_capability',
    'shadow_effective_site_ids'
  )
order by object_kind, object_identity;

select
  'C04_REQUIRED_PRIVILEGE' as evidence,
  has_schema_privilege(current_user, 'public', 'USAGE') as public_schema_usage,
  has_schema_privilege(current_user, 'public', 'CREATE') as public_schema_create,
  has_schema_privilege(current_user, 'auth', 'USAGE') as auth_schema_usage,
  has_table_privilege(current_user, 'auth.users', 'REFERENCES') as auth_users_references,
  has_table_privilege(current_user, 'auth.users', 'SELECT') as auth_users_select,
  has_function_privilege(current_user, 'auth.uid()', 'EXECUTE') as auth_uid_execute,
  has_function_privilege(
    current_user, 'public.seed_reason_codes(uuid)', 'EXECUTE'
  ) as seed_reason_codes_execute,
  has_type_privilege(
    current_user, 'public.membership_role', 'USAGE'
  ) as membership_role_usage,
  has_language_privilege(current_user, 'sql', 'USAGE') as sql_language_usage,
  has_language_privilege(current_user, 'plpgsql', 'USAGE') as plpgsql_language_usage;

do $operator_authority$
declare
  v_current_role_oid oid;
  v_can_bypass_rls boolean;
  v_object record;
begin
  select r.oid, r.rolsuper or r.rolbypassrls
    into strict v_current_role_oid, v_can_bypass_rls
    from pg_catalog.pg_roles r
   where r.rolname = current_user;

  for v_object in
    select 'table'::text as object_kind,
           c.oid::regclass::text as object_identity,
           c.relowner as owner_oid
      from pg_catalog.pg_class c
      join pg_catalog.pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and c.relkind in ('r', 'p')
       and c.relname in (
         'restaurants', 'memberships', 'workspaces', 'workspace_memberships'
       )
    union all
    select 'function', p.oid::regprocedure::text, p.proowner
      from pg_catalog.pg_proc p
      join pg_catalog.pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in (
         'handle_new_user',
         'ensure_restaurant_workspace',
         'guard_restaurant_workspace_assignment',
         'guard_workspace_membership_identity',
         'link_membership_to_workspace',
         'prepare_derived_workspace_cleanup',
         'finish_derived_workspace_cleanup',
         'shadow_effective_site_access',
         'shadow_has_site_capability',
         'shadow_effective_site_ids'
       )
  loop
    if v_object.owner_oid <> v_current_role_oid then
      raise exception 'C04_OPERATOR_NOT_DIRECT_OWNER: % %',
        v_object.object_kind, v_object.object_identity
        using errcode = 'P0001';
    end if;
  end loop;

  if not has_schema_privilege(current_user, 'public', 'USAGE') then
    raise exception 'C04_OPERATOR_MISSING_PUBLIC_SCHEMA_USAGE' using errcode = 'P0001';
  end if;
  if not has_schema_privilege(current_user, 'public', 'CREATE') then
    raise exception 'C04_OPERATOR_MISSING_PUBLIC_SCHEMA_CREATE' using errcode = 'P0001';
  end if;
  if not has_schema_privilege(current_user, 'auth', 'USAGE') then
    raise exception 'C04_OPERATOR_MISSING_AUTH_SCHEMA_USAGE' using errcode = 'P0001';
  end if;
  if not has_table_privilege(current_user, 'auth.users', 'REFERENCES') then
    raise exception 'C04_OPERATOR_MISSING_AUTH_USERS_REFERENCES' using errcode = 'P0001';
  end if;
  if not has_table_privilege(current_user, 'auth.users', 'SELECT') then
    raise exception 'C04_OPERATOR_MISSING_AUTH_USERS_SELECT' using errcode = 'P0001';
  end if;
  if not v_can_bypass_rls then
    raise exception 'C04_OPERATOR_CANNOT_BYPASS_AUTH_USERS_RLS' using errcode = 'P0001';
  end if;
  if not has_function_privilege(current_user, 'auth.uid()', 'EXECUTE') then
    raise exception 'C04_OPERATOR_MISSING_AUTH_UID_EXECUTE' using errcode = 'P0001';
  end if;
  if not has_function_privilege(
    current_user, 'public.seed_reason_codes(uuid)', 'EXECUTE'
  ) then
    raise exception 'C04_OPERATOR_MISSING_SEED_REASON_CODES_EXECUTE' using errcode = 'P0001';
  end if;
  if not has_type_privilege(current_user, 'public.membership_role', 'USAGE') then
    raise exception 'C04_OPERATOR_MISSING_MEMBERSHIP_ROLE_USAGE' using errcode = 'P0001';
  end if;
  if not has_language_privilege(current_user, 'sql', 'USAGE') then
    raise exception 'C04_OPERATOR_MISSING_SQL_LANGUAGE_USAGE' using errcode = 'P0001';
  end if;
  if not has_language_privilege(current_user, 'plpgsql', 'USAGE') then
    raise exception 'C04_OPERATOR_MISSING_PLPGSQL_LANGUAGE_USAGE' using errcode = 'P0001';
  end if;
end;
$operator_authority$;

begin;
do $lock_probe$
begin
  if to_regclass('public.workspaces') is null then
    execute 'lock table auth.users in share row exclusive mode nowait';
    execute 'lock table public.restaurants, public.memberships in access exclusive mode nowait';
  else
    execute 'lock table auth.users in access exclusive mode nowait';
    execute 'lock table public.workspaces, public.restaurants, public.workspace_memberships, public.memberships in access exclusive mode nowait';
  end if;
end;
$lock_probe$;
rollback;

\echo C04_PRODUCTION_PREFLIGHT_PASS
