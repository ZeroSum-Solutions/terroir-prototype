-- 0164 retained-catalog extended rollback-only matrix.
\set ON_ERROR_STOP on
\pset pager off

\if :{?expected_database}
\else
  \echo C09_0164_EXTENDED_EXPECTED_DATABASE_REQUIRED
  \quit 3
\endif
\if :{?target_admitted}
\else
  \echo C09_0164_EXTENDED_TARGET_ADMISSION_REQUIRED
  \quit 3
\endif
\if :{?source_0164_sha256}
\else
  \echo C09_0164_EXTENDED_SOURCE_PIN_REQUIRED
  \quit 3
\endif

select 1 / case when current_database()=:'expected_database'
  and current_user='postgres' and session_user='postgres'
  and :'target_admitted'='on'
  and :'source_0164_sha256'=
    '2d535f329b600c3dfc33b23494532f93c023b1a89c6aad055b8de3a865ee49ff'
  and pg_catalog.to_regprocedure(
    'public.revert_import_batch_core_private(uuid,uuid[])'
  ) is not null
  and pg_catalog.to_regprocedure(
    'public.revert_import_batch_private(uuid)'
  ) is not null
  and pg_catalog.to_regprocedure(
    'public.revert_import_session(uuid)'
  ) is not null
then 1 else 0 end as c09_0164_extended_target_admitted;

begin;
set local statement_timeout='60s';
set local lock_timeout='5s';

insert into auth.users(id,email) values
  ('16450000-0000-4000-8000-000000000001','c09-0164-extended@terroir.test');
insert into public.workspaces(id,kind,name) values
  ('16450000-0000-4000-8000-000000000010','restaurant','C09 0164 extended workspace');
insert into public.restaurants(id,name,workspace_id) values
  ('16450000-0000-4000-8000-000000000020','C09 0164 extended site','16450000-0000-4000-8000-000000000010');
insert into public.workspace_memberships(
  id,workspace_id,user_id,governance_role
) values (
  '16450000-0000-4000-8000-000000000030',
  '16450000-0000-4000-8000-000000000010',
  '16450000-0000-4000-8000-000000000001','workspace_owner'
);
insert into public.memberships(
  id,user_id,restaurant_id,role,workspace_membership_id
) values (
  '16450000-0000-4000-8000-000000000040',
  '16450000-0000-4000-8000-000000000001',
  '16450000-0000-4000-8000-000000000020','owner',
  '16450000-0000-4000-8000-000000000030'
);

insert into public.import_sessions(
  id,restaurant_id,created_by,label,status
) values
  ('16450000-0000-4000-8000-000000000050','16450000-0000-4000-8000-000000000020','16450000-0000-4000-8000-000000000001','atomic positions','in_progress'),
  ('16450000-0000-4000-8000-000000000051','16450000-0000-4000-8000-000000000020','16450000-0000-4000-8000-000000000001','session child rollback','in_progress'),
  ('16450000-0000-4000-8000-000000000052','16450000-0000-4000-8000-000000000020','16450000-0000-4000-8000-000000000001','session physical rollback','in_progress');

insert into public.import_batches(
  id,restaurant_id,created_by,filename,status,total_rows,session_id,chunk_index,
  content_sha256
)
select v.id,'16450000-0000-4000-8000-000000000020'::uuid,
       '16450000-0000-4000-8000-000000000001'::uuid,v.filename,'created',
       v.total_rows,v.session_id,v.chunk_index,
       pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(v.filename,'UTF8')),'hex')
  from (values
    ('16450000-0000-4000-8000-000000000061'::uuid,'positive.csv',1,null::uuid,null::integer),
    ('16450000-0000-4000-8000-000000000062'::uuid,'newer.csv',1,null::uuid,null::integer),
    ('16450000-0000-4000-8000-000000000063'::uuid,'different-id.csv',1,null::uuid,null::integer),
    ('16450000-0000-4000-8000-000000000064'::uuid,'different-score.csv',1,null::uuid,null::integer),
    ('16450000-0000-4000-8000-000000000065'::uuid,'low-score.csv',1,null::uuid,null::integer),
    ('16450000-0000-4000-8000-000000000066'::uuid,'outside-claim-a.csv',1,null::uuid,null::integer),
    ('16450000-0000-4000-8000-000000000067'::uuid,'outside-claim-b.csv',1,null::uuid,null::integer),
    ('16450000-0000-4000-8000-000000000068'::uuid,'empty-pair.csv',1,null::uuid,null::integer),
    ('16450000-0000-4000-8000-000000000069'::uuid,'duplicate.csv',2,null::uuid,null::integer),
    ('16450000-0000-4000-8000-000000000070'::uuid,'fail-after-lwin.csv',1,'16450000-0000-4000-8000-000000000050'::uuid,1),
    ('16450000-0000-4000-8000-000000000071'::uuid,'fail-after-inventory.csv',1,'16450000-0000-4000-8000-000000000050'::uuid,2),
    ('16450000-0000-4000-8000-000000000072'::uuid,'session-first.csv',1,'16450000-0000-4000-8000-000000000051'::uuid,2),
    ('16450000-0000-4000-8000-000000000073'::uuid,'session-failing-child.csv',1,'16450000-0000-4000-8000-000000000051'::uuid,1),
    ('16450000-0000-4000-8000-000000000074'::uuid,'session-eligible.csv',1,'16450000-0000-4000-8000-000000000052'::uuid,2),
    ('16450000-0000-4000-8000-000000000075'::uuid,'session-physical.csv',1,'16450000-0000-4000-8000-000000000052'::uuid,1)
  ) as v(id,filename,total_rows,session_id,chunk_index);

