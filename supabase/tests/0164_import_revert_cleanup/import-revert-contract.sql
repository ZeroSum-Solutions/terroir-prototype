-- 0164 retained-catalog import-revert rollback-only functional contract.
\set ON_ERROR_STOP on
\pset pager off

\if :{?expected_database}
\else
  \echo C09_0164_EXPECTED_DATABASE_REQUIRED
  \quit 3
\endif
\if :{?target_admitted}
\else
  \echo C09_0164_TARGET_ADMISSION_REQUIRED
  \quit 3
\endif
\if :{?source_0164_sha256}
\else
  \echo C09_0164_SOURCE_PIN_REQUIRED
  \quit 3
\endif

select 1 / case when current_database() = :'expected_database'
  and current_user = 'postgres' and session_user = 'postgres'
  and :'target_admitted' = 'on'
  and :'source_0164_sha256' =
    '2d535f329b600c3dfc33b23494532f93c023b1a89c6aad055b8de3a865ee49ff'
  and pg_catalog.to_regprocedure(
    'public.revert_import_batch_core_private(uuid,uuid[])'
  ) is not null
  and pg_catalog.to_regprocedure(
    'public.revert_import_batch_private(uuid)'
  ) is not null
then 1 else 0 end as c09_0164_target_admitted;

begin;
set local statement_timeout = '45s';
set local lock_timeout = '5s';

insert into auth.users(id,email) values
  ('16400000-0000-4000-8000-000000000001','c09-0164-owner@terroir.test'),
  ('16400000-0000-4000-8000-000000000002','c09-0164-manager@terroir.test'),
  ('16400000-0000-4000-8000-000000000003','c09-0164-staff@terroir.test'),
  ('16400000-0000-4000-8000-000000000004','c09-0164-foreign@terroir.test'),
  ('16400000-0000-4000-8000-000000000005','c09-0164-revoked@terroir.test');
insert into public.workspaces(id,kind,name) values
  ('16400000-0000-4000-8000-000000000010','restaurant','C09 0164 workspace'),
  ('16400000-0000-4000-8000-000000000011','restaurant','C09 0164 foreign workspace');
insert into public.restaurants(id,name,workspace_id) values
  ('16400000-0000-4000-8000-000000000020','C09 0164 site','16400000-0000-4000-8000-000000000010'),
  ('16400000-0000-4000-8000-000000000021','C09 0164 foreign','16400000-0000-4000-8000-000000000011');
insert into public.workspace_memberships(
  id,workspace_id,user_id,governance_role
) values
  ('16400000-0000-4000-8000-000000000030','16400000-0000-4000-8000-000000000010','16400000-0000-4000-8000-000000000001','workspace_owner'),
  ('16400000-0000-4000-8000-000000000031','16400000-0000-4000-8000-000000000010','16400000-0000-4000-8000-000000000002','group_admin'),
  ('16400000-0000-4000-8000-000000000032','16400000-0000-4000-8000-000000000010','16400000-0000-4000-8000-000000000003',null),
  ('16400000-0000-4000-8000-000000000033','16400000-0000-4000-8000-000000000011','16400000-0000-4000-8000-000000000004','group_admin'),
  ('16400000-0000-4000-8000-000000000034','16400000-0000-4000-8000-000000000010','16400000-0000-4000-8000-000000000005',null);
insert into public.memberships(
  id,user_id,restaurant_id,role,workspace_membership_id
) values
  ('16400000-0000-4000-8000-000000000040','16400000-0000-4000-8000-000000000001','16400000-0000-4000-8000-000000000020','owner','16400000-0000-4000-8000-000000000030'),
  ('16400000-0000-4000-8000-000000000041','16400000-0000-4000-8000-000000000002','16400000-0000-4000-8000-000000000020','manager','16400000-0000-4000-8000-000000000031'),
  ('16400000-0000-4000-8000-000000000042','16400000-0000-4000-8000-000000000003','16400000-0000-4000-8000-000000000020','staff','16400000-0000-4000-8000-000000000032'),
  ('16400000-0000-4000-8000-000000000043','16400000-0000-4000-8000-000000000004','16400000-0000-4000-8000-000000000021','manager','16400000-0000-4000-8000-000000000033'),
  ('16400000-0000-4000-8000-000000000044','16400000-0000-4000-8000-000000000005','16400000-0000-4000-8000-000000000020','staff','16400000-0000-4000-8000-000000000034');
