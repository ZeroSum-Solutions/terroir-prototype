-- Read-only catalog/data postflight for the additive staff-cost boundary.
\set ON_ERROR_STOP on
\pset pager off

do $postflight$
declare v_identity text; v_proc oid; v_config text[]; v_owner text;
begin
  foreach v_identity in array array[
    'public.wine_manual_overrides_valid(text[])',
    'public.wine_enrichment_metadata_valid(jsonb)',
    'public.current_site_role_at_least(uuid,public.membership_role)',
    'public.read_inventory_costs(uuid,uuid[])',
    'public.read_wine_pricing_strategy(uuid,uuid[])',
    'public.read_wine_cost_flags(uuid,uuid[])',
    'public.read_restaurant_pricing_defaults(uuid)',
    'public.read_pricing_recommendations(uuid)',
    'public.read_invoice_scan_private(uuid)',
    'public.read_invoice_image_target(uuid,integer)',
    'public.read_invoice_scan_deletion_private(uuid)',
    'public.read_reconcile_action_private(uuid)',
    'public.read_identity_merge_private(uuid)',
    'public.read_import_batch_cost_rows(uuid,integer,integer)',
    'public.read_import_batch_display_rows(uuid,integer,integer)',
    'public.read_cellar_health_private(uuid,uuid[])',
    'public.set_wine_pricing_strategy(uuid,uuid,numeric,numeric)',
    'public.set_restaurant_pricing_defaults(uuid,numeric,numeric)',
    'public.dismiss_pricing_alert_private(uuid,integer)',
    'public.set_wine_overpaid_flag(uuid,uuid,boolean)',
    'public.create_inventory_item_private(uuid,uuid,integer,numeric,text,uuid,text,text,text,uuid,public.added_via)',
    'public.patch_inventory_item_private(uuid,timestamp with time zone,boolean,integer,boolean,numeric,boolean,text,boolean,uuid,boolean,text,boolean,text,boolean,text)',
    'public.delete_wine_private(uuid,uuid,timestamp with time zone)',
    'public.add_manual_overrides(uuid,text[])',
    'public.enrich_wines_batch(uuid,jsonb)',
    'public.invoice_line_items_valid(jsonb)',
    'public.invoice_edits_valid(jsonb)',
    'public.create_invoice_scan_upload(uuid,uuid,text,text,text,date)',
    'public.review_invoice_scan(uuid,timestamp with time zone,text,text,date,jsonb,jsonb)',
    'public.commit_invoice_scan(uuid)',
    'public.delete_invoice_scan(uuid)',
    'public.request_invoice_scan_reextract(uuid)',
    'public.claim_scan_idempotency(uuid,uuid,text)',
    'public.complete_scan_idempotency(uuid,uuid,text,uuid,integer,integer,uuid)',
    'public.abandon_scan_idempotency(uuid,uuid,text)',
    'public.cleanup_scan_idempotency()',
    'public.create_import_batch(uuid,uuid,text,integer,jsonb,uuid,integer,integer,text,text)',
    'public.count_import_batch_rows(uuid)',
    'public.apply_import_batch_chunk(uuid,integer)',
    'public.resolve_import_batch_row(uuid,text,numeric)',
    'public.bulk_resolve_import_batch_rows(uuid,text)',
    'public.revert_import_batch(uuid)',
    'public.revert_import_session(uuid)',
    'public.accept_reconcile_batch(uuid,jsonb,uuid)',
    'public.undo_reconcile_batch(uuid)',
    'public.merge_wines(uuid,uuid)',
    'public.invoice_image_paths_valid(uuid,uuid,text,jsonb)'
  ] loop
    v_proc:=to_regprocedure(v_identity);
    if v_proc is null then raise exception 'C04_0157_ROUTINE_MISSING: %',v_identity; end if;
    select p.proconfig,r.rolname into v_config,v_owner
      from pg_catalog.pg_proc p join pg_catalog.pg_roles r on r.oid=p.proowner
     where p.oid=v_proc and p.prosecdef;
    if not found or v_config is distinct from array['search_path=""']::text[]
       or v_owner is distinct from 'postgres' then
      raise exception 'C04_0157_ROUTINE_POSTURE_MISMATCH: % config=% owner=%',v_identity,v_config,v_owner;
    end if;
  end loop;
  foreach v_identity in array array[
    'public.read_inventory_costs(uuid,uuid[])',
    'public.read_wine_pricing_strategy(uuid,uuid[])',
    'public.read_wine_cost_flags(uuid,uuid[])',
    'public.read_restaurant_pricing_defaults(uuid)',
    'public.read_pricing_recommendations(uuid)',
    'public.read_invoice_scan_private(uuid)',
    'public.read_invoice_image_target(uuid,integer)',
    'public.read_invoice_scan_deletion_private(uuid)',
    'public.read_reconcile_action_private(uuid)',
    'public.read_identity_merge_private(uuid)',
    'public.read_import_batch_cost_rows(uuid,integer,integer)',
    'public.read_import_batch_display_rows(uuid,integer,integer)',
    'public.read_cellar_health_private(uuid,uuid[])',
    'public.set_wine_pricing_strategy(uuid,uuid,numeric,numeric)',
    'public.set_restaurant_pricing_defaults(uuid,numeric,numeric)',
    'public.dismiss_pricing_alert_private(uuid,integer)',
    'public.set_wine_overpaid_flag(uuid,uuid,boolean)',
    'public.create_inventory_item_private(uuid,uuid,integer,numeric,text,uuid,text,text,text,uuid,public.added_via)',
    'public.patch_inventory_item_private(uuid,timestamp with time zone,boolean,integer,boolean,numeric,boolean,text,boolean,uuid,boolean,text,boolean,text,boolean,text)',
    'public.delete_wine_private(uuid,uuid,timestamp with time zone)',
    'public.add_manual_overrides(uuid,text[])',
    'public.enrich_wines_batch(uuid,jsonb)',
    'public.create_invoice_scan_upload(uuid,uuid,text,text,text,date)',
    'public.review_invoice_scan(uuid,timestamp with time zone,text,text,date,jsonb,jsonb)',
    'public.commit_invoice_scan(uuid)',
    'public.delete_invoice_scan(uuid)',
    'public.request_invoice_scan_reextract(uuid)',
    'public.claim_scan_idempotency(uuid,uuid,text)',
    'public.complete_scan_idempotency(uuid,uuid,text,uuid,integer,integer,uuid)',
    'public.abandon_scan_idempotency(uuid,uuid,text)',
    'public.create_import_batch(uuid,uuid,text,integer,jsonb,uuid,integer,integer,text,text)',
    'public.count_import_batch_rows(uuid)',
    'public.apply_import_batch_chunk(uuid,integer)',
    'public.resolve_import_batch_row(uuid,text,numeric)',
    'public.bulk_resolve_import_batch_rows(uuid,text)',
    'public.revert_import_batch(uuid)',
    'public.revert_import_session(uuid)',
    'public.accept_reconcile_batch(uuid,jsonb,uuid)',
    'public.undo_reconcile_batch(uuid)',
    'public.merge_wines(uuid,uuid)'
  ] loop
    v_proc:=to_regprocedure(v_identity);
    if not has_function_privilege('authenticated',v_proc,'EXECUTE')
       or has_function_privilege('anon',v_proc,'EXECUTE')
       or has_function_privilege('service_role',v_proc,'EXECUTE')
       or exists(
         select 1 from pg_catalog.pg_proc p,
              lateral pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))) acl
          where p.oid=v_proc and acl.grantee=0 and acl.privilege_type='EXECUTE'
       ) then
      raise exception 'C04_0157_AUTHENTICATED_RPC_ACL_MISMATCH: %',v_identity;
    end if;
  end loop;
  v_proc:=to_regprocedure('public.dismiss_pricing_alert(uuid,integer)');
  if v_proc is null
     or pg_catalog.pg_get_function_result(v_proc)<>'timestamp with time zone'
     or not has_function_privilege('authenticated',v_proc,'EXECUTE')
     or to_regprocedure('public.dismiss_pricing_alert_pre_0157(uuid,integer)') is not null then
    raise exception 'C04_0157_LEGACY_DISMISSAL_COMPATIBILITY_MISMATCH';
  end if;
  foreach v_identity in array array[
    'public.wine_manual_overrides_valid(text[])',
    'public.wine_enrichment_metadata_valid(jsonb)',
    'public.invoice_image_paths_valid(uuid,uuid,text,jsonb)'
  ] loop
    v_proc:=to_regprocedure(v_identity);
    if not has_function_privilege('authenticated',v_proc,'EXECUTE')
       or not has_function_privilege('service_role',v_proc,'EXECUTE')
       or has_function_privilege('anon',v_proc,'EXECUTE')
       or exists(
         select 1 from pg_catalog.pg_proc p,
              lateral pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))) acl
          where p.oid=v_proc and acl.grantee=0 and acl.privilege_type='EXECUTE'
       ) then
      raise exception 'C04_0157_CONSTRAINT_VALIDATOR_ACL_MISMATCH: %',v_identity;
    end if;
  end loop;
  foreach v_identity in array array[
    'public.current_site_role_at_least(uuid,public.membership_role)',
    'public.invoice_line_items_valid(jsonb)',
    'public.invoice_edits_valid(jsonb)'
  ] loop
    v_proc:=to_regprocedure(v_identity);
    if has_function_privilege('authenticated',v_proc,'EXECUTE')
       or has_function_privilege('service_role',v_proc,'EXECUTE')
       or has_function_privilege('anon',v_proc,'EXECUTE')
       or exists(
         select 1 from pg_catalog.pg_proc p,
              lateral pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))) acl
          where p.oid=v_proc and acl.grantee=0 and acl.privilege_type='EXECUTE'
       ) then
      raise exception 'C04_0157_INTERNAL_ROUTINE_EXECUTABLE: %',v_identity;
    end if;
  end loop;
  v_proc:=to_regprocedure('public.cleanup_scan_idempotency()');
  if not has_function_privilege('service_role',v_proc,'EXECUTE')
     or has_function_privilege('authenticated',v_proc,'EXECUTE')
     or has_function_privilege('anon',v_proc,'EXECUTE')
     or exists(
       select 1 from pg_catalog.pg_proc p,
            lateral pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))) acl
        where p.oid=v_proc and acl.grantee=0 and acl.privilege_type='EXECUTE'
     ) then
    raise exception 'C04_0157_CLEANUP_ACL_MISMATCH';
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
       or has_function_privilege('authenticated',v_proc,'EXECUTE')
       or has_function_privilege('service_role',v_proc,'EXECUTE')
       or has_function_privilege('anon',v_proc,'EXECUTE')
       or exists(
         select 1 from pg_catalog.pg_proc p,
              lateral pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))) acl
          where p.oid=v_proc and acl.grantee=0 and acl.privilege_type='EXECUTE'
       ) then
      raise exception 'C04_0157_LEGACY_ALIAS_EXECUTABLE: %',v_identity;
    end if;
  end loop;
  if not exists(select 1 from pg_catalog.pg_attribute a
       where a.attrelid='public.scan_idempotency'::regclass and a.attname='claimed_by_user_id'
         and a.atttypid='uuid'::regtype and a.attnum>0 and not a.attisdropped)
     or not exists(select 1 from pg_catalog.pg_constraint c
       where c.conrelid='public.wines'::regclass and c.conname='wines_manual_overrides_valid_check' and c.convalidated)
     or not exists(select 1 from pg_catalog.pg_constraint c
       where c.conrelid='public.wines'::regclass and c.conname='wines_enrichment_metadata_valid_check' and c.convalidated)
     or not exists(select 1 from pg_catalog.pg_constraint c
       where c.conrelid='public.invoice_scans'::regclass and c.conname='invoice_scans_image_paths_valid_check' and c.convalidated) then
    raise exception 'C04_0157_SCHEMA_MISMATCH';
  end if;
  if exists(select 1 from public.wines w where not public.wine_manual_overrides_valid(w.manual_overrides)
     or not public.wine_enrichment_metadata_valid(w.enrichment_metadata))
     or exists(select 1 from public.invoice_scans s where not public.invoice_image_paths_valid(s.restaurant_id,s.id,s.raw_image_path,s.extra_image_paths))
     or exists(
       select 1 from public.invoice_scans s
        where s.committed_at is not null and case
          when not public.invoice_line_items_valid(s.final_line_items) then true
          else exists(select 1 from jsonb_array_elements(s.final_line_items) x(item)
                       where not (x.item?'wine_id')) end
     ) then
    raise exception 'C04_0157_VALIDATED_DATA_MISMATCH';
  end if;
end;
$postflight$;

select 'C04_0157_POSTFLIGHT' as evidence,current_database(),
       (select count(*) from public.scan_idempotency where claimed_by_user_id is not null) as actor_bound_cache_rows,
       (select count(*) from public.invoice_scans where raw_image_path is not null) as image_scans;
\echo C04_0157_PRODUCTION_POSTFLIGHT_PASS
