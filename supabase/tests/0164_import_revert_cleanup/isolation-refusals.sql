-- 0164 non-READ-COMMITTED refusal proof; all fixtures roll back.
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

select 1 / case when current_database()=:'expected_database'
  and current_user='postgres' and session_user='postgres'
  and :'target_admitted'='on'
  and pg_catalog.to_regprocedure(
    'public.revert_import_batch_private(uuid)'
  ) is not null
then 1 else 0 end as c09_0164_isolation_target;

begin isolation level repeatable read;
set local statement_timeout='30s';
set local lock_timeout='5s';
insert into auth.users(id,email) values
  ('16410000-0000-4000-8000-000000000001','c09-0164-rr@terroir.test');
insert into public.workspaces(id,kind,name) values
  ('16410000-0000-4000-8000-000000000010','restaurant','C09 0164 RR');
insert into public.restaurants(id,name,workspace_id) values
  ('16410000-0000-4000-8000-000000000020','C09 0164 RR site','16410000-0000-4000-8000-000000000010');
insert into public.workspace_memberships(id,workspace_id,user_id,status) values
  ('16410000-0000-4000-8000-000000000030','16410000-0000-4000-8000-000000000010','16410000-0000-4000-8000-000000000001','active');
insert into public.memberships(
  id,user_id,restaurant_id,role,workspace_membership_id,status
) values (
  '16410000-0000-4000-8000-000000000040',
  '16410000-0000-4000-8000-000000000001',
  '16410000-0000-4000-8000-000000000020','staff',
  '16410000-0000-4000-8000-000000000030','active'
);
insert into public.import_sessions(id,restaurant_id,created_by,label,status) values (
  '16410000-0000-4000-8000-000000000050',
  '16410000-0000-4000-8000-000000000020',
  '16410000-0000-4000-8000-000000000001','C09 RR','in_progress'
);
insert into public.import_batches(
  id,restaurant_id,created_by,filename,status,total_rows,session_id,chunk_index,
  content_sha256
) values (
  '16410000-0000-4000-8000-000000000060',
  '16410000-0000-4000-8000-000000000020',
  '16410000-0000-4000-8000-000000000001','c09-rr.csv','created',0,
  '16410000-0000-4000-8000-000000000050',1,
  pg_catalog.encode(pg_catalog.sha256(
    pg_catalog.convert_to('c09-rr.csv','UTF8')
  ),'hex')
);
set local role authenticated;
select pg_catalog.set_config(
  'request.jwt.claim.sub','16410000-0000-4000-8000-000000000001',true
);
do $c09_0164_rr$
declare v_case text;
begin
  foreach v_case in array array['apply','typed','legacy','session'] loop
    begin
      if v_case='apply' then
        perform public.apply_import_batch_chunk(
          '16410000-0000-4000-8000-000000000060',100
        );
      elsif v_case='typed' then
        perform public.revert_import_batch_private(
          '16410000-0000-4000-8000-000000000060'
        );
      elsif v_case='legacy' then
        perform public.revert_import_batch(
          '16410000-0000-4000-8000-000000000060'
        );
      else
        perform public.revert_import_session(
          '16410000-0000-4000-8000-000000000050'
        );
      end if;
      raise exception 'C09_0164_EXPECTED_RR_REFUSAL_%',v_case;
    exception when sqlstate '25000' then
      if sqlerrm <> 'read_committed_required' then raise; end if;
    end;
  end loop;
end;
$c09_0164_rr$;
reset role;
select 1 / case when (select b.status from public.import_batches b
  where b.id='16410000-0000-4000-8000-000000000060')='created'
  and (select s.status from public.import_sessions s
  where s.id='16410000-0000-4000-8000-000000000050')='in_progress'
then 1 else 0 end as c09_0164_rr_conservation;
rollback;

begin isolation level serializable;
set local statement_timeout='30s';
set local lock_timeout='5s';
insert into auth.users(id,email) values
  ('16420000-0000-4000-8000-000000000001','c09-0164-serial@terroir.test');
insert into public.workspaces(id,kind,name) values
  ('16420000-0000-4000-8000-000000000010','restaurant','C09 0164 serial');
insert into public.restaurants(id,name,workspace_id) values
  ('16420000-0000-4000-8000-000000000020','C09 0164 serial site','16420000-0000-4000-8000-000000000010');
insert into public.workspace_memberships(id,workspace_id,user_id,status) values
  ('16420000-0000-4000-8000-000000000030','16420000-0000-4000-8000-000000000010','16420000-0000-4000-8000-000000000001','active');
insert into public.memberships(
  id,user_id,restaurant_id,role,workspace_membership_id,status
) values (
  '16420000-0000-4000-8000-000000000040',
  '16420000-0000-4000-8000-000000000001',
  '16420000-0000-4000-8000-000000000020','staff',
  '16420000-0000-4000-8000-000000000030','active'
);
insert into public.import_sessions(id,restaurant_id,created_by,label,status) values (
  '16420000-0000-4000-8000-000000000050',
  '16420000-0000-4000-8000-000000000020',
  '16420000-0000-4000-8000-000000000001','C09 serial','in_progress'
);
insert into public.import_batches(
  id,restaurant_id,created_by,filename,status,total_rows,session_id,chunk_index,
  content_sha256
) values (
  '16420000-0000-4000-8000-000000000060',
  '16420000-0000-4000-8000-000000000020',
  '16420000-0000-4000-8000-000000000001','c09-serial.csv','created',0,
  '16420000-0000-4000-8000-000000000050',1,
  pg_catalog.encode(pg_catalog.sha256(
    pg_catalog.convert_to('c09-serial.csv','UTF8')
  ),'hex')
);
set local role authenticated;
select pg_catalog.set_config(
  'request.jwt.claim.sub','16420000-0000-4000-8000-000000000001',true
);
do $c09_0164_serial$
declare v_case text;
begin
  foreach v_case in array array['apply','typed','legacy','session'] loop
    begin
      if v_case='apply' then
        perform public.apply_import_batch_chunk(
          '16420000-0000-4000-8000-000000000060',100
        );
      elsif v_case='typed' then
        perform public.revert_import_batch_private(
          '16420000-0000-4000-8000-000000000060'
        );
      elsif v_case='legacy' then
        perform public.revert_import_batch(
          '16420000-0000-4000-8000-000000000060'
        );
      else
        perform public.revert_import_session(
          '16420000-0000-4000-8000-000000000050'
        );
      end if;
      raise exception 'C09_0164_EXPECTED_SERIAL_REFUSAL_%',v_case;
    exception when sqlstate '25000' then
      if sqlerrm <> 'read_committed_required' then raise; end if;
    end;
  end loop;
end;
$c09_0164_serial$;
reset role;
select 1 / case when (select b.status from public.import_batches b
  where b.id='16420000-0000-4000-8000-000000000060')='created'
  and (select s.status from public.import_sessions s
  where s.id='16420000-0000-4000-8000-000000000050')='in_progress'
then 1 else 0 end as c09_0164_serial_conservation;
rollback;
\echo C09_0164_ISOLATION_REFUSALS_PASS