update public.memberships set status='revoked',revoked_at=pg_catalog.statement_timestamp()
 where id='16400000-0000-4000-8000-000000000044';

insert into public.import_sessions(
  id,restaurant_id,created_by,label,status
) values (
  '16400000-0000-4000-8000-000000000050',
  '16400000-0000-4000-8000-000000000020',
  '16400000-0000-4000-8000-000000000003','C09 shared pair','in_progress'
);
insert into public.import_batches(
  id,restaurant_id,created_by,filename,status,total_rows,session_id,chunk_index,
  content_sha256
) values
  ('16400000-0000-4000-8000-000000000061','16400000-0000-4000-8000-000000000020','16400000-0000-4000-8000-000000000003','c09-session-1.csv','created',1,'16400000-0000-4000-8000-000000000050',1,pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to('c09-session-1.csv','UTF8')),'hex')),
  ('16400000-0000-4000-8000-000000000062','16400000-0000-4000-8000-000000000020','16400000-0000-4000-8000-000000000003','c09-session-2.csv','created',1,'16400000-0000-4000-8000-000000000050',2,pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to('c09-session-2.csv','UTF8')),'hex')),
  ('16400000-0000-4000-8000-000000000063','16400000-0000-4000-8000-000000000020','16400000-0000-4000-8000-000000000003','c09-batch.csv','created',1,null,null,pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to('c09-batch.csv','UTF8')),'hex')),
  ('16400000-0000-4000-8000-000000000064','16400000-0000-4000-8000-000000000020','16400000-0000-4000-8000-000000000003','c09-physical.csv','created',1,null,null,pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to('c09-physical.csv','UTF8')),'hex')),
  ('16400000-0000-4000-8000-000000000065','16400000-0000-4000-8000-000000000020','16400000-0000-4000-8000-000000000003','c09-atomic.csv','created',1,null,null,pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to('c09-atomic.csv','UTF8')),'hex')),
  ('16400000-0000-4000-8000-000000000066','16400000-0000-4000-8000-000000000020','16400000-0000-4000-8000-000000000003','c09-legacy.csv','created',1,null,null,pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to('c09-legacy.csv','UTF8')),'hex')),
  ('16400000-0000-4000-8000-000000000067','16400000-0000-4000-8000-000000000020','16400000-0000-4000-8000-000000000001','c09-owner-empty.csv','created',0,null,null,pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to('c09-owner-empty.csv','UTF8')),'hex')),
  ('16400000-0000-4000-8000-000000000068','16400000-0000-4000-8000-000000000020','16400000-0000-4000-8000-000000000002','c09-manager-empty.csv','created',0,null,null,pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to('c09-manager-empty.csv','UTF8')),'hex'));

