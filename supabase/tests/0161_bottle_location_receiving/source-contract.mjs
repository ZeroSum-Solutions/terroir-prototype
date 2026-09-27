import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const paths = {
  up: resolve(here, '../../migrations/0161_bottle_location_receiving.sql'),
  down: resolve(here, '../../migrations/down/0161_bottle_location_receiving.down.sql'),
  contract: resolve(here, 'bottle-location-contract.sql'),
  atomic: resolve(here, 'atomic-and-malformed.sql'),
  compatibility: resolve(here, 'receipt-compatibility.sql'),
  cycle: resolve(here, 'migration-cycle.sql'),
  downRefusal: resolve(here, 'down-history-refusal.sql'),
  concurrencySetup: resolve(here, 'concurrency-setup.sql'),
  concurrencySameA: resolve(here, 'concurrency-same-a.sql'),
  concurrencySameB: resolve(here, 'concurrency-same-b.sql'),
  concurrencyBinA: resolve(here, 'concurrency-bin-a.sql'),
  concurrencyBinB: resolve(here, 'concurrency-bin-b.sql'),
  concurrencyObserve: resolve(here, 'concurrency-observe.sql'),
  concurrencyCleanup: resolve(here, 'concurrency-verify-cleanup.sql'),
};
const sources = Object.fromEntries(
  Object.entries(paths).map(([name, path]) => [name, readFileSync(path, 'utf8')]),
);
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const expectedHashes = {
  up: '7c13530124d26003caf478b65904e02934a5e232c3ebcf4343a1b75914e0fcf7',
  down: '04993e73b91c02b44c429acfc983d365c232e95801dfefb4b64091c2c93cab6a',
  contract: '9adf3bd2eb5326c91a7ad1a523a514ee8860b1d2920125639b2df9a60466640b',
  atomic: 'c7607b51efeab2faa59723feb6282c181b1ae4b7c5a5bbe798aa1de07d33145f',
  compatibility: '974f6d788fe12f3c66d0aa7a709db0776edb3260f54f8c4a0c06aba873e407b9',
  cycle: 'def0b705dd93be6d07122e036ab6e7ee0788213b18618b29f8b5eb34c0bdd945',
  downRefusal: '4bf34cb90a32eeb37740f9adb2cb93b0d51949b987ab03772fe3eaf2f5f58bd2',
  concurrencySetup: '93cbae480ec7900a6e3b24206c018cb5beda56475f1005719b5cd17e5232cbc6',
  concurrencySameA: '755c7f5de0d4fa66e5ea5e27388fdd80386a75de17140f476cee895727aade65',
  concurrencySameB: '08598e1fcdace306d5b8beb12580416e850f2de575be0794a49607fab6ec788a',
  concurrencyBinA: '08c557a6963adafaff3df7bc938523971c77dddacabf8c075b871177af83f5ab',
  concurrencyBinB: '2a334496e092663ebee37353310587b5bfdf59420d0b4d73966945a092d3f606',
  concurrencyObserve: 'b77502c335c67e2c2cd680fc4edd812a951cf9f364a1f9fcf2c21b1086c140f6',
  concurrencyCleanup: '97b8d8b8e6599bb120fe75a37244b3609eb86821c9daab939bebd5be2ca91bd5',
};

for (const [name, expected] of Object.entries(expectedHashes)) {
  assert.equal(sha256(sources[name]), expected, `${name} bytes drifted`);
}
for (const [name, source] of Object.entries(sources)) {
  assert.doesNotMatch(source, /__0161_/, `${name} retains a source placeholder`);
}

const bodyMatch = sources.up.match(/as \$function\$([\s\S]*?)\$function\$;/);
assert.ok(bodyMatch, '0161 function body must be extractable');
const body = bodyMatch[1];
assert.equal(
  sha256(body),
  '6a24736e1a19541d567081f9cec72f32e4c72af371f6d62f0c8015480750af03',
  '0161 function body drifted',
);