insert into public.import_batch_rows(
  id,batch_id,restaurant_id,row_number,raw,row_state,validation_errors,
  lwin_status,lwin_id,lwin_score,cost_status,resolution,apply_status
)
select v.id,v.batch_id,'16450000-0000-4000-8000-000000000020'::uuid,
       v.row_number,
       pg_catalog.jsonb_build_object(
         'producer','Extended','name',v.wine_name,'vintage','2026',
         'quantity','1','unit_cost',v.unit_cost,'size_ml','750'
       ),
       'valid','[]'::jsonb,
       case when v.lwin_id is null then 'unmatched' else 'matched' end,
       v.lwin_id,v.lwin_score,'present','auto','not_applied'
  from (values
    ('16450000-0000-4000-8000-000000000101'::uuid,'16450000-0000-4000-8000-000000000061'::uuid,1,'Positive','10','LWIN-POSITIVE',0.9::real),
    ('16450000-0000-4000-8000-000000000102'::uuid,'16450000-0000-4000-8000-000000000062'::uuid,1,'Newer','11','LWIN-NEWER',0.9::real),
    ('16450000-0000-4000-8000-000000000103'::uuid,'16450000-0000-4000-8000-000000000063'::uuid,1,'Different ID','12','LWIN-ID',0.9::real),
    ('16450000-0000-4000-8000-000000000104'::uuid,'16450000-0000-4000-8000-000000000064'::uuid,1,'Different Score','13','LWIN-SCORE',0.9::real),
    ('16450000-0000-4000-8000-000000000105'::uuid,'16450000-0000-4000-8000-000000000065'::uuid,1,'Low Score','14','LWIN-LOW',0.5::real),
    ('16450000-0000-4000-8000-000000000106'::uuid,'16450000-0000-4000-8000-000000000066'::uuid,1,'Outside Claim','15','LWIN-OUTSIDE',0.8::real),
    ('16450000-0000-4000-8000-000000000107'::uuid,'16450000-0000-4000-8000-000000000067'::uuid,1,'Outside Claim','16','LWIN-OUTSIDE',0.8::real),
    ('16450000-0000-4000-8000-000000000108'::uuid,'16450000-0000-4000-8000-000000000068'::uuid,1,'Empty Pair','17',null::text,null::real),
    ('16450000-0000-4000-8000-000000000109'::uuid,'16450000-0000-4000-8000-000000000069'::uuid,1,'Duplicate','18','LWIN-DUPLICATE',0.85::real),
    ('16450000-0000-4000-8000-000000000110'::uuid,'16450000-0000-4000-8000-000000000069'::uuid,2,'Duplicate','19','LWIN-DUPLICATE',0.85::real),
    ('16450000-0000-4000-8000-000000000111'::uuid,'16450000-0000-4000-8000-000000000070'::uuid,1,'Fail LWIN','20','LWIN-FAIL-LWIN',0.9::real),
    ('16450000-0000-4000-8000-000000000112'::uuid,'16450000-0000-4000-8000-000000000071'::uuid,1,'Fail Inventory','21','LWIN-FAIL-INVENTORY',0.9::real),
    ('16450000-0000-4000-8000-000000000113'::uuid,'16450000-0000-4000-8000-000000000072'::uuid,1,'Session First','22','LWIN-SESSION-FIRST',0.9::real),
    ('16450000-0000-4000-8000-000000000114'::uuid,'16450000-0000-4000-8000-000000000073'::uuid,1,'Session Fail','23','LWIN-SESSION-FAIL',0.9::real),
    ('16450000-0000-4000-8000-000000000115'::uuid,'16450000-0000-4000-8000-000000000074'::uuid,1,'Session Eligible','24','LWIN-SESSION-ELIGIBLE',0.9::real),
    ('16450000-0000-4000-8000-000000000116'::uuid,'16450000-0000-4000-8000-000000000075'::uuid,1,'Session Physical','25','LWIN-SESSION-PHYSICAL',0.9::real)
  ) as v(id,batch_id,row_number,wine_name,unit_cost,lwin_id,lwin_score);

