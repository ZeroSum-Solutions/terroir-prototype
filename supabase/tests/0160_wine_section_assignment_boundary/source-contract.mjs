import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const upPath = resolve(here, '../../migrations/0160_wine_section_assignment_boundary.sql');
const downPath = resolve(
  here,
  '../../migrations/down/0160_wine_section_assignment_boundary.down.sql',
);
const contractPath = resolve(here, 'section-assignment-contract.sql');
const cyclePath = resolve(here, 'migration-cycle.sql');

const up = readFileSync(upPath, 'utf8');
const down = readFileSync(downPath, 'utf8');
const contract = readFileSync(contractPath, 'utf8');
const cycle = readFileSync(cyclePath, 'utf8');
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const bodyMatch = up.match(/as \$function\$([\s\S]*?)\$function\$;/);

assert.ok(bodyMatch, '0160 function body must be extractable');
const body = bodyMatch[1];
assert.equal(
  sha256(body),
  'de52e8ee719623d8f102f371051a47a12128145ba97f59892eb89dfd18b68e81',
  '0160 body hash drifted',
);
assert.equal(
  sha256(up),
  '7c236443bc305345d2aa925fedeeedeb0292883f9bb4b61072c7251a012e3ba5',
  '0160 forward migration bytes drifted',
);
assert.equal(
  sha256(down),
  '35385f4bef5114fd594d5e8a9b14dd98c454a750f6eba334471a5bfc1c4165d4',
  '0160 down migration bytes drifted',
);
assert.equal(
  sha256(contract),
  '4671925f872334bb391c929ff8e9602cb6f56c70a9543250a72b3fcf44b56d2b',
  '0160 rollback contract bytes drifted',
);
assert.equal(
  sha256(cycle),
  'b732d1419a40ef0bc141a3960a9bc7ece5abd2a965430a6369bba023842cecc5',
  '0160 migration-cycle bytes drifted',
);

assert.match(up, /create function public\.assign_wine_sections_private\(/);
assert.doesNotMatch(up, /create or replace function public\.assign_wine_sections_private/);
assert.match(up, /p_restaurant_id uuid,\s+p_wine_ids uuid\[\],\s+p_section text\s+\) returns jsonb/);
assert.match(up, /language plpgsql\s+security definer\s+set search_path = ''/);
assert.match(up, /revoke all on function public\.assign_wine_sections_private\(uuid,uuid\[\],text\)\s+from public, anon, authenticated, service_role;/);
assert.match(up, /grant execute on function public\.assign_wine_sections_private\(uuid,uuid\[\],text\)\s+to authenticated;/);
assert.match(up, /alter function public\.assign_wine_sections_private\(uuid,uuid\[\],text\) owner to postgres;/);

const authority = body.indexOf('v_actor := (select auth.uid())');
const validation = body.indexOf('v_section := nullif(pg_catalog.btrim(p_section), \'\')');
const locking = body.indexOf('order by w.id\n     for no key update');
const mutation = body.indexOf('update public.inventory_items ii');
assert.ok(authority >= 0 && validation > authority, 'authority must precede input validation');
assert.ok(locking >= 0 && mutation > locking, 'ordered wine locking must precede mutation');
assert.match(body, /raise exception 'section_assignment_invalid' using errcode = 'P04V1'/);
assert.match(body, /raise exception 'section_assignment_wine_set_refused' using errcode = 'P04W1'/);
assert.match(body, /where ii\.restaurant_id = p_restaurant_id\s+and ii\.wine_id = any\(p_wine_ids\)/);
assert.match(body, /'requestedWineCount', v_requested_count,\s+'section', v_section/);
assert.doesNotMatch(body, /unit_cost|quantity|currency|bin_id|bin_location|format|invoice_scan_id/);

assert.match(down, /<> 'de52e8ee719623d8f102f371051a47a12128145ba97f59892eb89dfd18b68e81'/);
assert.match(down, /drop function public\.assign_wine_sections_private\(uuid,uuid\[\],text\) restrict;/);
assert.doesNotMatch(down, /drop function[^;]*\bcascade\b/i);

for (const token of [
  "sqlstate 'P04V1'",
  "sqlstate 'P04W1'",
  "sqlstate '42501'",
  'C04_0160_SECTION_ASSIGNMENT_CONTRACT_PASS',
  'rollback;',
]) {
  assert.ok(contract.includes(token), `rollback contract missing ${token}`);
}
assert.ok(contract.includes("'requestedWineCount',200"));
assert.ok(contract.includes("ii.section='Second'"));
assert.ok(contract.includes('C04_0160_STOCK_COST_OR_PHYSICAL_CONSERVATION_FAILED'));
assert.ok(cycle.includes('C04_0160_MIGRATION_CYCLE_PASS'));
assert.ok(cycle.includes('\\ir ../../migrations/down/0160_wine_section_assignment_boundary.down.sql'));
assert.ok(cycle.includes('\\ir ../../migrations/0160_wine_section_assignment_boundary.sql'));
assert.ok(cycle.trim().includes('rollback;'));

console.log('C04_0160_SOURCE_CONTRACT_PASS');
