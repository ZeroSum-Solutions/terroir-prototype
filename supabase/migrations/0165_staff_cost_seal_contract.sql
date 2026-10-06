-- 0165_staff_cost_seal_contract.sql
-- Final direct-ACL and invoice-image read-policy cut for the source-approved
-- C04 staff-cost boundary. Apply only after the immutable compatible-app and
-- caller receipts are independently admitted. No business data is rewritten here.
-- This file owns its transaction AND ledger row; do not use an outer runner
-- that inserts another 0165 row. Receipt hashes must describe this target.
-- SQL cannot verify a deployed revision: the operator admits the external
-- immutable compatible-app/caller receipt before supplying these settings.
-- The existing local supabase_admin lane must be an unswitched superuser;
-- grants still have to reproduce postgres-owned object grantor fingerprints.

begin;
set transaction isolation level repeatable read;
set local statement_timeout = '30s';
set local lock_timeout = '5s';
set local idle_in_transaction_session_timeout = '30s';
set local search_path = pg_catalog;
set local row_security = off;

lock table public.inventory_items, public.wines, public.restaurants,
  public.pricing_recommendations, public.invoice_scans,
  public.invoice_scan_deletions, public.reconcile_actions,
  public.identity_merge_log, public.import_batch_rows, public.cellar_health,
  public.scan_idempotency in access exclusive mode nowait;
lock table supabase_migrations.schema_migrations in access exclusive mode nowait;

do $c04_0165_preflight$
declare
  v_privileged boolean;
begin
  if current_user <> session_user or current_user not in ('postgres', 'supabase_admin') then
    raise exception 'C04_0165_OPERATOR_IDENTITY_INVALID' using errcode = 'P0001';
  end if;
  select case when current_user = 'supabase_admin' then r.rolsuper
              else r.rolsuper or r.rolbypassrls end into v_privileged
    from pg_catalog.pg_roles r where r.rolname = current_user;
  if v_privileged is distinct from true then
    raise exception 'C04_0165_OPERATOR_AUTHORITY_INVALID' using errcode = 'P0001';
  end if;
  if pg_catalog.current_setting('terroir.c04_0165_traffic_quiesced', true)
       is distinct from 'on'
     or coalesce(pg_catalog.current_setting('terroir.c04_0165_compatible_app_sha', true), '')
       !~ '^[0-9a-f]{40}$'
     or coalesce(pg_catalog.current_setting('terroir.c04_0165_structural_receipt_sha256', true), '')
       !~ '^[0-9a-f]{64}$'
     or coalesce(pg_catalog.current_setting('terroir.c04_0165_history_receipt_sha256', true), '')
       !~ '^[0-9a-f]{64}$'
     or coalesce(pg_catalog.current_setting(
       'terroir.c04_0165_caller_receipt_sha256', true
     ), '') !~ '^[0-9a-f]{64}$' then
    raise exception 'C04_0165_EXTERNAL_APP_RECEIPT_REQUIRED' using errcode = 'P0001';
  end if;
  if (select pg_catalog.count(*) from supabase_migrations.schema_migrations) <> 136
     or (select pg_catalog.max(version) from supabase_migrations.schema_migrations)
       is distinct from '0164'
     or exists (
       select 1 from supabase_migrations.schema_migrations where version = '0165'
     ) then
    raise exception 'C04_0165_MIGRATION_LEDGER_INVALID' using errcode = 'P0001';
  end if;

  if pg_catalog.to_regprocedure('public.read_invoice_image_target(uuid,integer)') is null
     or pg_catalog.to_regprocedure('public.dismiss_pricing_alert_private(uuid,integer)') is null
     or pg_catalog.to_regprocedure('public.dismiss_pricing_alert(uuid,integer)') is null
     or pg_catalog.to_regprocedure('public.claim_scan_idempotency(uuid,uuid,text)') is null
     or pg_catalog.to_regprocedure('public.read_import_batch_display_rows(uuid,integer,integer)') is null then
    raise exception 'C04_0165_REQUIRED_BOUNDARY_MISSING' using errcode = 'P0001';
  end if;

  if exists (
    select 1
      from (values
        ('inventory_items'), ('wines'), ('restaurants'),
        ('pricing_recommendations'), ('invoice_scans'),
        ('invoice_scan_deletions'), ('reconcile_actions'),
        ('identity_merge_log'), ('import_batch_rows'), ('cellar_health'),
        ('scan_idempotency')
      ) expected(relation_name)
      left join pg_catalog.pg_namespace n on n.nspname = 'public'
      left join pg_catalog.pg_class c
        on c.relnamespace = n.oid and c.relname = expected.relation_name
     where c.oid is null
        or c.relkind <> 'r'
        or pg_catalog.pg_get_userbyid(c.relowner) <> 'postgres'
  ) then
    raise exception 'C04_0165_RELATION_BASELINE_INVALID' using errcode = 'P0001';
  end if;

  if not exists (
    select 1 from pg_catalog.pg_policy p
    join pg_catalog.pg_class c on c.oid = p.polrelid
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'storage' and c.relname = 'objects'
      and pg_catalog.pg_get_userbyid(c.relowner) = 'supabase_storage_admin'
      and p.polname = 'members can read invoice images'
      and p.polcmd = 'r'
      and p.polpermissive
      and p.polroles = array[(select oid from pg_catalog.pg_roles where rolname = 'authenticated')]
      and pg_catalog.pg_get_expr(p.polqual, p.polrelid, false)
        = '((bucket_id = ''invoice-images''::text) AND public.is_member(((storage.foldername(name))[1])::uuid))'
  ) then
    raise exception 'C04_0165_STORAGE_POLICY_BASELINE_INVALID' using errcode = 'P0001';
  end if;
  if not exists (
    select 1 from pg_catalog.pg_policy p
    join pg_catalog.pg_class c on c.oid = p.polrelid
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'storage' and c.relname = 'objects'
      and pg_catalog.pg_get_userbyid(c.relowner) = 'supabase_storage_admin'
      and p.polname = 'members can upload invoice images'
      and p.polcmd = 'a'
      and p.polpermissive
      and p.polroles = array[(select oid from pg_catalog.pg_roles where rolname = 'authenticated')]
      and p.polqual is null
      and pg_catalog.pg_get_expr(p.polwithcheck, p.polrelid, false)
        = '((bucket_id = ''invoice-images''::text) AND public.is_member(((storage.foldername(name))[1])::uuid))'
  ) then
    raise exception 'C04_0165_STORAGE_UPLOAD_POLICY_BASELINE_INVALID' using errcode = 'P0001';
  end if;
end;
$c04_0165_preflight$;

lock table storage.objects in access exclusive mode nowait;

