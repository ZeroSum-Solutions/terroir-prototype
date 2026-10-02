-- Commit only reserved 0161 concurrency fixtures on an independently admitted
-- disposable target. The paired cleanup script removes this exact ownership.
\set ON_ERROR_STOP on
\pset pager off
\if :{?expected_database}
\else
  \echo C06_0161_EXPECTED_DATABASE_REQUIRED
  \quit 3
\endif
\if :{?target_admitted}
\else
  \echo C06_0161_TARGET_ADMISSION_REQUIRED
  \quit 3
\endif
select 1 / case when
  current_database()=:'expected_database'
  and current_user='postgres' and session_user='postgres'
  and :'target_admitted'='on'
  and pg_catalog.to_regprocedure(
    'public.receive_bottle_at_location_private(uuid,uuid,uuid,text,uuid)'
  ) is not null
  and not exists(select 1 from auth.users where id='16140000-0000-4000-8000-000000000001')
then 1 else 0 end as c06_0161_concurrency_target_admitted;

begin;
set local statement_timeout='30s';
set local lock_timeout='5s';
insert into auth.users(id,email) values
  ('16140000-0000-4000-8000-000000000001','c06-0161-race@terroir.test');
insert into public.workspaces(id,kind,name) values
  ('16140000-0000-4000-8000-000000000010','restaurant','C06 0161 race');
insert into public.restaurants(id,name,workspace_id) values
  ('16140000-0000-4000-8000-000000000020','C06 0161 race site','16140000-0000-4000-8000-000000000010');
insert into public.workspace_memberships(id,workspace_id,user_id) values
  ('16140000-0000-4000-8000-000000000030','16140000-0000-4000-8000-000000000010','16140000-0000-4000-8000-000000000001');
insert into public.memberships(id,user_id,restaurant_id,role,workspace_membership_id) values
  ('16140000-0000-4000-8000-000000000040','16140000-0000-4000-8000-000000000001','16140000-0000-4000-8000-000000000020','manager','16140000-0000-4000-8000-000000000030');
insert into public.wines(id,restaurant_id,name,producer,vintage,size_ml) values
  ('16140000-0000-4000-8000-000000000050','16140000-0000-4000-8000-000000000020','C06 0161 race wine','Contract',2020,750);
insert into public.bins(id,restaurant_id,code) values
  ('16140000-0000-4000-8000-000000000060','16140000-0000-4000-8000-000000000020','RACE-ORIGINAL');
commit;
\echo C06_0161_CONCURRENCY_SETUP_PASS
