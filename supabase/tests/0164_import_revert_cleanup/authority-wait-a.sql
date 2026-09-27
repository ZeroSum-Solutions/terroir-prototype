-- Connection A: hold either the shared advisory lock or the batch row lock.
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
\if :{?wait_kind}
\else
  \quit 3
\endif
\if :{?site_id}
\else
  \quit 3
\endif
\if :{?batch_id}
\else
  \quit 3
\endif
select 1 / case when current_database()=:'expected_database'
  and current_user='postgres' and session_user='postgres'
  and :'target_admitted'='on'
  and :'wait_kind' in ('advisory','batch')
then 1 else 0 end as c09_0164_authority_wait_a_target;
select :'wait_kind'='advisory' as advisory_wait \gset
begin;
set local statement_timeout='20s';
select pg_catalog.set_config('application_name','c09_0164_auth_wait_a',true);
\if :advisory_wait
  select pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('import-mutation:'||:'site_id',0)
  );
\else
  select b.id from public.import_batches b
   where b.id=:'batch_id'::uuid and b.restaurant_id=:'site_id'::uuid
   for update;
\endif
select pg_catalog.pg_sleep(8);
commit;
\echo C09_0164_AUTHORITY_WAIT_A_PASS
