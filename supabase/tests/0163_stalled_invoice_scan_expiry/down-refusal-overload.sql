-- Expected failure: any sibling overload occupies the closed function name.
\set ON_ERROR_STOP on
\pset pager off
\if :{?expected_database}
\else
  \echo C08_0163_EXPECTED_DATABASE_REQUIRED
  \quit 3
\endif
select 1 / case when current_database()=:'expected_database'
  and current_user='postgres' and session_user='postgres'
then 1 else 0 end as c08_0163_down_overload_target;
begin;
create function public.expire_stalled_invoice_scans(text)
returns jsonb language sql as $$ select '{}'::jsonb $$;
\ir ../../migrations/down/0163_stalled_invoice_scan_expiry.down.sql
\echo C08_0163_ERROR_DOWN_ACCEPTED_OVERLOAD
\quit 1
