import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const sha256 = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const normalize = (value: string) =>
  value.replace(/--[^\n]*/gu, " ").replace(/\s+/gu, " ").trim().toLowerCase();

const migrationPath =
  "supabase/migrations/0155_effective_service_pour_events_service_role_grant.sql";
const downPath =
  "supabase/migrations/down/0155_effective_service_pour_events_service_role_grant.down.sql";
const fixtureRoot =
  "supabase/tests/0155_effective_service_pour_events_service_role_grant";
const migration = read(migrationPath);
const down = read(downPath);
const postUp = read(`${fixtureRoot}/grant-post-up-acceptance.sql`);
const semantics = read(`${fixtureRoot}/grant-reader-semantics.sql`);
const downAcceptance = read(`${fixtureRoot}/grant-down-acceptance.sql`);
const manifest = read("docs/plans/2026-08-24-visual-wine-platform-spec-list.md");

describe("0155 effective service-event service-role grant source", () => {
  it("uses the next unique paired migration number and one manifest row", () => {
    const forward = readdirSync(resolve(process.cwd(), "supabase/migrations"))
      .filter((name) => name.startsWith("0155_"));
    const downs = readdirSync(resolve(process.cwd(), "supabase/migrations/down"))
      .filter((name) => name.startsWith("0155_"));
    const rows = manifest.match(/^\| 0155 \|.*$/gmu) ?? [];

    expect(forward).toEqual([
      "0155_effective_service_pour_events_service_role_grant.sql",
    ]);
    expect(downs).toEqual([
      "0155_effective_service_pour_events_service_role_grant.down.sql",
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toContain(
      "`effective_service_pour_events_service_role_grant.sql`",
    );
    expect(rows[0]).toContain("TER-CF-305");
    expect(rows[0]).toContain("no C04/C06 completion claim");
  });

  it("changes only the exact service-role SELECT ACL and fails on drift", () => {
    const normalizedMigration = normalize(migration);
    const normalizedDown = normalize(down);

    expect(
      normalizedMigration.match(
        /grant select on table public\.effective_service_pour_events to service_role;/gu,
      ),
    ).toHaveLength(1);
    expect(
      normalizedDown.match(
        /revoke select on table public\.effective_service_pour_events from service_role;/gu,
      ),
    ).toHaveLength(1);
    expect(normalizedMigration.match(/\bgrant\b/gu)).toHaveLength(1);
    expect(normalizedDown.match(/\brevoke\b/gu)).toHaveLength(1);
    for (const [rawSource, source] of [
      [migration, normalizedMigration],
      [down, normalizedDown],
    ] as const) {
      expect(rawSource).toContain("REQUIRES one caller-owned transaction");
      expect(rawSource).toContain(
        "psql -X -v ON_ERROR_STOP=1 --single-transaction",
      );
      expect(rawSource).not.toMatch(/^\s*commit\s*;/gimu);
      expect(rawSource.slice(0, rawSource.indexOf("do $preimage$"))).not.toMatch(
        /^\s*begin\s*;/gimu,
      );
      expect(source).toContain("c.reloptions = array['security_invoker=true']");
      expect(source).toContain(
        "'c06_definition_md5:' || md5(pg_catalog.pg_get_viewdef(c.oid, false))",
      );
      expect(source).toContain("pg_catalog.aclexplode");
      expect(source).toContain("'select_only'::text");
      expect(source).toContain("'supabase_five'::text");
      for (const privilege of ["MAINTAIN", "REFERENCES", "TRIGGER", "TRUNCATE"]) {
        expect(source).toContain(`'${privilege.toLowerCase()}'::text`);
      }
      expect(source).toMatch(
        /pg_catalog\.set_config\( 'terroir\.c06_0155_authenticated_acl_profile', v_acl_profile, true \)/u,
      );
      expect(source).toMatch(
        /pg_catalog\.current_setting\( 'terroir\.c06_0155_authenticated_acl_profile', true \)/u,
      );
      expect(source).toContain("v_acl_profile is null");
      expect(source).not.toContain("has_table_privilege");
      expect(source).not.toMatch(
        /v_authenticated_oid, '(?:insert|update|delete)'::text/gu,
      );
      expect(source).not.toMatch(/create\s+(?:or\s+replace\s+)?view/gu);
      expect(source).not.toMatch(/create\s+(?:or\s+replace\s+)?function/gu);
      expect(source).not.toMatch(/\block\s+table\b/gu);
      expect(source).not.toContain("public.pour_events to service_role");
      expect(source).not.toContain("grant all");
      expect(source).not.toMatch(
        /\b(?:alter|create|delete|drop|insert|truncate|update)\s+(?:table|view|function|into|from)\b/gu,
      );
    }
    for (const [source, mutation, error] of [
      [
        normalizedMigration,
        "grant select on table public.effective_service_pour_events to service_role;",
        "c06_0155_outer_transaction_required",
      ],
      [
        normalizedDown,
        "revoke select on table public.effective_service_pour_events from service_role;",
        "c06_0155_down_outer_transaction_required",
      ],
    ] as const) {
      const guard = normalize(`
        do $outer_transaction_guard$
        declare
          v_acl_profile text;
        begin
          v_acl_profile := pg_catalog.current_setting(
            'terroir.c06_0155_authenticated_acl_profile',
            true
          );
          if v_acl_profile is null
             or v_acl_profile = ''
             or v_acl_profile not in ('select_only', 'supabase_five') then
            raise exception '${error}'
              using errcode = 'P0001';
          end if;
        end;
        $outer_transaction_guard$;
      `);

      expect(source).toContain(`${guard} ${mutation}`);
    }
    expect(normalizedMigration).not.toContain("c06_0155_txn_probe");
    expect(normalizedDown).not.toContain("c06_0155_txn_probe");
    expect(normalizedMigration).not.toContain("revoke select on table");
    expect(normalizedDown).not.toContain("grant select on table");
  });

  it("pins ACL, containment, undo semantics, and exact down restoration fixtures", () => {
    expect(normalize(postUp)).toContain("c06_0155_exact_acl_tuple_mismatch");
    expect(normalize(postUp)).toContain("c06_0155_post_up_acl_profile=%");
    expect(normalize(postUp)).toContain("'select_only'::text");
    expect(normalize(postUp)).toContain("'supabase_five'::text");
    expect(normalize(postUp)).toContain(
      "v_owner_oid, v_service_role_oid, 'select'::text, false",
    );
    expect(normalize(semantics)).toContain("set local role authenticated");
    expect(normalize(semantics)).toContain(
      "c06_0155_authenticated_tenant_containment_failure",
    );
    expect(normalize(semantics)).toContain("set local role anon");
    expect(normalize(semantics)).toContain("when sqlstate '42501' then null");
    expect(normalize(semantics)).toContain("c06_0155_anon_select_not_denied");
    expect(normalize(semantics)).toMatch(
      /reset role; select set_config\('request\.jwt\.claim\.sub', '', true\); set local role service_role;/u,
    );
    expect(normalize(semantics)).toContain("set local role service_role");
    expect(normalize(semantics)).toContain("select r.rolbypassrls");
    expect(normalize(semantics)).toContain(
      "c06_0155_service_role_not_bypassrls",
    );
    expect(normalize(semantics)).toContain(
      "where restaurant_id = v_fixture.restaurant_id",
    );
    expect(normalize(semantics)).toContain(
      "c06_0155_service_role_undo_semantics_failure",
    );
    expect(normalize(downAcceptance)).toContain(
      "c06_0155_down_exact_0153_acl_mismatch",
    );
    expect(normalize(downAcceptance)).toContain("c06_0155_down_acl_profile=%");
    expect(normalize(downAcceptance)).toContain("'select_only'::text");
    expect(normalize(downAcceptance)).toContain("'supabase_five'::text");
    expect(normalize(downAcceptance)).not.toContain(
      "select v_owner_oid, v_service_role_oid",
    );
  });

  it("preserves the sealed 0153 migration pair byte-for-byte", () => {
    expect(sha256(read("supabase/migrations/0153_physical_bottle_expansion.sql"))).toBe(
      "597369d28c36956399d88bec90a51cfa7ffe21e6a810bbd187d76e8683c661ee",
    );
    expect(
      sha256(read("supabase/migrations/down/0153_physical_bottle_expansion.down.sql")),
    ).toBe("fd5263e1676bf0be57a77dc60d251e490f9cb9d6d6e40114eecdbef59e7b2d2b");
  });
});
