-- 0163_stalled_invoice_scan_expiry.down.sql
-- Remove only the exact admitted function. Historical failed/stalled rows stay.

do $c08_0163_down_preflight$
declare
  v_function pg_catalog.pg_proc%rowtype;
begin
  if pg_catalog.to_regprocedure(
       'public.expire_stalled_invoice_scans(uuid)'
     ) is null then
    raise exception 'C08_0163_DOWN_BASELINE_MISMATCH' using errcode = 'P0001';
  end if;

  select p.* into strict v_function
    from pg_catalog.pg_proc p
   where p.oid = pg_catalog.to_regprocedure(
     'public.expire_stalled_invoice_scans(uuid)'
   );

  if (select pg_catalog.count(*)
        from pg_catalog.pg_proc p
        join pg_catalog.pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public'
         and p.proname = 'expire_stalled_invoice_scans') <> 1
     or pg_catalog.encode(
       pg_catalog.sha256(pg_catalog.convert_to(v_function.prosrc, 'UTF8')),
       'hex'
     ) <> 'bd01b007ef6b2bc0b37b3e7126f938f8ae10d5600b7499ccd941abd5efa0b8a1'
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
     or v_function.pronargs <> 1
     or v_function.pronargdefaults <> 0
     or v_function.provariadic <> 0::pg_catalog.oid
     or v_function.prosupport <> 0::pg_catalog.oid
     or v_function.proconfig is distinct from array['search_path=""']::text[]
     or pg_catalog.to_jsonb(v_function.proargnames) is distinct from
       '["p_restaurant_id"]'::pg_catalog.jsonb
     or v_function.proargmodes is not null
     or v_function.proallargtypes is not null
     or v_function.protrftypes is not null
     or v_function.proargdefaults is not null
     or v_function.prosqlbody is not null
     or v_function.probin is not null
     or pg_catalog.to_jsonb(v_function.proacl) is distinct from
       '["postgres=X/postgres", "authenticated=X/postgres"]'::pg_catalog.jsonb
     or exists (
       select 1
         from pg_catalog.pg_depend d
        where d.refclassid = 'pg_catalog.pg_proc'::pg_catalog.regclass
          and d.refobjid = v_function.oid
          and d.deptype = 'n'
     ) then
    raise exception 'C08_0163_DOWN_BASELINE_MISMATCH' using errcode = 'P0001';
  end if;
end;
$c08_0163_down_preflight$;

drop function public.expire_stalled_invoice_scans(uuid) restrict;

do $c08_0163_down_postflight$
begin
  if exists (
       select 1
         from pg_catalog.pg_proc p
         join pg_catalog.pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and p.proname = 'expire_stalled_invoice_scans'
     ) then
    raise exception 'C08_0163_DOWN_POSTFLIGHT_MISMATCH' using errcode = 'P0001';
  end if;
end;
$c08_0163_down_postflight$;
