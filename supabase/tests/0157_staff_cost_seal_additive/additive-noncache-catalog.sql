-- 0157 additive staff-cost seal: non-cache catalog and validator contract.
-- Run only on a disposable database after 0157. This file does not alter
-- retained or hosted databases.
\set ON_ERROR_STOP on
\pset pager off

do $catalog_contract$
declare
  v_identity text;
  v_proc oid;
  v_config text[];
  v_owner text;
begin
  foreach v_identity in array array[
    'public.current_site_role_at_least(uuid,public.membership_role)',
    'public.read_inventory_costs(uuid,uuid[])',
    'public.read_wine_pricing_strategy(uuid,uuid[])',
    'public.read_wine_cost_flags(uuid,uuid[])',
    'public.read_restaurant_pricing_defaults(uuid)',
    'public.read_pricing_recommendations(uuid)',
    'public.read_invoice_scan_private(uuid)',
    'public.read_invoice_scan_deletion_private(uuid)',
    'public.read_reconcile_action_private(uuid)',
    'public.read_identity_merge_private(uuid)',
    'public.read_import_batch_cost_rows(uuid,integer,integer)',
    'public.read_import_batch_display_rows(uuid,integer,integer)',
    'public.read_cellar_health_private(uuid,uuid[])',
    'public.create_inventory_item_private(uuid,uuid,integer,numeric,text,uuid,text,text,text,uuid,public.added_via)',
    'public.patch_inventory_item_private(uuid,timestamp with time zone,boolean,integer,boolean,numeric,boolean,text,boolean,uuid,boolean,text,boolean,text,boolean,text)'
  ] loop
    v_proc := to_regprocedure(v_identity);
    if v_proc is null then
      raise exception 'C04_0157_REQUIRED_ROUTINE_MISSING: %', v_identity;
    end if;

    select p.proconfig,r.rolname into v_config,v_owner
      from pg_catalog.pg_proc p join pg_catalog.pg_roles r on r.oid=p.proowner
     where p.oid = v_proc
       and p.prosecdef;
    if not found or v_config is distinct from array['search_path=""']::text[]
       or v_owner is distinct from 'postgres' then
      raise exception 'C04_0157_ROUTINE_POSTURE_MISMATCH: % config=% owner=%',
        v_identity, v_config, v_owner;
    end if;
  end loop;

  if has_function_privilege(
       'authenticated',
       'public.current_site_role_at_least(uuid,public.membership_role)',
       'EXECUTE'
     )
     or has_function_privilege(
       'service_role',
       'public.current_site_role_at_least(uuid,public.membership_role)',
       'EXECUTE'
     ) then
    raise exception 'C04_0157_CURRENT_ROLE_HELPER_EXECUTABLE';
  end if;

  foreach v_identity in array array[
    'public.add_manual_overrides_pre_0157(uuid,text[])',
    'public.enrich_wines_batch_pre_0157(uuid,jsonb)',
    'public.create_import_batch_pre_0157(uuid,uuid,text,integer,jsonb,uuid,integer,integer,text,text)',
    'public.count_import_batch_rows_pre_0157(uuid)',
    'public.apply_import_batch_chunk_pre_0157(uuid,integer)',
    'public.revert_import_batch_pre_0157(uuid)',
    'public.revert_import_session_pre_0157(uuid)',
    'public.delete_invoice_scan_pre_0157(uuid)',
    'public.merge_wines_pre_0157(uuid,uuid)',
    'public.cleanup_scan_idempotency_pre_0157()'
  ] loop
    v_proc:=to_regprocedure(v_identity);
    if v_proc is null
       or has_function_privilege('anon',v_proc,'EXECUTE')
       or has_function_privilege('authenticated',v_proc,'EXECUTE')
       or has_function_privilege('service_role',v_proc,'EXECUTE')
       or exists(
         select 1 from pg_catalog.pg_proc p,
              lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl
          where p.oid=v_proc and acl.grantee=0 and acl.privilege_type='EXECUTE'
       ) then
      raise exception 'C04_0157_LEGACY_ALIAS_EXECUTABLE: %',v_identity;
    end if;
  end loop;

  v_proc:=to_regprocedure('public.dismiss_pricing_alert(uuid,integer)');
  if v_proc is null
     or pg_catalog.pg_get_function_result(v_proc)<>'timestamp with time zone'
     or to_regprocedure('public.dismiss_pricing_alert_private(uuid,integer)') is null
     or to_regprocedure('public.dismiss_pricing_alert_pre_0157(uuid,integer)') is not null then
    raise exception 'C04_0157_DISMISSAL_COEXISTENCE_MISMATCH';
  end if;

  if not has_function_privilege('authenticated','public.wine_manual_overrides_valid(text[])','EXECUTE')
     or not has_function_privilege('service_role','public.wine_manual_overrides_valid(text[])','EXECUTE')
     or not has_function_privilege('authenticated','public.wine_enrichment_metadata_valid(jsonb)','EXECUTE')
     or not has_function_privilege('service_role','public.wine_enrichment_metadata_valid(jsonb)','EXECUTE')
     or not has_function_privilege('authenticated','public.invoice_image_paths_valid(uuid,uuid,text,jsonb)','EXECUTE')
     or not has_function_privilege('service_role','public.invoice_image_paths_valid(uuid,uuid,text,jsonb)','EXECUTE') then
    raise exception 'C04_0157_CONSTRAINT_VALIDATOR_ACL_MISMATCH';
  end if;

  if not exists (
    select 1
      from pg_catalog.pg_constraint c
     where c.conrelid = 'public.wines'::regclass
       and c.conname = 'wines_manual_overrides_valid_check'
       and c.contype = 'c'
       and c.convalidated
  ) or not exists (
    select 1
      from pg_catalog.pg_constraint c
     where c.conrelid = 'public.wines'::regclass
       and c.conname = 'wines_enrichment_metadata_valid_check'
       and c.contype = 'c'
       and c.convalidated
  ) then
    raise exception 'C04_0157_METADATA_CONSTRAINT_MISSING_OR_UNVALIDATED';
  end if;
