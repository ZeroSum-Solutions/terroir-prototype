-- 0162 rollback-only forced-failure and duplicate-code atomicity contract.
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
then 1 else 0 end as c07_0162_atomic_target_admitted;

begin;
set local statement_timeout='30s';
set local lock_timeout='5s';

insert into auth.users(id,email) values
  ('16210000-0000-4000-8000-000000000001','c07-0162-atomic@terroir.test');
insert into public.workspaces(id,kind,name) values
  ('16210000-0000-4000-8000-000000000010','restaurant','C07 0162 atomic');
insert into public.restaurants(id,name,workspace_id) values
  ('16210000-0000-4000-8000-000000000020','C07 0162 atomic site','16210000-0000-4000-8000-000000000010');
insert into public.workspace_memberships(id,workspace_id,user_id,governance_role) values
  ('16210000-0000-4000-8000-000000000030','16210000-0000-4000-8000-000000000010','16210000-0000-4000-8000-000000000001','group_admin');
insert into public.memberships(id,user_id,restaurant_id,role,workspace_membership_id) values
  ('16210000-0000-4000-8000-000000000040','16210000-0000-4000-8000-000000000001','16210000-0000-4000-8000-000000000020','manager','16210000-0000-4000-8000-000000000030');
insert into public.wines(id,restaurant_id,name,producer,vintage,size_ml) values
  ('16210000-0000-4000-8000-000000000050','16210000-0000-4000-8000-000000000020','C07 0162 atomic wine','Contract',2020,750);
insert into public.bins(id,restaurant_id,code) values
  ('16210000-0000-4000-8000-000000000060','16210000-0000-4000-8000-000000000020','ATOMIC-A'),
  ('16210000-0000-4000-8000-000000000061','16210000-0000-4000-8000-000000000020','ATOMIC-B');
insert into public.inventory_items(
  id,wine_id,restaurant_id,quantity,unit_cost,bin_location,bin_id,added_via
) values (
  '16210000-0000-4000-8000-000000000070',
  '16210000-0000-4000-8000-000000000050',
  '16210000-0000-4000-8000-000000000020',1,10,'ATOMIC-A',
  '16210000-0000-4000-8000-000000000060','manual'
);

create function pg_temp.c07_0162_force_inventory_failure()
returns trigger
language plpgsql
as $function$
begin
  if new.bin_location='FORCED-FAILURE' then
    raise exception 'C07_0162_FORCED_INVENTORY_FAILURE' using errcode='P0001';
  end if;
  return new;
end;
$function$;
create trigger c07_0162_force_inventory_failure
before update of bin_location on public.inventory_items
for each row execute function pg_temp.c07_0162_force_inventory_failure();

set local role authenticated;
select pg_catalog.set_config(
  'request.jwt.claim.sub','16210000-0000-4000-8000-000000000001',true
);

do $c07_0162_forced_failure$
begin
  begin
    update public.bins
       set code='FORCED-FAILURE'
     where id='16210000-0000-4000-8000-000000000060';
    raise exception 'C07_0162_EXPECTED_FORCED_FAILURE';
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'C07_0162_FORCED_INVENTORY_FAILURE' then raise; end if;
  end;
end;
$c07_0162_forced_failure$;

do $c07_0162_duplicate_failure$
begin
  begin
    update public.bins
       set code='atomic-b'
     where id='16210000-0000-4000-8000-000000000060';
    raise exception 'C07_0162_EXPECTED_DUPLICATE_FAILURE';
  exception when unique_violation then
    if sqlstate <> '23505' then raise; end if;
  end;
end;
$c07_0162_duplicate_failure$;

reset role;
do $c07_0162_atomic_postcheck$
begin
  if not exists (
       select 1 from public.bins b
        where b.id='16210000-0000-4000-8000-000000000060'
          and b.code='ATOMIC-A'
     )
     or not exists (
       select 1 from public.inventory_items ii
        where ii.id='16210000-0000-4000-8000-000000000070'
          and ii.bin_location='ATOMIC-A'
     ) then
    raise exception 'C07_0162_ATOMIC_ROLLBACK_FAILED';
  end if;
end;
$c07_0162_atomic_postcheck$;

rollback;
\echo C07_0162_ATOMIC_FAILURE_PASS
