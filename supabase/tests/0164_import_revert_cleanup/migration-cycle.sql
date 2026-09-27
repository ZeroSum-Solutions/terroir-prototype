-- 0164 paired down/up cycle; outer rollback restores the applied definition.
\set ON_ERROR_STOP on
\pset pager off
\if :{?expected_database}
\else
  \echo C09_0164_EXPECTED_DATABASE_REQUIRED
  \quit 3
\endif
\if :{?target_admitted}
\else
  \echo C09_0164_TARGET_ADMISSION_REQUIRED
  \quit 3
\endif
\if :{?source_0164_sha256}
\else
  \echo C09_0164_UP_SOURCE_PIN_REQUIRED
  \quit 3
\endif
\if :{?source_0164_down_sha256}
\else
  \echo C09_0164_DOWN_SOURCE_PIN_REQUIRED
  \quit 3
\endif

select 1 / case when current_database()=:'expected_database'
  and current_user='postgres' and session_user='postgres'
  and :'target_admitted'='on'
  and :'source_0164_sha256'=
    '2d535f329b600c3dfc33b23494532f93c023b1a89c6aad055b8de3a865ee49ff'
  and :'source_0164_down_sha256'=
    '028cded1c804b769c1a127179f02523a80ae1c968edb6b3ac13af87be2e2f9bb'
then 1 else 0 end as c09_0164_cycle_target;

begin;
set local statement_timeout='45s';
set local lock_timeout='5s';
\ir ../../migrations/down/0164_import_revert_cleanup.down.sql
do $c09_0164_cycle_down$
begin
  if pg_catalog.to_regprocedure(
       'public.revert_import_batch_core_private(uuid,uuid[])'
     ) is not null
     or pg_catalog.to_regprocedure(
       'public.revert_import_batch_private(uuid)'
     ) is not null then
    raise exception 'C09_0164_CYCLE_DOWN_FAILED';
  end if;
end;
$c09_0164_cycle_down$;

\ir ../../migrations/0164_import_revert_cleanup.sql
do $c09_0164_cycle_up$
begin
  if pg_catalog.to_regprocedure(
       'public.revert_import_batch_core_private(uuid,uuid[])'
     ) is null
     or pg_catalog.to_regprocedure(
       'public.revert_import_batch_private(uuid)'
     ) is null
     or pg_catalog.to_regprocedure(
       'public.apply_import_batch_chunk(uuid,integer)'
     ) is null then
    raise exception 'C09_0164_CYCLE_UP_FAILED';
  end if;
end;
$c09_0164_cycle_up$;
rollback;
\echo C09_0164_MIGRATION_CYCLE_PASS
