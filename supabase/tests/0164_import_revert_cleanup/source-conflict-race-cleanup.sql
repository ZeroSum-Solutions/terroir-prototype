-- Delete only the verified shared-source race fixture and auto-onboarding parents.
\set ON_ERROR_STOP on
\pset pager off
\if :{?expected_database}
\else
  \quit 3
\endif
\if :{?target_admitted}
\else
  \quit 3
\endif
\if :{?source_0164_sha256}
\else
  \quit 3
\endif
\if :{?race_kind}
\else
  \quit 3
\endif
\if :{?before_state_sha256}
\else
  \quit 3
\endif
select 1/case when current_database()=:'expected_database'
  and current_user='postgres' and session_user='postgres'
  and :'target_admitted'='on'
  and :'race_kind' in ('batch','session')
  and :'source_0164_sha256'=
    '2d535f329b600c3dfc33b23494532f93c023b1a89c6aad055b8de3a865ee49ff'
then 1 else 0 end as c09_0164_source_conflict_cleanup_target;
begin;
set local statement_timeout='45s';
set local lock_timeout='5s';
select pg_catalog.set_config('c09.source_conflict_kind',:'race_kind',true);
select pg_catalog.set_config(
  'c09.source_conflict_before_sha256',:'before_state_sha256',true
);
create temporary table c09_0164_source_state on commit drop as
select pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
  pg_catalog.jsonb_build_object(
    'sessions',coalesce((select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(s) order by s.id)
                           from public.import_sessions s
                          where s.id between '16470000-0000-4000-8000-000000000050'
                                         and '16470000-0000-4000-8000-000000000051'),'[]'::jsonb),
    'batches',(select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(b) order by b.id)
                 from public.import_batches b
                where b.id between '16470000-0000-4000-8000-000000000060'
                               and '16470000-0000-4000-8000-000000000063'),
    'rows',(select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(r) order by r.id)
              from public.import_batch_rows r
             where r.id between '16470000-0000-4000-8000-000000000070'
                            and '16470000-0000-4000-8000-000000000073'),
    'inventory',(select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(i) order by i.id)
                   from public.inventory_items i
                  where i.restaurant_id='16470000-0000-4000-8000-000000000020'),
    'wines',(select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(w) order by w.id)
               from public.wines w
              where w.restaurant_id='16470000-0000-4000-8000-000000000020')
  )::text,'UTF8')),'hex') as state_sha256;
create temporary table c09_0164_source_owned_restaurants on commit drop as
select distinct r.id,r.workspace_id,r.name
  from public.memberships m
  join public.restaurants r on r.id=m.restaurant_id
 where m.user_id='16470000-0000-4000-8000-000000000001'
union
select r.id,r.workspace_id,r.name from public.restaurants r
 where r.id='16470000-0000-4000-8000-000000000020';
create temporary table c09_0164_source_owned_workspaces on commit drop as
select distinct owned.workspace_id from c09_0164_source_owned_restaurants owned
union
select wm.workspace_id from public.workspace_memberships wm
 where wm.user_id='16470000-0000-4000-8000-000000000001';
do $c09_0164_source_cleanup_scope$
declare
  v_kind text:=pg_catalog.current_setting('c09.source_conflict_kind');
