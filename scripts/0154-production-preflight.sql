-- Read-only operator and maintenance-window preflight for additive C04 authority A.
-- Run with the exact role intended for forward or guarded-down execution.
\set ON_ERROR_STOP on
\pset pager off

select
  'C04_0154_EXECUTOR' as evidence,
  current_user,
  session_user,
  r.rolsuper,
  r.rolbypassrls
from pg_catalog.pg_roles r
where r.rolname = current_user;

select
  'C04_0154_OBJECT_AUTHORITY' as evidence,
  c.oid::regclass::text as object_identity,
  pg_catalog.pg_get_userbyid(c.relowner) as owner,
  c.relowner = (select oid from pg_catalog.pg_roles where rolname = current_user)
    as direct_owner
from pg_catalog.pg_class c
join pg_catalog.pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relkind in ('r', 'p')
  and c.relname in (
    'workspaces', 'restaurants', 'workspace_memberships', 'memberships',
    'pricing_recommendations', 'wines', 'membership_capability_grants'
  )
order by object_identity;

select
  'C04_0154_REQUIRED_PRIVILEGE' as evidence,
  has_schema_privilege(current_user, 'public', 'USAGE') as public_schema_usage,
  has_schema_privilege(current_user, 'public', 'CREATE') as public_schema_create,
  has_schema_privilege(current_user, 'auth', 'USAGE') as auth_schema_usage,
  has_function_privilege(current_user, 'auth.uid()', 'EXECUTE') as auth_uid_execute,
  has_language_privilege(current_user, 'sql', 'USAGE') as sql_language_usage,
  has_language_privilege(current_user, 'plpgsql', 'USAGE') as plpgsql_language_usage;

begin;
lock table public.memberships in access exclusive mode nowait;
lock table public.workspace_memberships in access exclusive mode nowait;
do $optional_ledger_lock$
begin
  if to_regclass('public.membership_capability_grants') is not null then
    execute 'lock table public.membership_capability_grants in access exclusive mode nowait';
  end if;
end;
$optional_ledger_lock$;
lock table public.workspaces in share mode nowait;
lock table public.restaurants in share mode nowait;
lock table public.pricing_recommendations in share mode nowait;
lock table public.wines in share mode nowait;

do $locked_checks$
declare
  v_role_oid oid;
  v_object record;
  v_count integer := 0;
  v_routine_count integer := 0;
begin
  select oid into strict v_role_oid
    from pg_catalog.pg_roles where rolname = current_user;

  for v_object in
    select c.oid::regclass::text as identity, c.relowner
      from pg_catalog.pg_class c
      join pg_catalog.pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and c.relkind in ('r', 'p')
       and c.relname in (
         'workspaces', 'restaurants', 'workspace_memberships', 'memberships',
         'pricing_recommendations', 'wines'
       )
  loop
    v_count := v_count + 1;
    if v_object.relowner <> v_role_oid then
      raise exception 'C04_0154_OPERATOR_NOT_DIRECT_OWNER: %', v_object.identity
        using errcode = 'P0001';
    end if;
  end loop;
  if v_count <> 6 then
    raise exception 'C04_0154_REQUIRED_RELATION_COUNT: %', v_count using errcode = 'P0001';
  end if;

  if to_regclass('public.membership_capability_grants') is not null then
    if (select c.relowner from pg_catalog.pg_class c
         where c.oid = 'public.membership_capability_grants'::regclass) <>
       v_role_oid then
      raise exception 'C04_0154_OPERATOR_NOT_DIRECT_OWNER: public.membership_capability_grants'
        using errcode = 'P0001';
    end if;

    for v_object in
      select p.oid::regprocedure::text as identity, p.proowner as relowner
        from pg_catalog.pg_proc p
       where p.oid in (
         to_regprocedure('public.retire_membership_capability_grants(uuid[],uuid,text,text)'),
         to_regprocedure('public.guard_membership_capability_grant_history()'),
         to_regprocedure('public.enforce_site_membership_capability_lifecycle()'),
         to_regprocedure('public.enforce_workspace_membership_capability_lifecycle()'),
         to_regprocedure('public.effective_site_capability(uuid,text)'),
         to_regprocedure('public.effective_site_ids(text)'),
         to_regprocedure('public.replace_member_site_capabilities(uuid,text[],timestamp with time zone,text)'),
         to_regprocedure('public.read_pricing_recommendations(uuid)')
       )
    loop
      v_routine_count := v_routine_count + 1;
      if v_object.relowner <> v_role_oid then
        raise exception 'C04_0154_OPERATOR_NOT_DIRECT_OWNER: %', v_object.identity
          using errcode = 'P0001';
      end if;
    end loop;
    if v_routine_count <> 8 then
      raise exception 'C04_0154_REQUIRED_ROUTINE_COUNT: %', v_routine_count
        using errcode = 'P0001';
    end if;
  end if;

  if not has_schema_privilege(current_user, 'public', 'USAGE')
     or not has_schema_privilege(current_user, 'public', 'CREATE')
     or not has_schema_privilege(current_user, 'auth', 'USAGE')
     or not has_function_privilege(current_user, 'auth.uid()', 'EXECUTE')
     or not has_language_privilege(current_user, 'sql', 'USAGE')
     or not has_language_privilege(current_user, 'plpgsql', 'USAGE') then
    raise exception 'C04_0154_OPERATOR_PRIVILEGE_MISSING' using errcode = 'P0001';
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
    raise exception 'C04_0154_0152_GUARD_MISSING' using errcode = 'P0001';
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
    raise exception 'C04_0154_LEGACY_PRICING_SELECT_MISSING' using errcode = 'P0001';
  end if;

  if to_regclass('public.membership_capability_grants') is not null then
    if exists (select 1 from public.membership_capability_grants) then
      raise exception 'C04_0154_DOWN_HISTORY_PRESENT' using errcode = 'P0001';
    end if;
  end if;
end;
$locked_checks$;
rollback;

\echo C04_0154_PRODUCTION_PREFLIGHT_PASS
