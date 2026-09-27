-- Commit one closed two-wine fixture for one admitted 0164 race invocation.
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
  and not exists(select 1 from auth.users
                  where id='16440000-0000-4000-8000-000000000001')
  and not exists(select 1 from public.restaurants
                  where id='16440000-0000-4000-8000-000000000020')
  and not exists(select 1 from public.import_batches
                  where id in (
                    '16440000-0000-4000-8000-000000000060',
                    '16440000-0000-4000-8000-000000000061'
                  ))
then 1 else 0 end as c09_0164_concurrency_setup_target;

begin;
set local statement_timeout='45s';
set local lock_timeout='5s';
insert into auth.users(id,email) values
  ('16440000-0000-4000-8000-000000000001','c09-0164-race@terroir.test');
insert into public.workspaces(id,kind,name) values
  ('16440000-0000-4000-8000-000000000010','restaurant','C09 0164 race');
insert into public.restaurants(id,name,workspace_id) values
  ('16440000-0000-4000-8000-000000000020','C09 0164 race site','16440000-0000-4000-8000-000000000010');
insert into public.workspace_memberships(
  id,workspace_id,user_id,governance_role,status
) values (
  '16440000-0000-4000-8000-000000000030',
  '16440000-0000-4000-8000-000000000010',
  '16440000-0000-4000-8000-000000000001','group_admin','active'
);
insert into public.memberships(
  id,user_id,restaurant_id,role,workspace_membership_id,status
) values (
  '16440000-0000-4000-8000-000000000040',
  '16440000-0000-4000-8000-000000000001',
  '16440000-0000-4000-8000-000000000020','manager',
  '16440000-0000-4000-8000-000000000030','active'
);
insert into public.wines(
  id,restaurant_id,name,producer,vintage,size_ml
) values
  ('16440000-0000-4000-8000-000000000050','16440000-0000-4000-8000-000000000020','Race X','C09',2020,750),
  ('16440000-0000-4000-8000-000000000051','16440000-0000-4000-8000-000000000020','Race Y','C09',2021,750);
insert into public.import_batches(
  id,restaurant_id,created_by,filename,status,total_rows,content_sha256
) values
  ('16440000-0000-4000-8000-000000000060','16440000-0000-4000-8000-000000000020','16440000-0000-4000-8000-000000000001','c09-revert.csv','created',2,pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to('c09-revert.csv','UTF8')),'hex')),
  ('16440000-0000-4000-8000-000000000061','16440000-0000-4000-8000-000000000020','16440000-0000-4000-8000-000000000001','c09-apply.csv','created',2,pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to('c09-apply.csv','UTF8')),'hex'));
insert into public.import_batch_rows(
  id,batch_id,restaurant_id,row_number,raw,row_state,validation_errors,
  lwin_status,lwin_id,lwin_score,cost_status,resolution,apply_status
) values
  ('16440000-0000-4000-8000-000000000070','16440000-0000-4000-8000-000000000060','16440000-0000-4000-8000-000000000020',1,'{"producer":"C09","name":"Race X","vintage":"2020","quantity":"1","unit_cost":"10","size_ml":"750"}','valid','[]','unmatched',null,null,'present','auto','not_applied'),
  ('16440000-0000-4000-8000-000000000071','16440000-0000-4000-8000-000000000060','16440000-0000-4000-8000-000000000020',2,'{"producer":"C09","name":"Race Y","vintage":"2021","quantity":"1","unit_cost":"11","size_ml":"750"}','valid','[]','unmatched',null,null,'present','auto','not_applied'),
  ('16440000-0000-4000-8000-000000000072','16440000-0000-4000-8000-000000000061','16440000-0000-4000-8000-000000000020',1,'{"producer":"C09","name":"Race Y","vintage":"2021","quantity":"1","unit_cost":"12","size_ml":"750"}','valid','[]','unmatched',null,null,'present','auto','not_applied'),
  ('16440000-0000-4000-8000-000000000073','16440000-0000-4000-8000-000000000061','16440000-0000-4000-8000-000000000020',2,'{"producer":"C09","name":"Race X","vintage":"2020","quantity":"1","unit_cost":"13","size_ml":"750"}','valid','[]','unmatched',null,null,'present','auto','not_applied');
set local role authenticated;
select pg_catalog.set_config(
  'request.jwt.claim.sub','16440000-0000-4000-8000-000000000001',true
);
select * from public.apply_import_batch_chunk(
  '16440000-0000-4000-8000-000000000060',100
);
reset role;
select 1 / case when (select pg_catalog.count(*)
  from public.import_batch_rows r
 where r.batch_id='16440000-0000-4000-8000-000000000060'
   and r.apply_status='applied'
   and r.applied_inventory_item_id is not null)=2
and (select pg_catalog.count(*) from public.inventory_items i
      where i.restaurant_id='16440000-0000-4000-8000-000000000020')=2
then 1 else 0 end as c09_0164_concurrency_setup_applied;
commit;
\echo C09_0164_CONCURRENCY_SETUP_PASS
