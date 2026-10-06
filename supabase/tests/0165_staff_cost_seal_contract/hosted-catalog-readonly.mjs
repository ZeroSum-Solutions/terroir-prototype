// Fixed production catalog capture only: no application rows or routine calls.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const project = "qcfmwphlaekfkqwkfyth";
const organization = "zljkaiwwkbpeyjsblwyb";
const source = readFileSync(new URL("../../migrations/0165_staff_cost_seal_contract.sql", import.meta.url), "utf8");
const baseline = JSON.parse(readFileSync(new URL("./baseline.json", import.meta.url), "utf8"));
const queries = [...source.matchAll(/into v_hash from \(([\s\S]*?)\n  \) captured;/g)].map((match) => match[1]);
assert.equal(queries.length, 4);
const names = baseline.routines.map((row) => `'${row.signature.split(".")[1].split("(")[0]}'`).join(",");
const constraints = baseline.constraints.map((row) => `'${row.name}'`).join(",");
const relations = [...new Set(baseline.constraints.map((row) => row.relation).concat([
  "inventory_items", "wines", "restaurants", "pricing_recommendations", "invoice_scans",
  "invoice_scan_deletions", "reconcile_actions", "identity_merge_log", "import_batch_rows",
  "cellar_health", "scan_idempotency",
]))].map((name) => `'${name}'`).join(",");
// Qualification in deparsed definitions is search_path-sensitive. Match the
// immutable D collector's pg_catalog path before comparing definition hashes.
const query = `set local search_path = pg_catalog;
select json_build_object(
  'captured_at', statement_timestamp(), 'current_user', current_user,
  'transaction_read_only', current_setting('transaction_read_only'),
  'ledger', (select json_build_object('count', count(*), 'maximum', max(version))
    from supabase_migrations.schema_migrations),
  'acl', (select json_agg(row_json::json order by row_json collate "C") from (${queries[0]}) captured),
  'policies', (select json_agg(row_json::json order by row_json collate "C") from (${queries[1]}) captured),
  'bucket', (select json_build_object('id', id, 'name', name, 'public', public,
    'file_size_limit', file_size_limit, 'allowed_mime_types', allowed_mime_types)
    from storage.buckets where id = 'invoice-images'),
  'relations', (select json_agg(json_build_object('name', c.relname,
    'owner', pg_get_userbyid(c.relowner), 'rls', c.relrowsecurity, 'force_rls', c.relforcerowsecurity))
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname in (${relations})),
  'routines', (select json_agg(json_build_object('signature', p.oid::regprocedure::text,
    'owner', pg_get_userbyid(p.proowner), 'kind', p.prokind,
    'sha256', encode(sha256(convert_to(pg_get_functiondef(p.oid), 'UTF8')), 'hex'),
    'acl', (select json_agg(json_build_array(pg_get_userbyid(a.grantor),
      case when a.grantee = 0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end,
      a.privilege_type, a.is_grantable)) from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a))
    order by p.oid::regprocedure::text collate "C") from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname in (${names})),
  'constraints', (select json_agg(json_build_object('relation', c.conrelid::regclass::text,
    'name', c.conname, 'type', c.contype, 'validated', c.convalidated,
    'deferrable', c.condeferrable, 'deferred', c.condeferred,
    'sha256', encode(sha256(convert_to(pg_get_constraintdef(c.oid, true), 'UTF8')), 'hex')))
    from pg_constraint c where c.conname in (${constraints})),
  'operator_roles', (select json_agg(json_build_object('name', rolname,
    'super', rolsuper, 'bypass', rolbypassrls,
    'storage_usage', pg_has_role(oid, 'supabase_storage_admin', 'USAGE')))
    from pg_roles where rolname in ('postgres', 'supabase_admin')),
  'sequences', (select count(*) from pg_depend d join pg_class seq on seq.oid = d.objid
    join pg_class c on c.oid = d.refobjid join pg_namespace n on n.oid = c.relnamespace
    where d.classid = 'pg_class'::regclass and d.refclassid = 'pg_class'::regclass
    and d.deptype in ('a', 'i') and seq.relkind = 'S' and n.nspname = 'public'
    and c.relname in (${relations}))
) as catalog;`;
const token = process.env.SUPABASE_ACCESS_TOKEN || execFileSync("zsvault", ["get", "SUPABASE_ACCESS_TOKEN"], {
  encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
}).trim();
const headers = { Authorization: `Bearer ${token}` };
const metadataResponse = await fetch(`https://api.supabase.com/v1/projects/${project}`, { headers });
assert(metadataResponse.ok, `project HTTP ${metadataResponse.status}`);
const metadata = await metadataResponse.json();
assert.equal(metadata.id, project);
assert.equal(metadata.organization_id, organization);
const response = await fetch(`https://api.supabase.com/v1/projects/${project}/database/query`, {
  method: "POST", headers: { ...headers, "Content-Type": "application/json" },
  body: JSON.stringify({ query: process.argv.includes("--authority-only") ? `set local search_path = pg_catalog;
select json_build_object(
  'captured_at', statement_timestamp(), 'current_user', current_user,
  'transaction_read_only', current_setting('transaction_read_only'),
  'settings', (select json_agg(json_build_object('name', name, 'setting', setting,
    'context', context, 'source', source)) from pg_settings where name in (
    'supautils.policy_grants', 'supautils.superuser', 'shared_preload_libraries', 'session_preload_libraries')),
  'postgres', json_build_object(
    'storage_schema_usage', has_schema_privilege('postgres', 'storage', 'USAGE'),
    'storage_owner_usage', pg_has_role('postgres', 'supabase_storage_admin', 'USAGE'),
    'objects_select', has_table_privilege('postgres', 'storage.objects', 'SELECT'),
    'objects_update', has_table_privilege('postgres', 'storage.objects', 'UPDATE'),
    'objects_delete', has_table_privilege('postgres', 'storage.objects', 'DELETE'),
    'objects_truncate', has_table_privilege('postgres', 'storage.objects', 'TRUNCATE'),
    'objects_maintain', has_table_privilege('postgres', 'storage.objects', 'MAINTAIN')),
  'background_jobs', json_build_object(
    'owner', (select pg_get_userbyid(relowner) from pg_class where oid = 'public.background_jobs'::regclass),
    'rls', (select relrowsecurity from pg_class where oid = 'public.background_jobs'::regclass),
    'acl', (select json_agg(json_build_array(pg_get_userbyid(a.grantor),
      case when a.grantee = 0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end,
      a.privilege_type, a.is_grantable)) from pg_class c cross join lateral aclexplode(c.relacl) a
      where c.oid = 'public.background_jobs'::regclass),
    'policies', (select json_agg(json_build_object('name', polname, 'command', polcmd,
      'roles', (select json_agg(case when x = 0 then 'PUBLIC' else pg_get_userbyid(x) end) from unnest(polroles) x),
      'qual', pg_get_expr(polqual, polrelid, false), 'check', pg_get_expr(polwithcheck, polrelid, false)))
      from pg_policy where polrelid = 'public.background_jobs'::regclass)
  )
) as catalog;` : query, read_only: true }),
});
assert(response.ok, `catalog HTTP ${response.status}`);
const rows = await response.json();
assert.equal(rows.length, 1);
assert.equal(rows[0].catalog.transaction_read_only, "on");
assert.equal(rows[0].catalog.current_user, "supabase_read_only_user");
console.log(JSON.stringify({ project, organization, catalog: rows[0].catalog }));
