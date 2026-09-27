import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../..');
const paths = {
  up: resolve(root, 'supabase/migrations/0163_stalled_invoice_scan_expiry.sql'),
  down: resolve(root, 'supabase/migrations/down/0163_stalled_invoice_scan_expiry.down.sql'),
  acceptedContract: resolve(root, 'docs/plans/2026-09-27-terroir-stalled-scan-expiry.md'),
  manifest: resolve(root, 'docs/plans/2026-08-24-visual-wine-platform-spec-list.md'),
  migration0157: resolve(root, 'supabase/migrations/0157_staff_cost_seal_additive.sql'),
  functional: resolve(here, 'stalled-scan-expiry-contract.sql'),
  repeatable: resolve(here, 'isolation-repeatable-read.sql'),
  serializable: resolve(here, 'isolation-serializable.sql'),
  cycle: resolve(here, 'migration-cycle.sql'),
  downBody: resolve(here, 'down-refusal-body.sql'),
  downOwner: resolve(here, 'down-refusal-owner.sql'),
  downAcl: resolve(here, 'down-refusal-acl.sql'),
  downPath: resolve(here, 'down-refusal-search-path.sql'),
  downOverload: resolve(here, 'down-refusal-overload.sql'),
  downDependent: resolve(here, 'down-refusal-dependent.sql'),
  completionSetup: resolve(here, 'completion-race-setup.sql'),
  completionA: resolve(here, 'completion-race-a.sql'),
  completionB: resolve(here, 'completion-race-b.sql'),
  completionObserve: resolve(here, 'completion-race-observe.sql'),
  completionCleanup: resolve(here, 'completion-race-verify-cleanup.sql'),
  reextractSetup: resolve(here, 'reextract-race-setup.sql'),
  reextractA: resolve(here, 'reextract-race-a.sql'),
  reextractB: resolve(here, 'reextract-race-b.sql'),
  reextractObserve: resolve(here, 'reextract-race-observe.sql'),
  reextractRetained: resolve(here, 'reextract-race-verify-retained.sql'),
  readme: resolve(here, 'README.md'),
};
const sources = Object.fromEntries(
  Object.entries(paths).map(([name, path]) => [name, readFileSync(path, 'utf8')]),
);
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const expectedHashes = {
  up: '0c64a578bc2253c149bef9a2e1479fbfdefb1e3bf1820f3c4da68e8d46537583',
  down: '3ec3dc9400fef2d4cf481c1812b151b57a22b5c2572d9e0c0ba45fb959259145',
  acceptedContract: '17582379d555a59596cb1c553c0f45767db1bddd0ac3da6caedb5b045c3e2885',
  migration0157: 'e4107961a846d96a8a58225ee6b030eea734f8778627a2615604bc3b450de8e6',
  functional: '358a1ba5275a13db53f26aaaab62c5470aabca18e395d1131292a1420a06c930',
  repeatable: 'fa33256392fe89ef44315a47fe9b864b50c5d7d201ce6367762792b97f6e5622',
  serializable: 'a3e0fd72fdc92fb124687d11965af6d32ca166b92ca3785e82370019b8bdc188',
  cycle: '85f457a6d7bb211425e3b5aab70e6cf1c6a7fa0481e3734138601023d4a6bdfc',
  downBody: '6f137a6f1a29b43fd7839cff066af1a5abdd7a249507c6cb695defe2f3529152',
  downOwner: 'c538aae55d62d7e3831a5fa4ad16ef6ec99aad60b8a2aa18d0afb7792de0ce77',
  downAcl: '03221066c8ff99c524760359c775efe9c3afb648003877d3cafbafa16bee2a4b',
  downPath: '189a74dcc4df973d57bac247cd486a8ffd305ceed5789721c7831a4749e87fae',
  downOverload: '7a31ca43ebf8238672822750e67e71d6cd839923ed5ed74972d1c2ceeda0481f',
  downDependent: 'ad3602fb438e16f96466d92cfa5d5dc1e4e4e99b92741626621cef09dd1c1273',
  completionSetup: '21ea99c447fbcc09e2b9d4dcff2080faafab2468b80810a73eef0dc7aebd1523',
  completionA: 'fccfa248406d0eaa41f0a0de1463e62b2debb266a4c275945c1d32808c0f7645',
  completionB: '3f410272e8db6d237bc9a14a014d79edc6988473e61bfeb8e6c745815d260b6b',
  completionObserve: 'f154d2694e283bd7b17dc04e16cfef34cd0df19a7b02bdf6e20d2278268efc05',
  completionCleanup: '0c814bb5d72dace148e7f24d83f8a05742d05f97ae79903524a0b922db372a12',
  reextractSetup: '1307499e43c98244e27f8a4c06f35ac340a8ca4a8febd6c409311725022eb45c',
  reextractA: '7f8cfd6d522e8c3036c5da0e5acfe1724c259864fa0a14a799955b3825114834',
  reextractB: '73edb39317d0e2ddff9634827599dad6422ffcd1e0e47cb2531ccdaad15ccf04',
  reextractObserve: '8a9b679c900c698e15a167554180ddbc4ca278f1bb442cbe7b7299a94631a1a0',
  reextractRetained: '831611d50835577f3d156d868a7834d25be9b9324c53e6feb81f1de0874960bd',
  readme: 'eb169dcc352585faa4186108f68683a4a437678ecea714835310b4923918c6f5',
};
for (const [name, expected] of Object.entries(expectedHashes)) {
  assert.equal(sha256(sources[name]), expected, `${name} bytes drifted`);
}
assert.match(
  sources.manifest,
  /\| 0163 \| `stalled_invoice_scan_expiry\.sql` \|[^\n]+\|/,
  '0163 is not reserved in the normative manifest',
);
for (const [name, source] of Object.entries(sources)) {
  assert.doesNotMatch(source, /__0163_/, `${name} retains a source placeholder`);
}