insert into public.import_batch_rows(
  id,batch_id,restaurant_id,row_number,raw,row_state,validation_errors,
  lwin_status,lwin_id,lwin_score,cost_status,resolution,apply_status
) values
  ('16400000-0000-4000-8000-000000000071','16400000-0000-4000-8000-000000000061','16400000-0000-4000-8000-000000000020',1,'{"producer":"Contract","name":"Shared Pair","vintage":"2020","quantity":"1","unit_cost":"10","size_ml":"750"}','valid','[]','matched','LWIN-SHARED',0.8,'present','auto','not_applied'),
  ('16400000-0000-4000-8000-000000000072','16400000-0000-4000-8000-000000000062','16400000-0000-4000-8000-000000000020',1,'{"producer":"Contract","name":"Shared Pair","vintage":"2020","quantity":"1","unit_cost":"11","size_ml":"750"}','valid','[]','matched','LWIN-SHARED',0.8,'present','auto','not_applied'),
  ('16400000-0000-4000-8000-000000000073','16400000-0000-4000-8000-000000000063','16400000-0000-4000-8000-000000000020',1,'{"producer":"Contract","name":"Batch Pair","vintage":"2021","quantity":"2","unit_cost":"12","size_ml":"750"}','valid','[]','matched','LWIN-BATCH',0.9,'present','auto','not_applied'),
  ('16400000-0000-4000-8000-000000000074','16400000-0000-4000-8000-000000000064','16400000-0000-4000-8000-000000000020',1,'{"producer":"Contract","name":"Physical Pair","vintage":"2022","quantity":"1","unit_cost":"13","size_ml":"750"}','valid','[]','matched','LWIN-PHYSICAL',0.9,'present','auto','not_applied'),
  ('16400000-0000-4000-8000-000000000075','16400000-0000-4000-8000-000000000065','16400000-0000-4000-8000-000000000020',1,'{"producer":"Contract","name":"Atomic Pair","vintage":"2023","quantity":"1","unit_cost":"14","size_ml":"750"}','valid','[]','matched','LWIN-ATOMIC',0.9,'present','auto','not_applied'),
  ('16400000-0000-4000-8000-000000000076','16400000-0000-4000-8000-000000000066','16400000-0000-4000-8000-000000000020',1,'{"producer":"Contract","name":"Legacy Pair","vintage":"2024","quantity":"1","unit_cost":"15","size_ml":"750"}','valid','[]','matched','LWIN-LEGACY',0.9,'present','auto','not_applied');

set local role authenticated;
select pg_catalog.set_config(
  'request.jwt.claim.sub','16400000-0000-4000-8000-000000000003',true
);
select * from public.apply_import_batch_chunk('16400000-0000-4000-8000-000000000061',100);
select * from public.apply_import_batch_chunk('16400000-0000-4000-8000-000000000062',100);
select * from public.apply_import_batch_chunk('16400000-0000-4000-8000-000000000063',100);
select * from public.apply_import_batch_chunk('16400000-0000-4000-8000-000000000064',100);
select * from public.apply_import_batch_chunk('16400000-0000-4000-8000-000000000065',100);
select * from public.apply_import_batch_chunk('16400000-0000-4000-8000-000000000066',100);

reset role;
insert into public.import_batch_rows(
  id,batch_id,restaurant_id,row_number,raw,row_state,validation_errors,
  lwin_status,lwin_id,lwin_score,cost_status,resolution,apply_status,
  applied_inventory_item_id,applied_wine_id
)
select '16400000-0000-4000-8000-000000000090',
       '16400000-0000-4000-8000-000000000061',r.restaurant_id,90,r.raw,
       r.row_state,r.validation_errors,r.lwin_status,r.lwin_id,r.lwin_score,
       r.cost_status,r.resolution,'applied',r.applied_inventory_item_id,
       r.applied_wine_id
  from public.import_batch_rows r
 where r.id='16400000-0000-4000-8000-000000000072';
set local role authenticated;
select pg_catalog.set_config(
  'request.jwt.claim.sub','16400000-0000-4000-8000-000000000003',true
);
do $c09_0164_session_shared_source_refusal$
begin
  begin
    perform public.revert_import_session(
      '16400000-0000-4000-8000-000000000050'
    );
    raise exception 'C09_0164_EXPECTED_SESSION_SOURCE_CONFLICT';
  exception
    when sqlstate 'P04I2' then
      if sqlerrm <> 'import_source_conflict' then raise; end if;
  end;
  if (select pg_catalog.count(*) from public.import_batches b
       where b.id in (
         '16400000-0000-4000-8000-000000000061',
         '16400000-0000-4000-8000-000000000062'
       ) and b.status <> 'reverted') <> 2
     or (select pg_catalog.count(*) from public.import_batch_rows r
          where r.id in (
            '16400000-0000-4000-8000-000000000071',
            '16400000-0000-4000-8000-000000000072',
            '16400000-0000-4000-8000-000000000090'
          ) and r.apply_status='applied'
            and r.applied_inventory_item_id is not null) <> 3 then
    raise exception 'C09_0164_SESSION_SOURCE_CONFLICT_CHANGED_STATE';
  end if;
