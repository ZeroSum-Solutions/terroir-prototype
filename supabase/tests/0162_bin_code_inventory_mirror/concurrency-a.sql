\set ON_ERROR_STOP on
\pset pager off
\if :{?expected_database}
\else
  \echo C07_0162_EXPECTED_DATABASE_REQUIRED
  \quit 3
\endif
\if :{?target_admitted}
\else
  \echo C07_0162_TARGET_ADMISSION_REQUIRED
  \quit 3
\endif
select 1 / case when current_database()=:'expected_database'
  and :'target_admitted'='on'
  and pg_catalog.to_regprocedure(
    'public.mirror_bin_code_to_inventory_items()'
  ) is not null
then 1 else 0 end as c07_0162_concurrency_a_admitted;
begin;
set local role authenticated;
set local statement_timeout='20s';
set local lock_timeout='12s';
select pg_catalog.set_config('application_name','c07_0162_rename_a',true);
select pg_catalog.set_config(
  'request.jwt.claim.sub','16240000-0000-4000-8000-000000000001',true
);
update public.bins
   set code='RACE-A'
 where id='16240000-0000-4000-8000-000000000060'
   and restaurant_id='16240000-0000-4000-8000-000000000020';
select pg_catalog.pg_sleep(8);
commit;
\echo C07_0162_CONCURRENCY_A_PASS
