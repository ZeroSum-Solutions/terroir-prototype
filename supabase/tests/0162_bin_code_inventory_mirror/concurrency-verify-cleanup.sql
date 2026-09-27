-- Verify the serialized final state, then remove only the reserved fixture.
\set ON_ERROR_STOP on
\pset pager off
\if :{?expected_database}
\else
  \echo C07_0162_EXPECTED_DATABASE_REQUIRED
  \quit 3
\endif
\if :{?target_admitted}
\else
  \echo C07_0162_TARGET_ADMISSION_REQUIRED
  \quit 3
\endif
select 1 / case when
  current_database()=:'expected_database'
  and current_user='postgres'
  and session_user='postgres'
  and :'target_admitted'='on'
then 1 else 0 end as c07_0162_cleanup_target_admitted;

begin;
set local statement_timeout='30s';
set local lock_timeout='5s';
do $c07_0162_concurrency_result$
begin
  if not exists (
       select 1 from public.bins b
        where b.id='16240000-0000-4000-8000-000000000060'
          and b.restaurant_id='16240000-0000-4000-8000-000000000020'
          and b.code='RACE-B'
     )
     or (select pg_catalog.count(*) from public.inventory_items ii
          where ii.restaurant_id='16240000-0000-4000-8000-000000000020'
            and ii.bin_id='16240000-0000-4000-8000-000000000060'
            and ii.bin_location='RACE-B') <> 2
     or exists (
       select 1 from public.inventory_items ii
        where ii.restaurant_id='16240000-0000-4000-8000-000000000020'
          and ii.bin_id='16240000-0000-4000-8000-000000000060'
          and ii.bin_location is distinct from 'RACE-B'
     ) then
    raise exception 'C07_0162_CONCURRENT_RENAME_SERIALIZATION_FAILED';
  end if;
end;
$c07_0162_concurrency_result$;

-- Inserting auth.users invokes auto-onboarding, so this fixture owns both the
-- explicit site below and trigger-created parent rows. Capture every parent
-- reached from this reserved user before any cascading delete hides the links.
create temporary table c07_0162_owned_restaurants on commit drop as
select distinct r.id,r.workspace_id,r.name
  from public.memberships m
  join public.restaurants r on r.id=m.restaurant_id
 where m.user_id='16240000-0000-4000-8000-000000000001'
union
select r.id,r.workspace_id,r.name
  from public.restaurants r
 where r.id='16240000-0000-4000-8000-000000000020';
create temporary table c07_0162_owned_workspaces on commit drop as
select distinct owned.workspace_id
  from c07_0162_owned_restaurants owned
union
select wm.workspace_id
  from public.workspace_memberships wm
 where wm.user_id='16240000-0000-4000-8000-000000000001';
do $c07_0162_cleanup_scope$
begin
  if (select pg_catalog.count(*)
        from c07_0162_owned_restaurants) <> 2
     or (select pg_catalog.count(*)
           from c07_0162_owned_restaurants owned
          where owned.id='16240000-0000-4000-8000-000000000020'
            and owned.workspace_id='16240000-0000-4000-8000-000000000010'
            and owned.name='C07 0162 race site') <> 1
     or (select pg_catalog.count(*)
           from c07_0162_owned_restaurants owned
          where owned.id<>'16240000-0000-4000-8000-000000000020'
            and owned.name='My Restaurant') <> 1
     or (select pg_catalog.count(*)
           from c07_0162_owned_workspaces) <> 2
     or exists(
       (select owned.workspace_id
          from c07_0162_owned_workspaces owned)
       except
       (select owned.workspace_id
          from c07_0162_owned_restaurants owned)
     )
     or exists(
       (select owned.workspace_id
          from c07_0162_owned_restaurants owned)
       except
       (select owned.workspace_id
          from c07_0162_owned_workspaces owned)
     )
     or (select pg_catalog.count(*)
           from public.memberships m
          where m.user_id='16240000-0000-4000-8000-000000000001') <> 2
     or exists(
       select 1 from public.memberships m
        where m.user_id='16240000-0000-4000-8000-000000000001'
          and not exists(
            select 1 from c07_0162_owned_restaurants owned
             where owned.id=m.restaurant_id
          )
     )
     or (select pg_catalog.count(*)
           from public.memberships m
           join c07_0162_owned_restaurants owned
             on owned.id=m.restaurant_id) <> 2
     or exists(
       select 1 from public.memberships m
       join c07_0162_owned_restaurants owned
         on owned.id=m.restaurant_id
        where m.user_id<>'16240000-0000-4000-8000-000000000001'
     )
     or (select pg_catalog.count(*)
           from public.workspace_memberships wm
          where wm.user_id='16240000-0000-4000-8000-000000000001') <> 2
     or exists(
       select 1 from public.workspace_memberships wm
        where wm.user_id='16240000-0000-4000-8000-000000000001'
          and not exists(
            select 1 from c07_0162_owned_workspaces owned
             where owned.workspace_id=wm.workspace_id
          )
     )
     or (select pg_catalog.count(*)
           from public.workspace_memberships wm
           join c07_0162_owned_workspaces owned
             on owned.workspace_id=wm.workspace_id) <> 2
     or exists(
       select 1 from public.workspace_memberships wm
       join c07_0162_owned_workspaces owned
         on owned.workspace_id=wm.workspace_id
        where wm.user_id<>'16240000-0000-4000-8000-000000000001'
     ) then
    raise exception 'C07_0162_CONCURRENCY_CLEANUP_SCOPE_MISMATCH';
  end if;
end;
$c07_0162_cleanup_scope$;
delete from public.restaurants
 where id in (select owned.id from c07_0162_owned_restaurants owned);
delete from public.workspaces
 where id in (select owned.workspace_id from c07_0162_owned_workspaces owned);
delete from auth.users
 where id='16240000-0000-4000-8000-000000000001';
do $c07_0162_cleanup_postcheck$
begin
  if exists(
       select 1 from auth.users
        where id='16240000-0000-4000-8000-000000000001'
     )
     or exists(
       select 1 from public.memberships m
        where m.user_id='16240000-0000-4000-8000-000000000001'
     )
     or exists(
       select 1 from public.workspace_memberships wm
        where wm.user_id='16240000-0000-4000-8000-000000000001'
     )
     or exists(
       select 1 from public.restaurants r
       join c07_0162_owned_restaurants owned on owned.id=r.id
     )
     or exists(
       select 1 from public.workspaces w
       join c07_0162_owned_workspaces owned on owned.workspace_id=w.id
     )
     or exists(
       select 1 from public.inventory_items ii
       join c07_0162_owned_restaurants owned
         on owned.id=ii.restaurant_id
     ) then
    raise exception 'C07_0162_CONCURRENCY_CLEANUP_FAILED';
  end if;
end;
$c07_0162_cleanup_postcheck$;
commit;
\echo C07_0162_CONCURRENCY_VERIFY_CLEANUP_PASS
