-- Session B: expiry starts during A's hold and must recheck after the wait.
\set ON_ERROR_STOP on
\pset pager off
\if :{?expected_database}
\else
  \echo C08_0163_EXPECTED_DATABASE_REQUIRED
  \quit 3
\endif
select 1 / case when current_database()=:'expected_database'
  and current_user='postgres' and session_user='postgres'
then 1 else 0 end as c08_0163_completion_b_target;

begin;
set local statement_timeout='30s';
set local lock_timeout='15s';
set local application_name='c08_0163_completion_expiry';
set local role authenticated;
select pg_catalog.set_config(
  'request.jwt.claim.sub','16340000-0000-4000-8000-000000000001',true
);
do $c08_0163_completion_b$
declare v_result jsonb;
begin
  v_result := public.expire_stalled_invoice_scans(
    '16340000-0000-4000-8000-000000000020'
  );
  if v_result is distinct from pg_catalog.jsonb_build_object(
       'version',1,'expiredCount',1
     ) then
    raise exception 'C08_0163_COMPLETION_RACE_RECEIPT_FAILED';
  end if;
end;
$c08_0163_completion_b$;
commit;
\echo C08_0163_COMPLETION_RACE_B_PASS
