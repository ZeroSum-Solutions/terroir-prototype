#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const TRACKED_IDENTITY_TABLES = [
  "auth.users",
  "public.restaurants",
  "public.workspaces",
  "public.memberships",
  "public.workspace_memberships",
  "public.inventory_command_receipts",
];
export const SNAPSHOT_MAX_BUFFER_BYTES = 8 * 1024 * 1024;
export const REQUIRED_LIVE_ENVIRONMENT = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
];

export const IDENTITY_SNAPSHOT_SQL = String.raw`
select tracked_table || E'\t' || tracked_identity
from (
  select 'auth.users' as tracked_table, id::text as tracked_identity
    from auth.users
  union all
  select 'public.restaurants', id::text
    from public.restaurants
  union all
  select 'public.workspaces', id::text
    from public.workspaces
  union all
  select 'public.memberships', id::text
    from public.memberships
  union all
  select 'public.workspace_memberships', id::text
    from public.workspace_memberships
  union all
  select 'public.inventory_command_receipts',
         restaurant_id::text || '/' || operation_id::text
    from public.inventory_command_receipts
) identities
order by tracked_table, tracked_identity;
`;

const knownTables = new Set(TRACKED_IDENTITY_TABLES);
const UUID_PAIR_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseIdentitySnapshot(raw) {
  const snapshot = Object.fromEntries(
    TRACKED_IDENTITY_TABLES.map((table) => [table, []]),
  );
  for (const line of raw.split(/\r?\n/)) {
    if (line === "") continue;
    const tab = line.indexOf("\t");
    if (tab <= 0 || tab === line.length - 1 || line.indexOf("\t", tab + 1) !== -1) {
      throw new Error(`invalid identity snapshot line: ${line}`);
    }
    const table = line.slice(0, tab);
    const identity = line.slice(tab + 1);
    if (!knownTables.has(table)) {
      throw new Error(`unexpected identity table: ${table}`);
    }
    if (table === "public.inventory_command_receipts" && !UUID_PAIR_PATTERN.test(identity)) {
      throw new Error(`invalid receipt composite identity: ${identity}`);
    }
    snapshot[table].push(identity);
  }
  for (const table of TRACKED_IDENTITY_TABLES) {
    snapshot[table].sort();
    if (new Set(snapshot[table]).size !== snapshot[table].length) {
      throw new Error(`duplicate identity in snapshot: ${table}`);
    }
  }
  return snapshot;
}

export function compareIdentitySnapshots(before, after) {
  return TRACKED_IDENTITY_TABLES.flatMap((table) => {
    const beforeSet = new Set(before[table]);
    const afterSet = new Set(after[table]);
    const added = after[table].filter((identity) => !beforeSet.has(identity));
    const removed = before[table].filter((identity) => !afterSet.has(identity));
    return added.length === 0 && removed.length === 0
      ? []
      : [{
          table,
          beforeCount: before[table].length,
          afterCount: after[table].length,
          added,
          removed,
        }];
  });
}

export function evaluateConservation({ before, after, childExitCode }) {
  const drift = compareIdentitySnapshots(before, after);
  return {
    childExitCode,
    drift,
    exitCode: childExitCode === 0 && drift.length === 0 ? 0 : 1,
  };
}

export function missingLiveEnvironment(environment) {
  return REQUIRED_LIVE_ENVIRONMENT.filter((name) => (
    typeof environment[name] !== "string" || environment[name].trim() === ""
  ));
}

