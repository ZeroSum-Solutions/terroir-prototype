-- Source-only structural receipt for the final staff-cost contract.
--
-- Run only on the named, externally quiesced disposable target after the
-- operator has approved a database session. This read-only snapshot cannot
-- identify the deployed application revision and is not cutover proof. The
-- future contract transaction must repeat every admission predicate before
-- changing an ACL or policy.
--
-- This script reads catalogs plus the fixed invoice-images bucket row. It does
-- not read protected business rows, call application routines, or repair data.
\set ON_ERROR_STOP on

begin transaction isolation level repeatable read, read only;
set local statement_timeout = '30s';
set local lock_timeout = '5s';
set local idle_in_transaction_session_timeout = '30s';
set local search_path = pg_catalog;
set local row_security = off;

do $structural_admission$
declare
  v_count bigint;
  v_extra_count bigint;
begin
  if pg_catalog.current_setting('transaction_read_only') <> 'on'
     or pg_catalog.current_setting('transaction_isolation') <> 'repeatable read' then
    raise exception 'C04_STAFF_COST_BASELINE_NOT_READ_ONLY' using errcode = 'P0001';
  end if;

  -- C04_OPERATOR_GATE_BEGIN
  if current_user <> session_user or current_user <> 'postgres' then
    raise exception 'C04_STAFF_COST_OPERATOR_IDENTITY_INVALID' using errcode = 'P0001';
  end if;
  if not exists (
    select 1
      from pg_catalog.pg_roles operator_role
     where operator_role.rolname = current_user
       and (operator_role.rolsuper or operator_role.rolbypassrls)
  ) then
    raise exception 'C04_STAFF_COST_OPERATOR_AUTHORITY_INVALID' using errcode = 'P0001';
  end if;
  if pg_catalog.current_setting('row_security') <> 'off' then
    raise exception 'C04_STAFF_COST_ROW_SECURITY_GUARD_INVALID' using errcode = 'P0001';
  end if;
  -- C04_OPERATOR_GATE_END

  if pg_catalog.to_regrole('postgres') is null
     or pg_catalog.to_regrole('anon') is null
     or pg_catalog.to_regrole('authenticated') is null
     or pg_catalog.to_regrole('service_role') is null
     or pg_catalog.to_regtype('public.membership_role') is null
     or pg_catalog.to_regtype('public.added_via') is null
     or pg_catalog.to_regclass('storage.objects') is null
     or pg_catalog.to_regclass('storage.buckets') is null
     or pg_catalog.to_regclass('public.background_jobs') is null then
    raise exception 'C04_STAFF_COST_REQUIRED_BASELINE_MISSING' using errcode = 'P0001';
  end if;

  with expected(relation_name) as (
    values
      -- C04_EXPECTED_RELATIONS_BEGIN
      ('inventory_items'),
      ('wines'),
      ('restaurants'),
      ('pricing_recommendations'),
      ('invoice_scans'),
      ('invoice_scan_deletions'),
      ('reconcile_actions'),
      ('identity_merge_log'),
      ('import_batch_rows'),
      ('cellar_health'),
      ('scan_idempotency')
      -- C04_EXPECTED_RELATIONS_END
  )
  select pg_catalog.count(*) into v_count
    from expected e
    join pg_catalog.pg_namespace n on n.nspname = 'public'
    join pg_catalog.pg_class c
      on c.relnamespace = n.oid
     and c.relname = e.relation_name
     and c.relkind = 'r'
    join pg_catalog.pg_roles owner_role on owner_role.oid = c.relowner
   where c.relrowsecurity
     and owner_role.rolname = 'postgres';
  if v_count <> 11 then
    raise exception 'C04_STAFF_COST_RELATION_BASELINE_INVALID' using errcode = 'P0001';
  end if;

  -- The frozen source uses UUID keys and owns no sequence from these eleven
  -- relations. Refuse rather than silently broadening the rollback surface.
  with expected(relation_name) as (
    values
      ('inventory_items'), ('wines'), ('restaurants'),
      ('pricing_recommendations'), ('invoice_scans'),
      ('invoice_scan_deletions'), ('reconcile_actions'),
      ('identity_merge_log'), ('import_batch_rows'), ('cellar_health'),
      ('scan_idempotency')
  ), target_relations as (
    select c.oid
      from expected e
      join pg_catalog.pg_namespace n on n.nspname = 'public'
      join pg_catalog.pg_class c
        on c.relnamespace = n.oid and c.relname = e.relation_name
  )
  select pg_catalog.count(*) into v_count
    from pg_catalog.pg_depend d
    join pg_catalog.pg_class sequence_relation
      on sequence_relation.oid = d.objid
     and sequence_relation.relkind = 'S'
    join target_relations target on target.oid = d.refobjid
   where d.classid = pg_catalog.to_regclass('pg_catalog.pg_class')
     and d.refclassid = pg_catalog.to_regclass('pg_catalog.pg_class')
     and d.deptype in ('a', 'i');
  if v_count <> 0 then
    raise exception 'C04_STAFF_COST_UNEXPECTED_OWNED_SEQUENCE' using errcode = 'P0001';
  end if;

  select pg_catalog.count(*) into v_count
    from storage.buckets b
   where b.id = 'invoice-images'
     and b.name = 'invoice-images'
     and b.public is false
     and b.file_size_limit = 20971520
     and b.allowed_mime_types = array[
       'image/jpeg', 'image/png', 'image/heic', 'image/heif', 'application/pdf'
     ]::text[];
  if v_count <> 1 then
    raise exception 'C04_STAFF_COST_INVOICE_BUCKET_BASELINE_INVALID' using errcode = 'P0001';
  end if;

  select pg_catalog.count(*) into v_count
    from pg_catalog.pg_policy p
    join pg_catalog.pg_class c on c.oid = p.polrelid
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'storage'
     and c.relname = 'objects'
     and p.polname in (
       'members can upload invoice images',
       'members can read invoice images'
     )
     and p.polpermissive
     and p.polroles = array[pg_catalog.to_regrole('authenticated')]::oid[]
     and (
       (p.polname = 'members can upload invoice images' and p.polcmd = 'a')
       or (p.polname = 'members can read invoice images' and p.polcmd = 'r')
     );
  if v_count <> 2 then
    raise exception 'C04_STAFF_COST_INVOICE_POLICY_BASELINE_INVALID' using errcode = 'P0001';
  end if;

  -- C04_ROUTINE_SET_GATE_BEGIN
  with expected(signature) as (
    values
        -- C04_EXPECTED_ROUTINES_BEGIN
        ('public.effective_site_capability(uuid,text)'),
        ('public.effective_site_ids(text)'),
        ('public.current_site_role_at_least(uuid,public.membership_role)'),
        ('public.current_inventory_contract_version()'),
        ('public.wine_manual_overrides_valid(text[])'),
        ('public.wine_enrichment_metadata_valid(jsonb)'),
        ('public.invoice_image_paths_valid(uuid,uuid,text,jsonb)'),
        ('public.invoice_line_items_valid(jsonb)'),
        ('public.invoice_edits_valid(jsonb)'),
        ('public.read_inventory_costs(uuid,uuid[])'),
        ('public.read_wine_pricing_strategy(uuid,uuid[])'),
        ('public.read_wine_cost_flags(uuid,uuid[])'),
        ('public.read_restaurant_pricing_defaults(uuid)'),
        ('public.read_pricing_recommendations(uuid)'),
        ('public.read_invoice_scan_private(uuid)'),
        ('public.read_invoice_image_target(uuid,integer)'),
        ('public.read_invoice_scan_deletion_private(uuid)'),
        ('public.read_reconcile_action_private(uuid)'),
        ('public.read_identity_merge_private(uuid)'),
        ('public.read_import_batch_cost_rows(uuid,integer,integer)'),
        ('public.read_import_batch_display_rows(uuid,integer,integer)'),
        ('public.read_cellar_health_private(uuid,uuid[])'),
        ('public.read_current_operational_memberships(uuid)'),
        ('public.set_wine_pricing_strategy(uuid,uuid,numeric,numeric)'),
        ('public.set_restaurant_pricing_defaults(uuid,numeric,numeric)'),
        ('public.dismiss_pricing_alert(uuid,integer)'),
        ('public.dismiss_pricing_alert_private(uuid,integer)'),
        ('public.set_wine_overpaid_flag(uuid,uuid,boolean)'),
        ('public.create_inventory_item_private(uuid,uuid,integer,numeric,text,uuid,text,text,text,uuid,public.added_via)'),
        ('public.patch_inventory_item_private(uuid,timestamp with time zone,boolean,integer,boolean,numeric,boolean,text,boolean,uuid,boolean,text,boolean,text,boolean,text)'),
        ('public.delete_wine_private(uuid,uuid,timestamp with time zone)'),
        ('public.add_manual_overrides(uuid,text[])'),
        ('public.enrich_wines_batch(uuid,jsonb)'),
        ('public.assign_wine_sections_private(uuid,uuid[],text)'),
        ('public.create_invoice_scan_upload(uuid,uuid,text,text,text,date)'),
        ('public.review_invoice_scan(uuid,timestamp with time zone,text,text,date,jsonb,jsonb)'),
        ('public.commit_invoice_scan(uuid)'),
        ('public.delete_invoice_scan(uuid)'),
        ('public.request_invoice_scan_reextract(uuid)'),
        ('public.claim_scan_idempotency(uuid,uuid,text)'),
        ('public.complete_scan_idempotency(uuid,uuid,text,uuid,integer,integer,uuid)'),
        ('public.abandon_scan_idempotency(uuid,uuid,text)'),
        ('public.cleanup_scan_idempotency()'),
        ('public.enqueue_invoice_extract_job(uuid,uuid)'),
        ('public.claim_invoice_extract_job(text)'),
        ('public.reclaim_stuck_invoice_extract_jobs(integer)'),
        ('public.expire_stalled_invoice_scans(uuid)'),
        ('public.create_import_batch(uuid,uuid,text,integer,jsonb,uuid,integer,integer,text,text)'),
        ('public.count_import_batch_rows(uuid)'),
        ('public.apply_import_batch_chunk(uuid,integer)'),
        ('public.resolve_import_batch_row(uuid,text,numeric)'),
        ('public.bulk_resolve_import_batch_rows(uuid,text)'),
        ('public.revert_import_batch_core_private(uuid,uuid[])'),
        ('public.revert_import_batch_private(uuid)'),
        ('public.revert_import_batch(uuid)'),
        ('public.revert_import_session(uuid)'),
        ('public.accept_reconcile_batch(uuid,jsonb,uuid)'),
        ('public.undo_reconcile_batch(uuid)'),
        ('public.merge_wines(uuid,uuid)'),
        ('public.save_bottle_inventory_private(uuid,uuid,text,text,integer,text,text,text,text,integer,numeric)'),
        ('public.receive_bottle_at_location_private(uuid,uuid,uuid,text,uuid)'),
        ('public.mirror_bin_code_to_inventory_items()')
        -- C04_EXPECTED_ROUTINES_END
  ), resolved as (
    select e.signature, p.oid, p.proname, p.prokind, p.proowner
      from expected e
      left join pg_catalog.pg_proc p
        on p.oid = pg_catalog.to_regprocedure(e.signature)
  ), protected_names as (
    select distinct r.proname
      from resolved r
     where r.proname is not null
  ), unexpected as (
    select candidate.oid
      from pg_catalog.pg_proc candidate
      join pg_catalog.pg_namespace n
        on n.oid = candidate.pronamespace
       and n.nspname = 'public'
      join protected_names protected
        on protected.proname = candidate.proname
     where not exists (
       select 1 from resolved admitted where admitted.oid = candidate.oid
     )
  )
  select
    pg_catalog.count(*) filter (
      where resolved.oid is not null
        and resolved.prokind = 'f'
        and resolved.proowner = pg_catalog.to_regrole('postgres')
    ),
    (select pg_catalog.count(*) from unexpected)
    into v_count, v_extra_count
    from resolved;
  if v_count <> 62 or v_extra_count <> 0 then
    raise exception 'C04_STAFF_COST_ROUTINE_SET_INVALID' using errcode = 'P0001';
  end if;
  -- C04_ROUTINE_SET_GATE_END

  with required(schema_name, relation_name, constraint_name) as (
    values
      ('public', 'wines', 'wines_manual_overrides_valid_check'),
      ('public', 'wines', 'wines_enrichment_metadata_valid_check'),
      ('public', 'invoice_scans', 'invoice_scans_image_paths_valid_check'),
      ('public', 'scan_idempotency', 'scan_idempotency_pkey'),
      ('public', 'background_jobs', 'background_jobs_attempt_window'),
      ('public', 'background_jobs', 'background_jobs_job_type_check'),
      ('public', 'background_jobs', 'background_jobs_status_check')
  )
  select pg_catalog.count(*) into v_count
    from required r
    join pg_catalog.pg_namespace n on n.nspname = r.schema_name
    join pg_catalog.pg_class c
      on c.relnamespace = n.oid and c.relname = r.relation_name
    join pg_catalog.pg_constraint constraint_row
      on constraint_row.conrelid = c.oid
     and constraint_row.conname = r.constraint_name
   where constraint_row.convalidated;
  if v_count <> 7 then
    raise exception 'C04_STAFF_COST_REQUIRED_CONSTRAINT_INVALID' using errcode = 'P0001';
  end if;

  select pg_catalog.count(*) into v_count
    from pg_catalog.pg_attribute a
   where a.attrelid = pg_catalog.to_regclass('public.background_jobs')
     and a.attnum > 0
     and not a.attisdropped
     and a.attname in (
       'job_type', 'status', 'result', 'metadata', 'error_code', 'error_message'
     );
  if v_count <> 6 then
    raise exception 'C04_STAFF_COST_JOB_STRUCTURE_INVALID' using errcode = 'P0001';
  end if;
