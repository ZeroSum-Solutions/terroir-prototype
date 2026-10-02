-- 0163 SERIALIZABLE refusal; every fixture write rolls back.
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
  ) is not null then 1 else 0 end as c08_0163_serializable_target;

begin isolation level serializable;
set local statement_timeout='30s';
set local lock_timeout='5s';
insert into auth.users(id,email) values
  ('16320000-0000-4000-8000-000000000001','c08-0163-serializable@terroir.test');
insert into public.workspaces(id,kind,name) values
  ('16320000-0000-4000-8000-000000000010','restaurant','C08 serializable');
insert into public.restaurants(id,name,workspace_id) values
  ('16320000-0000-4000-8000-000000000020','C08 serializable site','16320000-0000-4000-8000-000000000010');
insert into public.workspace_memberships(id,workspace_id,user_id,status) values
  ('16320000-0000-4000-8000-000000000030','16320000-0000-4000-8000-000000000010','16320000-0000-4000-8000-000000000001','active');
insert into public.memberships(
  id,user_id,restaurant_id,role,workspace_membership_id,status
) values (
  '16320000-0000-4000-8000-000000000040',
  '16320000-0000-4000-8000-000000000001',
  '16320000-0000-4000-8000-000000000020','staff',
  '16320000-0000-4000-8000-000000000030','active'
);
insert into public.invoice_scans(
  id,restaurant_id,created_by,distributor_name,parsed_line_items,
  final_line_items,edits,item_count,status,status_reason,updated_at
) values (
  '16320000-0000-4000-8000-000000000050',
  '16320000-0000-4000-8000-000000000020',
  '16320000-0000-4000-8000-000000000001','C08 serializable',
  '[]','[]','{}',0,'processing','before',
  pg_catalog.statement_timestamp()-interval '16 minutes'
);
set local role authenticated;
select pg_catalog.set_config(
  'request.jwt.claim.sub','16320000-0000-4000-8000-000000000001',true
);
do $c08_0163_serializable$
begin
  begin
    perform public.expire_stalled_invoice_scans(
      '16320000-0000-4000-8000-000000000020'
    );
    raise exception 'C08_0163_EXPECTED_SERIALIZABLE_REFUSAL';
  exception when sqlstate '25000' then
    if sqlerrm <> 'read_committed_required' then raise; end if;
  end;
end;
$c08_0163_serializable$;
reset role;
do $c08_0163_serializable_conservation$
begin
  if not exists (
    select 1 from public.invoice_scans s
     where s.id='16320000-0000-4000-8000-000000000050'
       and s.status='processing'
       and s.status_reason='before'
  ) then
    raise exception 'C08_0163_SERIALIZABLE_CHANGED_SCAN';
  end if;
end;
$c08_0163_serializable_conservation$;
rollback;
\echo C08_0163_SERIALIZABLE_REFUSAL_PASS