end;
$catalog_contract$;

do $validator_contract$
begin
  if not public.wine_manual_overrides_valid(
    array['drink_window', 'region', 'country', 'varietal']::text[]
  )
     or public.wine_manual_overrides_valid(array['region', 'region']::text[])
     or public.wine_manual_overrides_valid(array['colour']::text[])
     or public.wine_manual_overrides_valid(array[null]::text[]) then
    raise exception 'C04_0157_MANUAL_OVERRIDE_VALIDATOR_MISMATCH';
  end if;

  if not public.wine_enrichment_metadata_valid(
    '{"source":"rule_engine","fields_enriched":["region"],"enriched_at":"2026-09-26T12:00:00Z"}'::jsonb
  )
     or public.wine_enrichment_metadata_valid(
       '{"source":"rule_engine","fields_enriched":["region","region"],"enriched_at":"2026-09-26T12:00:00Z"}'::jsonb
     )
     or public.wine_enrichment_metadata_valid(
       '{"source":"other","fields_enriched":["region"],"enriched_at":"2026-09-26T12:00:00Z"}'::jsonb
     )
     or public.wine_enrichment_metadata_valid(
       '{"source":"rule_engine","fields_enriched":["region"],"enriched_at":"2026-09-26 12:00:00"}'::jsonb
     )
     or public.wine_enrichment_metadata_valid(
       '{"source":"rule_engine","fields_enriched":["region"],"enriched_at":"1999-12-31T23:59:59Z"}'::jsonb
     )
     or public.wine_enrichment_metadata_valid(
       '{"source":"rule_engine","fields_enriched":["region"],"enriched_at":"2100-01-01T00:00:00Z"}'::jsonb
     )
     or public.wine_enrichment_metadata_valid('[]'::jsonb)
     or public.wine_enrichment_metadata_valid(
       '{"source":"rule_engine","fields_enriched":[1],"enriched_at":"2026-09-26T12:00:00Z"}'::jsonb
     ) then
    raise exception 'C04_0157_ENRICHMENT_METADATA_VALIDATOR_MISMATCH';
  end if;
end;
$validator_contract$;

select 'C04_0157_ADDITIVE_NONCACHE_CATALOG_PASS' as evidence;
\echo C04_0157_ADDITIVE_NONCACHE_CATALOG_PASS