begin
  if (select s.state_sha256 from c09_0164_source_state s) is distinct from
       pg_catalog.current_setting('c09.source_conflict_before_sha256')
     or (select pg_catalog.count(*) from c09_0164_source_owned_restaurants)<>2
     or (select pg_catalog.count(*) from c09_0164_source_owned_restaurants r
          where r.id='16470000-0000-4000-8000-000000000020'
            and r.workspace_id='16470000-0000-4000-8000-000000000010'
            and r.name='C09 0164 source race site')<>1
     or (select pg_catalog.count(*) from c09_0164_source_owned_restaurants r
          where r.id<>'16470000-0000-4000-8000-000000000020'
            and r.name='My Restaurant')<>1
     or (select pg_catalog.count(*) from c09_0164_source_owned_workspaces)<>2
     or exists(
       (select w.workspace_id from c09_0164_source_owned_workspaces w)
       except
       (select r.workspace_id from c09_0164_source_owned_restaurants r)
     )
     or exists(
       (select r.workspace_id from c09_0164_source_owned_restaurants r)
       except
       (select w.workspace_id from c09_0164_source_owned_workspaces w)
     )
     or (select pg_catalog.count(*) from public.memberships m
          where m.user_id='16470000-0000-4000-8000-000000000001')<>2
     or (select pg_catalog.count(*) from public.memberships m
          join c09_0164_source_owned_restaurants r on r.id=m.restaurant_id)<>2
     or exists(select 1 from public.memberships m
                join c09_0164_source_owned_restaurants r on r.id=m.restaurant_id
               where m.user_id<>'16470000-0000-4000-8000-000000000001')
     or (select pg_catalog.count(*) from public.workspace_memberships wm
          where wm.user_id='16470000-0000-4000-8000-000000000001')<>2
     or (select pg_catalog.count(*) from public.workspace_memberships wm
          join c09_0164_source_owned_workspaces w
            on w.workspace_id=wm.workspace_id)<>2
     or exists(select 1 from public.workspace_memberships wm
                join c09_0164_source_owned_workspaces w
                  on w.workspace_id=wm.workspace_id
               where wm.user_id<>'16470000-0000-4000-8000-000000000001')
     or (select pg_catalog.count(*) from public.import_sessions s
          where s.restaurant_id='16470000-0000-4000-8000-000000000020')
          <> (case when v_kind='session' then 2 else 0 end)
     or (select pg_catalog.count(*) from public.import_batches b
          where b.restaurant_id='16470000-0000-4000-8000-000000000020')
          <> (case when v_kind='session' then 4 else 2 end)
     or (select pg_catalog.count(*) from public.import_batch_rows r
          where r.restaurant_id='16470000-0000-4000-8000-000000000020')
          <> (case when v_kind='session' then 4 else 2 end)
     or (select pg_catalog.count(*) from public.inventory_items i
          where i.restaurant_id='16470000-0000-4000-8000-000000000020')
          <> (case when v_kind='session' then 2 else 1 end)
     or (select pg_catalog.count(*) from public.wines w
          where w.restaurant_id='16470000-0000-4000-8000-000000000020')
          <> (case when v_kind='session' then 2 else 1 end)
     or exists(select 1 from public.open_bottles ob
                where ob.restaurant_id='16470000-0000-4000-8000-000000000020')
     or exists(select 1 from public.inventory_command_receipts cr
                where cr.restaurant_id='16470000-0000-4000-8000-000000000020') then
    raise exception 'C09_0164_SOURCE_CONFLICT_CLEANUP_SCOPE_MISMATCH';
  end if;
end;
$c09_0164_source_cleanup_scope$;
delete from public.restaurants
 where id in (select r.id from c09_0164_source_owned_restaurants r);
delete from public.workspaces
 where id in (select w.workspace_id from c09_0164_source_owned_workspaces w);
delete from auth.users
 where id='16470000-0000-4000-8000-000000000001';
do $c09_0164_source_cleanup_postcheck$
begin
  if exists(select 1 from auth.users
             where id='16470000-0000-4000-8000-000000000001')
     or exists(select 1 from public.restaurants r
                join c09_0164_source_owned_restaurants owned on owned.id=r.id)
     or exists(select 1 from public.workspaces w
                join c09_0164_source_owned_workspaces owned
                  on owned.workspace_id=w.id)
     or exists(select 1 from public.import_batches b
                where b.id between '16470000-0000-4000-8000-000000000060'
                               and '16470000-0000-4000-8000-000000000063') then
    raise exception 'C09_0164_SOURCE_CONFLICT_CLEANUP_FAILED';
  end if;
end;
$c09_0164_source_cleanup_postcheck$;
commit;
\echo C09_0164_SOURCE_CONFLICT_RACE_CLEANUP_PASS
