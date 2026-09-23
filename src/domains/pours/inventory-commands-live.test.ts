// Atomic inventory command boundary -- migration 0151.
//
// This suite is intentionally live-DB-only. Transaction rollback, row locks,
// RLS/grants, trigger-maintained bottle state, and JWT identity are the
// behavior under test; mocks cannot establish any of them.
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
  throw new Error(
    "MANDATORY live-DB suite: local Supabase credentials missing in CI - refusing to skip silently.",
  );
}

type CommandArgs = Database["public"]["Functions"]["execute_inventory_command"]["Args"];
type CommandResult = {
  operation_id: string;
  command: string;
  replayed: boolean;
  pour_event_ids: string[];
  open_bottle: {
    id: string;
    opened_at: string;
    closed_at: string | null;
    remaining_ml: number;
    preservation_method: string;
  };
  closeout?: { id: string; preservation_method: string; closed_at: string };
};

async function signedInClient(
  email: string,
  password: string,
  prefer?: string,
): Promise<SupabaseClient<Database>> {
  const authClient = createClient<Database>(supabaseUrl!, publishableKey!, {
    auth: { persistSession: false },
  });
  const { data, error } = await authClient.auth.signInWithPassword({ email, password });
  if (error || !data.session) throw error ?? new Error(`sign-in failed for ${email}`);
  return createClient<Database>(supabaseUrl!, publishableKey!, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: {
      headers: {
        Authorization: `Bearer ${data.session.access_token}`,
        ...(prefer ? { Prefer: prefer } : {}),
      },
    },
  });
}

async function runCommand(client: SupabaseClient<Database>, args: CommandArgs): Promise<CommandResult> {
  const { data, error } = await client.rpc("execute_inventory_command", args);
  if (error) throw error;
  return data as unknown as CommandResult;
}

async function expectCommandError(
  client: SupabaseClient<Database>,
  args: CommandArgs,
  expected: RegExp,
): Promise<void> {
  const { error } = await client.rpc("execute_inventory_command", args);
  expect(error).not.toBeNull();
  expect(error!.message).toMatch(expected);
}

