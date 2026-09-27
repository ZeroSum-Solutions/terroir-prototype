-- 0160_wine_section_assignment_boundary.sql
--
-- Add the closed whole-wine section-assignment boundary used by the legacy
-- single and batch HTTP routes. This migration does not add placement
-- hierarchy, history, cost access, or physical-inventory behavior.

do $c04_0160_preflight$
begin
  if pg_catalog.to_regclass('public.wines') is null
     or pg_catalog.to_regclass('public.inventory_items') is null
     or pg_catalog.to_regprocedure(
       'public.current_site_role_at_least(uuid,public.membership_role)'
     ) is null then
    raise exception 'C04_0160_REQUIRED_BASELINE_MISSING' using errcode = 'P0001';
  end if;

  if not exists (
       select 1
         from pg_catalog.pg_attribute a
        where a.attrelid = pg_catalog.to_regclass('public.inventory_items')
          and a.attname = 'section'
          and a.attnum > 0
          and not a.attisdropped
     ) then
    raise exception 'C04_0160_REQUIRED_BASELINE_MISSING' using errcode = 'P0001';
  end if;

  if exists (
    select 1
      from pg_catalog.pg_proc p
      join pg_catalog.pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname = 'assign_wine_sections_private'
  ) then
    raise exception 'C04_0160_TARGET_IDENTITY_OCCUPIED' using errcode = 'P0001';
  end if;
end;
$c04_0160_preflight$;

create function public.assign_wine_sections_private(
  p_restaurant_id uuid,
  p_wine_ids uuid[],
  p_section text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_actor uuid;
  v_section text;
  v_requested_count integer;
  v_distinct_count integer;
  v_locked_count integer := 0;
  v_wine_id uuid;
begin
  v_actor := (select auth.uid());
  if v_actor is null
     or not public.current_site_role_at_least(p_restaurant_id, 'manager') then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  v_section := nullif(pg_catalog.btrim(p_section), '');
  v_requested_count := pg_catalog.cardinality(p_wine_ids);
  if p_wine_ids is null
     or v_requested_count not between 1 and 200
     or exists (
       select 1 from pg_catalog.unnest(p_wine_ids) requested(wine_id)
        where requested.wine_id is null
     )
     or (v_section is not null and pg_catalog.char_length(v_section) > 100) then
    raise exception 'section_assignment_invalid' using errcode = 'P04V1';
  end if;

  select pg_catalog.count(distinct requested.wine_id)::integer
    into v_distinct_count
    from pg_catalog.unnest(p_wine_ids) requested(wine_id);
  if v_distinct_count <> v_requested_count then
    raise exception 'section_assignment_wine_set_refused' using errcode = 'P04W1';
  end if;

  -- Stable exact-site wine locks serialize overlapping assignments and match
  -- the 0158 bottle-receiving lock without blocking FK KEY SHARE readers.
  for v_wine_id in
    select w.id
      from public.wines w
     where w.restaurant_id = p_restaurant_id
       and w.id = any(p_wine_ids)
     order by w.id
     for no key update
  loop
    v_locked_count := v_locked_count + 1;
  end loop;

  if v_locked_count <> v_requested_count then
    raise exception 'section_assignment_wine_set_refused' using errcode = 'P04W1';
  end if;

  -- One set update is both the inventory-row lock and the complete write.
  -- The existing BEFORE UPDATE trigger owns updated_at advancement.
  update public.inventory_items ii
     set section = v_section
   where ii.restaurant_id = p_restaurant_id
     and ii.wine_id = any(p_wine_ids);

  return pg_catalog.jsonb_build_object(
    'requestedWineCount', v_requested_count,
    'section', v_section
  );
end;
$function$;

comment on function public.assign_wine_sections_private(uuid,uuid[],text) is
  'Atomic whole-wine section assignment; requested-count receipt, no CAS or cost access.';

revoke all on function public.assign_wine_sections_private(uuid,uuid[],text)
  from public, anon, authenticated, service_role;
grant execute on function public.assign_wine_sections_private(uuid,uuid[],text)
  to authenticated;
alter function public.assign_wine_sections_private(uuid,uuid[],text) owner to postgres;

do $c04_0160_postflight$
declare
  v_function pg_catalog.pg_proc%rowtype;
  v_overload_count integer;
begin
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
    raise exception 'C04_0160_POSTFLIGHT_MISMATCH' using errcode = 'P0001';
  end if;
end;
$c04_0160_postflight$;
