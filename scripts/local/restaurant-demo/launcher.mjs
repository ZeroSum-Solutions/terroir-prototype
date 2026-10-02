#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { cp, lstat, mkdir, readFile, readdir, readlink, realpath, writeFile } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { admitLocalDockerDaemon, assertCleanupAdmitted, assertDockerSocketIdentity, assertNamespaceAbsent, cleanupOwnedStack, createOwnedNetwork, namespaceResources, readDockerInventory, recordOwnedStack } from "./docker-lifecycle.mjs";

export const EXECUTION_ACK = "I_ACKNOWLEDGE_DISPOSABLE_RESTAURANT_DEMO";
const PROJECT_ID = /^terroir-demo-[a-z0-9][a-z0-9-]{2,40}$/;
const EMAIL = /^[a-z0-9][a-z0-9.+_-]*@terroir\.test$/i;
const OWNERSHIP_MARKER = ".terroir-demo-owned.json";
let admittedDockerDaemon;

export function parseLauncherArgs(argv) {
  const values = new Map();
  let execute = false;
  for (const raw of argv) {
    if (raw === "--execute") { execute = true; continue; }
    const match = raw.match(/^--([^=]+)=(.+)$/);
    assert(match, `invalid argument: ${raw}`);
    assert(!values.has(match[1]), `duplicate argument: --${match[1]}`);
    values.set(match[1], match[2]);
  }
  const required = [
    "source-root", "runtime-root", "evidence-dir", "project-id", "api-port",
    "db-port", "shadow-port", "studio-port", "mail-port", "app-port",
    "owner-email", "staff-email",
  ];
  const allowed = new Set([...required, "ack", "journey-width"]);
  for (const key of values.keys()) assert(allowed.has(key), `unknown argument: --${key}`);
  for (const key of required) assert(values.has(key), `missing argument: --${key}=...`);
  const ports = Object.fromEntries(
    ["api", "db", "shadow", "studio", "mail", "app"].map((name) => {
      const value = Number(values.get(`${name}-port`));
      assert(Number.isSafeInteger(value) && value >= 1024 && value <= 65535, `${name} port must be 1024-65535`);
      return [name, value];
    }),
  );
  assert.equal(new Set(Object.values(ports)).size, Object.keys(ports).length, "demo ports must be unique");
  const result = {
    sourceRoot: path.resolve(values.get("source-root")),
    runtimeRoot: path.resolve(values.get("runtime-root")),
    evidenceDir: path.resolve(values.get("evidence-dir")),
    projectId: values.get("project-id"),
    ownerEmail: values.get("owner-email"),
    staffEmail: values.get("staff-email"),
    ack: values.get("ack"), execute, ports,
    journeyWidth: Number(values.get("journey-width") ?? 390),
  };
  assert([390, 1200].includes(result.journeyWidth), "journey width must be 390 or 1200");
  assert(PROJECT_ID.test(result.projectId), "project ID must use the terroir-demo-* disposable namespace");
  assert(EMAIL.test(result.ownerEmail), "owner email must be synthetic @terroir.test");
  assert(EMAIL.test(result.staffEmail), "staff email must be synthetic @terroir.test");
  assert.notEqual(result.ownerEmail.toLowerCase(), result.staffEmail.toLowerCase(), "synthetic emails must be distinct");
  for (const [label, target] of [["runtime", result.runtimeRoot], ["evidence", result.evidenceDir]]) {
    assert(path.isAbsolute(values.get(label === "runtime" ? "runtime-root" : "evidence-dir")), `${label} directory must be absolute`);
    assert(/^terroir-demo-[a-z0-9][a-z0-9-]+$/i.test(path.basename(target)), `${label} directory must be a dedicated terroir-demo-* leaf`);
    assert(!isInside(result.sourceRoot, target), `${label} directory must be outside the source checkout`);
    assert(!isInside(target, result.sourceRoot), `${label} directory must not contain the source checkout`);
  }
  assert(!isInside(result.runtimeRoot, result.evidenceDir), "evidence directory must survive runtime cleanup");
  assert(!isInside(result.evidenceDir, result.runtimeRoot), "runtime directory must not be inside evidence");
  if (execute) {
    assert.equal(result.ack, EXECUTION_ACK, "exact disposable execution acknowledgement required");
  } else {
    assert.equal(result.ack, undefined, "dry-run does not accept an execution acknowledgement");
  }
  return result;
}

