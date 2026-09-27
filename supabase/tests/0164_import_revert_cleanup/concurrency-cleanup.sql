-- Delete only the closed reserved race fixture, including auto-onboarding parents.
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
select 1 / case when current_database()=:'expected_database'
  and current_user='postgres' and session_user='postgres'
  and :'target_admitted'='on'
  and :'source_0164_sha256'=
    'b5416022789c096d9b94245770e543465d74a02f60c847270254e862545294ad'
then 1 else 0 end as c09_0164_cleanup_target;
begin;
set local statement_timeout='45s';
set local lock_timeout='5s';
create temporary table c09_0164_owned_restaurants on commit drop as
select distinct r.id,r.workspace_id,r.name
  from public.memberships m
  join public.restaurants r on r.id=m.restaurant_id
 where m.user_id='16440000-0000-4000-8000-000000000001'
union
select r.id,r.workspace_id,r.name from public.restaurants r
 where r.id='16440000-0000-4000-8000-000000000020';
create temporary table c09_0164_owned_workspaces on commit drop as
select distinct owned.workspace_id from c09_0164_owned_restaurants owned
union
select wm.workspace_id from public.workspace_memberships wm
 where wm.user_id='16440000-0000-4000-8000-000000000001';
do $c09_0164_cleanup_scope$
begin
  if (select pg_catalog.count(*) from c09_0164_owned_restaurants)<>2
     or (select pg_catalog.count(*) from c09_0164_owned_restaurants r
          where r.id='16440000-0000-4000-8000-000000000020'
            and r.workspace_id='16440000-0000-4000-8000-000000000010'
            and r.name='C09 0164 race site')<>1
     or (select pg_catalog.count(*) from c09_0164_owned_restaurants r
          where r.id<>'16440000-0000-4000-8000-000000000020'
            and r.name='My Restaurant')<>1
     or (select pg_catalog.count(*) from c09_0164_owned_workspaces)<>2
     or exists(
       (select w.workspace_id from c09_0164_owned_workspaces w)
       except
       (select r.workspace_id from c09_0164_owned_restaurants r)
     )
     or exists(
       (select r.workspace_id from c09_0164_owned_restaurants r)
       except
       (select w.workspace_id from c09_0164_owned_workspaces w)
     )
     or (select pg_catalog.count(*) from public.memberships m
          where m.user_id='16440000-0000-4000-8000-000000000001')<>2
     or exists(select 1 from public.memberships m
                where m.user_id='16440000-0000-4000-8000-000000000001'
                  and not exists(select 1
                                   from c09_0164_owned_restaurants r
                                  where r.id=m.restaurant_id))
     or (select pg_catalog.count(*) from public.memberships m
          join c09_0164_owned_restaurants r on r.id=m.restaurant_id)<>2
     or exists(select 1 from public.memberships m
                join c09_0164_owned_restaurants r on r.id=m.restaurant_id
               where m.user_id<>'16440000-0000-4000-8000-000000000001')
     or (select pg_catalog.count(*) from public.workspace_memberships wm
          where wm.user_id='16440000-0000-4000-8000-000000000001')<>2
     or exists(select 1 from public.workspace_memberships wm
                where wm.user_id='16440000-0000-4000-8000-000000000001'
                  and not exists(select 1
                                   from c09_0164_owned_workspaces w
                                  where w.workspace_id=wm.workspace_id))
     or (select pg_catalog.count(*) from public.workspace_memberships wm
          join c09_0164_owned_workspaces w on w.workspace_id=wm.workspace_id)<>2
     or exists(select 1 from public.workspace_memberships wm
                join c09_0164_owned_workspaces w on w.workspace_id=wm.workspace_id
               where wm.user_id<>'16440000-0000-4000-8000-000000000001')
     or exists(select 1 from public.import_batches b
                where b.restaurant_id='16440000-0000-4000-8000-000000000020'
                  and b.id not in (
                    '16440000-0000-4000-8000-000000000060',
                    '16440000-0000-4000-8000-000000000061'
                  ))
     or (select pg_catalog.count(*) from public.import_batches b
          where b.restaurant_id='16440000-0000-4000-8000-000000000020')<>2
     or (select pg_catalog.count(*) from public.import_batch_rows r
          where r.restaurant_id='16440000-0000-4000-8000-000000000020')<>4
     or exists(select 1 from public.import_batch_rows r
                where r.restaurant_id='16440000-0000-4000-8000-000000000020'
                  and r.id not in (
                    '16440000-0000-4000-8000-000000000070',
                    '16440000-0000-4000-8000-000000000071',
                    '16440000-0000-4000-8000-000000000072',
                    '16440000-0000-4000-8000-000000000073'
                  ))
     or (select pg_catalog.count(*) from public.wines w
          where w.restaurant_id='16440000-0000-4000-8000-000000000020')<>2
     or exists(select 1 from public.wines w
                where w.restaurant_id='16440000-0000-4000-8000-000000000020'
                  and w.id not in (
                    '16440000-0000-4000-8000-000000000050',
                    '16440000-0000-4000-8000-000000000051'
                  ))
     or (select pg_catalog.count(*) from public.inventory_items i
          where i.restaurant_id='16440000-0000-4000-8000-000000000020')<>2
     or (select pg_catalog.count(*) from public.import_batch_rows r
          where r.id in (
            '16440000-0000-4000-8000-000000000070',
            '16440000-0000-4000-8000-000000000071',
            '16440000-0000-4000-8000-000000000072',
            '16440000-0000-4000-8000-000000000073'
          )
            and r.apply_status='applied'
            and r.applied_inventory_item_id is not null)<>2
     or exists(select 1 from public.inventory_items i
                where i.restaurant_id='16440000-0000-4000-8000-000000000020'
                  and not exists(
                    select 1 from public.import_batch_rows r
                     where r.id in (
                       '16440000-0000-4000-8000-000000000070',
                       '16440000-0000-4000-8000-000000000071',
                       '16440000-0000-4000-8000-000000000072',
                       '16440000-0000-4000-8000-000000000073'
                     )
                       and r.apply_status='applied'
                       and r.applied_inventory_item_id=i.id
                  ))
     or exists(select 1 from public.open_bottles ob
                where ob.restaurant_id='16440000-0000-4000-8000-000000000020') then
    raise exception 'C09_0164_CONCURRENCY_CLEANUP_SCOPE_MISMATCH';
  end if;
end;
$c09_0164_cleanup_scope$;
delete from public.restaurants
 where id in (select r.id from c09_0164_owned_restaurants r);
delete from public.workspaces
 where id in (select w.workspace_id from c09_0164_owned_workspaces w);
delete from auth.users
 where id='16440000-0000-4000-8000-000000000001';
do $c09_0164_cleanup_postcheck$
begin
  if exists(select 1 from auth.users
             where id='16440000-0000-4000-8000-000000000001')
     or exists(select 1 from public.restaurants r
                join c09_0164_owned_restaurants owned on owned.id=r.id)
     or exists(select 1 from public.workspaces w
                join c09_0164_owned_workspaces owned
                  on owned.workspace_id=w.id)
     or exists(select 1 from public.import_batches b
                where b.id in (
                  '16440000-0000-4000-8000-000000000060',
                  '16440000-0000-4000-8000-000000000061'
                )) then
    raise exception 'C09_0164_CONCURRENCY_CLEANUP_FAILED';
  end if;
end;
$c09_0164_cleanup_postcheck$;
commit;
\echo C09_0164_CONCURRENCY_CLEANUP_PASS
