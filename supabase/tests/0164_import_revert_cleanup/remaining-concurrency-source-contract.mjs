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
  lwinSetup: resolve(here, 'lwin-race-setup.sql'),
  lwinA: resolve(here, 'lwin-race-a.sql'),
  lwinB: resolve(here, 'lwin-race-b.sql'),
  lwinVerify: resolve(here, 'lwin-race-verify.sql'),
  conflictSetup: resolve(here, 'source-conflict-race-setup.sql'),
  conflictA: resolve(here, 'source-conflict-race-a.sql'),
  conflictB: resolve(here, 'source-conflict-race-b.sql'),
  conflictObserve: resolve(here, 'source-conflict-race-observe.sql'),
  conflictVerify: resolve(here, 'source-conflict-race-verify.sql'),
  conflictCleanup: resolve(here, 'source-conflict-race-cleanup.sql'),
  baseSetup: resolve(here, 'concurrency-setup.sql'),
  baseObserve: resolve(here, 'apply-revert-race-observe.sql'),
  baseCleanup: resolve(here, 'concurrency-cleanup.sql'),
  authorityBaseline: resolve(here, 'authority-wait-baseline.sql'),
  authorityA: resolve(here, 'authority-wait-a.sql'),
  authorityB: resolve(here, 'authority-wait-b.sql'),
  authorityRevoke: resolve(here, 'authority-wait-revoke.sql'),
  authorityVerify: resolve(here, 'authority-wait-verify.sql'),
  readme: resolve(here, 'REMAINING-CONCURRENCY.md'),
};
const sources = Object.fromEntries(
  Object.entries(paths).map(([name, path]) => [name, readFileSync(path, 'utf8')]),
);
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const expectedHashes = {
  contract: '8f41d6035ac14dea6a930d22f6bbbe717f451febcfcd508bd1e3ddd0faf695ef',
  up: 'b5416022789c096d9b94245770e543465d74a02f60c847270254e862545294ad',
  lwinSetup: '205469a0a87f2dcc5c23446474a6bfc7fc35754bebae6bc3556aa16837140fb6',
  lwinA: 'e5c52806aecab65d0e937ff5938f9548fe6ed5b8cd7ecd6c31d6695218b7ba31',
  lwinB: '99b76e1254408708571f94e369be3433cbe8cdb15b8bd3077fc3b725a71610a0',
  lwinVerify: '271e9c058da83dc78d9ac6ea388cb9a6c74f2edca589f30e78d0fc09821b79f5',
  conflictSetup: '1774c63b4cec83a00c17f89a8ad223d76a274bc7ace206bb1e6d39830aa923bb',
  conflictA: '016b48786d44ed864b06300580611c69c1d00270e33474d01282a4dbb3f8a05b',
  conflictB: '179060748b8b563355cb7a30d52a0ea7dadda8bb165d1ad199197aeeacffd1de',
  conflictObserve: 'e4bea653fa8f4a1ee8a4dec0ae3a88669647357b8edd5e3c48de8f5f64c3608b',
  conflictVerify: 'a943d421b333c5928c93c5063781c0b19e2674510c12182f96c3d8e9ebc6ba30',
  conflictCleanup: '389baf7a6770ed7a0ce8b3d7869d63037c41d33d7eba8ed44a111bdaa618483a',
  baseSetup: '0723fd93b35e1176f004a80f33ec7b92e27340bb545b7477f4e0f992298930a5',
  baseObserve: 'd7f6e6c98a2d3c820191a77a014e15fb9b4afd04e5dd0f441f1c178a99777667',
  baseCleanup: 'f91ac56dc65c352986150ae503b282a93783726c4518d8b11423fc3822f35707',
  authorityBaseline: '2797f9f85809702e3233713af4a4506035091550ea59b8376b06c6472d6a8077',
  authorityA: '74ff01cb3f26bc3816b2c48ae80178487f650a6f476e3f1609a84351d2e8d547',
  authorityB: 'e017244a684b7329f469bace9bdc5e07a8218a8c0d6ad9f645e7c42429d57335',
  authorityRevoke: '2bc382927db7f8cd4abcbff80fc1be7988a381cf39c4cdfd18778bfd1f205168',
  authorityVerify: '37c11b0958c17b61b6315aae35d78f6e3f231b8f685afab31c9d66ed95994309',
  readme: '823a2e3804edc29ff8554081e8db323862fd8e6685df6b83010e8c1da91a4fac',
};
for (const [name, expected] of Object.entries(expectedHashes)) {
  assert.equal(sha256(sources[name]), expected, `${name} bytes drifted`);
}
for (const [name, source] of Object.entries(sources)) {
  assert.doesNotMatch(source, /__0164_|BODY_SHA256/, `${name} has a placeholder`);
  assert.doesNotMatch(source, /pg_catalog\.coalesce/, `${name} qualifies SQL syntax`);
  if (name.endsWith('Setup') || name.endsWith('A') || name.endsWith('B')
      || name.endsWith('Verify') || name.endsWith('Cleanup')) {
    for (const block of source.matchAll(/\$([a-z0-9_]*)\$([\s\S]*?)\$\1\$/gi)) {
      assert.doesNotMatch(block[2], /:'[a-z0-9_]+'/i, `${name} interpolates inside dollar quote`);
    }
  }
}

