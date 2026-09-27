import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const paths = {
  up: resolve(here, '../../migrations/0162_bin_code_inventory_mirror.sql'),
  down: resolve(here, '../../migrations/down/0162_bin_code_inventory_mirror.down.sql'),
  contract: resolve(here, 'bin-code-mirror-contract.sql'),
  atomic: resolve(here, 'atomic-failure.sql'),
  cycle: resolve(here, 'migration-cycle.sql'),
  concurrencySetup: resolve(here, 'concurrency-setup.sql'),
  concurrencyA: resolve(here, 'concurrency-a.sql'),
  concurrencyB: resolve(here, 'concurrency-b.sql'),
  concurrencyObserve: resolve(here, 'concurrency-observe.sql'),
  concurrencyCleanup: resolve(here, 'concurrency-verify-cleanup.sql'),
  readme: resolve(here, 'README.md'),
};
const sources = Object.fromEntries(
  Object.entries(paths).map(([name, path]) => [name, readFileSync(path, 'utf8')]),
);
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const expectedHashes = {
  up: 'c899f1f5113773f0cc826a227bc0c800c4303cc2a6bc5a945bd5b040ced01955',
  down: '6e1b440085f3474c48b84194dc4a02021a54ee7e9aa4b9ce1adfd821638fc53f',
  contract: '24d77f92e652fce41cb00f7a17c130d3e0454333c85dc7fa8d23880205e6136c',
  atomic: '3c1938f909c248fdb380511f467f6f8682c0c48daf5ba1921dcb2ed882736c96',
  cycle: '6472c220ac9e46ff5694c41eb531b754a9c01530630c3f8289bd083f8397c311',
  concurrencySetup: 'f895730c5b19280877388aaf1b5ba18329a4bbf4ea693f0e6c59e6a1e4360add',
  concurrencyA: 'e654fddd9fa6c614855f3f99e2eaee058025c3a4f676e119eeefe711a2eb6c2a',
  concurrencyB: 'fd386097eae1dd05f33035554e9fdfe57d5913e29996e53386651bac17e796fb',
  concurrencyObserve: '9d9f8d948556c07e4c18dc87c382135076090bbc54dd22c19118127c207d756b',
  concurrencyCleanup: 'cead71a0855bdbc4ec30d74f1b810cc5a03fadef9bd01a43fd70fb32dbe0c6c3',
  readme: '331c07b82d22754f402951a91362361673667cf51afbf9875ef45b86705a264b',
};

for (const [name, expected] of Object.entries(expectedHashes)) {
  assert.equal(sha256(sources[name]), expected, `${name} bytes drifted`);
}
for (const [name, source] of Object.entries(sources)) {
  assert.doesNotMatch(source, /__0162_/, `${name} retains a source placeholder`);
}

const bodyMatch = sources.up.match(/as \$function\$([\s\S]*?)\$function\$;/);
assert.ok(bodyMatch, '0162 trigger function body must be extractable');
const body = bodyMatch[1];
assert.equal(
  sha256(body),
  '39d03433e9ccd05bb77e01c9f313acb8e271a8cd923c3e92776187c3f8d639f9',
  '0162 trigger function body drifted',
);
assert.match(
  sources.up,
  /create function public\.mirror_bin_code_to_inventory_items\(\)\s+returns trigger\s+language plpgsql\s+security definer\s+set search_path = ''/,
);
assert.doesNotMatch(
  sources.up,
  /create or replace function public\.mirror_bin_code_to_inventory_items/,
);
assert.match(
  body,
  /update public\.inventory_items as item\s+set bin_location = new\.code\s+where item\.bin_id = new\.id\s+and item\.restaurant_id = new\.restaurant_id;/,
);
assert.equal(
  [...body.matchAll(/\bupdate\b/gi)].length,
  1,
  'trigger function must own one update only',
);
for (const forbidden of [
  'inventory_command_receipts', 'reconcile_actions', 'reconcile_batches',
  'open_bottles', 'pour_events', 'stock_adjustments', 'bottle_closeouts',
  'execute ', 'dynamic', 'auth.uid',
]) {
  assert.ok(!body.includes(forbidden), `trigger body contains forbidden ${forbidden}`);
}
assert.match(
  sources.up,
  /create trigger bins_mirror_code_to_inventory_items\s+after update of code on public\.bins\s+for each row\s+when \(new\.code is distinct from old\.code\)\s+execute function public\.mirror_bin_code_to_inventory_items\(\);/,
);
assert.match(
  sources.up,
  /revoke all on function public\.mirror_bin_code_to_inventory_items\(\)\s+from public, anon, authenticated, service_role;/,
);
assert.match(
  sources.up,
  /alter function public\.mirror_bin_code_to_inventory_items\(\) owner to postgres;/,
);
assert.doesNotMatch(sources.up, /grant execute on function/i);
assert.doesNotMatch(sources.up, /(?:create|alter|drop) policy/i);
assert.doesNotMatch(sources.up, /grant .* on (?:table )?public\./i);

