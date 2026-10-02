import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const fixture = await readFile(new URL("./fixture.sql", import.meta.url), "utf8");
const bootstrap = await readFile(new URL("../../0154-production-capability-bootstrap.sql", import.meta.url), "utf8");

test("fixture is one fail-closed transaction with final schema and synthetic identity admission", () => {
  assert.match(fixture, /^\\set ON_ERROR_STOP on\s+begin;/);
  assert.equal((fixture.match(/^commit;/gm) ?? []).length, 1);
  assert(fixture.indexOf("portable demo owner capability postflight failed") < fixture.indexOf("commit;"));
  assert(fixture.indexOf("zero mutable inventory and receipts") < fixture.indexOf("commit;"));
  assert.match(fixture, /schema_migrations where version = '0164'/);
  assert.match(fixture, /current_inventory_contract_version\(\) <> 2/);
  for (const pair of ["c.owner_id = c.staff_id", "c.restaurant_id = c.other_restaurant_id", "c.wine_id = c.staff_wine_id", "c.item_id = c.staff_item_id"]) {
    assert(fixture.includes(pair));
  }
  assert.match(fixture, /distinct synthetic identities required/);
  assert.match(fixture, /expected_database <> 'postgres'/);
});

test("only the exact named synthetic owner receives the reviewed explicit 0154 capability set", () => {
  const authority = fixture.slice(fixture.indexOf("-- Use 0154"), fixture.indexOf("$portable_demo_capabilities$;"));
  for (const reviewedContract of [
    "lock table public.membership_capability_grants in share row exclusive mode;",
    "exists (select 1 from public.membership_capability_grants)",
    "public.replace_member_site_capabilities(",
    "array['cost.read','margin.read','pricing.manage']",
  ]) {
    assert(bootstrap.includes(reviewedContract));
    assert(authority.includes(reviewedContract));
  }
  assert.match(authority, /where m\.user_id = c\.owner_id and m\.restaurant_id = c\.restaurant_id/);
  assert.match(authority, /select m\.id into strict owner_membership_id/);
  assert.match(authority, /set_config\('request\.jwt\.claim\.sub', c\.owner_id::text, true\)/);
  assert.match(authority, /g\.membership_id <> owner_membership_id/);
  assert.match(authority, /g\.restaurant_id <> c\.restaurant_id/);
  assert.match(authority, /g\.subject_user_id <> c\.owner_id/);
  assert.match(authority, /g\.granted_by_user_id <> c\.owner_id/);
  assert.match(authority, /g\.revoked_at is not null or g\.expires_at is not null/);
  assert.match(authority, /count\(\*\) from public\.membership_capability_grants\) <> 3/);
  assert.match(fixture, /wm\.governance_role = 'workspace_owner'/);
  assert.match(authority, /not public\.current_site_role_at_least\(c\.restaurant_id, 'owner'\)/);
  assert.match(authority, /public\.read_current_operational_memberships\(c\.owner_id\)/);
});

test("staff remains a current operational member without governance or pricing grants", () => {
  assert.match(fixture, /values \(c\.staff_id, c\.restaurant_id, 'staff'\)/);
  assert.match(fixture, /wm\.governance_role is null/);
  assert.match(fixture, /wm\.user_id = c\.staff_id/);
  assert.match(fixture, /m\.revoked_at is null and m\.expires_at is null/);
  assert.match(fixture, /wm\.status = 'active' and wm\.revoked_at is null and wm\.expires_at is null/);
  const staffPostflight = fixture.slice(fixture.indexOf("set_config('request.jwt.claim.sub', c.staff_id"), fixture.indexOf("$portable_demo_capabilities$;"));
  for (const key of ["cost.read", "margin.read", "pricing.manage"]) {
    assert(staffPostflight.includes(`effective_site_capability(c.restaurant_id, '${key}')`));
  }
  assert.match(staffPostflight, /staff must be operational without pricing capabilities/);
  assert.match(staffPostflight, /not public\.current_site_role_at_least\(c\.restaurant_id, 'staff'\)/);
  assert.match(staffPostflight, /or public\.current_site_role_at_least\(c\.restaurant_id, 'manager'\)/);
  assert.match(staffPostflight, /public\.read_current_operational_memberships\(c\.staff_id\)/);
  assert.match(staffPostflight, /set_config\('request\.jwt\.claim\.sub', '', true\)/);
  assert.match(fixture, /'staffCapabilities', '\[\]'::jsonb/);
});

test("fixture cannot relax production authority or fabricate stock, receipts, or service history", () => {
  assert.doesNotMatch(fixture, /(?:alter table|create policy|drop policy|grant \w|revoke \w|session_replication_role|disable trigger|create (?:or replace )?function)/i);
  assert.doesNotMatch(fixture, /insert into public\.(?:membership_capability_grants|inventory_items|open_bottles|pour_events|inventory_command_receipts)/i);
  assert.doesNotMatch(fixture, /update public\.(?:workspace_memberships|memberships)/i);
  assert.match(fixture, /'inventorySeedCount', 0/);
  assert.match(fixture, /'commandReceiptSeedCount', 0/);
});
