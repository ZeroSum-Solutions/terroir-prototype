import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");

describe("transactional CI migration bootstrap", () => {
  const script = read("scripts/local/ci-start-supabase.sh");
  const cutover = read("scripts/local/ci-apply-cutover-migrations.sh");
  const capabilityBootstrap = read("scripts/0154-production-capability-bootstrap.sql");
  const ciCapabilityBootstrap = read("scripts/local/ci-bootstrap-owner-capabilities.sh");
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
    expect(script).toContain("CI_MIGRATION_CEILING");
    expect(cutover).toContain("--single-transaction");
    expect(cutover).toContain("expected 0155");
    expect(cutover).toContain("0156-production-preflight.sql");
    expect(cutover).toContain("0158-production-postflight.sql");
  });

  it("proves retired contracts before cutover and the current app afterward", () => {
    const workflow = read(".github/workflows/ci.yml");
    const bootstrapStep = workflow.indexOf(
      "name: Bootstrap explicit seed-owner capabilities",
    );
    const legacyStep = workflow.indexOf("name: Legacy-contract live tests");
    const cutoverStep = workflow.indexOf(
      "name: Apply physical and operational cutover migrations",
    );
    const currentStep = workflow.indexOf("name: Test", cutoverStep);
    expect(bootstrapStep).toBeGreaterThan(-1);
    expect(legacyStep).toBeGreaterThan(bootstrapStep);
    expect(cutoverStep).toBeGreaterThan(legacyStep);
    expect(currentStep).toBeGreaterThan(cutoverStep);
    expect(workflow).toContain(
      "--exclude src/domains/pours/inventory-commands-live.test.ts",
    );
    expect(workflow).toContain(
      "src/domains/pours/physical-bottle-phase-a-live.test.ts",
    );
    expect(workflow).not.toContain("VITEST_DEFER_COVERAGE_THRESHOLDS");
    expect(workflow).not.toContain("--reporter=blob");
    expect(workflow).not.toContain("--merge-reports");
    expect(workflow).toContain("pnpm exec vitest run --coverage");
  });

  it("exercises the production capability bootstrap with an exact local seed owner", () => {
    expect(capabilityBootstrap).toContain(":'capability_manifest'::jsonb");
    expect(capabilityBootstrap).toContain("C04_0154_BOOTSTRAP_REQUIRES_EMPTY_HISTORY");
    expect(capabilityBootstrap).toContain("public.replace_member_site_capabilities");
    expect(capabilityBootstrap).toContain("C04_0154_CAPABILITY_BOOTSTRAP_PASS");
    expect(capabilityBootstrap).not.toContain("jsonb_build_object(");
    expect(ciCapabilityBootstrap).toContain("refusing non-loopback database");
    expect(ciCapabilityBootstrap).toContain("owner+local@terroir.test");
    expect(ciCapabilityBootstrap).toContain("expected_entry_count=1");
  });

  it("is restricted to the disposable CI project", () => {
    expect(script).toContain('if [ "${CI:-}" != "true" ]');
    expect(script).toContain("terroir-vw-local");
    expect(script).toContain("unexpected project id");
    expect(script).not.toContain(".env.local");
    expect(cutover).toContain('if [ "${CI:-}" != "true" ]');
    expect(cutover).toContain("terroir-vw-local");
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
    expect(seed).toContain('? "legacy_slot" : "migrated_active"');
    expect(seed).toContain("event_contract: 1");
    expect(seed).not.toContain(
      'upsertRows(supabase, "pour_events", rows.pourEvents)',
    );
    expect(seed).not.toContain(
      'upsertRows(supabase, "open_bottles", rows.openBottles',
    );
  });
});
