import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../..');
const paths = {
  contract: resolve(root, 'docs/plans/2026-09-27-terroir-import-revert-cleanup.md'),
  manifest: resolve(root, 'docs/plans/2026-08-24-visual-wine-platform-spec-list.md'),
  appSpec: resolve(root, 'app_spec.txt'),
  up: resolve(root, 'supabase/migrations/0164_import_revert_cleanup.sql'),
  down: resolve(root, 'supabase/migrations/down/0164_import_revert_cleanup.down.sql'),
  readme: resolve(here, 'README.md'),
  functional: resolve(here, 'import-revert-contract.sql'),
  isolation: resolve(here, 'isolation-refusals.sql'),
  cycle: resolve(here, 'migration-cycle.sql'),
  forwardRefusal: resolve(here, 'forward-refusal-prerequisite.sql'),
  downBody: resolve(here, 'down-refusal-body.sql'),
  downMetadata: resolve(here, 'down-refusal-metadata.sql'),
  downDependent: resolve(here, 'down-refusal-dependent.sql'),
  raceA: resolve(here, 'apply-revert-race-a.sql'),
  raceB: resolve(here, 'apply-revert-race-b.sql'),
  raceObserve: resolve(here, 'apply-revert-race-observe.sql'),
  raceVerify: resolve(here, 'apply-revert-race-verify.sql'),
  concurrencySetup: resolve(here, 'concurrency-setup.sql'),
  concurrencyCleanup: resolve(here, 'concurrency-cleanup.sql'),
  authorityBaseline: resolve(here, 'authority-wait-baseline.sql'),
  authorityA: resolve(here, 'authority-wait-a.sql'),
  authorityB: resolve(here, 'authority-wait-b.sql'),
  authorityRevoke: resolve(here, 'authority-wait-revoke.sql'),
  authorityVerify: resolve(here, 'authority-wait-verify.sql'),
};
const sources = Object.fromEntries(
  Object.entries(paths).map(([name, path]) => [name, readFileSync(path, 'utf8')]),
);
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const expectedHashes = {
  contract: '8f41d6035ac14dea6a930d22f6bbbe717f451febcfcd508bd1e3ddd0faf695ef',
  up: '2d535f329b600c3dfc33b23494532f93c023b1a89c6aad055b8de3a865ee49ff',
  down: '028cded1c804b769c1a127179f02523a80ae1c968edb6b3ac13af87be2e2f9bb',
  readme: '3a351b0fe4eef041448e41e45a21db899810bbbf2c56d685f70b0a00274c5590',
  functional: 'ffb67585417ab6b5dcbcae7b0f03cff777cddf578150b3833633c67349c9df8a',
  isolation: '3cabe6652f8a7cf66089b86b1cb36e54d732f1cdd721f80c8676979f032e92ff',
  cycle: '761626484cd871c01d429f8bd7214ff52d2262a9a560ab4899c12b6ea257bd70',
  forwardRefusal: 'cf57957bf99cc6fae366ce7020897d71cad6dbb6de5cb25b65baa40bc7cf7034',
  downBody: 'f989b229a3440699208e00717f04429d077e23f673b082205071e4c2ac9b3c96',
  downMetadata: 'ff38edde4f09af00da99a279f359f61f98bc5e35f8831d49b86383613289d89e',
  downDependent: 'd4407cec20b6a1cb71d32c38e5d46b06c1d3c53d64cdc0e3d507f67aa2cdc632',
  raceA: '135096ec72a667455bdc033a466375c1d047f495779eb0257be353f8613cca00',
  raceB: '936976df5a57628963534b314b35726a375c10e951faa4c7627e6ccb2a8dbdc3',
  raceObserve: 'd7f6e6c98a2d3c820191a77a014e15fb9b4afd04e5dd0f441f1c178a99777667',
  raceVerify: 'c882832f766ecaa17a078841d2242964672708eb8a909ba6a006f0b1ccd41edc',
  concurrencySetup: 'fe390467cd74121d1698df11178133b515902695606c0b403abcac4d70789e78',
  concurrencyCleanup: 'a6b49f64bf7cc069a28a10510762e1ec733ddc1a884a7560ab97d72daa50939d',
  authorityBaseline: '2797f9f85809702e3233713af4a4506035091550ea59b8376b06c6472d6a8077',
  authorityA: '74ff01cb3f26bc3816b2c48ae80178487f650a6f476e3f1609a84351d2e8d547',
  authorityB: 'e017244a684b7329f469bace9bdc5e07a8218a8c0d6ad9f645e7c42429d57335',
  authorityRevoke: '2bc382927db7f8cd4abcbff80fc1be7988a381cf39c4cdfd18778bfd1f205168',
  authorityVerify: '37c11b0958c17b61b6315aae35d78f6e3f231b8f685afab31c9d66ed95994309',
};
for (const [name, expected] of Object.entries(expectedHashes)) {
  assert.equal(sha256(sources[name]), expected, `${name} bytes drifted`);
}
assert.match(
  sources.manifest,
  /\| 0164 \| `import_revert_cleanup\.sql` \|[^\n]+\|/,
  '0164 manifest reservation missing',
);
assert.match(
  sources.appSpec,
  /retained-catalog database transaction:[^\n]+orphanWinesDeleted as literal zero/,
);
for (const [name, source] of Object.entries(sources)) {
  assert.doesNotMatch(source, /__0164_|BODY_SHA256/, `${name} has a placeholder`);
}

