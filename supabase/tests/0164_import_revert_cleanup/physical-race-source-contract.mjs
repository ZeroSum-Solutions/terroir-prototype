import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../..');
const paths = {
  contract: resolve(root, 'docs/plans/2026-09-27-terroir-import-revert-cleanup.md'),
  up: resolve(root, 'supabase/migrations/0164_import_revert_cleanup.sql'),
  setup: resolve(here, 'physical-race-setup.sql'),
  a: resolve(here, 'physical-race-a.sql'),
  b: resolve(here, 'physical-race-b.sql'),
  observe: resolve(here, 'physical-race-observe.sql'),
  verify: resolve(here, 'physical-race-verify.sql'),
  cleanup: resolve(here, 'physical-race-cleanup.sql'),
  readme: resolve(here, 'PHYSICAL-RACE.md'),
};
const sources = Object.fromEntries(
  Object.entries(paths).map(([name, path]) => [name, readFileSync(path, 'utf8')]),
);
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const expectedHashes = {
  contract: '8f41d6035ac14dea6a930d22f6bbbe717f451febcfcd508bd1e3ddd0faf695ef',
  up: '2d535f329b600c3dfc33b23494532f93c023b1a89c6aad055b8de3a865ee49ff',
  setup: '2157bf932eae0403a1035a1cd46bed16726c8380b1bcce21d00f5e7b9576f20f',
  a: '01df63516e23b468ceb74c5c52793664afdb6bdcef4728d49476455e5089b2b5',
  b: '948c3e93928487e50510139d34097db30a46feea6cf82d3c88451b6f8a09720f',
  observe: '8f9d5b9d80597f53a6d8325d7bddef464bd7e177740bb9563e81305f800eae61',
  verify: '219b1e0f25c03ce8924e89c8a5f2ee979e6d2224a4184f2ecedaa8d24152c4f5',
  cleanup: '4aae98cb0991fbe7a9adbb54f4823682b5ec7f06f94a4d74f90ab97c91a041d2',
  readme: '15b7b15423dd55d1be3fa91a5d1e4be446884bb5cf34e6c5927c2d6f057176c6',
};
for (const [name, expected] of Object.entries(expectedHashes)) {
  assert.equal(sha256(sources[name]), expected, `${name} bytes drifted`);
}
for (const [name, source] of Object.entries(sources)) {
  assert.doesNotMatch(source, /__0164_|BODY_SHA256/, `${name} has a placeholder`);
}

assert.equal((sources.setup.match(/content_sha256/g) ?? []).length, 1);
assert.match(sources.setup, /apply_import_batch_chunk\(/);
assert.match(sources.setup, /r\.updated_at=w\.updated_at/);
assert.match(sources.setup, /r\.lwin_score=w\.lwin_match_score/);
assert.match(sources.a, /execute_physical_bottle_command\(/);
assert.match(sources.a, /revert_import_batch_private\(/);
assert.match(sources.a, /pg_catalog\.pg_sleep\(8\)/);
assert.match(sources.b, /sqlstate 'P04D3'[\s\S]*physical_bottle_dependency/);
assert.match(sources.b, /sqlstate 'P0001'[\s\S]*no_inventory/);
assert.equal((sources.b.match(/using errcode='P0099'/g) ?? []).length, 2);
assert.match(sources.observe, /wait_event_type='Lock'/);
assert.match(sources.observe, /wait_event in \('transactionid','tuple'\)/);
assert.match(sources.observe, /pg_catalog\.pg_blocking_pids/);
assert.match(sources.observe, /application_name='c09_0164_physical_a'/);
for (const token of [
  'c09_0164_open_first_exact_state',
  'c09_0164_revert_first_exact_state',
  "pe.kind='new_bottle'",
  "e.effect_type='open'",
  "w.lwin_id='LWIN-PHYSICAL-RACE'",
  'w.lwin_id is null',
]) {
  assert.ok(sources.verify.includes(token), `verification missing ${token}`);
}
for (const token of [
  'C09_0164_PHYSICAL_CLEANUP_SCOPE_MISMATCH',
  'C09_0164_PHYSICAL_CLEANUP_FAILED',
  'c09_0164_physical_owned_restaurants',
  'c09_0164_physical_owned_workspaces',
  "m.user_id<>'16460000",
  "wm.user_id<>'16460000",
  'delete from public.inventory_command_bottle_effects',
  'delete from public.pour_events',
  'delete from public.inventory_command_receipts',
  'delete from public.open_bottles',
]) {
  assert.ok(sources.cleanup.includes(token), `cleanup missing ${token}`);
}
assert.match(sources.cleanup, /source_0164_sha256/);
assert.match(sources.cleanup, /current_setting\('c09\.physical_race_mode'\)/);
assert.doesNotMatch(sources.cleanup, /\$c09_0164_physical_cleanup_scope\$[\s\S]*:'race_mode'/);
assert.equal((sources.cleanup.match(/<> \(case when v_open_first/g) ?? []).length, 5);
assert.doesNotMatch(sources.cleanup, /<> case when v_open_first/);
assert.match(sources.cleanup, /commit;\n\\echo C09_0164_PHYSICAL_RACE_CLEANUP_PASS\n$/);
assert.match(sources.readme, /No automatic retry is authorized/);

console.log('C09_0164_PHYSICAL_RACE_SOURCE_CONTRACT_PASS');
