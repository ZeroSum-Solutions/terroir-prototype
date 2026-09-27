-- 0163 rollback-only functional, authorization and conservation contract.
\set ON_ERROR_STOP on
\pset pager off

\if :{?expected_database}
\else
  \echo C08_0163_EXPECTED_DATABASE_REQUIRED
  \quit 3
\endif
\if :{?target_admitted}
\else
  \echo C08_0163_TARGET_ADMISSION_REQUIRED
  \quit 3
\endif
\if :{?source_0163_sha256}
\else
  \echo C08_0163_SOURCE_PIN_REQUIRED
  \quit 3
\endif

select 1 / case when
  current_database() = :'expected_database'
  and current_user = 'postgres'
  and session_user = 'postgres'
  and :'target_admitted' = 'on'
  and :'source_0163_sha256' = '0c64a578bc2253c149bef9a2e1479fbfdefb1e3bf1820f3c4da68e8d46537583'
  and pg_catalog.to_regprocedure(
    'public.expire_stalled_invoice_scans(uuid)'
  ) is not null
then 1 else 0 end as c08_0163_target_admitted;

begin;
set local statement_timeout = '30s';
set local lock_timeout = '5s';

do $c08_0163_catalog$
declare
  v_function pg_catalog.pg_proc%rowtype;
begin
  select p.* into strict v_function
    from pg_catalog.pg_proc p
   where p.oid = pg_catalog.to_regprocedure(
     'public.expire_stalled_invoice_scans(uuid)'
   );
  if (select pg_catalog.count(*)
        from pg_catalog.pg_proc p
        join pg_catalog.pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public'
         and p.proname = 'expire_stalled_invoice_scans') <> 1
     or pg_catalog.encode(
       pg_catalog.sha256(pg_catalog.convert_to(v_function.prosrc, 'UTF8')),
       'hex'
     ) <> 'bd01b007ef6b2bc0b37b3e7126f938f8ae10d5600b7499ccd941abd5efa0b8a1'
     or pg_catalog.pg_get_userbyid(v_function.proowner) <> 'postgres'
     or v_function.prorettype <> pg_catalog.to_regtype('pg_catalog.jsonb')
     or v_function.provolatile <> 'v'
     or not v_function.prosecdef
     or v_function.proconfig is distinct from array['search_path=""']::text[]
     or pg_catalog.to_jsonb(v_function.proargnames) is distinct from
       '["p_restaurant_id"]'::pg_catalog.jsonb
     or pg_catalog.to_jsonb(v_function.proacl) is distinct from
       '["postgres=X/postgres", "authenticated=X/postgres"]'::pg_catalog.jsonb
     or pg_catalog.has_function_privilege(
       'anon', 'public.expire_stalled_invoice_scans(uuid)', 'EXECUTE'
     )
     or pg_catalog.has_function_privilege(
       'service_role', 'public.expire_stalled_invoice_scans(uuid)', 'EXECUTE'
     ) then
    raise exception 'C08_0163_CATALOG_CONTRACT_FAILED';
  end if;
end;
$c08_0163_catalog$;

insert into auth.users(id,email) values
  ('16300000-0000-4000-8000-000000000001','c08-0163-owner@terroir.test'),
  ('16300000-0000-4000-8000-000000000002','c08-0163-manager@terroir.test'),
  ('16300000-0000-4000-8000-000000000003','c08-0163-staff@terroir.test'),
  ('16300000-0000-4000-8000-000000000004','c08-0163-foreign@terroir.test'),
  ('16300000-0000-4000-8000-000000000005','c08-0163-revoked@terroir.test'),
  ('16300000-0000-4000-8000-000000000006','c08-0163-expired@terroir.test'),
  ('16300000-0000-4000-8000-000000000007','c08-0163-workspace-revoked@terroir.test');

insert into public.workspaces(id,kind,name) values
  ('16300000-0000-4000-8000-000000000010','restaurant','C08 0163 workspace');
