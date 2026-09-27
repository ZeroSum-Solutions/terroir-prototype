-- 0157 repair acceptance: real positive and negative flows for DB-001..010.
-- Disposable database only. Every fixture write is rolled back.
\set ON_ERROR_STOP on
\pset pager off

begin;
do $repair_acceptance$
declare
  v_actor uuid:='15720000-0000-4000-8000-000000000001';
  v_workspace uuid:='15720000-0000-4000-8000-000000000002';
  v_workspace_member uuid:='15720000-0000-4000-8000-000000000003';
  v_membership uuid:='15720000-0000-4000-8000-000000000004';
  v_site uuid:='15720000-0000-4000-8000-000000000005';
  v_foreign_site uuid:='15720000-0000-4000-8000-000000000006';
  v_wine_a uuid:='15720000-0000-4000-8000-000000000010';
  v_wine_b uuid:='15720000-0000-4000-8000-000000000011';
  v_wine_c uuid:='15720000-0000-4000-8000-000000000012';
  v_history_wine uuid:='15720000-0000-4000-8000-000000000013';
  v_foreign_wine uuid:='15720000-0000-4000-8000-000000000014';
  v_scan uuid:='15720000-0000-4000-8000-000000000020';
  v_review_scan uuid:='15720000-0000-4000-8000-000000000021';
  v_history_scan uuid:='15720000-0000-4000-8000-000000000022';
  v_reconcile uuid:='15720000-0000-4000-8000-000000000030';
  v_history_reconcile uuid:='15720000-0000-4000-8000-000000000031';
  v_foreign_reconcile uuid:='15720000-0000-4000-8000-000000000032';
  v_session uuid:='15720000-0000-4000-8000-000000000040';
  v_missing_session uuid:='15720000-0000-4000-8000-000000000041';
  v_line jsonb;
  v_result jsonb;
  v_replay jsonb;
  v_batch_id uuid;
  v_inventory_id uuid;
  v_updated_at timestamptz;
  v_message text;
  v_apply record;