const functions = Object.fromEntries(
  [...sources.up.matchAll(
    /create(?: or replace)? function public\.([a-z0-9_]+)\([^]*?as \$function\$([\s\S]*?)\$function\$;/gi,
  )].map((match) => [match[1], match[2]]),
);
assert.deepEqual(
  Object.keys(functions),
  [
    'apply_import_batch_chunk',
    'revert_import_batch_core_private',
    'revert_import_batch_private',
    'revert_import_batch',
    'revert_import_session',
  ],
);
const bodyHashes = {
  apply_import_batch_chunk: '4954adc09249cb6af38c6c0c93bf6c142d2751a298263c3cc20e4a1fb7ab2472',
  revert_import_batch_core_private: 'c445c55fba355718e92d5ed7d76fb8d2e77b4c44c57e340f2d40804ff4518fe0',
  revert_import_batch_private: '7a5084f1a21865fd41d9bba9825edc430e8899dfbd75f7a9ad0e5d0bb6b48806',
  revert_import_batch: '87ef93a7d110bf29d67eac1813ed94cce6382914db36feb9429c04dde7415b87',
  revert_import_session: '628a355a722c36590869bf1e06d95766abcf0a386e0b578effb93c7048b479ae',
};
for (const [name, expected] of Object.entries(bodyHashes)) {
  assert.equal(sha256(functions[name]), expected, `${name} body drifted`);
}
assert.equal((sources.up.match(/pg_advisory_xact_lock/g) ?? []).length, 3);
assert.equal((sources.up.match(/'import-mutation:' \|\| v_restaurant_id::text/g) ?? []).length, 3);
for (const name of [
  'apply_import_batch_chunk',
  'revert_import_batch_core_private',
  'revert_import_session',
]) {
  assert.match(functions[name], /current_setting\('transaction_isolation'\)/);
  assert.match(functions[name], /read_committed_required/);
}
assert.match(
  functions.revert_import_batch_core_private,
  /claimed\.apply_status = 'applied'[\s\S]*claimed\.applied_inventory_item_id = any\(v_inventory_ids\)[\s\S]*having pg_catalog\.count\(\*\) > 1/,
);
assert.match(
  functions.revert_import_session,
  /join public\.import_batch_rows claimed[\s\S]*having pg_catalog\.count\(distinct claimed\.id\) > 1/,
);
assert.doesNotMatch(functions.revert_import_batch_core_private, /delete from public\.wines/);
assert.doesNotMatch(functions.revert_import_session, /delete from public\.wines/);
assert.match(functions.revert_import_batch_core_private, /'orphanWinesDeleted', 0/);
for (const name of [
  'revert_import_batch_core_private',
  'revert_import_batch_private',
  'revert_import_session',
]) {
  assert.match(functions[name], /import_source_conflict/);
  assert.match(functions[name], /P04I2/);
}
assert.match(functions.revert_import_batch, /import_source_conflict'[\s\S]*P0001/);
for (const token of [
  '6a01649ad58aebb820b6119b79381e69ae579269996ab7af5456fbf75ef322f2',
  '3c6d6c41d6262a20e7c102dbd49bb3383bd86a4138c8a3ab6b9b04a1ec2420a5',
  '5ce2c8fade26354ddbdfa097e1dab15cd3e0837bf8ac986ac321b40f863242fd',
  '["postgres=X/postgres"]',
  'dbdaef5364b676c09dd4670da5a5c4d27c99aaefeea76db2817fc48f85ea7710',
  'v_updated_at_acl_admitted',
  'pg_catalog.aclexplode(v_updated_at_function.proacl)',
  'pg_catalog.count(distinct acl.grantee)',
  "t.tgname = 'inventory_items_reflect_import_delete'",
  "c.conname = 'open_bottles_source_inventory_item_tenant_wine_fkey'",
  "x.relname = 'open_bottles_source_inventory_item_id_idx'",
]) {
  assert.ok(sources.up.includes(token), `preflight pin missing ${token}`);
}
assert.match(sources.down, /drop function public\.revert_import_batch_private\(uuid\) restrict;/);
assert.match(sources.down, /drop function public\.revert_import_batch_core_private\(uuid, uuid\[\]\) restrict;/);
assert.doesNotMatch(sources.down, /\bcascade\b/i);
assert.ok(sources.down.includes('3b84ef448e44560db50067e35091cb0f4a96f170f0a696be3eaac3661e25116b'));

for (const token of [
  'C09_0164_SESSION_SOURCE_CONFLICT_CHANGED_STATE',
  'C09_0164_BATCH_SOURCE_CONFLICT_CHANGED_STATE',
  'C09_0164_CROSS_SITE_SOURCE_CONFLICT_CHANGED_STATE',
  'C09_0164_SESSION_SHARED_PAIR_FAILED',
  'C09_0164_BATCH_RECEIPT_OR_RETENTION_FAILED',
  'C09_0164_PHYSICAL_REFUSAL_CHANGED_STATE',
  'C09_0164_ATOMIC_REFUSAL_CHANGED_STATE',
  'C09_0164_TIMESTAMP_DIAGNOSTIC_PASS',
  'rollback;',
]) {
  assert.ok(sources.functional.includes(token), `functional proof missing ${token}`);
}
assert.equal((sources.functional.match(/content_sha256/g) ?? []).length, 2);
assert.match(sources.functional, /r\.lwin_score=0\.8::real/);
assert.equal((sources.isolation.match(/content_sha256/g) ?? []).length, 2);
assert.equal((sources.concurrencySetup.match(/content_sha256/g) ?? []).length, 1);
assert.equal((sources.isolation.match(/isolation level repeatable read/g) ?? []).length, 1);
assert.equal((sources.isolation.match(/isolation level serializable/g) ?? []).length, 1);
for (const token of ["array['apply','typed','legacy','session']", 'read_committed_required']) {
  assert.ok(sources.isolation.includes(token), `isolation proof missing ${token}`);
}
assert.match(sources.raceA, /count\(distinct w\.id\)[\s\S]*\)=2/);
assert.match(sources.raceA, /array_agg\(w\.id order by r\.row_number\)/);
assert.match(sources.raceA, /array_agg\(ids\.id order by ids\.id desc\)/);
assert.doesNotMatch(sources.raceA, /pg_catalog\.coalesce/);
assert.match(sources.raceObserve, /wait_event='advisory'/);
assert.match(sources.concurrencySetup, /source_0164_sha256/);
assert.match(sources.concurrencySetup, /000000000060'[\s\S]*000000000061'/);
assert.match(sources.concurrencyCleanup, /CONCURRENCY_CLEANUP_SCOPE_MISMATCH/);
assert.match(sources.concurrencyCleanup, /m\.user_id<>'16440000/);
assert.match(sources.concurrencyCleanup, /wm\.user_id<>'16440000/);
assert.match(sources.authorityBaseline, /before_state_sha256/);
assert.match(sources.authorityA, /wait_kind/);
assert.match(sources.authorityRevoke, /status='revoked'/);
assert.match(sources.authorityRevoke, /user_id=:'actor_id'::uuid/);
assert.match(sources.authorityRevoke, /restaurant_id=:'site_id'::uuid/);
assert.match(sources.authorityRevoke, /returning id/);
assert.match(sources.authorityB, /sqlstate 'P0002'/);
assert.match(sources.authorityVerify, /post_wait_authority_conservation/);
assert.match(sources.authorityVerify, /before_state_sha256/);
assert.match(
  sources.forwardRefusal,
  /grant create on schema public to authenticated;[\s\S]*owner to authenticated;/,
);
assert.match(
  sources.downMetadata,
  /grant create on schema public to authenticated;[\s\S]*owner to authenticated;/,
);

console.log('C09_0164_SOURCE_CONTRACT_PASS');
