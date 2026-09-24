\set ON_ERROR_STOP on
\pset format unaligned
\pset tuples_only on
\pset pager off

begin isolation level repeatable read read only;
set local time zone 'UTC';

select 'workspaces' || E'\t' || count(*)::text || E'\t' ||
       coalesce(md5(string_agg(to_jsonb(w)::text, E'\n' order by w.id)), md5(''))
from public.workspaces w;

select 'workspace_memberships' || E'\t' || count(*)::text || E'\t' ||
       coalesce(md5(string_agg(to_jsonb(wm)::text, E'\n' order by wm.id)), md5(''))
from public.workspace_memberships wm;

select 'restaurants' || E'\t' || count(*)::text || E'\t' ||
       coalesce(md5(string_agg(to_jsonb(r)::text, E'\n' order by r.id)), md5(''))
from public.restaurants r;

select 'memberships' || E'\t' || count(*)::text || E'\t' ||
       coalesce(md5(string_agg(to_jsonb(m)::text, E'\n' order by m.id)), md5(''))
from public.memberships m;

-- Schema/ACL fingerprint: a failed guarded down must preserve every new
-- column, constraint, trigger, function body, table ACL and RLS flag, not just
-- the four tables' rows.
with object_lines as (
  select format(
    'column|%s|%s|%s|%s|%s|%s',
    c.relname,
    a.attnum,
    a.attname,
    pg_catalog.format_type(a.atttypid, a.atttypmod),
    a.attnotnull,
    coalesce(pg_get_expr(ad.adbin, ad.adrelid), '')
  ) as line
  from pg_catalog.pg_attribute a
  join pg_catalog.pg_class c on c.oid = a.attrelid
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  left join pg_catalog.pg_attrdef ad
    on ad.adrelid = a.attrelid and ad.adnum = a.attnum
  where n.nspname = 'public'
    and c.relname in ('workspaces', 'workspace_memberships', 'restaurants', 'memberships')
    and a.attnum > 0
    and not a.attisdropped

  union all

  select format(
    'constraint|%s|%s|%s|%s|%s',
    c.conrelid::regclass::text,
    c.conname,
    c.convalidated,
    c.condeferrable,
    pg_get_constraintdef(c.oid, true)
  )
  from pg_catalog.pg_constraint c
  where c.conrelid in (
    'public.workspaces'::regclass,
    'public.workspace_memberships'::regclass,
    'public.restaurants'::regclass,
    'public.memberships'::regclass
  )

  union all

  select format(
    'trigger|%s|%s|%s',
    t.tgrelid::regclass::text,
    t.tgname,
    pg_get_triggerdef(t.oid, true)
  )
  from pg_catalog.pg_trigger t
  where t.tgrelid in (
    'public.workspace_memberships'::regclass,
    'public.restaurants'::regclass,
    'public.memberships'::regclass
  )
    and not t.tgisinternal

  union all

  select format(
    'function|%s|%s|%s',
    p.oid::regprocedure::text,
    coalesce(p.proacl::text, ''),
    pg_get_functiondef(p.oid)
  )
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

  union all

  select format(
    'table|%s|%s|%s|%s',
    c.oid::regclass::text,
    c.relrowsecurity,
    c.relforcerowsecurity,
    coalesce(c.relacl::text, '')
  )
  from pg_catalog.pg_class c
  where c.oid in (
    'public.workspaces'::regclass,
    'public.workspace_memberships'::regclass,
    'public.restaurants'::regclass,
    'public.memberships'::regclass
  )
)
select 'schema' || E'\t' || count(*)::text || E'\t' ||
       md5(string_agg(line, E'\n' order by line))
from object_lines;

commit;
