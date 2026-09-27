-- Expected failure: unrelated later body drift must block the 0164 down.
\set ON_ERROR_STOP on
\pset pager off
\if :{?expected_database}
\else
  \quit 3
\endif
select 1 / case when current_database()=:'expected_database'
  and current_user='postgres' and session_user='postgres'
then 1 else 0 end as c09_0164_down_body_target;
begin;
create or replace function public.revert_import_batch_private(p_batch_id uuid)
returns jsonb language sql volatile security definer set search_path=''
as $$ select '{}'::jsonb $$;
\ir ../../migrations/down/0164_import_revert_cleanup.down.sql
\echo C09_0164_ERROR_DOWN_ACCEPTED_BODY_DRIFT
\quit 1
