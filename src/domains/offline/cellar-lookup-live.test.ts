import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { loadOfflineCellarRows } from "./cellar-lookup";
import { assertLiveDbTargetIsLocal } from "@/test/live-db-target";
import type { Database } from "@/types/database";

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
}));

const { resolveActiveMembership } = await import(
  "@/lib/api/resolve-active-membership"
);

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
  client: SupabaseClient<Database>;
  restaurantId: string;
  workspaceId: string;
};

const password = "C03-Lookup-Live-123!";
const fixture = {
  wineA: randomUUID(),
  wineB: randomUUID(),
  binA: randomUUID(),
  binB: randomUUID(),
  lotA1: randomUUID(),
  lotA2: randomUUID(),
  lotB: randomUUID(),
  bottleA: randomUUID(),
  bottleB: randomUUID(),
};

describe.skipIf(!hasLiveDb)(
  "offline cellar lookup tenant containment (MANDATORY live DB)",
  { timeout: 60_000 },
  () => {
    let admin: SupabaseClient<Database>;
    let actorA: Actor;
    let actorB: Actor;
    const actorIds = new Set<string>();
    const restaurantIds = new Set<string>();
    const workspaceIds = new Set<string>();

    async function createActor(label: string): Promise<Actor> {
      const run = `${Date.now()}-${randomUUID()}`;
      const email = `c03-lookup-${label}-${run}@terroir.test`;
      const { data: created, error: createError } = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { restaurant_name: `C03 Lookup ${label} ${run}` },
      });
      if (createError || !created.user) {
        throw createError ?? new Error("C03 lookup user create failed");
      }
      actorIds.add(created.user.id);

      const { data: membership, error: membershipError } = await admin
        .from("memberships")
        .select("restaurant_id")
        .eq("user_id", created.user.id)
        .eq("role", "owner")
        .single();
      if (membershipError || !membership) {
        throw membershipError ?? new Error("C03 lookup membership missing");
      }
      restaurantIds.add(membership.restaurant_id);

      const { data: restaurant, error: restaurantError } = await admin
        .from("restaurants")
        .select("workspace_id")
        .eq("id", membership.restaurant_id)
        .single();
      if (restaurantError || !restaurant) {
        throw restaurantError ?? new Error("C03 lookup workspace missing");
      }
      workspaceIds.add(restaurant.workspace_id);

      const signIn = createClient<Database>(supabaseUrl!, publishableKey!, {
        auth: { persistSession: false, storageKey: `c03-signin-${run}` },
      });
      const { data: session, error: signInError } = await signIn.auth
        .signInWithPassword({ email, password });
      if (signInError || !session.session) {
        throw signInError ?? new Error("C03 lookup sign-in failed");
      }
      const client = createClient<Database>(supabaseUrl!, publishableKey!, {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
          detectSessionInUrl: false,
          storageKey: `c03-session-${run}`,
        },
        global: {
          headers: { Authorization: `Bearer ${session.session.access_token}` },
        },
      });

      return {
        id: created.user.id,
        client,
        restaurantId: membership.restaurant_id,
        workspaceId: restaurant.workspace_id,
      };
    }

    beforeAll(async () => {
      admin = createClient<Database>(supabaseUrl!, serviceRoleKey!, {
        auth: { persistSession: false },
      });
      actorA = await createActor("a");
      actorB = await createActor("b");

      const { error: binError } = await admin.from("bins").insert([
        { id: fixture.binA, restaurant_id: actorA.restaurantId, code: "C03-A" },
        { id: fixture.binB, restaurant_id: actorB.restaurantId, code: "C03-B" },
      ] as never);
      if (binError) throw binError;

      const { error: wineError } = await admin.from("wines").insert([
        {
          id: fixture.wineA,
          restaurant_id: actorA.restaurantId,
          name: "C03 Tenant A Wine",
          producer: "C03 Estate A",
          vintage: 2021,
          size_ml: 750,
        },
        {
          id: fixture.wineB,
          restaurant_id: actorB.restaurantId,
          name: "C03 Tenant B Wine",
          producer: "C03 Estate B",
          vintage: 2020,
          size_ml: 750,
        },
      ] as never);
      if (wineError) throw wineError;

      const { error: inventoryError } = await admin.from("inventory_items").insert([
        {
          id: fixture.lotA1,
          restaurant_id: actorA.restaurantId,
          wine_id: fixture.wineA,
          bin_id: fixture.binA,
          quantity: 2,
          unit_cost: 999,
        },
        {
          id: fixture.lotA2,
          restaurant_id: actorA.restaurantId,
          wine_id: fixture.wineA,
          bin_id: fixture.binA,
          quantity: 3,
          unit_cost: 777,
        },
        {
          id: fixture.lotB,
          restaurant_id: actorB.restaurantId,
          wine_id: fixture.wineB,
          bin_id: fixture.binB,
          quantity: 8,
          unit_cost: 888,
        },
      ] as never);
      if (inventoryError) throw inventoryError;

      const { error: bottleError } = await admin.from("open_bottles").insert([
        {
          id: fixture.bottleA,
          restaurant_id: actorA.restaurantId,
          wine_id: fixture.wineA,
          source_inventory_item_id: fixture.lotA1,
          opened_by: actorA.id,
          remaining_ml: 450,
        },
        {
          id: fixture.bottleB,
          restaurant_id: actorB.restaurantId,
          wine_id: fixture.wineB,
          source_inventory_item_id: fixture.lotB,
          opened_by: actorB.id,
          remaining_ml: 300,
        },
      ] as never);
      if (bottleError) throw bottleError;
    });

    afterAll(async () => {
      if (!admin) return;
      if (restaurantIds.size > 0) {
        const { error } = await admin.from("restaurants").delete()
          .in("id", [...restaurantIds]);
        if (error) throw error;
      }
      for (const actorId of actorIds) {
        const { error } = await admin.auth.admin.deleteUser(actorId);
        if (error) throw error;
      }
      if (workspaceIds.size > 0) {
        await admin.from("workspace_memberships").delete()
          .in("workspace_id", [...workspaceIds]);
        const { error } = await admin.from("workspaces").delete()
          .in("id", [...workspaceIds]);
        if (error) throw error;
      }

      const checks = await Promise.all([
        admin.from("wines").select("id").in("id", [fixture.wineA, fixture.wineB]),
        admin.from("bins").select("id").in("id", [fixture.binA, fixture.binB]),
        admin.from("inventory_items").select("id").in(
          "id",
          [fixture.lotA1, fixture.lotA2, fixture.lotB],
        ),
        admin.from("open_bottles").select("id").in(
          "id",
          [fixture.bottleA, fixture.bottleB],
        ),
        admin.from("restaurants").select("id").in("id", [...restaurantIds]),
      ]);
      for (const check of checks) {
        expect(check.error).toBeNull();
        expect(check.data).toEqual([]);
      }
    });

    it("reads the authorized site's four relations without cost or actor fields", async () => {
      const membership = await resolveActiveMembership(actorA.client, actorA.id);
      expect(membership?.restaurantId).toBe(actorA.restaurantId);

      const rows = await loadOfflineCellarRows(actorA.client, actorA.restaurantId);

      expect(rows).toEqual([expect.objectContaining({
        wineId: fixture.wineA,
        displayName: "C03 Tenant A Wine",
        sealedQuantity: 5,
        placements: [{
          binId: fixture.binA,
          label: "C03-A",
          sealedQuantity: 5,
        }],
        activeOpenBottleId: fixture.bottleA,
        remainingMl: 450,
      })]);
      const keys = collectKeys(rows);
      expect([...keys].join(" ")).not.toMatch(
        /cost|price|margin|note|actor|opened_by|role|member|staff|setting/i,
      );
      expect(JSON.stringify(rows)).not.toContain(fixture.lotA1);
      expect(JSON.stringify(rows)).not.toContain(fixture.lotA2);
    });

    it("exposes no third-party or unauthenticated rows", async () => {
      await expect(loadOfflineCellarRows(actorA.client, actorB.restaurantId))
        .resolves.toEqual([]);

      const anonymous = createClient<Database>(supabaseUrl!, publishableKey!, {
        auth: { persistSession: false, storageKey: `c03-anon-${randomUUID()}` },
      });
      const { data: authData } = await anonymous.auth.getUser();
      expect(authData.user).toBeNull();
      await expect(loadOfflineCellarRows(anonymous, actorA.restaurantId))
        .rejects.toThrow("Offline cellar lookup read failed.");
    });

    it("loses both current membership resolution and lookup access after revocation", async () => {
      const { error } = await admin.from("memberships").delete()
        .eq("user_id", actorA.id)
        .eq("restaurant_id", actorA.restaurantId);
      expect(error).toBeNull();

      await expect(resolveActiveMembership(actorA.client, actorA.id))
        .resolves.toBeNull();
      await expect(loadOfflineCellarRows(actorA.client, actorA.restaurantId))
        .resolves.toEqual([]);
    });
  },
);

function collectKeys(value: unknown, keys = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) collectKeys(item, keys);
  } else if (value && typeof value === "object") {
    for (const [key, nested] of Object.entries(value)) {
      keys.add(key);
      collectKeys(nested, keys);
    }
  }
  return keys;
}
