-- Session A: call the literal existing re-extract RPC for absent and terminal
-- job cases, holding both scan locks until commit.
\set ON_ERROR_STOP on
\pset pager off
\if :{?expected_database}
\else
  \echo C08_0163_EXPECTED_DATABASE_REQUIRED
  \quit 3
\endif
select 1 / case when current_database()=:'expected_database'
  and current_user='postgres' and session_user='postgres'
then 1 else 0 end as c08_0163_reextract_a_target;

begin;
set local statement_timeout='30s';
set local lock_timeout='5s';
set local application_name='c08_0163_reextract_request';
set local role authenticated;
select pg_catalog.set_config(
  'request.jwt.claim.sub','16350000-0000-4000-8000-000000000001',true
);
do $c08_0163_reextract_a$
declare
  v_scan_id uuid;
  v_result jsonb;
begin
  foreach v_scan_id in array array[
    '16350000-0000-4000-8000-000000000050'::uuid,
    '16350000-0000-4000-8000-000000000051'::uuid
  ] loop
    v_result := public.request_invoice_scan_reextract(v_scan_id);
    if v_result is distinct from pg_catalog.jsonb_build_object(
         'scanId',v_scan_id,'status','queued'
       ) then
      raise exception 'C08_0163_LITERAL_REEXTRACT_RECEIPT_FAILED';
    end if;
  end loop;
end;
$c08_0163_reextract_a$;
select pg_catalog.pg_sleep(8);
commit;
\echo C08_0163_REEXTRACT_RACE_A_PASS
