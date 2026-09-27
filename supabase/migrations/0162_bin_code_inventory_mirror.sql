-- 0162_bin_code_inventory_mirror.sql
--
-- Keep the current inventory display label synchronized with its exact bin.
-- Authorization remains on the existing bins mutation; this trigger grants no
-- new caller authority and rewrites no historical record.

do $c07_0162_preflight$
declare
  v_column_count integer;
begin
  if pg_catalog.to_regclass('public.bins') is null
     or pg_catalog.to_regclass('public.inventory_items') is null
     or pg_catalog.to_regrole('postgres') is null
     or pg_catalog.to_regrole('anon') is null
     or pg_catalog.to_regrole('authenticated') is null
     or pg_catalog.to_regrole('service_role') is null then
    raise exception 'C07_0162_REQUIRED_BASELINE_MISSING' using errcode = 'P0001';
  end if;

  select pg_catalog.count(*) into v_column_count
    from pg_catalog.pg_attribute a
   where (a.attrelid, a.attname, a.atttypid, a.attnotnull) in (
     (pg_catalog.to_regclass('public.bins'), 'id',
       pg_catalog.to_regtype('pg_catalog.uuid'), true),
     (pg_catalog.to_regclass('public.bins'), 'restaurant_id',
       pg_catalog.to_regtype('pg_catalog.uuid'), true),
     (pg_catalog.to_regclass('public.bins'), 'code',
       pg_catalog.to_regtype('pg_catalog.text'), true),
     (pg_catalog.to_regclass('public.inventory_items'), 'bin_id',
       pg_catalog.to_regtype('pg_catalog.uuid'), false),
     (pg_catalog.to_regclass('public.inventory_items'), 'restaurant_id',
       pg_catalog.to_regtype('pg_catalog.uuid'), true),
     (pg_catalog.to_regclass('public.inventory_items'), 'bin_location',
       pg_catalog.to_regtype('pg_catalog.text'), false)
   )
     and a.attnum > 0
     and not a.attisdropped;

  if v_column_count <> 6
     or not exists (
       select 1
         from pg_catalog.pg_constraint c
        where c.conrelid = pg_catalog.to_regclass('public.inventory_items')
          and c.confrelid = pg_catalog.to_regclass('public.bins')
          and c.contype = 'f'
          and c.convalidated
          and c.conkey = array[(
            select a.attnum
              from pg_catalog.pg_attribute a
             where a.attrelid = pg_catalog.to_regclass('public.inventory_items')
               and a.attname = 'bin_id'
               and a.attnum > 0
               and not a.attisdropped
          )]::smallint[]
          and c.confkey = array[(
            select a.attnum
              from pg_catalog.pg_attribute a
             where a.attrelid = pg_catalog.to_regclass('public.bins')
               and a.attname = 'id'
               and a.attnum > 0
               and not a.attisdropped
          )]::smallint[]
     ) then
    raise exception 'C07_0162_REQUIRED_BASELINE_MISMATCH' using errcode = 'P0001';
  end if;

  if exists (
       select 1
         from pg_catalog.pg_proc p
         join pg_catalog.pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and p.proname = 'mirror_bin_code_to_inventory_items'
     )
     or exists (
       select 1
         from pg_catalog.pg_trigger t
        where t.tgrelid = pg_catalog.to_regclass('public.bins')
          and t.tgname = 'bins_mirror_code_to_inventory_items'
          and not t.tgisinternal
     ) then
    raise exception 'C07_0162_TARGET_IDENTITY_OCCUPIED' using errcode = 'P0001';
  end if;
end;
$c07_0162_preflight$;

create function public.mirror_bin_code_to_inventory_items()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  update public.inventory_items as item
     set bin_location = new.code
   where item.bin_id = new.id
     and item.restaurant_id = new.restaurant_id;
  return new;
end;
$function$;

comment on function public.mirror_bin_code_to_inventory_items() is
  'Closed trigger function that mirrors an exact-site bin rename onto current inventory labels.';

revoke all on function public.mirror_bin_code_to_inventory_items()
  from public, anon, authenticated, service_role;