end;
$structural_admission$;

select
  'C04_TARGET_IDENTITY'::text as receipt_class,
  pg_catalog.current_database()::text as database_name,
  current_user::text as current_role,
  session_user::text as session_role,
  operator_role.rolsuper,
  operator_role.rolbypassrls,
  pg_catalog.current_setting('transaction_isolation')::text as isolation_level,
  pg_catalog.current_setting('transaction_read_only')::text as read_only,
  pg_catalog.current_setting('row_security')::text as row_security
from pg_catalog.pg_roles operator_role
where operator_role.rolname = current_user;

with expected(relation_name) as (
  values
    ('inventory_items'), ('wines'), ('restaurants'),
    ('pricing_recommendations'), ('invoice_scans'),
    ('invoice_scan_deletions'), ('reconcile_actions'),
    ('identity_merge_log'), ('import_batch_rows'), ('cellar_health'),
    ('scan_idempotency')
), target_relations as (
  select c.oid, n.nspname, c.relname, c.relowner, c.relacl,
         c.relrowsecurity, c.relforcerowsecurity
    from expected e
    join pg_catalog.pg_namespace n on n.nspname = 'public'
    join pg_catalog.pg_class c
      on c.relnamespace = n.oid and c.relname = e.relation_name
)
select
  'C04_RELATION_OWNER'::text as receipt_class,
  t.nspname::text as schema_name,
  t.relname::text as relation_name,
  owner_role.rolname::text as owner_name,
  t.relrowsecurity,
  t.relforcerowsecurity
