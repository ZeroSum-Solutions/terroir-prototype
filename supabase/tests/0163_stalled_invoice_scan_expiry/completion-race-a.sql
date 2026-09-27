-- Session A: the existing worker completion fence wins one scan and holds it.
\set ON_ERROR_STOP on
\pset pager off
\if :{?expected_database}
\else
  \echo C08_0163_EXPECTED_DATABASE_REQUIRED
  \quit 3
\endif
select 1 / case when current_database()=:'expected_database'
  and current_user='postgres' and session_user='postgres'
  and exists(
    select 1 from public.invoice_scans s
     where s.id='16340000-0000-4000-8000-000000000050'
       and s.status='processing'
  ) then 1 else 0 end as c08_0163_completion_a_target;

begin;
set local statement_timeout='30s';
set local lock_timeout='5s';
set local application_name='c08_0163_completion_worker';
set local role service_role;
do $c08_0163_completion_a$
declare v_changed integer;
begin
  update public.invoice_scans s
     set status='complete',status_reason=null
   where s.id='16340000-0000-4000-8000-000000000050'
     and s.restaurant_id='16340000-0000-4000-8000-000000000020'
     and s.status='processing';
  get diagnostics v_changed = row_count;
  if v_changed <> 1 then
    raise exception 'C08_0163_COMPLETION_FENCE_DID_NOT_WIN';
  end if;
end;
$c08_0163_completion_a$;
select pg_catalog.pg_sleep(8);
commit;
\echo C08_0163_COMPLETION_RACE_A_PASS
