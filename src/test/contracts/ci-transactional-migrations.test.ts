import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");

describe("transactional CI migration bootstrap", () => {
  const script = read("scripts/local/ci-start-supabase.sh");

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
});