from target_relations t
join pg_catalog.pg_roles owner_role on owner_role.oid = t.relowner
order by t.nspname, t.relname;

with expected(relation_name) as (
  values
    ('inventory_items'), ('wines'), ('restaurants'),
    ('pricing_recommendations'), ('invoice_scans'),
    ('invoice_scan_deletions'), ('reconcile_actions'),
    ('identity_merge_log'), ('import_batch_rows'), ('cellar_health'),
    ('scan_idempotency')
), target_relations as (
  select c.oid, n.nspname, c.relname, c.relowner, c.relacl
    from expected e
    join pg_catalog.pg_namespace n on n.nspname = 'public'
    join pg_catalog.pg_class c
      on c.relnamespace = n.oid and c.relname = e.relation_name
), table_acl as (
  select t.oid, pg_catalog.count(*)::bigint as table_acl_count
    from target_relations t
    cross join lateral pg_catalog.aclexplode(
      coalesce(t.relacl, pg_catalog.acldefault('r', t.relowner))
    ) acl
   group by t.oid
), column_acl as (
  select t.oid, pg_catalog.count(*)::bigint as column_acl_count
    from target_relations t
    join pg_catalog.pg_attribute a
      on a.attrelid = t.oid
     and a.attnum > 0
     and not a.attisdropped
     and a.attacl is not null
    cross join lateral pg_catalog.aclexplode(a.attacl) acl
   group by t.oid
)
select
  'C04_RELATION_ACL_SUMMARY'::text as receipt_class,
  t.nspname::text as schema_name,
  t.relname::text as relation_name,
  coalesce(ta.table_acl_count, 0)::bigint as table_acl_count,
  coalesce(ca.column_acl_count, 0)::bigint as column_acl_count
