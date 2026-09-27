import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");

describe("transactional CI migration bootstrap", () => {
  const script = read("scripts/local/ci-start-supabase.sh");
  const seed = read("scripts/seed-local-supabase.mjs");

  it("is the only Supabase startup used by both database CI workflows", () => {
    for (const workflow of [
      ".github/workflows/ci.yml",
      ".github/workflows/e2e-full.yml",
    ]) {
      const source = read(workflow);
      expect(source).toContain("scripts/local/ci-start-supabase.sh");
      expect(source).not.toMatch(/^\s*supabase start\s*$/m);
    }
  });

  it("applies each migration and ledger row in one transaction", () => {
    expect(script).toContain("--single-transaction");
    expect(script).toContain("insert into supabase_migrations.schema_migrations");
    expect(script).toContain("refusing non-empty migration target");
    expect(script).toContain("a forward migration owns a conflicting transaction");
    expect(script).toContain("CREATE INDEX CONCURRENTLY cannot use the required transaction");
  });

  it("is restricted to the disposable CI project", () => {
    expect(script).toContain('if [ "${CI:-}" != "true" ]');
    expect(script).toContain("terroir-vw-local");
    expect(script).toContain("unexpected project id");
    expect(script).not.toContain(".env.local");
  });

  it("keeps the production-shaped seed inside the 0157 metadata allowlist", () => {
    expect(seed).toContain('source: "rule_engine"');
    expect(seed).toContain(
      'fields_enriched: ["drink_window", "serving_temp"]',
    );
    expect(seed).not.toContain('source: "local_seed"');
    expect(seed).not.toContain(
      'fields_enriched: ["drink_window", "serving_temp", "retail"]',
    );
  });

  it("keeps seeded invoice images inside the 0157 scan-owned path contract", () => {
    expect(seed).toContain("const scanId = uuid(UUID_PREFIX.scan, i)");
    expect(seed).toContain(
      '`${RESTAURANT_ID}/${scanId}${isMultiPage ? "_page1" : ""}.jpg`',
    );
    expect(seed).toContain('`${RESTAURANT_ID}/${scanId}_page2.jpg`');
    expect(seed).not.toContain("/local-seed/invoice-");
  });

  it("seeds sealed physical history only through the exact local database", () => {
    expect(seed).toContain('const dbContainer = "supabase_db_terroir-vw-local"');
    expect(seed).toContain("set local session_replication_role = replica");
    expect(seed).toContain("identity_origin: \"migrated_active\"");
    expect(seed).toContain("event_contract: 1");
    expect(seed).not.toContain(
      'upsertRows(supabase, "pour_events", rows.pourEvents)',
    );
    expect(seed).not.toContain(
      'upsertRows(supabase, "open_bottles", rows.openBottles',
    );
  });
});
