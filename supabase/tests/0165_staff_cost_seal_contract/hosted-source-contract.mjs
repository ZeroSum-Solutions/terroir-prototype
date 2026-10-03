import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { prepareHostedDryRun } from "./prepare-hosted-dry-run.mjs";

const root = resolve(import.meta.dirname, "../../..");
const read = (path) => readFileSync(resolve(root, path), "utf8");
const upPath = "supabase/migrations/0165_staff_cost_seal_contract.sql";
const downPath = "supabase/migrations/down/0165_staff_cost_seal_contract.down.sql";
const up = read(upPath);
const down = read(downPath);
const pre = read("supabase/tests/0165_staff_cost_seal_contract/preflight.sql");
const post = read("supabase/tests/0165_staff_cost_seal_contract/postflight.sql");
const baseline = JSON.parse(read("supabase/tests/0165_staff_cost_seal_contract/baseline.json"));
const raw = read("supabase/tests/0165_staff_cost_seal_contract/hosted-baseline.json");
const capture = JSON.parse(raw);
const catalog = capture.catalog;
const hash = (value) => createHash("sha256").update(value).digest("hex");
const tupleHash = (rows) => hash(rows.map((row) => JSON.stringify(row)).sort().join("\n"));
const expected = {
  capture: "0b47bfeff9b43a382585b27d096c679917f1a165181c0765f11fef7145840ec2",
  acl: "a8a92931df21d2d4e7e114389351e73453b0c8b02564539cd022e07ec953423f",
  contract: "453a8013bb768e7e83a98905a6dbdfcc2b729a7413aab48d4b7565a1640649aa",
  policies: "bd884801329f87ec2d757a091fc3e5474e2862f13db5a402c0fcd333e7f5b7e6",
  wine: "51c8f43961616831da012bc662fd3421bb0e986a12b7c09ef51926fb6213ee99",
};
assert.equal(capture.project, "qcfmwphlaekfkqwkfyth");
assert.equal(capture.organization, "zljkaiwwkbpeyjsblwyb");
assert.equal(catalog.current_user, "supabase_read_only_user");
assert.equal(catalog.transaction_read_only, "on");
assert.deepEqual(catalog.ledger, { count: 136, maximum: "0164" });
assert.equal(hash(raw), expected.capture);
assert.equal(catalog.acl.length, 352);
assert.equal(catalog.policies.length, 6);
assert.equal(tupleHash(catalog.acl), expected.acl);
assert.equal(tupleHash(catalog.policies), expected.policies);
assert.equal(tupleHash(catalog.policies.filter((row) => row[5].includes("wine images"))), expected.wine);
assert.notEqual(tupleHash(catalog.acl.concat([catalog.acl[0]])), expected.acl);
assert.notEqual(tupleHash(catalog.policies.slice(1)), expected.policies);
const safe = [...up.matchAll(/grant\s+(select|insert|update)\s*\(([\s\S]*?)\)\s+on public\.([a-z_]+) to authenticated;/g)]
  .flatMap((match) => match[2].split(",").map((column) => ["public", match[3], column.trim(),
    "postgres", "postgres", "authenticated", match[1].toUpperCase(), "f"]));
