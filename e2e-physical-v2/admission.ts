import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

export const PHYSICAL_V2_PROJECT_ID = "terroir-physical-v2-e2e";
export const PHYSICAL_V2_ACK = "I_ACKNOWLEDGE_DISPOSABLE_PHYSICAL_V2";
const RETAINED_PROJECT_IDS = new Set([
  "terroir-vw-local",
  "terroir-c04-browser-0154",
]);
const RETAINED_API_PORTS = new Set([57321, 58321]);
const REQUIRED_ENV = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "DEV_BYPASS_EMAIL",
  "PHYSICAL_V2_DISPOSABLE_ACK",
  "PHYSICAL_V2_EXPECTED_DB_CONTAINER_ID",
  "PHYSICAL_V2_APP_PORT",
] as const;

type ParsedConfig = {
  projectId: string;
  apiPort: number;
  dbPort: number;
};

type AdmittedTarget = ParsedConfig & {
  database: { id: string; name: string };
  api: { id: string; name: string };
};

type StackAdmissionPrimitives = {
  parseLocalStackConfig(raw: string): ParsedConfig;
  assertConservationApiUrl(apiUrl: string, configText: string): void;
  admitLocalStack(configText: string): AdmittedTarget;
};

export type PhysicalV2Settings = ParsedConfig & {
  appPort: number;
  baseURL: string;
  databaseContainerId: string;
  devEmail: string;
  publishableKey: string;
  serviceRoleKey: string;
  supabaseUrl: string;
};

export type PhysicalV2Admission = {
  admin: SupabaseClient<Database>;
  restaurantId: string;
  settings: PhysicalV2Settings;
  target: AdmittedTarget;
  userId: string;
};

export function resolveOwnedPhysicalV2Config(repoRoot: string): string {
  const logicalRoot = path.resolve(repoRoot);
  const physicalRoot = realpathSync(logicalRoot);
  const logicalSupabase = path.join(logicalRoot, "supabase");
  const physicalSupabase = realpathSync(logicalSupabase);
  const expectedPhysicalSupabase = path.join(physicalRoot, "supabase");
  if (physicalSupabase !== expectedPhysicalSupabase) {
    throw new Error(
      "physical-v2 refuses a supabase directory outside the current runtime checkout",
    );
  }
  const logicalConfig = path.join(logicalSupabase, "config.toml");
  if (lstatSync(logicalConfig).isSymbolicLink()) {
    throw new Error("physical-v2 refuses a symlinked supabase/config.toml");
  }
  const physicalConfig = realpathSync(logicalConfig);
  const expectedPhysicalConfig = path.join(expectedPhysicalSupabase, "config.toml");
  if (physicalConfig !== expectedPhysicalConfig) {
    throw new Error(
      "physical-v2 config must be physically owned by the current runtime checkout",
    );
  }
  return physicalConfig;
}

export function validatePhysicalV2Settings(
  environment: NodeJS.ProcessEnv,
  config: ParsedConfig,
): PhysicalV2Settings {
  const missing = REQUIRED_ENV.filter((name) => !environment[name]?.trim());
  if (missing.length > 0) {
    throw new Error(`physical-v2 admission missing environment: ${missing.join(", ")}`);
  }
  if (config.projectId !== PHYSICAL_V2_PROJECT_ID) {
    const retained = RETAINED_PROJECT_IDS.has(config.projectId) ? " retained" : "";
    throw new Error(
      `physical-v2 refuses${retained} Supabase project ${config.projectId}; ` +
        `run only from a separately materialized checkout whose own ` +
        `supabase/config.toml uses ${PHYSICAL_V2_PROJECT_ID}`,
    );
  }
  if (RETAINED_API_PORTS.has(config.apiPort)) {
    throw new Error(`physical-v2 refuses retained API port ${config.apiPort}`);
  }
  if (environment.PHYSICAL_V2_DISPOSABLE_ACK !== PHYSICAL_V2_ACK) {
    throw new Error(
      `PHYSICAL_V2_DISPOSABLE_ACK must equal ${PHYSICAL_V2_ACK}`,
    );
  }
  const databaseContainerId = environment.PHYSICAL_V2_EXPECTED_DB_CONTAINER_ID!;
  if (!/^[0-9a-f]{64}$/.test(databaseContainerId)) {
    throw new Error("PHYSICAL_V2_EXPECTED_DB_CONTAINER_ID must be one exact 64-character container ID");
  }
  const appPort = Number(environment.PHYSICAL_V2_APP_PORT);
  if (!Number.isSafeInteger(appPort) || appPort < 1024 || appPort > 65535) {
    throw new Error("PHYSICAL_V2_APP_PORT must be an unprivileged TCP port");
  }
  const supabaseUrl = environment.NEXT_PUBLIC_SUPABASE_URL!;
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(supabaseUrl);
  } catch {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL must be a valid URL");
  }
  const expectedSupabaseUrl = `http://127.0.0.1:${config.apiPort}`;
  if (parsedUrl.href !== `${expectedSupabaseUrl}/`) {
    throw new Error(
      `physical-v2 Supabase URL must be exactly ${expectedSupabaseUrl}; got ${supabaseUrl}`,
    );
  }
  return {
    ...config,
    appPort,
    baseURL: `http://127.0.0.1:${appPort}`,
    databaseContainerId,
    devEmail: environment.DEV_BYPASS_EMAIL!,
    publishableKey: environment.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    serviceRoleKey: environment.SUPABASE_SERVICE_ROLE_KEY!,
    supabaseUrl,
  };
}

