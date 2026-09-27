-- Verify active-job protection, literal reverse-order RPC behavior, and the
-- exact retained synthetic identity/grant delta required by immutable audit.
\set ON_ERROR_STOP on
\pset pager off
\if :{?expected_database}
\else
  \echo C08_0163_EXPECTED_DATABASE_REQUIRED
  \quit 3
\endif
select 1 / case when current_database()=:'expected_database'
  and current_user='postgres' and session_user='postgres'
then 1 else 0 end as c08_0163_reextract_retained_target;

begin;
set local statement_timeout='30s';
set local lock_timeout='5s';
do $c08_0163_reextract_results$
declare v_site uuid;
begin
  select s.restaurant_id into strict v_site
    from public.invoice_scans s
   where s.id='16350000-0000-4000-8000-000000000050';
  if (select pg_catalog.count(*) from public.invoice_scans s
       where s.id in (
         '16350000-0000-4000-8000-000000000050',
         '16350000-0000-4000-8000-000000000051'
       ) and s.restaurant_id=v_site
         and s.status='processing' and s.status_reason='before')<>2
     or (select pg_catalog.count(*) from public.background_jobs b
          where b.restaurant_id=v_site
            and b.job_type='invoice_extract'
            and b.subject_table='invoice_scans'
            and b.subject_id in (
              '16350000-0000-4000-8000-000000000050',
              '16350000-0000-4000-8000-000000000051'
            ) and b.status='queued')<>2
     or not exists(
       select 1 from public.background_jobs b
        where b.id='16350000-0000-4000-8000-000000000060'
          and b.status='queued' and b.attempt_count=0
          and b.error_code is null and b.error_message is null
          and b.finished_at is null
     )
     or not exists(
       select 1 from public.invoice_scans s
        where s.id='16350000-0000-4000-8000-000000000052'
          and s.restaurant_id=v_site
          and s.status='failed' and s.status_reason='stalled'
     ) then
    raise exception 'C08_0163_REEXTRACT_RACE_FINAL_STATE_FAILED';
  end if;
end;
$c08_0163_reextract_results$;

set local role authenticated;
select pg_catalog.set_config(
  'request.jwt.claim.sub','16350000-0000-4000-8000-000000000001',true
);
do $c08_0163_reextract_reverse$
declare v_result jsonb;
begin
  v_result := public.request_invoice_scan_reextract(
    '16350000-0000-4000-8000-000000000052'
  );
  if v_result is distinct from pg_catalog.jsonb_build_object(
       'scanId','16350000-0000-4000-8000-000000000052'::uuid,
       'status','queued'
     ) then
    raise exception 'C08_0163_LITERAL_REEXTRACT_REVERSE_RECEIPT_FAILED';
  end if;
end;
$c08_0163_reextract_reverse$;
reset role;

do $c08_0163_reextract_retained_delta$
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

  if (select pg_catalog.count(*) from auth.users u
       where u.id='16350000-0000-4000-8000-000000000001')<>1
     or (select pg_catalog.count(*) from public.memberships m
          where m.user_id='16350000-0000-4000-8000-000000000001')<>1
     or (select pg_catalog.count(*) from public.workspace_memberships wm
          where wm.user_id='16350000-0000-4000-8000-000000000001')<>1
     or (select pg_catalog.count(*) from public.restaurants r
          where r.id=v_site and r.workspace_id=v_workspace
            and r.name='C08 retained reextract site')<>1
     or (select pg_catalog.count(*) from public.workspaces w
          where w.id=v_workspace and w.kind='restaurant'
            and w.name='C08 retained reextract site')<>1
     or (select pg_catalog.count(*) from public.reason_codes rc
          where rc.restaurant_id=v_site)<>7
     or (select pg_catalog.array_agg(rc.code order by rc.code)
           from public.reason_codes rc
          where rc.restaurant_id=v_site) is distinct from array[
            'comp_guest','comp_industry','count_adjust','other','spill',
            'spoilage','training'
          ]::text[]
     or (select pg_catalog.count(*)
           from public.membership_capability_grants g
          where g.subject_user_id='16350000-0000-4000-8000-000000000001')<>1
     or not exists(
       select 1 from public.membership_capability_grants g
        where g.id='16350000-0000-4000-8000-000000000041'
          and g.workspace_id=v_workspace and g.restaurant_id=v_site
          and g.workspace_membership_id=v_workspace_membership
          and g.membership_id=v_membership
          and g.subject_user_id='16350000-0000-4000-8000-000000000001'
          and g.site_lifecycle_generation=v_site_generation
          and g.workspace_lifecycle_generation=v_workspace_generation
          and g.capability_key='cost.read'
          and g.granted_by_user_id='16350000-0000-4000-8000-000000000001'
          and g.grant_reason='0163 retained literal reextract race fixture'
          and g.source='workspace_governance'
          and g.expires_at is null and g.revoked_at is null
          and g.revoked_by_user_id is null and g.revoke_reason is null
          and g.revoke_cause is null
     )
     or (select pg_catalog.count(*) from public.invoice_scans s
          where s.restaurant_id=v_site)<>3
     or not exists(
       select 1 from public.invoice_scans s
        where s.id='16350000-0000-4000-8000-000000000052'
          and s.restaurant_id=v_site
          and s.status='failed' and s.status_reason='stalled'
     )
     or (select pg_catalog.count(*) from public.background_jobs b
          where b.restaurant_id=v_site)<>3
     or (select pg_catalog.count(*) from public.background_jobs b
          where b.restaurant_id=v_site and b.job_type='invoice_extract'
            and b.subject_table='invoice_scans'
            and b.subject_id in (
              '16350000-0000-4000-8000-000000000050',
              '16350000-0000-4000-8000-000000000051',
              '16350000-0000-4000-8000-000000000052'
            ) and b.status='queued')<>3 then
    raise exception 'C08_0163_REEXTRACT_RETAINED_DELTA_MISMATCH';
  end if;

  raise notice
    'C08_0163_REEXTRACT_RETAINED_IDS site=% workspace=% membership=% workspace_membership=% grant=%',
    v_site,v_workspace,v_membership,v_workspace_membership,
    '16350000-0000-4000-8000-000000000041';
end;
$c08_0163_reextract_retained_delta$;
commit;
\echo C08_0163_REEXTRACT_RACE_RETAINED_DELTA_PASS