end;
$c09_0164_session_shared_source_refusal$;
reset role;
delete from public.import_batch_rows
 where id='16400000-0000-4000-8000-000000000090';
set local role authenticated;
select pg_catalog.set_config(
  'request.jwt.claim.sub','16400000-0000-4000-8000-000000000003',true
);

\if :{?diagnose_timestamp}
with evidence as (
  select r.id as row_id,
         r.applied_wine_id,
         r.updated_at as row_updated_at,
         w.updated_at as wine_updated_at,
         r.updated_at=w.updated_at as timestamp_equal,
         r.lwin_id as row_lwin_id,
         w.lwin_id as wine_lwin_id,
         r.lwin_id=w.lwin_id as lwin_id_equal,
         r.lwin_score::text as row_score_text,
         w.lwin_match_score::text as wine_score_text,
         pg_catalog.encode(pg_catalog.float4send(r.lwin_score),'hex')
           as row_score_hex,
         pg_catalog.encode(pg_catalog.float4send(w.lwin_match_score),'hex')
           as wine_score_hex,
         r.lwin_score=w.lwin_match_score as score_equal,
         r.lwin_score=0.8 as untyped_literal_equal,
         r.lwin_score=0.8::real as real_literal_equal
    from public.import_batch_rows r
    join public.wines w on w.id=r.applied_wine_id
   where r.id in (
     '16400000-0000-4000-8000-000000000071',
     '16400000-0000-4000-8000-000000000072'
   )
)
select pg_catalog.jsonb_build_object(
  'sharedRowCount',(select pg_catalog.count(*) from evidence),
  'sharedWineCount',(select pg_catalog.count(distinct e.applied_wine_id)
                       from evidence e),
  'exactPredicateCount',(
    select pg_catalog.count(*) from evidence e
     where e.timestamp_equal and e.lwin_id_equal and e.score_equal
       and e.row_lwin_id='LWIN-SHARED' and e.untyped_literal_equal
  ),
  'rows',(select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(e) order by e.row_id)
            from evidence e)
) as c09_0164_timestamp_diagnostic;
rollback;
\echo C09_0164_TIMESTAMP_DIAGNOSTIC_PASS
\quit
\endif

do $c09_0164_real_apply_and_success$
declare
  v_session jsonb;
  v_batch jsonb;
  v_shared_wine uuid;
