-- 0163 paired down/up cycle; the outer transaction restores applied state.
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
\if :{?source_0163_sha256}
\else
  \echo C08_0163_UP_SOURCE_PIN_REQUIRED
  \quit 3
\endif
\if :{?source_0163_down_sha256}
\else
  \echo C08_0163_DOWN_SOURCE_PIN_REQUIRED
  \quit 3
\endif

select 1 / case when current_database()=:'expected_database'
  and current_user='postgres' and session_user='postgres'
  and :'target_admitted'='on'
  and :'source_0163_sha256'='ed98ab776aca2c509b691709da00c3a698789f613d493c3abb3eb0e902e57475'
  and :'source_0163_down_sha256'='3ec3dc9400fef2d4cf481c1812b151b57a22b5c2572d9e0c0ba45fb959259145'
  and pg_catalog.to_regprocedure(
    'public.expire_stalled_invoice_scans(uuid)'
  ) is not null then 1 else 0 end as c08_0163_cycle_target;

begin;
set local statement_timeout='30s';
set local lock_timeout='5s';
insert into auth.users(id,email) values
  ('16330000-0000-4000-8000-000000000001','c08-0163-cycle@terroir.test');
insert into public.workspaces(id,kind,name) values
  ('16330000-0000-4000-8000-000000000010','restaurant','C08 cycle');
insert into public.restaurants(id,name,workspace_id) values
  ('16330000-0000-4000-8000-000000000020','C08 cycle site','16330000-0000-4000-8000-000000000010');
insert into public.invoice_scans(
  id,restaurant_id,created_by,distributor_name,parsed_line_items,
  final_line_items,edits,item_count,status,status_reason,updated_at
) values (
  '16330000-0000-4000-8000-000000000050',
  '16330000-0000-4000-8000-000000000020',
  '16330000-0000-4000-8000-000000000001','C08 cycle',
  '[]','[]','{}',0,'failed','stalled',
  pg_catalog.statement_timestamp()-interval '16 minutes'
);
create temporary table c08_0163_cycle_before(value jsonb) on commit drop;
insert into c08_0163_cycle_before(value)
select pg_catalog.to_jsonb(s) from public.invoice_scans s
 where s.id='16330000-0000-4000-8000-000000000050';

\ir ../../migrations/down/0163_stalled_invoice_scan_expiry.down.sql
do $c08_0163_cycle_down$
begin
  if pg_catalog.to_regprocedure(
       'public.expire_stalled_invoice_scans(uuid)'
     ) is not null then
    raise exception 'C08_0163_CYCLE_DOWN_FAILED';
  end if;
end;
$c08_0163_cycle_down$;

\ir ../../migrations/0163_stalled_invoice_scan_expiry.sql
do $c08_0163_cycle_up$
declare
  v_before jsonb;
  v_after jsonb;
begin
  select value into strict v_before from c08_0163_cycle_before;
  select pg_catalog.to_jsonb(s) into strict v_after
    from public.invoice_scans s
   where s.id='16330000-0000-4000-8000-000000000050';
  if pg_catalog.to_regprocedure(
       'public.expire_stalled_invoice_scans(uuid)'
     ) is null
     or v_after is distinct from v_before then
    raise exception 'C08_0163_CYCLE_UP_OR_DATA_FAILED';
  end if;
end;
$c08_0163_cycle_up$;
rollback;
\echo C08_0163_MIGRATION_CYCLE_PASS
