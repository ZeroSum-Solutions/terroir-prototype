-- Actor/site/kind-bound 24-hour transport-cache contract. Disposable DB only.
\set ON_ERROR_STOP on
\pset pager off

begin;
do $cache_contract$
declare
  v_actor_a uuid:='15700000-0000-4000-8000-000000000001';
  v_actor_b uuid:='15700000-0000-4000-8000-000000000002';
  v_workspace uuid:='15700000-0000-4000-8000-000000000003';
  v_site uuid:='15700000-0000-4000-8000-000000000004';
  v_foreign_site uuid:='15700000-0000-4000-8000-000000000005';
  v_scan_a uuid:='15700000-0000-4000-8000-000000000010';
  v_scan_b uuid:='15700000-0000-4000-8000-000000000011';
  v_wine uuid:='15700000-0000-4000-8000-000000000012';
  v_foreign_scan uuid:='15700000-0000-4000-8000-000000000013';
  v_foreign_wine uuid:='15700000-0000-4000-8000-000000000014';
  v_key uuid:='15700000-0000-4000-8000-000000000020';
  v_bad_key uuid:='15700000-0000-4000-8000-000000000021';
  v_legacy_key uuid:='15700000-0000-4000-8000-000000000022';
  v_disposition text; v_receipt jsonb; v_message text; v_actor_after uuid;