assert.match(sources.up, /create function public\.receive_bottle_at_location_private\(/);
assert.doesNotMatch(sources.up, /create or replace function public\.receive_bottle_at_location_private/);
assert.match(
  sources.up,
  /p_restaurant_id uuid,\s+p_operation_id uuid,\s+p_wine_id uuid,\s+p_section text,\s+p_bin_id uuid\s+\) returns jsonb/,
);
assert.match(sources.up, /language plpgsql\s+security definer\s+set search_path = ''/);
assert.match(
  sources.up,
  /revoke all on function public\.receive_bottle_at_location_private\(uuid,uuid,uuid,text,uuid\)\s+from public, anon, authenticated, service_role;/,
);
assert.match(
  sources.up,
  /grant execute on function public\.receive_bottle_at_location_private\(uuid,uuid,uuid,text,uuid\)\s+to authenticated;/,
);
assert.match(
  sources.up,
  /alter function public\.receive_bottle_at_location_private\(uuid,uuid,uuid,text,uuid\)\s+owner to postgres;/,
);

for (const preserved of [
  "command_version = 1\n      and command_type in ('open', 'pour', 'spill', 'discard', 'close')",
  "command_version = 2\n      and command_type in ('open', 'pour', 'spill', 'discard', 'close', 'undo')",
  "command_version = 2\n      and command_type = 'reconcile_batch'",
  "command_version = 3\n      and command_type = 'bottle_inventory_save'",
  "command_version = 3\n      and command_type = 'bottle_location_receive'",
]) {
  assert.ok(sources.up.includes(preserved), `forward missing ${preserved}`);
}
for (const untouched of [
  'inventory_command_receipts_completion_pair',
  'inventory_command_receipts_result_object',
  'inventory_command_receipts_scope_kind_check',
  'inventory_command_receipts_batch_entry_count_check',
]) {
  assert.doesNotMatch(
    sources.up,
    new RegExp(`(?:drop|add) constraint ${untouched}`),
    `${untouched} must remain untouched`,
  );
}