from target_relations t
left join table_acl ta on ta.oid = t.oid
left join column_acl ca on ca.oid = t.oid
order by t.nspname, t.relname;

with expected(relation_name) as (
  values
    ('inventory_items'), ('wines'), ('restaurants'),
    ('pricing_recommendations'), ('invoice_scans'),
    ('invoice_scan_deletions'), ('reconcile_actions'),
    ('identity_merge_log'), ('import_batch_rows'), ('cellar_health'),
    ('scan_idempotency')
), target_relations as (
  select c.oid, n.nspname, c.relname, c.relowner, c.relacl
    from expected e
    join pg_catalog.pg_namespace n on n.nspname = 'public'
    join pg_catalog.pg_class c
      on c.relnamespace = n.oid and c.relname = e.relation_name
), acl_rows as (
  select t.nspname, t.relname, null::text as column_name,
         t.relowner, acl.grantor, acl.grantee,
         acl.privilege_type::text, acl.is_grantable
    from target_relations t
    cross join lateral pg_catalog.aclexplode(
      coalesce(t.relacl, pg_catalog.acldefault('r', t.relowner))
    ) acl
  union all
  select t.nspname, t.relname, a.attname::text as column_name,
         t.relowner, acl.grantor, acl.grantee,
         acl.privilege_type::text, acl.is_grantable
    from target_relations t
    join pg_catalog.pg_attribute a
      on a.attrelid = t.oid
     and a.attnum > 0
     and not a.attisdropped
     and a.attacl is not null
    cross join lateral pg_catalog.aclexplode(a.attacl) acl
)
select
  'C04_RELATION_ACL'::text as receipt_class,
  rows.nspname::text as schema_name,
  rows.relname::text as relation_name,
  rows.column_name,
  owner_role.rolname::text as owner_name,
  grantor_role.rolname::text as grantor_name,
  case when rows.grantee = 0 then 'PUBLIC' else grantee_role.rolname end::text
    as grantee_name,
  rows.privilege_type,
  rows.is_grantable
