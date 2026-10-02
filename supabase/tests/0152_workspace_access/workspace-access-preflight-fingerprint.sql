\set ON_ERROR_STOP on
\pset format unaligned
\pset tuples_only on
\pset pager off

begin isolation level repeatable read read only;
set local time zone 'UTC';

-- This file must work before 0152 exists. It proves a NOWAIT refusal did not
-- leave any draft object behind and did not change the existing identity rows.
select 'migration_max' || E'\t' || coalesce(max(version), '')
from supabase_migrations.schema_migrations;

select 'draft_relations' || E'\t' || coalesce(string_agg(c.oid::regclass::text, ',' order by c.oid::regclass::text), '')
from pg_catalog.pg_class c
join pg_catalog.pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in ('workspaces', 'workspace_memberships');

select 'draft_columns' || E'\t' || coalesce(string_agg(
  format('%s.%s', c.relname, a.attname), ',' order by c.relname, a.attnum
), '')
from pg_catalog.pg_attribute a
join pg_catalog.pg_class c on c.oid = a.attrelid
join pg_catalog.pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and not a.attisdropped
  and a.attnum > 0
  and (
    (c.relname = 'restaurants' and a.attname in ('workspace_id', 'workspace_kind'))
    or (c.relname = 'memberships' and a.attname in (
      'workspace_membership_id', 'status', 'expires_at', 'revoked_at', 'granted_by'
    ))
  );

select 'draft_functions' || E'\t' || coalesce(string_agg(
  p.oid::regprocedure::text, ',' order by p.oid::regprocedure::text
), '')
from pg_catalog.pg_proc p
join pg_catalog.pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in (
    'ensure_restaurant_workspace',
    'guard_restaurant_workspace_assignment',
    'guard_workspace_membership_identity',
    'link_membership_to_workspace',
    'prepare_derived_workspace_cleanup',
    'finish_derived_workspace_cleanup',
    'shadow_effective_site_access',
    'shadow_has_site_capability',
    'shadow_effective_site_ids'
  );

select 'draft_triggers' || E'\t' || coalesce(string_agg(
  t.tgname, ',' order by t.tgname
), '')
from pg_catalog.pg_trigger t
join pg_catalog.pg_class c on c.oid = t.tgrelid
join pg_catalog.pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and not t.tgisinternal
  and t.tgname in (
    'restaurants_ensure_workspace',
    'restaurants_guard_workspace_assignment',
    'workspace_memberships_guard_identity',
    'memberships_link_workspace',
    'restaurants_prepare_derived_workspace_cleanup',
    'restaurants_finish_derived_workspace_cleanup'
  );

select 'handle_new_user' || E'\t' || md5(pg_get_functiondef('public.handle_new_user()'::regprocedure));

select 'restaurants' || E'\t' || count(*)::text || E'\t' ||
       coalesce(md5(string_agg(to_jsonb(r)::text, E'\n' order by r.id)), md5(''))
from public.restaurants r;

select 'memberships' || E'\t' || count(*)::text || E'\t' ||
       coalesce(md5(string_agg(to_jsonb(m)::text, E'\n' order by m.id)), md5(''))
from public.memberships m;

select 'reason_codes' || E'\t' || count(*)::text || E'\t' ||
       coalesce(md5(string_agg(to_jsonb(rc)::text, E'\n' order by rc.id)), md5(''))
from public.reason_codes rc;

select 'auth_users' || E'\t' || count(*)::text || E'\t' ||
       coalesce(md5(string_agg(id::text, E'\n' order by id)), md5(''))
from auth.users;

commit;
