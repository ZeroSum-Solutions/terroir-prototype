-- Connection A: execute the first physical-open/revert operation and hold commit.
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
  and :'race_mode' in ('open_first','revert_first')
  and exists(select 1 from public.import_batch_rows r
              where r.id='16460000-0000-4000-8000-000000000070'
                and r.apply_status='applied'
                and r.applied_inventory_item_id is not null)
then 1 else 0 end as c09_0164_physical_a_target;
begin;
set local role authenticated;
set local statement_timeout='25s';
set local lock_timeout='20s';
select pg_catalog.set_config('application_name','c09_0164_physical_a',true);
select pg_catalog.set_config(
  'request.jwt.claim.sub','16460000-0000-4000-8000-000000000001',true
);
select :'race_mode'='open_first' as open_first \gset
\if :open_first
  select public.execute_physical_bottle_command(
    '16460000-0000-4000-8000-000000000080',
    '16460000-0000-4000-8000-000000000020',
    'open',
    (select r.applied_wine_id from public.import_batch_rows r
      where r.id='16460000-0000-4000-8000-000000000070')
  );
\else
  select public.revert_import_batch_private(
    '16460000-0000-4000-8000-000000000060'
  );
\endif
select pg_catalog.pg_sleep(8);
commit;
\echo C09_0164_PHYSICAL_RACE_A_PASS