export function liveChildEnvironment(environment) {
  return { ...environment, CI: "1" };
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function childOutcome(result) {
  if (result.error) {
    const code = typeof result.error.code === "string" ? result.error.code : "unknown";
    return { childExitCode: 1, childFailure: `spawn_error:${code}` };
  }
  if (result.signal) {
    return { childExitCode: 1, childFailure: `signal:${result.signal}` };
  }
  const childExitCode = Number.isInteger(result.status) ? result.status : 1;
  return {
    childExitCode,
    childFailure: childExitCode === 0 ? null : `exit_code:${childExitCode}`,
  };
}

export function runConservationOrchestration({ captureSnapshot, runChild }) {
  let before;
  try {
    before = captureSnapshot();
  } catch (error) {
    return {
      before: null,
      after: null,
      childExitCode: 1,
      childFailure: "not_run",
      preCaptureFailure: errorMessage(error),
      postCaptureFailure: null,
      drift: [],
      exitCode: 1,
    };
  }

  let outcome;
  try {
    outcome = childOutcome(runChild());
  } catch (error) {
    outcome = { childExitCode: 1, childFailure: `execution_error:${errorMessage(error)}` };
  }

  let after = null;
  let postCaptureFailure = null;
  try {
    after = captureSnapshot();
  } catch (error) {
    postCaptureFailure = errorMessage(error);
  }
  const drift = after === null ? [] : compareIdentitySnapshots(before, after);
  return {
    before,
    after,
    ...outcome,
    preCaptureFailure: null,
    postCaptureFailure,
    drift,
    exitCode: outcome.childFailure === null &&
        postCaptureFailure === null &&
        drift.length === 0
      ? 0
      : 1,
  };
}

function run(command, args, options = {}) {
  return spawnSync(command, args, {
    cwd: process.cwd(),
    encoding: "utf8",
    ...options,
  });
}

export function parseLocalStackConfig(raw) {
  const values = { projectId: [], apiPort: [], dbPort: [] };
  let section = "";
  for (const sourceLine of raw.split(/\r?\n/)) {
    const line = sourceLine.replace(/\s+#.*$/, "").trim();
    if (!line) continue;
    const header = line.match(/^\[([a-z0-9_.-]+)]$/i);
    if (header) {
      section = header[1];
      continue;
    }
    if (section === "" && /^project_id\b/.test(line)) {
      const match = line.match(/^project_id\s*=\s*"([^"]+)"$/);
      if (!match) throw new Error("invalid project_id in supabase/config.toml");
      values.projectId.push(match[1]);
    }
    if ((section === "api" || section === "db") && /^port\b/.test(line)) {
      const match = line.match(/^port\s*=\s*([0-9]+)$/);
      if (!match) throw new Error(`invalid [${section}] port in supabase/config.toml`);
      values[section === "api" ? "apiPort" : "dbPort"].push(Number(match[1]));
    }
  }
  for (const [name, found] of Object.entries(values)) {
    if (found.length !== 1) throw new Error(`ambiguous or missing ${name} in supabase/config.toml`);
  }
  const [projectId] = values.projectId;
  const [apiPort] = values.apiPort;
  const [dbPort] = values.dbPort;
  if (!/^[a-z0-9][a-z0-9_-]{0,62}$/.test(projectId)) {
    throw new Error("invalid project_id in supabase/config.toml");
  }
  if (![apiPort, dbPort].every((port) => Number.isInteger(port) && port > 0 && port <= 65535) || apiPort === dbPort) {
    throw new Error("invalid or overlapping local Supabase ports");
  }
  return { projectId, apiPort, dbPort };
}

export function assertConservationApiUrl(apiUrl, configText) {
  const { apiPort } = parseLocalStackConfig(configText);
  const expected = `http://127.0.0.1:${apiPort}`;
  if (apiUrl !== expected) {
    throw new Error(`conservation target must be exactly ${expected}`);
  }
}

const INSPECT_FORMAT = '{{.Id}}\t{{.Name}}\t{{.State.Status}}\t{{index .Config.Labels "com.supabase.cli.project"}}\t{{index .Config.Labels "com.docker.compose.project"}}\t{{json .NetworkSettings.Ports}}';

function inspectStackContainer(name, projectId, internalPort, hostPort, runCommand) {
  const result = runCommand("docker", ["inspect", "--format", INSPECT_FORMAT, name]);
  if (result.error || result.status !== 0) {
    throw new Error(`could not inspect ${name}`);
  }
  const rows = result.stdout.trim().split(/\r?\n/);
  if (rows.length !== 1) throw new Error(`ambiguous Docker target for ${name}`);
  const [id, actualName, status, supabaseProject, composeProject, rawPorts, ...extra] = rows[0].split("\t");
  if (extra.length > 0 || !/^[0-9a-f]{64}$/.test(id) || actualName !== `/${name}` || status !== "running") {
    throw new Error(`invalid or stopped Docker target for ${name}`);
  }
  if (supabaseProject !== projectId || composeProject !== projectId) {
    throw new Error(`Docker container labels do not match project ${projectId}`);
  }
  let ports;
  try {
    ports = JSON.parse(rawPorts);
  } catch {
    throw new Error(`invalid Docker port metadata for ${name}`);
  }
  const bindings = ports[`${internalPort}/tcp`];
  if (!Array.isArray(bindings) || bindings.length === 0 || bindings.some((binding) => binding?.HostPort !== String(hostPort))) {
    throw new Error(`Docker port binding does not match config for ${name}`);
  }
  if (!bindings.some((binding) => ["127.0.0.1", "0.0.0.0"].includes(binding?.HostIp))) {
    throw new Error(`Docker port binding does not cover IPv4 loopback for ${name}`);
  }
  return { id, name };
}

export function admitLocalStack(configText, runCommand = run) {
  const config = parseLocalStackConfig(configText);
  const databaseName = `supabase_db_${config.projectId}`;
  const apiName = `supabase_kong_${config.projectId}`;
  return {
    ...config,
    database: inspectStackContainer(databaseName, config.projectId, 5432, config.dbPort, runCommand),
    api: inspectStackContainer(apiName, config.projectId, 8000, config.apiPort, runCommand),
  };
}

function assertAdmittedLocalStack(target, runCommand) {
  const database = inspectStackContainer(target.database.name, target.projectId, 5432, target.dbPort, runCommand);
  const api = inspectStackContainer(target.api.name, target.projectId, 8000, target.apiPort, runCommand);
  if (database.id !== target.database.id) throw new Error("database container changed after admission");
  if (api.id !== target.api.id) throw new Error("API container changed after admission");
}

export function captureLocalSnapshot(target, runCommand = run) {
  assertAdmittedLocalStack(target, runCommand);
  const result = runCommand(
    "docker",
    [
      "exec",
      "--env",
      "PGOPTIONS=-c default_transaction_read_only=on -c statement_timeout=5000 -c lock_timeout=1000 -c idle_in_transaction_session_timeout=5000",
      target.database.id,
      "psql",
      "-X",
      "-v",
      "ON_ERROR_STOP=1",
      "-U",
      "postgres",
      "-d",
      "postgres",
      "-Atc",
      IDENTITY_SNAPSHOT_SQL,
    ],
    { maxBuffer: SNAPSHOT_MAX_BUFFER_BYTES },
  );
  if (result.error) {
    throw new Error(`identity snapshot spawn failed: ${result.error.code ?? "unknown"}`);
  }
  if (result.status !== 0) {
    throw new Error(`identity snapshot failed: ${result.stderr.trim()}`);
  }
  assertAdmittedLocalStack(target, runCommand);
  return parseIdentitySnapshot(result.stdout);
}

function counts(snapshot) {
  return Object.fromEntries(
    TRACKED_IDENTITY_TABLES.map((table) => [table, snapshot[table].length]),
  );
}

function runCli() {
  const separator = process.argv.indexOf("--");
  const child = separator >= 0 ? process.argv.slice(separator + 1) : [];
  if (child.length === 0) {
    console.error(
      "Usage: node scripts/run-live-test-conservation.mjs -- <command> [args...]",
    );
    process.exitCode = 2;
    return;
  }

  const missingEnvironment = missingLiveEnvironment(process.env);
  if (missingEnvironment.length > 0) {
    console.error(`Missing required local live environment: ${missingEnvironment.join(", ")}`);
    process.exitCode = 2;
    return;
  }

  let configText;
  try {
    configText = readFileSync("supabase/config.toml", "utf8");
    assertConservationApiUrl(process.env.NEXT_PUBLIC_SUPABASE_URL, configText);
  } catch (error) {
    console.error(`local target admission failed: ${errorMessage(error)}`);
    process.exitCode = 2;
    return;
  }

  const guard = run("bash", ["scripts/local/assert-local-db.sh"]);
  if (guard.error) {
    console.error(`local guard spawn failed: ${guard.error.code ?? "unknown"}`);
    process.exitCode = 2;
    return;
  }
  if (guard.status !== 0) {
    process.stderr.write(guard.stderr);
    process.exitCode = 2;
    return;
  }
  process.stdout.write(guard.stdout);

  let target;
  try {
    target = admitLocalStack(configText);
  } catch (error) {
    console.error(`local stack admission failed: ${errorMessage(error)}`);
    process.exitCode = 2;
    return;
  }

  const result = runConservationOrchestration({
    captureSnapshot: () => captureLocalSnapshot(target),
    runChild: () => run(child[0], child.slice(1), {
      stdio: "inherit",
      env: liveChildEnvironment(process.env),
    }),
  });
  if (result.before) console.log(`identity baseline: ${JSON.stringify(counts(result.before))}`);
  if (result.after) console.log(`identity final: ${JSON.stringify(counts(result.after))}`);
  if (result.preCaptureFailure) {
    console.error(`identity baseline capture failed: ${result.preCaptureFailure}`);
  }
  if (result.postCaptureFailure) {
    console.error(`identity final capture failed: ${result.postCaptureFailure}`);
  }
  if (result.drift.length > 0) {
    console.error(`identity conservation drift: ${JSON.stringify(result.drift)}`);
  } else if (!result.preCaptureFailure && !result.postCaptureFailure) {
    console.log("identity conservation: PASS");
  }
  if (result.childFailure) {
    console.error(`child failure: ${result.childFailure}`);
  }
  process.exitCode = result.exitCode;
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) runCli();
