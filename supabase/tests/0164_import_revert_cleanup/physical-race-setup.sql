-- Create one closed committed physical-open/revert race fixture.
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
select 1/case when current_database()=:'expected_database'
  and current_user='postgres' and session_user='postgres'
  and :'target_admitted'='on'
  and :'source_0164_sha256'=
    'b5416022789c096d9b94245770e543465d74a02f60c847270254e862545294ad'
  and not exists(select 1 from auth.users
                  where id='16460000-0000-4000-8000-000000000001')
  and not exists(select 1 from public.restaurants
                  where id='16460000-0000-4000-8000-000000000020')
  and not exists(select 1 from public.import_batches
                  where id='16460000-0000-4000-8000-000000000060')
then 1 else 0 end as c09_0164_physical_setup_target;

begin;
set local statement_timeout='45s';
set local lock_timeout='5s';
insert into auth.users(id,email) values
  ('16460000-0000-4000-8000-000000000001','c09-0164-physical-race@terroir.test');
insert into public.workspaces(id,kind,name) values
  ('16460000-0000-4000-8000-000000000010','restaurant','C09 0164 physical race');
insert into public.restaurants(id,name,workspace_id) values
  ('16460000-0000-4000-8000-000000000020','C09 0164 physical race site','16460000-0000-4000-8000-000000000010');
insert into public.workspace_memberships(
  id,workspace_id,user_id,governance_role,status
) values (
  '16460000-0000-4000-8000-000000000030',
  '16460000-0000-4000-8000-000000000010',
  '16460000-0000-4000-8000-000000000001','group_admin','active'
);
insert into public.memberships(
  id,user_id,restaurant_id,role,workspace_membership_id,status
) values (
  '16460000-0000-4000-8000-000000000040',
  '16460000-0000-4000-8000-000000000001',
  '16460000-0000-4000-8000-000000000020','manager',
  '16460000-0000-4000-8000-000000000030','active'
);
insert into public.import_batches(
  id,restaurant_id,created_by,filename,status,total_rows,content_sha256
) values (
  '16460000-0000-4000-8000-000000000060',
  '16460000-0000-4000-8000-000000000020',
  '16460000-0000-4000-8000-000000000001','c09-physical-race.csv',
  'created',1,pg_catalog.encode(pg_catalog.sha256(
    pg_catalog.convert_to('c09-physical-race.csv','UTF8')
  ),'hex')
);
insert into public.import_batch_rows(
  id,batch_id,restaurant_id,row_number,raw,row_state,validation_errors,
  lwin_status,lwin_id,lwin_score,cost_status,resolution,apply_status
) values (
  '16460000-0000-4000-8000-000000000070',
  '16460000-0000-4000-8000-000000000060',
  '16460000-0000-4000-8000-000000000020',1,
  '{"producer":"C09","name":"Physical Race","vintage":"2026","quantity":"1","unit_cost":"25","size_ml":"750"}',
  'valid','[]','matched','LWIN-PHYSICAL-RACE',0.9::real,'present','auto','not_applied'
);
set local role authenticated;
select pg_catalog.set_config(
  'request.jwt.claim.sub','16460000-0000-4000-8000-000000000001',true
);
select * from public.apply_import_batch_chunk(
  '16460000-0000-4000-8000-000000000060',100
);
reset role;
select 1/case when exists(
  select 1 from public.import_batches b
  join public.import_batch_rows r on r.batch_id=b.id
  join public.inventory_items i on i.id=r.applied_inventory_item_id
    and i.restaurant_id=r.restaurant_id and i.wine_id=r.applied_wine_id
  join public.wines w on w.id=r.applied_wine_id
    and w.restaurant_id=r.restaurant_id
 where b.id='16460000-0000-4000-8000-000000000060'
   and b.status='completed' and r.id='16460000-0000-4000-8000-000000000070'
   and r.apply_status='applied' and i.quantity=1
   and r.updated_at=w.updated_at and r.lwin_id=w.lwin_id
   and r.lwin_score=w.lwin_match_score
) and not exists(
  select 1 from public.open_bottles ob
   where ob.restaurant_id='16460000-0000-4000-8000-000000000020'
) then 1 else 0 end as c09_0164_physical_setup_applied;
commit;
\echo C09_0164_PHYSICAL_RACE_SETUP_PASS