insert into public.restaurants(id,name,workspace_id) values
  ('16300000-0000-4000-8000-000000000020','C08 0163 site','16300000-0000-4000-8000-000000000010'),
  ('16300000-0000-4000-8000-000000000021','C08 0163 foreign site','16300000-0000-4000-8000-000000000010');
insert into public.workspace_memberships(
  id,workspace_id,user_id,governance_role,status,revoked_at
) values
  ('16300000-0000-4000-8000-000000000030','16300000-0000-4000-8000-000000000010','16300000-0000-4000-8000-000000000001','workspace_owner','active',null),
  ('16300000-0000-4000-8000-000000000031','16300000-0000-4000-8000-000000000010','16300000-0000-4000-8000-000000000002','group_admin','active',null),
  ('16300000-0000-4000-8000-000000000032','16300000-0000-4000-8000-000000000010','16300000-0000-4000-8000-000000000003',null,'active',null),
  ('16300000-0000-4000-8000-000000000033','16300000-0000-4000-8000-000000000010','16300000-0000-4000-8000-000000000004',null,'active',null),
  ('16300000-0000-4000-8000-000000000034','16300000-0000-4000-8000-000000000010','16300000-0000-4000-8000-000000000005',null,'active',null),
  ('16300000-0000-4000-8000-000000000035','16300000-0000-4000-8000-000000000010','16300000-0000-4000-8000-000000000006',null,'active',null),
  ('16300000-0000-4000-8000-000000000036','16300000-0000-4000-8000-000000000010','16300000-0000-4000-8000-000000000007',null,'revoked',pg_catalog.statement_timestamp());
insert into public.memberships(
  id,user_id,restaurant_id,role,workspace_membership_id,status,revoked_at,expires_at
) values
  ('16300000-0000-4000-8000-000000000040','16300000-0000-4000-8000-000000000001','16300000-0000-4000-8000-000000000020','owner','16300000-0000-4000-8000-000000000030','active',null,null),
  ('16300000-0000-4000-8000-000000000041','16300000-0000-4000-8000-000000000002','16300000-0000-4000-8000-000000000020','manager','16300000-0000-4000-8000-000000000031','active',null,null),
  ('16300000-0000-4000-8000-000000000042','16300000-0000-4000-8000-000000000003','16300000-0000-4000-8000-000000000020','staff','16300000-0000-4000-8000-000000000032','active',null,null),
  ('16300000-0000-4000-8000-000000000043','16300000-0000-4000-8000-000000000004','16300000-0000-4000-8000-000000000021','staff','16300000-0000-4000-8000-000000000033','active',null,null),
  ('16300000-0000-4000-8000-000000000044','16300000-0000-4000-8000-000000000005','16300000-0000-4000-8000-000000000020','staff','16300000-0000-4000-8000-000000000034','revoked',pg_catalog.statement_timestamp(),null),
  ('16300000-0000-4000-8000-000000000045','16300000-0000-4000-8000-000000000006','16300000-0000-4000-8000-000000000020','staff','16300000-0000-4000-8000-000000000035','active',null,pg_catalog.statement_timestamp()-interval '1 minute'),
  ('16300000-0000-4000-8000-000000000046','16300000-0000-4000-8000-000000000007','16300000-0000-4000-8000-000000000020','staff','16300000-0000-4000-8000-000000000036','active',null,null);

select pg_catalog.set_config(
  'request.jwt.claim.sub','16300000-0000-4000-8000-000000000003',true
);

do $c08_0163_matrix$
declare
  v_site constant uuid := '16300000-0000-4000-8000-000000000020';
  v_foreign_site constant uuid := '16300000-0000-4000-8000-000000000021';
  v_actor constant uuid := '16300000-0000-4000-8000-000000000003';
  v_affected integer;
  v_result jsonb;
  v_second jsonb;
  v_scan_conserved_before jsonb;
  v_scan_conserved_after jsonb;
  v_jobs_before jsonb;
  v_jobs_after jsonb;
