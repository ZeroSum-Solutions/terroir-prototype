import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const sha256 = (value: string) =>
  createHash("sha256").update(value).digest("hex");

const migration = read("supabase/migrations/0154_site_capability_authority.sql");
const down = read(
  "supabase/migrations/down/0154_site_capability_authority.down.sql",
);
const preflight = read("scripts/0154-production-preflight.sql");
const manifest = read(
  "docs/plans/2026-08-24-visual-wine-platform-spec-list.md",
);
const fixtureRoot = "supabase/tests/0154_site_capability_authority";
const fixtureNames = [
  "README.md",
  "authority-catalog-acceptance.sql",
  "authority-semantics-acceptance.sql",
  "authority-authenticated-owner-repoint.sql",
  "authority-ledger-acl-negative.sql",
  "authority-pricing-parity.sql",
  "authority-race-setup.sql",
  "authority-lifecycle-site-session.sql",
  "authority-lifecycle-workspace-session.sql",
  "authority-lifecycle-race-acceptance.sql",
  "authority-governance-demote-session.sql",
  "authority-governance-replace-session.sql",
  "authority-governance-race-acceptance.sql",
  "authority-state-fingerprint.sql",
  "authority-down-dependency-fixture.sql",
] as const;
const fixtures = new Map(
  fixtureNames.map((name) => [name, read(`${fixtureRoot}/${name}`)]),
);

const normalize = (value: string) =>
  value.replace(/--[^\n]*/gu, " ").replace(/\s+/gu, " ").trim().toLowerCase();
const normalizedMigration = normalize(migration);
const normalizedDown = normalize(down);

