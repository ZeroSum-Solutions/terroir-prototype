// Mixed-version lock compatibility for migration 0151.
//
// C02 serializes new commands on the wine row before locking the reusable
// bottle slot. Legacy RPCs remain callable during expand/contract and lock the
// slot before event foreign keys take KEY SHARE on the wine. These tests force
// that schedule around the real RPC bodies; FOR UPDATE on the C02 wine lock
// deadlocks, while FOR NO KEY UPDATE lets the legacy transaction complete.
import { spawn } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { assertLiveDbTargetIsLocal } from "@/test/live-db-target";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const hasLiveDb = Boolean(supabaseUrl && publishableKey && serviceRoleKey);

if (hasLiveDb) assertLiveDbTargetIsLocal(supabaseUrl!);
if (!hasLiveDb && process.env.CI) {
  throw new Error("MANDATORY live-DB suite: local Supabase credentials missing in CI");
}

type CommandArgs = Database["public"]["Functions"]["execute_inventory_command"]["Args"];
type CommandResult = {
  open_bottle: { id: string; opened_at: string; closed_at: string | null; remaining_ml: number };
};

function localPostgresUrl(apiUrl: string): string {
  const parsed = new URL(apiUrl);
  const apiPort = Number(parsed.port);
  if (!Number.isInteger(apiPort) || apiPort <= 0) {
    throw new Error(`cannot derive local Postgres port from ${apiUrl}`);
  }
  return `postgresql://postgres:postgres@${parsed.hostname}:${apiPort + 1}/postgres`;
}

function sqlLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

async function runPsql(sql: string): Promise<void> {
  const child = spawn(
    "psql",
    [localPostgresUrl(supabaseUrl!), "-X", "-v", "ON_ERROR_STOP=1", "-At"],
    { stdio: ["pipe", "pipe", "pipe"] },
  );
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => { stdout += chunk; });
  child.stderr.on("data", (chunk: string) => { stderr += chunk; });
  child.stdin.end(sql);

  await new Promise<void>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`psql exited ${code}: ${stderr || stdout}`));
    });
  });
}

async function runMixedLockSchedule(firstSql: string, secondSql: string): Promise<void> {
  const first = runPsql(firstSql);
  await new Promise((resolve) => setTimeout(resolve, 300));
  const outcomes = await Promise.allSettled([first, runPsql(secondSql)]);
  const failures = outcomes.filter((outcome): outcome is PromiseRejectedResult =>
    outcome.status === "rejected");
  if (failures.length > 0) {
    throw new Error(failures.map((failure) => String(failure.reason)).join("\n"));
  }
}