set local role authenticated;
select pg_catalog.set_config(
  'request.jwt.claim.sub','16450000-0000-4000-8000-000000000001',true
);
select * from public.apply_import_batch_chunk('16450000-0000-4000-8000-000000000061',100);
select * from public.apply_import_batch_chunk('16450000-0000-4000-8000-000000000062',100);
select * from public.apply_import_batch_chunk('16450000-0000-4000-8000-000000000063',100);
select * from public.apply_import_batch_chunk('16450000-0000-4000-8000-000000000064',100);
select * from public.apply_import_batch_chunk('16450000-0000-4000-8000-000000000065',100);
select * from public.apply_import_batch_chunk('16450000-0000-4000-8000-000000000066',100);
select * from public.apply_import_batch_chunk('16450000-0000-4000-8000-000000000067',100);
select * from public.apply_import_batch_chunk('16450000-0000-4000-8000-000000000068',100);
select * from public.apply_import_batch_chunk('16450000-0000-4000-8000-000000000069',100);
select * from public.apply_import_batch_chunk('16450000-0000-4000-8000-000000000070',100);
select * from public.apply_import_batch_chunk('16450000-0000-4000-8000-000000000071',100);
select * from public.apply_import_batch_chunk('16450000-0000-4000-8000-000000000072',100);
select * from public.apply_import_batch_chunk('16450000-0000-4000-8000-000000000073',100);
select * from public.apply_import_batch_chunk('16450000-0000-4000-8000-000000000074',100);
select * from public.apply_import_batch_chunk('16450000-0000-4000-8000-000000000075',100);
reset role;

-- Isolate each negative LWIN predicate while preserving the other CAS fields.
set local session_replication_role='replica';
update public.wines w set updated_at=w.updated_at+interval '1 second'
 where w.id=(select r.applied_wine_id from public.import_batch_rows r
              where r.id='16450000-0000-4000-8000-000000000102');
set local session_replication_role='origin';
update public.wines w set lwin_id='LWIN-DIFFERENT-CURRENT'
 where w.id=(select r.applied_wine_id from public.import_batch_rows r
              where r.id='16450000-0000-4000-8000-000000000103');
update public.import_batch_rows r set updated_at=r.updated_at
 where r.id='16450000-0000-4000-8000-000000000103';
update public.wines w set lwin_match_score=0.7::real
 where w.id=(select r.applied_wine_id from public.import_batch_rows r
              where r.id='16450000-0000-4000-8000-000000000104');
update public.import_batch_rows r set updated_at=r.updated_at
 where r.id='16450000-0000-4000-8000-000000000104';
update public.wines w set lwin_id='LWIN-LOW',lwin_match_score=0.5::real
 where w.id=(select r.applied_wine_id from public.import_batch_rows r
              where r.id='16450000-0000-4000-8000-000000000105');
update public.import_batch_rows r set updated_at=r.updated_at
 where r.id='16450000-0000-4000-8000-000000000105';