begin
  insert into auth.users(id,email) values(v_actor,'c04-repair@terroir.test');
  insert into public.workspaces(id,kind,name)
    values(v_workspace,'restaurant','C04 repair acceptance');
  insert into public.restaurants(id,name,workspace_id) values
    (v_site,'C04 repair site',v_workspace),
    (v_foreign_site,'C04 foreign repair site',v_workspace);
  insert into public.workspace_memberships(
    id,workspace_id,user_id,governance_role
  ) values(v_workspace_member,v_workspace,v_actor,'workspace_owner');
  insert into public.memberships(
    id,user_id,restaurant_id,role,workspace_membership_id
  ) values(v_membership,v_actor,v_site,'owner',v_workspace_member);
  perform set_config('request.jwt.claim.sub',v_actor::text,true);
  perform public.replace_member_site_capabilities(
    v_membership,array['cost.read','pricing.manage'],null,'0157 repair fixture'
  );

  -- Same LWIN7 gives all three aliases one lineage while the distinct names
  -- keep the retained wines_dedup_idx satisfied.
  insert into public.wines(id,restaurant_id,name,producer,vintage,size_ml,lwin_id) values
    (v_wine_a,v_site,'Alias A','C04 Producer',2020,750,'1234567'),
    (v_wine_b,v_site,'Alias B','C04 Producer',2020,750,'1234567'),
    (v_wine_c,v_site,'Alias C','C04 Producer',2020,750,'1234567'),
    (v_history_wine,v_site,'History Wine','C04 Producer',2021,750,'7654321'),
    (v_foreign_wine,v_foreign_site,'Foreign Wine','C04 Producer',2020,750,'1111111');

  -- The legacy timestamptz dismissal remains callable while the new private
  -- receipt supports set and days=0 clear without returning the timestamp.
  if pg_catalog.pg_get_function_result(
       'public.dismiss_pricing_alert(uuid,integer)'::regprocedure
     )<>'timestamp with time zone' then
    raise exception 'C04_0157_LEGACY_DISMISSAL_RESULT_CHANGED';
  end if;
  v_result:=public.dismiss_pricing_alert_private(v_wine_b,10);
  if v_result is distinct from jsonb_build_object('wineId',v_wine_b,'updated',true)
     or not exists(select 1 from public.wines w
                    where w.id=v_wine_b and w.pricing_dismissed_until is not null) then
    raise exception 'C04_0157_PRIVATE_DISMISSAL_SET_FAILED';
  end if;
  perform public.dismiss_pricing_alert_private(v_wine_b,0);
  if exists(select 1 from public.wines w
             where w.id=v_wine_b and w.pricing_dismissed_until is not null) then
    raise exception 'C04_0157_PRIVATE_DISMISSAL_CLEAR_FAILED';
  end if;

  v_line:=jsonb_build_object(
    'id','line-1','name','Alias A','producer','C04 Producer','vintage',2020,
    'varietal','','region','','qty',2,'unitCost',12.50,'currency','USD',
    'format','750ml','confidence',0.95
  );
  insert into public.invoice_scans(
    id,restaurant_id,created_by,distributor_name,parsed_line_items,
    final_line_items,edits,item_count,status
  ) values(
    v_scan,v_site,v_actor,'C04 Invoice',jsonb_build_array(v_line),
    jsonb_build_array(v_line),'{}',1,'complete'
  );

  -- Manager match -> live merge rewrite -> commit honors the selected target.
  v_result:=public.accept_reconcile_batch(
    v_site,
    jsonb_build_array(jsonb_build_object(
      'action_type','match_scan','subject_table','invoice_scans','subject_id',v_scan,
      'patch',jsonb_build_object('line_index',0,'wine_id',v_wine_a,'expected_line',v_line)
    )),
    v_reconcile
  );
  if v_result->>'status'<>'accepted' then
    raise exception 'C04_0157_MATCH_SCAN_ACCEPT_FAILED';
  end if;
  v_result:=public.merge_wines(v_wine_a,v_wine_b);
  if v_result->>'moved_uncommitted_invoice_scans'<>'1'
     or (select s.final_line_items->0->>'wine_id' from public.invoice_scans s where s.id=v_scan)
        is distinct from v_wine_b::text
     or not exists(
       select 1 from public.reconcile_actions a
        where a.batch_id=v_reconcile
          and a.new_state->'final_line_items'->0->>'wine_id'=v_wine_a::text
     ) then
    raise exception 'C04_0157_MERGE_SCAN_OR_HISTORY_MISMATCH';
  end if;
  v_result:=public.commit_invoice_scan(v_scan);
  if v_result is distinct from jsonb_build_object(
       'scanId',v_scan,'itemCount',1,'wineCount',1
     )
     or not exists(
       select 1 from public.inventory_items ii
        where ii.invoice_scan_id=v_scan and ii.restaurant_id=v_site
          and ii.wine_id=v_wine_b and ii.quantity=2 and ii.unit_cost=12.50
     ) then
    raise exception 'C04_0157_MATCHED_SCAN_COMMIT_FAILED';
  end if;

  -- A later legitimate identity merge repoints inventory, but committed line
  -- evidence stays immutable and produces the identical replay receipt.
  perform public.merge_wines(v_wine_b,v_wine_c);
  v_replay:=public.commit_invoice_scan(v_scan);
  if v_replay is distinct from v_result
     or (select s.final_line_items->0->>'wine_id' from public.invoice_scans s where s.id=v_scan)
        is distinct from v_wine_b::text
     or not exists(select 1 from public.inventory_items ii
                    where ii.invoice_scan_id=v_scan and ii.wine_id=v_wine_c) then
    raise exception 'C04_0157_POST_MERGE_COMMIT_REPLAY_CHANGED';
  end if;
  begin
    perform public.review_invoice_scan(
      v_scan,(select s.updated_at from public.invoice_scans s where s.id=v_scan),
      'C04 Invoice',null,null,(select s.final_line_items from public.invoice_scans s where s.id=v_scan),'{}'
    );
    raise exception 'C04_EXPECTED_COMMITTED_REVIEW_REFUSAL';
  exception when sqlstate 'P0001' then
    get stacked diagnostics v_message=message_text;
    if v_message<>'scan_already_committed' then raise; end if;
  end;

  -- Review accepts an exact-site supplied identity but rejects a foreign one.
  insert into public.invoice_scans(
    id,restaurant_id,created_by,distributor_name,parsed_line_items,
    final_line_items,edits,item_count,status
  ) values(
    v_review_scan,v_site,v_actor,'C04 Review',jsonb_build_array(v_line),
    jsonb_build_array(v_line),'{}',1,'review'
  );
  select s.updated_at into v_updated_at from public.invoice_scans s where s.id=v_review_scan;
  perform public.review_invoice_scan(
    v_review_scan,v_updated_at,'C04 Review',null,null,
    jsonb_build_array(v_line||jsonb_build_object('wine_id',v_wine_c)),'{}'
  );
  select s.updated_at into v_updated_at from public.invoice_scans s where s.id=v_review_scan;
  begin
    perform public.review_invoice_scan(
      v_review_scan,v_updated_at,'C04 Review',null,null,
      jsonb_build_array(v_line||jsonb_build_object('wine_id',v_foreign_wine)),'{}'
    );
    raise exception 'C04_EXPECTED_FOREIGN_REVIEW_WINE_REFUSAL';
  exception when sqlstate 'P0001' then
    get stacked diagnostics v_message=message_text;
    if v_message<>'C04_SCAN_REVIEW_REFUSED' then raise; end if;
  end;

  -- Undo removes the live match while immutable reconcile history remains;
  -- direct owner deletion must still refuse that historical dependency.
  insert into public.invoice_scans(
    id,restaurant_id,created_by,distributor_name,parsed_line_items,
    final_line_items,edits,item_count,status
  ) values(
    v_history_scan,v_site,v_actor,'C04 History',jsonb_build_array(v_line),
    jsonb_build_array(v_line),'{}',1,'complete'
  );
  perform public.accept_reconcile_batch(
    v_site,
    jsonb_build_array(jsonb_build_object(
      'action_type','match_scan','subject_table','invoice_scans','subject_id',v_history_scan,
      'patch',jsonb_build_object('line_index',0,'wine_id',v_history_wine,'expected_line',v_line)
    )),
    v_history_reconcile
  );
  perform public.undo_reconcile_batch(v_history_reconcile);
  select w.updated_at into v_updated_at from public.wines w where w.id=v_history_wine;
  begin
    perform public.delete_wine_private(v_site,v_history_wine,v_updated_at);
    raise exception 'C04_EXPECTED_HISTORY_DELETE_REFUSAL';
  exception when sqlstate 'P0001' then
    get stacked diagnostics v_message=message_text;
    if v_message<>'wine_has_dependencies' then raise; end if;
  end;

  -- A foreign reconcile subject neither creates a batch nor mutates the row.
  begin
    perform public.accept_reconcile_batch(
      v_site,
      jsonb_build_array(jsonb_build_object(
        'action_type','dismiss','subject_table','wines','subject_id',v_foreign_wine,
        'patch','{}'::jsonb
      )),
      v_foreign_reconcile
    );
    raise exception 'C04_EXPECTED_FOREIGN_RECONCILE_REFUSAL';
  exception when sqlstate 'P0001' then
    get stacked diagnostics v_message=message_text;
    if v_message<>'C04_RECONCILE_ACCEPT_REFUSED' then raise; end if;
  end;
  if exists(select 1 from public.reconcile_batches b where b.id=v_foreign_reconcile)
     or not exists(select 1 from public.wines w where w.id=v_foreign_wine) then
    raise exception 'C04_0157_FOREIGN_RECONCILE_MUTATED';
  end if;

  -- Explicit-flag quantity patch preserves hidden cost and stable stale code.
  v_result:=public.create_inventory_item_private(
    v_site,v_wine_c,4,27.50,'USD',null,null,null,null,null,'manual'
  );
  v_inventory_id:=(v_result->>'inventoryItemId')::uuid;
  select ii.updated_at into v_updated_at from public.inventory_items ii where ii.id=v_inventory_id;
  v_result:=public.patch_inventory_item_private(
    v_inventory_id,v_updated_at,true,5,false,null,false,null,false,null,
    false,null,false,null,false,null
  );
  if v_result ? 'unit_cost'
     or not exists(select 1 from public.inventory_items ii
                    where ii.id=v_inventory_id and ii.quantity=5 and ii.unit_cost=27.50) then
    raise exception 'C04_0157_HIDDEN_COST_PATCH_MISMATCH';
  end if;
  begin
    perform public.patch_inventory_item_private(
      v_inventory_id,'2000-01-01T00:00:00Z',true,6,false,null,false,null,false,null,
      false,null,false,null,false,null
    );
    raise exception 'C04_EXPECTED_INVENTORY_STALE';
  exception when sqlstate 'P0001' then
    get stacked diagnostics v_message=message_text;
    if v_message<>'inventory_item_stale' then raise; end if;
  end;

  -- Import compatibility: preserve P0002/P0006, error_message output, an
  -- applied-row receipt, batches[], and safe already-reverted semantics.
  insert into public.import_sessions(
    id,restaurant_id,created_by,label,source_sha256,declared_chunk_total
  ) values(v_session,v_site,v_actor,'0157 repair',repeat('b',64),1);
  begin
    perform public.create_import_batch(
      v_site,v_actor,'missing.csv',1,'[{}]',v_missing_session,1,1,repeat('a',64),repeat('b',64)
    );
    raise exception 'C04_EXPECTED_IMPORT_SESSION_NOT_FOUND';
  exception when sqlstate 'P0002' then
    get stacked diagnostics v_message=message_text;
    if v_message<>'import_session_not_found' then raise; end if;
  end;
  begin
    perform public.create_import_batch(
      v_site,v_actor,'mismatch.csv',1,'[{}]',v_session,1,1,repeat('a',64),repeat('c',64)
    );
    raise exception 'C04_EXPECTED_IMPORT_SOURCE_MISMATCH';
  exception when sqlstate 'P0006' then
    get stacked diagnostics v_message=message_text;
    if v_message<>'import_source_mismatch' then raise; end if;
  end;
  v_result:=public.create_import_batch(
    v_site,v_actor,'repair.csv',1,
    jsonb_build_array(jsonb_build_object(
      'row_number',1,
      'raw',jsonb_build_object(
        'producer','Import Producer','name','Import Wine','vintage','2022',
        'varietal','Test','region','Test','country','US','size_ml','750',
        'quantity','3','unit_cost','9.50','currency','USD','format','750ml',
        'bin','','section',''
      ),
      'row_state','valid','validation_errors','[]'::jsonb,'lwin_status','unmatched',
      'lwin_id',null,'lwin_score',null,'cost_status','present','resolution','auto',
      'duplicate_reason',null
    )),
    v_session,1,1,repeat('a',64),repeat('b',64)
  );
  v_batch_id:=(v_result->>'batchId')::uuid;
  if v_batch_id is null then raise exception 'C04_0157_IMPORT_BATCH_RECEIPT_MISSING'; end if;
  select * into v_apply from public.apply_import_batch_chunk(v_batch_id,100);
  if not found or v_apply.outcome<>'applied' or v_apply.inventory_item_id is null
     or v_apply.error_message is not null or v_apply.error_code is not null then
    raise exception 'C04_0157_IMPORT_APPLY_RECEIPT_MISMATCH';
  end if;
  v_result:=public.revert_import_session(v_session);
  if jsonb_typeof(v_result->'batches')<>'array'
     or jsonb_array_length(v_result->'batches')<>1
     or v_result->'batches'->0->>'batchId' is distinct from v_batch_id::text
     or (v_result->'batches'->0->>'skipped')::boolean is distinct from false
     or (v_result->'batches'->0->>'revertedCount')::integer<>1 then
    raise exception 'C04_0157_IMPORT_SESSION_RECEIPT_MISMATCH';
  end if;
  begin
    perform public.revert_import_batch(v_batch_id);
    raise exception 'C04_EXPECTED_IMPORT_ALREADY_REVERTED';
  exception when sqlstate 'P0001' then
    get stacked diagnostics v_message=message_text;
    if v_message<>'import_batch_already_reverted' then raise; end if;
  end;

  -- Both import readers close NULL/zero/501 bounds and admit 500.
  begin
    perform * from public.read_import_batch_cost_rows(v_batch_id,null,100);
    raise exception 'C04_EXPECTED_NULL_CURSOR_REFUSAL';
  exception when sqlstate 'P0001' then null; end;
  begin
    perform * from public.read_import_batch_cost_rows(v_batch_id,0,null);
    raise exception 'C04_EXPECTED_NULL_LIMIT_REFUSAL';
  exception when sqlstate 'P0001' then null; end;
  begin
    perform * from public.read_import_batch_display_rows(v_batch_id,0,0);
    raise exception 'C04_EXPECTED_ZERO_LIMIT_REFUSAL';
  exception when sqlstate 'P0001' then null; end;
  begin
    perform * from public.read_import_batch_display_rows(v_batch_id,0,501);
    raise exception 'C04_EXPECTED_501_LIMIT_REFUSAL';
  exception when sqlstate 'P0001' then null; end;
  perform * from public.read_import_batch_cost_rows(v_batch_id,0,500);
  perform * from public.read_import_batch_display_rows(v_batch_id,0,500);

  -- Retained scan deletion receipt fields still work after the commit replay.
  v_result:=public.delete_invoice_scan(v_scan);
  if v_result is distinct from jsonb_build_object(
       'scanId',v_scan,'inventoryRowsDeleted',1,'bottlesRemoved',2
     ) then
    raise exception 'C04_0157_SCAN_DELETE_RECEIPT_MISMATCH';
  end if;
end;
$repair_acceptance$;
rollback;
\echo C04_0157_ADDITIVE_REPAIR_ACCEPTANCE_PASS
