import { spawn } from "node:child_process";
import { z } from "zod";
import { assertLiveDbTargetIsLocal } from "./live-db-target";

const uuid = z.string().uuid();

function localPostgresUrl(apiUrl: string): string {
  assertLiveDbTargetIsLocal(apiUrl);
  const parsed = new URL(apiUrl);
  const apiPort = Number(parsed.port);
  if (!Number.isInteger(apiPort) || apiPort <= 0) {
    throw new Error("cannot derive local Postgres port");
  }
  return `postgresql://postgres:postgres@${parsed.hostname}:${apiPort + 1}/postgres`;
}

async function runLocalPsql(apiUrl: string, sql: string): Promise<void> {
  const child = spawn(
    "psql",
    [localPostgresUrl(apiUrl), "-X", "-v", "ON_ERROR_STOP=1", "-At"],
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
      else reject(new Error(`local sealed fixture cleanup failed: ${output}`));
    });
  });
}

function uuidArray(values: string[]): string {
  return values.map((value) => `'${uuid.parse(value)}'`).join(",");
}

/**
 * Removes immutable histories owned by live-test identities. This uses the
 * disposable local database superuser because production exposes no history-
 * deletion capability. Every target is UUID-validated and exact.
 */
export async function cleanupLocalSealedFixtures({
  apiUrl,
  restaurantIds = [],
  membershipIds = [],
}: {
  apiUrl: string;
  restaurantIds?: string[];
  membershipIds?: string[];
}): Promise<void> {
  if (restaurantIds.length === 0 && membershipIds.length === 0) return;
  const statements = ["begin;"];
  if (membershipIds.length > 0) {
    const members = uuidArray(membershipIds);
    statements.push(
      "set local session_replication_role = replica;",
      `delete from public.membership_capability_grants where membership_id = any(array[${members}]::uuid[]);`,
      "set local session_replication_role = origin;",
    );
  }
  if (restaurantIds.length > 0) {
    const restaurants = uuidArray(restaurantIds);
    statements.push(
      `delete from public.inventory_command_bottle_effects where restaurant_id = any(array[${restaurants}]::uuid[]);`,
      `delete from public.pour_events where restaurant_id = any(array[${restaurants}]::uuid[]);`,
      `delete from public.bottle_closeouts where restaurant_id = any(array[${restaurants}]::uuid[]);`,
      `delete from public.open_bottles where restaurant_id = any(array[${restaurants}]::uuid[]);`,
      `delete from public.inventory_command_receipts where restaurant_id = any(array[${restaurants}]::uuid[]);`,
    );
  }
  statements.push("commit;");
  await runLocalPsql(apiUrl, statements.join("\n"));
}
