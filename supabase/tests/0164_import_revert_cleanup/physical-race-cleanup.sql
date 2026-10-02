-- Delete only the closed physical-open/revert race fixture.
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
\if :{?race_mode}
\else
  \quit 3
\endif
select 1/case when current_database()=:'expected_database'
  and current_user='postgres' and session_user='postgres'
  and :'target_admitted'='on'
  and :'race_mode' in ('open_first','revert_first')
  and :'source_0164_sha256'=
    '2d535f329b600c3dfc33b23494532f93c023b1a89c6aad055b8de3a865ee49ff'
then 1 else 0 end as c09_0164_physical_cleanup_target;

begin;
set local statement_timeout='45s';
set local lock_timeout='5s';
create temporary table c09_0164_physical_owned_restaurants on commit drop as
select distinct r.id,r.workspace_id,r.name
  from public.memberships m
  join public.restaurants r on r.id=m.restaurant_id
 where m.user_id='16460000-0000-4000-8000-000000000001'
union
select r.id,r.workspace_id,r.name from public.restaurants r
 where r.id='16460000-0000-4000-8000-000000000020';
create temporary table c09_0164_physical_owned_workspaces on commit drop as
select distinct owned.workspace_id
  from c09_0164_physical_owned_restaurants owned
union
select wm.workspace_id from public.workspace_memberships wm
 where wm.user_id='16460000-0000-4000-8000-000000000001';
select pg_catalog.set_config('c09.physical_race_mode',:'race_mode',true);
do $c09_0164_physical_cleanup_scope$
declare
  v_open_first boolean :=
    pg_catalog.current_setting('c09.physical_race_mode')='open_first';
begin
  if (select pg_catalog.count(*)
        from c09_0164_physical_owned_restaurants)<>2
     or (select pg_catalog.count(*)
           from c09_0164_physical_owned_restaurants r
          where r.id='16460000-0000-4000-8000-000000000020'
            and r.workspace_id='16460000-0000-4000-8000-000000000010'
            and r.name='C09 0164 physical race site')<>1
     or (select pg_catalog.count(*)
           from c09_0164_physical_owned_restaurants r
          where r.id<>'16460000-0000-4000-8000-000000000020'
            and r.name='My Restaurant')<>1
     or (select pg_catalog.count(*)
           from c09_0164_physical_owned_workspaces)<>2
     or exists(
       (select w.workspace_id from c09_0164_physical_owned_workspaces w)
       except
       (select r.workspace_id from c09_0164_physical_owned_restaurants r)
     )
     or exists(
       (select r.workspace_id from c09_0164_physical_owned_restaurants r)
       except
       (select w.workspace_id from c09_0164_physical_owned_workspaces w)
     )
     or (select pg_catalog.count(*) from public.memberships m
          where m.user_id='16460000-0000-4000-8000-000000000001')<>2
     or exists(select 1 from public.memberships m
                where m.user_id='16460000-0000-4000-8000-000000000001'
                  and not exists(
                    select 1 from c09_0164_physical_owned_restaurants r
                     where r.id=m.restaurant_id
                  ))
     or (select pg_catalog.count(*) from public.memberships m
          join c09_0164_physical_owned_restaurants r
            on r.id=m.restaurant_id)<>2
     or exists(select 1 from public.memberships m
                join c09_0164_physical_owned_restaurants r
                  on r.id=m.restaurant_id
               where m.user_id<>'16460000-0000-4000-8000-000000000001')
     or (select pg_catalog.count(*) from public.workspace_memberships wm
          where wm.user_id='16460000-0000-4000-8000-000000000001')<>2
     or exists(select 1 from public.workspace_memberships wm
                where wm.user_id='16460000-0000-4000-8000-000000000001'
                  and not exists(
                    select 1 from c09_0164_physical_owned_workspaces w
                     where w.workspace_id=wm.workspace_id
                  ))
     or (select pg_catalog.count(*) from public.workspace_memberships wm
          join c09_0164_physical_owned_workspaces w
            on w.workspace_id=wm.workspace_id)<>2
     or exists(select 1 from public.workspace_memberships wm
                join c09_0164_physical_owned_workspaces w
                  on w.workspace_id=wm.workspace_id
               where wm.user_id<>'16460000-0000-4000-8000-000000000001')
     or (select pg_catalog.count(*) from public.import_batches b
          where b.restaurant_id='16460000-0000-4000-8000-000000000020'
            and b.id='16460000-0000-4000-8000-000000000060')<>1
     or (select pg_catalog.count(*) from public.import_batch_rows r
          where r.restaurant_id='16460000-0000-4000-8000-000000000020'
            and r.id='16460000-0000-4000-8000-000000000070')<>1
     or (select pg_catalog.count(*) from public.wines w
          where w.restaurant_id='16460000-0000-4000-8000-000000000020')<>1
     or (select pg_catalog.count(*) from public.inventory_items i
          where i.restaurant_id='16460000-0000-4000-8000-000000000020')
          <> (case when v_open_first then 1 else 0 end)
     or (select pg_catalog.count(*) from public.open_bottles ob
          where ob.restaurant_id='16460000-0000-4000-8000-000000000020')
          <> (case when v_open_first then 1 else 0 end)
     or (select pg_catalog.count(*) from public.inventory_command_receipts cr
          where cr.restaurant_id='16460000-0000-4000-8000-000000000020')
          <> (case when v_open_first then 1 else 0 end)
     or (select pg_catalog.count(*) from public.pour_events pe
          where pe.restaurant_id='16460000-0000-4000-8000-000000000020')
          <> (case when v_open_first then 1 else 0 end)
     or (select pg_catalog.count(*) from public.inventory_command_bottle_effects e
          where e.restaurant_id='16460000-0000-4000-8000-000000000020')
          <> (case when v_open_first then 1 else 0 end)
     or exists(select 1 from public.bottle_closeouts bc
                where bc.restaurant_id='16460000-0000-4000-8000-000000000020')
     or not exists(
       select 1
         from public.import_batches b
         join public.import_batch_rows r on r.batch_id=b.id
         join public.wines w on w.id=r.applied_wine_id
          and w.restaurant_id=r.restaurant_id
        where b.id='16460000-0000-4000-8000-000000000060'
          and r.id='16460000-0000-4000-8000-000000000070'
          and b.status=case when v_open_first then 'completed' else 'reverted' end
          and r.apply_status=case when v_open_first then 'applied' else 'reverted' end
          and (v_open_first or r.applied_inventory_item_id is null)
          and w.lwin_id is not distinct from
            case when v_open_first then 'LWIN-PHYSICAL-RACE' else null end
          and w.lwin_match_score is not distinct from
            case when v_open_first then 0.9::real else null::real end
     )
     or (v_open_first and not exists(
       select 1
         from public.import_batch_rows r
         join public.inventory_items i on i.id=r.applied_inventory_item_id
          and i.restaurant_id=r.restaurant_id and i.wine_id=r.applied_wine_id
         join public.open_bottles ob on ob.source_inventory_item_id=i.id
          and ob.restaurant_id=i.restaurant_id and ob.wine_id=i.wine_id
         join public.inventory_command_receipts cr
          on cr.restaurant_id=i.restaurant_id
         and cr.operation_id='16460000-0000-4000-8000-000000000080'
         join public.pour_events pe on pe.restaurant_id=cr.restaurant_id
          and pe.operation_id=cr.operation_id and pe.open_bottle_id=ob.id
         join public.inventory_command_bottle_effects e
          on e.restaurant_id=cr.restaurant_id
         and e.operation_id=cr.operation_id and e.open_bottle_id=ob.id
        where r.id='16460000-0000-4000-8000-000000000070'
          and i.quantity=0 and cr.actor_user_id='16460000-0000-4000-8000-000000000001'
          and cr.command_type='open' and cr.command_version=2
          and cr.scope_kind='single_wine'
          and pe.kind='new_bottle' and pe.ml_delta=-750
          and e.effect_type='open'
     )) then
    raise exception 'C09_0164_PHYSICAL_CLEANUP_SCOPE_MISMATCH';
  end if;