-- A non-target catalog wine carries representative immutable history rows.
insert into public.wines(
  id,restaurant_id,name,producer,vintage,size_ml
) values (
  '16450000-0000-4000-8000-000000000200',
  '16450000-0000-4000-8000-000000000020','History Wine','Extended',2026,750
);
insert into public.reason_codes(id,restaurant_id,code,label,category) values (
  '16450000-0000-4000-8000-000000000201',
  '16450000-0000-4000-8000-000000000020','c09-history','C09 history','adjustment'
);
insert into public.open_bottles(
  id,wine_id,restaurant_id,remaining_ml,opened_by,identity_contract,
  identity_origin,nominal_capacity_ml,source_provenance,state_version
) values (
  '16450000-0000-4000-8000-000000000202',
  '16450000-0000-4000-8000-000000000200',
  '16450000-0000-4000-8000-000000000020',500,
  '16450000-0000-4000-8000-000000000001',2,'migrated_active',750,
  'legacy_unknown',0
);
insert into public.inventory_command_receipts(
  restaurant_id,operation_id,actor_user_id,wine_id,command_type,
  request_payload
) values (
  '16450000-0000-4000-8000-000000000020',
  '16450000-0000-4000-8000-000000000218',
  '16450000-0000-4000-8000-000000000001',
  '16450000-0000-4000-8000-000000000200','open','{"source":"0164"}'
);
insert into public.pour_events(
  id,wine_id,restaurant_id,ml_delta,kind,actor_user_id,note,
  open_bottle_id,event_contract,operation_id,operation_entry_ordinal
) values (
  '16450000-0000-4000-8000-000000000203',
  '16450000-0000-4000-8000-000000000200',
  '16450000-0000-4000-8000-000000000020',0,'reconcile',
  '16450000-0000-4000-8000-000000000001','C09 retained history',
  '16450000-0000-4000-8000-000000000202',2,
  '16450000-0000-4000-8000-000000000218',0
);
insert into public.bottle_closeouts(
  id,restaurant_id,wine_id,open_bottle_id,preservation_method,closed_by,
  theoretical_remaining_ml,actual_remaining_ml,written_off_ml
) values (
  '16450000-0000-4000-8000-000000000204',
  '16450000-0000-4000-8000-000000000020',
  '16450000-0000-4000-8000-000000000200',
  '16450000-0000-4000-8000-000000000202','none',
  '16450000-0000-4000-8000-000000000001',500,500,0
);
insert into public.availability_events(
  id,wine_id,restaurant_id,direction,user_id,note
) values (
  '16450000-0000-4000-8000-000000000205',
  '16450000-0000-4000-8000-000000000200',
  '16450000-0000-4000-8000-000000000020','restored',
  '16450000-0000-4000-8000-000000000001','C09 retained history'
);
insert into public.cellar_health(
  id,restaurant_id,wine_id,segment,reason
) values (
  '16450000-0000-4000-8000-000000000206',
  '16450000-0000-4000-8000-000000000020',
  '16450000-0000-4000-8000-000000000200','healthy','C09 retained history'
);
insert into public.pricing_recommendations(
  id,restaurant_id,wine_id,class,rationale,evidence,timing
) values (
  '16450000-0000-4000-8000-000000000207',
  '16450000-0000-4000-8000-000000000020',
  '16450000-0000-4000-8000-000000000200','hold','C09 retained history',
  '{"source":"0164"}','later'
);
insert into public.stock_adjustments(
  id,restaurant_id,wine_id,kind,bottles,ml,reason_code_id,acting_user_id,note
) values (
  '16450000-0000-4000-8000-000000000208',
  '16450000-0000-4000-8000-000000000020',
  '16450000-0000-4000-8000-000000000200','adjustment',1,0,
  '16450000-0000-4000-8000-000000000201',
  '16450000-0000-4000-8000-000000000001','C09 retained history'
);
insert into public.wine_notes(
  id,restaurant_id,wine_id,author_user_id,body,score
) values (
  '16450000-0000-4000-8000-000000000209',
  '16450000-0000-4000-8000-000000000020',
  '16450000-0000-4000-8000-000000000200',
  '16450000-0000-4000-8000-000000000001','C09 retained history',90
);
insert into public.producer_backfill_audit(
  id,wine_id,restaurant_id,old_producer,new_producer,matched_words,migration
) values (
  '16450000-0000-4000-8000-000000000210',
  '16450000-0000-4000-8000-000000000200',
  '16450000-0000-4000-8000-000000000020','Old','Extended',1,'0164-test'
);
insert into public.identity_merge_log(
  id,merge_type,source_id,target_id,restaurant_id,source_snapshot,moved_counts,
  merged_by
) values (
  '16450000-0000-4000-8000-000000000211','wine',
  '16450000-0000-4000-8000-000000000212',
  '16450000-0000-4000-8000-000000000200',
  '16450000-0000-4000-8000-000000000020','{"name":"old"}','{"rows":1}',
  '16450000-0000-4000-8000-000000000001'
);
insert into public.invoice_scans(
  id,restaurant_id,distributor_name,parsed_line_items,final_line_items,item_count,
  created_by,status
) values (
  '16450000-0000-4000-8000-000000000213',
  '16450000-0000-4000-8000-000000000020','C09 distributor','[]','[]',0,
  '16450000-0000-4000-8000-000000000001','complete'
);
insert into public.invoice_scan_deletions(
  id,restaurant_id,invoice_scan_id,deleted_by,distributor_name,scan_status,
  item_count,inventory_rows_deleted,bottles_removed,final_line_items
) values (
  '16450000-0000-4000-8000-000000000214',
  '16450000-0000-4000-8000-000000000020',
  '16450000-0000-4000-8000-000000000215',
  '16450000-0000-4000-8000-000000000001','C09 deleted','complete',0,0,0,'[]'
);
insert into public.reconcile_batches(
  id,restaurant_id,created_by,action_count
) values (
  '16450000-0000-4000-8000-000000000216',
  '16450000-0000-4000-8000-000000000020',
  '16450000-0000-4000-8000-000000000001',1
);
insert into public.reconcile_actions(
  id,batch_id,restaurant_id,action_type,subject_table,subject_id,prior_state,
  new_state,ordinal
) values (
  '16450000-0000-4000-8000-000000000217',
  '16450000-0000-4000-8000-000000000216',
  '16450000-0000-4000-8000-000000000020','link_lineage','wines',
  '16450000-0000-4000-8000-000000000200','{}','{}',1
);
-- Physical child for the all-or-nothing session refusal.
insert into public.open_bottles(
  id,wine_id,restaurant_id,remaining_ml,opened_by,source_inventory_item_id,
  identity_contract,identity_origin,nominal_capacity_ml,source_provenance,
  opening_operation_id,state_version
)
select '16450000-0000-4000-8000-000000000219',r.applied_wine_id,
       r.restaurant_id,750,'16450000-0000-4000-8000-000000000001',
       r.applied_inventory_item_id,2,'native',750,'known',
       '16450000-0000-4000-8000-000000000220',0
  from public.import_batch_rows r
 where r.id='16450000-0000-4000-8000-000000000116';