describe("C04 additive site-capability Authority A source", () => {
  it("pins the sealed grant history and closed three-key vocabulary", () => {
    const tableStart = normalizedMigration.indexOf(
      "create table public.membership_capability_grants",
    );
    const tableEnd = normalizedMigration.indexOf(
      "create unique index membership_capability_grants_current_key",
      tableStart,
    );
    const ledger = normalizedMigration.slice(tableStart, tableEnd);

    expect(tableStart).toBeGreaterThan(-1);
    expect(ledger).not.toContain(" references ");
    expect(ledger).toContain(
      "capability_key in ('cost.read', 'margin.read', 'pricing.manage')",
    );
    expect(ledger).toContain("source = 'workspace_governance'");
    expect(migration).not.toContain("pilot.measurement.");
    expect(normalizedMigration).toContain(
      "create unique index membership_capability_grants_current_key on public.membership_capability_grants (membership_id, capability_key) where revoked_at is null",
    );
    expect(normalizedMigration).toContain(
      "revoke all on table public.membership_capability_grants from public, anon, authenticated, service_role",
    );
  });

  it("pins caller-owned generations, complete live identity, and one child order", () => {
    expect(normalizedMigration).toContain(
      "alter table public.memberships add column lifecycle_generation uuid not null default gen_random_uuid()",
    );
    expect(normalizedMigration).toContain(
      "alter table public.workspace_memberships add column lifecycle_generation uuid not null default gen_random_uuid()",
    );
    expect(normalizedMigration).toContain(
      "order by g.membership_id, g.capability_key, g.id for update",
    );
    expect((normalizedMigration.match(/perform public\.retire_membership_capability_grants\(/gu) ?? [])).toHaveLength(5);
    expect(normalizedMigration).toContain(
      "if tg_op = 'insert' then new.lifecycle_generation := gen_random_uuid()",
    );
    expect(normalizedMigration).toContain(
      "create trigger memberships_z_capability_lifecycle before insert or update or delete on public.memberships",
    );
    expect(normalizedMigration).toContain(
      "create trigger workspace_memberships_z_capability_lifecycle before insert or update or delete on public.workspace_memberships",
    );
    expect(migration).not.toMatch(
      /create trigger memberships_z_capability_lifecycle[\s\S]*?update of/iu,
    );

    for (const predicate of [
      "m.id = g.membership_id",
      "m.user_id = g.subject_user_id",
      "m.restaurant_id = g.restaurant_id",
      "m.workspace_membership_id = g.workspace_membership_id",
      "m.lifecycle_generation = g.site_lifecycle_generation",
      "r.id = g.restaurant_id",
      "r.workspace_id = g.workspace_id",
      "wm.id = g.workspace_membership_id",
      "wm.user_id = m.user_id",
      "wm.user_id = g.subject_user_id",
      "wm.workspace_id = r.workspace_id",
      "wm.workspace_id = g.workspace_id",
      "wm.lifecycle_generation = g.workspace_lifecycle_generation",
      "g.subject_user_id = (select auth.uid())",
    ]) {
      expect(normalizedMigration, predicate).toContain(predicate);
    }

    for (const identityField of [
      "new.user_id is distinct from old.user_id",
      "new.restaurant_id is distinct from old.restaurant_id",
      "new.workspace_membership_id is distinct from old.workspace_membership_id",
      "new.workspace_id is distinct from old.workspace_id",
    ]) {
      expect(normalizedMigration, identityField).toContain(identityField);
    }
  });

  it("pins four explicit authenticated RPCs and the tenant-safe pricing shape", () => {
    const replacementStart = normalizedMigration.indexOf(
      "create function public.replace_member_site_capabilities",
    );
    const replacementEnd = normalizedMigration.indexOf(
      "create function public.read_pricing_recommendations",
      replacementStart,
    );
    const replacement = normalizedMigration.slice(
      replacementStart,
      replacementEnd,
    );
    const workspaceLock = replacement.indexOf(
      "perform 1 from public.workspaces",
    );
    const workspaceMembershipLocks = replacement.indexOf(
      "perform 1 from public.workspace_memberships",
    );
    const siteMembershipLock = replacement.indexOf(
      "perform 1 from public.memberships",
    );
    const grantLocks = replacement.indexOf(
      "perform public.retire_membership_capability_grants",
    );

    expect(replacementStart).toBeGreaterThan(-1);
    expect(replacementEnd).toBeGreaterThan(replacementStart);
    expect(workspaceLock).toBeGreaterThan(-1);
    expect(workspaceMembershipLocks).toBeGreaterThan(workspaceLock);
    expect(siteMembershipLock).toBeGreaterThan(workspaceMembershipLocks);
    expect(grantLocks).toBeGreaterThan(siteMembershipLock);

    const rpcSignatures = [
      "public.effective_site_capability(uuid,text)",
      "public.effective_site_ids(text)",
      "public.replace_member_site_capabilities(uuid,text[],timestamptz,text)",
      "public.read_pricing_recommendations(uuid)",
    ];
    for (const signature of rpcSignatures) {
      expect(normalizedMigration).toContain(
        `grant execute on function ${signature} to authenticated`,
      );
    }
    expect((normalizedMigration.match(/revoke all on function/gu) ?? [])).toHaveLength(
      8,
    );
    expect((normalizedMigration.match(/grant execute on function/gu) ?? [])).toHaveLength(
      4,
    );
    expect(normalizedMigration).toContain("w.id = pr.wine_id");
    expect(normalizedMigration).toContain(
      "w.restaurant_id = pr.restaurant_id",
    );
    expect(normalizedMigration).toContain(
      "order by pr.class asc, pr.computed_at desc, pr.wine_id asc",
    );
    for (const field of [
      "wine_id uuid",
      "class text",
      "rationale text",
      "evidence jsonb",
      "timing text",
      "computed_at timestamptz",
      "wines jsonb",
    ]) {
      expect(normalizedMigration).toContain(field);
    }
    expect(normalizedMigration).toContain(
      "p_capability_key in ('cost.read', 'margin.read', 'pricing.manage')",
    );
    expect(normalizedMigration).toContain(
      "v_caller_workspace_member.governance_role is null",
    );
  });

  it("keeps the down lossless and the operator probe aligned", () => {
    expect(normalizedDown).toContain(
      "c04_cannot_down_0154_grant_history_exists",
    );
    expect(normalizedDown).toContain(
      "c04_cannot_down_0154_contract_b_or_legacy_select_drift",
    );
    expect(normalizedDown).not.toContain("cascade");
    expect((normalizedDown.match(/ restrict/g) ?? [])).toHaveLength(9);
    expect(normalizedDown).toContain("begin;");
    expect(normalizedDown).toContain("commit;");

    for (const lock of [
      "public.memberships in access exclusive mode nowait",
      "public.workspace_memberships in access exclusive mode nowait",
      "public.workspaces in share mode nowait",
      "public.restaurants in share mode nowait",
      "public.pricing_recommendations in share mode nowait",
      "public.wines in share mode nowait",
    ]) {
      expect(normalize(preflight), lock).toContain(lock);
    }
  });

  it("ships finite runtime fixtures for every Authority A risk", () => {
    expect(fixtures.size).toBe(fixtureNames.length);
    const allFixtures = normalize([...fixtures.values()].join("\n"));
    for (const evidence of [
      "c04_site_lifecycle_generation_forgery",
      "c04_workspace_lifecycle_generation_forgery",
      "membership_identity_immutable",
      "workspace_membership_identity_immutable",
      "c04_capability_grant_history_immutable",
      "c04_capability_grant_history_delete_forbidden",
      "subject mismatch",
      "restaurant mismatch",
      "workspace membership link mismatch",
      "workspace mismatch",
      "workspace member user mismatch",
      "update public.workspace_memberships set governance_role = null",
      "generate_series(1, 1005)",
      "with ordinality as rpc",
      "limit 1000 offset 0",
      "limit 1000 offset 1000",
      "c04_0154_pricing_without_capabilities_allowed",
      "c04_0154_pricing_cost_only_allowed",
      "c04_0154_pricing_margin_only_allowed",
      "c04_0154_cross_tenant_pricing_pair_visible",
      "c04_0154_site_parent_locked",
      "c04_0154_workspace_parent_locked",
      "c04_0154_governance_demotion_locked",
      "c04_0154_authenticated_owner_repoint_pass",
      "c04_0154_site_delete_history_failure",
      "c04_0154_workspace_delete_history_failure",
      "c04_0154_expired_public_replacement_history_failure",
      "c04_cannot_down_0154_grant_history_exists",
      "2bp01",
    ]) {
      expect(allFixtures, evidence).toContain(evidence);
    }
  });

  it("pins the corrected finite fixtures against vacuous proof", () => {
    const siteRace = normalize(
      fixtures.get("authority-lifecycle-site-session.sql")!,
    );
    const workspaceRace = normalize(
      fixtures.get("authority-lifecycle-workspace-session.sql")!,
    );
    const raceAcceptance = normalize(
      fixtures.get("authority-lifecycle-race-acceptance.sql")!,
    );
    for (const [fixture, parentMarker, update] of [
      [
        siteRace,
        "c04_0154_site_parent_locked",
        "update public.memberships",
      ],
      [
        workspaceRace,
        "c04_0154_workspace_parent_locked",
        "update public.workspace_memberships",
      ],
    ] as const) {
      const parentLock = fixture.indexOf("for update");
      const ready = fixture.indexOf(parentMarker);
      const gate = fixture.indexOf("pg_advisory_xact_lock_shared(1540404)");
      const parentUpdate = fixture.indexOf(update);
      expect(parentLock).toBeGreaterThan(-1);
      expect(ready).toBeGreaterThan(parentLock);
      expect(gate).toBeGreaterThan(ready);
      expect(parentUpdate).toBeGreaterThan(gate);
    }
    expect(raceAcceptance).toContain(
      "not in ('site_lifecycle', 'workspace_lifecycle')",
    );
    expect(raceAcceptance).not.toContain(
      "revoke_cause <> 'site_lifecycle'",
    );
    const readme = normalize(fixtures.get("README.md")!);
    expect(readme).toContain("select pg_advisory_lock(1540404)");
    expect(readme).toContain("select pg_advisory_unlock(1540404)");
    expect(readme).toContain("either `site_lifecycle` or `workspace_lifecycle`");
    expect((siteRace.match(/select pg_sleep\(1\)/gu) ?? [])).toHaveLength(1);
    expect((workspaceRace.match(/select pg_sleep\(1\)/gu) ?? [])).toHaveLength(
      1,
    );

    const pricing = normalize(fixtures.get("authority-pricing-parity.sql")!);
    expect(pricing.match(/with ordinality as rpc/gu) ?? []).toHaveLength(2);
    expect(pricing).toContain("array['cost.read']");
    expect(pricing).toContain("array['margin.read']");
    expect(pricing).toContain("array['cost.read', 'margin.read']");
    expect(pricing).toContain("limit 1000 offset 0");
    expect(pricing).toContain("limit 1000 offset 1000");
    expect(pricing).not.toContain("row_number() over (order by rpc.");
    expect(pricing).toContain("select * from c04_pricing_legacy except all select * from c04_pricing_rpc");
    expect(pricing).toContain("to_jsonb(legacy) is distinct from to_jsonb(rpc)");

    const semantics = normalize(
      fixtures.get("authority-semantics-acceptance.sql")!,
    );
    expect(semantics).toContain("public.effective_site_ids('cost.read')");
    expect(semantics).toContain("public.effective_site_ids('invented.capability')");
    expect(semantics).toContain("perform public.replace_member_site_capabilities( v_subject_membership, array['pricing.manage']");
    expect(semantics).toContain("g.revoke_cause = 'site_delete'");
    expect(semantics).toContain("g.revoke_cause = 'workspace_delete'");
    expect(semantics).toContain("public.effective_site_capability(v_site_b, 'cost.read')");

    const authenticatedRepoint = normalize(
      fixtures.get("authority-authenticated-owner-repoint.sql")!,
    );
    expect(authenticatedRepoint).toContain("set local role authenticated");
    expect(authenticatedRepoint).toContain("set user_id = v_fixture.other_user_id");
    expect(authenticatedRepoint).toContain("set restaurant_id = v_fixture.site_b");
    expect(authenticatedRepoint).toContain(
      "set workspace_membership_id = v_fixture.other_workspace_membership_id",
    );
    expect(authenticatedRepoint).toContain(
      "v_parent is distinct from v_fixture.baseline_parent",
    );
    expect(authenticatedRepoint).toContain(
      "v_history is distinct from v_fixture.baseline_history",
    );

    const catalog = normalize(
      fixtures.get("authority-catalog-acceptance.sql")!,
    );
    expect(catalog).toContain("from pg_catalog.pg_trigger prior");
    expect(catalog).not.toContain(
      "'memberships_z_capability_lifecycle' <= 'memberships_link_workspace'",
    );
  });

  it("adds exactly the 0154 manifest row and preserves prior contracts", () => {
    const rows = manifest.match(/^\| 0154 \|.*$/gmu) ?? [];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toContain("`site_capability_authority.sql`");
    expect(rows[0]).toContain("No application cutover");
    expect(rows[0]).toContain("TER-CF-321..324");
    expect(rows[0]).not.toContain("TER-CF-274..281");

    expect(sha256(migration)).toBe(
      "1f464a5de4f4039a129ff9d5f6ecd9fa5bacf3dc12af34abe78e6c805a197600",
    );
    expect(sha256(down)).toBe(
      "ba42abad481d147dca9ce979fa541eba3d131ff86669dfcc6875666fcfe5cbf3",
    );
    expect(sha256(preflight)).toBe(
      "8077c817de098b3ddcb87031e95995ccdc85ddaf19a2a5920f30bf7d70fc6316",
    );

    expect(
      sha256(read("supabase/migrations/0152_workspace_access_foundation.sql")),
    ).toBe("4fcfb80e4503eb469a65db9f719191b0abdf1c005a5ae016f7faabd4daeb59d9");
    expect(
      sha256(
        read(
          "supabase/migrations/down/0152_workspace_access_foundation.down.sql",
        ),
      ),
    ).toBe("b60dfb77c2224801df36de7f5112134842b6c9f9532271211fb5384196dfad97");
    expect(sha256(read("src/test/contracts/database-contracts.test.ts"))).toBe(
      "808c8fcb5844ad5dad7f01434fe99a63959d0a9b1866cde5a8980e4201c5a90b",
    );
  });
});