function oneMicrosecondAfter(value: string): string {
  const match = value.match(/^(.*T\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?(Z|[+-]\d{2}:\d{2})$/);
  if (!match) throw new Error(`unexpected timestamptz representation: ${value}`);
  const micros = Number((match[2] ?? "").padEnd(6, "0"));
  if (micros < 999_999) {
    return `${match[1]}.${String(micros + 1).padStart(6, "0")}${match[3]}`;
  }
  const nextSecond = new Date(`${match[1]}${match[3]}`).getTime() + 1_000;
  return `${new Date(nextSecond).toISOString().slice(0, 19)}.000000Z`;
}

describe.skipIf(!hasLiveDb)("execute_inventory_command (MANDATORY live DB)", { timeout: 60_000 }, () => {
  let admin: SupabaseClient<Database>;
  let restaurantA: string;
  let restaurantB: string;
  let userAId: string;
  let userBId: string;
  let userA: SupabaseClient<Database>;
  let userANewYork: SupabaseClient<Database>;
  let userB: SupabaseClient<Database>;

  const password = "Inventory-Command-Test-123!";

  async function createWine(quantity: number, label: string): Promise<string> {
    const { data: wine, error: wineError } = await admin
      .from("wines")
      .insert({ restaurant_id: restaurantA, name: label, producer: "Command Test", size_ml: 750 })
      .select("id")
      .single();
    if (wineError || !wine) throw wineError ?? new Error("failed to create wine");
    if (quantity > 0) {
      const { error: itemError } = await admin.from("inventory_items").insert({
        restaurant_id: restaurantA,
        wine_id: wine.id,
        quantity,
        unit_cost: 10,
        added_via: "manual",
      });
      if (itemError) throw itemError;
    }
    return wine.id;
  }

  function baseArgs(wineId: string, command: string): CommandArgs {
    return {
      p_operation_id: crypto.randomUUID(),
      p_restaurant_id: restaurantA,
      p_command: command,
      p_wine_id: wineId,
    };
  }

  beforeAll(async () => {
    admin = createClient<Database>(supabaseUrl!, serviceRoleKey!, { auth: { persistSession: false } });

    const { data: restaurants, error: restaurantError } = await admin
      .from("restaurants")
      .insert([{ name: "Inventory Commands A" }, { name: "Inventory Commands B" }])
      .select("id");
    if (restaurantError || !restaurants || restaurants.length !== 2) {
      throw restaurantError ?? new Error("failed to create restaurants");
    }
    [restaurantA, restaurantB] = restaurants.map((row) => row.id);

    const run = `${Date.now()}-${crypto.randomUUID()}`;
    const { data: createdA, error: userAError } = await admin.auth.admin.createUser({
      email: `inventory-command-a-${run}@terroir.test`, password, email_confirm: true,
    });
    if (userAError || !createdA.user) throw userAError ?? new Error("failed to create user A");
    userAId = createdA.user.id;

    const { data: createdB, error: userBError } = await admin.auth.admin.createUser({
      email: `inventory-command-b-${run}@terroir.test`, password, email_confirm: true,
    });
    if (userBError || !createdB.user) throw userBError ?? new Error("failed to create user B");
    userBId = createdB.user.id;

    const { error: membershipError } = await admin.from("memberships").insert([
      { user_id: userAId, restaurant_id: restaurantA, role: "staff" },
      { user_id: userBId, restaurant_id: restaurantA, role: "staff" },
      { user_id: userBId, restaurant_id: restaurantB, role: "staff" },
    ]);
    if (membershipError) throw membershipError;

    userA = await signedInClient(createdA.user.email!, password);
    userANewYork = await signedInClient(
      createdA.user.email!,
      password,
      "timezone=America/New_York",
    );
    userB = await signedInClient(createdB.user.email!, password);
  });

  afterAll(async () => {
    if (admin && restaurantA && restaurantB) {
      await admin.from("restaurants").delete().in("id", [restaurantA, restaurantB]);
    }
    if (admin && userAId) await admin.auth.admin.deleteUser(userAId);
    if (admin && userBId) await admin.auth.admin.deleteUser(userBId);
  });

  it("opens explicitly, replays every command, and conserves four 150mL pours", async () => {
    const wineId = await createWine(1, "Explicit lifecycle");
    const openArgs: CommandArgs = {
      ...baseArgs(wineId, "open"), p_preservation_method: "coravin",
    };
    const opened = await runCommand(userA, openArgs);
    expect(opened).toMatchObject({ command: "open", replayed: false });
    expect(opened.open_bottle).toMatchObject({ remaining_ml: 750, closed_at: null });
    expect(await runCommand(userA, openArgs)).toMatchObject({
      replayed: true,
      pour_event_ids: opened.pour_event_ids,
      open_bottle: opened.open_bottle,
    });

    let current = opened.open_bottle;
    for (let index = 0; index < 4; index += 1) {
      const args: CommandArgs = {
        ...baseArgs(wineId, "pour"),
        p_ml: 150,
        p_expected_open_bottle_id: current.id,
        p_expected_opened_at: current.opened_at,
      };
      const result = await runCommand(userA, args);
      expect(await runCommand(userA, args)).toMatchObject({
        replayed: true,
        pour_event_ids: result.pour_event_ids,
        open_bottle: result.open_bottle,
      });
      current = result.open_bottle;
    }

    const [{ data: item }, { data: events }, { count: receiptCount }] = await Promise.all([
      admin.from("inventory_items").select("quantity").eq("wine_id", wineId).single(),
      admin.from("pour_events").select("kind, ml_delta").eq("wine_id", wineId),
      admin.from("inventory_command_receipts").select("operation_id", { count: "exact", head: true }).eq("wine_id", wineId),
    ]);
    const consumed = (events ?? [])
      .filter((event) => event.kind === "pour" || event.kind === "spill")
      .reduce((sum, event) => sum + event.ml_delta, 0);
    expect(item!.quantity).toBe(0);
    expect(current.remaining_ml).toBe(150);
    expect((events ?? []).filter((event) => event.kind === "new_bottle")).toHaveLength(1);
    expect((events ?? []).filter((event) => event.kind === "pour")).toHaveLength(4);
    expect(consumed).toBe(600);
    expect(item!.quantity * 750 + current.remaining_ml + consumed).toBe(750);
    expect(receiptCount).toBe(5);
  });

  it("rejects malformed and irrelevant parameters instead of ignoring intent", async () => {
    const wineId = await createWine(1, "Parameter matrix");
    const invalid: CommandArgs[] = [
      { ...baseArgs(wineId, "bogus") },
      { ...baseArgs(wineId, "open"), p_ml: 1 },
      { ...baseArgs(wineId, "open"), p_note: "x".repeat(501) },
      { ...baseArgs(wineId, "pour"), p_ml: 0 },
      { ...baseArgs(wineId, "pour"), p_ml: 2_001 },
      { ...baseArgs(wineId, "pour"), p_ml: 1, p_actual_remaining_ml: 0 },
      { ...baseArgs(wineId, "spill"), p_ml: 1, p_reason_code_id: crypto.randomUUID() },
      { ...baseArgs(wineId, "discard"), p_ml: 1 },
      { ...baseArgs(wineId, "discard") },
      { ...baseArgs(wineId, "close"), p_preservation_method: "none" },
      { ...baseArgs(wineId, "close"), p_actual_remaining_ml: 0 },
    ];

    for (const args of invalid) {
      await expectCommandError(userA, args, /invalid_inventory_command/);
    }
    const { count } = await admin
      .from("inventory_command_receipts")
      .select("operation_id", { count: "exact", head: true })
      .in("operation_id", invalid.map((args) => args.p_operation_id));
    expect(count).toBe(0);
  });

  it("serializes equal concurrent operation IDs into one effect and one replay", async () => {
    const wineId = await createWine(1, "Concurrent replay");
    const args = { ...baseArgs(wineId, "pour"), p_ml: 100 };
    const results = await Promise.all([runCommand(userA, args), runCommand(userA, args)]);
    expect(results.map((result) => result.replayed).sort()).toEqual([false, true]);

    const [{ data: bottle }, { data: events }, { count: receipts }] = await Promise.all([
      admin.from("open_bottles").select("remaining_ml").eq("wine_id", wineId).single(),
      admin.from("pour_events").select("id").eq("wine_id", wineId),
      admin.from("inventory_command_receipts").select("operation_id", { count: "exact", head: true }).eq("wine_id", wineId),
    ]);
    expect(bottle!.remaining_ml).toBe(650);
    expect(events).toHaveLength(2);
    expect(receipts).toBe(1);
  });

  it("serializes different concurrent open IDs without double-decrement", async () => {
    const wineId = await createWine(1, "Concurrent open");
    const settled = await Promise.allSettled([
      runCommand(userA, baseArgs(wineId, "open")),
      runCommand(userA, baseArgs(wineId, "open")),
    ]);
    expect(settled.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(settled.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect(String((settled.find((result) => result.status === "rejected") as PromiseRejectedResult).reason.message))
      .toMatch(/open_bottle_already_open/);
    const { data: item } = await admin.from("inventory_items").select("quantity").eq("wine_id", wineId).single();
    expect(item!.quantity).toBe(0);
  });

  it("rejects same-operation semantic payload and actor conflicts", async () => {
    const wineId = await createWine(1, "Receipt conflicts");
    const otherWineId = await createWine(1, "Receipt conflict other wine");
    const operationId = crypto.randomUUID();
    const args = {
      ...baseArgs(wineId, "pour"), p_operation_id: operationId, p_ml: 100,
    };
    const original = await runCommand(userA, args);
    const variants: CommandArgs[] = [
      { ...args, p_ml: 101 },
      { ...args, p_command: "spill" },
      { ...args, p_wine_id: otherWineId },
      { ...args, p_preservation_method: "vacuum" },
      {
        ...args,
        p_expected_open_bottle_id: original.open_bottle.id,
        p_expected_opened_at: original.open_bottle.opened_at,
      },
      {
        p_operation_id: operationId,
        p_restaurant_id: restaurantA,
        p_command: "close",
        p_wine_id: wineId,
        p_expected_open_bottle_id: original.open_bottle.id,
        p_expected_opened_at: original.open_bottle.opened_at,
        p_actual_remaining_ml: original.open_bottle.remaining_ml,
      },
    ];
    for (const variant of variants) {
      await expectCommandError(userA, variant, /inventory_operation_payload_conflict/);
    }
    await expectCommandError(userB, args, /inventory_operation_actor_conflict/);

    const [{ data: bottle }, { count: events }, { count: receipts }] = await Promise.all([
      admin.from("open_bottles").select("remaining_ml").eq("wine_id", wineId).single(),
      admin.from("pour_events").select("id", { count: "exact", head: true }).eq("wine_id", wineId),
      admin.from("inventory_command_receipts").select("operation_id", { count: "exact", head: true }).eq("operation_id", operationId),
    ]);
    expect(bottle!.remaining_ml).toBe(650);
    expect({ events, receipts }).toEqual({ events: 2, receipts: 1 });
  });

  it("revalidates current membership before replay and denies receipt table access", async () => {
    const wineId = await createWine(1, "Replay authorization");
    const args = { ...baseArgs(wineId, "pour"), p_ml: 100 };
    await runCommand(userA, args);

    const { error: receiptReadError } = await userA
      .from("inventory_command_receipts")
      .select("operation_id")
      .eq("operation_id", args.p_operation_id);
    expect(receiptReadError?.message).toMatch(/permission denied/);

    const { error: removeError } = await admin.from("memberships")
      .delete().eq("user_id", userAId).eq("restaurant_id", restaurantA);
    if (removeError) throw removeError;
    try {
      await expectCommandError(userA, args, /forbidden/);
    } finally {
      const { error: restoreError } = await admin.from("memberships").insert({
        user_id: userAId, restaurant_id: restaurantA, role: "staff",
      });
      if (restoreError) throw restoreError;
    }
  });

  it("rejects cross-tenant restaurant and wine combinations", async () => {
    const wineId = await createWine(1, "Tenant A only");
    await expectCommandError(userB, {
      ...baseArgs(wineId, "pour"), p_restaurant_id: restaurantB, p_ml: 100,
    }, /wine_not_found/);
    await expectCommandError(userA, {
      ...baseArgs(wineId, "pour"), p_restaurant_id: restaurantB, p_ml: 100,
    }, /forbidden/);

    const { data: wineB, error: wineBError } = await admin.from("wines").insert({
      restaurant_id: restaurantB, name: "Tenant B only", producer: "Command Test", size_ml: 750,
    }).select("id").single();
    if (wineBError || !wineB) throw wineBError ?? new Error("failed to create tenant B wine");
    const { error: inventoryBError } = await admin.from("inventory_items").insert({
      restaurant_id: restaurantB, wine_id: wineB.id, quantity: 1, unit_cost: 10, added_via: "manual",
    });
    if (inventoryBError) throw inventoryBError;

    const sharedOperationId = crypto.randomUUID();
    const resultA = await runCommand(userA, {
      ...baseArgs(wineId, "pour"), p_operation_id: sharedOperationId, p_ml: 100,
    });
    const resultB = await runCommand(userB, {
      ...baseArgs(wineB.id, "pour"),
      p_operation_id: sharedOperationId,
      p_restaurant_id: restaurantB,
      p_ml: 100,
    });
    expect([resultA.replayed, resultB.replayed]).toEqual([false, false]);

    await expectCommandError(userB, {
      ...baseArgs(wineB.id, "pour"),
      p_restaurant_id: restaurantB,
      p_ml: 1,
      p_expected_open_bottle_id: resultA.open_bottle.id,
      p_expected_opened_at: resultA.open_bottle.opened_at,
    }, /open_bottle_changed/);

    const { data: reasonB, error: reasonError } = await admin.from("reason_codes").insert({
      restaurant_id: restaurantB,
      code: `other-tenant-${crypto.randomUUID()}`,
      label: "Other tenant",
      category: "adjustment",
      active: true,
    }).select("id").single();
    if (reasonError || !reasonB) throw reasonError ?? new Error("failed to create reason code");
    await expectCommandError(userA, {
      ...baseArgs(wineId, "close"),
      p_expected_open_bottle_id: resultA.open_bottle.id,
      p_expected_opened_at: resultA.open_bottle.opened_at,
      p_actual_remaining_ml: resultA.open_bottle.remaining_ml,
      p_written_off_ml: 1,
      p_reason_code_id: reasonB.id,
    }, /invalid_reason_code/);

    const { error: receiptFkError } = await admin.from("inventory_command_receipts").insert({
      restaurant_id: restaurantB,
      operation_id: crypto.randomUUID(),
      actor_user_id: userBId,
      wine_id: wineId,
      command_type: "open",
      request_payload: {},
    });
    expect(receiptFkError?.message).toMatch(/inventory_command_receipts_wine_restaurant_fkey/);
  });

  it.each(["pour", "spill"] as const)(
    "conserves and attributes a 2,000mL %s across three physical bottles",
    async (command) => {
      const wineId = await createWine(3, `Two litre ${command}`);
      const result = await runCommand(userA, { ...baseArgs(wineId, command), p_ml: 2_000 });

      const [{ data: item }, { data: events }] = await Promise.all([
        admin.from("inventory_items").select("quantity").eq("wine_id", wineId).single(),
        admin
          .from("pour_events")
          .select("id, kind, ml_delta, occurred_at, open_bottle_id")
          .eq("wine_id", wineId),
      ]);
      const attributed = (events ?? [])
        .filter((event) => event.kind === command)
        .reduce((sum, event) => sum + event.ml_delta, 0);
      expect(item!.quantity).toBe(0);
      expect(result.open_bottle.remaining_ml).toBe(250);
      expect((events ?? []).filter((event) => event.kind === "new_bottle")).toHaveLength(3);
      expect((events ?? []).filter((event) => event.kind === command)).toHaveLength(3);
      expect(attributed).toBe(2_000);
      expect(attributed + result.open_bottle.remaining_ml).toBe(2_250);

      const byId = new Map((events ?? []).map((event) => [event.id, event]));
      const emitted = result.pour_event_ids.map((id) => byId.get(id)!);
      expect(emitted).toHaveLength(6);
      for (let index = 1; index < emitted.length; index += 1) {
        expect(emitted[index].occurred_at >= emitted[index - 1].occurred_at).toBe(true);
      }

      const finalLifecycleEvents = (events ?? []).filter(
        (event) =>
          event.kind === command &&
          event.open_bottle_id === result.open_bottle.id &&
          event.occurred_at >= result.open_bottle.opened_at,
      );
      expect(finalLifecycleEvents.reduce((sum, event) => sum + event.ml_delta, 0)).toBe(
        750 - result.open_bottle.remaining_ml,
      );
      const finalOpening = emitted.filter((event) => event.kind === "new_bottle").at(-1)!;
      expect(finalOpening.occurred_at).toBe(result.open_bottle.opened_at);
    },
  );

  it("attributes an auto-opened pour to the lifecycle it created", async () => {
    const wineId = await createWine(1, "Auto-open attribution");
    const result = await runCommand(userA, { ...baseArgs(wineId, "pour"), p_ml: 150 });
    const { data: events, error } = await admin
      .from("pour_events")
      .select("kind, ml_delta, occurred_at")
      .eq("wine_id", wineId)
      .gte("occurred_at", result.open_bottle.opened_at);
    if (error) throw error;

    const attributed = (events ?? [])
      .filter((event) => event.kind === "pour")
      .reduce((sum, event) => sum + event.ml_delta, 0);
    expect(attributed).toBe(150);
    expect(attributed).toBe(750 - result.open_bottle.remaining_ml);
  });

  it("commits preservation with auto-open, active, overage, and close lifecycles", async () => {
    const wineId = await createWine(3, "Preservation transaction");
    const autoOpened = await runCommand(userA, {
      ...baseArgs(wineId, "pour"), p_ml: 100, p_preservation_method: "vacuum",
    });
    expect(autoOpened.open_bottle.preservation_method).toBe("vacuum");

    const active = await runCommand(userA, {
      ...baseArgs(wineId, "pour"),
      p_ml: 100,
      p_preservation_method: "argon",
      p_expected_open_bottle_id: autoOpened.open_bottle.id,
      p_expected_opened_at: autoOpened.open_bottle.opened_at,
    });
    expect(active.open_bottle.preservation_method).toBe("argon");

    const overage = await runCommand(userA, {
      ...baseArgs(wineId, "pour"),
      p_ml: 700,
      p_preservation_method: "coravin",
      p_expected_open_bottle_id: active.open_bottle.id,
      p_expected_opened_at: active.open_bottle.opened_at,
    });
    expect(overage.open_bottle.remaining_ml).toBe(600);
    expect(overage.open_bottle.preservation_method).toBe("coravin");

    const closed = await runCommand(userA, {
      ...baseArgs(wineId, "close"),
      p_expected_open_bottle_id: overage.open_bottle.id,
      p_expected_opened_at: overage.open_bottle.opened_at,
      p_actual_remaining_ml: overage.open_bottle.remaining_ml,
    });
    expect(closed.closeout?.preservation_method).toBe("coravin");
    const { data: finishEvent, error: finishError } = await admin
      .from("pour_events")
      .select("occurred_at")
      .eq("id", closed.pour_event_ids[0])
      .single();
    if (finishError) throw finishError;
    expect(closed.open_bottle.closed_at).toBe(finishEvent.occurred_at);
    expect(closed.closeout?.closed_at).toBe(finishEvent.occurred_at);
    expect(closed.open_bottle.closed_at! >= closed.open_bottle.opened_at).toBe(true);
  });

  it("rolls back receipt, stock, ledger, and bottle state after deterministic mid-command exhaustion", async () => {
    const wineId = await createWine(2, "Rollback injection");
    const args = { ...baseArgs(wineId, "pour"), p_ml: 2_000 };
    await expectCommandError(userA, args, /no_inventory/);

    const [{ data: item }, { count: events }, { count: bottles }, { count: receipts }] = await Promise.all([
      admin.from("inventory_items").select("quantity").eq("wine_id", wineId).single(),
      admin.from("pour_events").select("id", { count: "exact", head: true }).eq("wine_id", wineId),
      admin.from("open_bottles").select("id", { count: "exact", head: true }).eq("wine_id", wineId),
      admin.from("inventory_command_receipts").select("operation_id", { count: "exact", head: true }).eq("operation_id", args.p_operation_id),
    ]);
    expect(item!.quantity).toBe(2);
    expect({ events, bottles, receipts }).toEqual({ events: 0, bottles: 0, receipts: 0 });
  });

  it("requires the exact reusable-slot lifecycle identity when closing", async () => {
    const wineId = await createWine(2, "Lifecycle compare");
    const first = await runCommand(userA, baseArgs(wineId, "open"));
    const closed = await runCommand(userA, {
      ...baseArgs(wineId, "close"),
      p_expected_open_bottle_id: first.open_bottle.id,
      p_expected_opened_at: first.open_bottle.opened_at,
      p_actual_remaining_ml: first.open_bottle.remaining_ml,
    });
    expect(closed.open_bottle.closed_at).not.toBeNull();

    const replacement = await runCommand(userA, baseArgs(wineId, "open"));
    expect(replacement.open_bottle.id).toBe(first.open_bottle.id);
    expect(replacement.open_bottle.opened_at).not.toBe(first.open_bottle.opened_at);

    await expectCommandError(userA, {
      ...baseArgs(wineId, "close"),
      p_expected_open_bottle_id: first.open_bottle.id,
      p_expected_opened_at: first.open_bottle.opened_at,
      p_actual_remaining_ml: replacement.open_bottle.remaining_ml,
    }, /open_bottle_changed/);
    await expectCommandError(userA, {
      ...baseArgs(wineId, "close"),
      p_expected_open_bottle_id: replacement.open_bottle.id,
      p_expected_opened_at: oneMicrosecondAfter(replacement.open_bottle.opened_at),
      p_actual_remaining_ml: replacement.open_bottle.remaining_ml,
    }, /open_bottle_changed/);

    const { data: stillOpen } = await admin.from("open_bottles")
      .select("opened_at, closed_at, remaining_ml").eq("wine_id", wineId).single();
    expect(stillOpen).toMatchObject({
      opened_at: replacement.open_bottle.opened_at, closed_at: null, remaining_ml: 750,
    });
  });

  it("replays a completed close even after the wine size changes", async () => {
    const wineId = await createWine(1, "Replay after mutable wine edit");
    const opened = await runCommand(userA, baseArgs(wineId, "open"));
    const closeArgs: CommandArgs = {
      ...baseArgs(wineId, "close"),
      p_expected_open_bottle_id: opened.open_bottle.id,
      p_expected_opened_at: opened.open_bottle.opened_at,
      p_actual_remaining_ml: 600,
    };
    const closed = await runCommand(userA, closeArgs);

    const { error: resizeError } = await admin.from("wines").update({ size_ml: 375 }).eq("id", wineId);
    if (resizeError) throw resizeError;

    const replayed = await runCommand(userA, closeArgs);
    expect(replayed).toMatchObject({
      replayed: true,
      operation_id: closed.operation_id,
      pour_event_ids: closed.pour_event_ids,
      closeout: closed.closeout,
    });
  });

  it("canonicalizes expected_opened_at independently of the session timezone", async () => {
    const wineId = await createWine(1, "Timezone-stable replay");
    const opened = await runCommand(userA, baseArgs(wineId, "open"));
    const closeArgs: CommandArgs = {
      ...baseArgs(wineId, "close"),
      p_expected_open_bottle_id: opened.open_bottle.id,
      p_expected_opened_at: opened.open_bottle.opened_at,
      p_actual_remaining_ml: opened.open_bottle.remaining_ml,
    };
    const closed = await runCommand(userA, closeArgs);
    await expect(runCommand(userANewYork, closeArgs)).resolves.toMatchObject({
      operation_id: closed.operation_id,
      replayed: true,
    });
  });

  it("discards the exact locked lifecycle without a closeout or replacement", async () => {
    const wineId = await createWine(2, "Lifecycle discard");
    const opened = await runCommand(userA, baseArgs(wineId, "open"));
    const poured = await runCommand(userA, {
      ...baseArgs(wineId, "pour"),
      p_ml: 125,
      p_expected_open_bottle_id: opened.open_bottle.id,
      p_expected_opened_at: opened.open_bottle.opened_at,
    });
    const discardArgs: CommandArgs = {
      ...baseArgs(wineId, "discard"),
      p_expected_open_bottle_id: poured.open_bottle.id,
      p_expected_opened_at: poured.open_bottle.opened_at,
    };
    const discarded = await runCommand(userA, discardArgs);
    expect(discarded).toMatchObject({
      command: "discard",
      replayed: false,
      open_bottle: { remaining_ml: 0 },
    });
    expect(discarded.open_bottle.closed_at).not.toBeNull();
    await expect(runCommand(userA, discardArgs)).resolves.toMatchObject({ replayed: true });

    const [{ data: item }, { data: events }, { count: closeouts }] = await Promise.all([
      admin.from("inventory_items").select("quantity").eq("wine_id", wineId).single(),
      admin.from("pour_events").select("kind, ml_delta").eq("wine_id", wineId),
      admin.from("bottle_closeouts").select("id", { count: "exact", head: true }).eq("wine_id", wineId),
    ]);
    expect(item!.quantity).toBe(1);
    expect((events ?? []).filter((event) => event.kind === "new_bottle")).toHaveLength(1);
    expect((events ?? []).filter((event) => event.kind === "spill")).toEqual([
      expect.objectContaining({ ml_delta: 625 }),
    ]);
    expect(closeouts).toBe(0);

    await expectCommandError(userA, {
      ...baseArgs(wineId, "discard"),
      p_expected_open_bottle_id: discarded.open_bottle.id,
      p_expected_opened_at: discarded.open_bottle.opened_at,
    }, /open_bottle_already_closed/);
  });

  it("serializes pour versus close on the same expected lifecycle", async () => {
    const wineId = await createWine(1, "Pour close race");
    const opened = await runCommand(userA, baseArgs(wineId, "open"));
    const expected = {
      p_expected_open_bottle_id: opened.open_bottle.id,
      p_expected_opened_at: opened.open_bottle.opened_at,
    };
    const [pourResult, closeResult] = await Promise.allSettled([
      runCommand(userA, { ...baseArgs(wineId, "pour"), ...expected, p_ml: 100 }),
      runCommand(userA, {
        ...baseArgs(wineId, "close"), ...expected, p_actual_remaining_ml: 750,
      }),
    ]);
    expect(closeResult.status).toBe("fulfilled");
    if (pourResult.status === "rejected") {
      expect(String(pourResult.reason.message)).toMatch(/open_bottle_changed/);
    }

    const [{ data: finalBottle }, { data: events }] = await Promise.all([
      admin.from("open_bottles").select("remaining_ml, closed_at").eq("wine_id", wineId).single(),
      admin.from("pour_events").select("kind, ml_delta").eq("wine_id", wineId),
    ]);
    const depleted = (events ?? [])
      .filter((event) => event.ml_delta > 0)
      .reduce((sum, event) => sum + event.ml_delta, 0);
    expect(finalBottle).toMatchObject({ remaining_ml: 0 });
    expect(finalBottle!.closed_at).not.toBeNull();
    expect(depleted).toBe(750);
  });

  it("never lets a concurrent stale close drain a replacement bottle", async () => {
    const wineId = await createWine(2, "Close replacement race");
    const first = await runCommand(userA, baseArgs(wineId, "open"));
    const closeArgs: CommandArgs = {
      ...baseArgs(wineId, "close"),
      p_expected_open_bottle_id: first.open_bottle.id,
      p_expected_opened_at: first.open_bottle.opened_at,
      p_actual_remaining_ml: first.open_bottle.remaining_ml,
    };

    const [closeResult, openResult] = await Promise.allSettled([
      runCommand(userA, closeArgs),
      runCommand(userA, baseArgs(wineId, "open")),
    ]);
    expect(closeResult.status).toBe("fulfilled");

    const { data: finalBottle } = await admin.from("open_bottles")
      .select("id, opened_at, closed_at, remaining_ml").eq("wine_id", wineId).single();
    expect(finalBottle!.id).toBe(first.open_bottle.id);
    if (openResult.status === "fulfilled") {
      expect(finalBottle).toMatchObject({
        opened_at: openResult.value.open_bottle.opened_at,
        closed_at: null,
        remaining_ml: 750,
      });
      expect(finalBottle!.opened_at).not.toBe(first.open_bottle.opened_at);
    } else {
      expect(String(openResult.reason.message)).toMatch(/open_bottle_already_open/);
      expect(finalBottle!.opened_at).toBe(first.open_bottle.opened_at);
      expect(finalBottle!.closed_at).not.toBeNull();
    }
  });

  it("keeps an idempotent receipt immutable after an explicit reversal", async () => {
    const wineId = await createWine(1, "Reversal semantics");
    const opened = await runCommand(userA, baseArgs(wineId, "open"));
    const args = {
      ...baseArgs(wineId, "pour"),
      p_ml: 150,
      p_expected_open_bottle_id: opened.open_bottle.id,
      p_expected_opened_at: opened.open_bottle.opened_at,
    };
    const poured = await runCommand(userA, args);
    expect(poured.open_bottle.remaining_ml).toBe(600);

    const { data: restored, error: undoError } = await userA.rpc("undo_last_pour", { p_wine_id: wineId });
    if (undoError) throw undoError;
    expect(restored.remaining_ml).toBe(750);

    const replayed = await runCommand(userA, args);
    expect(replayed).toMatchObject({ replayed: true, open_bottle: { remaining_ml: 600 } });
    const { data: actual } = await admin.from("open_bottles").select("remaining_ml").eq("wine_id", wineId).single();
    expect(actual!.remaining_ml).toBe(750);
  });

  it("serializes a concurrent command and undo without deadlock or lost volume", async () => {
    const wineId = await createWine(1, "Concurrent command and undo");
    const opened = await runCommand(userA, baseArgs(wineId, "open"));
    await runCommand(userA, {
      ...baseArgs(wineId, "pour"),
      p_ml: 100,
      p_expected_open_bottle_id: opened.open_bottle.id,
      p_expected_opened_at: opened.open_bottle.opened_at,
    });

    const commandArgs: CommandArgs = {
      ...baseArgs(wineId, "pour"),
      p_ml: 50,
      p_expected_open_bottle_id: opened.open_bottle.id,
      p_expected_opened_at: opened.open_bottle.opened_at,
    };
    const [commandResult, undoResult] = await Promise.all([
      runCommand(userA, commandArgs),
      userANewYork.rpc("undo_last_pour", { p_wine_id: wineId }),
    ]);
    expect(commandResult.replayed).toBe(false);
    if (undoResult.error) throw undoResult.error;

    const [{ data: current }, { data: events }, { count: availabilityCount }] = await Promise.all([
      admin.from("open_bottles").select("remaining_ml").eq("wine_id", wineId).single(),
      admin.from("pour_events").select("kind, ml_delta").eq("wine_id", wineId),
      admin.from("availability_events").select("id", { count: "exact", head: true }).eq("wine_id", wineId),
    ]);
    const consumed = (events ?? [])
      .filter((event) => event.kind === "pour" || event.kind === "spill")
      .reduce((sum, event) => sum + event.ml_delta, 0);
    expect(current!.remaining_ml + consumed).toBe(750);
    expect(availabilityCount).toBe(1);
  });

  it("atomically refuses undo for a multi-lifecycle command", async () => {
    const wineId = await createWine(2, "Multi-lifecycle undo refusal");
    const opened = await runCommand(userA, baseArgs(wineId, "open"));
    const nearlyDrained = await runCommand(userA, {
      ...baseArgs(wineId, "pour"),
      p_ml: 700,
      p_expected_open_bottle_id: opened.open_bottle.id,
      p_expected_opened_at: opened.open_bottle.opened_at,
    });
    const crossing = await runCommand(userA, {
      ...baseArgs(wineId, "pour"),
      p_ml: 150,
      p_expected_open_bottle_id: nearlyDrained.open_bottle.id,
      p_expected_opened_at: nearlyDrained.open_bottle.opened_at,
    });
    const { count: availabilityBefore } = await admin
      .from("availability_events")
      .select("id", { count: "exact", head: true })
      .eq("wine_id", wineId);

    const { error } = await userA.rpc("undo_last_pour", { p_wine_id: wineId });
    expect(error?.message).toMatch(/undo_inventory_command_not_reversible/);

    const [{ data: bottle }, { count: events }, { count: availabilityAfter }] = await Promise.all([
      admin.from("open_bottles").select("remaining_ml, opened_at").eq("wine_id", wineId).single(),
      admin.from("pour_events").select("id", { count: "exact", head: true }).eq("wine_id", wineId),
      admin.from("availability_events").select("id", { count: "exact", head: true }).eq("wine_id", wineId),
    ]);
    expect(bottle).toMatchObject({
      remaining_ml: 650,
      opened_at: crossing.open_bottle.opened_at,
    });
    expect(events).toBe(5);
    expect(availabilityAfter).toBe(availabilityBefore);
  });

  it("allows exact-drain undo only before a replacement lifecycle opens", async () => {
    const undoableWineId = await createWine(1, "Exact drain undo");
    const undoable = await runCommand(userA, baseArgs(undoableWineId, "open"));
    await runCommand(userA, {
      ...baseArgs(undoableWineId, "pour"),
      p_ml: 750,
      p_expected_open_bottle_id: undoable.open_bottle.id,
      p_expected_opened_at: undoable.open_bottle.opened_at,
    });
    const { data: restored, error: restoreError } = await userA.rpc("undo_last_pour", {
      p_wine_id: undoableWineId,
    });
    if (restoreError) throw restoreError;
    expect(restored).toMatchObject({ remaining_ml: 750, closed_at: null });

    const guardedWineId = await createWine(2, "Replacement undo refusal");
    const first = await runCommand(userA, baseArgs(guardedWineId, "open"));
    await runCommand(userA, {
      ...baseArgs(guardedWineId, "pour"),
      p_ml: 750,
      p_expected_open_bottle_id: first.open_bottle.id,
      p_expected_opened_at: first.open_bottle.opened_at,
    });
    const replacement = await runCommand(userA, baseArgs(guardedWineId, "open"));
    const { count: availabilityBefore } = await admin
      .from("availability_events")
      .select("id", { count: "exact", head: true })
      .eq("wine_id", guardedWineId);

    const { error } = await userA.rpc("undo_last_pour", { p_wine_id: guardedWineId });
    expect(error?.message).toMatch(/undo_inventory_command_not_reversible/);
    const [{ data: current }, { count: availabilityAfter }] = await Promise.all([
      admin.from("open_bottles").select("remaining_ml, opened_at").eq("wine_id", guardedWineId).single(),
      admin.from("availability_events").select("id", { count: "exact", head: true }).eq("wine_id", guardedWineId),
    ]);
    expect(current).toMatchObject({
      remaining_ml: 750,
      opened_at: replacement.open_bottle.opened_at,
    });
    expect(availabilityAfter).toBe(availabilityBefore);
  });
});