const bodyMatch = sources.up.match(/as \$function\$([\s\S]*?)\$function\$;/);
assert.ok(bodyMatch, '0163 function body must be extractable');
const body = bodyMatch[1];
assert.equal(
  sha256(body),
  'bd01b007ef6b2bc0b37b3e7126f938f8ae10d5600b7499ccd941abd5efa0b8a1',
  '0163 function body drifted',
);
assert.match(
  sources.up,
  /create function public\.expire_stalled_invoice_scans\(p_restaurant_id uuid\)\s+returns jsonb\s+language plpgsql\s+volatile\s+security definer\s+set search_path = ''/,
);
const authorityAt = body.indexOf('if v_actor is null');
const isolationAt = body.indexOf("current_setting('transaction_isolation')");
const clockAt = body.indexOf('v_now := pg_catalog.statement_timestamp()');
const lockAt = body.indexOf('select s.id');
const updateAt = body.indexOf('update public.invoice_scans as s');
assert.ok(
  authorityAt >= 0 && isolationAt > authorityAt && clockAt > isolationAt
    && lockAt > clockAt && updateAt > lockAt,
  'authority/isolation/clock/lock/update order drifted',
);
assert.equal((body.match(/for update/g) ?? []).length, 1);
assert.equal((body.match(/interval '15 minutes'/g) ?? []).length, 2);
assert.equal((body.match(/interval '5 minutes'/g) ?? []).length, 1);
assert.equal((body.match(/update public\.invoice_scans/g) ?? []).length, 1);
assert.doesNotMatch(body, /update public\.background_jobs/);
assert.doesNotMatch(body, /pg_catalog\.coalesce/);
assert.match(body, /select coalesce\(/);
for (const fragment of [
  "s.restaurant_id = p_restaurant_id",
  "s.status = 'processing'",
  's.committed_at is null',
  "s.updated_at < v_now - interval '15 minutes'",
  "job.restaurant_id = s.restaurant_id",
  "job.job_type = 'invoice_extract'",
  "job.subject_table = 'invoice_scans'",
  'job.subject_id = s.id',
  "job.status in ('queued', 'retrying')",
  "job.status = 'processing'",
  "job.claimed_at >= v_now - interval '5 minutes'",
]) {
  assert.ok(body.includes(fragment), `function body missing ${fragment}`);
}
assert.match(
  body,
  /return pg_catalog\.jsonb_build_object\(\s*'version', 1,\s*'expiredCount', v_expired_count\s*\);/,
);
assert.doesNotMatch(body, /\nexception\s*(?:\n|when)/i, 'unexpected errors must propagate');
assert.doesNotMatch(sources.up, /\bcommit\s*;/i);
assert.match(
  sources.up,
  /revoke all on function public\.expire_stalled_invoice_scans\(uuid\)\s+from public, anon, authenticated, service_role;/,
);
assert.match(
  sources.up,
  /grant execute on function public\.expire_stalled_invoice_scans\(uuid\)\s+to authenticated;/,
);
for (const token of [
  "'public.set_updated_at()'",
  '3c6d6c41d6262a20e7c102dbd49bb3383bd86a4138c8a3ab6b9b04a1ec2420a5',
  "pg_catalog.pg_get_userbyid(v_updated_at_function.proowner) <> 'postgres'",
  "array['search_path=public']::text[]",
  "t.tgattr::text = ''",
  't.tgqual is null',
  't.tgnargs = 0',
  "pg_catalog.encode(t.tgargs, 'hex') = ''",
]) {
  assert.ok(sources.up.includes(token), `updated_at baseline pin missing ${token}`);
}

assert.match(sources.down, /from pg_catalog\.pg_depend d/);
assert.match(sources.down, /drop function public\.expire_stalled_invoice_scans\(uuid\) restrict;/);
assert.doesNotMatch(sources.down, /\bcascade\b/i);
assert.doesNotMatch(sources.down, /\b(?:insert\s+into|update|delete\s+from)\b/i);
assert.doesNotMatch(sources.down, /\bcommit\s*;/i);

for (const token of [
  'C08_0163_EXPIRY_MATRIX_FAILED',
  'C08_0163_PAYLOAD_OR_JOB_CONSERVATION_FAILED',
  'C08_0163_SECOND_CALL_NOT_ZERO',
  'C08_0163_STALE_LEASE_RECOVERY_FAILED',
  'C08_0163_AUTHORITY_REFUSAL_CHANGED_SCAN',
  'C08_0163_AUTHORIZED_ROLE_DID_NOT_EXPIRE',
  "exception when sqlstate '42501'",
  'rollback;',
]) {
  assert.ok(sources.functional.includes(token), `functional proof missing ${token}`);
}
assert.match(
  sources.functional,
  /update public\.invoice_scans s\s+set status='processing'\s+where s\.id='16300000-0000-4000-8000-000000000107'\s+and s\.status='failed';/,
  'failed recovery must mirror the status-only worker reset fence',
);
assert.match(
  sources.functional,
  /s\.status='processing' and s\.status_reason='stalled'/,
  'status-only worker reset must preserve the expiry reason until completion',
);
assert.match(
  sources.functional,
  /set status='complete',status_reason=null\s+where s\.id='16300000-0000-4000-8000-000000000107'\s+and s\.status='processing';/,
  'completion must be a separate processing-fenced write',
);
assert.match(
  sources.functional,
  /set updated_at=pg_catalog\.statement_timestamp\(\)\s+where s\.id='16300000-0000-4000-8000-000000000125'\s+and s\.status='processing';/,
  'the proved exact scan boundary must be refreshed before later phases',
);
assert.match(
  sources.functional,
  /set claimed_at=pg_catalog\.statement_timestamp\(\)\s+where j\.id='16300000-0000-4000-8000-000000000214'\s+and j\.status='processing';/,
  'the proved exact lease boundary must be refreshed before later phases',
);
assert.match(sources.repeatable, /begin isolation level repeatable read;/);
assert.match(sources.repeatable, /sqlstate '25000'/);
assert.match(sources.serializable, /begin isolation level serializable;/);
assert.match(sources.serializable, /sqlstate '25000'/);
assert.match(sources.cycle, /C08_0163_CYCLE_UP_OR_DATA_FAILED/);

for (const name of [
  'downBody', 'downOwner', 'downAcl', 'downPath', 'downOverload',
  'downDependent',
]) {
  assert.ok(
    sources[name].includes('\\ir ../../migrations/down/0163_stalled_invoice_scan_expiry.down.sql'),
    `${name} does not invoke the exact down migration`,
  );
  assert.match(sources[name], /C08_0163_ERROR_DOWN_ACCEPTED_/);
}
assert.match(sources.downDependent, /create view public\.c08_0163_down_dependency/);
assert.match(
  sources.downBody,
  /create or replace function public\.expire_stalled_invoice_scans\(p_restaurant_id uuid\)/,
  'body drift setup must preserve the admitted input parameter name',
);

assert.match(sources.completionA, /and s\.status='processing'/);
assert.match(sources.completionA, /pg_catalog\.pg_sleep\(8\)/);
assert.match(sources.completionB, /'expiredCount',1/);
assert.match(sources.completionObserve, /wait_event_type='Lock'/);
assert.match(sources.completionCleanup, /C08_0163_STALE_COMPLETION_OVERWROTE_EXPIRY/);
assert.match(sources.completionCleanup, /C08_0163_COMPLETION_CLEANUP_SCOPE_MISMATCH/);

const reextractStart = sources.migration0157.indexOf(
  'create function public.request_invoice_scan_reextract(p_scan_id uuid)',
);
assert.ok(reextractStart >= 0, '0157 re-extract function missing');
const reextractBodyMatch = sources.migration0157.slice(reextractStart)
  .match(/as \$function\$([\s\S]*?)\$function\$;/);
assert.ok(reextractBodyMatch, '0157 re-extract body must be extractable');
assert.equal(
  sha256(reextractBodyMatch[1]),
  '370727c4b6ffa301d6537c5e79330a8b8f0463bbc7857470bacce9e599e045f5',
  '0157 re-extract body drifted',
);
const reextractBody = reextractBodyMatch[1];
const reextractScanLock = reextractBody.indexOf('where s.id=p_scan_id for update');
const reextractJobLock = reextractBody.indexOf("where b.job_type='invoice_extract'");
const reextractInsert = reextractBody.indexOf('insert into public.background_jobs');
const reextractUpdate = reextractBody.indexOf('update public.background_jobs b set');
assert.ok(
  reextractScanLock >= 0 && reextractJobLock > reextractScanLock
    && reextractInsert > reextractJobLock && reextractUpdate > reextractInsert,
  '0157 scan-lock-before-job critical section drifted',
);
assert.match(
  sources.reextractSetup,
  /'16350000-0000-4000-8000-000000000041',[\s\S]*'cost\.read'/,
);
assert.equal(
  (sources.reextractA.match(/public\.request_invoice_scan_reextract\(v_scan_id\)/g) ?? []).length,
  1,
  'session A must loop through the literal re-extract RPC',
);
assert.match(sources.reextractA, /pg_catalog\.pg_sleep\(8\)/);
assert.match(sources.reextractB, /'expiredCount',1/);
assert.match(sources.reextractObserve, /wait_event_type='Lock'/);
assert.match(
  sources.reextractRetained,
  /public\.request_invoice_scan_reextract\(\s*'16350000-0000-4000-8000-000000000052'/,
);
assert.match(sources.reextractRetained, /C08_0163_REEXTRACT_RETAINED_DELTA_MISMATCH/);
assert.match(sources.reextractRetained, /C08_0163_REEXTRACT_RETAINED_IDS/);
for (const token of [
  'g.site_lifecycle_generation=v_site_generation',
  'g.workspace_lifecycle_generation=v_workspace_generation',
  "g.grant_reason='0163 retained literal reextract race fixture'",
  "g.source='workspace_governance'",
  "'comp_guest','comp_industry','count_adjust','other','spill'",
  'where b.restaurant_id=v_site)<>3',
]) {
  assert.ok(
    sources.reextractRetained.includes(token),
    `retained re-extract delta missing ${token}`,
  );
}
assert.match(sources.readme, /literal\s+`request_invoice_scan_reextract\(uuid\)` RPC/i);
assert.match(sources.readme, /intentionally retains one named synthetic identity/i);

console.log('C08_0163_SOURCE_CONTRACT_PASS');
