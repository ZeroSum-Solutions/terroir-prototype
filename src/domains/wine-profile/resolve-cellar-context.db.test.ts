// What the cellar resolver's QUERIES return against a real database.
//
// The derivations are tested purely in resolve-cellar-context.test.ts. This
// suite covers what a mock cannot: that the list read's embedded join
// (wine_list_items → wine_list_sections → wine_lists) actually resolves in
// PostgREST, that the pour read's kind filter is applied in SQL, and that the
// dead-stock threshold comes from this restaurant's config.
//
// MANDATORY live-DB suite: a mocked PostgREST would assert my own select
// string back at me, and a wrong embed path returns null silently — which
// derives to "not listed" and raises Off list on every wine on the menu.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { assertLiveDbTargetIsLocal } from "@/test/live-db-target";
import { resolveCellarContext } from "./resolve-cellar-context";
import { executePhysicalBottleCommand } from "@/domains/pours/physical-bottle-command";
import { cleanupLocalSealedFixtures } from "@/test/local-sealed-fixtures";
import { LiveDbFixtureIdentityTracker } from "@/test/live-db-fixture-identities";

const COST_AND_MARGIN_READ = { canReadCost: true, canReadMargin: true } as const;

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const hasLiveDb = Boolean(supabaseUrl && publishableKey && serviceRoleKey);

if (hasLiveDb) assertLiveDbTargetIsLocal(supabaseUrl!);
if (!hasLiveDb && process.env.CI) {
  throw new Error(
    "MANDATORY live-DB suite: NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY / SUPABASE_SERVICE_ROLE_KEY missing in CI - refusing to skip silently.",
  );
}