describe.skipIf(!hasLiveDb)(
  "inventory command legacy lock compatibility (MANDATORY live DB)",
  { timeout: 60_000 },
  () => {
    let admin: SupabaseClient<Database>;
    let actor: SupabaseClient<Database>;
    let actorId: string;
    let restaurantId: string;
    let signupRestaurantId: string;
    const password = "Inventory-Lock-Test-123!";

    async function createWine(quantity: number, label: string): Promise<string> {
      const { data: wine, error: wineError } = await admin.from("wines").insert({
        restaurant_id: restaurantId,
        name: label,
        producer: "Lock Test",
        size_ml: 750,
      }).select("id").single();
      if (wineError || !wine) throw wineError ?? new Error("failed to create wine");
      const { error: itemError } = await admin.from("inventory_items").insert({
        restaurant_id: restaurantId,
        wine_id: wine.id,
        quantity,
        unit_cost: 10,
        added_via: "manual",
      });
      if (itemError) throw itemError;
      return wine.id;
    }

    async function command(args: CommandArgs): Promise<CommandResult> {
      const { data, error } = await actor.rpc("execute_inventory_command", args);
      if (error) throw error;
      return data as unknown as CommandResult;
    }

    beforeAll(async () => {
      admin = createClient<Database>(supabaseUrl!, serviceRoleKey!, {
        auth: { persistSession: false },
      });
      const { data: restaurant, error: restaurantError } = await admin
        .from("restaurants")
        .insert({ name: "Inventory Lock Compatibility" })
        .select("id")
        .single();
      if (restaurantError || !restaurant) {
        throw restaurantError ?? new Error("failed to create restaurant");
      }
      restaurantId = restaurant.id;

      const run = `${Date.now()}-${crypto.randomUUID()}`;
      const { data: created, error: userError } = await admin.auth.admin.createUser({
        email: `inventory-lock-${run}@terroir.test`,
        password,
        email_confirm: true,
      });
      if (userError || !created.user) throw userError ?? new Error("failed to create actor");
      actorId = created.user.id;

      const { data: signupMembership, error: signupError } = await admin
        .from("memberships")
        .select("restaurant_id")
        .eq("user_id", actorId)
        .eq("role", "owner")
        .single();
      if (signupError || !signupMembership) {
        throw signupError ?? new Error("failed to find signup restaurant");
      }
      signupRestaurantId = signupMembership.restaurant_id;

      const { error: membershipError } = await admin.from("memberships").insert({
        user_id: actorId,
        restaurant_id: restaurantId,
        role: "manager",
      });
      if (membershipError) throw membershipError;

      const authClient = createClient<Database>(supabaseUrl!, publishableKey!, {
        auth: { persistSession: false },
      });
      const { data: session, error: signInError } = await authClient.auth.signInWithPassword({
        email: created.user.email!,
        password,
      });
      if (signInError || !session.session) {
        throw signInError ?? new Error("failed to sign in actor");
      }
      actor = createClient<Database>(supabaseUrl!, publishableKey!, {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
        global: { headers: { Authorization: `Bearer ${session.session.access_token}` } },
      });
    });

    afterAll(async () => {
      if (admin && restaurantId && signupRestaurantId) {
        await admin.from("restaurants").delete().in("id", [restaurantId, signupRestaurantId]);
      }
      if (admin && actorId) await admin.auth.admin.deleteUser(actorId);
    });

    it.each([
      { legacy: "record_pour", next: "pour", expectedRemaining: 726 },
      { legacy: "reconcile_open_bottle", next: "pour", expectedRemaining: 687 },
      { legacy: "close_open_bottle", next: "open", expectedRemaining: 750 },
    ] as const)(
      "does not deadlock execute_inventory_command with $legacy",
      async ({ legacy, next, expectedRemaining }) => {
        const wineId = await createWine(2, `Mixed lock ${legacy}`);
        const opened = await command({
          p_operation_id: crypto.randomUUID(),
          p_restaurant_id: restaurantId,
          p_command: "open",
          p_wine_id: wineId,
        });
        const operationId = crypto.randomUUID();
        const claims = JSON.stringify({ sub: actorId, role: "authenticated" });
        const commandCall = next === "open"
          ? `select public.execute_inventory_command(
               p_operation_id => ${sqlLiteral(operationId)}::uuid,
               p_restaurant_id => ${sqlLiteral(restaurantId)}::uuid,
               p_command => 'open', p_wine_id => ${sqlLiteral(wineId)}::uuid);`
          : `select public.execute_inventory_command(
               p_operation_id => ${sqlLiteral(operationId)}::uuid,
               p_restaurant_id => ${sqlLiteral(restaurantId)}::uuid,
               p_command => 'pour', p_wine_id => ${sqlLiteral(wineId)}::uuid,
               p_ml => 13,
               p_expected_open_bottle_id => ${sqlLiteral(opened.open_bottle.id)}::uuid,
               p_expected_opened_at =>
                 ${sqlLiteral(opened.open_bottle.opened_at)}::timestamptz);`;
        const legacyCall = legacy === "record_pour"
          ? `select public.record_pour(${sqlLiteral(wineId)}::uuid, 11, 'pour', 'lock probe');`
          : legacy === "reconcile_open_bottle"
            ? `select public.reconcile_open_bottle(
                 ${sqlLiteral(wineId)}::uuid, 700, 'lock probe');`
            : `select public.close_open_bottle(
                 ${sqlLiteral(wineId)}::uuid, 750, 0, null);`;

        await runMixedLockSchedule(
          `begin;
           set local deadlock_timeout = '200ms';
           set local statement_timeout = '10s';
           select set_config('request.jwt.claims', ${sqlLiteral(claims)}, true);
           select id from public.wines where id = ${sqlLiteral(wineId)}::uuid
            for no key update;
           select pg_sleep(2);
           ${commandCall}
           commit;`,
          `begin;
           set local deadlock_timeout = '200ms';
           set local statement_timeout = '10s';
           select set_config('request.jwt.claims', ${sqlLiteral(claims)}, true);
           select id from public.open_bottles
            where id = ${sqlLiteral(opened.open_bottle.id)}::uuid for update;
           select pg_sleep(2);
           ${legacyCall}
           commit;`,
        );

        const [{ data: bottle }, { count: receiptCount }] = await Promise.all([
          admin.from("open_bottles")
            .select("remaining_ml, closed_at")
            .eq("wine_id", wineId)
            .single(),
          admin.from("inventory_command_receipts")
            .select("operation_id", { count: "exact", head: true })
            .eq("operation_id", operationId),
        ]);
        expect(bottle).toMatchObject({ remaining_ml: expectedRemaining, closed_at: null });
        expect(receiptCount).toBe(1);

        if (legacy === "reconcile_open_bottle") {
          const { count } = await admin.from("availability_events")
            .select("id", { count: "exact", head: true })
            .eq("wine_id", wineId)
            .eq("direction", "reconcile");
          expect(count).toBe(1);
        }
        if (legacy === "close_open_bottle") {
          const [{ count }, { data: item }] = await Promise.all([
            admin.from("bottle_closeouts")
              .select("id", { count: "exact", head: true })
              .eq("wine_id", wineId),
            admin.from("inventory_items").select("quantity").eq("wine_id", wineId).single(),
          ]);
          expect(count).toBe(1);
          expect(item?.quantity).toBe(0);
        }
      },
    );

    it("does not deadlock C02 undo with legacy record_pour", async () => {
      const wineId = await createWine(1, "Mixed lock undo");
      const opened = await command({
        p_operation_id: crypto.randomUUID(),
        p_restaurant_id: restaurantId,
        p_command: "open",
        p_wine_id: wineId,
      });
      await command({
        p_operation_id: crypto.randomUUID(),
        p_restaurant_id: restaurantId,
        p_command: "pour",
        p_wine_id: wineId,
        p_ml: 100,
        p_expected_open_bottle_id: opened.open_bottle.id,
        p_expected_opened_at: opened.open_bottle.opened_at,
      });
      const claims = JSON.stringify({ sub: actorId, role: "authenticated" });

      await runMixedLockSchedule(
        `begin;
         set local deadlock_timeout = '200ms';
         set local statement_timeout = '10s';
         select set_config('request.jwt.claims', ${sqlLiteral(claims)}, true);
         select id from public.wines where id = ${sqlLiteral(wineId)}::uuid
          for no key update;
         select pg_sleep(2);
         select public.undo_last_pour(${sqlLiteral(wineId)}::uuid);
         commit;`,
        `begin;
         set local deadlock_timeout = '200ms';
         set local statement_timeout = '10s';
         select set_config('request.jwt.claims', ${sqlLiteral(claims)}, true);
         select id from public.open_bottles
          where id = ${sqlLiteral(opened.open_bottle.id)}::uuid for update;
         select pg_sleep(2);
         select public.record_pour(
           ${sqlLiteral(wineId)}::uuid, 25, 'pour', 'undo lock probe');
         commit;`,
      );

      const [{ data: bottle }, { data: events }, { count: restoredCount }] = await Promise.all([
        admin.from("open_bottles").select("remaining_ml").eq("wine_id", wineId).single(),
        admin.from("pour_events").select("kind, ml_delta").eq("wine_id", wineId),
        admin.from("availability_events")
          .select("id", { count: "exact", head: true })
          .eq("wine_id", wineId)
          .eq("direction", "restored"),
      ]);
      const consumed = (events ?? [])
        .filter((event) => event.kind === "pour" || event.kind === "spill")
        .reduce((sum, event) => sum + event.ml_delta, 0);
      expect(bottle?.remaining_ml).toBe(650);
      expect(consumed).toBe(100);
      expect(restoredCount).toBe(1);
    });
  },
);