assert.equal((sources.lwinSetup.match(/content_sha256/g) ?? []).length, 1);
assert.match(sources.lwinSetup, /LWIN-OLD-X[\s\S]*0\.7::real/);
assert.match(sources.lwinSetup, /LWIN-NEW-X[\s\S]*0\.9::real/);
assert.match(sources.lwinSetup, /apply_import_batch_chunk\(/);
assert.match(sources.lwinA, /'lwinStampsCleared',2/);
assert.match(sources.lwinB, /'lwinStampsCleared',0/);
assert.match(sources.lwinVerify, /fresh\.updated_at=w\.updated_at/);
assert.match(sources.lwinVerify, /w\.lwin_id='LWIN-NEW-X'/);
assert.match(sources.lwinVerify, /w\.lwin_id='LWIN-NEW-Y'/);

assert.equal((sources.conflictSetup.match(/content_sha256/g) ?? []).length, 2);
assert.match(sources.conflictSetup, /race_kind' in \('batch','session'\)/);
assert.match(sources.conflictSetup, /array_agg\(r\.applied_wine_id order by b\.chunk_index desc\)/);
assert.match(sources.conflictSetup, /array_agg\(r\.applied_inventory_item_id order by b\.chunk_index asc\)/);
assert.match(sources.conflictSetup, /before_state_sha256/);
assert.equal((sources.conflictA.match(/sqlstate 'P04I2'/g) ?? []).length, 2);
assert.equal((sources.conflictB.match(/sqlstate 'P04I2'/g) ?? []).length, 2);
assert.match(sources.conflictA, /pg_advisory_xact_lock[\s\S]*pg_catalog\.pg_sleep\(8\)/);
assert.match(sources.conflictObserve, /wait_event='advisory'/);
assert.match(sources.conflictObserve, /pg_catalog\.pg_blocking_pids/);
assert.match(sources.conflictVerify, /after_state_sha256'=:'before_state_sha256'/);
assert.match(sources.conflictCleanup, /source_conflict_before_sha256/);
assert.match(sources.conflictCleanup, /m\.user_id<>'16470000/);
assert.match(sources.conflictCleanup, /wm\.user_id<>'16470000/);
assert.equal((sources.conflictCleanup.match(/<> \(case when v_kind='session'/g) ?? []).length, 5);
assert.doesNotMatch(sources.conflictCleanup, /<> case when v_kind='session'/);

assert.match(sources.authorityA, /wait_kind' in \('advisory','batch'\)/);
assert.match(sources.authorityB, /sqlstate 'P0002'/);
assert.match(sources.authorityRevoke, /status='revoked'/);
assert.match(sources.authorityVerify, /before_state_sha256/);
assert.match(sources.readme, /no automatic retry/i);

console.log('C09_0164_REMAINING_CONCURRENCY_SOURCE_CONTRACT_PASS');
