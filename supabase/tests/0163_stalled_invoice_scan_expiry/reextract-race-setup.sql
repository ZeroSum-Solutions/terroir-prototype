-- Commit the exact re-extract/expiry race fixture on an admitted disposable DB.
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
select 1 / case when current_database()=:'expected_database'
  and current_user='postgres' and session_user='postgres'
  and :'target_admitted'='on'
  and pg_catalog.to_regprocedure(
    'public.request_invoice_scan_reextract(uuid)'
  ) is not null
  and pg_catalog.to_regprocedure(
    'public.expire_stalled_invoice_scans(uuid)'
  ) is not null
  and not exists(
    select 1 from auth.users
     where id='16350000-0000-4000-8000-000000000001'
  ) then 1 else 0 end as c08_0163_reextract_setup_target;

begin;
set local statement_timeout='30s';
set local lock_timeout='5s';
insert into auth.users(id,email,raw_user_meta_data) values (
  '16350000-0000-4000-8000-000000000001',
  'c08-0163-reextract-race@terroir.test',
  pg_catalog.jsonb_build_object('restaurant_name','C08 retained reextract site')
);
do $c08_0163_reextract_setup$
declare
  v_site uuid;
  v_workspace uuid;
  v_membership uuid;
  v_workspace_membership uuid;
  v_site_generation uuid;
  v_workspace_generation uuid;
begin
  select m.restaurant_id,r.workspace_id,m.id,m.workspace_membership_id,
         m.lifecycle_generation,wm.lifecycle_generation
    into strict v_site,v_workspace,v_membership,v_workspace_membership,
                v_site_generation,v_workspace_generation
    from public.memberships m
    join public.restaurants r on r.id=m.restaurant_id
    join public.workspace_memberships wm on wm.id=m.workspace_membership_id
   where m.user_id='16350000-0000-4000-8000-000000000001'
     and r.name='C08 retained reextract site'
     and m.role='owner' and m.status='active'
     and wm.status='active' and wm.governance_role='workspace_owner';

  insert into public.membership_capability_grants(
    id,workspace_id,restaurant_id,workspace_membership_id,membership_id,
    subject_user_id,site_lifecycle_generation,workspace_lifecycle_generation,
    capability_key,granted_by_user_id,grant_reason
  ) values (
    '16350000-0000-4000-8000-000000000041',v_workspace,v_site,
    v_workspace_membership,v_membership,
    '16350000-0000-4000-8000-000000000001',
    v_site_generation,v_workspace_generation,'cost.read',
    '16350000-0000-4000-8000-000000000001',
    '0163 retained literal reextract race fixture'
  );

  insert into public.invoice_scans(
    id,restaurant_id,created_by,distributor_name,ocr_text,parsed_line_items,
    final_line_items,edits,item_count,status,status_reason,updated_at
  ) values
    ('16350000-0000-4000-8000-000000000050',v_site,'16350000-0000-4000-8000-000000000001','C08 absent job','{}','[]','[]','{}',0,'processing','before',pg_catalog.statement_timestamp()-interval '16 minutes'),
    ('16350000-0000-4000-8000-000000000051',v_site,'16350000-0000-4000-8000-000000000001','C08 terminal job','{}','[]','[]','{}',0,'processing','before',pg_catalog.statement_timestamp()-interval '16 minutes'),
    ('16350000-0000-4000-8000-000000000052',v_site,'16350000-0000-4000-8000-000000000001','C08 reverse order','{}','[]','[]','{}',0,'processing','before',pg_catalog.statement_timestamp()-interval '16 minutes');
  insert into public.background_jobs(
    id,restaurant_id,created_by,job_type,status,subject_table,subject_id,
    idempotency_key,attempt_count,error_code,error_message,finished_at
  ) values (
    '16350000-0000-4000-8000-000000000060',v_site,
    '16350000-0000-4000-8000-000000000001','invoice_extract','failed',
    'invoice_scans','16350000-0000-4000-8000-000000000051',
    '16350000-0000-4000-8000-000000000051',1,'terminal','before',
    pg_catalog.statement_timestamp()
  );
end;
$c08_0163_reextract_setup$;
commit;
\echo C08_0163_REEXTRACT_RACE_SETUP_PASS
