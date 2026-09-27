\set ON_ERROR_STOP on
\pset pager off
begin;
set local role authenticated;
set local statement_timeout='20s';
set local lock_timeout='12s';
select pg_catalog.set_config('application_name','c06_0161_same_b',true);
select pg_catalog.set_config('request.jwt.claim.sub','16140000-0000-4000-8000-000000000001',true);
select 'C06_0161_SAME_B|' || public.receive_bottle_at_location_private(
  '16140000-0000-4000-8000-000000000020',
  '16140000-0000-4000-8000-000000000070',
  '16140000-0000-4000-8000-000000000050','Race Same',
  '16140000-0000-4000-8000-000000000060'
)::text;
commit;