create function pg_temp.c09_0164_history_snapshot()
returns jsonb language sql stable as $snapshot$
select pg_catalog.jsonb_build_object(
  'wines',coalesce((select pg_catalog.jsonb_agg(
      pg_catalog.to_jsonb(w)-array['lwin_id','lwin_match_score','updated_at']
      order by w.id
    ) from public.wines w
     where w.restaurant_id='16450000-0000-4000-8000-000000000020'),'[]'::jsonb),
  'direct',coalesce((select pg_catalog.jsonb_agg(
      pg_catalog.to_jsonb(r)-array['apply_status','applied_inventory_item_id','updated_at']
      order by r.id
    ) from public.import_batch_rows r
     where r.restaurant_id='16450000-0000-4000-8000-000000000020'),'[]'::jsonb),
  'physical',coalesce((select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(x) order by x.id)
    from public.open_bottles x where x.restaurant_id='16450000-0000-4000-8000-000000000020'),'[]'::jsonb),
  'closeout',coalesce((select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(x) order by x.id)
    from public.bottle_closeouts x where x.restaurant_id='16450000-0000-4000-8000-000000000020'),'[]'::jsonb),
  'scan',coalesce((select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(x) order by x.id)
    from public.invoice_scans x where x.restaurant_id='16450000-0000-4000-8000-000000000020'),'[]'::jsonb),
  'deletion',coalesce((select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(x) order by x.id)
    from public.invoice_scan_deletions x where x.restaurant_id='16450000-0000-4000-8000-000000000020'),'[]'::jsonb),
  'reconciliation',coalesce((select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(x) order by x.id)
    from public.reconcile_actions x where x.restaurant_id='16450000-0000-4000-8000-000000000020'),'[]'::jsonb),
  'merge',coalesce((select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(x) order by x.id)
    from public.identity_merge_log x where x.restaurant_id='16450000-0000-4000-8000-000000000020'),'[]'::jsonb),
  'pour',coalesce((select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(x) order by x.id)
    from public.pour_events x where x.restaurant_id='16450000-0000-4000-8000-000000000020'),'[]'::jsonb),
  'receipt',coalesce((select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(x) order by x.operation_id)
    from public.inventory_command_receipts x where x.restaurant_id='16450000-0000-4000-8000-000000000020'),'[]'::jsonb),
  'note',coalesce((select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(x) order by x.id)
    from public.wine_notes x where x.restaurant_id='16450000-0000-4000-8000-000000000020'),'[]'::jsonb),
  'availability',coalesce((select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(x) order by x.id)
    from public.availability_events x where x.restaurant_id='16450000-0000-4000-8000-000000000020'),'[]'::jsonb),
  'health',coalesce((select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(x) order by x.id)
    from public.cellar_health x where x.restaurant_id='16450000-0000-4000-8000-000000000020'),'[]'::jsonb),
  'pricing',coalesce((select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(x) order by x.id)
    from public.pricing_recommendations x where x.restaurant_id='16450000-0000-4000-8000-000000000020'),'[]'::jsonb),
  'adjustment',coalesce((select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(x) order by x.id)
    from public.stock_adjustments x where x.restaurant_id='16450000-0000-4000-8000-000000000020'),'[]'::jsonb),
  'audit',coalesce((select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(x) order by x.id)
    from public.producer_backfill_audit x where x.restaurant_id='16450000-0000-4000-8000-000000000020'),'[]'::jsonb)
);
$snapshot$;
create temporary table c09_0164_history_before(value jsonb) on commit drop;
insert into c09_0164_history_before values (pg_temp.c09_0164_history_snapshot());

create function pg_temp.c09_0164_state(p_batch_ids uuid[],p_session_id uuid)
returns jsonb language sql stable as $state$
select pg_catalog.jsonb_build_object(
  'session',(select pg_catalog.to_jsonb(s) from public.import_sessions s
              where s.id=p_session_id),
  'batches',(select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(b) order by b.id)
              from public.import_batches b where b.id=any(p_batch_ids)),
  'rows',(select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(r) order by r.id)
           from public.import_batch_rows r where r.batch_id=any(p_batch_ids)),
  'inventory',(select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(i) order by i.id)
                from public.inventory_items i where i.id in (
                  select r.applied_inventory_item_id from public.import_batch_rows r
                   where r.batch_id=any(p_batch_ids)
                )),
  'wines',(select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(w) order by w.id)
            from public.wines w where w.id in (
              select r.applied_wine_id from public.import_batch_rows r
               where r.batch_id=any(p_batch_ids)
            )),
  'bottles',(select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(ob) order by ob.id)
              from public.open_bottles ob where ob.source_inventory_item_id in (
                select r.applied_inventory_item_id from public.import_batch_rows r
                 where r.batch_id=any(p_batch_ids)
              ))
);
$state$;

