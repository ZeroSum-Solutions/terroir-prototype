import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../../..");
const read = (path) => readFileSync(resolve(root, path), "utf8");
const up = read("supabase/migrations/0165_staff_cost_seal_contract.sql");
const down = read("supabase/migrations/down/0165_staff_cost_seal_contract.down.sql");
const preflight = read("supabase/tests/0165_staff_cost_seal_contract/preflight.sql");
const postflight = read("supabase/tests/0165_staff_cost_seal_contract/postflight.sql");
const manifest = read("docs/plans/2026-08-24-visual-wine-platform-spec-list.md");
const normalize = (value) => value.replaceAll(/\s+/g, " ").trim().toLowerCase();
const normalizedUp = normalize(up);
const normalizedDown = normalize(down);
const baseline = JSON.parse(read("supabase/tests/0165_staff_cost_seal_contract/baseline.json"));

assert.match(
  manifest,
  /\| 0165 \| `staff_cost_seal_contract\.sql` \|[^\n]+\|/,
  "0165 must be reserved in the normative manifest",
);
assert.match(normalizedUp, /^-- 0165_staff_cost_seal_contract\.sql .* begin;/);
assert.match(normalizedUp, /set transaction isolation level repeatable read;/);
assert.match(normalizedUp, /commit;$/);
assert.match(normalizedDown, /^-- 0165_staff_cost_seal_contract\.down\.sql .* begin;/);
assert.match(normalizedDown, /set transaction isolation level repeatable read;/);
assert.match(normalizedDown, /commit;$/);

const stores = [
  "inventory_items",
  "wines",
  "restaurants",
  "pricing_recommendations",
  "invoice_scans",
  "invoice_scan_deletions",
  "reconcile_actions",
  "identity_merge_log",
  "import_batch_rows",
  "cellar_health",
  "scan_idempotency",
];
for (const store of stores) {
  assert.match(up, new RegExp(`\\('(?:${store})'\\)|public\\.${store}`));
}
assert.equal(new Set(stores).size, 11);
assert.match(
  normalizedUp,
  /revoke all privileges on table public\.inventory_items, public\.wines, public\.restaurants, public\.pricing_recommendations, public\.invoice_scans, public\.invoice_scan_deletions, public\.reconcile_actions, public\.identity_merge_log, public\.import_batch_rows, public\.cellar_health, public\.scan_idempotency from authenticated;/,
);

for (const protectedNeedle of [
  "unit_cost",
  "pricing_target_pour_cost_pct",
  "pricing_target_markup_ratio",
  "pricing_dismissed_until",
  "overpaid_flag",
  "parsed_line_items",
  "final_line_items",
  "edits",
  "ocr_text",
  "raw_image_path",
  "extra_image_paths",
  "prior_state",
  "new_state",
  "source_snapshot",
  "manual_unit_cost",
  "validation_errors",
  "last_error_message",
  "segment",
  "reason",
  "response_body",
]) {
  const grants = up.match(/grant\s+(?:select|insert|update)\s*\([\s\S]*?\)\s+on\s+public\.[a-z_]+\s+to\s+authenticated;/gi) ?? [];
  assert.equal(grants.some((grant) => new RegExp(`\\b${protectedNeedle}\\b`, "i").test(grant)), false, `${protectedNeedle} leaked into a direct grant`);
}