export function assertSafeSourcePath(relativePath) {
  assert(typeof relativePath === "string" && relativePath.length > 0, "source path is empty");
  assert(!path.isAbsolute(relativePath) && !relativePath.includes("\\"), "source path must be relative POSIX syntax");
  const parts = relativePath.split("/");
  assert(parts.every((part) => part && part !== "." && part !== ".."), "source path traversal refused");
  assert(!parts.some((part) => part === ".git" || part === "node_modules" || part === ".tmp"), "local/runtime source path refused");
  assert(!parts.some((part) => part === ".env" || part.startsWith(".env.")), "dotenv source path refused");
  assert(!parts.includes(OWNERSHIP_MARKER), "runtime ownership marker cannot come from source");
  return relativePath;
}

export function rewriteSupabaseConfig(raw, settings) {
  let next = raw;
  next = replaceTomlValue(next, "", "project_id", `"${settings.projectId}"`);
  next = replaceTomlValue(next, "api", "port", String(settings.ports.api));
  next = replaceTomlValue(next, "db", "port", String(settings.ports.db));
  next = replaceTomlValue(next, "db", "shadow_port", String(settings.ports.shadow));
  next = replaceTomlValue(next, "studio", "port", String(settings.ports.studio));
  next = replaceTomlValue(next, "local_smtp", "port", String(settings.ports.mail));
  next = replaceTomlValue(next, "db.seed", "enabled", "false");
  next = replaceTomlValue(next, "db.migrations", "enabled", "false");
  next = replaceTomlValue(next, "auth", "site_url", `"http://127.0.0.1:${settings.ports.app}"`);
  next = replaceTomlValue(
    next,
    "auth",
    "additional_redirect_urls",
    `["http://127.0.0.1:${settings.ports.app}", "http://127.0.0.1:${settings.ports.app}/**"]`,
  );
  return next;
}

export function parseLocalStatus(raw, settings) {
  let value;
  try { value = JSON.parse(raw); } catch { throw new Error("Supabase status JSON is malformed"); }
  const api = strictLoopbackUrl(value.API_URL, settings.ports.api, ["http:"]);
  const database = strictLoopbackUrl(value.DB_URL, settings.ports.db, ["postgres:", "postgresql:"]);
  assert(database.pathname === "/postgres", "isolated Supabase database must be postgres");
  for (const key of ["PUBLISHABLE_KEY", "SERVICE_ROLE_KEY"]) {
    assert(typeof value[key] === "string" && value[key].length >= 20, `Supabase status missing ${key}`);
  }
  return { apiURL: api.origin, databaseURL: database.toString(), publishableKey: value.PUBLISHABLE_KEY, serviceRoleKey: value.SERVICE_ROLE_KEY };
}

function strictLoopbackUrl(raw, port, protocols) {
  assert(typeof raw === "string", "local URL missing");
  const parsed = new URL(raw);
  assert(protocols.includes(parsed.protocol), "local URL protocol refused");
  assert.equal(parsed.hostname, "127.0.0.1", "local URL must use exact IPv4 loopback");
  assert.equal(Number(parsed.port), port, "local URL port drifted");
  assert.equal(parsed.search, "", "local URL query refused");
  assert.equal(parsed.hash, "", "local URL fragment refused");
  return parsed;
}

