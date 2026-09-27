\set ON_ERROR_STOP on
\pset pager off
begin;
set local role authenticated;
set local statement_timeout='20s';
set local lock_timeout='12s';
select pg_catalog.set_config('application_name','c06_0161_bin_b',true);
select pg_catalog.set_config('request.jwt.claim.sub','16140000-0000-4000-8000-000000000001',true);
update public.bins
   set code='RACE-RENAMED',retired_at=pg_catalog.statement_timestamp()
 where id='16140000-0000-4000-8000-000000000060'
   and restaurant_id='16140000-0000-4000-8000-000000000020';
commit;