set local role authenticated;
select pg_catalog.set_config(
  'request.jwt.claim.sub','16450000-0000-4000-8000-000000000001',true
);
do $c09_0164_lwin_matrix$
declare v jsonb; v_wine uuid;
begin
  v:=public.revert_import_batch_private('16450000-0000-4000-8000-000000000061');
  if v->>'lwinStampsCleared'<>'1' then
    raise exception 'C09_0164_LWIN_POSITIVE_FAILED';
  end if;

  v:=public.revert_import_batch_private('16450000-0000-4000-8000-000000000062');
  if v->>'lwinStampsCleared'<>'0' or not exists(
    select 1 from public.import_batch_rows r join public.wines w on w.id=r.applied_wine_id
     where r.id='16450000-0000-4000-8000-000000000102'
       and w.lwin_id='LWIN-NEWER' and w.lwin_match_score=0.9::real
       and w.updated_at>r.updated_at
  ) then raise exception 'C09_0164_LWIN_NEWER_FAILED'; end if;

  v:=public.revert_import_batch_private('16450000-0000-4000-8000-000000000063');
  if v->>'lwinStampsCleared'<>'0' or not exists(
    select 1 from public.import_batch_rows r join public.wines w on w.id=r.applied_wine_id
     where r.id='16450000-0000-4000-8000-000000000103'
       and r.updated_at=w.updated_at and r.lwin_id='LWIN-ID'
       and w.lwin_id='LWIN-DIFFERENT-CURRENT'
  ) then raise exception 'C09_0164_LWIN_DIFFERENT_ID_FAILED'; end if;

  v:=public.revert_import_batch_private('16450000-0000-4000-8000-000000000064');
  if v->>'lwinStampsCleared'<>'0' or not exists(
    select 1 from public.import_batch_rows r join public.wines w on w.id=r.applied_wine_id
     where r.id='16450000-0000-4000-8000-000000000104'
       and r.updated_at=w.updated_at and r.lwin_score=0.9::real
       and w.lwin_match_score=0.7::real
  ) then raise exception 'C09_0164_LWIN_DIFFERENT_SCORE_FAILED'; end if;

  v:=public.revert_import_batch_private('16450000-0000-4000-8000-000000000065');
  if v->>'lwinStampsCleared'<>'0' or not exists(
    select 1 from public.import_batch_rows r join public.wines w on w.id=r.applied_wine_id
     where r.id='16450000-0000-4000-8000-000000000105'
       and r.updated_at=w.updated_at and r.lwin_score=0.5::real
       and w.lwin_id='LWIN-LOW' and w.lwin_match_score=0.5::real
  ) then raise exception 'C09_0164_LWIN_LOW_SCORE_FAILED'; end if;

  select r.applied_wine_id into strict v_wine from public.import_batch_rows r
   where r.id='16450000-0000-4000-8000-000000000106';
  v:=public.revert_import_batch_private('16450000-0000-4000-8000-000000000066');
  if v->>'lwinStampsCleared'<>'0' or not exists(
    select 1 from public.wines w where w.id=v_wine
      and w.lwin_id='LWIN-OUTSIDE' and w.lwin_match_score=0.8::real
  ) or not exists(
    select 1 from public.import_batch_rows r
     where r.id='16450000-0000-4000-8000-000000000107'
       and r.apply_status='applied' and r.applied_wine_id=v_wine
  ) then raise exception 'C09_0164_LWIN_OUTSIDE_CLAIM_FAILED'; end if;

  v:=public.revert_import_batch_private('16450000-0000-4000-8000-000000000068');
  if v->>'lwinStampsCleared'<>'0' or not exists(
    select 1 from public.import_batch_rows r join public.wines w on w.id=r.applied_wine_id
     where r.id='16450000-0000-4000-8000-000000000108'
       and w.lwin_id is null and w.lwin_match_score is null
  ) then raise exception 'C09_0164_LWIN_EMPTY_FAILED'; end if;

  select r.applied_wine_id into strict v_wine from public.import_batch_rows r
   where r.id='16450000-0000-4000-8000-000000000109';
  if (select pg_catalog.count(*) from public.import_batch_rows r
       where r.id in ('16450000-0000-4000-8000-000000000109','16450000-0000-4000-8000-000000000110')
         and r.applied_wine_id=v_wine and r.updated_at=(select w.updated_at from public.wines w where w.id=v_wine))<>2 then
    raise exception 'C09_0164_LWIN_DUPLICATE_SETUP_FAILED';
  end if;
  v:=public.revert_import_batch_private('16450000-0000-4000-8000-000000000069');
  if v->>'lwinStampsCleared'<>'1' or v->>'revertedItemCount'<>'2'
     or not exists(select 1 from public.wines w where w.id=v_wine
                    and w.lwin_id is null and w.lwin_match_score is null) then
    raise exception 'C09_0164_LWIN_DUPLICATE_COUNT_FAILED';
  end if;

  if not exists(select 1 from public.wines w
     where w.id='16450000-0000-4000-8000-000000000200'
       and w.name='History Wine') then
    raise exception 'C09_0164_LWIN_UNRELATED_WINE_FAILED';
  end if;
end;
$c09_0164_lwin_matrix$;
reset role;

-- Failure after the LWIN update but before inventory deletion.
create temporary table c09_0164_atomic_before(name text primary key,value jsonb) on commit drop;
insert into c09_0164_atomic_before values
  ('after_lwin',pg_temp.c09_0164_state(array['16450000-0000-4000-8000-000000000070'::uuid],'16450000-0000-4000-8000-000000000050')),
  ('after_inventory',pg_temp.c09_0164_state(array['16450000-0000-4000-8000-000000000071'::uuid],'16450000-0000-4000-8000-000000000050')),
  ('session_child',pg_temp.c09_0164_state(array['16450000-0000-4000-8000-000000000072'::uuid,'16450000-0000-4000-8000-000000000073'::uuid],'16450000-0000-4000-8000-000000000051')),
  ('session_physical',pg_temp.c09_0164_state(array['16450000-0000-4000-8000-000000000074'::uuid,'16450000-0000-4000-8000-000000000075'::uuid],'16450000-0000-4000-8000-000000000052'));
