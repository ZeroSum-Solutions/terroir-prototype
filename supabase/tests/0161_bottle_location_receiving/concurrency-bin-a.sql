\set ON_ERROR_STOP on
\pset pager off
begin;
set local role authenticated;
set local statement_timeout='20s';
set local lock_timeout='12s';
select pg_catalog.set_config('application_name','c06_0161_bin_a',true);
select pg_catalog.set_config('request.jwt.claim.sub','16140000-0000-4000-8000-000000000001',true);
select 'C06_0161_BIN_A|' || public.receive_bottle_at_location_private(
  '16140000-0000-4000-8000-000000000020',
  '16140000-0000-4000-8000-000000000071',
  '16140000-0000-4000-8000-000000000050','Race Bin',
  '16140000-0000-4000-8000-000000000060'
)::text;
select pg_catalog.pg_sleep(8);
commit;