begin
  select r.applied_wine_id into strict v_shared_wine
    from public.import_batch_rows r
   where r.id='16400000-0000-4000-8000-000000000072';
  if not exists (
       select 1
         from public.import_batch_rows r
         join public.wines w on w.id=r.applied_wine_id
        where r.id='16400000-0000-4000-8000-000000000072'
          and r.updated_at=w.updated_at
          and r.lwin_id=w.lwin_id
          and r.lwin_score=w.lwin_match_score
     ) or (select pg_catalog.count(*)
             from public.import_batch_rows r
            where r.id in (
              '16400000-0000-4000-8000-000000000071',
              '16400000-0000-4000-8000-000000000072'
            )
              and r.applied_wine_id=v_shared_wine
              and r.lwin_id='LWIN-SHARED'
              and r.lwin_score=0.8::real) <> 2 then
    raise exception 'C09_0164_REAL_APPLY_TIMESTAMP_PROOF_FAILED';
  end if;

  v_session := public.revert_import_session(
    '16400000-0000-4000-8000-000000000050'
  );
  if (select pg_catalog.count(*) from pg_catalog.jsonb_object_keys(v_session)) <> 7
     or v_session->>'status' <> 'reverted'
     or v_session->>'blockedBatchCount' <> '0'
     or v_session->>'revertedBatchCount' <> '2'
     or v_session->>'revertedItemCount' <> '2'
     or pg_catalog.jsonb_array_length(v_session->'batches') <> 2
     or v_session#>>'{batches,0,batchId}' <>
       '16400000-0000-4000-8000-000000000062'
     or v_session#>>'{batches,0,lwinStampsCleared}' <> '1'
     or v_session#>>'{batches,0,orphanWinesDeleted}' <> '0'
     or v_session#>>'{batches,1,batchId}' <>
       '16400000-0000-4000-8000-000000000061'
     or v_session#>>'{batches,1,lwinStampsCleared}' <> '0'
     or not exists (
       select 1 from public.wines w
        where w.id=v_shared_wine and w.lwin_id is null
          and w.lwin_match_score is null
     ) then
    raise exception 'C09_0164_SESSION_SHARED_PAIR_FAILED';
  end if;

  v_batch := public.revert_import_batch_private(
    '16400000-0000-4000-8000-000000000063'
  );
  if v_batch is distinct from pg_catalog.jsonb_build_object(
       'version',1,
       'batchId','16400000-0000-4000-8000-000000000063'::uuid,
       'status','reverted',
       'revertedItemCount',1,
       'orphanWinesDeleted',0,
       'lwinStampsCleared',1
     )
     or (select pg_catalog.count(*) from pg_catalog.jsonb_object_keys(v_batch)) <> 6
     or exists (
       select 1 from public.inventory_items i
        join public.import_batch_rows r on r.applied_wine_id=i.wine_id
       where r.id='16400000-0000-4000-8000-000000000073'
     )
     or not exists (
       select 1 from public.import_batch_rows r
        join public.wines w on w.id=r.applied_wine_id
       where r.id='16400000-0000-4000-8000-000000000073'
         and r.apply_status='reverted'
         and r.applied_inventory_item_id is null
         and r.applied_wine_id is not null
         and w.lwin_id is null
         and w.lwin_match_score is null
     ) then
    raise exception 'C09_0164_BATCH_RECEIPT_OR_RETENTION_FAILED';
  end if;
end;
$c09_0164_real_apply_and_success$;

reset role;
insert into public.import_batch_rows(
  id,batch_id,restaurant_id,row_number,raw,row_state,validation_errors,
  lwin_status,lwin_id,lwin_score,cost_status,resolution,apply_status,
  applied_inventory_item_id,applied_wine_id
)
select '16400000-0000-4000-8000-000000000091',r.batch_id,r.restaurant_id,
       91,r.raw,r.row_state,r.validation_errors,r.lwin_status,r.lwin_id,
       r.lwin_score,r.cost_status,r.resolution,'applied',
       r.applied_inventory_item_id,r.applied_wine_id
  from public.import_batch_rows r
 where r.id='16400000-0000-4000-8000-000000000075';
set local role authenticated;
select pg_catalog.set_config(
  'request.jwt.claim.sub','16400000-0000-4000-8000-000000000003',true
);
do $c09_0164_batch_shared_source_refusal$
begin
  begin
    perform public.revert_import_batch_private(
      '16400000-0000-4000-8000-000000000065'
    );
    raise exception 'C09_0164_EXPECTED_BATCH_SOURCE_CONFLICT';
  exception
    when sqlstate 'P04I2' then
      if sqlerrm <> 'import_source_conflict' then raise; end if;
  end;
  if (select pg_catalog.count(*) from public.import_batch_rows r
       where r.id in (
         '16400000-0000-4000-8000-000000000075',
         '16400000-0000-4000-8000-000000000091'
       ) and r.apply_status='applied'
         and r.applied_inventory_item_id is not null) <> 2 then
    raise exception 'C09_0164_BATCH_SOURCE_CONFLICT_CHANGED_STATE';
  end if;
