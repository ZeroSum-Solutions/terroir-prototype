-- 0160 down/up rollback-only cycle on the exact admitted disposable target.
-- The target begins with 0160 applied; this transaction restores that state.
\set ON_ERROR_STOP on
\pset pager off

\if :{?baseline_b_schema_sha256}
\else
  \echo C04_0160_CYCLE_BASELINE_SCHEMA_PIN_REQUIRED
  \quit 3
\endif
\if :{?source_0159_sha256}
\else
  \echo C04_0160_CYCLE_0159_SOURCE_PIN_REQUIRED
  \quit 3
\endif
\if :{?source_0160_sha256}
\else
  \echo C04_0160_CYCLE_UP_SOURCE_PIN_REQUIRED
  \quit 3
\endif
\if :{?source_0160_down_sha256}
\else
  \echo C04_0160_CYCLE_DOWN_SOURCE_PIN_REQUIRED
  \quit 3
\endif
\if :{?target_admitted}
\else
  \echo C04_0160_CYCLE_TARGET_ADMISSION_REQUIRED
  \quit 3
\endif

select 1 / case when
  current_database() = 'terroir_section_0160_20260927a'
  and current_user = 'postgres'
  and session_user = 'postgres'
  and :'target_admitted' = 'on'
  and :'baseline_b_schema_sha256' =
    '2848957cd7e08dea5cc64f1b5c08aca3e5068a24b324e2a27bfdb131dbc1352b'
  and :'source_0159_sha256' =
    '17063cea072da9034d71af5a5ba3744a45bef872cc814dd95f62d0da668e1fba'
  and :'source_0160_sha256' =
    '7c236443bc305345d2aa925fedeeedeb0292883f9bb4b61072c7251a012e3ba5'
  and :'source_0160_down_sha256' =
    '35385f4bef5114fd594d5e8a9b14dd98c454a750f6eba334471a5bfc1c4165d4'
  and pg_catalog.to_regprocedure(
    'public.assign_wine_sections_private(uuid,uuid[],text)'
  ) is not null
then 1 else 0 end as c04_0160_cycle_target_admitted;

begin;
set local statement_timeout = '30s';
set local lock_timeout = '5s';

\ir ../../migrations/down/0160_wine_section_assignment_boundary.down.sql

do $c04_0160_cycle_down_observation$
begin
  if exists (
    select 1
      from pg_catalog.pg_proc p
      join pg_catalog.pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname = 'assign_wine_sections_private'
  ) then
    raise exception 'C04_0160_CYCLE_DOWN_FAILED' using errcode = 'P0001';
  end if;
end;
$c04_0160_cycle_down_observation$;

\ir ../../migrations/0160_wine_section_assignment_boundary.sql

do $c04_0160_cycle_up_observation$
declare
  v_function pg_catalog.pg_proc%rowtype;
begin
  select p.* into strict v_function
    from pg_catalog.pg_proc p
   where p.oid = pg_catalog.to_regprocedure(
     'public.assign_wine_sections_private(uuid,uuid[],text)'
   );
  if pg_catalog.encode(
       pg_catalog.sha256(pg_catalog.convert_to(v_function.prosrc, 'UTF8')),
       'hex'
     ) <> 'de52e8ee719623d8f102f371051a47a12128145ba97f59892eb89dfd18b68e81'
     or pg_catalog.pg_get_userbyid(v_function.proowner) <> 'postgres'
     or v_function.proconfig is distinct from array['search_path=""']::text[]
     or pg_catalog.to_jsonb(v_function.proacl) is distinct from
       '["postgres=X/postgres", "authenticated=X/postgres"]'::pg_catalog.jsonb then
    raise exception 'C04_0160_CYCLE_UP_FAILED' using errcode = 'P0001';
  end if;
end;
$c04_0160_cycle_up_observation$;

rollback;
\echo C04_0160_MIGRATION_CYCLE_PASS