const auth = body.indexOf('if v_actor is null');
const normalize = body.indexOf('v_section := pg_catalog.btrim(p_section)');
const request = body.indexOf('v_request := pg_catalog.jsonb_build_object');
const replay = body.indexOf('select * into v_receipt');
const wineLock = body.indexOf('for no key update');
const claim = body.indexOf('insert into public.inventory_command_receipts');
const binLock = body.indexOf('for share;');
const inventory = body.indexOf('insert into public.inventory_items');
const completion = body.indexOf('update public.inventory_command_receipts r');
assert.ok(auth >= 0 && normalize > auth && request > normalize, 'authority/normalization order drifted');
assert.ok(
  replay > request && wineLock > replay && claim > wineLock && binLock > claim
    && inventory > binLock && completion > inventory,
  'receipt/wine/claim/bin/item/completion order drifted',
);
assert.match(body, /where r\.restaurant_id = p_restaurant_id\s+and r\.operation_id = p_operation_id\s+for update;/);
assert.match(body, /where w\.id = p_wine_id\s+and w\.restaurant_id = p_restaurant_id\s+for no key update;/);
assert.match(body, /where b\.id = p_bin_id\s+and b\.restaurant_id = p_restaurant_id\s+and b\.retired_at is null\s+for share;/);
assert.match(body, /on conflict \(restaurant_id, operation_id\) do nothing/);
assert.match(body, /'version', 3,\s+'kind', 'bottle_location_receive',\s+'wine_id', p_wine_id,\s+'section', v_section,\s+'bin_id', p_bin_id,\s+'quantity', 1/);
assert.match(body, /'version', 1,\s+'kind', 'bottle_location_receive',\s+'status', 'committed',\s+'operationId', p_operation_id,\s+'inventoryItemId', v_inventory_item_id,\s+'wineId', p_wine_id,\s+'section', v_section,\s+'binId', p_bin_id,\s+'binCode', v_bin_code,\s+'quantity', 1/);
assert.match(body, /p_wine_id, p_restaurant_id, null, 1, 0, null,\s+null, v_section, p_bin_id, v_bin_code, 'bottle_scan'::public\.added_via/);
assert.match(body, /pg_catalog\.statement_timestamp\(\)/);
assert.doesNotMatch(body, /scan_idempotency|find_or_create|lower\(|ilike|cost\.read/);

for (const state of ['P05V1', 'P05W1', 'P05B1', 'P05C1', 'P05I1', '42501']) {
  assert.ok(body.includes(`errcode = '${state}'`), `missing SQLSTATE ${state}`);
}
for (const replayField of [
  'actor_user_id', 'command_version', 'command_type', 'scope_kind',
  'batch_entry_count', 'request_payload', 'completed_at', 'inventoryItemId',
  'operationId', 'wineId', 'section', 'binId', 'binCode', 'quantity',
]) {
  assert.ok(body.includes(replayField), `replay validator missing ${replayField}`);
}

const historyGuard = sources.down.indexOf("r.command_type = 'bottle_location_receive'");
const dropFunction = sources.down.indexOf('drop function public.receive_bottle_at_location_private');
const restoreConstraints = sources.down.indexOf('alter table public.inventory_command_receipts');
assert.ok(historyGuard >= 0 && dropFunction > historyGuard && restoreConstraints > dropFunction);
assert.match(sources.down, /lock table public\.inventory_command_receipts in access exclusive mode nowait;/);
assert.match(sources.down, /drop function public\.receive_bottle_at_location_private\(uuid,uuid,uuid,text,uuid\)\s+restrict;/);
assert.doesNotMatch(sources.down, /\bdelete\s+from\s+public\.inventory_command_receipts\b/i);
assert.doesNotMatch(sources.down, /\bcascade\b/i);
assert.doesNotMatch(
  sources.down.slice(restoreConstraints),
  /command_type = 'bottle_location_receive'/,
  'down restoration retained the 0161 type branch',
);

for (const token of [
  "sqlstate 'P05V1'", "sqlstate 'P05W1'", "sqlstate 'P05B1'",
  "sqlstate 'P05C1'", "sqlstate '42501'",
  'C06_0161_BOTTLE_LOCATION_CONTRACT_PASS', 'rollback;',
]) {
  assert.ok(sources.contract.includes(token), `functional contract missing ${token}`);
}
for (const token of [
  "sqlstate 'P05I1'", 'C06_0161_FORCED_INVENTORY_FAILURE',
  'C06_0161_FORCED_RECEIPT_COMPLETION_FAILURE',
  'C06_0161_ATOMIC_AND_MALFORMED_PASS', 'rollback;',
]) {
  assert.ok(sources.atomic.includes(token), `atomic contract missing ${token}`);
}
for (const token of [
  'execute_inventory_command(', 'execute_physical_bottle_command(',
  'save_bottle_inventory_private(', 'merge_wines(',
  'C06_0161_OLD_RECEIPT_BYTES_CHANGED',
  'C06_0161_IMMUTABLE_REPLAY_AFTER_DRIFT_FAILED',
  'C06_0161_RECEIPT_COMPATIBILITY_PASS', 'rollback;',
]) {
  assert.ok(sources.compatibility.includes(token), `compatibility contract missing ${token}`);
}
assert.ok(sources.cycle.includes('C06_0161_MIGRATION_CYCLE_PASS'));
assert.ok(sources.cycle.includes('\\ir ../../migrations/down/0161_bottle_location_receiving.down.sql'));
assert.ok(sources.downRefusal.includes('C06_0161_DOWN_REFUSES_DURABLE_HISTORY'));

for (const session of ['concurrencySameA', 'concurrencySameB']) {
  assert.ok(sources[session].includes('16140000-0000-4000-8000-000000000070'));
}
for (const session of ['concurrencyBinA', 'concurrencyBinB']) {
  assert.ok(sources[session].includes('16140000-0000-4000-8000-000000000060'));
}
assert.ok(sources.concurrencyObserve.includes("a.wait_event_type='Lock'"));
assert.ok(sources.concurrencyCleanup.includes('C06_0161_SAME_OPERATION_RACE_FAILED'));
assert.ok(sources.concurrencyCleanup.includes('C06_0161_BIN_SERIALIZATION_FAILED'));

console.log('C06_0161_SOURCE_CONTRACT_PASS');
