\set ON_ERROR_STOP on
\pset pager off

begin;
update public.workspace_memberships
   set governance_role = null
 where id = '15400000-0000-4000-8000-000000000022';
\echo C04_0154_GOVERNANCE_DEMOTION_LOCKED
select pg_sleep(5);
commit;

\echo C04_0154_GOVERNANCE_DEMOTION_COMMITTED