begin
  insert into auth.users(id,email) values
    (v_actor_a,'c04-cache-a@terroir.test'),(v_actor_b,'c04-cache-b@terroir.test');
  insert into public.workspaces(id,kind,name) values(v_workspace,'restaurant','C04 cache');
  insert into public.restaurants(id,name,workspace_id) values
    (v_site,'C04 cache site',v_workspace),
    (v_foreign_site,'C04 foreign cache site',v_workspace);
  insert into public.workspace_memberships(workspace_id,user_id) values
    (v_workspace,v_actor_a),(v_workspace,v_actor_b);
  insert into public.memberships(user_id,restaurant_id,role,workspace_membership_id)
  select wm.user_id,v_site,'staff',wm.id from public.workspace_memberships wm
   where wm.workspace_id=v_workspace;
  insert into public.invoice_scans(
    id,restaurant_id,created_by,distributor_name,parsed_line_items,final_line_items,edits,item_count,status
  ) values
    (v_scan_a,v_site,v_actor_a,'Cache A','[]','[]','{}',0,'processing'),
    (v_scan_b,v_site,v_actor_a,'Cache B','[]','[]','{}',0,'processing'),
    (v_foreign_scan,v_foreign_site,v_actor_a,'Foreign Cache','[]','[]','{}',0,'processing');
  insert into public.wines(id,restaurant_id,name,producer,size_ml)
    values
      (v_wine,v_site,'Cache Wine','C04',750),
      (v_foreign_wine,v_foreign_site,'Foreign Cache Wine','C04',750);

  perform set_config('request.jwt.claim.sub',v_actor_a::text,true);
  select c.disposition,c.receipt into v_disposition,v_receipt
    from public.claim_scan_idempotency(v_site,v_key,'invoice_scan_upload') c;
  if v_disposition<>'claimed' or v_receipt is not null then
    raise exception 'C04_0157_CACHE_FIRST_CLAIM_FAILED';
  end if;

  perform set_config('request.jwt.claim.sub',v_actor_b::text,true);
  begin
    perform * from public.claim_scan_idempotency(v_site,v_key,'invoice_scan_upload');
    raise exception 'C04_EXPECTED_FOREIGN_ACTOR_CONFLICT';
  exception when sqlstate 'P0001' then
    get stacked diagnostics v_message=message_text;
    if v_message<>'C04_IDEMPOTENCY_CONFLICT' then raise; end if;
  end;
  select c.claimed_by_user_id into v_actor_after from public.scan_idempotency c
   where c.restaurant_id=v_site and c.key=v_key;
  if v_actor_after is distinct from v_actor_a then
    raise exception 'C04_0157_CACHE_RACE_REBOUND_ACTOR';
  end if;

  perform set_config('request.jwt.claim.sub',v_actor_a::text,true);
  begin
    perform * from public.claim_scan_idempotency(v_site,v_key,'bottle_inventory_save');
    raise exception 'C04_EXPECTED_CROSS_KIND_CONFLICT';
  exception when sqlstate 'P0001' then
    get stacked diagnostics v_message=message_text;
    if v_message<>'C04_IDEMPOTENCY_CONFLICT' then raise; end if;
  end;
  select c.disposition,c.receipt into v_disposition,v_receipt
    from public.claim_scan_idempotency(v_site,v_key,'invoice_scan_upload') c;
  if v_disposition<>'in_progress' or v_receipt is not null then
    raise exception 'C04_0157_CACHE_IN_PROGRESS_MISMATCH';
  end if;
  v_receipt:=public.complete_scan_idempotency(
    v_site,v_key,'invoice_scan_upload',v_scan_a,0,null,null
  );
  if v_receipt is distinct from jsonb_build_object(
    'version',1,'kind','invoice_scan_upload','scanId',v_scan_a,'status','queued','itemCount',0
  ) then raise exception 'C04_0157_UPLOAD_RECEIPT_MISMATCH'; end if;
  select c.disposition,c.receipt into v_disposition,v_receipt
    from public.claim_scan_idempotency(v_site,v_key,'invoice_scan_upload') c;
  if v_disposition<>'replay' or v_receipt->>'scanId' is distinct from v_scan_a::text then
    raise exception 'C04_0157_UPLOAD_REPLAY_MISMATCH';
  end if;
  begin
    perform public.complete_scan_idempotency(
      v_site,v_key,'invoice_scan_upload',v_scan_b,0,null,null
    );
    raise exception 'C04_EXPECTED_RECOMPLETION_MISMATCH';
  exception when sqlstate 'P0001' then
    get stacked diagnostics v_message=message_text;
    if v_message<>'C04_IDEMPOTENCY_RECOMPLETION_MISMATCH' then raise; end if;
  end;

  insert into public.scan_idempotency(
    key,restaurant_id,response_status,response_body,created_at,claimed_by_user_id
  ) values(
    v_bad_key,v_site,200,
    jsonb_build_object('version',1,'kind','bottle_inventory_save','wineId',v_wine,
      'status','committed','itemCount',1,'extra','forbidden'),
    statement_timestamp(),v_actor_a
  );
  select c.disposition,c.receipt into v_disposition,v_receipt
    from public.claim_scan_idempotency(v_site,v_bad_key,'bottle_inventory_save') c;
  if v_disposition<>'expired' or v_receipt is not null then
    raise exception 'C04_0157_CACHE_EXTRA_KEY_REPLAYED';
  end if;

  insert into public.scan_idempotency(key,restaurant_id,response_status,response_body,created_at)
  values(v_legacy_key,v_site,200,'{"scanId":"legacy","itemCount":1}'::jsonb,statement_timestamp());
  begin
    perform * from public.claim_scan_idempotency(
      v_site,v_legacy_key,'invoice_inventory_save'
    );
    raise exception 'C04_EXPECTED_LEGACY_NULL_ACTOR_CONFLICT';
  exception when sqlstate 'P0001' then
    get stacked diagnostics v_message=message_text;
    if v_message<>'C04_IDEMPOTENCY_CONFLICT' then raise; end if;
  end;
  if not exists(
    select 1 from public.scan_idempotency c
     where c.key=v_legacy_key and c.restaurant_id=v_site
       and c.claimed_by_user_id is null
       and c.response_body='{"scanId":"legacy","itemCount":1}'::jsonb
  ) then
    raise exception 'C04_0157_CACHE_LEGACY_NULL_ACTOR_MUTATED';
  end if;

  -- Once actor binding is established, kind must still be proved before age
  -- or shape classification. NULL/non-object/missing/non-string/different
  -- kinds are the same generic conflict and their rows remain unchanged.
  v_key:='15700000-0000-4000-8000-000000000032';
  insert into public.scan_idempotency(
    key,restaurant_id,response_status,response_body,created_at,claimed_by_user_id
  ) values(
    v_key,v_site,200,null,statement_timestamp(),v_actor_a
  );
  begin
    perform * from public.claim_scan_idempotency(v_site,v_key,'invoice_inventory_save');
    raise exception 'C04_EXPECTED_NULL_BODY_CONFLICT';
  exception when sqlstate 'P0001' then
    get stacked diagnostics v_message=message_text;
    if v_message<>'C04_IDEMPOTENCY_CONFLICT' then raise; end if;
  end;

  v_key:='15700000-0000-4000-8000-000000000033';
  insert into public.scan_idempotency(
    key,restaurant_id,response_status,response_body,created_at,claimed_by_user_id
  ) values(v_key,v_site,200,'[]'::jsonb,statement_timestamp(),v_actor_a);
  begin
    perform * from public.claim_scan_idempotency(v_site,v_key,'invoice_inventory_save');
    raise exception 'C04_EXPECTED_NONOBJECT_BODY_CONFLICT';
  exception when sqlstate 'P0001' then
    get stacked diagnostics v_message=message_text;
    if v_message<>'C04_IDEMPOTENCY_CONFLICT' then raise; end if;
  end;

  v_key:='15700000-0000-4000-8000-000000000034';
  insert into public.scan_idempotency(
    key,restaurant_id,response_status,response_body,created_at,claimed_by_user_id
  ) values(
    v_key,v_site,null,'{"version":1,"status":"claimed"}'::jsonb,
    statement_timestamp(),v_actor_a
  );
  begin
    perform * from public.claim_scan_idempotency(v_site,v_key,'invoice_inventory_save');
    raise exception 'C04_EXPECTED_MISSING_KIND_CONFLICT';
  exception when sqlstate 'P0001' then
    get stacked diagnostics v_message=message_text;
    if v_message<>'C04_IDEMPOTENCY_CONFLICT' then raise; end if;
  end;

  v_key:='15700000-0000-4000-8000-000000000035';
  insert into public.scan_idempotency(
    key,restaurant_id,response_status,response_body,created_at,claimed_by_user_id
  ) values(
    v_key,v_site,null,'{"version":1,"kind":7,"status":"claimed"}'::jsonb,
    statement_timestamp(),v_actor_a
  );
  begin
    perform * from public.claim_scan_idempotency(v_site,v_key,'invoice_inventory_save');
    raise exception 'C04_EXPECTED_NONSTRING_KIND_CONFLICT';
  exception when sqlstate 'P0001' then
    get stacked diagnostics v_message=message_text;
    if v_message<>'C04_IDEMPOTENCY_CONFLICT' then raise; end if;
  end;

  v_key:='15700000-0000-4000-8000-000000000036';
  insert into public.scan_idempotency(
    key,restaurant_id,response_status,response_body,created_at,claimed_by_user_id
  ) values(
    v_key,v_site,null,
    '{"version":1,"kind":"bottle_inventory_save","status":"claimed"}'::jsonb,
    statement_timestamp()-interval '25 hours',v_actor_a
  );
  begin
    perform * from public.claim_scan_idempotency(v_site,v_key,'invoice_inventory_save');
    raise exception 'C04_EXPECTED_OLD_WRONG_KIND_CONFLICT';
  exception when sqlstate 'P0001' then
    get stacked diagnostics v_message=message_text;
    if v_message<>'C04_IDEMPOTENCY_CONFLICT' then raise; end if;
  end;

  -- Actor and kind are bound here, so malformed current claim shape is the
  -- expired/nonreplayable disposition rather than a binding conflict.
  v_key:='15700000-0000-4000-8000-000000000037';
  insert into public.scan_idempotency(
    key,restaurant_id,response_status,response_body,created_at,claimed_by_user_id
  ) values(
    v_key,v_site,null,
    '{"version":1,"kind":"invoice_inventory_save","status":"legacy"}'::jsonb,
    statement_timestamp(),v_actor_a
  );
  select c.disposition,c.receipt into v_disposition,v_receipt
    from public.claim_scan_idempotency(v_site,v_key,'invoice_inventory_save') c;
  if v_disposition<>'expired' or v_receipt is not null then
    raise exception 'C04_0157_CACHE_MATCHING_KIND_INVALID_SENTINEL_REPLAYED';
  end if;

  v_key:='15700000-0000-4000-8000-000000000024';
  insert into public.scan_idempotency(
    key,restaurant_id,response_status,response_body,created_at,claimed_by_user_id
  ) values(
    v_key,v_site,202,
    jsonb_build_object('version','1','kind','invoice_scan_upload','scanId',v_scan_a,
      'status','queued','itemCount',0),
    statement_timestamp(),v_actor_a
  );
  select c.disposition,c.receipt into v_disposition,v_receipt
    from public.claim_scan_idempotency(v_site,v_key,'invoice_scan_upload') c;
  if v_disposition<>'expired' or v_receipt is not null then
    raise exception 'C04_0157_CACHE_STRING_VERSION_REPLAYED';
  end if;

  v_key:='15700000-0000-4000-8000-000000000025';
  insert into public.scan_idempotency(
    key,restaurant_id,response_status,response_body,created_at,claimed_by_user_id
  ) values(
    v_key,v_site,202,
    jsonb_build_object('version',1,'kind','invoice_scan_upload','scanId',v_foreign_scan,
      'status','queued','itemCount',0),
    statement_timestamp(),v_actor_a
  );
  select c.disposition,c.receipt into v_disposition,v_receipt
    from public.claim_scan_idempotency(v_site,v_key,'invoice_scan_upload') c;
  if v_disposition<>'expired' or v_receipt is not null then
    raise exception 'C04_0157_CACHE_FOREIGN_SCAN_REPLAYED';
  end if;

  v_key:='15700000-0000-4000-8000-000000000023';
  perform * from public.claim_scan_idempotency(v_site,v_key,'invoice_inventory_save');
  begin
    perform public.complete_scan_idempotency(
      v_site,v_key,'invoice_inventory_save',v_scan_a,1,2,null
    );
    raise exception 'C04_EXPECTED_WINE_COUNT_REFUSAL';
  exception when sqlstate 'P0001' then null;
    get stacked diagnostics v_message=message_text;
    if v_message<>'C04_IDEMPOTENCY_COMPLETION_INVALID' then raise; end if;
  end;
  begin
    perform public.complete_scan_idempotency(
      v_site,v_key,'invoice_inventory_save',v_scan_a,1,1,v_wine
    );
    raise exception 'C04_EXPECTED_UNUSED_SCALAR_REFUSAL';
  exception when sqlstate 'P0001' then null;
    get stacked diagnostics v_message=message_text;
    if v_message<>'C04_IDEMPOTENCY_COMPLETION_INVALID' then raise; end if;
  end;
  begin
    perform public.complete_scan_idempotency(
      v_site,v_key,'invoice_inventory_save',v_foreign_scan,1,1,null
    );
    raise exception 'C04_EXPECTED_FOREIGN_SCAN_REFUSAL';
  exception when sqlstate 'P0001' then
    get stacked diagnostics v_message=message_text;
    if v_message<>'C04_IDEMPOTENCY_COMPLETION_INVALID' then raise; end if;
  end;

  v_key:='15700000-0000-4000-8000-000000000026';
  perform * from public.claim_scan_idempotency(v_site,v_key,'bottle_inventory_save');
  begin
    perform public.complete_scan_idempotency(
      v_site,v_key,'bottle_inventory_save',null,1,null,v_foreign_wine
    );
    raise exception 'C04_EXPECTED_FOREIGN_WINE_REFUSAL';
  exception when sqlstate 'P0001' then
    get stacked diagnostics v_message=message_text;
    if v_message<>'C04_IDEMPOTENCY_COMPLETION_INVALID' then raise; end if;
  end;

  -- Positive invoice-save receipt and replay.
  v_key:='15700000-0000-4000-8000-000000000027';
  perform * from public.claim_scan_idempotency(v_site,v_key,'invoice_inventory_save');
  v_receipt:=public.complete_scan_idempotency(
    v_site,v_key,'invoice_inventory_save',v_scan_a,2,1,null
  );
  if v_receipt is distinct from jsonb_build_object(
    'version',1,'kind','invoice_inventory_save','scanId',v_scan_a,
    'status','committed','itemCount',2,'wineCount',1
  ) then raise exception 'C04_0157_INVOICE_SAVE_RECEIPT_MISMATCH'; end if;
  select c.disposition,c.receipt into v_disposition,v_receipt
    from public.claim_scan_idempotency(v_site,v_key,'invoice_inventory_save') c;
  if v_disposition<>'replay' or v_receipt->>'wineCount' is distinct from '1' then
    raise exception 'C04_0157_INVOICE_SAVE_REPLAY_MISMATCH';
  end if;

  -- Positive bottle-save receipt and replay.
  v_key:='15700000-0000-4000-8000-000000000028';
  perform * from public.claim_scan_idempotency(v_site,v_key,'bottle_inventory_save');
  v_receipt:=public.complete_scan_idempotency(
    v_site,v_key,'bottle_inventory_save',null,1,null,v_wine
  );
  if v_receipt is distinct from jsonb_build_object(
    'version',1,'kind','bottle_inventory_save','wineId',v_wine,
    'status','committed','itemCount',1
  ) then raise exception 'C04_0157_BOTTLE_SAVE_RECEIPT_MISMATCH'; end if;
  select c.disposition,c.receipt into v_disposition,v_receipt
    from public.claim_scan_idempotency(v_site,v_key,'bottle_inventory_save') c;
  if v_disposition<>'replay' or v_receipt->>'wineId' is distinct from v_wine::text then
    raise exception 'C04_0157_BOTTLE_SAVE_REPLAY_MISMATCH';
  end if;

  -- Abandon removes only a matching unfinished claim.
  v_key:='15700000-0000-4000-8000-000000000029';
  perform * from public.claim_scan_idempotency(v_site,v_key,'invoice_scan_upload');
  if not public.abandon_scan_idempotency(v_site,v_key,'invoice_scan_upload') then
    raise exception 'C04_0157_ABANDON_RETURN_MISMATCH';
  end if;
  if exists(select 1 from public.scan_idempotency c where c.key=v_key and c.restaurant_id=v_site) then
    raise exception 'C04_0157_ABANDON_MISMATCH';
  end if;

  -- NULL kind is refused by every entrypoint before mutation.
  v_key:='15700000-0000-4000-8000-000000000030';
  begin
    perform * from public.claim_scan_idempotency(v_site,v_key,null);
    raise exception 'C04_EXPECTED_NULL_KIND_CLAIM_REFUSAL';
  exception when sqlstate 'P0001' then
    get stacked diagnostics v_message=message_text;
    if v_message<>'C04_IDEMPOTENCY_INVALID' then raise; end if;
  end;
  if exists(select 1 from public.scan_idempotency c where c.key=v_key and c.restaurant_id=v_site) then
    raise exception 'C04_0157_NULL_KIND_CLAIM_MUTATED';
  end if;
  begin
    perform public.complete_scan_idempotency(v_site,v_key,null,v_scan_a,0,null,null);
    raise exception 'C04_EXPECTED_NULL_KIND_COMPLETE_REFUSAL';
  exception when sqlstate 'P0001' then
    get stacked diagnostics v_message=message_text;
    if v_message<>'C04_IDEMPOTENCY_INVALID' then raise; end if;
  end;
  begin
    perform public.abandon_scan_idempotency(v_site,v_key,null);
    raise exception 'C04_EXPECTED_NULL_KIND_ABANDON_REFUSAL';
  exception when sqlstate 'P0001' then
    get stacked diagnostics v_message=message_text;
    if v_message<>'C04_IDEMPOTENCY_INVALID' then raise; end if;
  end;

  -- A claim older than the bounded 24-hour transport window cannot complete.
  v_key:='15700000-0000-4000-8000-000000000031';
  perform * from public.claim_scan_idempotency(v_site,v_key,'invoice_scan_upload');
  update public.scan_idempotency set created_at=statement_timestamp()-interval '25 hours'
   where key=v_key and restaurant_id=v_site;
  select c.disposition,c.receipt into v_disposition,v_receipt
    from public.claim_scan_idempotency(v_site,v_key,'invoice_scan_upload') c;
  if v_disposition<>'expired' or v_receipt is not null then
    raise exception 'C04_0157_EXPIRED_CLAIM_REPLAYED';
  end if;
  begin
    perform public.complete_scan_idempotency(
      v_site,v_key,'invoice_scan_upload',v_scan_a,0,null,null
    );
    raise exception 'C04_EXPECTED_EXPIRED_COMPLETION_REFUSAL';
  exception when sqlstate 'P0001' then
    get stacked diagnostics v_message=message_text;
    if v_message<>'C04_IDEMPOTENCY_EXPIRED' then raise; end if;
  end;

  -- The transport window is half-open: exactly 24 hours old is expired.
  v_key:='15700000-0000-4000-8000-000000000038';
  perform * from public.claim_scan_idempotency(v_site,v_key,'invoice_scan_upload');
  update public.scan_idempotency set created_at=statement_timestamp()-interval '24 hours'
   where key=v_key and restaurant_id=v_site;
  select c.disposition,c.receipt into v_disposition,v_receipt
    from public.claim_scan_idempotency(v_site,v_key,'invoice_scan_upload') c;
  if v_disposition<>'expired' or v_receipt is not null then
    raise exception 'C04_0157_EXACT_WINDOW_BOUNDARY_REPLAYED';
  end if;

  -- Actor binding remains stronger than age: a foreign actor never receives
  -- the expired disposition for somebody else's cache row.
  perform set_config('request.jwt.claim.sub',v_actor_b::text,true);
  begin
    perform * from public.claim_scan_idempotency(v_site,v_key,'invoice_scan_upload');
    raise exception 'C04_EXPECTED_EXPIRED_FOREIGN_ACTOR_CONFLICT';
  exception when sqlstate 'P0001' then
    get stacked diagnostics v_message=message_text;
    if v_message<>'C04_IDEMPOTENCY_CONFLICT' then raise; end if;
  end;
end;
$cache_contract$;
rollback;
\echo C04_0157_ADDITIVE_CACHE_RECEIPTS_PASS