create temporary table c09_0164_injection_ids(
  batch_id uuid primary key,row_id uuid not null,inventory_id uuid not null,
  wine_id uuid not null
) on commit drop;
insert into c09_0164_injection_ids
select r.batch_id,r.id,r.applied_inventory_item_id,r.applied_wine_id
  from public.import_batch_rows r
 where r.batch_id in (
   '16450000-0000-4000-8000-000000000070',
   '16450000-0000-4000-8000-000000000071',
   '16450000-0000-4000-8000-000000000072',
   '16450000-0000-4000-8000-000000000073'
 );
select 1/case when (select pg_catalog.count(*) from c09_0164_injection_ids)=4
  then 1 else 0 end as c09_0164_injection_ids_complete;

create temporary sequence c09_0164_after_lwin_hit;
create function pg_temp.c09_0164_fail_row()
returns trigger language plpgsql as $function$
begin
  if new.id='16450000-0000-4000-8000-000000000111'
     and new.apply_status='reverted' then
    if not exists(
         select 1 from c09_0164_injection_ids ids
         join public.wines w on w.id=ids.wine_id
         join public.inventory_items i on i.id=ids.inventory_id
          and i.restaurant_id=w.restaurant_id and i.wine_id=w.id
        where ids.batch_id='16450000-0000-4000-8000-000000000070'
          and w.lwin_id is null and w.lwin_match_score is null
       ) or old.apply_status<>'applied'
          or old.applied_inventory_item_id is null then
      raise exception 'C09_0164_AFTER_LWIN_POSITION_INVALID';
    end if;
    perform pg_catalog.nextval('pg_temp.c09_0164_after_lwin_hit'::regclass);
    raise exception 'C09_0164_INJECTED_AFTER_LWIN';
  end if;
  return new;
end;
$function$;
create trigger c09_0164_fail_row before update on public.import_batch_rows
for each row execute function pg_temp.c09_0164_fail_row();
set local role authenticated;
select pg_catalog.set_config('request.jwt.claim.sub','16450000-0000-4000-8000-000000000001',true);
do $c09_0164_fail_after_lwin$
declare v_refused boolean:=false;
begin
  begin
    perform public.revert_import_batch_private('16450000-0000-4000-8000-000000000070');
  exception when sqlstate 'P0001' then
    if sqlerrm<>'C04_IMPORT_REVERT_REFUSED' then raise; end if;
    v_refused:=true;
  end;
  if not v_refused then
    raise exception 'C09_0164_AFTER_LWIN_NOT_REFUSED' using errcode='P0099';
  end if;
end;
$c09_0164_fail_after_lwin$;
reset role;
select 1/case when (select s.is_called and s.last_value=1
                      from pg_temp.c09_0164_after_lwin_hit s)
  then 1 else 0 end as c09_0164_after_lwin_reached;
drop trigger c09_0164_fail_row on public.import_batch_rows;
drop function pg_temp.c09_0164_fail_row();
select 1/case when pg_temp.c09_0164_state(
  array['16450000-0000-4000-8000-000000000070'::uuid],
  '16450000-0000-4000-8000-000000000050'
)=(select value from c09_0164_atomic_before where name='after_lwin') then 1 else 0 end
  as c09_0164_after_lwin_conserved;

-- Failure after inventory deletion but before batch status commit.
create temporary sequence c09_0164_after_inventory_hit;
create function pg_temp.c09_0164_fail_batch()
returns trigger language plpgsql as $function$
begin
  if new.id='16450000-0000-4000-8000-000000000071'
     and new.status='reverted' then
    if not exists(
         select 1 from c09_0164_injection_ids ids
         join public.import_batch_rows r on r.id=ids.row_id
         join public.wines w on w.id=ids.wine_id
        where ids.batch_id='16450000-0000-4000-8000-000000000071'
          and r.apply_status='reverted'
          and r.applied_inventory_item_id is null
          and w.lwin_id is null and w.lwin_match_score is null
          and not exists(select 1 from public.inventory_items i
                          where i.id=ids.inventory_id)
       ) then
      raise exception 'C09_0164_AFTER_INVENTORY_POSITION_INVALID';
    end if;
    perform pg_catalog.nextval('pg_temp.c09_0164_after_inventory_hit'::regclass);
    raise exception 'C09_0164_INJECTED_AFTER_INVENTORY';
  end if;
  return new;
end;
$function$;
create trigger c09_0164_fail_batch before update on public.import_batches
for each row execute function pg_temp.c09_0164_fail_batch();
set local role authenticated;
select pg_catalog.set_config('request.jwt.claim.sub','16450000-0000-4000-8000-000000000001',true);
do $c09_0164_fail_after_inventory$
declare v_refused boolean:=false;
begin
  begin
    perform public.revert_import_batch_private('16450000-0000-4000-8000-000000000071');
  exception when sqlstate 'P0001' then
    if sqlerrm<>'C04_IMPORT_REVERT_REFUSED' then raise; end if;
    v_refused:=true;
  end;
  if not v_refused then
    raise exception 'C09_0164_AFTER_INVENTORY_NOT_REFUSED' using errcode='P0099';
  end if;
