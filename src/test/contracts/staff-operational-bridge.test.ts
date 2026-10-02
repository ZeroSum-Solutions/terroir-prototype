import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

function read(path: string): string {
  const absolute = resolve(process.cwd(), path);
  return existsSync(absolute) ? readFileSync(absolute, "utf8") : "";
}

const migration = read("supabase/migrations/0158_staff_operational_bridge.sql");
const down = read(
  "supabase/migrations/down/0158_staff_operational_bridge.down.sql",
);
const preflight = read("scripts/0158-production-preflight.sql");
const postflight = read("scripts/0158-production-postflight.sql");
const frozen0157 = read(
  "supabase/migrations/0157_staff_cost_seal_additive.sql",
);
const raceHarness = read(
  "supabase/tests/0158_staff_operational_bridge/same-operation-race.sh",
);
const supplementalFixture = read(
  "supabase/tests/0158_staff_operational_bridge/supplemental-bounds-and-receipt-insert.sql",
);
const completedTransportFixture = read(
  "supabase/tests/0158_staff_operational_bridge/completed-transport-replay.sql",
);
const rejectedDownUp = read(
  "supabase/tests/0158_staff_operational_bridge/down-up-cycle.sh",
);
const normalized = migration.replace(/\s+/gu, " ").toLowerCase();
const normalizedDown = down.replace(/\s+/gu, " ").toLowerCase();

