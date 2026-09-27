-- Commit the closed shared-inventory batch or inverse-session race fixture.
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
select 1/case when current_database()=:'expected_database'
  and current_user='postgres' and session_user='postgres'
  and :'target_admitted'='on'
  and :'race_kind' in ('batch','session')
  and :'source_0164_sha256'=
    'b5416022789c096d9b94245770e543465d74a02f60c847270254e862545294ad'
  and not exists(select 1 from auth.users
                  where id='16470000-0000-4000-8000-000000000001')
  and not exists(select 1 from public.restaurants
                  where id='16470000-0000-4000-8000-000000000020')
  and not exists(select 1 from public.import_batches
                  where id between '16470000-0000-4000-8000-000000000060'
                               and '16470000-0000-4000-8000-000000000063')
then 1 else 0 end as c09_0164_source_conflict_setup_target;

begin;
set local statement_timeout='45s';
set local lock_timeout='5s';
insert into auth.users(id,email) values
  ('16470000-0000-4000-8000-000000000001','c09-0164-source-race@terroir.test');
insert into public.workspaces(id,kind,name) values
  ('16470000-0000-4000-8000-000000000010','restaurant','C09 0164 source race');
insert into public.restaurants(id,name,workspace_id) values
  ('16470000-0000-4000-8000-000000000020','C09 0164 source race site','16470000-0000-4000-8000-000000000010');
insert into public.workspace_memberships(
  id,workspace_id,user_id,governance_role,status
) values (
  '16470000-0000-4000-8000-000000000030',
  '16470000-0000-4000-8000-000000000010',
  '16470000-0000-4000-8000-000000000001','group_admin','active'
);
insert into public.memberships(
  id,user_id,restaurant_id,role,workspace_membership_id,status
) values (
  '16470000-0000-4000-8000-000000000040',
  '16470000-0000-4000-8000-000000000001',
  '16470000-0000-4000-8000-000000000020','manager',
  '16470000-0000-4000-8000-000000000030','active'
);
select :'race_kind'='batch' as batch_kind \gset
\if :batch_kind
  insert into public.import_batches(
    id,restaurant_id,created_by,filename,status,total_rows,content_sha256
  ) values
    ('16470000-0000-4000-8000-000000000060','16470000-0000-4000-8000-000000000020','16470000-0000-4000-8000-000000000001','c09-source-a.csv','created',1,pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to('c09-source-a.csv','UTF8')),'hex')),
    ('16470000-0000-4000-8000-000000000061','16470000-0000-4000-8000-000000000020','16470000-0000-4000-8000-000000000001','c09-source-b.csv','created',1,pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to('c09-source-b.csv','UTF8')),'hex'));
  insert into public.import_batch_rows(
    id,batch_id,restaurant_id,row_number,raw,row_state,validation_errors,
    lwin_status,lwin_id,lwin_score,cost_status,resolution,apply_status
  ) values
    ('16470000-0000-4000-8000-000000000070','16470000-0000-4000-8000-000000000060','16470000-0000-4000-8000-000000000020',1,'{"producer":"C09","name":"Shared Source","vintage":"2020","quantity":"1","unit_cost":"10","size_ml":"750"}','valid','[]','matched','LWIN-SOURCE',0.8::real,'present','auto','not_applied'),
    ('16470000-0000-4000-8000-000000000071','16470000-0000-4000-8000-000000000061','16470000-0000-4000-8000-000000000020',1,'{"producer":"C09","name":"Shared Source","vintage":"2020","quantity":"1","unit_cost":"11","size_ml":"750"}','valid','[]','matched','LWIN-SOURCE',0.8::real,'present','auto','not_applied');
  set local role authenticated;
  select pg_catalog.set_config(
    'request.jwt.claim.sub','16470000-0000-4000-8000-000000000001',true
  );
  select * from public.apply_import_batch_chunk(
    '16470000-0000-4000-8000-000000000060',100
  );
  reset role;
  update public.import_batch_rows sibling
     set apply_status='applied',
         applied_inventory_item_id=source.applied_inventory_item_id,
         applied_wine_id=source.applied_wine_id
    from public.import_batch_rows source
   where sibling.id='16470000-0000-4000-8000-000000000071'
     and source.id='16470000-0000-4000-8000-000000000070';
  update public.import_batches
     set status='completed'
   where id='16470000-0000-4000-8000-000000000061';
