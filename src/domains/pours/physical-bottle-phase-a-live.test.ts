// Phase A physical-bottle boundary -- migration 0153.
//
// This suite is live-DB-only because function ACLs, invoker RLS, and the
// contract-version guard cannot be established by mocks. Phase A deliberately
// exposes readers while both physical writer RPCs remain dormant.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/types/database";
import { assertLiveDbTargetIsLocal } from "@/test/live-db-target";
import { LiveDbFixtureIdentityTracker } from "@/test/live-db-fixture-identities";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const hasLiveDb = Boolean(supabaseUrl && publishableKey && serviceRoleKey);

if (hasLiveDb) assertLiveDbTargetIsLocal(supabaseUrl!);
if (!hasLiveDb && process.env.CI) {
  throw new Error("MANDATORY live-DB suite: local Supabase credentials missing in CI");
}

type PhysicalBottleRow = {
  id: string;
  restaurant_id: string;
  wine_id: string;
  remaining_ml: number;
  nominal_capacity_ml: number | null;
  opened_at: string;
  preservation_method: string;
  source_inventory_item_id: string | null;
  source_provenance: string;
  source_bin_location: string | null;
  identity_contract: number;
  identity_origin: string;
  state_version: number;
};

type EffectivePourEventRow = {
  id: string;
  wine_id: string;
  restaurant_id: string;
  open_bottle_id: string | null;
  ml_delta: number;
  kind: string;
  actor_user_id: string | null;
  occurred_at: string;
  note: string | null;
  event_contract: number;
  operation_id: string | null;
  operation_entry_ordinal: number | null;
};

type PhaseADatabase = {
  public: {
    Views: Database["public"]["Views"] & {
      effective_service_pour_events: {
        Row: EffectivePourEventRow;
        Relationships: [];
      };
    };
    Tables: Database["public"]["Tables"];
    Functions: Database["public"]["Functions"] & {
      current_inventory_contract_version: { Args: Record<string, never>; Returns: number };
      list_active_physical_bottles: {
        Args: { p_restaurant_id: string };
        Returns: PhysicalBottleRow[];
      };
      list_open_bottle_aggregates: {
        Args: { p_restaurant_id: string };
        Returns: Array<{
          wine_id: string;
          active_bottle_count: number;
          open_remaining_ml: number;
        }>;
      };
      execute_physical_bottle_command: {
        Args: {
          p_operation_id: string;
          p_restaurant_id: string;
          p_command: string;
          p_wine_id: string;
        };
        Returns: unknown;
      };
      execute_physical_reconciliation_batch: {
        Args: {
          p_operation_id: string;
          p_restaurant_id: string;
          p_entries: Json;
        };
        Returns: unknown;
      };
    };
    Enums: Database["public"]["Enums"];
    CompositeTypes: Database["public"]["CompositeTypes"];
  };
};

async function signedInClient(email: string, password: string): Promise<SupabaseClient<PhaseADatabase>> {
  const authClient = createClient<PhaseADatabase>(supabaseUrl!, publishableKey!, {
    auth: { persistSession: false },
  });
  const { data, error } = await authClient.auth.signInWithPassword({ email, password });
  if (error || !data.session) throw error ?? new Error(`sign-in failed for ${email}`);
  return createClient<PhaseADatabase>(supabaseUrl!, publishableKey!, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { Authorization: `Bearer ${data.session.access_token}` } },
  });
}

function expectWriterNotExposed(
  data: unknown,
  error: { code?: string; message: string } | null,
): void {
  expect(data).toBeNull();
  expect(error).not.toBeNull();
  expect(error?.code).toBe("42501");
  expect(error?.message).not.toContain("physical_inventory_contract_inactive");
  expect(error?.message).toMatch(/permission denied/i);
}