const expectedTriggerDefinition =
  'CREATE TRIGGER bins_mirror_code_to_inventory_items AFTER UPDATE OF code ON public.bins FOR EACH ROW WHEN ((new.code IS DISTINCT FROM old.code)) EXECUTE FUNCTION public.mirror_bin_code_to_inventory_items()';
for (const name of ['up', 'down', 'contract']) {
  assert.doesNotMatch(
    sources[name],
    /pg_catalog\.pg_get_expr\s*\(/,
    `${name} must not deparse an OLD/NEW trigger condition with pg_get_expr`,
  );
  assert.ok(
    sources[name].includes('pg_catalog.pg_get_triggerdef('),
    `${name} must use the supported trigger-definition deparser`,
  );
  assert.equal(
    [...sources[name].matchAll(/pg_catalog\.set_config\('search_path'/g)].length,
    3,
    `${name} must set an empty path and restore it on success and error`,
  );
  assert.ok(
    sources[name].includes("pg_catalog.set_config('search_path', '', true)"),
    `${name} must deparse with an empty transaction-local search path`,
  );
  assert.ok(
    sources[name].includes(`<> '${expectedTriggerDefinition}'`),
    `${name} must compare the complete canonical trigger definition`,
  );
}

assert.match(
  sources.down,
  /drop trigger bins_mirror_code_to_inventory_items on public\.bins;/,
);
assert.match(
  sources.down,
  /drop function public\.mirror_bin_code_to_inventory_items\(\) restrict;/,
);
assert.doesNotMatch(sources.down, /\bcascade\b/i);
assert.doesNotMatch(
  sources.down.replace(expectedTriggerDefinition, ''),
  /\b(?:insert\s+into|update|delete\s+from)\b/i,
  'down must contain no data write outside the pinned trigger definition',
);
assert.doesNotMatch(sources.down, /(?:grant|revoke|alter table|create policy|alter policy)/i);

for (const token of [
  'C07_0162_EXACT_SITE_MIRROR_FAILED',
  'C07_0162_UNRELATED_OR_HISTORY_CHANGED',
  'c07_0162_staff_refused',
  'c07_0162_cross_site_refused',
  'c07_0162_revoked_authority_refused',
  'current_site_role_at_least',
  'inventory_command_receipts',
  'reconcile_actions',
  'rollback;',
]) {
  assert.ok(sources.contract.includes(token), `functional proof missing ${token}`);
}
for (const token of [
  'C07_0162_FORCED_INVENTORY_FAILURE',
  'unique_violation',
  "sqlstate <> '23505'",
  'C07_0162_ATOMIC_ROLLBACK_FAILED',
  'rollback;',
]) {
  assert.ok(sources.atomic.includes(token), `atomic proof missing ${token}`);
}
assert.ok(sources.cycle.includes('C07_0162_MIGRATION_CYCLE_PASS'));
assert.ok(sources.cycle.includes(
  '\\ir ../../migrations/down/0162_bin_code_inventory_mirror.down.sql',
));
assert.ok(sources.cycle.includes(
  '\\ir ../../migrations/0162_bin_code_inventory_mirror.sql',
));
assert.match(sources.concurrencyA, /set code='RACE-A'/);
assert.match(sources.concurrencyA, /pg_catalog\.pg_sleep\(8\)/);
assert.match(sources.concurrencyB, /set code='RACE-B'/);
assert.match(sources.concurrencyObserve, /wait_event_type='Lock'/);
assert.match(
  sources.concurrencyCleanup,
  /C07_0162_CONCURRENT_RENAME_SERIALIZATION_FAILED/,
);
assert.match(sources.concurrencyCleanup, /and ii\.bin_location='RACE-B'/);
for (const token of [
  'C07_0162_CONCURRENCY_CLEANUP_SCOPE_MISMATCH',
  'from c07_0162_owned_restaurants) <> 2',
  'from c07_0162_owned_workspaces) <> 2',
  "and owned.name='My Restaurant'",
  'from public.memberships m',
  'from public.workspace_memberships wm',
  'join c07_0162_owned_restaurants owned',
  'join c07_0162_owned_workspaces owned',
  "where m.user_id<>'16240000-0000-4000-8000-000000000001'",
  "where wm.user_id<>'16240000-0000-4000-8000-000000000001'",
]) {
  assert.ok(
    sources.concurrencyCleanup.includes(token),
    `concurrency cleanup scope proof missing ${token}`,
  );
}

console.log('C07_0162_SOURCE_CONTRACT_PASS');