assert.equal(safe.length, 223);
assert.equal(tupleHash(catalog.acl.filter((row) => row[5] !== "authenticated").concat(safe)), expected.contract);
assert.equal(catalog.routines.length, 62);
for (const row of catalog.routines) {
  assert.equal(row.owner, "postgres");
  assert.equal(row.kind, "f");
  assert.equal(row.sha256, baseline.routines.find((item) => item.signature === row.signature)?.sha256);
  for (const acl of row.acl) assert(acl[0] === "postgres" && acl[2] === "EXECUTE" && acl[3] === false);
}
assert.equal(catalog.constraints.length, 7);
for (const row of catalog.constraints) {
  assert.equal(row.sha256, baseline.constraints.find((item) => item.name === row.name)?.sha256);
  assert(row.validated && !row.deferrable && !row.deferred);
}
assert.equal(catalog.sequences, 0);
assert(catalog.relations.every((row) => row.owner === "postgres" && row.rls && !row.force_rls));
assert.deepEqual(catalog.acl.filter((row) => row[5] === "authenticated" && row[2] !== "").map((row) => row.slice(1)), [
  ["restaurants", "auto_eightysix_from_inventory", "postgres", "postgres", "authenticated", "UPDATE", "f"],
  ["restaurants", "eightysix_ml_threshold", "postgres", "postgres", "authenticated", "UPDATE", "f"],
]);
// D operational statements and policies are byte-identical to the green source.
// Digests measured from git show 33d662230e376eb53002b6416e38f7c9f8a6ec16.
// Pin digests directly so shallow CI checkouts need no history fetch.
const operational = (source) => source.slice(source.indexOf("revoke all privileges on table"), source.indexOf("do $c04_0165_postflight$"));
assert.equal(hash(operational(up)), "a2e809939a37cd94ebcea2180285b2e31670c52ee6413cd4d8dee3422f30945f");
const dBranch = down.slice(down.indexOf("  else\n", down.indexOf("do $c04_0165_restore_measured_acl$")) + 7,
  down.indexOf("  end if;\nend;\n$c04_0165_restore_measured_acl$;"));
assert.equal(hash(dBranch.split("\n").map((line) => line.startsWith("    ") ? line.slice(4) : line).join("\n").trim()),
  "547172ad1afdb9d4f9c53b0b81b156a335bf72fa75f086bbda6b58aa7845efd5");
