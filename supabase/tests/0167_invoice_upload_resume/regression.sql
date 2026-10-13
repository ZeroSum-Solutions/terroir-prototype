-- Local-only rollback proof. No network, provider, retained identity or object writes.
\set ON_ERROR_STOP on
begin isolation level repeatable read;
set local statement_timeout='30s';
set local lock_timeout='3s';
set local idle_in_transaction_session_timeout='30s';
lock table auth.users,public.workspaces,public.restaurants,public.workspace_memberships,
 public.memberships,public.scan_idempotency,public.invoice_scans,storage.objects
 in share row exclusive mode nowait;
do $ids$ begin
 if exists(select 1 from auth.users where id::text like '16780000-%')
 or exists(select 1 from public.workspaces where id::text like '16780000-%')
 or exists(select 1 from public.restaurants where id::text like '16780000-%')
 or exists(select 1 from public.workspace_memberships where id::text like '16780000-%')
 or exists(select 1 from public.memberships where id::text like '16780000-%')
 or exists(select 1 from public.scan_idempotency where key::text like '16780000-%')
 or exists(select 1 from public.invoice_scans where id::text like '16780000-%')
 or exists(select 1 from storage.objects where name like '16780000-%') then
   raise exception 'C04_0167_FIXTURE_OCCUPIED';end if;
end $ids$;
insert into auth.users(id,email) values
 ('16780000-0000-4000-8000-000000000001','c04-s16-resume-owner@terroir.test'),
 ('16780000-0000-4000-8000-000000000002','c04-s16-resume-staff@terroir.test');
insert into public.workspaces(id,kind,name) values
 ('16780000-0000-4000-8000-000000000010','restaurant','Invoice resume proof');
insert into public.restaurants(id,workspace_id,name) values
 ('16780000-0000-4000-8000-000000000020','16780000-0000-4000-8000-000000000010','Invoice resume site');
insert into public.workspace_memberships(id,workspace_id,user_id,governance_role) values
 ('16780000-0000-4000-8000-000000000011','16780000-0000-4000-8000-000000000010','16780000-0000-4000-8000-000000000001','workspace_owner'),
 ('16780000-0000-4000-8000-000000000012','16780000-0000-4000-8000-000000000010','16780000-0000-4000-8000-000000000002',null);
insert into public.memberships(id,user_id,restaurant_id,role,workspace_membership_id) values
 ('16780000-0000-4000-8000-000000000031','16780000-0000-4000-8000-000000000001','16780000-0000-4000-8000-000000000020','owner','16780000-0000-4000-8000-000000000011'),
 ('16780000-0000-4000-8000-000000000032','16780000-0000-4000-8000-000000000002','16780000-0000-4000-8000-000000000020','staff','16780000-0000-4000-8000-000000000012');
insert into storage.objects(bucket_id,name,owner,owner_id,metadata,user_metadata) values
 ('invoice-images','16780000-0000-4000-8000-000000000020/16780000-0000-4000-8000-000000000060_page1.jpg',
  '16780000-0000-4000-8000-000000000001','16780000-0000-4000-8000-000000000001',
  '{"size":13,"mimetype":"image/jpeg"}',jsonb_build_object('sha256',repeat('a',64)));
set local role authenticated;
select set_config('request.jwt.claim.sub','16780000-0000-4000-8000-000000000001',true);
do $resume$
declare v_site uuid:='16780000-0000-4000-8000-000000000020';
 v_scan uuid:='16780000-0000-4000-8000-000000000060';
 v_path text:=v_site::text||'/'||v_scan::text||'_page1.jpg';
begin
 if public.can_resume_invoice_upload(v_site,v_scan,v_path,repeat('a',64),13,'image/jpeg') then
  raise exception 'UNCLAIMED_UPLOAD_RESUMED';end if;
 perform * from public.claim_scan_idempotency(v_site,v_scan,'invoice_scan_upload');
 if not public.can_resume_invoice_upload(v_site,v_scan,v_path,repeat('a',64),13,'image/jpeg') then
  raise exception 'OWNED_PENDING_UPLOAD_NOT_RESUMED';end if;
 if public.can_resume_invoice_upload(v_site,v_scan,v_path,repeat('b',64),13,'image/jpeg')
 or public.can_resume_invoice_upload(v_site,v_scan,v_path,repeat('a',64),14,'image/jpeg')
 or public.can_resume_invoice_upload(v_site,v_scan,v_path,repeat('a',64),13,'image/png')
 or public.can_resume_invoice_upload(v_site,v_scan,v_path||'.jpg',repeat('a',64),13,'image/jpeg')
 or public.can_resume_invoice_upload(v_site,v_scan,v_path,null,13,'image/jpeg')
 or public.can_resume_invoice_upload(null,v_scan,v_path,repeat('a',64),13,'image/jpeg') then
  raise exception 'NONEXACT_UPLOAD_RESUMED';end if;
 if exists(select 1 from storage.objects where bucket_id='invoice-images' and name=v_path) then
  raise exception 'PENDING_PRIVATE_IMAGE_READ_LEAK';end if;
 perform set_config('request.jwt.claim.sub','16780000-0000-4000-8000-000000000002',true);
 if public.can_resume_invoice_upload(v_site,v_scan,v_path,repeat('a',64),13,'image/jpeg') then
  raise exception 'OTHER_ACTOR_UPLOAD_RESUMED';end if;
 perform set_config('request.jwt.claim.sub','',true);
 if public.can_resume_invoice_upload(v_site,v_scan,v_path,repeat('a',64),13,'image/jpeg') then
  raise exception 'MISSING_ACTOR_UPLOAD_RESUMED';end if;