do $c04_0165_locked_policy_preimage$
begin
  if not exists (
    select 1 from pg_catalog.pg_policy p
    join pg_catalog.pg_class c on c.oid = p.polrelid
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'storage' and c.relname = 'objects'
      and p.polname = 'members can read invoice images'
      and p.polcmd = 'r' and p.polpermissive
      and p.polroles = array[(select oid from pg_catalog.pg_roles where rolname = 'authenticated')]
      and pg_catalog.pg_get_expr(p.polqual, p.polrelid, false)
        = '((bucket_id = ''invoice-images''::text) AND public.is_member(((storage.foldername(name))[1])::uuid))'
  ) or not exists (
    select 1 from pg_catalog.pg_policy p
    join pg_catalog.pg_class c on c.oid = p.polrelid
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'storage' and c.relname = 'objects'
      and p.polname = 'members can upload invoice images'
      and p.polcmd = 'a' and p.polpermissive and p.polqual is null
      and p.polroles = array[(select oid from pg_catalog.pg_roles where rolname = 'authenticated')]
      and pg_catalog.pg_get_expr(p.polwithcheck, p.polrelid, false)
        = '((bucket_id = ''invoice-images''::text) AND public.is_member(((storage.foldername(name))[1])::uuid))'
  ) then
    raise exception 'C04_0165_LOCKED_STORAGE_POLICY_BASELINE_INVALID' using errcode = 'P0001';
  end if;
end;
$c04_0165_locked_policy_preimage$;