for (const source of [up, pre]) {
  assert.match(source, new RegExp(`if v_hash = '${baseline.aclBaselineSha256}' then[\\s\\S]*elsif v_hash = '${expected.acl}' then[\\s\\S]*else[\\s\\S]*raise exception 'C04_0165_FULL_RELATION_ACL_DRIFT'`));
  assert(source.includes(expected.policies));
}
for (const source of [up, down, pre, post]) {
  assert(source.includes(expected.acl) || source.includes(expected.contract));
  assert.match(source, /array\['anon', 'authenticated', 'postgres', 'service_role'\]::text\[\]/);
  assert.match(source, /array\['image\/jpeg','image\/png','image\/webp','image\/gif','application\/pdf'\]::text\[\]/);
}
for (const source of [down, post]) {
  assert.match(source, /select statements into v_statements from supabase_migrations\.schema_migrations/);
  assert.match(source, /if v_statements is null then[\s\S]*elsif v_statements = array\['-- C04_0165_HOSTED_BASELINE_ACL_SHA256\|[0-9a-f]{64}'\]::text\[\] then[\s\S]*else[\s\S]*C04_0165_BASELINE_MARKER_INVALID/);
}
assert.match(down, /grant update \(auto_eightysix_from_inventory, eightysix_ml_threshold\)\s+on public\.restaurants to authenticated;/);
assert.match(down, /C04_0165_RESTORED_DISMISS_ACL_DRIFT/);
const authorityRaw = read("supabase/tests/0165_staff_cost_seal_contract/hosted-authority-readonly.json");
assert.equal(hash(authorityRaw), "6d4fc14a87a2a3bfbee1162de18b90f15a235d11c9c292cc15390ba357a814af");
const authority = JSON.parse(authorityRaw);
assert.equal(authority.project, capture.project);
assert.equal(authority.organization, capture.organization);
assert.equal(authority.catalog.current_user, "supabase_read_only_user");
assert.equal(authority.catalog.transaction_read_only, "on");
const settings = new Map(authority.catalog.settings.map((row) => [row.name, row]));
assert.equal(settings.get("session_preload_libraries").setting, "supautils");
assert.equal(settings.get("session_preload_libraries").context, "superuser");
assert.equal(settings.get("supautils.policy_grants").context, "sighup");
assert.equal(settings.get("supautils.policy_grants").source, "configuration file");
assert(JSON.parse(settings.get("supautils.policy_grants").setting).postgres.includes("storage.objects"));
assert.equal(settings.get("supautils.superuser").setting, "supabase_admin");
assert.deepEqual(authority.catalog.postgres, {
  storage_schema_usage: true, storage_owner_usage: false, objects_select: true,
  objects_update: true, objects_delete: true, objects_truncate: true, objects_maintain: true,
});
for (const source of [up, down]) {
  const start = source.indexOf("do $c04_0165_storage_authority$");
  const end = source.indexOf("$c04_0165_storage_authority$;", start);
  const guard = source.slice(start, end);
  assert.equal(source.indexOf("C04_0165_STORAGE_POLICY_DDL_AUTHORITY_MISSING", 0) >= 0 ||
    source.indexOf("C04_0165_DOWN_STORAGE_POLICY_DDL_AUTHORITY_MISSING", 0) >= 0, true);
  assert(start > source.indexOf("$c04_0165_catalog_admission$;"));
  assert(end < source.indexOf("revoke all privileges on table") ||
    end < source.indexOf("revoke select, insert, update, delete, truncate"));
  assert.match(guard, /pg_has_role\(current_user, c\.relowner, 'USAGE'\)\s+or \(/);
  assert.match(guard, /current_setting\('terroir\.c04_0165_hosted_baseline', true\) = 'on'\s+and current_user = 'postgres' and session_user = 'postgres'/);
  assert.match(guard, /has_schema_privilege\(current_user, n\.oid, 'USAGE'\)/);
  assert.match(guard, /has_table_privilege\(\s+current_user, c\.oid, 'MAINTAIN,UPDATE,DELETE,TRUNCATE'\s+\)/);
  assert.match(guard, /s\.name = 'session_preload_libraries' and s\.context = 'superuser'\s+and s\.source = 'configuration file' and s\.setting = 'supautils'/);
  assert.match(guard, /s\.name = 'supautils\.policy_grants'\s+and s\.context = 'sighup' and s\.source = 'configuration file'\s+and \(s\.setting::jsonb -> 'postgres'\) @> '\["storage\.objects"\]'::jsonb/);
  assert.match(guard, /s\.name = 'supautils\.superuser' and s\.context = 'sighup'\s+and s\.setting = 'supabase_admin' and r\.rolsuper/);
}
// Catalog-only evidence for the inherited invoker queue EXECUTE ACLs, not a
// runtime service-only/whole-queue closure assertion. TRUNCATE remains inherited.
assert.equal(authority.catalog.background_jobs.owner, "postgres");
assert.equal(authority.catalog.background_jobs.rls, true);
assert.deepEqual(authority.catalog.background_jobs.policies.map((row) => [row.command, row.roles]),
  [["r", ["authenticated"]]]);
assert(!authority.catalog.background_jobs.acl.some((row) => row[1] === "authenticated" &&
  ["INSERT", "UPDATE", "DELETE"].includes(row[2])));
const derivative = prepareHostedDryRun(up);
assert.match(derivative, /\nrollback;\n$/);
assert.doesNotMatch(derivative, /C04_0165_APPLIED_STORAGE_POLICY_SHA256|^commit;$/m);
assert.equal(derivative.replace("C04_0165_DRY_RUN_STORAGE_POLICY_SHA256", "C04_0165_APPLIED_STORAGE_POLICY_SHA256")
  .replace(/\nrollback;\n$/, "\ncommit;\n"), up);
assert.throws(() => prepareHostedDryRun(up.replace(/\ncommit;\n$/, "\ncommit;\nselect 1;\n")));
assert.throws(() => prepareHostedDryRun(up.replace(/\ncommit;\n$/, "\ncommit;\ncommit;\n")));
console.log("C04_0165_HOSTED_SOURCE_CONTRACT_PASS");