\else
  insert into public.import_sessions(id,restaurant_id,created_by,label,status) values
    ('16470000-0000-4000-8000-000000000050','16470000-0000-4000-8000-000000000020','16470000-0000-4000-8000-000000000001','C09 source session A','in_progress'),
    ('16470000-0000-4000-8000-000000000051','16470000-0000-4000-8000-000000000020','16470000-0000-4000-8000-000000000001','C09 source session B','in_progress');
  insert into public.import_batches(
    id,restaurant_id,created_by,filename,status,total_rows,session_id,chunk_index,
    content_sha256
  ) values
    ('16470000-0000-4000-8000-000000000060','16470000-0000-4000-8000-000000000020','16470000-0000-4000-8000-000000000001','c09-session-a-x.csv','created',1,'16470000-0000-4000-8000-000000000050',2,pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to('c09-session-a-x.csv','UTF8')),'hex')),
    ('16470000-0000-4000-8000-000000000061','16470000-0000-4000-8000-000000000020','16470000-0000-4000-8000-000000000001','c09-session-a-y.csv','created',1,'16470000-0000-4000-8000-000000000050',1,pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to('c09-session-a-y.csv','UTF8')),'hex')),
    ('16470000-0000-4000-8000-000000000062','16470000-0000-4000-8000-000000000020','16470000-0000-4000-8000-000000000001','c09-session-b-y.csv','created',1,'16470000-0000-4000-8000-000000000051',2,pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to('c09-session-b-y.csv','UTF8')),'hex')),
    ('16470000-0000-4000-8000-000000000063','16470000-0000-4000-8000-000000000020','16470000-0000-4000-8000-000000000001','c09-session-b-x.csv','created',1,'16470000-0000-4000-8000-000000000051',1,pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to('c09-session-b-x.csv','UTF8')),'hex'));
  insert into public.import_batch_rows(
    id,batch_id,restaurant_id,row_number,raw,row_state,validation_errors,
    lwin_status,lwin_id,lwin_score,cost_status,resolution,apply_status
  ) values
    ('16470000-0000-4000-8000-000000000070','16470000-0000-4000-8000-000000000060','16470000-0000-4000-8000-000000000020',1,'{"producer":"C09","name":"Session X","vintage":"2020","quantity":"1","unit_cost":"10","size_ml":"750"}','valid','[]','matched','LWIN-SESSION-X',0.8::real,'present','auto','not_applied'),
    ('16470000-0000-4000-8000-000000000071','16470000-0000-4000-8000-000000000061','16470000-0000-4000-8000-000000000020',1,'{"producer":"C09","name":"Session Y","vintage":"2021","quantity":"1","unit_cost":"11","size_ml":"750"}','valid','[]','matched','LWIN-SESSION-Y',0.8::real,'present','auto','not_applied'),
    ('16470000-0000-4000-8000-000000000072','16470000-0000-4000-8000-000000000062','16470000-0000-4000-8000-000000000020',1,'{"producer":"C09","name":"Session Y","vintage":"2021","quantity":"1","unit_cost":"12","size_ml":"750"}','valid','[]','matched','LWIN-SESSION-Y',0.8::real,'present','auto','not_applied'),
    ('16470000-0000-4000-8000-000000000073','16470000-0000-4000-8000-000000000063','16470000-0000-4000-8000-000000000020',1,'{"producer":"C09","name":"Session X","vintage":"2020","quantity":"1","unit_cost":"13","size_ml":"750"}','valid','[]','matched','LWIN-SESSION-X',0.8::real,'present','auto','not_applied');
  set local role authenticated;
  select pg_catalog.set_config(
    'request.jwt.claim.sub','16470000-0000-4000-8000-000000000001',true
  );
  select * from public.apply_import_batch_chunk('16470000-0000-4000-8000-000000000060',100);
  select * from public.apply_import_batch_chunk('16470000-0000-4000-8000-000000000061',100);
  reset role;
  update public.import_batch_rows sibling
     set apply_status='applied',
         applied_inventory_item_id=source.applied_inventory_item_id,
         applied_wine_id=source.applied_wine_id
    from public.import_batch_rows source
   where (sibling.id,source.id) in (
     ('16470000-0000-4000-8000-000000000072'::uuid,'16470000-0000-4000-8000-000000000071'::uuid),
     ('16470000-0000-4000-8000-000000000073'::uuid,'16470000-0000-4000-8000-000000000070'::uuid)
   );
  update public.import_batches set status='completed'
   where id in (
     '16470000-0000-4000-8000-000000000062',
     '16470000-0000-4000-8000-000000000063'
   );
  update public.import_sessions set status='completed'
   where id in (
     '16470000-0000-4000-8000-000000000050',
     '16470000-0000-4000-8000-000000000051'
   );
\endif

select 1/case when
  (:'race_kind'='batch'
   and (select pg_catalog.count(*) from public.import_batch_rows r
         where r.restaurant_id='16470000-0000-4000-8000-000000000020'
           and r.apply_status='applied')=2
   and (select pg_catalog.count(distinct r.applied_inventory_item_id)
          from public.import_batch_rows r
         where r.restaurant_id='16470000-0000-4000-8000-000000000020')=1)
  or
  (:'race_kind'='session'
   and (select pg_catalog.count(*) from public.import_batch_rows r
         where r.restaurant_id='16470000-0000-4000-8000-000000000020'
           and r.apply_status='applied')=4
   and (select pg_catalog.count(distinct r.applied_inventory_item_id)
          from public.import_batch_rows r
         where r.restaurant_id='16470000-0000-4000-8000-000000000020')=2
   and (select pg_catalog.count(*) from (
          select r.applied_inventory_item_id
            from public.import_batch_rows r
           where r.restaurant_id='16470000-0000-4000-8000-000000000020'
           group by r.applied_inventory_item_id
          having pg_catalog.count(*)=2
        ) shared)=2
   and (select pg_catalog.array_agg(r.applied_wine_id order by b.chunk_index desc)
          from public.import_batches b
          join public.import_batch_rows r on r.batch_id=b.id
         where b.session_id='16470000-0000-4000-8000-000000000050')
       = (select pg_catalog.array_agg(r.applied_wine_id order by b.chunk_index asc)
            from public.import_batches b
            join public.import_batch_rows r on r.batch_id=b.id
           where b.session_id='16470000-0000-4000-8000-000000000051')
   and (select pg_catalog.array_agg(r.applied_inventory_item_id order by b.chunk_index desc)
          from public.import_batches b
          join public.import_batch_rows r on r.batch_id=b.id
         where b.session_id='16470000-0000-4000-8000-000000000050')
       = (select pg_catalog.array_agg(r.applied_inventory_item_id order by b.chunk_index asc)
            from public.import_batches b
            join public.import_batch_rows r on r.batch_id=b.id
           where b.session_id='16470000-0000-4000-8000-000000000051'))
then 1 else 0 end as c09_0164_source_conflict_setup_exact;

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
  )::text,'UTF8')),'hex') as before_state_sha256 \gset
commit;
\echo C09_0164_SOURCE_CONFLICT_SETUP_PASS :before_state_sha256
