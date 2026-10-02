-- 0160_wine_section_assignment_boundary.down.sql
--
-- Remove only the exact admitted 0160 boundary. RESTRICT is intentional:
-- rollback must refuse rather than cascade through an admitted caller.

do $c04_0160_down_preflight$
declare
  v_function pg_catalog.pg_proc%rowtype;
  v_overload_count integer;
begin
  if pg_catalog.to_regprocedure(
    'public.assign_wine_sections_private(uuid,uuid[],text)'
  ) is null then
    raise exception 'C04_0160_DOWN_BASELINE_MISMATCH' using errcode = 'P0001';
  end if;

  select p.* into strict v_function
    from pg_catalog.pg_proc p
   where p.oid = pg_catalog.to_regprocedure(
     'public.assign_wine_sections_private(uuid,uuid[],text)'
   );
  select pg_catalog.count(*) into v_overload_count
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname = 'assign_wine_sections_private';

  if v_overload_count <> 1
     or pg_catalog.encode(
       pg_catalog.sha256(pg_catalog.convert_to(v_function.prosrc, 'UTF8')),
       'hex'
     ) <> 'de52e8ee719623d8f102f371051a47a12128145ba97f59892eb89dfd18b68e81'
     or pg_catalog.pg_get_userbyid(v_function.proowner) <> 'postgres'
     or v_function.prolang <> (
       select l.oid from pg_catalog.pg_language l where l.lanname = 'plpgsql'
     )
     or v_function.prorettype <> pg_catalog.to_regtype('pg_catalog.jsonb')
     or v_function.prokind <> 'f'
     or v_function.provolatile <> 'v'
     or not v_function.prosecdef
     or v_function.proisstrict
     or v_function.proretset
     or v_function.proparallel <> 'u'
     or v_function.proleakproof
     or v_function.procost <> 100::real
     or v_function.prorows <> 0::real
     or v_function.pronargdefaults <> 0
     or v_function.provariadic <> 0::pg_catalog.oid
     or v_function.prosupport <> 0::pg_catalog.oid
     or v_function.proconfig is distinct from array['search_path=""']::text[]
     or pg_catalog.to_jsonb(v_function.proargnames) is distinct from
       '["p_restaurant_id", "p_wine_ids", "p_section"]'::pg_catalog.jsonb
     or v_function.proargmodes is not null
     or v_function.proallargtypes is not null
     or v_function.protrftypes is not null
     or v_function.proargdefaults is not null
     or v_function.prosqlbody is not null
     or v_function.probin is not null
     or pg_catalog.to_jsonb(v_function.proacl) is distinct from
       '["postgres=X/postgres", "authenticated=X/postgres"]'::pg_catalog.jsonb then
    raise exception 'C04_0160_DOWN_BASELINE_MISMATCH' using errcode = 'P0001';
  end if;
end;
$c04_0160_down_preflight$;

drop function public.assign_wine_sections_private(uuid,uuid[],text) restrict;

do $c04_0160_down_postflight$
begin
  if exists (
    select 1
      from pg_catalog.pg_proc p
      join pg_catalog.pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname = 'assign_wine_sections_private'
  ) then
    raise exception 'C04_0160_DOWN_POSTFLIGHT_MISMATCH' using errcode = 'P0001';
  end if;
end;
$c04_0160_down_postflight$;