assert.match(normalizedUp, /grant select \(\s*computed_at, id, restaurant_id, wine_id\s*\) on public\.cellar_health to authenticated;/);
assert.doesNotMatch(normalizedUp, /grant select \([^;]*\) on public\.pricing_recommendations to authenticated;/);
assert.doesNotMatch(normalizedUp, /grant select \([^;]*\) on public\.scan_idempotency to authenticated;/);
assert.equal((normalizedUp.match(/grant insert \(/g) ?? []).length, 2);
assert.equal((normalizedUp.match(/grant update \(/g) ?? []).length, 2);

assert.match(up, /C04_0165_WINE_METADATA_HISTORY_INVALID/);
assert.match(up, /C04_0165_INVOICE_PATH_HISTORY_INVALID/);
assert.match(up, /C04_0165_ACTIVE_RETRY_CACHE_HISTORY_INVALID/);
assert.match(up, /C04_0165_AUTHENTICATED_ACL_BASELINE_INVALID/);
assert.match(up, /C04_0165_STORAGE_POLICY_DDL_AUTHORITY_MISSING/);
assert.match(up, /C04_0165_LOCKED_STORAGE_POLICY_BASELINE_INVALID/);
assert.match(up, /pg_has_role\(current_user, c\.relowner, 'USAGE'\)/);
assert.match(normalizedUp, /lock table storage\.objects in access exclusive mode nowait;/);
assert.match(up, /terroir\.c04_0165_compatible_app_sha/);
assert.match(up, /terroir\.c04_0165_caller_receipt_sha256/);
assert.match(up, /terroir\.c04_0165_structural_receipt_sha256/);
assert.match(up, /terroir\.c04_0165_history_receipt_sha256/);
assert.match(up, /C04_0165_MIGRATION_LEDGER_INVALID/);
assert.match(up, /count\(\*\) from supabase_migrations\.schema_migrations\) <> 136/);
assert.match(up, /max\(version\) from supabase_migrations\.schema_migrations/);

assert.match(normalizedUp, /drop policy "members can read invoice images" on storage\.objects;/);
assert.match(normalizedUp, /drop policy "members can upload invoice images" on storage\.objects;/);
assert.match(normalizedUp, /from public\.read_invoice_image_target\(/);
const forwardPolicy = normalizedUp.slice(normalizedUp.lastIndexOf('create policy "members can read invoice images"'));
const forwardReadPolicy = forwardPolicy.slice(0, forwardPolicy.indexOf('drop policy "members can upload invoice images"'));
assert.doesNotMatch(forwardReadPolicy, /public\.is_member\(\(\(storage\.foldername\(name\)\)\[1\]\)::uuid\)/);
assert.match(forwardPolicy, /create policy "members can upload invoice images"[\s\S]*with check \([\s\S]*name ~ '\^\[0-9a-f\]/);
assert.match(normalizedDown, /public\.is_member\(\(\(storage\.foldername\(name\)\)\[1\]\)::uuid\)/);
assert.match(normalizedUp, /revoke execute on function public\.dismiss_pricing_alert\(uuid,integer\) from public, anon, authenticated, service_role;/);
assert.match(normalizedDown, /grant execute on function public\.dismiss_pricing_alert\(uuid,integer\) to public;/);

assert.match(down, /terroir\.c04_0165_traffic_quiesced/);
assert.match(down, /terroir\.c04_0165_legacy_app_receipt_sha256/);
assert.match(down, /C04_0165_DOWN_MIGRATION_LEDGER_INVALID/);
assert.match(normalizedDown, /grant maintain, references, select, trigger, truncate on public\.identity_merge_log to authenticated;/);
assert.match(normalizedDown, /grant insert, maintain, references, select, trigger, truncate on public\.invoice_scan_deletions to authenticated;/);
assert.match(down, /C04_0165_DOWN_ACL_POSTIMAGE_INVALID/);
assert.match(down, /C04_0165_DOWN_STORAGE_POLICY_DDL_AUTHORITY_MISSING/);
assert.match(down, /C04_0165_DOWN_LOCKED_STORAGE_POLICY_PREIMAGE_INVALID/);
assert.match(down, /C04_0165_DOWN_STORAGE_POLICY_POSTIMAGE_INVALID/);
assert.match(up, /pg_get_userbyid\(c\.relowner\) = 'supabase_storage_admin'/);
assert.match(up, /\(\(bucket_id = ''invoice-images''::text\) AND public\.is_member/);
const businessWrites = /\b(?:delete\s+from|insert\s+into|update\s+(?:public|storage)\.|truncate\s+table|drop\s+table|cascade)/i;
const stripLedger = (source) => source
  .replace(/insert into supabase_migrations\.schema_migrations\(version, name\)\s+values \('0165', 'staff_cost_seal_contract'\);/, "")
  .replace(/delete from supabase_migrations\.schema_migrations\s+where version = '0165' and name = 'staff_cost_seal_contract';/, "");
assert.doesNotMatch(stripLedger(up + "\n" + down), businessWrites);
assert.match("delete from public.wines;", businessWrites);
assert.match("update public.wines set name = 'drift';", businessWrites);
assert.doesNotMatch(`${up}\n${down}`, /\bcreate\s+(?:or\s+replace\s+)?function\b|\balter\s+function\b/i);
assert.doesNotMatch(`${up}\n${down}`, /\bexecute\s+format\b|\bexecute\s+[^o]/i);

for (const source of [preflight, postflight]) {
  assert.match(source, /begin transaction isolation level repeatable read, read only;/i);
  assert.match(source, /rollback;\s*\\echo C04_0165_[A-Z_]+_PASS\s*$/);
  assert.doesNotMatch(source, /\b(insert|update|delete|truncate|alter|create|drop|grant|revoke)\b\s+(?:table|policy|function|into|public\.|storage\.)/i);
}
assert.match(preflight, /C04_0165_WINE_METADATA_HISTORY_INVALID/);
assert.match(preflight, /C04_0165_INVOICE_PATH_HISTORY_INVALID/);
assert.match(preflight, /C04_0165_ACTIVE_RETRY_CACHE_HISTORY_INVALID/);
assert.match(preflight, /"itemCount":0/);
assert.match(preflight, /"itemCount":1/);
assert.match(preflight, /response_body->>'wineCount'/);
assert.match(postflight, /C04_0165_POSTFLIGHT_ACL_INVALID/);
assert.match(postflight, /C04_0165_POSTFLIGHT_POLICY_INVALID/);


for (const source of [up, down]) {
  assert.equal((source.match(/^begin;$/gm) ?? []).length, 1);
  assert.equal((source.match(/^commit;$/gm) ?? []).length, 1);
  assert.match(source, /lock table supabase_migrations\.schema_migrations in access exclusive mode nowait;/);
  assert.match(source, /set local row_security = off;/);
  assert.match(source, /pg_has_role\(current_user, c\.relowner, 'USAGE'\)/);
  assert.doesNotMatch(source, /pg_has_role\([^\n]+, 'MEMBER'\)/);
  assert.doesNotMatch(source, /\b(?:alter role|create role|owner to|grant [a-z_]+ to postgres)\b/i);
  assert.match(source, /current_user <> session_user or current_user not in \('postgres', 'supabase_admin'\)/);
  assert.match(source, /case when current_user = 'supabase_admin' then r\.rolsuper\s+else r\.rolsuper or r\.rolbypassrls end into v_privileged/);
}
assert.match(up, /insert into supabase_migrations\.schema_migrations\(version, name\)\s+values \('0165', 'staff_cost_seal_contract'\);/);
assert(up.indexOf("insert into supabase_migrations") > up.indexOf("$c04_0165_postflight$;"));
assert(up.indexOf("insert into supabase_migrations") < up.lastIndexOf("commit;"));
assert.match(down, /delete from supabase_migrations\.schema_migrations\s+where version = '0165' and name = 'staff_cost_seal_contract';/);
assert(down.indexOf("delete from supabase_migrations") > down.indexOf("$c04_0165_down_policy_postimage$;"));
assert(down.indexOf("delete from supabase_migrations") < down.lastIndexOf("commit;"));
assert.match(up, /notify pgrst, 'reload schema';/);
assert.match(down, /notify pgrst, 'reload schema';/);

// A nullable valid-receipt union must refuse both FALSE and UNKNOWN.
for (const source of [up, preflight]) {
  const start = source.indexOf("select 1 from public.scan_idempotency c");
  const end = source.indexOf("C04_0165_ACTIVE_RETRY_CACHE_HISTORY_INVALID", start);
  const cacheGate = source.slice(start, end);
  assert.match(cacheGate, /\) is distinct from true/);
  assert.doesNotMatch(cacheGate, /or not \(/);
}
assert.doesNotMatch(up, /is distinct from '589a62d69d2a68976d1fe2a6965cd4bb86123f75'/);
assert.match(up, /compatible_app_sha[^\n]+\n\s*!~ '\^\[0-9a-f\]\{40\}\$'/);
assert.match(down, /terroir\.c04_0165_contract_policy_sha256/);
assert.match(postflight, /terroir\.c04_0165_contract_policy_sha256/);
assert.match(up, /C04_0165_APPLIED_STORAGE_POLICY_SHA256/);
assert(up.indexOf("$c04_0165_catalog_admission$;") < up.indexOf("select 1 from public.wines w"));
assert(up.indexOf("$c04_0165_locked_history_admission$;") < up.indexOf("revoke all privileges on table"));
const uploadPolicy = up.slice(up.lastIndexOf('create policy "members can upload invoice images"'), up.indexOf("do $c04_0165_postflight$"));
assert.match(uploadPolicy, /read_current_operational_memberships\(\(select auth\.uid\(\)\)\)/);
assert.match(uploadPolicy, /member\.restaurant_id = \(\(storage\.foldername\(name\)\)\[1\]\)::uuid/);
assert.doesNotMatch(uploadPolicy, /public\.is_member/);

assert.equal(baseline.routines.length, 62);
assert.equal(new Set(baseline.routines.map((row) => row.signature)).size, 62);
assert.equal(baseline.constraints.length, 7);
for (const source of [up, down, preflight, postflight]) {
  assert.match(source, /C04_0165_FULL_RELATION_ACL_DRIFT/);
  assert.match(source, /C04_0165_FULL_STORAGE_POLICY_DRIFT/);
  assert.match(source, /C04_0165_ROUTINE_DEPENDENCY_DRIFT/);
  assert.match(source, /C04_0165_CONSTRAINT_DEPENDENCY_DRIFT/);
  assert.match(source, /C04_0165_RELATION_OR_SEQUENCE_DRIFT/);
  assert.match(source, /C04_0165_INVOICE_BUCKET_DRIFT/);
  assert.match(source, /not exists \(select 1 from resolved admitted where admitted\.oid = p\.oid\)/);
  assert.match(source, /a\.grantor <> pg_catalog\.to_regrole\('postgres'\) or a\.is_grantable/);
  assert.match(source, /c\.condeferrable or c\.condeferred/);
  // pg_get_userbyid returns name; the compared grant allowlist is text[].
  const granteeArray = source.match(/or array\(select case[\s\S]*?\) <> r\.grantees/)[0];
  const textGrantee = /pg_get_userbyid\(a\.grantee\)::text end\s+from/;
  assert.match(granteeArray, textGrantee);
  assert.doesNotMatch(granteeArray.replace("pg_get_userbyid(a.grantee)::text", "pg_get_userbyid(a.grantee)"), textGrantee);
  for (const row of baseline.routines) {
    const grants = row.grantees.filter((role) =>
      !([down, postflight].includes(source) && row.signature === "public.dismiss_pricing_alert(uuid,integer)" && role === "PUBLIC"));
    assert(source.includes(`('${row.signature}', '${row.sha256}', array[${grants.map((role) => `'${role}'`).join(", ")}]::text[])`));
  }
  for (const row of baseline.constraints) {
    assert(source.includes(`('${row.relation}', '${row.name}', '${row.type}', '${row.sha256}')`));
  }
}
for (const source of [up, preflight]) assert(source.includes(baseline.storageBaselineSha256));
for (const source of [up, down, postflight]) assert(source.includes(baseline.winePoliciesSha256));
assert(up.includes(baseline.aclBaselineSha256) && up.includes(baseline.aclContractSha256));
assert(down.includes(baseline.aclBaselineSha256) && down.includes(baseline.aclContractSha256));
const ciApply = read("scripts/local/ci-apply-staff-cost-seal.sh");
assert.match(ciApply, /refusing outside CI/);
assert.match(ciApply, /terroir-vw-local/);
assert.match(ciApply, /scripts\/staff-cost-seal-baseline-preflight\.sql/);
assert.match(ciApply, /scripts\/staff-cost-background-jobs-preflight\.sql/);
assert.match(ciApply, /supabase\/tests\/0165_staff_cost_seal_contract\/preflight\.sql/);
assert.match(ciApply, /C04_0165_APPLIED_STORAGE_POLICY_SHA256/);
assert.match(ciApply, /-qAt -U supabase_admin -d postgres -f -/);
assert.doesNotMatch(ciApply, /--single-transaction|insert into supabase_migrations|\.env\.local/);
assert.doesNotMatch(ciApply, /b5f1d7bc2307650124a1714e9c114ceb263f42bfa7f80643669a1c6bb2b64ecb|7dd7a60a2fd61f3614cb6c417f29ae06ac61730fb801fba1215953d590d4dbcd/);

console.log("C04_0165_SOURCE_CONTRACT_PASS");