describe.skipIf(!hasLiveDb)(
  "physical bottle Phase A (MANDATORY live DB)",
  { timeout: 60_000 },
  () => {
    const password = "Physical-Bottle-Phase-A-123!";
    const identities = new LiveDbFixtureIdentityTracker();
    let admin: SupabaseClient<PhaseADatabase>;
    let ownClient: SupabaseClient<PhaseADatabase>;
    let foreignClient: SupabaseClient<PhaseADatabase>;
    let nonmemberClient: SupabaseClient<PhaseADatabase>;
    let ownUserId: string;
    let foreignUserId: string;
    let ownRestaurantId: string;
    let foreignRestaurantId: string;
    let wineId: string;
    let bottleId: string;
    let inventoryItemId: string;
    let ownEventId: string;
    let foreignEventId: string;

    beforeAll(async () => {
      admin = createClient<PhaseADatabase>(supabaseUrl!, serviceRoleKey!, {
        auth: { persistSession: false },
      });
      const run = `${Date.now()}-${crypto.randomUUID()}`;
      const own = await identities.createUser(admin, {
        email: `physical-a-own-${run}@terroir.test`,
        password,
        email_confirm: true,
        user_metadata: { restaurant_name: `Physical A Own ${run}` },
      });
      const foreign = await identities.createUser(admin, {
        email: `physical-a-foreign-${run}@terroir.test`,
        password,
        email_confirm: true,
        user_metadata: { restaurant_name: `Physical A Foreign ${run}` },
      });
      const nonmember = await identities.createUser(admin, {
        email: `physical-a-nonmember-${run}@terroir.test`,
        password,
        email_confirm: true,
        user_metadata: { restaurant_name: `Physical A Nonmember ${run}` },
      });
      ownUserId = own.user.id;
      foreignUserId = foreign.user.id;

      const [{ data: ownMembership }, { data: foreignMembership }] = await Promise.all([
        admin.from("memberships").select("restaurant_id").eq("user_id", ownUserId).eq("role", "owner").single(),
        admin.from("memberships").select("restaurant_id").eq("user_id", foreignUserId).eq("role", "owner").single(),
      ]);
      if (!ownMembership || !foreignMembership) throw new Error("signup membership missing");
      ownRestaurantId = ownMembership.restaurant_id;
      foreignRestaurantId = foreignMembership.restaurant_id;

      ownClient = await signedInClient(own.user.email!, password);
      foreignClient = await signedInClient(foreign.user.email!, password);
      nonmemberClient = await signedInClient(nonmember.user.email!, password);

      const { data: wine, error: wineError } = await admin.from("wines").insert({
        restaurant_id: ownRestaurantId,
        name: "Phase A reader fixture",
        producer: "C06",
        size_ml: 750,
      }).select("id").single();
      if (wineError || !wine) throw wineError ?? new Error("wine fixture failed");
      wineId = wine.id;
      const { data: item, error: itemError } = await admin.from("inventory_items").insert({
        restaurant_id: ownRestaurantId,
        wine_id: wineId,
        quantity: 1,
        unit_cost: 99,
        bin_location: "C06-A1",
        added_via: "manual",
      }).select("id").single();
      if (itemError || !item) throw itemError ?? new Error("inventory fixture failed");
      inventoryItemId = item.id;
      const { data: bottle, error: bottleError } = await admin.from("open_bottles").insert({
        restaurant_id: ownRestaurantId,
        wine_id: wineId,
        remaining_ml: 600,
        opened_by: ownUserId,
        source_inventory_item_id: item.id,
      }).select("id").single();
      if (bottleError || !bottle) throw bottleError ?? new Error("bottle fixture failed");
      bottleId = bottle.id;

      const { data: foreignWine, error: foreignWineError } = await admin.from("wines").insert({
        restaurant_id: foreignRestaurantId,
        name: "Phase A foreign view fixture",
        producer: "C06",
        size_ml: 750,
      }).select("id").single();
      if (foreignWineError || !foreignWine) {
        throw foreignWineError ?? new Error("foreign wine fixture failed");
      }
      const { data: events, error: eventsError } = await admin.from("pour_events").insert([
        {
          restaurant_id: ownRestaurantId,
          wine_id: wineId,
          ml_delta: 0,
          kind: "reconcile",
          actor_user_id: ownUserId,
          note: "C06 own RLS fixture",
        },
        {
          restaurant_id: foreignRestaurantId,
          wine_id: foreignWine.id,
          ml_delta: 0,
          kind: "reconcile",
          actor_user_id: foreignUserId,
          note: "C06 foreign RLS fixture",
        },
      ]).select("id,restaurant_id");
      if (eventsError || !events || events.length !== 2) {
        throw eventsError ?? new Error("effective-event fixtures failed");
      }
      ownEventId = events.find((event) => event.restaurant_id === ownRestaurantId)?.id ?? "";
      foreignEventId = events.find((event) => event.restaurant_id === foreignRestaurantId)?.id ?? "";
      if (!ownEventId || !foreignEventId) throw new Error("effective-event fixture IDs missing");
    });

    afterAll(async () => {
      if (!admin) return;
      await identities.cleanup(admin, {
        restaurantIds: [ownRestaurantId, foreignRestaurantId].filter(Boolean),
      });
    });

    it("keeps the normative database contract at version 1", async () => {
      const { data, error } = await ownClient.rpc("current_inventory_contract_version");
      expect(error).toBeNull();
      expect(data).toBe(1);
    });

    it("returns only own active exact rows with the approved privacy projection", async () => {
      const { data, error } = await ownClient.rpc("list_active_physical_bottles", {
        p_restaurant_id: ownRestaurantId,
      });
      expect(error).toBeNull();
      expect(data).toHaveLength(1);
      const row = data?.[0];
      expect(row).toBeDefined();
      expect(row).toEqual({
        id: bottleId,
        restaurant_id: ownRestaurantId,
        wine_id: wineId,
        remaining_ml: 600,
        nominal_capacity_ml: null,
        opened_at: expect.any(String),
        preservation_method: "none",
        source_inventory_item_id: inventoryItemId,
        source_provenance: "legacy_unknown",
        source_bin_location: "C06-A1",
        identity_contract: 1,
        identity_origin: "legacy_slot",
        state_version: 0,
      });
      expect(Object.keys(row ?? {}).sort()).toEqual([
        "id", "identity_contract", "identity_origin", "nominal_capacity_ml",
        "opened_at", "preservation_method", "remaining_ml", "restaurant_id",
        "source_bin_location", "source_inventory_item_id", "source_provenance",
        "state_version", "wine_id",
      ]);
    });

    it("returns one aggregate row per wine and never exposes a foreign site", async () => {
      const [{ data: aggregate, error: aggregateError }, { data: foreign, error: foreignError }] = await Promise.all([
        ownClient.rpc("list_open_bottle_aggregates", { p_restaurant_id: ownRestaurantId }),
        foreignClient.rpc("list_active_physical_bottles", { p_restaurant_id: ownRestaurantId }),
      ]);
      expect(aggregateError).toBeNull();
      expect(aggregate).toEqual([{ wine_id: wineId, active_bottle_count: 1, open_remaining_ml: 600 }]);
      expect(foreignError).toBeNull();
      expect(foreign).toEqual([]);
    });

    it("applies invoker RLS to effective events without a client tenant filter", async () => {
      const ids = [ownEventId, foreignEventId];
      const [
        { data: ownRows, error: ownError },
        { data: foreignRows, error: foreignError },
        { data: nonmemberRows, error: nonmemberError },
      ] =
        await Promise.all([
          ownClient.from("effective_service_pour_events")
            .select("id,restaurant_id")
            .in("id", ids),
          foreignClient.from("effective_service_pour_events")
            .select("id,restaurant_id")
            .in("id", ids),
          nonmemberClient.from("effective_service_pour_events")
            .select("id,restaurant_id")
            .in("id", ids),
        ]);
      expect(ownError).toBeNull();
      expect(foreignError).toBeNull();
      expect(nonmemberError).toBeNull();
      expect(ownRows).toEqual([{ id: ownEventId, restaurant_id: ownRestaurantId }]);
      expect(foreignRows).toEqual([{ id: foreignEventId, restaurant_id: foreignRestaurantId }]);
      expect(nonmemberRows).toEqual([]);
    });

    it("denies both physical writer RPCs to authenticated and service roles", async () => {
      const scalarArgs = {
        p_operation_id: crypto.randomUUID(),
        p_restaurant_id: ownRestaurantId,
        p_command: "pour",
        p_wine_id: wineId,
      };
      const batchArgs = {
        p_operation_id: crypto.randomUUID(),
        p_restaurant_id: ownRestaurantId,
        p_entries: [],
      };
      const snapshot = async () => Promise.all([
        admin.from("inventory_items").select("*").eq("restaurant_id", ownRestaurantId).order("id"),
        admin.from("open_bottles").select("*").eq("restaurant_id", ownRestaurantId).order("id"),
        admin.from("pour_events").select("*").eq("restaurant_id", ownRestaurantId).order("id"),
        admin.from("bottle_closeouts").select("*").eq("restaurant_id", ownRestaurantId).order("id"),
        admin.from("inventory_command_receipts").select("*").eq("restaurant_id", ownRestaurantId)
          .order("operation_id"),
      ]);
      const before = await snapshot();
      expect(before.every(({ error }) => error === null)).toBe(true);
      const effectAclClient = createClient(supabaseUrl!, serviceRoleKey!, {
        auth: { persistSession: false },
      });
      const { data: effectRows, error: effectError } = await effectAclClient
        .from("inventory_command_bottle_effects")
        .select("restaurant_id")
        .limit(1);
      expect(effectRows).toBeNull();
      expect(effectError?.code).toBe("42501");
      expect(effectError?.message).toMatch(/permission denied/i);
      for (const client of [ownClient, admin]) {
        const [scalar, batch] = await Promise.all([
          client.rpc("execute_physical_bottle_command", scalarArgs),
          client.rpc("execute_physical_reconciliation_batch", batchArgs),
        ]);
        expectWriterNotExposed(scalar.data, scalar.error);
        expectWriterNotExposed(batch.data, batch.error);
      }
      expect(await snapshot()).toEqual(before);
    });
  },
);