begin
  insert into public.invoice_scans(
    id,restaurant_id,created_by,distributor_name,parsed_line_items,
    final_line_items,edits,item_count,status,status_reason,updated_at,committed_at
  )
  select x.id,x.restaurant_id,v_actor,'C08 0163 '||x.label,
         '[]'::jsonb,'[]'::jsonb,'{}'::jsonb,0,x.status,x.reason,
         x.updated_at,x.committed_at
    from (values
      ('16300000-0000-4000-8000-000000000101'::uuid,v_site,'no-job','processing'::text,'before'::text,pg_catalog.statement_timestamp()-interval '16 minutes',null::timestamptz),
      ('16300000-0000-4000-8000-000000000102',v_site,'succeeded','processing','before',pg_catalog.statement_timestamp()-interval '16 minutes',null),
      ('16300000-0000-4000-8000-000000000103',v_site,'failed-job','processing','before',pg_catalog.statement_timestamp()-interval '16 minutes',null),
      ('16300000-0000-4000-8000-000000000104',v_site,'cancelled','processing','before',pg_catalog.statement_timestamp()-interval '16 minutes',null),
      ('16300000-0000-4000-8000-000000000105',v_site,'dead','processing','before',pg_catalog.statement_timestamp()-interval '16 minutes',null),
      ('16300000-0000-4000-8000-000000000106',v_site,'null-claim','processing','before',pg_catalog.statement_timestamp()-interval '16 minutes',null),
      ('16300000-0000-4000-8000-000000000107',v_site,'old-claim','processing','before',pg_catalog.statement_timestamp()-interval '16 minutes',null),
      ('16300000-0000-4000-8000-000000000108',v_site,'wrong-site-job','processing','before',pg_catalog.statement_timestamp()-interval '16 minutes',null),
      ('16300000-0000-4000-8000-000000000109',v_site,'wrong-type-job','processing','before',pg_catalog.statement_timestamp()-interval '16 minutes',null),
      ('16300000-0000-4000-8000-000000000110',v_site,'wrong-table-job','processing','before',pg_catalog.statement_timestamp()-interval '16 minutes',null),
      ('16300000-0000-4000-8000-000000000111',v_site,'wrong-subject-job','processing','before',pg_catalog.statement_timestamp()-interval '16 minutes',null),
      ('16300000-0000-4000-8000-000000000120',v_site,'queued','processing','before',pg_catalog.statement_timestamp()-interval '16 minutes',null),
      ('16300000-0000-4000-8000-000000000121',v_site,'retrying','processing','before',pg_catalog.statement_timestamp()-interval '16 minutes',null),
      ('16300000-0000-4000-8000-000000000122',v_site,'live-lease','processing','before',pg_catalog.statement_timestamp()-interval '16 minutes',null),
      ('16300000-0000-4000-8000-000000000123',v_site,'exact-lease','processing','before',pg_catalog.statement_timestamp()-interval '16 minutes',null),
      ('16300000-0000-4000-8000-000000000124',v_site,'recent','processing','before',pg_catalog.statement_timestamp()-interval '14 minutes',null),
      ('16300000-0000-4000-8000-000000000125',v_site,'exact-scan-boundary','processing','before',pg_catalog.statement_timestamp()-interval '15 minutes',null),
      ('16300000-0000-4000-8000-000000000126',v_site,'complete','complete','before',pg_catalog.statement_timestamp()-interval '16 minutes',null),
      ('16300000-0000-4000-8000-000000000127',v_site,'review','review','before',pg_catalog.statement_timestamp()-interval '16 minutes',null),
      ('16300000-0000-4000-8000-000000000128',v_site,'already-failed','failed','before',pg_catalog.statement_timestamp()-interval '16 minutes',null),
      ('16300000-0000-4000-8000-000000000129',v_site,'committed','processing','before',pg_catalog.statement_timestamp()-interval '16 minutes',pg_catalog.statement_timestamp()),
      ('16300000-0000-4000-8000-000000000130',v_foreign_site,'foreign','processing','before',pg_catalog.statement_timestamp()-interval '16 minutes',null)
    ) as x(id,restaurant_id,label,status,reason,updated_at,committed_at);

  insert into public.background_jobs(
    id,restaurant_id,created_by,job_type,status,subject_table,subject_id,
    claimed_at,run_after
  ) values
    ('16300000-0000-4000-8000-000000000201',v_site,v_actor,'invoice_extract','succeeded','invoice_scans','16300000-0000-4000-8000-000000000102',null,pg_catalog.statement_timestamp()),
    ('16300000-0000-4000-8000-000000000202',v_site,v_actor,'invoice_extract','failed','invoice_scans','16300000-0000-4000-8000-000000000103',null,pg_catalog.statement_timestamp()),
    ('16300000-0000-4000-8000-000000000203',v_site,v_actor,'invoice_extract','cancelled','invoice_scans','16300000-0000-4000-8000-000000000104',null,pg_catalog.statement_timestamp()),
    ('16300000-0000-4000-8000-000000000204',v_site,v_actor,'invoice_extract','dead','invoice_scans','16300000-0000-4000-8000-000000000105',null,pg_catalog.statement_timestamp()),
    ('16300000-0000-4000-8000-000000000205',v_site,v_actor,'invoice_extract','processing','invoice_scans','16300000-0000-4000-8000-000000000106',null,pg_catalog.statement_timestamp()),
    ('16300000-0000-4000-8000-000000000206',v_site,v_actor,'invoice_extract','processing','invoice_scans','16300000-0000-4000-8000-000000000107',pg_catalog.statement_timestamp()-interval '6 minutes',pg_catalog.statement_timestamp()),
    ('16300000-0000-4000-8000-000000000207',v_foreign_site,v_actor,'invoice_extract','queued','invoice_scans','16300000-0000-4000-8000-000000000108',null,pg_catalog.statement_timestamp()+interval '1 day'),
    ('16300000-0000-4000-8000-000000000208',v_site,v_actor,'wine_enrichment','queued','invoice_scans','16300000-0000-4000-8000-000000000109',null,pg_catalog.statement_timestamp()+interval '1 day'),
    ('16300000-0000-4000-8000-000000000209',v_site,v_actor,'invoice_extract','queued','wines','16300000-0000-4000-8000-000000000110',null,pg_catalog.statement_timestamp()+interval '1 day'),
    ('16300000-0000-4000-8000-000000000210',v_site,v_actor,'invoice_extract','queued','invoice_scans','16300000-0000-4000-8000-000000000999',null,pg_catalog.statement_timestamp()+interval '1 day'),
    ('16300000-0000-4000-8000-000000000211',v_site,v_actor,'invoice_extract','queued','invoice_scans','16300000-0000-4000-8000-000000000120',null,pg_catalog.statement_timestamp()+interval '1 day'),
    ('16300000-0000-4000-8000-000000000212',v_site,v_actor,'invoice_extract','retrying','invoice_scans','16300000-0000-4000-8000-000000000121',null,pg_catalog.statement_timestamp()+interval '1 day'),
    ('16300000-0000-4000-8000-000000000213',v_site,v_actor,'invoice_extract','processing','invoice_scans','16300000-0000-4000-8000-000000000122',pg_catalog.statement_timestamp()-interval '4 minutes',pg_catalog.statement_timestamp()),
    ('16300000-0000-4000-8000-000000000214',v_site,v_actor,'invoice_extract','processing','invoice_scans','16300000-0000-4000-8000-000000000123',pg_catalog.statement_timestamp()-interval '5 minutes',pg_catalog.statement_timestamp());

  select pg_catalog.jsonb_agg(
           pg_catalog.to_jsonb(s) - 'status' - 'status_reason' - 'updated_at'
           order by s.id
         ) into v_scan_conserved_before
    from public.invoice_scans s
   where s.id between
     '16300000-0000-4000-8000-000000000101' and
     '16300000-0000-4000-8000-000000000130';
  select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(j) order by j.id)
    into v_jobs_before
    from public.background_jobs j
   where j.id between
     '16300000-0000-4000-8000-000000000201' and
     '16300000-0000-4000-8000-000000000214';

  v_result := public.expire_stalled_invoice_scans(v_site);
  if v_result is distinct from pg_catalog.jsonb_build_object(
       'version',1,'expiredCount',11
     )
     or (select pg_catalog.count(*) from pg_catalog.jsonb_object_keys(v_result)) <> 2
     or (select pg_catalog.count(*) from public.invoice_scans s
          where s.id between
            '16300000-0000-4000-8000-000000000101' and
            '16300000-0000-4000-8000-000000000111'
            and s.status='failed' and s.status_reason='stalled') <> 11
     or exists (
       select 1 from public.invoice_scans s
        where s.id between
          '16300000-0000-4000-8000-000000000120' and
          '16300000-0000-4000-8000-000000000125'
          and (s.status is distinct from 'processing'
               or s.status_reason is distinct from 'before')
     )
     or exists (
       select 1 from public.invoice_scans s
        where s.id between
          '16300000-0000-4000-8000-000000000126' and
          '16300000-0000-4000-8000-000000000128'
          and s.status_reason is distinct from 'before'
     )
     or not exists (
       select 1 from public.invoice_scans s
        where s.id='16300000-0000-4000-8000-000000000129'
          and s.status='processing' and s.status_reason='before'
          and s.committed_at is not null
     )
     or not exists (
       select 1 from public.invoice_scans s
        where s.id='16300000-0000-4000-8000-000000000130'
          and s.status='processing' and s.status_reason='before'
     ) then
    raise exception 'C08_0163_EXPIRY_MATRIX_FAILED';
  end if;

  select pg_catalog.jsonb_agg(
           pg_catalog.to_jsonb(s) - 'status' - 'status_reason' - 'updated_at'
           order by s.id
         ) into v_scan_conserved_after
    from public.invoice_scans s
   where s.id between
     '16300000-0000-4000-8000-000000000101' and
     '16300000-0000-4000-8000-000000000130';
  select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(j) order by j.id)
    into v_jobs_after
    from public.background_jobs j
   where j.id between
     '16300000-0000-4000-8000-000000000201' and
     '16300000-0000-4000-8000-000000000214';
  if v_scan_conserved_after is distinct from v_scan_conserved_before
     or v_jobs_after is distinct from v_jobs_before then
    raise exception 'C08_0163_PAYLOAD_OR_JOB_CONSERVATION_FAILED';
  end if;

  v_second := public.expire_stalled_invoice_scans(v_site);
  if v_second is distinct from pg_catalog.jsonb_build_object(
       'version',1,'expiredCount',0
     ) then
    raise exception 'C08_0163_SECOND_CALL_NOT_ZERO';
  end if;

  -- The exact 15-minute scan and 5-minute lease boundaries were proved above
  -- against this DO statement's fixed statement_timestamp(). Refresh only
  -- those clocks before the later authority DO gets a newer statement time,
  -- so that phase measures authorization rather than elapsed milliseconds.
  update public.invoice_scans s
     set updated_at=pg_catalog.statement_timestamp()
   where s.id='16300000-0000-4000-8000-000000000125'
     and s.status='processing';
  update public.background_jobs j
     set claimed_at=pg_catalog.statement_timestamp()
   where j.id='16300000-0000-4000-8000-000000000214'
     and j.status='processing';

  -- Mirror the existing worker fences: stale-job recovery changes only the
  -- failed scan's status, then the completion persist is separately fenced on
  -- that scan still being processing. The expiry RPC itself never edits jobs.
  update public.background_jobs j
     set status='retrying',claimed_at=null
   where j.id='16300000-0000-4000-8000-000000000206'
     and j.status='processing';
  update public.invoice_scans s
     set status='processing'
   where s.id='16300000-0000-4000-8000-000000000107'
     and s.status='failed';
  get diagnostics v_affected = row_count;
  if v_affected<>1 or not exists (
    select 1 from public.invoice_scans s
     where s.id='16300000-0000-4000-8000-000000000107'
       and s.status='processing' and s.status_reason='stalled'
  ) then
    raise exception 'C08_0163_FAILED_RESET_FENCE_FAILED';
  end if;
  update public.invoice_scans s
     set status='complete',status_reason=null
   where s.id='16300000-0000-4000-8000-000000000107'
     and s.status='processing';
  get diagnostics v_affected = row_count;
  if v_affected<>1 or not exists (
    select 1 from public.invoice_scans s
     where s.id='16300000-0000-4000-8000-000000000107'
       and s.status='complete' and s.status_reason is null
  ) then
    raise exception 'C08_0163_STALE_LEASE_RECOVERY_FAILED';
  end if;
