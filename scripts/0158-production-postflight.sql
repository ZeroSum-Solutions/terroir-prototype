-- Catalog/data postflight for 0158. The route remains drained until the exact
-- save_bottle_inventory_private caller is deployed and acknowledged.
\set ON_ERROR_STOP on
\pset pager off

do $postflight$
declare
  v_identity text;
  v_proc oid;
  v_config text[];
  v_owner text;
begin
  foreach v_identity in array array[
    'public.read_current_operational_memberships(uuid)',
    'public.save_bottle_inventory_private(uuid,uuid,text,text,integer,text,text,text,text,integer,numeric)'
  ] loop
    v_proc:=to_regprocedure(v_identity);
    if v_proc is null then raise exception 'C04_0158_ROUTINE_MISSING: %',v_identity; end if;
    select p.proconfig,r.rolname into v_config,v_owner
      from pg_catalog.pg_proc p join pg_catalog.pg_roles r on r.oid=p.proowner
     where p.oid=v_proc and p.prosecdef;
    if not found or v_config is distinct from array['search_path=""']::text[]
       or v_owner is distinct from 'postgres'
       or not has_function_privilege('authenticated',v_proc,'EXECUTE')
       or has_function_privilege('anon',v_proc,'EXECUTE')
       or has_function_privilege('service_role',v_proc,'EXECUTE')
       or exists(
         select 1 from pg_catalog.pg_proc p2,
              lateral pg_catalog.aclexplode(coalesce(p2.proacl,pg_catalog.acldefault('f',p2.proowner))) acl
          where p2.oid=v_proc and acl.grantee=0 and acl.privilege_type='EXECUTE'
       ) then
      raise exception 'C04_0158_ROUTINE_POSTURE_MISMATCH: %',v_identity;
    end if;
  end loop;

  if exists(
    select 1 from pg_catalog.pg_constraint c
     where c.conrelid='public.inventory_command_receipts'::regclass
       and c.conname in (
         'inventory_command_receipts_command_version_check',
         'inventory_command_receipts_command_type_check',
         'inventory_command_receipts_versioned_shape_check'
       ) and not c.convalidated
  ) or (select count(*) from pg_catalog.pg_constraint c
         where c.conrelid='public.inventory_command_receipts'::regclass
           and c.conname in (
             'inventory_command_receipts_command_version_check',
             'inventory_command_receipts_command_type_check',
             'inventory_command_receipts_versioned_shape_check'
           ))<>3 then
    raise exception 'C04_0158_RECEIPT_CONSTRAINT_MISMATCH';
  end if;
  if has_table_privilege('authenticated','public.inventory_command_receipts','SELECT')
     or has_table_privilege('anon','public.inventory_command_receipts','SELECT')
     or has_table_privilege('authenticated','public.inventory_command_receipts','INSERT,UPDATE,DELETE')
     or has_table_privilege('anon','public.inventory_command_receipts','INSERT,UPDATE,DELETE') then
    raise exception 'C04_0158_RECEIPT_TABLE_ACL_WIDENED';
  end if;
  if exists(
    select 1 from public.scan_idempotency c
     where c.claimed_by_user_id is not null
       and jsonb_typeof(c.response_body)='object'
       and jsonb_typeof(c.response_body->'kind')='string'
       and c.response_body->>'kind'='bottle_inventory_save'
  ) then
    raise exception 'C04_0158_ROUTE_DRAIN_VIOLATED';
  end if;
end;
$postflight$;

select 'C04_0158_POSTFLIGHT' as evidence,current_database(),
       (select count(*) from public.inventory_command_receipts where command_version=3) as version_3_receipts;
\echo C04_0158_PRODUCTION_POSTFLIGHT_PASS_DEPLOY_EXACT_CALLER_BEFORE_RESUME