-- Frozen 0164 catalog tuples from structural receipt b5f1d7bc2307650124a1714e9c114ceb263f42bfa7f80643669a1c6bb2b64ecb.
-- Fingerprints use sorted compact JSON text arrays, joined by one newline.
do $c04_0165_catalog_admission$
declare v_hash text;
begin
  select pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
    coalesce(pg_catalog.string_agg(row_json, E'\n' order by row_json collate "C"), ''), 'UTF8'
  )), 'hex') into v_hash from (
  with targets as (
    select c.oid, c.relname, c.relowner, c.relacl
    from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname in ('inventory_items', 'wines', 'restaurants', 'pricing_recommendations', 'invoice_scans', 'invoice_scan_deletions', 'reconcile_actions', 'identity_merge_log', 'import_batch_rows', 'cellar_health', 'scan_idempotency')
  ), acl_rows as (
    select t.relname, ''::text as column_name, t.relowner, a.*
    from targets t cross join lateral pg_catalog.aclexplode(
      coalesce(t.relacl, pg_catalog.acldefault('r', t.relowner))) a
    union all
    select t.relname, c.attname::text, t.relowner, a.*
    from targets t join pg_catalog.pg_attribute c on c.attrelid = t.oid
      and c.attnum > 0 and not c.attisdropped and c.attacl is not null
    cross join lateral pg_catalog.aclexplode(c.attacl) a
  )
  select pg_catalog.array_to_json(array[
    'public', a.relname::text, a.column_name, pg_catalog.pg_get_userbyid(a.relowner),
    pg_catalog.pg_get_userbyid(a.grantor),
    case when a.grantee = 0 then 'PUBLIC' else pg_catalog.pg_get_userbyid(a.grantee) end,
    a.privilege_type, case when a.is_grantable then 't' else 'f' end
  ]::text[])::text as row_json from acl_rows a
  ) captured;
  -- Admit only the original D/CI preimage or the one measured hosted preimage.
  -- Caller settings cannot choose a baseline: this catalog comparison owns it.
  if v_hash = 'd76bb2eee2068723c227accaa0fc2385f89816ba3145521581c796259ed8b2cd' then
    perform pg_catalog.set_config('terroir.c04_0165_hosted_baseline', 'off', true);
  elsif v_hash = 'a8a92931df21d2d4e7e114389351e73453b0c8b02564539cd022e07ec953423f' then
    perform pg_catalog.set_config('terroir.c04_0165_hosted_baseline', 'on', true);
  else
    raise exception 'C04_0165_FULL_RELATION_ACL_DRIFT' using errcode = 'P0001',
      detail = 'C04_0165_AUTHENTICATED_ACL_BASELINE_INVALID';
  end if;
  if exists (
    with expected(signature, definition_sha256, grantees) as (values
      ('public.abandon_scan_idempotency(uuid,uuid,text)', '19868e4a479cd9b41c9d108923ba147815e4a53c30b8f530c0dc1e0f6b57c33b', array['authenticated', 'postgres']::text[]),
      ('public.accept_reconcile_batch(uuid,jsonb,uuid)', '7222617de9f7440a0e4e579c94a2eb85ea85387d7c5efffc26b8d38ebe5b187d', array['authenticated', 'postgres']::text[]),
      ('public.add_manual_overrides(uuid,text[])', '0b188ec60084d9776ff908782f3bafbccbc10c21884f83f823606da138d7eadb', array['authenticated', 'postgres']::text[]),
      ('public.apply_import_batch_chunk(uuid,integer)', '00aa08b2c6968e5b34df44ccc20bffdf0a9be8c4ab9c6603083277c57593ffab', array['authenticated', 'postgres']::text[]),
      ('public.assign_wine_sections_private(uuid,uuid[],text)', 'c44a69ab56540c8b5d982849c57f489b62bde3d29faab18a39b44485db724cde', array['authenticated', 'postgres']::text[]),
      ('public.bulk_resolve_import_batch_rows(uuid,text)', 'd2c8d853eada81255ac286e1ed6ba8574b7ed2b22d074038d2bf77f5dfc197fe', array['authenticated', 'postgres']::text[]),
      ('public.claim_invoice_extract_job(text)', 'aeb478c1132c6a23556f02ba532ac50fe20c20dbca7eb98d7da675d78ff38ad0', array['postgres', 'service_role']::text[]),
      ('public.claim_scan_idempotency(uuid,uuid,text)', '4072266c12ba053e35eeab3c94b6bc269a4734e308b0ca52290f58025397210c', array['authenticated', 'postgres']::text[]),
      ('public.cleanup_scan_idempotency()', 'a7719119e439d97a85db423cf25fcceffaf74f8fc10ed449c46e0467986a86f4', array['postgres', 'service_role']::text[]),
      ('public.commit_invoice_scan(uuid)', '10fc0c841b6baa2953c09e6364424cbf2d847c1470ab080c038859d0a83ad054', array['authenticated', 'postgres']::text[]),
      ('public.complete_scan_idempotency(uuid,uuid,text,uuid,integer,integer,uuid)', 'cbd6b5b4147b37992ba52d428b0ab24babff7035ba870ce57623b7374e545656', array['authenticated', 'postgres']::text[]),
      ('public.count_import_batch_rows(uuid)', 'edb4c231e87324c54832b98654b2cdf4a30ed0d45c74e499a80cb4aa226b000e', array['authenticated', 'postgres']::text[]),
      ('public.create_import_batch(uuid,uuid,text,integer,jsonb,uuid,integer,integer,text,text)', 'df8487e06bf635bddcc042d1bcfdd75bc83e52b820ca2e8da37f6934bb92e6e8', array['authenticated', 'postgres']::text[]),
      ('public.create_inventory_item_private(uuid,uuid,integer,numeric,text,uuid,text,text,text,uuid,public.added_via)', '2909ac0b15d7dbcdbe771718e7f3da454d55bcb0895674d7fd72f4ce9e6b109d', array['authenticated', 'postgres']::text[]),
      ('public.create_invoice_scan_upload(uuid,uuid,text,text,text,date)', '9e82c6aea3e76f37b7905d3f39c0b0eeb911f87e05bdf7af3cc61441cc26a308', array['authenticated', 'postgres']::text[]),
      ('public.current_inventory_contract_version()', '5898b9c5d5d9ed81487617ded9fb61014522b9ed21bbd5d5aa164061ac6cb2e6', array['authenticated', 'postgres']::text[]),
      ('public.current_site_role_at_least(uuid,public.membership_role)', '417509ed348fb8317a8671107adc5d4ccbaa53a78f37c5cbf31e0cd154dd3c21', array['postgres']::text[]),
      ('public.delete_invoice_scan(uuid)', 'b64d58fe4d7e566be07f2b6e4f059647100de917a1b378215889957381cd02f6', array['authenticated', 'postgres']::text[]),
      ('public.delete_wine_private(uuid,uuid,timestamp with time zone)', '9b1d94188b5dddd20889110396f7321a281080e43a4aa06b9951c6fbbb2eafc2', array['authenticated', 'postgres']::text[]),
      ('public.dismiss_pricing_alert_private(uuid,integer)', '969c9e06cbac0f9a407af092bb58aa308971782a3a4922413377e8893e6b0ad4', array['authenticated', 'postgres']::text[]),
      ('public.dismiss_pricing_alert(uuid,integer)', '3a58676d2ecb283c4afa712cf6161f7dba825e3f0c9663fcb9dfc6a7531b245b', array['PUBLIC', 'postgres']::text[]),
      ('public.effective_site_capability(uuid,text)', 'ba90e657b84892fe24e00c87c96c5c0d61d02d4956211c657201b2a7ed3e17fb', array['authenticated', 'postgres']::text[]),
      ('public.effective_site_ids(text)', '2d14aecc5dc0d563c42f20f98ee07f8d92c3eb4bcb52690b052ad5b2256fa7dc', array['authenticated', 'postgres']::text[]),
      ('public.enqueue_invoice_extract_job(uuid,uuid)', '5ac88c60315d46ca8ca102b9ad983be21201d7603c55e3fc6b356cd49e3f3b9b', array['authenticated', 'postgres']::text[]),
      ('public.enrich_wines_batch(uuid,jsonb)', 'a785b1a41d1a4e55a3604058fbc252cd59394fbdf2773b73993181b765955658', array['authenticated', 'postgres']::text[]),
      ('public.expire_stalled_invoice_scans(uuid)', 'a02c02e8b441230aa38ff336f86e2c7637b7c1c297c82227aa3f4dae1fb1bb9b', array['authenticated', 'postgres']::text[]),
      ('public.invoice_edits_valid(jsonb)', 'bf491cf8d8749961bad6cf5d79fff3b636299a35350275b6408eeb8c37e503f4', array['postgres']::text[]),
      ('public.invoice_image_paths_valid(uuid,uuid,text,jsonb)', '782bf227fad7bfbb39e70b4b466c02b4f4bbf772e5fb5a634ab35cc829060f53', array['authenticated', 'postgres', 'service_role']::text[]),
      ('public.invoice_line_items_valid(jsonb)', '14fa666068165ba7e56c9e975b95637cc43087efce23ef2e5899fadd3221c7ee', array['postgres']::text[]),
      ('public.merge_wines(uuid,uuid)', '67d17b5d5d091fa2c7495c39552cc47074b4fbc1b5e108bf46ec00dd19a7ce63', array['authenticated', 'postgres']::text[]),
      ('public.mirror_bin_code_to_inventory_items()', '0b3abc25c95d636b8d460d9585fb512a92f49757921f82f1fbb37e329da8124f', array['postgres']::text[]),
      ('public.patch_inventory_item_private(uuid,timestamp with time zone,boolean,integer,boolean,numeric,boolean,text,boolean,uuid,boolean,text,boolean,text,boolean,text)', '0683075e50e26e1081bac9c4d8b79658f14cbcb1ffaa06c326c9284afb77c5d7', array['authenticated', 'postgres']::text[]),
      ('public.read_cellar_health_private(uuid,uuid[])', '8b024de11c7ba70bf966c837e8ce01919c39ea0a7c7e49d6f797e0f79cd7345a', array['authenticated', 'postgres']::text[]),
      ('public.read_current_operational_memberships(uuid)', 'dfb8579fc556d2452ae22adba63ef3088bae0f9015c0ddd8ed48128b5682801d', array['authenticated', 'postgres']::text[]),
      ('public.read_identity_merge_private(uuid)', '14d8d116468407934a282681accaf13d849c130f48b3efb8ec9e886134cf51ad', array['authenticated', 'postgres']::text[]),
      ('public.read_import_batch_cost_rows(uuid,integer,integer)', 'ce87c85a3306b9849599bc1745decd264fbd139db78942376a2a4d6adac9cb5e', array['authenticated', 'postgres']::text[]),
      ('public.read_import_batch_display_rows(uuid,integer,integer)', 'b28f41c8a6f2456003606987cf93910ccd61fe2a2ca40fd21e25e5154fa63c51', array['authenticated', 'postgres']::text[]),
      ('public.read_inventory_costs(uuid,uuid[])', 'fb079bf12d27f6a8f428efee9c582642e66b8a2073f25c0ea5b36e6ece2d15d9', array['authenticated', 'postgres']::text[]),
      ('public.read_invoice_image_target(uuid,integer)', 'e2d08429a6b596d9398e735619559de72c7a721565433e4435a70912b44dc4cd', array['authenticated', 'postgres']::text[]),
      ('public.read_invoice_scan_deletion_private(uuid)', 'aed40799e0d0336b978bf39ce524d4fd0d8961b2b3eced8de022c75137d2dfea', array['authenticated', 'postgres']::text[]),
      ('public.read_invoice_scan_private(uuid)', 'ac9902982db511cd6f40ffe071eebaf857185e7194832348db3e7bdbb7ba07dd', array['authenticated', 'postgres']::text[]),
      ('public.read_pricing_recommendations(uuid)', '42116ffeb0ed148f5ea5b10b26acf0fa48d40bdd8f77b4aedad7d035113c6d9b', array['authenticated', 'postgres']::text[]),
      ('public.read_reconcile_action_private(uuid)', '3fbc77af972fce6be95442315d4aa5276be1b01df72aebd25f31fcd9cd170ca8', array['authenticated', 'postgres']::text[]),
      ('public.read_restaurant_pricing_defaults(uuid)', 'f36c2010ea6230e70404b7ed6f6d8743089d21058a59d37a45f600b474f570d8', array['authenticated', 'postgres']::text[]),
      ('public.read_wine_cost_flags(uuid,uuid[])', '353cfa564326324f0e8f9b9a4c428149329b1e771c190f31cc476a896ab2d0e6', array['authenticated', 'postgres']::text[]),
      ('public.read_wine_pricing_strategy(uuid,uuid[])', 'a967eaf8316c0d5e464547b6e2d6defc261232a5194dd560eb2f6f09c1997db4', array['authenticated', 'postgres']::text[]),
      ('public.receive_bottle_at_location_private(uuid,uuid,uuid,text,uuid)', '31c4a0c6efcf721a087156009180e70d7d5dc99d0860ab319183d74f523a16c1', array['authenticated', 'postgres']::text[]),
      ('public.reclaim_stuck_invoice_extract_jobs(integer)', 'f1e6a13067a346672d03ab6b9a6b319e8c8c432e80043d508b8195d251e971a5', array['postgres', 'service_role']::text[]),
      ('public.request_invoice_scan_reextract(uuid)', '1f345ab5f150b506f0f14bfd61434302e7c91fa25b3be9bb07c80d8245d2dec2', array['authenticated', 'postgres']::text[]),
      ('public.resolve_import_batch_row(uuid,text,numeric)', 'cb93a65b4d8a5e16b0918e577884d44f10ff04c43e90c21ca48942ec73be96f2', array['authenticated', 'postgres']::text[]),
      ('public.revert_import_batch_core_private(uuid,uuid[])', 'e13f22d4254e056c92c6cfd475d255cc35b52386b97feb54d239967205ea4a02', array['postgres']::text[]),
      ('public.revert_import_batch_private(uuid)', '028d7f870987625ce254303e2a02c6ef362e5b4363ebd46dbe887d3082ae4088', array['authenticated', 'postgres']::text[]),
      ('public.revert_import_batch(uuid)', '7beb1e2b6e3c01c01b3d4eb45324469688dd7dc63e54e0315029bdb45f83c285', array['authenticated', 'postgres']::text[]),
      ('public.revert_import_session(uuid)', '2c77c68620352cc7c1f4655f6aa7b7c7fd1960487b9bac80c540630177accac9', array['authenticated', 'postgres']::text[]),
      ('public.review_invoice_scan(uuid,timestamp with time zone,text,text,date,jsonb,jsonb)', '381fb4db77e0441bb6070bfe6c18cca47ffd8e28f314eb242af197b2cc1006a4', array['authenticated', 'postgres']::text[]),
      ('public.save_bottle_inventory_private(uuid,uuid,text,text,integer,text,text,text,text,integer,numeric)', 'b39aaa105b186ae14b879b91a512297cf884a4352a427cf0a5b932fa1d8b95da', array['authenticated', 'postgres']::text[]),
      ('public.set_restaurant_pricing_defaults(uuid,numeric,numeric)', '11930a20c1d8cce6b1f6b7564c570fb12616899507b92203d00fea3dc1e5611c', array['authenticated', 'postgres']::text[]),
      ('public.set_wine_overpaid_flag(uuid,uuid,boolean)', 'dd71644d40c44f79c7a8db2bb767cce815a80db5cd5ac259bf355d9ebed4760d', array['authenticated', 'postgres']::text[]),
      ('public.set_wine_pricing_strategy(uuid,uuid,numeric,numeric)', 'a14d69c3c4e1dc53a98e8dbf9004d2382f5c5651e2499fca858aae13fd6fc7d7', array['authenticated', 'postgres']::text[]),
      ('public.undo_reconcile_batch(uuid)', '5bb6bd5585ba7b67895f01717fb039ffe4163c836cbfd9fdf4f6b0586bc58071', array['authenticated', 'postgres']::text[]),
      ('public.wine_enrichment_metadata_valid(jsonb)', '9b0471b5138c5a0d266192d415ded210db54072336e928aecbb125a032a8e649', array['authenticated', 'postgres', 'service_role']::text[]),
      ('public.wine_manual_overrides_valid(text[])', '768ff4923f2a861ed7292769c8ad5fde70ccc05117f2e457d41042050634b6bc', array['authenticated', 'postgres', 'service_role']::text[])
    ), resolved as (
      select e.signature, e.definition_sha256,
        case when pg_catalog.current_setting('terroir.c04_0165_hosted_baseline', true) = 'on'
          and e.signature in ('public.claim_invoice_extract_job(text)',
            'public.reclaim_stuck_invoice_extract_jobs(integer)',
            'public.enqueue_invoice_extract_job(uuid,uuid)')
          then array['anon', 'authenticated', 'postgres', 'service_role']::text[]
        when pg_catalog.current_setting('terroir.c04_0165_hosted_baseline', true) = 'on'
          and e.signature = 'public.dismiss_pricing_alert(uuid,integer)'
          then array['PUBLIC', 'anon', 'authenticated', 'postgres', 'service_role']::text[]
        else e.grantees end as grantees,
        p.oid, p.proname, p.proowner, p.prokind, p.proacl
      from expected e left join pg_catalog.pg_proc p
      on p.oid = pg_catalog.to_regprocedure(e.signature)
    )
    select 1 from resolved r
    where r.oid is null or r.proowner <> pg_catalog.to_regrole('postgres') or r.prokind <> 'f'
      or pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
        pg_catalog.pg_get_functiondef(r.oid), 'UTF8')), 'hex') <> r.definition_sha256
      or array(select case when a.grantee = 0 then 'PUBLIC'
          else pg_catalog.pg_get_userbyid(a.grantee)::text end
        from pg_catalog.aclexplode(coalesce(r.proacl, pg_catalog.acldefault('f', r.proowner))) a
        order by (case when a.grantee = 0 then 'PUBLIC'
          else pg_catalog.pg_get_userbyid(a.grantee) end) collate "C") <> r.grantees
      or exists (
        select 1 from pg_catalog.aclexplode(coalesce(r.proacl, pg_catalog.acldefault('f', r.proowner))) a
        where a.grantor <> pg_catalog.to_regrole('postgres') or a.is_grantable
          or a.privilege_type <> 'EXECUTE'
      )
      or exists (
        select 1 from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = r.proname
          and not exists (select 1 from resolved admitted where admitted.oid = p.oid)
      )
  ) then
    raise exception 'C04_0165_ROUTINE_DEPENDENCY_DRIFT' using errcode = 'P0001';
  end if;
  if exists (
    with expected(relation_name, constraint_name, constraint_type, definition_sha256) as (values
      ('background_jobs', 'background_jobs_attempt_window', 'c', '4fbad9b056940bf3916eb0392ca26776c5a298c72906b7e940fdff5d95e07166'),
      ('background_jobs', 'background_jobs_job_type_check', 'c', '067ffb3d13ff4ec6a287523e8ce9007b2c8fd22032390fdfa35dd27f2eb0f483'),
      ('background_jobs', 'background_jobs_status_check', 'c', 'a3543a9b48beb3fe479f6a8c08cbc6099aca913ce65a6e9c4b2e72fbd7fc9a61'),
      ('invoice_scans', 'invoice_scans_image_paths_valid_check', 'c', 'c0fc7187a3c97149d99fe06228384627019c860b7966b27363d2734eeedbda51'),
      ('scan_idempotency', 'scan_idempotency_pkey', 'p', 'a4ead6746766b1dfbedce39f875b7005601651248a496f375f33e7f70c973b65'),
      ('wines', 'wines_enrichment_metadata_valid_check', 'c', '72fe9823fcc2ba003214d62b9d63fd25e6fafbc6601f5b3c4711037da2012005'),
      ('wines', 'wines_manual_overrides_valid_check', 'c', '857d6bbea8a2fcc814be21aa11c93fbb26cc3dd857c241a8263ea22b45618508')
    )
    select 1 from expected e
    left join pg_catalog.pg_constraint c
      on c.conrelid = pg_catalog.to_regclass('public.' || e.relation_name)
      and c.conname = e.constraint_name
    where c.oid is null or c.contype::text <> e.constraint_type
      or not c.convalidated or c.condeferrable or c.condeferred
      or pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
        pg_catalog.pg_get_constraintdef(c.oid, true), 'UTF8')), 'hex') <> e.definition_sha256
  ) then
    raise exception 'C04_0165_CONSTRAINT_DEPENDENCY_DRIFT' using errcode = 'P0001';
  end if;
  if (select pg_catalog.count(*) from pg_catalog.pg_class c
      join pg_catalog.pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname in ('inventory_items', 'wines', 'restaurants', 'pricing_recommendations', 'invoice_scans', 'invoice_scan_deletions', 'reconcile_actions', 'identity_merge_log', 'import_batch_rows', 'cellar_health', 'scan_idempotency')
        and c.relkind = 'r' and c.relowner = pg_catalog.to_regrole('postgres')
        and c.relrowsecurity and not c.relforcerowsecurity) <> 11
    or exists (
      select 1 from pg_catalog.pg_depend d join pg_catalog.pg_class seq on seq.oid = d.objid
      join pg_catalog.pg_class c on c.oid = d.refobjid
      join pg_catalog.pg_namespace n on n.oid = c.relnamespace
      where d.classid = 'pg_catalog.pg_class'::pg_catalog.regclass
        and d.refclassid = 'pg_catalog.pg_class'::pg_catalog.regclass and d.deptype in ('a', 'i')
        and seq.relkind = 'S' and n.nspname = 'public' and c.relname in ('inventory_items', 'wines', 'restaurants', 'pricing_recommendations', 'invoice_scans', 'invoice_scan_deletions', 'reconcile_actions', 'identity_merge_log', 'import_batch_rows', 'cellar_health', 'scan_idempotency')
    ) then
    raise exception 'C04_0165_RELATION_OR_SEQUENCE_DRIFT' using errcode = 'P0001';
  end if;
  if not exists (
    select 1 from storage.buckets b where b.id = 'invoice-images' and b.name = 'invoice-images'
      and b.public is false and b.file_size_limit = 20971520
      and b.allowed_mime_types = case when pg_catalog.current_setting('terroir.c04_0165_hosted_baseline', true) = 'on'
        then array['image/jpeg','image/png','image/webp','image/gif','application/pdf']::text[]
        else array['image/jpeg','image/png','image/heic','image/heif','application/pdf']::text[] end
  ) then
    raise exception 'C04_0165_INVOICE_BUCKET_DRIFT' using errcode = 'P0001';
  end if;
  select pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
    coalesce(pg_catalog.string_agg(row_json, E'\n' order by row_json collate "C"), ''), 'UTF8'
  )), 'hex') into v_hash from (
  select pg_catalog.array_to_json(array[
    n.nspname::text, c.relname::text, pg_catalog.pg_get_userbyid(c.relowner),
    case when c.relrowsecurity then 't' else 'f' end,
    case when c.relforcerowsecurity then 't' else 'f' end,
    p.polname::text, case when p.polpermissive then 't' else 'f' end,
    p.polcmd::text,
    array(select case when r.role_oid = 0 then 'PUBLIC'
      else pg_catalog.pg_get_userbyid(r.role_oid) end
      from pg_catalog.unnest(p.polroles) r(role_oid)
      order by 1)::text,
    coalesce(pg_catalog.pg_get_expr(p.polqual, p.polrelid, false), ''),
    coalesce(pg_catalog.pg_get_expr(p.polwithcheck, p.polrelid, false), '')
  ]::text[])::text as row_json
  from pg_catalog.pg_policy p join pg_catalog.pg_class c on c.oid = p.polrelid
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'storage' and c.relname = 'objects'
  ) captured;
  if v_hash is distinct from (case when pg_catalog.current_setting('terroir.c04_0165_hosted_baseline', true) = 'on'
    then 'bd884801329f87ec2d757a091fc3e5474e2862f13db5a402c0fcd333e7f5b7e6' else 'e1fe621ce2259ec98853b54e0e94a051b4915313573a5cef2fcb38c9029c4b0f' end) then
    raise exception 'C04_0165_FULL_STORAGE_POLICY_DRIFT' using errcode = 'P0001';
  end if;
