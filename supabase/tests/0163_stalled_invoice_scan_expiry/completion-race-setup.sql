-- Commit the exact completion/expiry race fixture on an admitted disposable DB.
\set ON_ERROR_STOP on
\pset pager off
\if :{?expected_database}
\else
  \echo C08_0163_EXPECTED_DATABASE_REQUIRED
  \quit 3
\endif
\if :{?target_admitted}
\else
  \echo C08_0163_TARGET_ADMISSION_REQUIRED
  \quit 3
\endif
select 1 / case when current_database()=:'expected_database'
  and current_user='postgres' and session_user='postgres'
  and :'target_admitted'='on'
  and pg_catalog.to_regprocedure(
    'public.expire_stalled_invoice_scans(uuid)'
  ) is not null
  and not exists(
    select 1 from auth.users
     where id='16340000-0000-4000-8000-000000000001'
  ) then 1 else 0 end as c08_0163_completion_setup_target;

begin;
set local statement_timeout='30s';
set local lock_timeout='5s';
insert into auth.users(id,email) values
  ('16340000-0000-4000-8000-000000000001','c08-0163-completion-race@terroir.test');
insert into public.workspaces(id,kind,name) values
  ('16340000-0000-4000-8000-000000000010','restaurant','C08 completion race');
insert into public.restaurants(id,name,workspace_id) values
  ('16340000-0000-4000-8000-000000000020','C08 completion race site','16340000-0000-4000-8000-000000000010');
insert into public.workspace_memberships(id,workspace_id,user_id,status) values
  ('16340000-0000-4000-8000-000000000030','16340000-0000-4000-8000-000000000010','16340000-0000-4000-8000-000000000001','active');
insert into public.memberships(
  id,user_id,restaurant_id,role,workspace_membership_id,status
) values (
  '16340000-0000-4000-8000-000000000040',
  '16340000-0000-4000-8000-000000000001',
  '16340000-0000-4000-8000-000000000020','staff',
  '16340000-0000-4000-8000-000000000030','active'
);
insert into public.invoice_scans(
  id,restaurant_id,created_by,distributor_name,parsed_line_items,
  final_line_items,edits,item_count,status,status_reason,updated_at
) values
  ('16340000-0000-4000-8000-000000000050','16340000-0000-4000-8000-000000000020','16340000-0000-4000-8000-000000000001','C08 completion winner','[]','[]','{}',0,'processing','before',pg_catalog.statement_timestamp()-interval '16 minutes'),
  ('16340000-0000-4000-8000-000000000051','16340000-0000-4000-8000-000000000020','16340000-0000-4000-8000-000000000001','C08 expiry winner','[]','[]','{}',0,'processing','before',pg_catalog.statement_timestamp()-interval '16 minutes');
commit;
\echo C08_0163_COMPLETION_RACE_SETUP_PASS