end;
$c08_0163_matrix$;

insert into public.invoice_scans(
  id,restaurant_id,created_by,distributor_name,parsed_line_items,
  final_line_items,edits,item_count,status,status_reason,updated_at
) values (
  '16300000-0000-4000-8000-000000000140',
  '16300000-0000-4000-8000-000000000020',
  '16300000-0000-4000-8000-000000000003','C08 authority sentinel',
  '[]','[]','{}',0,'processing','before',
  pg_catalog.statement_timestamp()-interval '16 minutes'
);

set local role authenticated;
do $c08_0163_authority$
declare
  v_site constant uuid := '16300000-0000-4000-8000-000000000020';
  v_case jsonb;
  v_result jsonb;
begin
  foreach v_case in array array[
    pg_catalog.jsonb_build_object('actor',''),
    pg_catalog.jsonb_build_object('actor','16300000-0000-4000-8000-000000000004'),
    pg_catalog.jsonb_build_object('actor','16300000-0000-4000-8000-000000000005'),
    pg_catalog.jsonb_build_object('actor','16300000-0000-4000-8000-000000000006'),
    pg_catalog.jsonb_build_object('actor','16300000-0000-4000-8000-000000000007')
  ] loop
    perform pg_catalog.set_config('request.jwt.claim.sub',v_case->>'actor',true);
    begin
      perform public.expire_stalled_invoice_scans(v_site);
      raise exception 'C08_0163_EXPECTED_AUTHORITY_REFUSAL';
    exception when sqlstate '42501' then
      if sqlerrm <> 'forbidden' then raise; end if;
    end;
  end loop;

  perform pg_catalog.set_config(
    'request.jwt.claim.sub','16300000-0000-4000-8000-000000000003',true
  );
  if not exists (
    select 1 from public.invoice_scans s
     where s.id='16300000-0000-4000-8000-000000000140'
       and s.status='processing' and s.status_reason='before'
  ) then
    raise exception 'C08_0163_AUTHORITY_REFUSAL_CHANGED_SCAN';
  end if;

  foreach v_case in array array[
    pg_catalog.jsonb_build_object(
      'actor','16300000-0000-4000-8000-000000000001','expiredCount',1
    ),
    pg_catalog.jsonb_build_object(
      'actor','16300000-0000-4000-8000-000000000002','expiredCount',0
    ),
    pg_catalog.jsonb_build_object(
      'actor','16300000-0000-4000-8000-000000000003','expiredCount',0
    )
  ] loop
    perform pg_catalog.set_config('request.jwt.claim.sub',v_case->>'actor',true);
    v_result := public.expire_stalled_invoice_scans(v_site);
    if v_result is distinct from pg_catalog.jsonb_build_object(
         'version',1,'expiredCount',(v_case->>'expiredCount')::integer
       ) then
      raise exception 'C08_0163_AUTHORIZED_ROLE_FAILED';
    end if;
  end loop;
  if not exists (
    select 1 from public.invoice_scans s
     where s.id='16300000-0000-4000-8000-000000000140'
       and s.status='failed' and s.status_reason='stalled'
  ) then
    raise exception 'C08_0163_AUTHORIZED_ROLE_DID_NOT_EXPIRE';
  end if;

  perform pg_catalog.set_config(
    'request.jwt.claim.sub','16300000-0000-4000-8000-000000000003',true
  );
  begin
    perform public.expire_stalled_invoice_scans(null);
    raise exception 'C08_0163_EXPECTED_NULL_SITE_REFUSAL';
  exception when sqlstate '42501' then
    if sqlerrm <> 'forbidden' then raise; end if;
  end;
end;
$c08_0163_authority$;
reset role;

rollback;
\echo C08_0163_STALLED_SCAN_EXPIRY_CONTRACT_PASS