end $resume$;
reset role;
savepoint creator_manifest;
insert into storage.objects(bucket_id,name,owner,owner_id,metadata,user_metadata) values
 ('invoice-images','16780000-0000-4000-8000-000000000020/16780000-0000-4000-8000-000000000060_page2.jpg',
  '16780000-0000-4000-8000-000000000002','16780000-0000-4000-8000-000000000002',
  '{"size":13,"mimetype":"image/jpeg"}',jsonb_build_object('sha256',repeat('a',64)));
set local role authenticated;
select set_config('request.jwt.claim.sub','16780000-0000-4000-8000-000000000001',true);
do $manifest$
declare v_site uuid:='16780000-0000-4000-8000-000000000020';
 v_scan uuid:='16780000-0000-4000-8000-000000000060';
 v_prefix text:=v_site::text||'/'||v_scan::text; v_message text;
begin
 begin
  perform public.create_invoice_scan_upload_manifest(v_site,v_scan,v_prefix||'_page1.jpg',
   'Synthetic distributor',null,null,array[v_prefix||'_page1.jpg',v_prefix||'_page1.jpg']);
  raise exception 'DUPLICATE_MANIFEST_ADOPTED';
 exception when sqlstate 'P0001' then
  get stacked diagnostics v_message=message_text;
  if v_message<>'C04_SCAN_UPLOAD_REFUSED' then raise;end if;
 end;
 begin
  perform public.create_invoice_scan_upload_manifest(v_site,v_scan,v_prefix||'_page1.jpg',
   'Synthetic distributor',null,null,array[v_prefix||'_page1.jpg',v_prefix||'_page2.jpg',v_prefix||'_page3.jpg']);
  raise exception 'MISSING_MANIFEST_PAGE_ADOPTED';
 exception when sqlstate 'P0001' then
  get stacked diagnostics v_message=message_text;
  if v_message<>'C04_SCAN_UPLOAD_REFUSED' then raise;end if;
 end;
 begin
  perform public.create_invoice_scan_upload_manifest(v_site,v_scan,v_prefix||'_page1.jpg',
   'Synthetic distributor',null,null,array[v_prefix||'_page1.jpg']);
  raise exception 'STALE_EXTRA_PAGE_ADOPTED';
 exception when sqlstate 'P0001' then
  get stacked diagnostics v_message=message_text;
  if v_message<>'C04_SCAN_UPLOAD_REFUSED' then raise;end if;
 end;
 begin
  perform public.create_invoice_scan_upload_manifest(v_site,v_scan,v_prefix||'_page1.jpg',
   'Synthetic distributor',null,null,array[v_prefix||'_page1.jpg',v_prefix||'_page2.jpg']);
  raise exception 'CROSS_ACTOR_PAGE_ADOPTED';
 exception when sqlstate 'P0001' then
  get stacked diagnostics v_message=message_text;
  if v_message<>'C04_SCAN_UPLOAD_REFUSED' then raise;end if;
 end;
end $manifest$;
reset role;
do $zero_effect$ begin
 if exists(select 1 from public.invoice_scans where id='16780000-0000-4000-8000-000000000060')
 or exists(select 1 from public.background_jobs where subject_id='16780000-0000-4000-8000-000000000060') then
 raise exception 'REFUSED_MANIFEST_PARTIAL_EFFECT';end if;
end $zero_effect$;
update storage.objects set owner='16780000-0000-4000-8000-000000000001',
 owner_id='16780000-0000-4000-8000-000000000001'
 where bucket_id='invoice-images'
 and name='16780000-0000-4000-8000-000000000020/16780000-0000-4000-8000-000000000060_page2.jpg';
set local role authenticated;
select set_config('request.jwt.claim.sub','16780000-0000-4000-8000-000000000001',true);
do $valid_manifest$
declare v_site uuid:='16780000-0000-4000-8000-000000000020';
 v_scan uuid:='16780000-0000-4000-8000-000000000060';
 v_prefix text:=v_site::text||'/'||v_scan::text; v_result jsonb;
