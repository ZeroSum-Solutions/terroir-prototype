-- 0161 empty-history down/up cycle. The target starts with 0161 applied and
-- the outer transaction restores that exact applied state by rollback.
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
\if :{?source_0161_sha256}
\else
  \echo C06_0161_FORWARD_PIN_REQUIRED
  \quit 3
\endif
\if :{?source_0161_down_sha256}
\else
  \echo C06_0161_DOWN_PIN_REQUIRED
  \quit 3
\endif

select 1 / case when
  current_database() = :'expected_database'
  and current_user = 'postgres'
  and session_user = 'postgres'
  and :'target_admitted' = 'on'
  and :'source_0161_sha256' = '7c13530124d26003caf478b65904e02934a5e232c3ebcf4343a1b75914e0fcf7'
  and :'source_0161_down_sha256' = '04993e73b91c02b44c429acfc983d365c232e95801dfefb4b64091c2c93cab6a'
  and pg_catalog.to_regprocedure(
    'public.receive_bottle_at_location_private(uuid,uuid,uuid,text,uuid)'
  ) is not null
  and not exists (
    select 1 from public.inventory_command_receipts r
     where r.command_version=3 and r.command_type='bottle_location_receive'
  )
then 1 else 0 end as c06_0161_cycle_target_admitted;

begin;
set local statement_timeout = '30s';
set local lock_timeout = '5s';

\ir ../../migrations/down/0161_bottle_location_receiving.down.sql

do $c06_0161_cycle_down$
declare v_definition text;
begin
  select pg_catalog.pg_get_constraintdef(c.oid,true) into strict v_definition
    from pg_catalog.pg_constraint c
   where c.conrelid=pg_catalog.to_regclass('public.inventory_command_receipts')
     and c.conname='inventory_command_receipts_versioned_shape_check';
  if pg_catalog.to_regprocedure(
       'public.receive_bottle_at_location_private(uuid,uuid,uuid,text,uuid)'
     ) is not null
     or pg_catalog.strpos(v_definition,'bottle_inventory_save')=0
     or pg_catalog.strpos(v_definition,'bottle_location_receive')<>0 then
    raise exception 'C06_0161_CYCLE_DOWN_FAILED';
  end if;
end;
$c06_0161_cycle_down$;

\ir ../../migrations/0161_bottle_location_receiving.sql

do $c06_0161_cycle_up$
declare v_function pg_catalog.pg_proc%rowtype;
begin
  select p.* into strict v_function
    from pg_catalog.pg_proc p
   where p.oid=pg_catalog.to_regprocedure(
     'public.receive_bottle_at_location_private(uuid,uuid,uuid,text,uuid)'
   );
  if pg_catalog.encode(
       pg_catalog.sha256(pg_catalog.convert_to(v_function.prosrc,'UTF8')),'hex'
     ) <> '6a24736e1a19541d567081f9cec72f32e4c72af371f6d62f0c8015480750af03'
     or pg_catalog.pg_get_userbyid(v_function.proowner)<>'postgres'
     or v_function.proconfig is distinct from array['search_path=""']::text[]
     or pg_catalog.to_jsonb(v_function.proacl) is distinct from
       '["postgres=X/postgres", "authenticated=X/postgres"]'::jsonb then
    raise exception 'C06_0161_CYCLE_UP_FAILED';
  end if;
end;
$c06_0161_cycle_up$;

rollback;
\echo C06_0161_MIGRATION_CYCLE_PASS
