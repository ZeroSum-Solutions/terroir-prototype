\set ON_ERROR_STOP on
\pset format unaligned
\pset tuples_only on
\pset pager off

begin isolation level repeatable read read only;
set local time zone 'UTC';

-- Run this exact file before and after 0152 and byte-compare the output.
-- It intentionally ignores only the two new tables and the new columns.
select format(
  'select %L || E''\\t'' || count(*)::text from public.%I;',
  tablename,
  tablename
)
from pg_catalog.pg_tables
where schemaname = 'public'
  and tablename not in ('workspaces', 'workspace_memberships')
order by tablename
\gexec

select 'restaurants_legacy' || E'\t' || count(*)::text || E'\t' ||
       coalesce(md5(string_agg(
         jsonb_build_array(id, name, created_at, updated_at)::text,
         E'\n' order by id
       )), md5(''))
from public.restaurants;

select 'memberships_legacy' || E'\t' || count(*)::text || E'\t' ||
       coalesce(md5(string_agg(
         jsonb_build_array(id, user_id, restaurant_id, role, created_at)::text,
         E'\n' order by id
       )), md5(''))
from public.memberships;

select 'reason_codes' || E'\t' || count(*)::text || E'\t' ||
       coalesce(md5(string_agg(
         jsonb_build_array(
           id, restaurant_id, code, label, category, active, created_at
         )::text,
         E'\n' order by id
       )), md5(''))
from public.reason_codes;

select 'auth_users' || E'\t' || count(*)::text || E'\t' ||
       coalesce(md5(string_agg(id::text, E'\n' order by id)), md5(''))
from auth.users;

commit;