alter function public.mirror_bin_code_to_inventory_items() owner to postgres;

create trigger bins_mirror_code_to_inventory_items
after update of code on public.bins
for each row
when (new.code is distinct from old.code)
execute function public.mirror_bin_code_to_inventory_items();

do $c07_0162_postflight$
declare
  v_function pg_catalog.pg_proc%rowtype;
  v_trigger pg_catalog.pg_trigger%rowtype;
  v_code_attnum smallint;
  v_search_path text;
  v_trigger_definition text;
begin
  select p.* into strict v_function
    from pg_catalog.pg_proc p
   where p.oid = pg_catalog.to_regprocedure(
     'public.mirror_bin_code_to_inventory_items()'
   );
  select t.* into strict v_trigger
    from pg_catalog.pg_trigger t
   where t.tgrelid = pg_catalog.to_regclass('public.bins')
     and t.tgname = 'bins_mirror_code_to_inventory_items'
     and not t.tgisinternal;
  select a.attnum into strict v_code_attnum
    from pg_catalog.pg_attribute a
   where a.attrelid = pg_catalog.to_regclass('public.bins')
     and a.attname = 'code'
     and a.attnum > 0
     and not a.attisdropped;

  v_search_path := pg_catalog.current_setting('search_path');
  begin
    perform pg_catalog.set_config('search_path', '', true);
    v_trigger_definition := pg_catalog.pg_get_triggerdef(v_trigger.oid, false);
  exception when others then
    perform pg_catalog.set_config('search_path', v_search_path, true);
    raise;
  end;
  perform pg_catalog.set_config('search_path', v_search_path, true);

  if (select pg_catalog.count(*)
        from pg_catalog.pg_proc p
        join pg_catalog.pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public'
         and p.proname = 'mirror_bin_code_to_inventory_items') <> 1
     or pg_catalog.encode(
       pg_catalog.sha256(pg_catalog.convert_to(v_function.prosrc, 'UTF8')), 'hex'
     ) <> '39d03433e9ccd05bb77e01c9f313acb8e271a8cd923c3e92776187c3f8d639f9'
     or pg_catalog.pg_get_userbyid(v_function.proowner) <> 'postgres'
     or v_function.prolang <> (
       select l.oid from pg_catalog.pg_language l where l.lanname = 'plpgsql'
     )
     or v_function.prorettype <> pg_catalog.to_regtype('pg_catalog.trigger')
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
     or v_function.proargnames is not null
     or v_function.proargmodes is not null
     or v_function.proallargtypes is not null
     or v_function.protrftypes is not null
     or v_function.proargdefaults is not null
     or v_function.prosqlbody is not null
     or v_function.probin is not null
     or pg_catalog.to_jsonb(v_function.proacl) is distinct from
       '["postgres=X/postgres"]'::pg_catalog.jsonb
     or v_trigger.tgfoid <> v_function.oid
     or v_trigger.tgtype <> 17
     or v_trigger.tgenabled <> 'O'
     or v_trigger.tgdeferrable
     or v_trigger.tginitdeferred
     or v_trigger.tgnargs <> 0
     or v_trigger.tgattr::text <> v_code_attnum::text
     or v_trigger_definition <> 'CREATE TRIGGER bins_mirror_code_to_inventory_items AFTER UPDATE OF code ON public.bins FOR EACH ROW WHEN ((new.code IS DISTINCT FROM old.code)) EXECUTE FUNCTION public.mirror_bin_code_to_inventory_items()'
     or pg_catalog.has_function_privilege(
       'anon', 'public.mirror_bin_code_to_inventory_items()', 'EXECUTE'
     )
     or pg_catalog.has_function_privilege(
       'authenticated', 'public.mirror_bin_code_to_inventory_items()', 'EXECUTE'
     )
     or pg_catalog.has_function_privilege(
       'service_role', 'public.mirror_bin_code_to_inventory_items()', 'EXECUTE'
     ) then
    raise exception 'C07_0162_POSTFLIGHT_MISMATCH' using errcode = 'P0001';
  end if;
end;
$c07_0162_postflight$;
