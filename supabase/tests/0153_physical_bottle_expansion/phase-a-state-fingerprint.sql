\set ON_ERROR_STOP on
\pset format unaligned
\pset tuples_only on
\pset pager off

begin isolation level repeatable read read only;
set local time zone 'UTC';

select 'inventory_items' || E'\t' || count(*) || E'\t' ||
  coalesce(md5(string_agg(to_jsonb(t)::text, E'\n' order by id)), md5(''))
from public.inventory_items t;
select 'open_bottles' || E'\t' || count(*) || E'\t' ||
  coalesce(md5(string_agg(to_jsonb(t)::text, E'\n' order by id)), md5(''))
from public.open_bottles t;
select 'pour_events' || E'\t' || count(*) || E'\t' ||
  coalesce(md5(string_agg(to_jsonb(t)::text, E'\n' order by id)), md5(''))
from public.pour_events t;
select 'bottle_closeouts' || E'\t' || count(*) || E'\t' ||
  coalesce(md5(string_agg(to_jsonb(t)::text, E'\n' order by id)), md5(''))
from public.bottle_closeouts t;
select 'inventory_command_receipts' || E'\t' || count(*) || E'\t' ||
  coalesce(md5(string_agg(to_jsonb(t)::text, E'\n' order by restaurant_id, operation_id)), md5(''))
from public.inventory_command_receipts t;
select 'inventory_command_bottle_effects' || E'\t' || count(*) || E'\t' ||
  coalesce(md5(string_agg(to_jsonb(t)::text, E'\n' order by restaurant_id, operation_id, entry_ordinal)), md5(''))
from public.inventory_command_bottle_effects t;
select 'restaurants' || E'\t' || count(*) || E'\t' ||
  coalesce(md5(string_agg(to_jsonb(t)::text, E'\n' order by id)), md5(''))
from public.restaurants t;
select 'memberships' || E'\t' || count(*) || E'\t' ||
  coalesce(md5(string_agg(to_jsonb(t)::text, E'\n' order by restaurant_id, user_id)), md5(''))
from public.memberships t;
select 'wines' || E'\t' || count(*) || E'\t' ||
  coalesce(md5(string_agg(to_jsonb(t)::text, E'\n' order by id)), md5(''))
from public.wines t;