end;
$c04_0165_catalog_admission$;

-- Hosted postgres policy DDL is delegated by the registered, non-session-settable
-- supautils.policy_grants utility hook; LOCK TABLE itself uses normal privileges.
-- Official source: supabase/supautils 2bf495db5dfc212896a75045abfe991ee70c4075,
-- src/table_grants.c and src/supautils.c. Keep the effective owner lane for D.
do $c04_0165_storage_authority$
begin
  if not exists (
    select 1 from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'storage' and c.relname = 'objects'
      and pg_catalog.pg_get_userbyid(c.relowner) = 'supabase_storage_admin'
      and (
        pg_catalog.pg_has_role(current_user, c.relowner, 'USAGE')
        or (
          pg_catalog.current_setting('terroir.c04_0165_hosted_baseline', true) = 'on'
          and current_user = 'postgres' and session_user = 'postgres'
          and pg_catalog.has_schema_privilege(current_user, n.oid, 'USAGE')
          and pg_catalog.has_table_privilege(
            current_user, c.oid, 'MAINTAIN,UPDATE,DELETE,TRUNCATE'
          )
          and exists (
            select 1 from pg_catalog.pg_settings s
            where s.name = 'session_preload_libraries' and s.context = 'superuser'
              and s.source = 'configuration file' and s.setting = 'supautils'
          )
          and exists (
            select 1 from pg_catalog.pg_settings s
            where s.name = 'supautils.policy_grants'
              and s.context = 'sighup' and s.source = 'configuration file'
              and (s.setting::jsonb -> 'postgres') @> '["storage.objects"]'::jsonb
          )
          and exists (
            select 1 from pg_catalog.pg_settings s
            join pg_catalog.pg_roles r on r.rolname = s.setting
            where s.name = 'supautils.superuser' and s.context = 'sighup'
              and s.setting = 'supabase_admin' and r.rolsuper
          )
        )
      )
  ) then
    raise exception 'C04_0165_STORAGE_POLICY_DDL_AUTHORITY_MISSING' using errcode = 'P0001';
  end if;