end;
$c09_0164_physical_cleanup_scope$;

delete from public.inventory_command_bottle_effects
 where restaurant_id='16460000-0000-4000-8000-000000000020';
delete from public.bottle_closeouts
 where restaurant_id='16460000-0000-4000-8000-000000000020';
delete from public.pour_events
 where restaurant_id='16460000-0000-4000-8000-000000000020';
delete from public.inventory_command_receipts
 where restaurant_id='16460000-0000-4000-8000-000000000020';
delete from public.open_bottles
 where restaurant_id='16460000-0000-4000-8000-000000000020';
delete from public.restaurants
 where id in (select r.id from c09_0164_physical_owned_restaurants r);
delete from public.workspaces
 where id in (select w.workspace_id from c09_0164_physical_owned_workspaces w);
delete from auth.users
 where id='16460000-0000-4000-8000-000000000001';

do $c09_0164_physical_cleanup_postcheck$
begin
  if exists(select 1 from auth.users
             where id='16460000-0000-4000-8000-000000000001')
     or exists(select 1 from public.restaurants r
                join c09_0164_physical_owned_restaurants owned on owned.id=r.id)
     or exists(select 1 from public.workspaces w
                join c09_0164_physical_owned_workspaces owned
                  on owned.workspace_id=w.id)
     or exists(select 1 from public.import_batches b
                where b.id='16460000-0000-4000-8000-000000000060')
     or exists(select 1 from public.import_batch_rows r
                where r.id='16460000-0000-4000-8000-000000000070')
     or exists(select 1 from public.inventory_command_receipts cr
                where cr.operation_id='16460000-0000-4000-8000-000000000080') then
    raise exception 'C09_0164_PHYSICAL_CLEANUP_FAILED';
  end if;
end;
$c09_0164_physical_cleanup_postcheck$;
commit;
\echo C09_0164_PHYSICAL_RACE_CLEANUP_PASS
