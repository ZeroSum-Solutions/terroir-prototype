-- Verify both serialized outcomes, then remove only the exact fixture parents.
\set ON_ERROR_STOP on
\pset pager off
\if :{?expected_database}
\else
  \echo C08_0163_EXPECTED_DATABASE_REQUIRED
  \quit 3
\endif
select 1 / case when current_database()=:'expected_database'
  and current_user='postgres' and session_user='postgres'
then 1 else 0 end as c08_0163_completion_cleanup_target;

begin;
set local statement_timeout='30s';
set local lock_timeout='5s';
do $c08_0163_completion_results$
begin
  if not exists(
       select 1 from public.invoice_scans s
        where s.id='16340000-0000-4000-8000-000000000050'
          and s.status='complete' and s.status_reason is null
     )
     or not exists(
       select 1 from public.invoice_scans s
        where s.id='16340000-0000-4000-8000-000000000051'
          and s.status='failed' and s.status_reason='stalled'
     ) then
    raise exception 'C08_0163_COMPLETION_RACE_FINAL_STATE_FAILED';
  end if;

end;
$c08_0163_completion_results$;

set local role service_role;
update public.invoice_scans s
   set status='complete',status_reason=null
 where s.id='16340000-0000-4000-8000-000000000051'
   and s.restaurant_id='16340000-0000-4000-8000-000000000020'
   and s.status='processing';
reset role;
do $c08_0163_stale_completion_result$
begin
  if not exists(
       select 1 from public.invoice_scans s
        where s.id='16340000-0000-4000-8000-000000000051'
          and s.status='failed' and s.status_reason='stalled'
     ) then
    raise exception 'C08_0163_STALE_COMPLETION_OVERWROTE_EXPIRY';
  end if;
end;
$c08_0163_stale_completion_result$;

create temporary table c08_0163_completion_restaurants on commit drop as
select distinct r.id,r.workspace_id,r.name
  from public.memberships m
  join public.restaurants r on r.id=m.restaurant_id
 where m.user_id='16340000-0000-4000-8000-000000000001'
union
select r.id,r.workspace_id,r.name from public.restaurants r
 where r.id='16340000-0000-4000-8000-000000000020';
create temporary table c08_0163_completion_workspaces on commit drop as
select distinct owned.workspace_id from c08_0163_completion_restaurants owned
union
select wm.workspace_id from public.workspace_memberships wm
 where wm.user_id='16340000-0000-4000-8000-000000000001';
do $c08_0163_completion_cleanup_scope$
begin
  if (select pg_catalog.count(*) from c08_0163_completion_restaurants)<>2
     or (select pg_catalog.count(*) from c08_0163_completion_restaurants owned
          where owned.id='16340000-0000-4000-8000-000000000020'
            and owned.workspace_id='16340000-0000-4000-8000-000000000010'
            and owned.name='C08 completion race site')<>1
     or (select pg_catalog.count(*) from c08_0163_completion_restaurants owned
          where owned.id<>'16340000-0000-4000-8000-000000000020'
            and owned.name='My Restaurant')<>1
     or (select pg_catalog.count(*) from c08_0163_completion_workspaces)<>2
     or exists(
       (select workspace_id from c08_0163_completion_workspaces)
       except
       (select workspace_id from c08_0163_completion_restaurants)
     )
     or exists(
       (select workspace_id from c08_0163_completion_restaurants)
       except
       (select workspace_id from c08_0163_completion_workspaces)
     )
     or (select pg_catalog.count(*) from public.memberships m
          where m.user_id='16340000-0000-4000-8000-000000000001')<>2
     or (select pg_catalog.count(*) from public.memberships m
          join c08_0163_completion_restaurants owned on owned.id=m.restaurant_id)<>2
     or exists(
       select 1 from public.memberships m
       join c08_0163_completion_restaurants owned on owned.id=m.restaurant_id
        where m.user_id<>'16340000-0000-4000-8000-000000000001'
     )
     or (select pg_catalog.count(*) from public.workspace_memberships wm
          where wm.user_id='16340000-0000-4000-8000-000000000001')<>2
     or (select pg_catalog.count(*) from public.workspace_memberships wm
          join c08_0163_completion_workspaces owned
            on owned.workspace_id=wm.workspace_id)<>2
     or exists(
       select 1 from public.workspace_memberships wm
       join c08_0163_completion_workspaces owned
         on owned.workspace_id=wm.workspace_id
        where wm.user_id<>'16340000-0000-4000-8000-000000000001'
     ) then
    raise exception 'C08_0163_COMPLETION_CLEANUP_SCOPE_MISMATCH';
  end if;
end;
$c08_0163_completion_cleanup_scope$;
delete from public.restaurants r
 where r.id in (select id from c08_0163_completion_restaurants);
delete from public.workspaces w
 where w.id in (select workspace_id from c08_0163_completion_workspaces);
delete from auth.users u
 where u.id='16340000-0000-4000-8000-000000000001';
do $c08_0163_completion_cleanup_postcheck$
begin
  if exists(select 1 from auth.users where id='16340000-0000-4000-8000-000000000001')
     or exists(select 1 from public.restaurants where id in (
       select id from c08_0163_completion_restaurants
     ))
     or exists(select 1 from public.workspaces where id in (
       select workspace_id from c08_0163_completion_workspaces
     )) then
    raise exception 'C08_0163_COMPLETION_CLEANUP_FAILED';
  end if;
end;
$c08_0163_completion_cleanup_postcheck$;
commit;
\echo C08_0163_COMPLETION_RACE_VERIFY_CLEANUP_PASS
