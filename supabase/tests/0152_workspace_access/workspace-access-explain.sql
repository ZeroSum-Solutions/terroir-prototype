\set ON_ERROR_STOP on
\pset pager off

begin isolation level repeatable read read only;

-- SECURITY DEFINER SQL functions are intentionally opaque in the outer
-- Function Scan. auto_explain captures their nested statements so this proof
-- can verify the bounded membership indexes actually selected at runtime.
load 'auto_explain';
set local client_min_messages = log;
set local auto_explain.log_min_duration = 0;
set local auto_explain.log_analyze = on;
set local auto_explain.log_buffers = on;
set local auto_explain.log_nested_statements = on;

select set_config(
  'request.jwt.claim.sub',
  (
    select m.user_id::text
      from public.memberships m
      join public.restaurants r on r.id = m.restaurant_id
     where m.role = 'manager'
       and exists (
         select 1 from public.restaurants child
          where child.workspace_id = r.workspace_id
            and child.name like 'C04 explain child %'
       )
     order by m.id
     limit 1
  ),
  true
);

\echo C04_EXPLAIN_EFFECTIVE_SITE_ACCESS
explain (analyze, buffers, format text)
select *
  from public.shadow_effective_site_access(
    (
      select r.id from public.restaurants r
       where exists (
         select 1 from public.restaurants child
          where child.workspace_id = r.workspace_id
            and child.name like 'C04 explain child %'
       )
         and r.id = r.workspace_id
       order by r.id
       limit 1
    )
  );

\echo C04_EXPLAIN_HAS_SITE_CAPABILITY
explain (analyze, buffers, format text)
select public.shadow_has_site_capability(
  (
    select r.id from public.restaurants r
     where exists (
       select 1 from public.restaurants child
        where child.workspace_id = r.workspace_id
          and child.name like 'C04 explain child %'
     )
       and r.id = r.workspace_id
     order by r.id
     limit 1
  ),
  'site.read'
);

\echo C04_EXPLAIN_EFFECTIVE_SITE_IDS
explain (analyze, buffers, format text)
select * from public.shadow_effective_site_ids('site.read');

commit;
