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
  down: resolve(root, 'supabase/migrations/down/0164_import_revert_cleanup.down.sql'),
  matrix: resolve(here, 'extended-matrix.sql'),
  readme: resolve(here, 'EXTENDED.md'),
};
const sources = Object.fromEntries(
  Object.entries(paths).map(([name, path]) => [name, readFileSync(path, 'utf8')]),
);
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const expectedHashes = {
  contract: '8f41d6035ac14dea6a930d22f6bbbe717f451febcfcd508bd1e3ddd0faf695ef',
  up: 'b5416022789c096d9b94245770e543465d74a02f60c847270254e862545294ad',
  down: '028cded1c804b769c1a127179f02523a80ae1c968edb6b3ac13af87be2e2f9bb',
  matrix: '5ffa83373f8c0a5ce71a166fc4bfff50fc260b84a0e65bec183ba139751c2ee2',
  readme: '251fd64750dc9a5e15f4c42846e65b52aa84e3afc1b574d10d5a71091ffbf2ca',
};
for (const [name, expected] of Object.entries(expectedHashes)) {
  assert.equal(sha256(sources[name]), expected, `${name} bytes drifted`);
}
for (const source of Object.values(sources)) {
  assert.doesNotMatch(source, /__0164_|BODY_SHA256/, 'placeholder remains');
}

assert.equal((sources.matrix.match(/apply_import_batch_chunk\(/g) ?? []).length, 15);
assert.equal((sources.matrix.match(/content_sha256/g) ?? []).length, 1);
assert.match(sources.matrix, /set local session_replication_role='replica';[\s\S]*set local session_replication_role='origin';/);
for (const token of [
  'C09_0164_LWIN_POSITIVE_FAILED',
  'C09_0164_LWIN_NEWER_FAILED',
  'C09_0164_LWIN_DIFFERENT_ID_FAILED',
  'C09_0164_LWIN_DIFFERENT_SCORE_FAILED',
  'C09_0164_LWIN_LOW_SCORE_FAILED',
  'C09_0164_LWIN_OUTSIDE_CLAIM_FAILED',
  'C09_0164_LWIN_EMPTY_FAILED',
  'C09_0164_LWIN_DUPLICATE_COUNT_FAILED',
  'C09_0164_LWIN_UNRELATED_WINE_FAILED',
  'C09_0164_INJECTED_AFTER_LWIN',
  'C09_0164_INJECTED_AFTER_INVENTORY',
  'C09_0164_INJECTED_LATER_CHILD',
  'C09_0164_AFTER_LWIN_POSITION_INVALID',
  'C09_0164_AFTER_INVENTORY_POSITION_INVALID',
  'C09_0164_LATER_CHILD_POSITION_INVALID',
  'C09_0164_SESSION_PHYSICAL_NOT_REFUSED',
  'C09_0164_HISTORY_CONSERVATION_FAILED',
  'C09_0164_EXTENDED_MATRIX_PASS',
]) {
  assert.ok(sources.matrix.includes(token), `extended proof missing ${token}`);
}
for (const table of [
  'wines',
  'import_batch_rows',
  'open_bottles',
  'bottle_closeouts',
  'invoice_scans',
  'invoice_scan_deletions',
  'reconcile_actions',
  'identity_merge_log',
  'pour_events',
  'inventory_command_receipts',
  'wine_notes',
  'availability_events',
  'cellar_health',
  'pricing_recommendations',
  'stock_adjustments',
  'producer_backfill_audit',
]) {
  assert.ok(sources.matrix.includes(`public.${table}`), `history proof missing ${table}`);
}
assert.equal((sources.matrix.match(/using errcode='P0099'/g) ?? []).length, 4);
assert.equal((sources.matrix.match(/create temporary sequence c09_0164_/g) ?? []).length, 3);
assert.equal((sources.matrix.match(/pg_catalog\.nextval\('pg_temp\.c09_0164_/g) ?? []).length, 3);
assert.match(sources.matrix, /rollback;\n\\echo C09_0164_EXTENDED_MATRIX_PASS\n$/);

console.log('C09_0164_EXTENDED_SOURCE_CONTRACT_PASS');
