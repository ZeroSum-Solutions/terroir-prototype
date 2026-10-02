-- Connection A: first operation in the LWIN apply/revert race; hold commit.
\set ON_ERROR_STOP on
\pset pager off
\if :{?expected_database}
\else
  \quit 3
\endif
\if :{?target_admitted}
\else
  \quit 3
\endif
\if :{?race_mode}
\else
  \quit 3
\endif
select 1/case when current_database()=:'expected_database'
  and :'target_admitted'='on'
  and :'race_mode' in ('apply_first','revert_first')
then 1 else 0 end as c09_0164_lwin_a_target;
begin;
set local role authenticated;
set local statement_timeout='25s';
set local lock_timeout='20s';
select pg_catalog.set_config('application_name','c09_0164_race_a',true);
select pg_catalog.set_config(
  'request.jwt.claim.sub','16440000-0000-4000-8000-000000000001',true
);
select :'race_mode'='apply_first' as apply_first \gset
\if :apply_first
  select 1/case when (
    select pg_catalog.count(*) from public.apply_import_batch_chunk(
      '16440000-0000-4000-8000-000000000061',100
    ) r where r.outcome='applied' and r.inventory_item_id is not null
  )=2 then 1 else 0 end as c09_0164_lwin_a_apply;
\else
  select 1/case when result=
    pg_catalog.jsonb_build_object(
      'version',1,
      'batchId','16440000-0000-4000-8000-000000000060'::uuid,
      'status','reverted',
      'revertedItemCount',2,
      'orphanWinesDeleted',0,
      'lwinStampsCleared',2
    ) then 1 else 0 end as c09_0164_lwin_a_revert
  from (
    select public.revert_import_batch_private(
      '16440000-0000-4000-8000-000000000060'
    ) as result
  ) call;
\endif
select pg_catalog.pg_sleep(8);
commit;
\echo C09_0164_LWIN_RACE_A_PASS