end;
$c09_0164_batch_shared_source_refusal$;
reset role;
delete from public.import_batch_rows
 where id='16400000-0000-4000-8000-000000000091';

insert into public.import_batches(
  id,restaurant_id,created_by,filename,status,total_rows,content_sha256
) values (
  '16400000-0000-4000-8000-000000000069',
  '16400000-0000-4000-8000-000000000021',
  '16400000-0000-4000-8000-000000000004',
  'c09-cross-site-claim.csv','applying',1,
  pg_catalog.encode(pg_catalog.sha256(
    pg_catalog.convert_to('c09-cross-site-claim.csv','UTF8')
  ),'hex')
);
insert into public.import_batch_rows(
  id,batch_id,restaurant_id,row_number,raw,row_state,validation_errors,
  lwin_status,lwin_id,lwin_score,cost_status,resolution,apply_status,
  applied_inventory_item_id,applied_wine_id
)
select '16400000-0000-4000-8000-000000000092',
       '16400000-0000-4000-8000-000000000069',
       '16400000-0000-4000-8000-000000000021',92,r.raw,r.row_state,
       r.validation_errors,r.lwin_status,r.lwin_id,r.lwin_score,
       r.cost_status,r.resolution,'applied',r.applied_inventory_item_id,
       r.applied_wine_id
  from public.import_batch_rows r
 where r.id='16400000-0000-4000-8000-000000000075';
set local role authenticated;
select pg_catalog.set_config(
  'request.jwt.claim.sub','16400000-0000-4000-8000-000000000003',true
);
do $c09_0164_cross_site_source_refusal$
begin
  begin
    perform public.revert_import_batch_private(
      '16400000-0000-4000-8000-000000000065'
    );
    raise exception 'C09_0164_EXPECTED_CROSS_SITE_SOURCE_CONFLICT';
  exception
    when sqlstate 'P04I2' then
      if sqlerrm <> 'import_source_conflict' then raise; end if;
  end;
  if not exists (
       select 1 from public.import_batch_rows r
        where r.id='16400000-0000-4000-8000-000000000075'
          and r.apply_status='applied'
          and r.applied_inventory_item_id is not null
     ) then
    raise exception 'C09_0164_CROSS_SITE_SOURCE_CONFLICT_CHANGED_STATE';
  end if;
end;
$c09_0164_cross_site_source_refusal$;
reset role;
delete from public.import_batch_rows
 where id='16400000-0000-4000-8000-000000000092';
delete from public.import_batches
 where id='16400000-0000-4000-8000-000000000069';

reset role;
insert into public.open_bottles(
  id,wine_id,restaurant_id,remaining_ml,opened_by,source_inventory_item_id,
  identity_contract,identity_origin,nominal_capacity_ml,source_provenance,
  opening_operation_id,state_version
)
select '16400000-0000-4000-8000-000000000080',r.applied_wine_id,
       r.restaurant_id,750,'16400000-0000-4000-8000-000000000003',
       r.applied_inventory_item_id,2,'native',750,'known',
       '16400000-0000-4000-8000-000000000081',0
  from public.import_batch_rows r
 where r.id='16400000-0000-4000-8000-000000000074';