end;
$c09_0164_fail_after_inventory$;
reset role;
select 1/case when (select s.is_called and s.last_value=1
                      from pg_temp.c09_0164_after_inventory_hit s)
  then 1 else 0 end as c09_0164_after_inventory_reached;
drop trigger c09_0164_fail_batch on public.import_batches;
drop function pg_temp.c09_0164_fail_batch();
select 1/case when pg_temp.c09_0164_state(
  array['16450000-0000-4000-8000-000000000071'::uuid],
  '16450000-0000-4000-8000-000000000050'
)=(select value from c09_0164_atomic_before where name='after_inventory') then 1 else 0 end
  as c09_0164_after_inventory_conserved;

-- The higher chunk mutates first; failure in the later child must roll it back.
create temporary sequence c09_0164_later_child_hit;
create function pg_temp.c09_0164_fail_later_child()
returns trigger language plpgsql as $function$
begin
  if new.id='16450000-0000-4000-8000-000000000073'
     and new.status='reverted' then
    if (select pg_catalog.count(*)
          from c09_0164_injection_ids ids
          join public.import_batch_rows r on r.id=ids.row_id
          join public.wines w on w.id=ids.wine_id
         where ids.batch_id in (
           '16450000-0000-4000-8000-000000000072',
           '16450000-0000-4000-8000-000000000073'
         )
           and r.apply_status='reverted'
           and r.applied_inventory_item_id is null
           and w.lwin_id is null and w.lwin_match_score is null
           and not exists(select 1 from public.inventory_items i
                           where i.id=ids.inventory_id))<>2 then
      raise exception 'C09_0164_LATER_CHILD_POSITION_INVALID';
    end if;
    perform pg_catalog.nextval('pg_temp.c09_0164_later_child_hit'::regclass);
    raise exception 'C09_0164_INJECTED_LATER_CHILD';
  end if;
  return new;
end;
$function$;
create trigger c09_0164_fail_later_child before update on public.import_batches
for each row execute function pg_temp.c09_0164_fail_later_child();
set local role authenticated;
select pg_catalog.set_config('request.jwt.claim.sub','16450000-0000-4000-8000-000000000001',true);
do $c09_0164_session_child_failure$
declare v_refused boolean:=false;
begin
  begin
    perform public.revert_import_session('16450000-0000-4000-8000-000000000051');
  exception when sqlstate 'P0001' then
    if sqlerrm<>'C04_IMPORT_SESSION_REVERT_REFUSED' then raise; end if;
    v_refused:=true;
  end;
  if not v_refused then
    raise exception 'C09_0164_SESSION_CHILD_NOT_REFUSED' using errcode='P0099';
  end if;
end;
$c09_0164_session_child_failure$;
reset role;
select 1/case when (select s.is_called and s.last_value=1
                      from pg_temp.c09_0164_later_child_hit s)
  then 1 else 0 end as c09_0164_later_child_reached;
drop trigger c09_0164_fail_later_child on public.import_batches;
drop function pg_temp.c09_0164_fail_later_child();
select 1/case when pg_temp.c09_0164_state(
  array['16450000-0000-4000-8000-000000000072'::uuid,'16450000-0000-4000-8000-000000000073'::uuid],
  '16450000-0000-4000-8000-000000000051'
)=(select value from c09_0164_atomic_before where name='session_child') then 1 else 0 end
  as c09_0164_session_child_conserved;

set local role authenticated;
select pg_catalog.set_config('request.jwt.claim.sub','16450000-0000-4000-8000-000000000001',true);
do $c09_0164_session_physical_failure$
declare v_refused boolean:=false;
begin
  begin
    perform public.revert_import_session('16450000-0000-4000-8000-000000000052');
  exception when sqlstate 'P04D3' then
    if sqlerrm<>'physical_bottle_dependency' then raise; end if;
    v_refused:=true;
  end;
  if not v_refused then raise exception 'C09_0164_SESSION_PHYSICAL_NOT_REFUSED' using errcode='P0099'; end if;
end;
$c09_0164_session_physical_failure$;
reset role;
select 1/case when pg_temp.c09_0164_state(
  array['16450000-0000-4000-8000-000000000074'::uuid,'16450000-0000-4000-8000-000000000075'::uuid],
  '16450000-0000-4000-8000-000000000052'
)=(select value from c09_0164_atomic_before where name='session_physical') then 1 else 0 end
  as c09_0164_session_physical_conserved;

do $c09_0164_history_conservation$
declare v_before jsonb; v_after jsonb;
begin
  select value into strict v_before from c09_0164_history_before;
  v_after:=pg_temp.c09_0164_history_snapshot();
  if v_after is distinct from v_before then
    raise exception 'C09_0164_HISTORY_CONSERVATION_FAILED';
  end if;
end;
$c09_0164_history_conservation$;

rollback;
\echo C09_0164_EXTENDED_MATRIX_PASS