function replaceTomlValue(raw, wantedSection, key, replacement) {
  const lines = raw.split("\n");
  let section = "";
  let matches = 0;
  const output = lines.map((line) => {
    const heading = line.match(/^\[([^\]]+)]\s*$/);
    if (heading) { section = heading[1]; return line; }
    if (section !== wantedSection || !new RegExp(`^${key.replaceAll("_", "[_]")}\\s*=`).test(line)) return line;
    matches += 1;
    return `${key} = ${replacement}`;
  });
  assert.equal(matches, 1, `config must contain exactly one [${wantedSection}] ${key}`);
  return output.join("\n");
}

function isInside(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

export async function admitDestinationPaths(settings) {
  const sourceRoot = await realpath(settings.sourceRoot);
  for (const key of ["runtimeRoot", "evidenceDir"]) {
    const target = settings[key];
    const canonical = path.join(await realpath(path.dirname(target)), path.basename(target));
    assert(!isInside(sourceRoot, canonical) && !isInside(canonical, sourceRoot), "destination aliases the source checkout");
    try { await lstat(canonical); assert.fail("demo destination already exists"); }
    catch (error) { if (error?.code !== "ENOENT") throw error; }
    settings[key] = canonical;
  }
  assert(!isInside(settings.runtimeRoot, settings.evidenceDir) && !isInside(settings.evidenceDir, settings.runtimeRoot), "demo destination aliases overlap");
  settings.sourceRoot = sourceRoot;
}

function minimalEnvironment(extra = {}) {
  const base = {};
  for (const key of ["HOME", "PATH", "TMPDIR", "DOCKER_CONFIG"]) {
    if (process.env[key]) base[key] = process.env[key];
  }
  return { ...base, OPENAI_API_KEY: "local-demo-disabled", ...extra, pnpm_config_verify_deps_before_run: "false", ...(admittedDockerDaemon ? { DOCKER_HOST: admittedDockerDaemon.endpoint } : {}) };
}

function run(command, args, options = {}) {
  if (admittedDockerDaemon && (command === "docker" || args.includes("supabase"))) assertDockerSocketIdentity(admittedDockerDaemon);
  try {
    return execFileSync(command, args, {
      cwd: options.cwd,
      env: options.env ?? minimalEnvironment(),
      input: options.input,
      encoding: "utf8",
      timeout: options.timeout ?? 300_000,
      maxBuffer: 30_000_000,
      stdio: [options.input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
    }).trim();
  } catch {
    throw new Error(`${path.basename(command)} failed without exposing child output`);
  }
}

async function materializeRuntime(settings) {
  await mkdir(settings.runtimeRoot, { mode: 0o700 });
  const marker = { version: 2, projectId: settings.projectId, executionId: settings.executionId, runtimeRoot: settings.runtimeRoot };
  await writeFile(path.join(settings.runtimeRoot, OWNERSHIP_MARKER), `${JSON.stringify(marker)}\n`, { flag: "wx", mode: 0o600 });
  const identity = await lstat(settings.runtimeRoot);
  // Omit even tracked dotenv examples without opening them; none may enter runtime.
  const listed = run("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], { cwd: settings.sourceRoot }).split("\0").filter((relative) => relative && !relative.split("/").some((part) => part === ".env" || part.startsWith(".env.")));
  assert(listed.length > 0, "source checkout is empty");
  for (const raw of listed) {
    const relative = assertSafeSourcePath(raw);
    const source = path.join(settings.sourceRoot, relative);
    const metadata = await lstat(source);
    assert(metadata.isFile() && !metadata.isSymbolicLink(), `source entry must be a regular file: ${relative}`);
    const destination = path.join(settings.runtimeRoot, relative);
    await mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
    await cp(source, destination, { preserveTimestamps: true });
  }
  await materializeDependencies(settings.sourceRoot, settings.runtimeRoot);
  const configPath = path.join(settings.runtimeRoot, "supabase/config.toml");
  const rewritten = rewriteSupabaseConfig(await readFile(configPath, "utf8"), settings);
  await writeFile(configPath, rewritten, { mode: 0o600 });
  await assertRuntimeHasNoDotenv(settings.runtimeRoot);
  return { sourceFiles: listed.length, configPath, marker, dev: identity.dev, ino: identity.ino };
}

export async function assertContainedDependencyLinks(root) {
  const canonical = await realpath(root);
  assert((await lstat(canonical)).isDirectory(), "dependencies must be a directory");
  const pending = [canonical];
  while (pending.length > 0) {
    const directory = pending.pop();
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      assert(entry.name !== ".env" && !entry.name.startsWith(".env."), "dotenv dependency file refused before copying");
      const target = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        assert(!path.isAbsolute(await readlink(target)), "absolute dependency symlink refused");
        assert(isInside(canonical, await realpath(target)), "dependency symlink escapes node_modules");
      } else if (entry.isDirectory()) pending.push(target);
    }
  }
}

export async function materializeDependencies(sourceRoot, runtimeRoot) {
  const source = await realpath(path.join(sourceRoot, "node_modules"));
  await assertContainedDependencyLinks(source);
  const destination = path.join(runtimeRoot, "node_modules");
  await cp(source, destination, { recursive: true, verbatimSymlinks: true, mode: constants.COPYFILE_FICLONE });
  const metadata = await lstat(destination);
  assert(metadata.isDirectory() && !metadata.isSymbolicLink(), "runtime dependencies must be contained, not a root symlink");
  await assertContainedDependencyLinks(destination);
}

async function assertRuntimeHasNoDotenv(root) {
  const listed = run("find", [root, "-type", "f", "-name", ".env*", "-print"], { timeout: 30_000 });
  assert.equal(listed, "", "runtime materialization contains a dotenv file");
}

function inspectAdmittedStack(settings) {
  const configText = run("cat", [path.join(settings.runtimeRoot, "supabase/config.toml")]);
  const modulePath = path.join(settings.runtimeRoot, "scripts/run-live-test-conservation.mjs");
  return import(pathToFileURL(modulePath).href).then(({ parseLocalStackConfig, admitLocalStack }) => {
    const config = parseLocalStackConfig(configText);
    assert.deepEqual(config, { projectId: settings.projectId, apiPort: settings.ports.api, dbPort: settings.ports.db });
    // Its default subprocess runner inherits the host environment; inject our
    // pinned local-daemon runner rather than allowing a second context lookup.
    const target = admitLocalStack(configText, (command, args) => ({ status: 0, stdout: run(command, args), stderr: "" }));
    assertExactLoopbackBinding(target.database.id, 5432, settings.ports.db);
    assertExactLoopbackBinding(target.api.id, 8000, settings.ports.api);
    return target;
  });
}

function assertExactLoopbackBinding(containerId, internalPort, hostPort) {
  const inspected = JSON.parse(run("docker", ["inspect", containerId]));
  assert(Array.isArray(inspected) && inspected.length === 1, "container binding identity is ambiguous");
  const bindings = inspected[0]?.NetworkSettings?.Ports?.[`${internalPort}/tcp`];
  assert.deepEqual(bindings, [{ HostIp: "127.0.0.1", HostPort: String(hostPort) }], "container port is not exact loopback");
}

async function createSyntheticUsers(local, settings) {
  const admin = createClient(local.apiURL, local.serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const ownerPassword = randomBytes(24).toString("base64url");
  const staffPassword = randomBytes(24).toString("base64url");
  const owner = await admin.auth.admin.createUser({ email: settings.ownerEmail, password: ownerPassword, email_confirm: true, user_metadata: { restaurant_name: "Portable Restaurant Demo" } });
  if (owner.error || !owner.data.user) throw new Error("synthetic owner creation failed");
  const staff = await admin.auth.admin.createUser({ email: settings.staffEmail, password: staffPassword, email_confirm: true, user_metadata: { restaurant_name: "Disposable Staff Bootstrap" } });
  if (staff.error || !staff.data.user) throw new Error("synthetic staff creation failed");
  const membership = await admin.from("memberships").select("restaurant_id").eq("user_id", owner.data.user.id).eq("role", "owner").single();
  if (membership.error || !membership.data) throw new Error("synthetic owner membership bootstrap failed");
  return { admin, ownerId: owner.data.user.id, staffId: staff.data.user.id, restaurantId: membership.data.restaurant_id, ownerPassword, staffPassword };
}

function applyFixture(settings, target, users, ids) {
  const fixture = run("cat", [path.join(settings.runtimeRoot, "scripts/local/restaurant-demo/fixture.sql")]);
  const variables = {
    expected_database: "postgres", owner_id: users.ownerId, owner_email: settings.ownerEmail,
    staff_id: users.staffId, staff_email: settings.staffEmail, restaurant_id: users.restaurantId,
    other_restaurant_id: ids.otherRestaurantId, wine_id: ids.wineId, staff_wine_id: ids.staffWineId,
    bin_id: ids.binId, list_id: ids.listId, section_id: ids.sectionId,
    item_id: ids.itemId, staff_item_id: ids.staffItemId, list_slug: ids.listSlug,
  };
  const args = ["exec", "-i", target.database.id, "psql", "-X", "-qAt", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "postgres"];
  for (const [name, value] of Object.entries(variables)) args.push("-v", `${name}=${value}`);
  const output = run("docker", args, { input: fixture });
  const receipt = JSON.parse(output.split("\n").at(-1));
  assert.equal(receipt.inventorySeedCount, 0);
  assert.equal(receipt.restaurantId, users.restaurantId);
  return receipt;
}

function fixtureIds(projectId) {
  return {
    otherRestaurantId: randomUUID(), wineId: randomUUID(), staffWineId: randomUUID(),
    binId: randomUUID(), listId: randomUUID(), sectionId: randomUUID(), itemId: randomUUID(),
    staffItemId: randomUUID(), listSlug: `${projectId}-${randomBytes(4).toString("hex")}`,
  };
}

async function waitForHealth(baseURL, child) {
  for (let attempt = 0; attempt < 90; attempt += 1) {
    if (child.exitCode !== null) throw new Error("local app exited before health admission");
    try {
      const response = await fetch(`${baseURL}/api/health`, { signal: AbortSignal.timeout(1_500) });
      const body = await response.json();
      if (response.status === 200 && body?.status === "ok" && body?.db === "connected") {
        assertOwnedAppListener(child, Number(new URL(baseURL).port));
        return;
      }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error("local app health admission timed out");
}

function assertOwnedAppListener(child, port) {
  const raw = run("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"], { timeout: 10_000 });
  const pids = raw.split(/\s+/).filter(Boolean).map(Number);
  assert(pids.length > 0 && pids.every((pid) => Number.isSafeInteger(pid) && pid > 1), "app listener PID admission failed");
  for (const pid of pids) {
    const pgid = Number(run("ps", ["-o", "pgid=", "-p", String(pid)], { timeout: 10_000 }).trim());
    assert.equal(pgid, child.pid, "app listener is outside the owned process group");
  }
}

async function assertPortsAbsent(ports) {
  for (const port of ports) {
    await new Promise((resolve, reject) => {
      const server = net.createServer();
      server.unref();
      server.once("error", () => reject(new Error(`required loopback port is occupied: ${port}`)));
      server.listen({ host: "127.0.0.1", port, exclusive: true }, () => server.close(resolve));
    });
  }
}

async function stopChild(child) {
  if (!child || !ownedProcessGroupExists(child)) return;
  signalOwnedProcessGroup(child, "SIGTERM");
  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    new Promise((resolve) => setTimeout(resolve, 10_000)),
  ]);
  if (ownedProcessGroupExists(child)) signalOwnedProcessGroup(child, "SIGKILL");
}

function signalOwnedProcessGroup(child, signal) {
  assert(Number.isSafeInteger(child.pid) && child.pid > 1, "owned app PID is invalid");
  try { process.kill(-child.pid, signal); } catch (error) {
    if (error?.code !== "ESRCH") throw error;
  }
}

function ownedProcessGroupExists(child) {
  try { process.kill(-child.pid, 0); return true; } catch (error) {
    if (error?.code === "ESRCH") return false;
    throw error;
  }
}

export async function assertOwnedRuntime(settings, owned) {
  const metadata = await lstat(settings.runtimeRoot);
  assert(metadata.isDirectory() && !metadata.isSymbolicLink(), "runtime cleanup refuses symlink/replaced root");
  assert.equal(await realpath(settings.runtimeRoot), settings.runtimeRoot, "runtime parent alias changed");
  assert.equal(metadata.dev, owned.dev, "runtime device identity changed");
  assert.equal(metadata.ino, owned.ino, "runtime inode identity changed");
  const marker = JSON.parse(await readFile(path.join(settings.runtimeRoot, OWNERSHIP_MARKER), "utf8"));
  assert.deepEqual(marker, owned.marker, "runtime cleanup ownership marker changed");
}

async function cleanupOwnedServices(settings, owned, ledger) {
  await assertOwnedRuntime(settings, owned);
  cleanupOwnedStack(ledger, run);
  await assertOwnedRuntime(settings, owned);
}

export function transactionalMigrationArgs(databaseId, filename) {
  assert(/^[a-f0-9]{64}$/.test(databaseId), "migration database identity is invalid");
  const matched = filename.match(/^([0-9]{4})_([a-z0-9_]+)\.sql$/);
  assert(matched, "migration filename refused");
  const [, version, name] = matched;
  return ["exec", "-i", databaseId, "psql", "-X", "-v", "ON_ERROR_STOP=1", "--single-transaction", "-q", "-U", "postgres", "-d", "postgres", "-f", "-", "-c", `insert into supabase_migrations.schema_migrations(version,name) values ('${version}','${name}');`];
}

async function applySourceMigrations(settings, target, ledger) {
  const databaseId = target.database.id;
  const query = ["exec", "-i", databaseId, "psql", "-X", "-v", "ON_ERROR_STOP=1", "-qAt", "-U", "postgres", "-d", "postgres"];
  assertCleanupAdmitted(ledger, readDockerInventory(run));
  assert.equal(run("docker", [...query, "-c", "select to_regclass('supabase_migrations.schema_migrations') is not null"]), "f", "migration target is not empty");
  run("docker", [...query, "--single-transaction", "-c", "create schema supabase_migrations; create table supabase_migrations.schema_migrations (version text primary key, statements text[], name text, created_by text, idempotency_key text, rollback text[]);"]);
  const directory = path.join(settings.runtimeRoot, "supabase/migrations");
  const filenames = (await readdir(directory)).filter((filename) => /^[0-9].*\.sql$/.test(filename)).sort();
  assert.equal(filenames.at(-1), "0164_import_revert_cleanup.sql", "portable migration ceiling must be reviewed 0164");
  for (const filename of filenames) {
    const sql = await readFile(path.join(directory, filename), "utf8");
    assert(!/^\s*(?:begin|commit)\s*;/im.test(sql), "migration owns a conflicting transaction");
    assert(!/^\s*create\s+(?:unique\s+)?index\s+concurrently/im.test(sql), "concurrent index cannot use migration transaction");
    assertCleanupAdmitted(ledger, readDockerInventory(run));
    const version = filename.slice(0, 4);
    if (["0156", "0157", "0158"].includes(version)) {
      const preflight = await readFile(path.join(settings.runtimeRoot, `scripts/${version}-production-preflight.sql`), "utf8");
      run("docker", [...query, ...(version === "0158" ? ["-v", "bottle_route_drained=1"] : [])], { input: preflight });
    }
    run("docker", transactionalMigrationArgs(databaseId, filename), { input: sql });
    if (["0156", "0157", "0158"].includes(version)) {
      run("docker", query, { input: await readFile(path.join(settings.runtimeRoot, `scripts/${version}-production-postflight.sql`), "utf8") });
    }
    process.stderr.write(`portable demo: applied local migration ${version}\n`);
  }
  assert.equal(run("docker", [...query, "-c", "select count(*) || '/' || max(version) from supabase_migrations.schema_migrations"]), `${filenames.length}/0164`, "portable migration ledger mismatch");
  run("docker", [...query, "-c", "notify pgrst, 'reload schema'"]);
  return filenames.length;
}

async function execute(settings) {
  let app;
  let ownedRuntime;
  let ledger;
  settings.executionId = randomUUID();
  const result = { status: "failed", lastCompletedStep: "source-admission", projectId: settings.projectId };
  await mkdir(settings.evidenceDir, { mode: 0o700 });
  const resultPath = path.join(settings.evidenceDir, "launcher-result.json");
  await writeFile(resultPath, `${JSON.stringify(result, null, 2)}\n`, { flag: "wx", mode: 0o600 });
  let thrown;
  try {
    // Inspect with the same stripped environment, then pin every child to that
    // admitted Unix endpoint rather than trusting a mutable Docker context.
    admittedDockerDaemon = admitLocalDockerDaemon(run);
    result.lastCompletedStep = "local-docker-daemon-admitted";
    await assertPortsAbsent(Object.values(settings.ports));
    assertNamespaceAbsent(settings.projectId, readDockerInventory(run));
    result.lastCompletedStep = "requested-ports-admitted-absent";
    const materialized = await materializeRuntime(settings);
    ownedRuntime = materialized;
    result.lastCompletedStep = "safe-runtime-materialized";
    result.sourceFiles = materialized.sourceFiles;
    const network = createOwnedNetwork(settings.projectId, settings.executionId, run);
    result.networkId = network.id;
    result.lastCompletedStep = "owned-loopback-network-created";
    run("pnpm", ["exec", "supabase", "start", "--workdir", settings.runtimeRoot, "--network-id", network.name, "--exclude", "studio,imgproxy,edge-runtime,realtime,analytics,logflare,vector,supavisor"], { cwd: settings.runtimeRoot, timeout: 900_000 });
    ledger = recordOwnedStack({ ...settings, network }, readDockerInventory(run));
    await writeFile(path.join(settings.evidenceDir, "docker-ownership.json"), `${JSON.stringify(ledger, null, 2)}\n`, { flag: "wx", mode: 0o600 });
    const local = parseLocalStatus(run("pnpm", ["exec", "supabase", "status", "--workdir", settings.runtimeRoot, "-o", "json"], { cwd: settings.runtimeRoot }), settings);
    const target = await inspectAdmittedStack(settings);
    result.databaseContainerId = target.database.id;
    result.lastCompletedStep = "isolated-stack-admitted";
    result.migrationCount = await applySourceMigrations(settings, target, ledger);
    result.lastCompletedStep = "transactional-migrations-applied";
    const users = await createSyntheticUsers(local, settings);
    result.lastCompletedStep = "synthetic-auth-created";
    const ids = fixtureIds(settings.projectId);
    const fixture = applyFixture(settings, target, users, ids);
    result.lastCompletedStep = "zero-stock-fixture-applied";
    const baseURL = `http://127.0.0.1:${settings.ports.app}`;
    const ready = {
      version: 1, result: "READY_FOR_PORTABLE_JOURNEY", projectId: settings.projectId,
      baseURL, database: "postgres", databaseContainerId: target.database.id,
      apiURL: local.apiURL, ownerEmail: settings.ownerEmail, staffEmail: settings.staffEmail,
      ownerId: users.ownerId, staffId: users.staffId, ...fixture,
    };
    const readyPath = path.join(settings.evidenceDir, "ready.json");
    await writeFile(readyPath, `${JSON.stringify(ready, null, 2)}\n`, { flag: "wx", mode: 0o600 });
    app = spawn("scripts/local/dev-local.sh", [`--port=${settings.ports.app}`, "--hostname=127.0.0.1"], {
      cwd: settings.runtimeRoot,
      env: minimalEnvironment({ ACTIVE_RESTAURANT_COOKIE_SECRET: randomBytes(32).toString("hex") }),
      stdio: ["ignore", "ignore", "ignore"],
      detached: true,
    });
    await waitForHealth(baseURL, app);
    result.lastCompletedStep = "local-app-admitted";
    const journeyOutput = run("node", [
      "scripts/local/restaurant-demo/journey.mjs",
      `--ready-json=${readyPath}`,
      `--project-root=${settings.runtimeRoot}`,
      `--evidence-dir=${path.join(settings.evidenceDir, "journey")}`,
      `--viewport-width=${settings.journeyWidth}`,
    ], {
      cwd: settings.runtimeRoot,
      timeout: 1_800_000,
      env: minimalEnvironment({
        TERROIR_DEMO_OWNER_PASSWORD: users.ownerPassword,
        TERROIR_DEMO_STAFF_PASSWORD: users.staffPassword,
      }),
    });
    const journey = JSON.parse(journeyOutput.split("\n").at(-1));
    assert.equal(journey.status, "passed", "portable browser journey did not pass");
    result.status = "passed";
    result.lastCompletedStep = "portable-journey-passed";
  } catch (error) {
    result.status = "failed";
    result.error = `${error instanceof assert.AssertionError ? "AssertionError" : "LauncherError"} at ${result.lastCompletedStep}`;
    thrown = error;
  } finally {
    try { await stopChild(app); } catch {
      result.status = "failed";
      result.error = `AppCleanupError at ${result.lastCompletedStep}`;
      thrown ??= new Error("owned app cleanup failed");
    }
    try {
      // Failed runs retain even partially created resources and mutation latches.
      if (!thrown && ownedRuntime && ledger) await cleanupOwnedServices(settings, ownedRuntime, ledger);
      // Goal safety freezes directory deletion outside the source checkout.
      result.runtimePreserved = true;
    } catch {
      result.status = "failed";
      result.error = `CleanupError at ${result.lastCompletedStep}`;
      thrown ??= new Error("owned runtime cleanup failed");
      result.runtimePreserved = true;
    }
    if (result.runtimePreserved) {
      try {
        const observed = namespaceResources(settings.projectId, readDockerInventory(run));
        await writeFile(path.join(settings.evidenceDir, "preserved-docker-observation.json"), `${JSON.stringify({ ownedForCleanup: false, resources: observed }, null, 2)}\n`, { flag: "wx", mode: 0o600 });
      } catch { result.preservedResourceObservationUnavailable = true; }
    }
    await writeFile(resultPath, `${JSON.stringify(result, null, 2)}\n`, { mode: 0o600 });
  }
  if (thrown) throw thrown;
}

async function main() {
  const settings = parseLauncherArgs(process.argv.slice(2));
  await admitDestinationPaths(settings);
  const actualRoot = await realpath(settings.sourceRoot);
  const gitRoot = run("git", ["rev-parse", "--show-toplevel"], { cwd: actualRoot });
  assert.equal(actualRoot, gitRoot, "source root must be the exact Git checkout root");
  await lstat(path.join(actualRoot, "scripts/local/dev-local.sh"));
  await lstat(path.join(actualRoot, "supabase/migrations/0164_import_revert_cleanup.sql"));
  if (!settings.execute) {
    process.stdout.write(`${JSON.stringify({ status: "SOURCE_ONLY_UNEXECUTED", executionReady: true, projectId: settings.projectId, ports: settings.ports })}\n`);
    return;
  }
  await execute(settings);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof assert.AssertionError ? "portable launcher assertion failed" : "portable launcher failed"}\n`);
    process.exitCode = 1;
  });
}