create temporary table c09_0164_physical_before(value jsonb) on commit drop;
insert into c09_0164_physical_before(value)
select pg_catalog.jsonb_build_object(
  'batch',(select pg_catalog.to_jsonb(b) from public.import_batches b
            where b.id='16400000-0000-4000-8000-000000000064'),
  'row',(select pg_catalog.to_jsonb(r) from public.import_batch_rows r
          where r.id='16400000-0000-4000-8000-000000000074'),
  'inventory',(select pg_catalog.to_jsonb(i) from public.inventory_items i
                where i.id=(select r.applied_inventory_item_id
                  from public.import_batch_rows r
                 where r.id='16400000-0000-4000-8000-000000000074')),
  'wine',(select pg_catalog.to_jsonb(w) from public.wines w
           where w.id=(select r.applied_wine_id from public.import_batch_rows r
                        where r.id='16400000-0000-4000-8000-000000000074')),
  'bottle',(select pg_catalog.to_jsonb(ob) from public.open_bottles ob
             where ob.id='16400000-0000-4000-8000-000000000080')
);
set local role authenticated;
select pg_catalog.set_config(
  'request.jwt.claim.sub','16400000-0000-4000-8000-000000000003',true
);
do $c09_0164_physical_refusal$
begin
  begin
    perform public.revert_import_batch_private(
      '16400000-0000-4000-8000-000000000064'
    );
    raise exception 'C09_0164_EXPECTED_PHYSICAL_REFUSAL';
  exception when sqlstate 'P04D3' then null;
  end;
end;
$c09_0164_physical_refusal$;
reset role;
do $c09_0164_physical_conservation$
declare v_before jsonb; v_after jsonb;
begin
  select value into strict v_before from c09_0164_physical_before;
  select pg_catalog.jsonb_build_object(
    'batch',(select pg_catalog.to_jsonb(b) from public.import_batches b
              where b.id='16400000-0000-4000-8000-000000000064'),
    'row',(select pg_catalog.to_jsonb(r) from public.import_batch_rows r
            where r.id='16400000-0000-4000-8000-000000000074'),
    'inventory',(select pg_catalog.to_jsonb(i) from public.inventory_items i
                  where i.id=(select r.applied_inventory_item_id
                    from public.import_batch_rows r
                   where r.id='16400000-0000-4000-8000-000000000074')),
    'wine',(select pg_catalog.to_jsonb(w) from public.wines w
             where w.id=(select r.applied_wine_id from public.import_batch_rows r
                          where r.id='16400000-0000-4000-8000-000000000074')),
    'bottle',(select pg_catalog.to_jsonb(ob) from public.open_bottles ob
               where ob.id='16400000-0000-4000-8000-000000000080')
  ) into v_after;
  if v_after is distinct from v_before then
    raise exception 'C09_0164_PHYSICAL_REFUSAL_CHANGED_STATE';
  end if;
end;
$c09_0164_physical_conservation$;

create function pg_temp.c09_0164_fail_batch_status()
returns trigger language plpgsql as $function$
begin
  if new.id='16400000-0000-4000-8000-000000000065'
     and new.status='reverted' then
    raise exception 'C09_0164_INJECTED_AFTER_INVENTORY';
  end if;
  return new;
end;
$function$;
create trigger c09_0164_fail_batch_status
before update on public.import_batches
for each row execute function pg_temp.c09_0164_fail_batch_status();
create temporary table c09_0164_atomic_before(value jsonb) on commit drop;
insert into c09_0164_atomic_before(value)
select pg_catalog.jsonb_build_object(
  'batch',(select pg_catalog.to_jsonb(b) from public.import_batches b
            where b.id='16400000-0000-4000-8000-000000000065'),
  'row',(select pg_catalog.to_jsonb(r) from public.import_batch_rows r
          where r.id='16400000-0000-4000-8000-000000000075'),
  'inventory',(select pg_catalog.to_jsonb(i) from public.inventory_items i
                where i.id=(select r.applied_inventory_item_id
                  from public.import_batch_rows r
                 where r.id='16400000-0000-4000-8000-000000000075')),
  'wine',(select pg_catalog.to_jsonb(w) from public.wines w
           where w.id=(select r.applied_wine_id from public.import_batch_rows r
                        where r.id='16400000-0000-4000-8000-000000000075'))
);
set local role authenticated;
select pg_catalog.set_config(
  'request.jwt.claim.sub','16400000-0000-4000-8000-000000000003',true
);
do $c09_0164_atomic_refusal$
declare v_refused boolean := false;
begin
  begin
    perform public.revert_import_batch_private(
      '16400000-0000-4000-8000-000000000065'
    );
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'C04_IMPORT_REVERT_REFUSED' then raise; end if;
    v_refused := true;
  end;
  if not v_refused then
    raise exception 'C09_0164_EXPECTED_ATOMIC_REFUSAL' using errcode='P0099';
  end if;
