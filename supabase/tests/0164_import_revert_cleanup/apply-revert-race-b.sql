-- Connection B: opposite operation; it must wait on A's site advisory lock.
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
\if :{?actor_id}
\else
  \quit 3
\endif
\if :{?apply_batch_id}
\else
  \quit 3
\endif
\if :{?revert_batch_id}
\else
  \quit 3
\endif
select 1 / case when current_database()=:'expected_database'
  and :'target_admitted'='on'
  and :'race_mode' in ('apply_first','revert_first')
then 1 else 0 end as c09_0164_race_b_target;
begin;
set local role authenticated;
set local statement_timeout='25s';
set local lock_timeout='20s';
select pg_catalog.set_config('application_name','c09_0164_race_b',true);
select pg_catalog.set_config('request.jwt.claim.sub',:'actor_id',true);
select :'race_mode'='apply_first' as apply_first \gset
\if :apply_first
  select public.revert_import_batch_private(:'revert_batch_id'::uuid);
\else
  select * from public.apply_import_batch_chunk(:'apply_batch_id'::uuid,100);
\endif
commit;
\echo C09_0164_APPLY_REVERT_RACE_B_PASS