end;
$c04_0165_storage_authority$;

-- Admit validator definitions before invoking them as the privileged operator.
do $c04_0165_locked_history_admission$
begin
  if exists (
    select 1 from public.wines w
     where not public.wine_manual_overrides_valid(w.manual_overrides)
        or not public.wine_enrichment_metadata_valid(w.enrichment_metadata)
  ) then
    raise exception 'C04_0165_WINE_METADATA_HISTORY_INVALID' using errcode = 'P0001';
  end if;
  if exists (
    select 1 from public.invoice_scans s
     where not public.invoice_image_paths_valid(
       s.restaurant_id, s.id, s.raw_image_path, s.extra_image_paths
     )
  ) then
    raise exception 'C04_0165_INVOICE_PATH_HISTORY_INVALID' using errcode = 'P0001';
  end if;
  if exists (
    select 1 from public.scan_idempotency c
     where c.created_at >= statement_timestamp() - interval '24 hours'
       and (
         c.claimed_by_user_id is null
         or (
           (c.response_status is null and c.response_body in (
             pg_catalog.jsonb_build_object(
               'version', 1, 'kind', 'invoice_scan_upload', 'status', 'claimed'
             ),
             pg_catalog.jsonb_build_object(
               'version', 1, 'kind', 'invoice_inventory_save', 'status', 'claimed'
             ),
             pg_catalog.jsonb_build_object(
               'version', 1, 'kind', 'bottle_inventory_save', 'status', 'claimed'
             )
           ))
           or (c.response_status = 202
             and pg_catalog.jsonb_typeof(c.response_body) = 'object'
             and (select pg_catalog.count(*) from pg_catalog.jsonb_object_keys(c.response_body)) = 5
             and c.response_body @> '{"version":1,"kind":"invoice_scan_upload","status":"queued","itemCount":0}'::pg_catalog.jsonb
             and pg_catalog.jsonb_typeof(c.response_body->'scanId') = 'string'
             and exists (
               select 1 from public.invoice_scans s
                where s.id::text = c.response_body->>'scanId'
                  and s.restaurant_id = c.restaurant_id
             ))
           or (c.response_status = 200
             and pg_catalog.jsonb_typeof(c.response_body) = 'object'
             and (select pg_catalog.count(*) from pg_catalog.jsonb_object_keys(c.response_body)) = 6
             and c.response_body @> '{"version":1,"kind":"invoice_inventory_save","status":"committed"}'::pg_catalog.jsonb
             and pg_catalog.jsonb_typeof(c.response_body->'scanId') = 'string'
             and pg_catalog.jsonb_typeof(c.response_body->'itemCount') = 'number'
             and pg_catalog.jsonb_typeof(c.response_body->'wineCount') = 'number'
             and (c.response_body->>'itemCount') ~ '^[0-9]+$'
             and (c.response_body->>'wineCount') ~ '^[0-9]+$'
             and (c.response_body->>'itemCount')::numeric between 0 and 500
             and (c.response_body->>'wineCount')::numeric between 0
               and (c.response_body->>'itemCount')::numeric
             and exists (
               select 1 from public.invoice_scans s
                where s.id::text = c.response_body->>'scanId'
                  and s.restaurant_id = c.restaurant_id
             ))
           or (c.response_status = 200
             and pg_catalog.jsonb_typeof(c.response_body) = 'object'
             and (select pg_catalog.count(*) from pg_catalog.jsonb_object_keys(c.response_body)) = 5
             and c.response_body @> '{"version":1,"kind":"bottle_inventory_save","status":"committed","itemCount":1}'::pg_catalog.jsonb
             and pg_catalog.jsonb_typeof(c.response_body->'wineId') = 'string'
             and exists (
               select 1 from public.wines w
                where w.id::text = c.response_body->>'wineId'
                  and w.restaurant_id = c.restaurant_id
             ))
         ) is distinct from true
       )
  ) then
    raise exception 'C04_0165_ACTIVE_RETRY_CACHE_HISTORY_INVALID' using errcode = 'P0001';
  end if;