export async function admitPhysicalV2Target(
  environment: NodeJS.ProcessEnv = process.env,
): Promise<PhysicalV2Admission> {
  const repoRoot = process.cwd();
  const configPath = resolveOwnedPhysicalV2Config(repoRoot);
  const configText = readFileSync(configPath, "utf8");
  const primitives = await loadAdmissionPrimitives(repoRoot);
  const config = primitives.parseLocalStackConfig(configText);
  const settings = validatePhysicalV2Settings(environment, config);
  primitives.assertConservationApiUrl(settings.supabaseUrl, configText);
  const target = primitives.admitLocalStack(configText);
  if (target.database.id !== settings.databaseContainerId) {
    throw new Error(
      "physical-v2 database container does not match PHYSICAL_V2_EXPECTED_DB_CONTAINER_ID",
    );
  }
  assertLoopbackOnlyContainerBinding(target.api.id, 8000, settings.apiPort);
  assertLoopbackOnlyContainerBinding(target.database.id, 5432, settings.dbPort);

  const admin = createClient<Database>(settings.supabaseUrl, settings.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: contractVersion, error: contractError } =
    await admin.rpc("current_inventory_contract_version");
  if (contractError || contractVersion !== 2) {
    throw new Error(
      `physical-v2 requires current_inventory_contract_version() = 2; got ` +
        `${contractError ? contractError.message : String(contractVersion)}`,
    );
  }
  const { data: users, error: usersError } = await admin.auth.admin.listUsers({
    perPage: 200,
  });
  if (usersError) throw new Error(`physical-v2 cannot list dev users: ${usersError.message}`);
  const user = users.users.find((candidate) => candidate.email === settings.devEmail);
  if (!user) throw new Error(`physical-v2 dev user ${settings.devEmail} is missing`);

  const { data: link, error: linkError } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email: settings.devEmail,
  });
  if (linkError) throw new Error(`physical-v2 cannot mint dev access: ${linkError.message}`);
  const userClient = createClient<Database>(settings.supabaseUrl, settings.publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error: verifyError } = await userClient.auth.verifyOtp({
    type: "magiclink",
    token_hash: link.properties.hashed_token,
  });
  if (verifyError) throw new Error(`physical-v2 dev access failed: ${verifyError.message}`);
  const { data: userContractVersion, error: userContractError } =
    await userClient.rpc("current_inventory_contract_version");
  if (userContractError || userContractVersion !== 2) {
    throw new Error(
      `physical-v2 authenticated contract access failed: ` +
        `${userContractError?.message ?? String(userContractVersion)}`,
    );
  }
  const { data: memberships, error: membershipError } = await userClient
    .from("memberships")
    .select("restaurant_id, created_at, id")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(1);
  if (membershipError || !memberships?.[0]) {
    throw new Error(
      `physical-v2 dev user has no readable restaurant membership: ` +
        `${membershipError?.message ?? "no row"}`,
    );
  }
  const stableTarget = primitives.admitLocalStack(configText);
  if (
    stableTarget.database.id !== target.database.id ||
    stableTarget.api.id !== target.api.id
  ) {
    throw new Error("physical-v2 admitted containers changed during preflight");
  }
  return {
    admin,
    restaurantId: memberships[0].restaurant_id,
    settings,
    target,
    userId: user.id,
  };
}

async function loadAdmissionPrimitives(repoRoot: string): Promise<StackAdmissionPrimitives> {
  const moduleUrl = pathToFileURL(
    path.join(repoRoot, "scripts/run-live-test-conservation.mjs"),
  ).href;
  return await import(moduleUrl) as StackAdmissionPrimitives;
}

function assertLoopbackOnlyContainerBinding(
  containerId: string,
  internalPort: number,
  expectedHostPort: number,
): void {
  const result = spawnSync(
    "docker",
    ["inspect", "--format", "{{json .NetworkSettings.Ports}}", containerId],
    { cwd: process.cwd(), encoding: "utf8" },
  );
  assertInspectSuccess(result, containerId);
  let ports: Record<string, Array<{ HostIp?: string; HostPort?: string }> | null>;
  try {
    ports = JSON.parse(result.stdout.trim()) as typeof ports;
  } catch {
    throw new Error(`physical-v2 could not parse Docker bindings for ${containerId}`);
  }
  const bindings = ports[`${internalPort}/tcp`];
  if (
    !Array.isArray(bindings) ||
    bindings.length === 0 ||
    bindings.some((binding) =>
      binding.HostIp !== "127.0.0.1" ||
      binding.HostPort !== String(expectedHostPort)
    )
  ) {
    throw new Error(
      `physical-v2 requires ${containerId} ${internalPort}/tcp to bind only ` +
        `127.0.0.1:${expectedHostPort}`,
    );
  }
}

function assertInspectSuccess(
  result: SpawnSyncReturns<string>,
  containerId: string,
): void {
  if (result.error || result.status !== 0) {
    throw new Error(`physical-v2 could not inspect admitted container ${containerId}`);
  }
}