from acl_rows rows
join pg_catalog.pg_roles owner_role on owner_role.oid = rows.relowner
join pg_catalog.pg_roles grantor_role on grantor_role.oid = rows.grantor
left join pg_catalog.pg_roles grantee_role on grantee_role.oid = rows.grantee
order by rows.nspname, rows.relname, rows.column_name nulls first,
         grantor_name, grantee_name, rows.privilege_type;

select
  'C04_SEQUENCE_SUMMARY'::text as receipt_class,
  'owned_sequence_count'::text as structural_name,
  0::bigint as structural_count;

select
  'C04_INVOICE_BUCKET'::text as receipt_class,
  b.id::text as bucket_id,
  b.name::text as bucket_name,
  b.public,
  b.file_size_limit,
  b.allowed_mime_types
from storage.buckets b
where b.id = 'invoice-images';

-- Every storage.objects policy is private, untrusted structural output. The
-- future target-specific down may be authored from a reviewed receipt; these
-- expressions are never interpolated or executed by this script.
-- C04_STORAGE_POLICY_INVENTORY_BEGIN
with policy_rows as (
  select p.*, n.nspname, c.relname, c.relowner,
         c.relrowsecurity, c.relforcerowsecurity,
         array(
           select case when roles.role_oid = 0 then 'PUBLIC' else role_row.rolname end
             from pg_catalog.unnest(p.polroles) as roles(role_oid)
             left join pg_catalog.pg_roles role_row
               on role_row.oid = roles.role_oid
            order by roles.role_oid
         )::text[] as role_names
    from pg_catalog.pg_policy p
    join pg_catalog.pg_class c on c.oid = p.polrelid
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'storage'
     and c.relname = 'objects'
)
select
  'C04_INVOICE_POLICY'::text as receipt_class,
  p.nspname::text as schema_name,
  p.relname::text as relation_name,
  owner_role.rolname::text as relation_owner,
  p.relrowsecurity,
  p.relforcerowsecurity,
  p.polname::text as policy_name,
  p.polpermissive,
  p.polcmd,
  p.polroles,
  p.role_names,
  pg_catalog.pg_get_expr(p.polqual, p.polrelid) as untrusted_using_expression,
  pg_catalog.pg_get_expr(p.polwithcheck, p.polrelid) as untrusted_check_expression
from policy_rows p
join pg_catalog.pg_roles owner_role on owner_role.oid = p.relowner
order by p.polname;
-- C04_STORAGE_POLICY_INVENTORY_END