end;
$c04_0165_locked_history_admission$;

revoke all privileges on table
  public.inventory_items, public.wines, public.restaurants,
  public.pricing_recommendations, public.invoice_scans,
  public.invoice_scan_deletions, public.reconcile_actions,
  public.identity_merge_log, public.import_batch_rows, public.cellar_health,
  public.scan_idempotency
from authenticated;

grant select (
  added_at, added_via, bin_id, bin_location, currency, format, id,
  invoice_scan_id, quantity, restaurant_id, section, updated_at, wine_id
) on public.inventory_items to authenticated;

grant select (
  alert_snoozed_until, canonical_wine_id, colour, country, created_at,
  decant_minutes, drink_window_basis, drink_window_end, drink_window_set_at,
  drink_window_set_by, drink_window_start, eightysixed_at, eightysixed_by,
  enrichment_metadata, hero_image_url, id, is_eightysixed, last_enriched_at,
  lineage_id, lwin_id, lwin_match_score, manual_overrides, name, peak_year,
  producer, rating, rating_source, region, restaurant_id, retail_max,
  retail_median, retail_min, retail_refreshed_at, retail_retailer_count,
  review_excerpt, serving_temp_label, serving_temp_max, serving_temp_min,
  size_ml, tasting_notes, updated_at, varietal, vintage, wine_variant_id
) on public.wines to authenticated;

grant select (
  auto_eightysix_from_inventory, created_at, eightysix_ml_threshold,
  eightysix_strategy, id, logo_url, name, updated_at, workspace_id,
  workspace_kind
) on public.restaurants to authenticated;

grant select (
  accuracy_score, committed_at, created_at, created_by, distributor_name, id,
  invoice_date, invoice_number, item_count, restaurant_id, status,
  status_reason, updated_at
) on public.invoice_scans to authenticated;

grant select (
  bottles_removed, deleted_at, deleted_by, distributor_name, id,
  inventory_rows_deleted, invoice_number, invoice_scan_id, item_count,
  restaurant_id, scan_status
) on public.invoice_scan_deletions to authenticated;

