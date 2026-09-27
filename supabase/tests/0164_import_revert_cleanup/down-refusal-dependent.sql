-- Expected failure: a later normal dependent must block the 0164 down.
\set ON_ERROR_STOP on
\pset pager off
\if :{?expected_database}
\else
  \quit 3
\endif
select 1 / case when current_database()=:'expected_database'
  and current_user='postgres' and session_user='postgres'
then 1 else 0 end as c09_0164_down_dependent_target;
begin;
create view public.c09_0164_later_dependency as
  select public.revert_import_batch_private(
    '00000000-0000-0000-0000-000000000000'::uuid
  ) as receipt;
\ir ../../migrations/down/0164_import_revert_cleanup.down.sql
\echo C09_0164_ERROR_DOWN_ACCEPTED_DEPENDENT
\quit 1