with required(schema_name, relation_name, constraint_name) as (
  values
    ('public', 'wines', 'wines_manual_overrides_valid_check'),
    ('public', 'wines', 'wines_enrichment_metadata_valid_check'),
    ('public', 'invoice_scans', 'invoice_scans_image_paths_valid_check'),
    ('public', 'scan_idempotency', 'scan_idempotency_pkey'),
    ('public', 'background_jobs', 'background_jobs_attempt_window'),
    ('public', 'background_jobs', 'background_jobs_job_type_check'),
    ('public', 'background_jobs', 'background_jobs_status_check')
)
select
  'C04_REQUIRED_CONSTRAINT'::text as receipt_class,
  r.schema_name::text,
  r.relation_name::text,
  constraint_row.conname::text as constraint_name,
  constraint_row.contype,
  constraint_row.convalidated,
  constraint_row.condeferrable,
  constraint_row.condeferred,
  pg_catalog.pg_get_constraintdef(constraint_row.oid, true) as definition,
  pg_catalog.encode(
    pg_catalog.sha256(pg_catalog.convert_to(
      pg_catalog.pg_get_constraintdef(constraint_row.oid, true), 'UTF8'
    )),
    'hex'
  )::text as definition_sha256
from required r
join pg_catalog.pg_namespace n on n.nspname = r.schema_name
join pg_catalog.pg_class c
  on c.relnamespace = n.oid and c.relname = r.relation_name
join pg_catalog.pg_constraint constraint_row
  on constraint_row.conrelid = c.oid
 and constraint_row.conname = r.constraint_name
order by r.schema_name, r.relation_name, r.constraint_name;

with expected(signature) as (
  values
    ('public.effective_site_capability(uuid,text)'),
    ('public.effective_site_ids(text)'),
    ('public.current_site_role_at_least(uuid,public.membership_role)'),
    ('public.current_inventory_contract_version()'),
    ('public.wine_manual_overrides_valid(text[])'),
    ('public.wine_enrichment_metadata_valid(jsonb)'),
    ('public.invoice_image_paths_valid(uuid,uuid,text,jsonb)'),
    ('public.invoice_line_items_valid(jsonb)'),
    ('public.invoice_edits_valid(jsonb)'),
    ('public.read_inventory_costs(uuid,uuid[])'),
    ('public.read_wine_pricing_strategy(uuid,uuid[])'),
    ('public.read_wine_cost_flags(uuid,uuid[])'),
    ('public.read_restaurant_pricing_defaults(uuid)'),
    ('public.read_pricing_recommendations(uuid)'),
    ('public.read_invoice_scan_private(uuid)'),
    ('public.read_invoice_image_target(uuid,integer)'),
    ('public.read_invoice_scan_deletion_private(uuid)'),
    ('public.read_reconcile_action_private(uuid)'),
    ('public.read_identity_merge_private(uuid)'),
    ('public.read_import_batch_cost_rows(uuid,integer,integer)'),
    ('public.read_import_batch_display_rows(uuid,integer,integer)'),
    ('public.read_cellar_health_private(uuid,uuid[])'),
    ('public.read_current_operational_memberships(uuid)'),
    ('public.set_wine_pricing_strategy(uuid,uuid,numeric,numeric)'),
    ('public.set_restaurant_pricing_defaults(uuid,numeric,numeric)'),
    ('public.dismiss_pricing_alert(uuid,integer)'),
    ('public.dismiss_pricing_alert_private(uuid,integer)'),
    ('public.set_wine_overpaid_flag(uuid,uuid,boolean)'),
    ('public.create_inventory_item_private(uuid,uuid,integer,numeric,text,uuid,text,text,text,uuid,public.added_via)'),
    ('public.patch_inventory_item_private(uuid,timestamp with time zone,boolean,integer,boolean,numeric,boolean,text,boolean,uuid,boolean,text,boolean,text,boolean,text)'),
    ('public.delete_wine_private(uuid,uuid,timestamp with time zone)'),
    ('public.add_manual_overrides(uuid,text[])'),
    ('public.enrich_wines_batch(uuid,jsonb)'),
    ('public.assign_wine_sections_private(uuid,uuid[],text)'),
    ('public.create_invoice_scan_upload(uuid,uuid,text,text,text,date)'),
    ('public.review_invoice_scan(uuid,timestamp with time zone,text,text,date,jsonb,jsonb)'),
    ('public.commit_invoice_scan(uuid)'),
    ('public.delete_invoice_scan(uuid)'),
    ('public.request_invoice_scan_reextract(uuid)'),
    ('public.claim_scan_idempotency(uuid,uuid,text)'),
    ('public.complete_scan_idempotency(uuid,uuid,text,uuid,integer,integer,uuid)'),
    ('public.abandon_scan_idempotency(uuid,uuid,text)'),
    ('public.cleanup_scan_idempotency()'),
    ('public.enqueue_invoice_extract_job(uuid,uuid)'),
    ('public.claim_invoice_extract_job(text)'),
    ('public.reclaim_stuck_invoice_extract_jobs(integer)'),
    ('public.expire_stalled_invoice_scans(uuid)'),
    ('public.create_import_batch(uuid,uuid,text,integer,jsonb,uuid,integer,integer,text,text)'),
    ('public.count_import_batch_rows(uuid)'),
    ('public.apply_import_batch_chunk(uuid,integer)'),
    ('public.resolve_import_batch_row(uuid,text,numeric)'),
    ('public.bulk_resolve_import_batch_rows(uuid,text)'),
    ('public.revert_import_batch_core_private(uuid,uuid[])'),
    ('public.revert_import_batch_private(uuid)'),
    ('public.revert_import_batch(uuid)'),
    ('public.revert_import_session(uuid)'),
    ('public.accept_reconcile_batch(uuid,jsonb,uuid)'),
    ('public.undo_reconcile_batch(uuid)'),
    ('public.merge_wines(uuid,uuid)'),
    ('public.save_bottle_inventory_private(uuid,uuid,text,text,integer,text,text,text,text,integer,numeric)'),
    ('public.receive_bottle_at_location_private(uuid,uuid,uuid,text,uuid)'),
    ('public.mirror_bin_code_to_inventory_items()')
), routine_rows as (
  select e.signature, p.*, n.nspname, language_row.lanname,
         owner_role.rolname as owner_name
    from expected e
    join pg_catalog.pg_proc p on p.oid = pg_catalog.to_regprocedure(e.signature)
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    join pg_catalog.pg_language language_row on language_row.oid = p.prolang
    join pg_catalog.pg_roles owner_role on owner_role.oid = p.proowner
)
select
  'C04_ROUTINE_FINGERPRINT'::text as receipt_class,
  r.signature::text,
  r.owner_name::text,
  r.lanname::text as language_name,
  pg_catalog.pg_get_function_identity_arguments(r.oid) as identity_arguments,
  pg_catalog.pg_get_function_result(r.oid) as result_type,
  r.prosecdef,
  r.provolatile,
  r.proconfig,
  r.prokind,
  pg_catalog.encode(
    pg_catalog.sha256(pg_catalog.convert_to(
      pg_catalog.pg_get_functiondef(r.oid), 'UTF8'
    )),
    'hex'
  )::text as definition_sha256