grant select (
  action_type, batch_id, created_at, id, ordinal, restaurant_id, subject_id,
  subject_table
) on public.reconcile_actions to authenticated;

grant select (
  id, merge_type, merged_at, merged_by, moved_counts, restaurant_id,
  source_id, target_id
) on public.identity_merge_log to authenticated;

grant select (
  applied_inventory_item_id, applied_wine_id, apply_attempts, apply_status,
  batch_id, cost_status, created_at, duplicate_reason, id, lwin_id,
  lwin_score, lwin_status, resolution, resolved_at, resolved_by,
  restaurant_id, row_number, row_state, updated_at
) on public.import_batch_rows to authenticated;

grant select (computed_at, id, restaurant_id, wine_id)
  on public.cellar_health to authenticated;

grant insert (
  alert_snoozed_until, canonical_wine_id, colour, country, decant_minutes,
  drink_window_basis, drink_window_end, drink_window_set_at,
  drink_window_set_by, drink_window_start, eightysixed_at, eightysixed_by,
  hero_image_url, id, is_eightysixed, last_enriched_at, lineage_id, lwin_id,
  lwin_match_score, name, peak_year, producer, rating, rating_source, region,
  restaurant_id, retail_max, retail_median, retail_min, retail_refreshed_at,
  retail_retailer_count, review_excerpt, serving_temp_label,
  serving_temp_max, serving_temp_min, size_ml, tasting_notes, varietal,
  vintage, wine_variant_id
) on public.wines to authenticated;

grant update (
  alert_snoozed_until, canonical_wine_id, colour, country, decant_minutes,
  drink_window_basis, drink_window_end, drink_window_set_at,
  drink_window_set_by, drink_window_start, eightysixed_at, eightysixed_by,
  hero_image_url, is_eightysixed, last_enriched_at, lineage_id, lwin_id,
  lwin_match_score, name, peak_year, producer, rating, rating_source, region,
  retail_max, retail_median, retail_min, retail_refreshed_at,
  retail_retailer_count, review_excerpt, serving_temp_label,
  serving_temp_max, serving_temp_min, size_ml, tasting_notes, updated_at,
  varietal, vintage, wine_variant_id
) on public.wines to authenticated;

grant insert (
  auto_eightysix_from_inventory, eightysix_ml_threshold, eightysix_strategy,
  id, logo_url, name, workspace_id, workspace_kind
) on public.restaurants to authenticated;
grant update (
  auto_eightysix_from_inventory, eightysix_ml_threshold, eightysix_strategy,
  logo_url, name, updated_at
) on public.restaurants to authenticated;

revoke execute on function public.dismiss_pricing_alert(uuid,integer)
  from public, anon, authenticated, service_role;

drop policy "members can read invoice images" on storage.objects;
create policy "members can read invoice images"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'invoice-images'
    and name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(_page[1-8])?[.](jpg|jpeg|png|heic|heif|pdf)$'
    and exists (
      select 1
        from public.read_invoice_image_target(
          substring(name from '^[^/]+/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})')::uuid,
          coalesce(substring(name from '_page([1-8])[.]')::integer - 1, 0)
        ) target
       where target.object_name = name
    )
  );

drop policy "members can upload invoice images" on storage.objects;
create policy "members can upload invoice images"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'invoice-images'
    and name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(_page[1-8])?[.](jpg|jpeg|png|heic|heif|pdf)$'
    and exists (
      select 1
        from public.read_current_operational_memberships((select auth.uid())) member
       where member.restaurant_id = ((storage.foldername(name))[1])::uuid
    )
  );

