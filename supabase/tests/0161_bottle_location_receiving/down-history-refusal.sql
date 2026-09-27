-- Expected-failure proof: 0161 down must refuse durable location-receive
-- history. Run with ON_ERROR_STOP and require SQLSTATE P0001 plus the exact
-- C06_0161_DOWN_REFUSES_DURABLE_HISTORY marker. Connection close rolls back
-- this fixture transaction; the supervisor must then verify 0161 remains.
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
  current_database() = :'expected_database'
  and current_user = 'postgres'
  and session_user = 'postgres'
  and :'target_admitted' = 'on'
  and pg_catalog.to_regprocedure(
    'public.receive_bottle_at_location_private(uuid,uuid,uuid,text,uuid)'
  ) is not null
then 1 else 0 end as c06_0161_down_refusal_target_admitted;

begin;
set local statement_timeout = '30s';
set local lock_timeout = '5s';

insert into auth.users(id,email) values
  ('16130000-0000-4000-8000-000000000001','c06-0161-down@terroir.test');
insert into public.workspaces(id,kind,name) values
  ('16130000-0000-4000-8000-000000000010','restaurant','C06 0161 down');
insert into public.restaurants(id,name,workspace_id) values
  ('16130000-0000-4000-8000-000000000020','C06 0161 down site','16130000-0000-4000-8000-000000000010');
insert into public.wines(id,restaurant_id,name,producer,size_ml) values
  ('16130000-0000-4000-8000-000000000030','16130000-0000-4000-8000-000000000020','C06 0161 down wine','Contract',750);
insert into public.inventory_command_receipts(
  restaurant_id,operation_id,actor_user_id,wine_id,command_type,
  request_payload,command_version,scope_kind,batch_entry_count
) values(
  '16130000-0000-4000-8000-000000000020',
  '16130000-0000-4000-8000-000000000040',
  '16130000-0000-4000-8000-000000000001',
  '16130000-0000-4000-8000-000000000030','bottle_location_receive',
  pg_catalog.jsonb_build_object(
    'version',3,'kind','bottle_location_receive',
    'wine_id','16130000-0000-4000-8000-000000000030'::uuid,
    'section','Down refusal',
    'bin_id','16130000-0000-4000-8000-000000000050'::uuid,
    'quantity',1
  ),3,'single_wine',null
);

\ir ../../migrations/down/0161_bottle_location_receiving.down.sql

\echo C06_0161_ERROR_DOWN_ACCEPTED_DURABLE_HISTORY
\quit 1
