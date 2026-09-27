-- Commit only the reserved 0162 race fixture on an admitted disposable target.
\set ON_ERROR_STOP on
\pset pager off
\if :{?expected_database}
\else
  \echo C07_0162_EXPECTED_DATABASE_REQUIRED
  \quit 3
\endif
\if :{?target_admitted}
\else
  \echo C07_0162_TARGET_ADMISSION_REQUIRED
  \quit 3
\endif
\if :{?source_0162_sha256}
\else
  \echo C07_0162_SOURCE_PIN_REQUIRED
  \quit 3
\endif

select 1 / case when
  current_database()=:'expected_database'
  and current_user='postgres'
  and session_user='postgres'
  and :'target_admitted'='on'
  and :'source_0162_sha256'='c899f1f5113773f0cc826a227bc0c800c4303cc2a6bc5a945bd5b040ced01955'
  and pg_catalog.to_regprocedure(
    'public.mirror_bin_code_to_inventory_items()'
  ) is not null
  and not exists(
    select 1 from auth.users
     where id='16240000-0000-4000-8000-000000000001'
  )
then 1 else 0 end as c07_0162_concurrency_target_admitted;

begin;
set local statement_timeout='30s';
set local lock_timeout='5s';
insert into auth.users(id,email) values
  ('16240000-0000-4000-8000-000000000001','c07-0162-race@terroir.test');
insert into public.workspaces(id,kind,name) values
  ('16240000-0000-4000-8000-000000000010','restaurant','C07 0162 race');
insert into public.restaurants(id,name,workspace_id) values
  ('16240000-0000-4000-8000-000000000020','C07 0162 race site','16240000-0000-4000-8000-000000000010');
insert into public.workspace_memberships(
  id,workspace_id,user_id,governance_role
) values (
  '16240000-0000-4000-8000-000000000030',
  '16240000-0000-4000-8000-000000000010',
  '16240000-0000-4000-8000-000000000001','group_admin'
);
insert into public.memberships(
  id,user_id,restaurant_id,role,workspace_membership_id
) values (
  '16240000-0000-4000-8000-000000000040',
  '16240000-0000-4000-8000-000000000001',
  '16240000-0000-4000-8000-000000000020','manager',
  '16240000-0000-4000-8000-000000000030'
);
insert into public.wines(id,restaurant_id,name,producer,vintage,size_ml) values
  ('16240000-0000-4000-8000-000000000050','16240000-0000-4000-8000-000000000020','C07 0162 race wine','Contract',2020,750);
insert into public.bins(id,restaurant_id,code) values
  ('16240000-0000-4000-8000-000000000060','16240000-0000-4000-8000-000000000020','RACE-ORIGINAL');
insert into public.inventory_items(
  id,wine_id,restaurant_id,quantity,unit_cost,bin_location,bin_id,added_via
) values
  ('16240000-0000-4000-8000-000000000070','16240000-0000-4000-8000-000000000050','16240000-0000-4000-8000-000000000020',1,10,'RACE-ORIGINAL','16240000-0000-4000-8000-000000000060','manual'),
  ('16240000-0000-4000-8000-000000000071','16240000-0000-4000-8000-000000000050','16240000-0000-4000-8000-000000000020',2,20,'RACE-ORIGINAL','16240000-0000-4000-8000-000000000060','manual');
commit;
\echo C07_0162_CONCURRENCY_SETUP_PASS