do $c04_0165_postflight$
declare v_hash text;
begin
  select pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
    coalesce(pg_catalog.string_agg(row_json, E'\n' order by row_json collate "C"), ''), 'UTF8'
  )), 'hex') into v_hash from (
  with targets as (
    select c.oid, c.relname, c.relowner, c.relacl
    from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname in ('inventory_items', 'wines', 'restaurants', 'pricing_recommendations', 'invoice_scans', 'invoice_scan_deletions', 'reconcile_actions', 'identity_merge_log', 'import_batch_rows', 'cellar_health', 'scan_idempotency')
  ), acl_rows as (
    select t.relname, ''::text as column_name, t.relowner, a.*
    from targets t cross join lateral pg_catalog.aclexplode(
      coalesce(t.relacl, pg_catalog.acldefault('r', t.relowner))) a
    union all
    select t.relname, c.attname::text, t.relowner, a.*
    from targets t join pg_catalog.pg_attribute c on c.attrelid = t.oid
      and c.attnum > 0 and not c.attisdropped and c.attacl is not null
    cross join lateral pg_catalog.aclexplode(c.attacl) a
  )
  select pg_catalog.array_to_json(array[
    'public', a.relname::text, a.column_name, pg_catalog.pg_get_userbyid(a.relowner),
    pg_catalog.pg_get_userbyid(a.grantor),
    case when a.grantee = 0 then 'PUBLIC' else pg_catalog.pg_get_userbyid(a.grantee) end,
    a.privilege_type, case when a.is_grantable then 't' else 'f' end
  ]::text[])::text as row_json from acl_rows a
  ) captured;
  if v_hash is distinct from (case when pg_catalog.current_setting('terroir.c04_0165_hosted_baseline', true) = 'on'
    then '453a8013bb768e7e83a98905a6dbdfcc2b729a7413aab48d4b7565a1640649aa' else 'e6a44f7cf6a3d23a391db720c9707fb9fe749ec1bdda0fdd7dfdd125b22e44fd' end) then
    raise exception 'C04_0165_FULL_CONTRACT_ACL_DRIFT' using errcode = 'P0001';
  end if;
  if (select pg_catalog.count(*) from pg_catalog.pg_policy
      where polrelid = 'storage.objects'::pg_catalog.regclass) <> (case
        when pg_catalog.current_setting('terroir.c04_0165_hosted_baseline', true) = 'on' then 6 else 5 end)
    or exists (
      select 1 from pg_catalog.pg_policy p
      where p.polrelid = 'storage.objects'::pg_catalog.regclass
        and (not p.polpermissive
          or p.polroles <> array[pg_catalog.to_regrole('authenticated')]::oid[])
    ) then
    raise exception 'C04_0165_POLICY_SET_DRIFT' using errcode = 'P0001';
  end if;
  select pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
    coalesce(pg_catalog.string_agg(row_json, E'\n' order by row_json collate "C"), ''), 'UTF8'
  )), 'hex') into v_hash from (
  select pg_catalog.array_to_json(array[
    n.nspname::text, c.relname::text, pg_catalog.pg_get_userbyid(c.relowner),
    case when c.relrowsecurity then 't' else 'f' end,
    case when c.relforcerowsecurity then 't' else 'f' end,
    p.polname::text, case when p.polpermissive then 't' else 'f' end,
    p.polcmd::text,
    array(select case when r.role_oid = 0 then 'PUBLIC'
      else pg_catalog.pg_get_userbyid(r.role_oid) end
      from pg_catalog.unnest(p.polroles) r(role_oid)
      order by 1)::text,
    coalesce(pg_catalog.pg_get_expr(p.polqual, p.polrelid, false), ''),
    coalesce(pg_catalog.pg_get_expr(p.polwithcheck, p.polrelid, false), '')
  ]::text[])::text as row_json
  from pg_catalog.pg_policy p join pg_catalog.pg_class c on c.oid = p.polrelid
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'storage' and c.relname = 'objects'
    and (p.polname in ('members can delete wine images', 'members can update wine images', 'members can upload wine images')
      or (pg_catalog.current_setting('terroir.c04_0165_hosted_baseline', true) = 'on'
        and p.polname = 'members can read wine images'))
  ) captured;
  if v_hash is distinct from (case when pg_catalog.current_setting('terroir.c04_0165_hosted_baseline', true) = 'on'
    then '51c8f43961616831da012bc662fd3421bb0e986a12b7c09ef51926fb6213ee99' else 'e49c5f1a9073eef48d97a40728ae6f91de78f9776f55929dcd4eed238218c0f0' end) then
    raise exception 'C04_0165_WINE_POLICY_DRIFT' using errcode = 'P0001';
  end if;

  if pg_catalog.has_table_privilege('authenticated', 'public.inventory_items', 'SELECT')
     or pg_catalog.has_table_privilege('authenticated', 'public.wines', 'SELECT')
     or pg_catalog.has_table_privilege('authenticated', 'public.restaurants', 'SELECT')
     or pg_catalog.has_table_privilege('authenticated', 'public.pricing_recommendations', 'SELECT')
     or pg_catalog.has_table_privilege('authenticated', 'public.invoice_scans', 'SELECT')
     or pg_catalog.has_table_privilege('authenticated', 'public.scan_idempotency', 'SELECT') then
    raise exception 'C04_0165_TABLE_PRIVILEGE_REMAINS' using errcode = 'P0001';
  end if;
  if not pg_catalog.has_column_privilege(
       'authenticated', 'public.inventory_items', 'quantity', 'SELECT'
     )
     or pg_catalog.has_column_privilege(
       'authenticated', 'public.inventory_items', 'unit_cost', 'SELECT'
     )
     or pg_catalog.has_column_privilege(
       'authenticated', 'public.wines', 'pricing_target_markup_ratio', 'SELECT'
     )
     or pg_catalog.has_column_privilege(
       'authenticated', 'public.invoice_scans', 'raw_image_path', 'SELECT'
     ) then
    raise exception 'C04_0165_COLUMN_PRIVILEGE_INVALID' using errcode = 'P0001';
  end if;
  if pg_catalog.has_function_privilege(
       'authenticated', 'public.dismiss_pricing_alert(uuid,integer)', 'EXECUTE'
     ) then
    raise exception 'C04_0165_LEGACY_DISMISS_EXECUTE_REMAINS' using errcode = 'P0001';
  end if;
  if not exists (
    select 1 from pg_catalog.pg_policy p
    join pg_catalog.pg_class c on c.oid = p.polrelid
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'storage' and c.relname = 'objects'
      and pg_catalog.pg_get_userbyid(c.relowner) = 'supabase_storage_admin'
      and p.polname = 'members can read invoice images'
      and p.polcmd = 'r' and p.polpermissive
      and p.polroles = array[(select oid from pg_catalog.pg_roles where rolname = 'authenticated')]
      and pg_catalog.pg_get_expr(p.polqual, p.polrelid, false)
        like '%read_invoice_image_target%'
      and pg_catalog.pg_get_expr(p.polqual, p.polrelid, false)
        not like '%is_member(%'
  ) or not exists (
    select 1 from pg_catalog.pg_policy p
    join pg_catalog.pg_class c on c.oid = p.polrelid
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'storage' and c.relname = 'objects'
      and pg_catalog.pg_get_userbyid(c.relowner) = 'supabase_storage_admin'
      and p.polname = 'members can upload invoice images'
      and p.polcmd = 'a' and p.polpermissive and p.polqual is null
      and p.polroles = array[(select oid from pg_catalog.pg_roles where rolname = 'authenticated')]
      and pg_catalog.pg_get_expr(p.polwithcheck, p.polrelid, false)
        like '%(_page[1-8])%'
      and pg_catalog.pg_get_expr(p.polwithcheck, p.polrelid, false)
        like '%read_current_operational_memberships%'
      and pg_catalog.pg_get_expr(p.polwithcheck, p.polrelid, false)
        not like '%is_member(%'
  ) then
    raise exception 'C04_0165_STORAGE_POLICY_POSTIMAGE_INVALID' using errcode = 'P0001';
  end if;
end;
$c04_0165_postflight$;

-- Preserve the exact hosted rollback choice atomically with the migration.
-- NULL is the original D/CI marker; no caller-supplied restoration profile exists.
insert into supabase_migrations.schema_migrations(version, name, statements)
values ('0165', 'staff_cost_seal_contract',
  case when pg_catalog.current_setting('terroir.c04_0165_hosted_baseline', true) = 'on'
    then array['-- C04_0165_HOSTED_BASELINE_ACL_SHA256|a8a92931df21d2d4e7e114389351e73453b0c8b02564539cd022e07ec953423f']::text[] else null end);
select 'C04_0165_APPLIED_STORAGE_POLICY_SHA256|' ||
  pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
    pg_catalog.string_agg(row_json, E'\n' order by row_json collate "C"), 'UTF8'
  )), 'hex')
from (
  select pg_catalog.array_to_json(array[
    n.nspname::text, c.relname::text, pg_catalog.pg_get_userbyid(c.relowner),
    case when c.relrowsecurity then 't' else 'f' end,
    case when c.relforcerowsecurity then 't' else 'f' end,
    p.polname::text, case when p.polpermissive then 't' else 'f' end,
    p.polcmd::text,
    array(select case when r.role_oid = 0 then 'PUBLIC'
      else pg_catalog.pg_get_userbyid(r.role_oid) end
      from pg_catalog.unnest(p.polroles) r(role_oid)
      order by 1)::text,
    coalesce(pg_catalog.pg_get_expr(p.polqual, p.polrelid, false), ''),
    coalesce(pg_catalog.pg_get_expr(p.polwithcheck, p.polrelid, false), '')
  ]::text[])::text as row_json
  from pg_catalog.pg_policy p join pg_catalog.pg_class c on c.oid = p.polrelid
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'storage' and c.relname = 'objects'
) captured;
notify pgrst, 'reload schema';
commit;