select 'catalog' || E'\t' || md5(coalesce(string_agg(definition, E'\n' order by definition), ''))
from (
  select format(
    'relation:%s:%s:%s:%s:%s:%s:%s', c.oid::regclass::text, c.relkind,
    c.relowner, c.relrowsecurity, c.relforcerowsecurity,
    coalesce(c.reloptions::text, ''), coalesce(c.relacl::text, '')
  ) as definition
    from pg_catalog.pg_class c
   where c.oid in (
     'public.inventory_items'::regclass, 'public.open_bottles'::regclass,
     'public.pour_events'::regclass, 'public.bottle_closeouts'::regclass,
     'public.inventory_command_receipts'::regclass,
     'public.inventory_command_bottle_effects'::regclass,
     'public.effective_service_pour_events'::regclass
   )
  union all
  select format(
    'column:%s:%s:%s:%s:%s:%s:%s:%s', c.oid::regclass::text, a.attnum,
    a.attname, pg_catalog.format_type(a.atttypid, a.atttypmod), a.attnotnull,
    a.attidentity, a.attgenerated, coalesce(pg_catalog.pg_get_expr(d.adbin, d.adrelid), '')
  )
    from pg_catalog.pg_attribute a
    join pg_catalog.pg_class c on c.oid = a.attrelid
    left join pg_catalog.pg_attrdef d
      on d.adrelid = a.attrelid and d.adnum = a.attnum
   where a.attrelid in (
     'public.inventory_items'::regclass, 'public.open_bottles'::regclass,
     'public.pour_events'::regclass, 'public.bottle_closeouts'::regclass,
     'public.inventory_command_receipts'::regclass,
     'public.inventory_command_bottle_effects'::regclass,
     'public.effective_service_pour_events'::regclass
   )
     and a.attnum > 0 and not a.attisdropped
  union all
  select format(
    'constraint:%s:%s:%s:%s', c.conrelid::regclass::text, c.conname,
    pg_get_constraintdef(c.oid, true),
    coalesce(pg_catalog.obj_description(c.oid, 'pg_constraint'), '')
  ) as definition
    from pg_catalog.pg_constraint c
   where c.conrelid in (
     'public.inventory_items'::regclass, 'public.open_bottles'::regclass,
     'public.pour_events'::regclass, 'public.bottle_closeouts'::regclass,
     'public.inventory_command_receipts'::regclass,
     'public.inventory_command_bottle_effects'::regclass
   )
  union all
  select format(
    'index:%s:%s:%s', i.indexrelid::regclass::text, pg_get_indexdef(i.indexrelid),
    coalesce(pg_catalog.obj_description(i.indexrelid, 'pg_class'), '')
  )
    from pg_catalog.pg_index i
   where i.indrelid in (
     'public.inventory_items'::regclass, 'public.open_bottles'::regclass,
     'public.pour_events'::regclass, 'public.bottle_closeouts'::regclass,
     'public.inventory_command_receipts'::regclass,
     'public.inventory_command_bottle_effects'::regclass
   )
  union all
  select format(
    'function:%s:%s:%s:%s:%s', p.oid::regprocedure::text, p.proowner,
    p.prosecdef, coalesce(p.proconfig::text, ''), coalesce(p.proacl::text, '')
  ) || E'\n' || pg_get_functiondef(p.oid)
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in (
       'current_inventory_contract_version', 'execute_physical_bottle_command',
       'execute_physical_reconciliation_batch', 'list_active_physical_bottles',
       'list_open_bottle_aggregates', 'pour_events_maintain_open_bottle',
       'pour_events_reverse_open_bottle', 'open_bottles_enforce_capacity',
       'record_pour', 'reconcile_open_bottle', 'reconcile_open_bottles_batch',
       'undo_last_pour', 'execute_inventory_command'
     )
  union all
  select format(
    'trigger:%s:%s:%s:%s:%s', t.tgrelid::regclass::text, t.tgname,
    t.tgfoid::regprocedure::text, t.tgenabled, pg_catalog.pg_get_triggerdef(t.oid, true)
  )
    from pg_catalog.pg_trigger t
   where t.tgrelid in (
     'public.inventory_items'::regclass, 'public.open_bottles'::regclass,
     'public.pour_events'::regclass, 'public.bottle_closeouts'::regclass,
     'public.inventory_command_receipts'::regclass,
     'public.inventory_command_bottle_effects'::regclass
   )
     and not t.tgisinternal
  union all
  select format('acl:%s:%s', c.oid::regclass::text, coalesce(c.relacl::text, ''))
    from pg_catalog.pg_class c
   where c.oid in (
     'public.inventory_command_bottle_effects'::regclass,
     'public.effective_service_pour_events'::regclass
   )
  union all
  select 'view:' || pg_get_viewdef('public.effective_service_pour_events'::regclass, true)
    || ':' || coalesce(pg_catalog.obj_description(
      'public.effective_service_pour_events'::regclass, 'pg_class'
    ), '')
  union all
  select format(
    'policy:%s:%s:%s:%s:%s:%s', pol.polrelid::regclass::text, pol.polname,
    pol.polcmd, pol.polpermissive, coalesce(pol.polroles::text, ''),
    coalesce(pg_catalog.pg_get_expr(pol.polqual, pol.polrelid), '') || ':' ||
      coalesce(pg_catalog.pg_get_expr(pol.polwithcheck, pol.polrelid), '')
  )
    from pg_catalog.pg_policy pol
   where pol.polrelid in (
     'public.inventory_command_bottle_effects'::regclass,
     'public.effective_service_pour_events'::regclass
   )
  union all
  select format(
    'dependent-view:%s->%s', dependent_view.oid::regclass::text, d.refobjid::regclass::text
  )
    from pg_catalog.pg_depend d
    join pg_catalog.pg_rewrite rw
      on d.classid = 'pg_catalog.pg_rewrite'::regclass
     and rw.oid = d.objid
    join pg_catalog.pg_class dependent_view on dependent_view.oid = rw.ev_class
   where d.refobjid in (
     'public.inventory_command_bottle_effects'::regclass,
     'public.effective_service_pour_events'::regclass
   )
     and dependent_view.oid not in (
       'public.inventory_command_bottle_effects'::regclass,
       'public.effective_service_pour_events'::regclass
     )
  union all
  select format(
    'dependent-constraint:%s:%s', c.conrelid::regclass::text, c.conname
  )
    from pg_catalog.pg_constraint c
   where c.confrelid = 'public.inventory_command_bottle_effects'::regclass
     and c.conrelid <> 'public.inventory_command_bottle_effects'::regclass
  union all
  select format(
    'dependent-function:%s->%s', dependent_function.oid::regprocedure::text,
    d.refobjid::regprocedure::text
  )
    from pg_catalog.pg_depend d
    join pg_catalog.pg_proc dependent_function
      on d.classid = 'pg_catalog.pg_proc'::regclass
     and dependent_function.oid = d.objid
   where d.refclassid = 'pg_catalog.pg_proc'::regclass
     and d.refobjid in (
       'public.current_inventory_contract_version()'::regprocedure,
       'public.execute_physical_bottle_command(uuid,uuid,text,uuid,uuid,uuid,integer,text,text,integer,integer,uuid,uuid,text,boolean)'::regprocedure,
       'public.execute_physical_reconciliation_batch(uuid,uuid,jsonb)'::regprocedure,
       'public.list_active_physical_bottles(uuid)'::regprocedure,
       'public.list_open_bottle_aggregates(uuid)'::regprocedure
     )
     and dependent_function.oid not in (
       'public.current_inventory_contract_version()'::regprocedure,
       'public.execute_physical_bottle_command(uuid,uuid,text,uuid,uuid,uuid,integer,text,text,integer,integer,uuid,uuid,text,boolean)'::regprocedure,
       'public.execute_physical_reconciliation_batch(uuid,uuid,jsonb)'::regprocedure,
       'public.list_active_physical_bottles(uuid)'::regprocedure,
       'public.list_open_bottle_aggregates(uuid)'::regprocedure
     )
) catalog(definition);

commit;
