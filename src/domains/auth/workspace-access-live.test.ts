import { spawn } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { assertLiveDbTargetIsLocal } from "@/test/live-db-target";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const hasLiveDb = Boolean(supabaseUrl && publishableKey && serviceRoleKey);

if (hasLiveDb) assertLiveDbTargetIsLocal(supabaseUrl!);
if (!hasLiveDb && process.env.CI) {
  throw new Error("MANDATORY live-DB suite: local Supabase credentials missing in CI");
}

type Actor = {
  id: string;
  client: SupabaseClient;
  restaurantId: string;
  workspaceId: string;
  workspaceMembershipId: string;
};

const password = "Workspace-Access-Test-123!";

function sqlLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function localPostgresUrl(apiUrl: string): string {
  const parsed = new URL(apiUrl);
  const apiPort = Number(parsed.port);
  if (!Number.isInteger(apiPort) || apiPort <= 0) throw new Error("invalid local API port");
  return `postgresql://postgres:postgres@${parsed.hostname}:${apiPort + 1}/postgres`;
}

async function runPsql(sql: string): Promise<void> {
  const child = spawn(
    "psql",
    [localPostgresUrl(supabaseUrl!), "-X", "-v", "ON_ERROR_STOP=1", "-At"],
    { stdio: ["pipe", "pipe", "pipe"] },
  );
  let output = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => { output += chunk; });
  child.stderr.on("data", (chunk: string) => { output += chunk; });
  child.stdin.end(sql);
  await new Promise<void>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(output));
    });
  });
}

function runPsqlUntilMarker(sql: string, marker: string): {
  ready: Promise<void>;
  done: Promise<void>;
} {
  const child = spawn(
    "psql",
    [localPostgresUrl(supabaseUrl!), "-X", "-v", "ON_ERROR_STOP=1", "-At"],
    { stdio: ["pipe", "pipe", "pipe"] },
  );
  let output = "";
  let markReady: (() => void) | undefined;
  let markFailed: ((error: Error) => void) | undefined;
  const ready = new Promise<void>((resolve, reject) => {
    markReady = resolve;
    markFailed = reject;
  });
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    output += chunk;
    if (output.includes(marker)) markReady?.();
  });
  child.stderr.on("data", (chunk: string) => { output += chunk; });
  child.stdin.end(sql);
  const done = new Promise<void>((resolve, reject) => {
    child.once("error", (error) => {
      markFailed?.(error);
      reject(error);
    });
    child.once("close", (code) => {
      if (code === 0) {
        if (!output.includes(marker)) {
          const error = new Error(`psql completed before readiness marker: ${output}`);
          markFailed?.(error);
          reject(error);
          return;
        }
        resolve();
      } else {
        const error = new Error(output);
        markFailed?.(error);
        reject(error);
      }
    });
  });
  return { ready, done };
}

async function runCleanupRace(deleteSql: string, childSql: string): Promise<PromiseSettledResult<void>[]> {
  const first = runPsqlUntilMarker(deleteSql, "C04_LOCK_READY");
  await first.ready;
  return Promise.allSettled([first.done, runPsql(childSql)]);
}