function functionBody(name: string): string {
  const start = normalized.indexOf(`create function public.${name}(`);
  if (start < 0) return "";
  const next = normalized.indexOf("create function public.", start + 1);
  return normalized.slice(start, next < 0 ? undefined : next);
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

describe("0158 staff operational bridge source contract", () => {
  it("owns only the reserved additive files and leaves frozen 0157 byte exact", () => {
    expect(migration).toContain("0158_staff_operational_bridge.sql");
    expect(down).toContain("0158_staff_operational_bridge.down.sql");
    expect(sha256(frozen0157)).toBe(
      "e4107961a846d96a8a58225ee6b030eea734f8778627a2615604bc3b450de8e6",
    );
    expect(normalized).not.toContain("create table");
    expect(normalized).not.toMatch(
      /alter table public\.inventory_command_receipts add column/u,
    );
  });

  it("publishes the exact typed signatures with no arbitrary JSON input", () => {
    expect(normalized).toContain(
      "create function public.read_current_operational_memberships(p_user_id uuid)",
    );
    expect(normalized).toContain(
      "create function public.save_bottle_inventory_private( p_restaurant_id uuid, p_key uuid, p_name text, p_producer text, p_vintage integer, p_varietal text, p_region text, p_country text, p_format text, p_quantity integer, p_unit_cost numeric ) returns jsonb",
    );
    const writer = functionBody("save_bottle_inventory_private");
    expect(writer.slice(0, writer.indexOf(") returns jsonb"))).not.toContain(
      "jsonb",
    );
    expect(normalized).toContain(
      "returns table ( restaurant_id uuid, restaurant_name text, role public.membership_role )",
    );
  });

  it("reads only exact lifecycle-current linked operational memberships", () => {
    const reader = functionBody("read_current_operational_memberships");
    for (const fragment of [
      "p_user_id is not null",
      "p_user_id = (select auth.uid())",
      "m.user_id = p_user_id",
      "public.memberships",
      "public.restaurants",
      "public.workspaces",
      "w.kind = 'restaurant'",
      "public.workspace_memberships",
      "wm.id = m.workspace_membership_id",
      "wm.workspace_id = w.id",
      "wm.user_id = m.user_id",
      "m.status = 'active'",
      "m.revoked_at is null",
      "m.expires_at > statement_timestamp()",
      "wm.status = 'active'",
      "wm.revoked_at is null",
      "wm.expires_at > statement_timestamp()",
      "order by m.created_at desc, m.id desc",
    ]) {
      expect(reader, fragment).toContain(fragment);
    }
    expect(reader).toContain("select m.restaurant_id, r.name, m.role");
    expect(reader).not.toContain("governance_role");
    expect(reader).not.toContain("effective_site_capability");
    expect(reader).not.toContain("active_site");
  });

  it("extends only the closed receipt checks and preserves versions one and two", () => {
    expect(normalized).toContain("check (command_version in (1, 2, 3))");
    expect(normalized).toContain(
      "command_version = 1 and command_type in ('open', 'pour', 'spill', 'discard', 'close')",
    );
    expect(normalized).toContain(
      "command_version = 2 and command_type in ('open', 'pour', 'spill', 'discard', 'close', 'undo')",
    );
    expect(normalized).toContain(
      "command_version = 2 and command_type = 'reconcile_batch'",
    );
    expect(normalized).toContain(
      "command_version = 3 and command_type = 'bottle_inventory_save'",
    );
    expect(normalized).toContain(
      "scope_kind = 'single_wine' and wine_id is not null and batch_entry_count is null",
    );
  });

  it("validates the accepted scalar boundary and grants staff no pricing authority", () => {
    const writer = functionBody("save_bottle_inventory_private");
    for (const fragment of [
      "public.current_site_role_at_least(p_restaurant_id, 'staff')",
      "v_name text := btrim(p_name)",
      "v_producer text := btrim(p_producer)",
      "v_varietal text := nullif(p_varietal, '')",
      "v_region text := nullif(p_region, '')",
      "octet_length(v_name) > 500",
      "octet_length(v_producer) > 500",
      "octet_length(p_varietal) > 500",
      "octet_length(p_region) > 500",
      "octet_length(p_country) > 500",
      "octet_length(p_format) > 100",
      "p_quantity not between 1 and 100000",
      "p_unit_cost not between 0 and 1000000",
      "'size_ml', 750",
      "'bottle_scan'::public.added_via",
    ]) {
      expect(writer, fragment).toContain(fragment);
    }
    expect(writer).not.toContain("effective_site_capability");
    expect(writer).not.toContain("pricing.manage");
    expect(writer).not.toContain("cost.read");
  });

  it("locks transport then checks replay before preserving wine-before-receipt order", () => {
    const writer = functionBody("save_bottle_inventory_private");
    const transportLock = writer.indexOf("from public.scan_idempotency c");
    const completedReceipt = writer.indexOf(
      "from public.inventory_command_receipts r",
    );
    const findWine = writer.indexOf("public.find_or_create_wines_batch");
    const wineLock = writer.indexOf("from public.wines w", findWine);
    const receiptInsert = writer.indexOf(
      "insert into public.inventory_command_receipts",
    );
    const inventoryInsert = writer.indexOf(
      "insert into public.inventory_items",
    );
    const durableComplete = writer.indexOf(
      "update public.inventory_command_receipts r",
    );
    const transportComplete = writer.lastIndexOf(
      "public.complete_scan_idempotency",
    );

    expect(transportLock).toBeGreaterThan(0);
    expect(transportLock).toBeLessThan(completedReceipt);
    expect(completedReceipt).toBeLessThan(findWine);
    expect(findWine).toBeLessThan(wineLock);
    expect(wineLock).toBeLessThan(receiptInsert);
    expect(receiptInsert).toBeLessThan(inventoryInsert);
    expect(inventoryInsert).toBeLessThan(durableComplete);
    expect(durableComplete).toBeLessThan(transportComplete);
    expect(writer).toContain("for no key update");
    expect(writer).toContain("for update");
    expect(writer).toContain(
      "on conflict (restaurant_id, operation_id) do nothing",
    );
  });

  it("admits only a strict current completed bottle transport through the durable validator", () => {
    const writer = functionBody("save_bottle_inventory_private");
    const transportLock = writer.indexOf("from public.scan_idempotency c");
    const completedShape = writer.indexOf("v_transport.response_status = 200");
    const durableLock = writer.indexOf(
      "from public.inventory_command_receipts r",
    );
    const missingDurableRefusal = writer.indexOf(
      "if v_transport_completed then raise exception 'c04_bottle_operation_incomplete'",
    );
    const findWine = writer.indexOf("public.find_or_create_wines_batch");

    expect(writer).toContain("v_transport_completed boolean := false");
    expect(writer).toContain(
      "v_transport.created_at <= statement_timestamp() - interval '24 hours'",
    );
    expect(writer).toContain(
      "v_transport.claimed_by_user_id is distinct from v_actor then raise exception 'c04_bottle_transport_claim_required'",
    );
    expect(writer).toContain(
      "(select count(*) from jsonb_object_keys(v_transport.response_body)) = 5",
    );
    for (const fragment of [
      "v_transport.response_body ->> 'version' = '1'",
      "v_transport.response_body ->> 'kind' = 'bottle_inventory_save'",
      "v_transport.response_body ->> 'status' = 'committed'",
      "jsonb_typeof(v_transport.response_body -> 'wineid') = 'string'",
      "v_transport.response_body ->> 'itemcount' = '1'",
      "v_transport.response_body is distinct from jsonb_build_object",
    ]) {
      expect(writer, fragment).toContain(fragment);
    }
    expect(transportLock).toBeLessThan(completedShape);
    expect(completedShape).toBeLessThan(durableLock);
    expect(durableLock).toBeLessThan(missingDurableRefusal);
    expect(missingDurableRefusal).toBeLessThan(findWine);
  });

  it("returns one cost-free receipt and redacts durable conflicts", () => {
    const writer = functionBody("save_bottle_inventory_private");
    expect(writer).toContain('\'{"status":"committed"}\'::jsonb');
    expect(writer).toContain(
      "'bottle_inventory_save', null, 1, null, v_receipt.wine_id",
    );
    expect(writer).toContain(
      "'bottle_inventory_save', null, 1, null, v_wine_id",
    );
    expect(writer.match(/c04_bottle_operation_conflict/gu)).toHaveLength(2);
    expect(writer.match(/c04_bottle_operation_incomplete/gu)).toHaveLength(4);
    expect(writer).not.toContain("sqlerrm");
    expect(writer).not.toContain("request_payload ->");
  });

  it("keeps both functions closed, postgres-owned, and empty-search-path", () => {
    for (const name of [
      "read_current_operational_memberships",
      "save_bottle_inventory_private",
    ]) {
      const body = functionBody(name);
      expect(body).toContain("security definer");
      expect(body).toMatch(/set search_path\s*=\s*''/u);
      expect(normalized).toContain(`alter function public.${name}`);
    }
    expect(normalized).toContain("owner to postgres");
    expect(normalized).toContain("to authenticated");
    expect(normalized).not.toMatch(
      /grant (?:select|insert|update|delete) on (?:table )?public\.inventory_command_receipts/u,
    );
  });

  it("makes route drain, production posture, and guarded down explicit", () => {
    const normalizedPreflight = preflight.replace(/\s+/gu, " ").toLowerCase();
    const normalizedPostflight = postflight.replace(/\s+/gu, " ").toLowerCase();
    expect(preflight).toContain("\\if :{?bottle_route_drained}");
    expect(preflight).toContain("\\if :bottle_route_drained");
    expect(normalizedPreflight).toContain(
      "c04_0158_unbackfillable_bottle_transport_claim",
    );
    expect(normalizedPreflight).toContain("claimed_by_user_id is not null");
    expect(normalizedPostflight).toContain("prosecdef");
    expect(normalizedPostflight).toContain("rolname");
    expect(normalizedPostflight).toContain("search_path");
    expect(normalizedPostflight).toContain(
      "has_function_privilege('authenticated'",
    );
    expect(normalizedPostflight).toContain(
      "c04_0158_receipt_table_acl_widened",
    );

    const guard = normalizedDown.indexOf(
      "c04_0158_down_refuses_durable_history",
    );
    expect(guard).toBeGreaterThan(0);
    expect(guard).toBeLessThan(normalizedDown.indexOf("drop function"));
    expect(normalizedDown).toContain("check (command_version in (1, 2))");
    expect(normalizedDown).not.toContain(
      "delete from public.inventory_command_receipts",
    );
    expect(normalizedDown).not.toContain("command_version = 3 and");
  });

  it("pins the R2 race modes and keeps the rejected down/up runner frozen", () => {
    for (const fragment of [
      "9c977bd272b79003bfbebc2d8971e1a9906d228a5ac4f531097dd6d2087ba360",
      "terroir_cost_seal_20260926b",
      "independent-race-repair-source-admission.md",
      "2848957cd7e08dea5cc64f1b5c08aca3e5068a24b324e2a27bfdb131dbc1352b",
      "bec6d526b83e9c1d5061ebc73f4269bb722f73659d41a1b3259c465b3238bcf4",
      "05dc29c4e5b7f93fb4e9e4bcc94ab6cee1ec6c55d311a807a264db5e15e76b12",
      "3c18ec0fd47c18ad8ee5116950cec6ea946440a4db7a62a12bdaf974ae0c08b3",
      "9e994c077b87c05fd0f7e147d251c2f0c437d12f5510af52666e9f68d2e4be40",
      "af89b23096e236dd350bd39adec0a994de6cc122cd29c65ffecdc30a4cb18390",
      "same-input|changed-input",
      'race_mode="${3:-}"',
      '"${race_mode}" != "same-input"',
      '"${race_mode}" != "changed-input"',
      "C04_0158_RACE_RECEIPT|",
      '"${waiter_receipt}" != "${winner_receipt}"',
      "C04_BOTTLE_OPERATION_CONFLICT",
      "null,null,3,15",
      "(select count(*) from public.inventory_items where restaurant_id='15830000-0000-4000-8000-000000000004')=1",
      "(select coalesce(sum(quantity),0) from public.inventory_items where restaurant_id='15830000-0000-4000-8000-000000000004')=2",
      "C04_0158_SAME_OPERATION_RACE_PASS|${race_mode}",
      "C04_0158_RACE_OWNED_RESTAURANT_COUNT",
      "C04_0158_RACE_OWNED_WORKSPACE_COUNT",
      "C04_0158_RACE_OWNED_USER_COUNT",
      "C04_0158_RACE_POST_CLEANUP_STATE_MISMATCH",
    ]) {
      expect(raceHarness, fragment).toContain(fragment);
    }
    expect(raceHarness).toContain("pid<>pg_backend_pid()");
    expect(raceHarness).toContain("C04_0158_AUTO|");
    expect(raceHarness).not.toContain("C04_BOTTLE_TRANSPORT_CLAIM_REQUIRED");
    expect(sha256(raceHarness)).toBe(
      "54b5bbc385784c4f343fd554a916ec9273286f86c90ec52fc72ae059c2b9be5d",
    );
    expect(sha256(rejectedDownUp)).toBe(
      "6479ad8888f6c6ffa81e533733767e0c2de1d96bad61b4c07430ad504911a764",
    );
  });

  it("makes race cleanup independent of whether the winner created a canonical row", () => {
    const cleanup = raceHarness.slice(
      raceHarness.indexOf("cleanup()"),
      raceHarness.indexOf("trap cleanup EXIT"),
    );
    expect(cleanup).toContain(
      "or (select count(*) from c04_0158_owned_canonical)>1",
    );
    expect(cleanup).toContain(
      "select count(*) into expected_count from c04_0158_owned_canonical",
    );
    expect(cleanup).toContain("if deleted_count<>expected_count then");
    expect(cleanup).not.toContain(
      "(select count(*) from c04_0158_owned_canonical)<>1",
    );
    expect(cleanup).not.toMatch(
      /if deleted_count<>1 then\s+raise exception 'C04_0158_RACE_OWNED_CANONICAL_COUNT'/u,
    );
  });

  it("covers all required nulls, scalar bounds, and receipt-insert rollback", () => {
    for (const label of [
      "NULL_RESTAURANT",
      "NULL_KEY",
      "NULL_NAME",
      "NULL_PRODUCER",
      "NULL_VARIETAL",
      "NULL_REGION",
      "NULL_QUANTITY",
      "NULL_UNIT_COST",
      "NAME_501",
      "PRODUCER_501",
      "VARIETAL_501",
      "REGION_501",
      "COUNTRY_501",
      "FORMAT_101",
      "QUANTITY_ZERO",
      "QUANTITY_OVER",
      "COST_NEGATIVE",
      "COST_OVER",
      "RECEIPT_INSERT",
    ]) {
      expect(supplementalFixture, label).toContain(label);
    }
    expect(supplementalFixture).toContain("repeat('n',500)");
    expect(supplementalFixture).toContain("repeat('f',100)");
    expect(supplementalFixture).toContain("100000,1000000");
    expect(supplementalFixture).toContain(
      "before insert on public.inventory_command_receipts",
    );
    expect(supplementalFixture).toContain(
      "C04_0158_FORCED_RECEIPT_INSERT_FAILURE",
    );
    expect(supplementalFixture).toContain("c.claimed_by_user_id=v_actor");
    expect(supplementalFixture).toContain("c.response_status is null");
    expect(supplementalFixture).toContain(
      'c.response_body=\'{"version":1,"kind":"bottle_inventory_save","status":"claimed"}\'::jsonb',
    );
    expect(supplementalFixture).toContain("rollback;");
  });

  it("freezes completed-transport replay and refusal coverage as rollback-only", () => {
    const fixture = completedTransportFixture
      .replace(/\s+/gu, " ")
      .toLowerCase();
    for (const label of [
      "C04_0158_COMPLETED_REPLAY_MUTATED_STOCK",
      "C04_0158_EXPECTED_COMPLETED_ACTOR_REFUSAL",
      "C04_0158_EXPECTED_COMPLETED_QUANTITY_CONFLICT",
      "C04_0158_EXPECTED_COMPLETED_COST_CONFLICT",
      "C04_0158_EXPECTED_MISSING_DURABLE_REFUSAL",
      "C04_0158_EXPECTED_MALFORMED_DURABLE_REFUSAL",
      "C04_0158_EXPECTED_COMPLETED_KIND_REFUSAL",
      "C04_0158_EXPECTED_COMPLETED_TTL_REFUSAL",
      "C04_0158_COMPLETED_REFUSAL_LEFT_STOCK_EFFECT",
    ]) {
      expect(completedTransportFixture, label).toContain(label);
    }
    expect(fixture).toContain(
      "set created_at=statement_timestamp()-interval '24 hours'",
    );
    expect(fixture).toContain(
      "if v_message<>'c04_bottle_transport_claim_required' then raise; end if",
    );
    expect(
      fixture.match(/if v_message<>'c04_bottle_operation_conflict'/gu),
    ).toHaveLength(2);
    expect(
      fixture.match(/if v_message<>'c04_bottle_operation_incomplete'/gu),
    ).toHaveLength(2);
    expect(fixture).toContain(
      "rollback; \\echo c04_0158_completed_transport_replay_pass",
    );
  });
});
