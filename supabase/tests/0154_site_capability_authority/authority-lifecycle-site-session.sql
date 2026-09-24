\set ON_ERROR_STOP on
\pset pager off

begin;
select set_config(
  'request.jwt.claim.sub', '15400000-0000-4000-8000-000000000001', true
);
select id from public.memberships
 where id = '15400000-0000-4000-8000-000000000014'
 for update;
select 'C04_0154_SITE_PARENT_LOCKED' as evidence,
       pg_backend_pid() as backend_pid,
       clock_timestamp() as observed_at;
select pg_advisory_xact_lock_shared(1540404);
select 'C04_0154_SITE_GATE_PASSED' as evidence,
       pg_backend_pid() as backend_pid,
       clock_timestamp() as observed_at;
select pg_sleep(1);
update public.memberships
   set status = 'revoked', revoked_at = statement_timestamp()
 where id = '15400000-0000-4000-8000-000000000014';
commit;

\echo C04_0154_SITE_RETIREMENT_COMMITTED
