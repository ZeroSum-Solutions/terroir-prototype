-- Verify both races, then remove only the reserved fixture. Root must compare
-- its full pre/post protected database fingerprints outside this script.
\set ON_ERROR_STOP on
\pset pager off
\if :{?expected_database}
\else
  \echo C06_0161_EXPECTED_DATABASE_REQUIRED
  \quit 3
\endif
select 1 / case when current_database()=:'expected_database'
  and current_user='postgres' and session_user='postgres'
then 1 else 0 end as c06_0161_cleanup_target_admitted;

begin;
set local statement_timeout='30s';
set local lock_timeout='5s';
do $c06_0161_concurrency_results$
declare v_result jsonb;
begin
  select r.result_payload into strict v_result
    from public.inventory_command_receipts r
   where r.restaurant_id='16140000-0000-4000-8000-000000000020'
     and r.operation_id='16140000-0000-4000-8000-000000000070';
  if (select pg_catalog.count(*) from public.inventory_command_receipts r
       where r.restaurant_id='16140000-0000-4000-8000-000000000020'
         and r.operation_id='16140000-0000-4000-8000-000000000070')<>1
     or (select pg_catalog.count(*) from public.inventory_items ii
          where ii.restaurant_id='16140000-0000-4000-8000-000000000020'
            and ii.wine_id='16140000-0000-4000-8000-000000000050'
            and ii.section='Race Same')<>1
     or not exists (
       select 1 from public.inventory_items ii
        where ii.id=(v_result->>'inventoryItemId')::uuid
          and ii.section='Race Same'
     )
     or v_result->>'section' is distinct from 'Race Same'
     or v_result->>'binCode' is distinct from 'RACE-ORIGINAL' then
    raise exception 'C06_0161_SAME_OPERATION_RACE_FAILED';
  end if;

  select r.result_payload into strict v_result
    from public.inventory_command_receipts r
   where r.restaurant_id='16140000-0000-4000-8000-000000000020'
     and r.operation_id='16140000-0000-4000-8000-000000000071';
  if v_result->>'binCode' is distinct from 'RACE-ORIGINAL'
     or not exists (
       select 1 from public.inventory_items ii
        where ii.id=(v_result->>'inventoryItemId')::uuid
          and ii.bin_id='16140000-0000-4000-8000-000000000060'
          and ii.bin_location='RACE-ORIGINAL'
     )
     or not exists (
       select 1 from public.bins b
        where b.id='16140000-0000-4000-8000-000000000060'
          and b.code='RACE-RENAMED'
          and b.retired_at is not null
     )
     or (select pg_catalog.count(*) from public.inventory_items ii
          where ii.restaurant_id='16140000-0000-4000-8000-000000000020')<>2 then
    raise exception 'C06_0161_BIN_SERIALIZATION_FAILED';
  end if;
end;
$c06_0161_concurrency_results$;

create temporary table c06_0161_owned_restaurants on commit drop as
select distinct m.restaurant_id
  from public.memberships m
 where m.user_id='16140000-0000-4000-8000-000000000001'
union
select '16140000-0000-4000-8000-000000000020'::uuid;
create temporary table c06_0161_owned_workspaces on commit drop as
select distinct r.workspace_id
  from public.restaurants r
  join c06_0161_owned_restaurants o on o.restaurant_id=r.id;
delete from public.restaurants r
 where r.id in (select restaurant_id from c06_0161_owned_restaurants);
delete from public.workspaces w
 where w.id in (select workspace_id from c06_0161_owned_workspaces);
delete from auth.users u
 where u.id='16140000-0000-4000-8000-000000000001';
do $c06_0161_cleanup_postcheck$
begin
  if exists(select 1 from auth.users where id='16140000-0000-4000-8000-000000000001')
     or exists(select 1 from public.restaurants where id in (select restaurant_id from c06_0161_owned_restaurants))
     or exists(select 1 from public.inventory_command_receipts where restaurant_id='16140000-0000-4000-8000-000000000020')
     or exists(select 1 from public.inventory_items where restaurant_id='16140000-0000-4000-8000-000000000020') then
    raise exception 'C06_0161_CONCURRENCY_CLEANUP_FAILED';
  end if;
end;
$c06_0161_cleanup_postcheck$;
commit;
\echo C06_0161_CONCURRENCY_VERIFY_CLEANUP_PASS