end;
$c09_0164_atomic_refusal$;
reset role;
drop trigger c09_0164_fail_batch_status on public.import_batches;
drop function pg_temp.c09_0164_fail_batch_status();
do $c09_0164_atomic_conservation$
declare v_before jsonb; v_after jsonb;
begin
  select value into strict v_before from c09_0164_atomic_before;
  select pg_catalog.jsonb_build_object(
    'batch',(select pg_catalog.to_jsonb(b) from public.import_batches b
              where b.id='16400000-0000-4000-8000-000000000065'),
    'row',(select pg_catalog.to_jsonb(r) from public.import_batch_rows r
            where r.id='16400000-0000-4000-8000-000000000075'),
    'inventory',(select pg_catalog.to_jsonb(i) from public.inventory_items i
                  where i.id=(select r.applied_inventory_item_id
                    from public.import_batch_rows r
                   where r.id='16400000-0000-4000-8000-000000000075')),
    'wine',(select pg_catalog.to_jsonb(w) from public.wines w
             where w.id=(select r.applied_wine_id from public.import_batch_rows r
                          where r.id='16400000-0000-4000-8000-000000000075'))
  ) into v_after;
  if v_after is distinct from v_before then
    raise exception 'C09_0164_ATOMIC_REFUSAL_CHANGED_STATE';
  end if;
end;
$c09_0164_atomic_conservation$;

set local role authenticated;
select pg_catalog.set_config(
  'request.jwt.claim.sub','16400000-0000-4000-8000-000000000003',true
);
select 1 / case when public.revert_import_batch(
  '16400000-0000-4000-8000-000000000066'
)=1 then 1 else 0 end as c09_0164_legacy_uses_core;
select pg_catalog.set_config(
  'request.jwt.claim.sub','16400000-0000-4000-8000-000000000001',true
);
select public.revert_import_batch_private('16400000-0000-4000-8000-000000000067');
select pg_catalog.set_config(
  'request.jwt.claim.sub','16400000-0000-4000-8000-000000000002',true
);
select public.revert_import_batch_private('16400000-0000-4000-8000-000000000068');

do $c09_0164_authority$
begin
  perform pg_catalog.set_config('request.jwt.claim.sub','',true);
  begin
    perform public.revert_import_batch_private(
      '16400000-0000-4000-8000-000000000064'
    );
    raise exception 'C09_0164_EXPECTED_UNAUTHENTICATED_REFUSAL';
  exception when sqlstate '42501' then null;
  end;
  perform pg_catalog.set_config(
    'request.jwt.claim.sub','16400000-0000-4000-8000-000000000004',true
  );
  begin
    perform public.revert_import_batch_private(
      '16400000-0000-4000-8000-000000000064'
    );
    raise exception 'C09_0164_EXPECTED_CROSS_SITE_REFUSAL';
  exception when sqlstate 'P0002' then null;
  end;
  perform pg_catalog.set_config(
    'request.jwt.claim.sub','16400000-0000-4000-8000-000000000005',true
  );
  begin
    perform public.revert_import_batch_private(
      '16400000-0000-4000-8000-000000000064'
    );
    raise exception 'C09_0164_EXPECTED_REVOKED_REFUSAL';
  exception when sqlstate 'P0002' then null;
  end;
end;
$c09_0164_authority$;

rollback;
\echo C09_0164_IMPORT_REVERT_CONTRACT_PASS