describe.skipIf(!hasLiveDb)("resolveCellarContext against a real database", { timeout: 60_000 }, () => {
  let admin: SupabaseClient<Database>;
  let owner: SupabaseClient<Database>;
  let restaurantId: string;
  let ownerMembershipId: string;
  let wineId: string;
  let bareWineId: string;
  let lastPourDate: string;
  const identities = new LiveDbFixtureIdentityTracker();

  beforeAll(async () => {
    admin = createClient<Database>(supabaseUrl!, serviceRoleKey!, {
      auth: { persistSession: false },
    });

    const run = `${Date.now()}-${randomUUID()}`;
    const email = `cellar-context-${run}@terroir.test`;
    const password = "Cellar-Context-Live-123!";
    const created = await identities.createUser(admin, {
      email,
      password,
      email_confirm: true,
      user_metadata: { restaurant_name: `Cellar Context Home ${run}` },
    });
    restaurantId = created.signupRestaurantId;

    const signIn = createClient<Database>(supabaseUrl!, publishableKey!, {
      auth: { persistSession: false, storageKey: `cellar-context-signin-${run}` },
    });
    const { data: session, error: signInError } = await signIn.auth.signInWithPassword({
      email,
      password,
    });
    if (signInError || !session.session) {
      throw signInError ?? new Error("failed to sign in cellar context owner");
    }
    owner = createClient<Database>(supabaseUrl!, publishableKey!, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
        storageKey: `cellar-context-owner-${run}`,
      },
      global: { headers: { Authorization: `Bearer ${session.session.access_token}` } },
    });
    const { data: ownerMembership, error: ownerMembershipError } = await admin
      .from("memberships")
      .select("id")
      .eq("restaurant_id", restaurantId)
      .eq("user_id", created.user.id)
      .single();
    if (ownerMembershipError || !ownerMembership) {
      throw ownerMembershipError ?? new Error("failed to resolve owner membership");
    }
    ownerMembershipId = ownerMembership.id;
    const { error: capabilityError } = await owner.rpc(
      "replace_member_site_capabilities",
      {
        p_membership_id: ownerMembership.id,
        p_capability_keys: ["cost.read", "margin.read", "pricing.manage"],
        p_expires_at: null as never,
        p_grant_reason: "Live cellar resolver fixture",
      },
    );
    if (capabilityError) throw capabilityError;

    const { error: cErr } = await admin
      .from("cellar_config")
      .insert({ restaurant_id: restaurantId, health_dead_stock_days: 45 } as never);
    if (cErr) throw cErr;

    const { data: wines, error: wErr } = await admin
      .from("wines")
      .insert([
        { restaurant_id: restaurantId, producer: "Context Estate", name: "Listed Cuvee", size_ml: 750 },
        { restaurant_id: restaurantId, producer: "Context Estate", name: "Bare Cuvee", size_ml: 750 },
      ] as never)
      .select("id, name");
    if (wErr || !wines) throw wErr ?? new Error("failed to insert wines");
    const wRows = wines as { id: string; name: string }[];
    wineId = wRows.find((w) => w.name === "Listed Cuvee")!.id;
    bareWineId = wRows.find((w) => w.name === "Bare Cuvee")!.id;

    const { error: iErr } = await admin.from("inventory_items").insert([
      // Opening a physical bottle consumes one sealed unit from this lot.
      { restaurant_id: restaurantId, wine_id: wineId, quantity: 2, unit_cost: 40, format: null, added_at: "2026-03-01T10:00:00.000Z" },
      { restaurant_id: restaurantId, wine_id: wineId, quantity: 4, unit_cost: 80, format: "magnum", added_at: "2026-06-01T10:00:00.000Z" },
      // This unit is opened and spilled only. It leaves zero sealed stock
      // while proving a spill does not become a sale/depletion signal.
      { restaurant_id: restaurantId, wine_id: bareWineId, quantity: 1, unit_cost: 20, format: null, added_at: "2026-06-15T10:00:00.000Z" },
    ] as never);
    if (iErr) throw iErr;

    const opened = await executePhysicalBottleCommand({
      supabase: owner,
      operationId: randomUUID(),
      restaurantId,
      command: "open",
      wineId,
      preservationMethod: "none",
    });
    const poured = await executePhysicalBottleCommand({
      supabase: owner,
      operationId: randomUUID(),
      restaurantId,
      command: "pour",
      wineId,
      openBottleId: opened.openBottle.id,
      ml: 150,
    });
    await executePhysicalBottleCommand({
      supabase: owner,
      operationId: randomUUID(),
      restaurantId,
      command: "spill",
      wineId,
      openBottleId: opened.openBottle.id,
      ml: 50,
    });
    const { data: pourEvent, error: pourEventError } = await owner
      .from("effective_service_pour_events")
      .select("occurred_at")
      .eq("id", poured.pourEventIds[0])
      .single();
    if (pourEventError || !pourEvent?.occurred_at) {
      throw pourEventError ?? new Error("failed to read canonical pour event");
    }
    lastPourDate = pourEvent.occurred_at.slice(0, 10);

    const bareOpened = await executePhysicalBottleCommand({
      supabase: owner,
      operationId: randomUUID(),
      restaurantId,
      command: "open",
      wineId: bareWineId,
      preservationMethod: "none",
    });
    await executePhysicalBottleCommand({
      supabase: owner,
      operationId: randomUUID(),
      restaurantId,
      command: "spill",
      wineId: bareWineId,
      openBottleId: bareOpened.openBottle.id,
      ml: 50,
    });

    const { data: lists, error: lErr } = await admin
      .from("wine_lists")
      .insert([
        { restaurant_id: restaurantId, name: "Published", is_published: true },
        { restaurant_id: restaurantId, name: "Draft", is_published: false },
      ] as never)
      .select("id, name");
    if (lErr || !lists) throw lErr ?? new Error("failed to insert lists");
    const lRows = lists as { id: string; name: string }[];

    const { data: sections, error: sErr } = await admin
      .from("wine_list_sections")
      .insert(lRows.map((l) => ({ wine_list_id: l.id, name: `${l.name} reds` })) as never)
      .select("id, wine_list_id");
    if (sErr || !sections) throw sErr ?? new Error("failed to insert sections");
    const sRows = sections as { id: string; wine_list_id: string }[];
    const sectionOf = (name: string) =>
      sRows.find((s) => s.wine_list_id === lRows.find((l) => l.name === name)!.id)!.id;

    const { error: liErr } = await admin.from("wine_list_items").insert([
      { restaurant_id: restaurantId, wine_id: wineId, section_id: sectionOf("Published"), bottle_price: 35, hidden: false, is_available: true },
      // Cheaper, but on a list nobody can see. Must not become the price.
      { restaurant_id: restaurantId, wine_id: wineId, section_id: sectionOf("Draft"), bottle_price: 20, hidden: false, is_available: true },
    ] as never);
    if (liErr) throw liErr;
  });

  afterAll(async () => {
    const failures: string[] = [];
    try {
      await cleanupLocalSealedFixtures({
        apiUrl: supabaseUrl!,
        restaurantIds: [restaurantId],
        membershipIds: [ownerMembershipId],
      });
    } catch (error) {
      failures.push(error instanceof Error ? error.message : String(error));
    }
    try {
      await identities.cleanup(admin, { restaurantIds: [restaurantId] });
    } catch (error) {
      failures.push(error instanceof Error ? error.message : String(error));
    }
    if (failures.length > 0) {
      throw new Error(`cellar context fixture cleanup failed:\n- ${failures.join("\n- ")}`);
    }
  });

  it("counts the selling format apart from magnums and weights cost across lots", async () => {
    const facts = await resolveCellarContext(
      owner,
      restaurantId,
      wineId,
      750,
      COST_AND_MARGIN_READ,
    );
    expect(facts.sellingFormatUnits).toBe(1);
    expect(facts.otherFormatUnits).toBe(4);
    expect(facts.weightedUnitCost).toBe(72);
    expect(facts.lastPutAwayAt).toBe("2026-06-01");
  });

  it("retains stock, locations, and menu price without selecting cost", async () => {
    const facts = await resolveCellarContext(owner, restaurantId, wineId, 750);
    expect(facts.bottleCount).toBe(5);
    expect(facts.publishedBottlePrice).toBe(35);
    expect(facts.listedAndOrderable).toBe(true);
    expect(facts.weightedUnitCost).toBeNull();
  });

  it("reads the published price through the section and list join, ignoring the draft list", async () => {
    const facts = await resolveCellarContext(owner, restaurantId, wineId, 750);
    expect(facts.publishedBottlePrice).toBe(35);
    expect(facts.listedAndOrderable).toBe(true);
  });

  it("takes the last real pour as the depletion, not the later spill", async () => {
    const facts = await resolveCellarContext(owner, restaurantId, wineId, 750);
    expect(facts.lastDepletionAt).toBe(lastPourDate);
  });

  it("reads the dead-stock threshold from this restaurant's config", async () => {
    const facts = await resolveCellarContext(owner, restaurantId, wineId, 750);
    expect(facts.deadStockDays).toBe(45);
  });

  it("reports an unstocked, unlisted wine as exactly that", async () => {
    const facts = await resolveCellarContext(owner, restaurantId, bareWineId, 750);
    expect(facts.bottleCount).toBe(0);
    expect(facts.listedAndOrderable).toBe(false);
    expect(facts.publishedBottlePrice).toBeNull();
    expect(facts.lastDepletionAt).toBeNull();
  });
});
