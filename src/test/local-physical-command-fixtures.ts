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

/**
 * Removes immutable physical-command history owned by a live-test tenant.
 * This uses the disposable local database superuser because the production
 * API intentionally exposes no history-deletion capability.
 */
export async function cleanupLocalPhysicalCommandFixtures(
  apiUrl: string,
  restaurantIds: string[],
): Promise<void> {
  if (restaurantIds.length === 0) return;
  const ids = restaurantIds.map((id) => uuid.parse(id));
  const values = ids.map((id) => `'${id}'`).join(",");
  const sql = `
begin;
delete from public.inventory_command_bottle_effects where restaurant_id = any(array[${values}]::uuid[]);
delete from public.pour_events where restaurant_id = any(array[${values}]::uuid[]);
delete from public.bottle_closeouts where restaurant_id = any(array[${values}]::uuid[]);
delete from public.open_bottles where restaurant_id = any(array[${values}]::uuid[]);
delete from public.inventory_command_receipts where restaurant_id = any(array[${values}]::uuid[]);
commit;
`;
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
      else reject(new Error(`local physical fixture cleanup failed: ${output}`));
    });
  });
}