begin
 v_result:=public.create_invoice_scan_upload_manifest(v_site,v_scan,v_prefix||'_page1.jpg',
 'Synthetic distributor',null,null,array[v_prefix||'_page1.jpg',v_prefix||'_page2.jpg']);
 if v_result<>jsonb_build_object('scanId',v_scan,'status','queued') then
 raise exception 'EXACT_MANIFEST_RECEIPT_INVALID';end if;
 if public.can_resume_invoice_upload(v_site,v_scan,v_prefix||'_page1.jpg',repeat('a',64),13,'image/jpeg') then
 raise exception 'CREATED_SCAN_RESUMED';end if;
end $valid_manifest$;
reset role;
do $queued$ begin
 if not exists(select 1 from public.invoice_scans where id='16780000-0000-4000-8000-000000000060'
   and created_by='16780000-0000-4000-8000-000000000001' and status='processing'
   and extra_image_paths='["16780000-0000-4000-8000-000000000020/16780000-0000-4000-8000-000000000060_page2.jpg"]'::jsonb)
 or (select count(*) from public.background_jobs where subject_id='16780000-0000-4000-8000-000000000060'
   and created_by='16780000-0000-4000-8000-000000000001' and status='queued')<>1 then
 raise exception 'EXACT_MANIFEST_NOT_ATOMIC';end if;
end $queued$;
rollback to savepoint creator_manifest;
release savepoint creator_manifest;
update public.scan_idempotency set created_at=statement_timestamp()-interval '25 hours'
 where key='16780000-0000-4000-8000-000000000060';
set local role authenticated;
select set_config('request.jwt.claim.sub','16780000-0000-4000-8000-000000000001',true);
do $expired$ begin
 if public.can_resume_invoice_upload('16780000-0000-4000-8000-000000000020',
 '16780000-0000-4000-8000-000000000060',
 '16780000-0000-4000-8000-000000000020/16780000-0000-4000-8000-000000000060_page1.jpg',
 repeat('a',64),13,'image/jpeg') then raise exception 'EXPIRED_CLAIM_RESUMED';end if;
end $expired$;
reset role;
update public.scan_idempotency set created_at=statement_timestamp(),response_body=
 '{"version":1,"kind":"invoice_inventory_save","status":"claimed"}'
 where key='16780000-0000-4000-8000-000000000060';
set local role authenticated;
do $wrong_kind$ begin
 if public.can_resume_invoice_upload('16780000-0000-4000-8000-000000000020',
 '16780000-0000-4000-8000-000000000060',
 '16780000-0000-4000-8000-000000000020/16780000-0000-4000-8000-000000000060_page1.jpg',
 repeat('a',64),13,'image/jpeg') then raise exception 'WRONG_KIND_CLAIM_RESUMED';end if;
end $wrong_kind$;
reset role;
update public.scan_idempotency set response_body=
 '{"version":1,"kind":"invoice_scan_upload","status":"claimed"}',response_status=202
 where key='16780000-0000-4000-8000-000000000060';
set local role authenticated;
do $completed$ begin
 if public.can_resume_invoice_upload('16780000-0000-4000-8000-000000000020',
 '16780000-0000-4000-8000-000000000060',
 '16780000-0000-4000-8000-000000000020/16780000-0000-4000-8000-000000000060_page1.jpg',
 repeat('a',64),13,'image/jpeg') then raise exception 'COMPLETED_CLAIM_RESUMED';end if;
end $completed$;
reset role;
update public.scan_idempotency set response_status=null,response_body=
 '{"version":1,"kind":"invoice_scan_upload","status":"claimed","private":"unexpected"}'
 where key='16780000-0000-4000-8000-000000000060';
set local role authenticated;
do $malformed$ begin
 if public.can_resume_invoice_upload('16780000-0000-4000-8000-000000000020',
 '16780000-0000-4000-8000-000000000060',
 '16780000-0000-4000-8000-000000000020/16780000-0000-4000-8000-000000000060_page1.jpg',
 repeat('a',64),13,'image/jpeg') then raise exception 'MALFORMED_CLAIM_RESUMED';end if;
end $malformed$;
reset role;
do $acl$ begin
 if has_function_privilege('anon','public.can_resume_invoice_upload(uuid,uuid,text,text,integer,text)','EXECUTE')
 or has_function_privilege('service_role','public.can_resume_invoice_upload(uuid,uuid,text,text,integer,text)','EXECUTE') then
 raise exception 'UNEXPECTED_RESUME_PRIVILEGE';end if;
 if has_function_privilege('authenticated','public.create_invoice_scan_upload(uuid,uuid,text,text,text,date)','EXECUTE')
 or has_function_privilege('anon','public.create_invoice_scan_upload_manifest(uuid,uuid,text,text,text,date,text[])','EXECUTE')
 or has_function_privilege('service_role','public.create_invoice_scan_upload_manifest(uuid,uuid,text,text,text,date,text[])','EXECUTE') then
 raise exception 'UNEXPECTED_CREATOR_PRIVILEGE';end if;
end $acl$;
rollback;
select 'C04_0167_RESUME_REGRESSION_ROLLBACK_PASS';