from routine_rows r
order by r.signature;

with expected(signature) as (
  values
    ('public.effective_site_capability(uuid,text)'),
    ('public.effective_site_ids(text)'),
    ('public.current_site_role_at_least(uuid,public.membership_role)'),
    ('public.current_inventory_contract_version()'),
    ('public.wine_manual_overrides_valid(text[])'),
    ('public.wine_enrichment_metadata_valid(jsonb)'),
    ('public.invoice_image_paths_valid(uuid,uuid,text,jsonb)'),
    ('public.invoice_line_items_valid(jsonb)'),
    ('public.invoice_edits_valid(jsonb)'),
    ('public.read_inventory_costs(uuid,uuid[])'),
    ('public.read_wine_pricing_strategy(uuid,uuid[])'),
    ('public.read_wine_cost_flags(uuid,uuid[])'),
    ('public.read_restaurant_pricing_defaults(uuid)'),
    ('public.read_pricing_recommendations(uuid)'),
    ('public.read_invoice_scan_private(uuid)'),
    ('public.read_invoice_image_target(uuid,integer)'),
    ('public.read_invoice_scan_deletion_private(uuid)'),
    ('public.read_reconcile_action_private(uuid)'),
    ('public.read_identity_merge_private(uuid)'),
    ('public.read_import_batch_cost_rows(uuid,integer,integer)'),
    ('public.read_import_batch_display_rows(uuid,integer,integer)'),
    ('public.read_cellar_health_private(uuid,uuid[])'),
    ('public.read_current_operational_memberships(uuid)'),
    ('public.set_wine_pricing_strategy(uuid,uuid,numeric,numeric)'),
    ('public.set_restaurant_pricing_defaults(uuid,numeric,numeric)'),
    ('public.dismiss_pricing_alert(uuid,integer)'),
    ('public.dismiss_pricing_alert_private(uuid,integer)'),
    ('public.set_wine_overpaid_flag(uuid,uuid,boolean)'),
    ('public.create_inventory_item_private(uuid,uuid,integer,numeric,text,uuid,text,text,text,uuid,public.added_via)'),
    ('public.patch_inventory_item_private(uuid,timestamp with time zone,boolean,integer,boolean,numeric,boolean,text,boolean,uuid,boolean,text,boolean,text,boolean,text)'),
    ('public.delete_wine_private(uuid,uuid,timestamp with time zone)'),
    ('public.add_manual_overrides(uuid,text[])'),
    ('public.enrich_wines_batch(uuid,jsonb)'),
    ('public.assign_wine_sections_private(uuid,uuid[],text)'),
    ('public.create_invoice_scan_upload(uuid,uuid,text,text,text,date)'),
    ('public.review_invoice_scan(uuid,timestamp with time zone,text,text,date,jsonb,jsonb)'),
    ('public.commit_invoice_scan(uuid)'),
    ('public.delete_invoice_scan(uuid)'),
    ('public.request_invoice_scan_reextract(uuid)'),
    ('public.claim_scan_idempotency(uuid,uuid,text)'),
    ('public.complete_scan_idempotency(uuid,uuid,text,uuid,integer,integer,uuid)'),
    ('public.abandon_scan_idempotency(uuid,uuid,text)'),
    ('public.cleanup_scan_idempotency()'),
    ('public.enqueue_invoice_extract_job(uuid,uuid)'),
    ('public.claim_invoice_extract_job(text)'),
    ('public.reclaim_stuck_invoice_extract_jobs(integer)'),
    ('public.expire_stalled_invoice_scans(uuid)'),
    ('public.create_import_batch(uuid,uuid,text,integer,jsonb,uuid,integer,integer,text,text)'),
    ('public.count_import_batch_rows(uuid)'),
    ('public.apply_import_batch_chunk(uuid,integer)'),
    ('public.resolve_import_batch_row(uuid,text,numeric)'),
    ('public.bulk_resolve_import_batch_rows(uuid,text)'),
    ('public.revert_import_batch_core_private(uuid,uuid[])'),
    ('public.revert_import_batch_private(uuid)'),
    ('public.revert_import_batch(uuid)'),
    ('public.revert_import_session(uuid)'),
    ('public.accept_reconcile_batch(uuid,jsonb,uuid)'),
    ('public.undo_reconcile_batch(uuid)'),
    ('public.merge_wines(uuid,uuid)'),
    ('public.save_bottle_inventory_private(uuid,uuid,text,text,integer,text,text,text,text,integer,numeric)'),
    ('public.receive_bottle_at_location_private(uuid,uuid,uuid,text,uuid)'),
    ('public.mirror_bin_code_to_inventory_items()')
), routine_rows as (
  select e.signature, p.*
    from expected e
    join pg_catalog.pg_proc p on p.oid = pg_catalog.to_regprocedure(e.signature)
), acl_rows as (
  select r.signature, r.proowner, acl.grantor, acl.grantee,
         acl.privilege_type::text, acl.is_grantable
    from routine_rows r
    cross join lateral pg_catalog.aclexplode(
      coalesce(r.proacl, pg_catalog.acldefault('f', r.proowner))
    ) acl
)
select
  'C04_ROUTINE_ACL'::text as receipt_class,
  rows.signature::text,
  owner_role.rolname::text as owner_name,
  grantor_role.rolname::text as grantor_name,
  case when rows.grantee = 0 then 'PUBLIC' else grantee_role.rolname end::text
    as grantee_name,
  rows.privilege_type,
  rows.is_grantable
from acl_rows rows
join pg_catalog.pg_roles owner_role on owner_role.oid = rows.proowner
join pg_catalog.pg_roles grantor_role on grantor_role.oid = rows.grantor
left join pg_catalog.pg_roles grantee_role on grantee_role.oid = rows.grantee
order by rows.signature, grantor_name, grantee_name, rows.privilege_type;

select 'C04_HISTORY_WINE_METADATA_NOT_COVERED'::text as receipt_class;
select 'C04_HISTORY_INVOICE_PATHS_NOT_COVERED'::text as receipt_class;
select 'C04_HISTORY_SCAN_CACHE_NOT_COVERED'::text as receipt_class;
select 'C04_HISTORY_BACKGROUND_JOBS_SEPARATE_PROBE'::text as receipt_class;
select 'C04_APP_SHA_EXTERNAL_RECEIPT_REQUIRED'::text as receipt_class;
select 'C04_STAFF_COST_BASELINE_PREFLIGHT_PASS'::text as receipt_class;

rollback;