describe.skipIf(!hasLiveDb)(
  "workspace access foundation (MANDATORY live DB)",
  { timeout: 60_000 },
  () => {
    let admin: SupabaseClient;
    const actorIds = new Set<string>();
    const restaurantIds = new Set<string>();
    const workspaceIds = new Set<string>();

    async function createActor(
      label: string,
      metadata: Record<string, unknown> = {},
    ): Promise<Actor> {
      const run = `${Date.now()}-${crypto.randomUUID()}`;
      const email = `workspace-${label}-${run}@terroir.test`;
      const { data: created, error: createError } = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { restaurant_name: `Workspace ${label}`, ...metadata },
      });
      if (createError || !created.user) throw createError ?? new Error("user create failed");
      actorIds.add(created.user.id);

      const { data: membership, error: membershipError } = await admin
        .from("memberships")
        .select("restaurant_id, workspace_membership_id")
        .eq("user_id", created.user.id)
        .eq("role", "owner")
        .single();
      if (membershipError || !membership) {
        throw membershipError ?? new Error("signup membership missing");
      }
      const { data: restaurant, error: restaurantError } = await admin
        .from("restaurants")
        .select("workspace_id")
        .eq("id", membership.restaurant_id)
        .single();
      if (restaurantError || !restaurant) {
        throw restaurantError ?? new Error("signup restaurant missing");
      }
      restaurantIds.add(membership.restaurant_id);
      workspaceIds.add(restaurant.workspace_id);

      const authClient = createClient(supabaseUrl!, publishableKey!, {
        auth: { persistSession: false },
      });
      const { data: session, error: signInError } = await authClient.auth.signInWithPassword({
        email,
        password,
      });
      if (signInError || !session.session) throw signInError ?? new Error("sign-in failed");
      const client = createClient(supabaseUrl!, publishableKey!, {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
        global: { headers: { Authorization: `Bearer ${session.session.access_token}` } },
      });

      return {
        id: created.user.id,
        client,
        restaurantId: membership.restaurant_id,
        workspaceId: restaurant.workspace_id,
        workspaceMembershipId: membership.workspace_membership_id,
      };
    }

    async function addSite(workspaceId: string, name: string): Promise<string> {
      const { data, error } = await admin.from("restaurants")
        .insert({ name, workspace_id: workspaceId })
        .select("id")
        .single();
      if (error || !data) throw error ?? new Error("site insert failed");
      restaurantIds.add(data.id);
      return data.id;
    }

    beforeAll(() => {
      admin = createClient(supabaseUrl!, serviceRoleKey!, { auth: { persistSession: false } });
    });

    afterAll(async () => {
      for (const actorId of actorIds) await admin.auth.admin.deleteUser(actorId);
      if (restaurantIds.size > 0) {
        await admin.from("restaurants").delete().in("id", [...restaurantIds]);
      }
      if (workspaceIds.size > 0) {
        await admin.from("workspace_memberships").delete().in("workspace_id", [...workspaceIds]);
        await admin.from("workspaces").delete().in("id", [...workspaceIds]);
      }
    });

    it("backfills exact containment without changing legacy identities", async () => {
      const [{ data: orphanSites }, { data: orphanMemberships }] = await Promise.all([
        admin.from("restaurants")
          .select("id, workspace_id, workspaces!inner(id, kind)")
          .neq("workspaces.kind", "restaurant"),
        admin.from("memberships")
          .select("id, user_id, restaurant_id, workspace_membership_id"),
      ]);
      expect(orphanSites).toEqual([]);

      const ids = (orphanMemberships ?? []).map((row) => row.workspace_membership_id);
      const { data: linked } = ids.length === 0
        ? { data: [] }
        : await admin.from("workspace_memberships")
          .select("id, workspace_id, user_id")
          .in("id", ids);
      expect(new Set((linked ?? []).map((row) => row.id)).size).toBe(ids.length);
    });

    it("preserves signup and ignores metadata that attempts authority escalation", async () => {
      const actor = await createActor("metadata", {
        workspace_id: crypto.randomUUID(),
        kind: "personal",
        governance_role: "group_admin",
        role: "staff",
        status: "revoked",
        expires_at: "2099-01-01T00:00:00Z",
      });
      expect(actor.workspaceId).toBe(actor.restaurantId);
      const [{ data: workspaceMember }, { count: reasonCount }] = await Promise.all([
        admin.from("workspace_memberships")
          .select("workspace_id, user_id, governance_role, status, expires_at")
          .eq("id", actor.workspaceMembershipId)
          .single(),
        admin.from("reason_codes")
          .select("id", { count: "exact", head: true })
          .eq("restaurant_id", actor.restaurantId),
      ]);
      expect(workspaceMember).toMatchObject({
        workspace_id: actor.restaurantId,
        user_id: actor.id,
        governance_role: "workspace_owner",
        status: "active",
        expires_at: null,
      });
      expect(reasonCount).toBe(7);
    });

    it("keeps old restaurant and membership inserts compatible", async () => {
      const owner = await createActor("compat-owner");
      const member = await createActor("compat-member");
      const { data: site, error: siteError } = await admin.from("restaurants")
        .insert({ name: "Old writer site" })
        .select("id, workspace_id")
        .single();
      if (siteError || !site) throw siteError ?? new Error("old restaurant insert failed");
      restaurantIds.add(site.id);
      workspaceIds.add(site.workspace_id);
      expect(site.workspace_id).toBe(site.id);

      const { data: membership, error: memberError } = await admin.from("memberships")
        .insert({ user_id: member.id, restaurant_id: site.id, role: "staff" })
        .select("role, workspace_membership_id, granted_by")
        .single();
      if (memberError || !membership) throw memberError ?? new Error("old membership failed");
      expect(membership.role).toBe("staff");
      expect(membership.workspace_membership_id).not.toBeNull();
      expect(membership.granted_by).toBeNull();

      const { error: authInsertError } = await owner.client.from("memberships").insert({
        user_id: member.id,
        restaurant_id: owner.restaurantId,
        role: "manager",
      });
      expect(authInsertError).toBeNull();
      const { data: authInserted } = await admin.from("memberships")
        .select("granted_by, workspace_membership_id")
        .eq("user_id", member.id)
        .eq("restaurant_id", owner.restaurantId)
        .single();
      expect(authInserted?.granted_by).toBe(owner.id);
    });

    it("rejects cross-user, cross-workspace, personal-site, and reassignment misuse", async () => {
      const a = await createActor("contain-a");
      const b = await createActor("contain-b");
      const a2 = await addSite(a.workspaceId, "Containment A2");

      const { error: crossUser } = await admin.from("memberships").insert({
        user_id: b.id,
        restaurant_id: a2,
        role: "staff",
        workspace_membership_id: a.workspaceMembershipId,
      });
      expect(crossUser?.message).toMatch(/membership_workspace_link_mismatch/);

      const { error: crossWorkspace } = await admin.from("memberships").insert({
        user_id: a.id,
        restaurant_id: b.restaurantId,
        role: "staff",
        workspace_membership_id: a.workspaceMembershipId,
      });
      expect(crossWorkspace?.message).toMatch(/membership_workspace_link_mismatch/);

      const personalId = crypto.randomUUID();
      workspaceIds.add(personalId);
      await admin.from("workspaces").insert({ id: personalId, kind: "personal", name: "Personal" });
      const { error: personalSite } = await admin.from("restaurants")
        .insert({ name: "Invalid personal site", workspace_id: personalId });
      expect(personalSite).not.toBeNull();

      const { error: serviceMove } = await admin.from("restaurants")
        .update({ workspace_id: b.workspaceId })
        .eq("id", a.restaurantId);
      expect(serviceMove?.message).toMatch(/workspace_reassignment_requires_review/);
      const { error: authMove } = await a.client.from("restaurants")
        .update({ workspace_id: b.workspaceId })
        .eq("id", a.restaurantId);
      expect(authMove?.message).toMatch(/workspace_reassignment_requires_review/);
    });

    it("keeps role edits compatible but requires delete-insert for grant identity moves", async () => {
      const owner = await createActor("identity-owner");
      const member = await createActor("identity-member");
      const other = await createActor("identity-other");
      const { data: inserted, error: insertError } = await admin.from("memberships")
        .insert({ user_id: member.id, restaurant_id: owner.restaurantId, role: "staff" })
        .select("id")
        .single();
      if (insertError || !inserted) throw insertError ?? new Error("membership insert failed");

      const { error: roleError } = await owner.client.from("memberships")
        .update({ role: "manager" })
        .eq("id", inserted.id);
      expect(roleError).toBeNull();
      const { error: identityError } = await admin.from("memberships")
        .update({ restaurant_id: other.restaurantId })
        .eq("id", inserted.id);
      expect(identityError?.message).toMatch(/membership_identity_immutable/);
    });

    it("returns only explicit sites with the exact fixed capability mapping", async () => {
      const owner = await createActor("cap-owner");
      const manager = await createActor("cap-manager");
      const staff = await createActor("cap-staff");
      const groupAdmin = await createActor("cap-group-admin");
      const a2 = await addSite(owner.workspaceId, "Capability A2");

      await admin.from("memberships").insert([
        { user_id: manager.id, restaurant_id: owner.restaurantId, role: "manager" },
        { user_id: manager.id, restaurant_id: a2, role: "manager" },
        { user_id: staff.id, restaurant_id: owner.restaurantId, role: "staff" },
      ]);
      await admin.from("workspace_memberships").insert({
        workspace_id: owner.workspaceId,
        user_id: groupAdmin.id,
        governance_role: "group_admin",
      });

      const [{ data: ownerAccess }, { data: managerAccess }, { data: staffAccess }] =
        await Promise.all([
          owner.client.rpc("shadow_effective_site_access", {
            p_restaurant_id: owner.restaurantId,
          }),
          manager.client.rpc("shadow_effective_site_access", {
            p_restaurant_id: owner.restaurantId,
          }),
          staff.client.rpc("shadow_effective_site_access", {
            p_restaurant_id: owner.restaurantId,
          }),
        ]);
      expect(ownerAccess?.[0]).toMatchObject({
        preset_key: "site_owner",
        capabilities: [
          "site.read", "inventory.service", "inventory.manage",
          "receiving.capture", "receiving.cost_capture", "count.capture",
          "discrepancy.approve", "cost.read", "margin.read", "pricing.manage",
          "team.site.manage", "group.manage",
        ],
      });
      expect(managerAccess?.[0]).toMatchObject({
        preset_key: "beverage_manager",
        capabilities: [
          "site.read", "inventory.service", "inventory.manage",
          "receiving.capture", "receiving.cost_capture", "count.capture",
          "discrepancy.approve", "cost.read", "margin.read", "pricing.manage",
        ],
      });
      expect(staffAccess?.[0]).toMatchObject({
        preset_key: "service_staff",
        capabilities: ["site.read", "inventory.service"],
      });

      const { data: noImplicit } = await groupAdmin.client.rpc(
        "shadow_effective_site_access",
        { p_restaurant_id: owner.restaurantId },
      );
      expect(noImplicit).toEqual([]);
      const { data: staffSites } = await staff.client.rpc("shadow_effective_site_ids", {
        p_capability_key: "site.read",
      });
      expect(staffSites).toContain(owner.restaurantId);
      expect(staffSites).not.toContain(a2);
      const { data: unknown } = await owner.client.rpc("shadow_has_site_capability", {
        p_restaurant_id: owner.restaurantId,
        p_capability_key: "invented.capability",
      });
      expect(unknown).toBe(false);
    });

    it("denies revoked and expired rows in shadow while legacy access stays live", async () => {
      const actor = await createActor("shadow-revoke");
      const now = new Date().toISOString();

      await admin.from("memberships").update({ status: "revoked", revoked_at: now })
        .eq("user_id", actor.id).eq("restaurant_id", actor.restaurantId);
      const [{ data: shadow }, { data: legacy }, { data: restaurant }] = await Promise.all([
        actor.client.rpc("shadow_has_site_capability", {
          p_restaurant_id: actor.restaurantId,
          p_capability_key: "site.read",
        }),
        actor.client.rpc("is_member", { r_id: actor.restaurantId }),
        actor.client.from("restaurants").select("id").eq("id", actor.restaurantId).single(),
      ]);
      expect(shadow).toBe(false);
      expect(legacy).toBe(true);
      expect(restaurant?.id).toBe(actor.restaurantId);

      await admin.from("memberships").update({ status: "active", revoked_at: null })
        .eq("user_id", actor.id).eq("restaurant_id", actor.restaurantId);
      await admin.from("workspace_memberships")
        .update({ expires_at: "2000-01-01T00:00:00Z" })
        .eq("id", actor.workspaceMembershipId);
      const { data: expired } = await actor.client.rpc("shadow_has_site_capability", {
        p_restaurant_id: actor.restaurantId,
        p_capability_key: "site.read",
      });
      expect(expired).toBe(false);
    });

    it("denies authenticated base-table DML while service fixtures remain possible", async () => {
      const actor = await createActor("privileges");
      const attempts = await Promise.all([
        actor.client.from("workspaces").select("id"),
        actor.client.from("workspaces").insert({ kind: "personal", name: "No" }),
        actor.client.from("workspaces").update({ name: "No" }).eq("id", actor.workspaceId),
        actor.client.from("workspaces").delete().eq("id", actor.workspaceId),
        actor.client.from("workspace_memberships").select("id"),
        actor.client.from("workspace_memberships").insert({
          workspace_id: actor.workspaceId,
          user_id: actor.id,
          governance_role: "group_admin",
        }),
        actor.client.from("workspace_memberships")
          .update({ governance_role: "group_admin" })
          .eq("id", actor.workspaceMembershipId),
        actor.client.from("workspace_memberships")
          .delete()
          .eq("id", actor.workspaceMembershipId),
      ]);
      expect(attempts.every(({ error }) => error !== null)).toBe(true);
    });

    it("cleans an ordinary derived singleton when its restaurant is deleted", async () => {
      const actor = await createActor("delete-singleton");
      const { error } = await admin.from("restaurants").delete().eq("id", actor.restaurantId);
      expect(error).toBeNull();
      restaurantIds.delete(actor.restaurantId);
      workspaceIds.delete(actor.workspaceId);
      const [{ count: workspaces }, { count: workspaceMembers }, { count: siteMembers }] =
        await Promise.all([
          admin.from("workspaces").select("id", { count: "exact", head: true })
            .eq("id", actor.workspaceId),
          admin.from("workspace_memberships").select("id", { count: "exact", head: true })
            .eq("workspace_id", actor.workspaceId),
          admin.from("memberships").select("id", { count: "exact", head: true })
            .eq("restaurant_id", actor.restaurantId),
        ]);
      expect({ workspaces, workspaceMembers, siteMembers }).toEqual({
        workspaces: 0,
        workspaceMembers: 0,
        siteMembers: 0,
      });
    });

    it("preserves meaningful empty workspace state after deleting the last site", async () => {
      const owner = await createActor("delete-meaningful-owner");
      const adminOnly = await createActor("delete-meaningful-admin");
      await admin.from("workspace_memberships").insert({
        workspace_id: owner.workspaceId,
        user_id: adminOnly.id,
        governance_role: "group_admin",
      });

      const { error } = await admin.from("restaurants").delete().eq("id", owner.restaurantId);
      expect(error).toBeNull();
      restaurantIds.delete(owner.restaurantId);
      const [{ count: workspaces }, { count: admins }] = await Promise.all([
        admin.from("workspaces").select("id", { count: "exact", head: true })
          .eq("id", owner.workspaceId),
        admin.from("workspace_memberships").select("id", { count: "exact", head: true })
          .eq("workspace_id", owner.workspaceId)
          .eq("governance_role", "group_admin"),
      ]);
      expect({ workspaces, admins }).toEqual({ workspaces: 1, admins: 1 });
    });

    it("preserves a former group when the child site is deleted first", async () => {
      const actor = await createActor("delete-former-group");
      const childSiteId = await addSite(actor.workspaceId, "Former group child");
      const { data: expanded } = await admin.from("workspaces")
        .select("expanded_at")
        .eq("id", actor.workspaceId)
        .single();
      expect(expanded?.expanded_at).not.toBeNull();

      await admin.from("restaurants").delete().eq("id", childSiteId);
      restaurantIds.delete(childSiteId);
      await admin.from("restaurants").delete().eq("id", actor.restaurantId);
      restaurantIds.delete(actor.restaurantId);

      const { data: preserved } = await admin.from("workspaces")
        .select("expanded_at")
        .eq("id", actor.workspaceId)
        .single();
      expect(preserved?.expanded_at).toBe(expanded?.expanded_at);
    });

    it("preserves a former group with no members when its last site is deleted", async () => {
      const actor = await createActor("delete-former-group-empty");
      const childSiteId = await addSite(actor.workspaceId, "Former group empty child");
      await admin.from("restaurants").delete().eq("id", childSiteId);
      restaurantIds.delete(childSiteId);

      const { error: userDeleteError } = await admin.auth.admin.deleteUser(actor.id);
      expect(userDeleteError).toBeNull();
      actorIds.delete(actor.id);
      await admin.from("restaurants").delete().eq("id", actor.restaurantId);
      restaurantIds.delete(actor.restaurantId);

      const { data: preserved } = await admin.from("workspaces")
        .select("expanded_at")
        .eq("id", actor.workspaceId)
        .single();
      expect(preserved?.expanded_at).not.toBeNull();
    });

    it.each([
      { scope: "workspace", values: { status: "revoked", revoked_at: new Date().toISOString() } },
      { scope: "site", values: { expires_at: "2099-01-01T00:00:00Z" } },
    ] as const)(
      "preserves singleton state with nondefault $scope membership lifecycle metadata",
      async ({ scope, values }) => {
        const actor = await createActor(`delete-nondefault-${scope}`);
        if (scope === "workspace") {
          await admin.from("workspace_memberships")
            .update(values)
            .eq("id", actor.workspaceMembershipId);
        } else {
          await admin.from("memberships")
            .update(values)
            .eq("user_id", actor.id)
            .eq("restaurant_id", actor.restaurantId);
        }
        await admin.from("restaurants").delete().eq("id", actor.restaurantId);
        restaurantIds.delete(actor.restaurantId);
        const { count } = await admin.from("workspaces")
          .select("id", { count: "exact", head: true })
          .eq("id", actor.workspaceId);
        expect(count).toBe(1);
      },
    );

    it("rejects standalone deletion of a referenced workspace membership", async () => {
      const actor = await createActor("referenced-workspace-member");
      const { error } = await admin.from("workspace_memberships")
        .delete()
        .eq("id", actor.workspaceMembershipId);
      expect(error).not.toBeNull();
      expect(error?.message).toMatch(/foreign key|still referenced/i);
      const { count } = await admin.from("workspace_memberships")
        .select("id", { count: "exact", head: true })
        .eq("id", actor.workspaceMembershipId);
      expect(count).toBe(1);
    });

    it("allows auth-user deletion before either membership cascade has run", async () => {
      const actor = await createActor("user-first-delete");
      const { error } = await admin.auth.admin.deleteUser(actor.id);
      expect(error).toBeNull();
      actorIds.delete(actor.id);
      const [{ count: siteMembers }, { count: workspaceMembers }] = await Promise.all([
        admin.from("memberships").select("id", { count: "exact", head: true })
          .eq("user_id", actor.id),
        admin.from("workspace_memberships").select("id", { count: "exact", head: true })
          .eq("user_id", actor.id),
      ]);
      expect({ siteMembers, workspaceMembers }).toEqual({ siteMembers: 0, workspaceMembers: 0 });
    });

    it("allows FK provenance clearing only when the real granter is deleted", async () => {
      const owner = await createActor("granter-owner");
      const member = await createActor("granter-member");
      const { error: grantError } = await owner.client.from("memberships").insert({
        user_id: member.id,
        restaurant_id: owner.restaurantId,
        role: "manager",
      });
      expect(grantError).toBeNull();
      const { data: recordedGrant } = await admin.from("memberships")
        .select("granted_by")
        .eq("user_id", member.id)
        .eq("restaurant_id", owner.restaurantId)
        .single();
      expect(recordedGrant?.granted_by).toBe(owner.id);

      const { error: forgedClear } = await admin.from("memberships")
        .update({ granted_by: null })
        .eq("user_id", member.id)
        .eq("restaurant_id", owner.restaurantId);
      expect(forgedClear?.message).toMatch(/membership_grant_provenance_immutable/);

      const { error: deleteError } = await admin.auth.admin.deleteUser(owner.id);
      expect(deleteError).toBeNull();
      actorIds.delete(owner.id);
      const { data: survivingGrant, error: survivingError } = await admin.from("memberships")
        .select("granted_by")
        .eq("user_id", member.id)
        .eq("restaurant_id", owner.restaurantId)
        .single();
      expect(survivingError).toBeNull();
      expect(survivingGrant?.granted_by).toBeNull();
    });

    it("deduplicates simultaneous old-style membership inserts without reactivation", async () => {
      const owner = await createActor("concurrent-owner");
      const member = await createActor("concurrent-member");
      const results = await Promise.all([
        admin.from("memberships").insert({
          user_id: member.id, restaurant_id: owner.restaurantId, role: "staff",
        }),
        admin.from("memberships").insert({
          user_id: member.id, restaurant_id: owner.restaurantId, role: "staff",
        }),
      ]);
      expect(results.filter(({ error }) => error === null)).toHaveLength(1);
      const [{ count: siteCount }, { count: workspaceCount }] = await Promise.all([
        admin.from("memberships").select("id", { count: "exact", head: true })
          .eq("user_id", member.id).eq("restaurant_id", owner.restaurantId),
        admin.from("workspace_memberships").select("id", { count: "exact", head: true })
          .eq("user_id", member.id).eq("workspace_id", owner.workspaceId),
      ]);
      expect({ siteCount, workspaceCount }).toEqual({ siteCount: 1, workspaceCount: 1 });
    });

    it.each(["restaurant", "workspace_member", "site_membership"] as const)(
      "serializes singleton cleanup against concurrent $child insertion",
      async (child) => {
        const owner = await createActor(`cleanup-race-${child}`);
        const childActor = await createActor(`cleanup-race-child-${child}`);
        const childSiteId = crypto.randomUUID();
        const deleteSql = `begin;
          set local statement_timeout = '10s';
          delete from public.restaurants where id = ${sqlLiteral(owner.restaurantId)}::uuid;
          select 'C04_LOCK_READY';
          select pg_sleep(2);
          commit;`;
        const childSql = child === "restaurant"
          ? `begin; set local statement_timeout = '10s';
             insert into public.restaurants (id, name, workspace_id)
             values (${sqlLiteral(childSiteId)}::uuid, 'Racing site',
               ${sqlLiteral(owner.workspaceId)}::uuid); commit;`
          : child === "workspace_member"
            ? `begin; set local statement_timeout = '10s';
               insert into public.workspace_memberships
                 (workspace_id, user_id, governance_role)
               values (${sqlLiteral(owner.workspaceId)}::uuid,
                 ${sqlLiteral(childActor.id)}::uuid, null); commit;`
            : `begin; set local statement_timeout = '10s';
               insert into public.memberships (restaurant_id, user_id, role)
               values (${sqlLiteral(owner.restaurantId)}::uuid,
                 ${sqlLiteral(childActor.id)}::uuid, 'staff'); commit;`;

        const outcomes = await runCleanupRace(deleteSql, childSql);
        expect(outcomes[0].status).toBe("fulfilled");
        expect(outcomes[1].status).toBe("rejected");
        if (outcomes[1].status === "rejected") {
          expect(String(outcomes[1].reason)).toMatch(
            /foreign key|violates|membership_workspace_link_mismatch/i,
          );
        }
        restaurantIds.delete(owner.restaurantId);
        workspaceIds.delete(owner.workspaceId);
      },
    );

    it("serializes a legacy membership insert before restaurant deletion", async () => {
      const owner = await createActor("insert-before-delete-owner");
      const member = await createActor("insert-before-delete-member");
      const insertSql = `begin;
        set local statement_timeout = '10s';
        insert into public.memberships (restaurant_id, user_id, role)
        values (${sqlLiteral(owner.restaurantId)}::uuid,
          ${sqlLiteral(member.id)}::uuid, 'staff');
        select 'C04_LOCK_READY';
        select pg_sleep(2);
        commit;`;
      const deleteSql = `begin;
        set local statement_timeout = '10s';
        delete from public.restaurants
         where id = ${sqlLiteral(owner.restaurantId)}::uuid;
        commit;`;

      const outcomes = await runCleanupRace(insertSql, deleteSql);
      expect(outcomes.every(({ status }) => status === "fulfilled")).toBe(true);
      restaurantIds.delete(owner.restaurantId);
      workspaceIds.delete(owner.workspaceId);
      const [{ count: restaurants }, { count: workspaces }, { count: siteMembers }] =
        await Promise.all([
          admin.from("restaurants").select("id", { count: "exact", head: true })
            .eq("id", owner.restaurantId),
          admin.from("workspaces").select("id", { count: "exact", head: true })
            .eq("id", owner.workspaceId),
          admin.from("memberships").select("id", { count: "exact", head: true })
            .eq("restaurant_id", owner.restaurantId),
        ]);
      expect({ restaurants, workspaces, siteMembers }).toEqual({
        restaurants: 0,
        workspaces: 0,
        siteMembers: 0,
      });
    });

    it.each(["auth_first", "restaurant_first"] as const)(
      "serializes auth-user and singleton restaurant deletion: $order",
      async (order) => {
        const actor = await createActor(`auth-restaurant-race-${order}`);
        const authDelete = `delete from auth.users where id = ${sqlLiteral(actor.id)}::uuid;`;
        const restaurantDelete = `delete from public.restaurants
          where id = ${sqlLiteral(actor.restaurantId)}::uuid;`;
        const firstDelete = order === "auth_first" ? authDelete : restaurantDelete;
        const secondDelete = order === "auth_first" ? restaurantDelete : authDelete;
        const firstSql = `begin;
          set local statement_timeout = '10s';
          ${firstDelete}
          select 'C04_LOCK_READY';
          select pg_sleep(2);
          commit;`;
        const secondSql = `begin;
          set local statement_timeout = '10s';
          ${secondDelete}
          commit;`;

        const outcomes = await runCleanupRace(firstSql, secondSql);
        expect(outcomes.every(({ status }) => status === "fulfilled")).toBe(true);
        actorIds.delete(actor.id);
        restaurantIds.delete(actor.restaurantId);
        workspaceIds.delete(actor.workspaceId);
        const [{ count: restaurants }, { count: workspaces }, { count: siteMembers },
          { count: workspaceMembers }] = await Promise.all([
          admin.from("restaurants").select("id", { count: "exact", head: true })
            .eq("id", actor.restaurantId),
          admin.from("workspaces").select("id", { count: "exact", head: true })
            .eq("id", actor.workspaceId),
          admin.from("memberships").select("id", { count: "exact", head: true })
            .eq("user_id", actor.id),
          admin.from("workspace_memberships").select("id", { count: "exact", head: true })
            .eq("user_id", actor.id),
        ]);
        expect({ restaurants, workspaces, siteMembers, workspaceMembers }).toEqual({
          restaurants: 0,
          workspaces: 0,
          siteMembers: 0,
          workspaceMembers: 0,
        });
      },
    );
  },
);
