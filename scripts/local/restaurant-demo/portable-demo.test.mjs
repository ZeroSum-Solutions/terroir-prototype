import assert from "node:assert/strict";
import { lstat, mkdir, mkdtemp, readFile, readlink, realpath, rename, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import test from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  EXECUTION_ACK,
  admitDestinationPaths,
  assertContainedDependencyLinks,
  assertOwnedRuntime,
  assertSafeSourcePath,
  parseLauncherArgs,
  parseLocalStatus,
  materializeDependencies,
  rewriteSupabaseConfig,
  transactionalMigrationArgs,
} from "./launcher.mjs";
import { PRESERVED_D, PRESERVED_D_CONTINUATION_ACK } from "./preserved-d-continuation.mjs";
import { RAW_PROJECT_LABELS, admitLocalDockerDaemon, assertCleanupAdmitted, assertDockerSocketIdentity, assertNamespaceAbsent, cleanupOwnedStack, createOwnedNetwork, parseLocalDockerEndpoint, readDockerInventory, readProjectDockerInventory, recordOwnedStack } from "./docker-lifecycle.mjs";
import { parseJourneyArgs, safeErrorKind } from "./journey.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const baseArgs = [
  "--source-root=/tmp/terroir-source",
  "--runtime-root=/tmp/terroir-demo-runtime",
  "--evidence-dir=/tmp/terroir-demo-evidence",
  "--project-id=terroir-demo-portable-a",
  "--api-port=61321",
  "--db-port=61322",
  "--shadow-port=61320",
  "--studio-port=61323",
  "--mail-port=61324",
  "--app-port=3102",
  "--owner-email=owner+portable@terroir.test",
  "--staff-email=staff+portable@terroir.test",
];

test("launcher requires the disposable namespace, unique ports, and exact execution acknowledgement", () => {
  const dry = parseLauncherArgs(baseArgs);
  assert.equal(dry.execute, false);
  assert.equal(dry.bootstrapOnly, false);
  assert.equal(dry.projectId, "terroir-demo-portable-a");
  assert.equal(dry.journeyWidth, 390);
  assert.equal(parseLauncherArgs([...baseArgs, "--journey-width=1200"]).journeyWidth, 1200);
  assert.throws(() => parseLauncherArgs([...baseArgs, "--journey-width=320"]), /journey width/);
  assert.throws(() => parseLauncherArgs(baseArgs.map((value) => value.startsWith("--project-id=") ? "--project-id=production" : value)), /disposable namespace/);
  assert.throws(() => parseLauncherArgs(baseArgs.map((value) => value === "--db-port=61322" ? "--db-port=61321" : value)), /ports must be unique/);
  assert.throws(() => parseLauncherArgs([...baseArgs, "--execute"]), /acknowledgement/);
  assert.equal(parseLauncherArgs([...baseArgs, "--execute", `--ack=${EXECUTION_ACK}`]).execute, true);
  assert.throws(() => parseLauncherArgs([...baseArgs, "--bootstrap-only"]), /requires execution/);
  const bootstrap = parseLauncherArgs([...baseArgs, "--bootstrap-only", "--execute", `--ack=${EXECUTION_ACK}`]);
  assert.equal(bootstrap.bootstrapOnly, true);
});

test("preserved D continuation accepts only its exact target and externally pinned review chain", () => {
  const continuation = [
    `--source-root=${PRESERVED_D.sourceRoot}`,
    `--runtime-root=${PRESERVED_D.runtimeRoot}`,
    `--evidence-dir=${PRESERVED_D.bootstrapEvidenceRoot}-continuation`,
    `--project-id=${PRESERVED_D.projectId}`,
    ...Object.entries(PRESERVED_D.ports).map(([name, port]) => `--${name}-port=${port}`),
    `--owner-email=${PRESERVED_D.ownerEmail}`,
    `--staff-email=${PRESERVED_D.staffEmail}`,
    "--privacy-receipt=/tmp/privacy-apply-receipt.json",
    `--privacy-receipt-sha256=${"a".repeat(64)}`,
    `--privacy-migration-sha256=${"b".repeat(64)}`,
    `--privacy-review-sha256=${"c".repeat(64)}`,
    `--reviewed-launcher-sha256=${"d".repeat(64)}`,
    "--journey-width=390", "--continue-preserved-d", "--execute",
    `--ack=${PRESERVED_D_CONTINUATION_ACK}`,
  ];
  assert.equal(parseLauncherArgs(continuation).continuePreservedD, true);
  assert.throws(() => parseLauncherArgs(continuation.filter((arg) => !arg.startsWith("--privacy-receipt="))), /privacy receipt path/);
  assert.throws(() => parseLauncherArgs(continuation.map((arg) => arg.startsWith("--project-id=") ? "--project-id=terroir-demo-wrong-d" : arg)), /projectId changed/);
  assert.throws(() => parseLauncherArgs([...continuation, "--bootstrap-only"]), /mutually exclusive/);
  assert.throws(() => parseLauncherArgs([...baseArgs, "--privacy-receipt=/tmp/unreviewed.json"]), /requires preserved D continuation/);
});

test("source materialization refuses dotenv, traversal, Git, dependencies, and temp paths", () => {
  assert.equal(assertSafeSourcePath("src/app/page.tsx"), "src/app/page.tsx");
  for (const value of [".env.local", ".env", "../outside", ".git/config", "node_modules/a", ".tmp/output.json", "/absolute"]) {
    assert.throws(() => assertSafeSourcePath(value));
  }
});

test("Supabase config rewrite changes only the isolated project, ports, seed, and redirects", () => {
  const source = `project_id = "retained"\n[api]\nport = 1\n[db]\nport = 2\nshadow_port = 3\n[db.seed]\nenabled = true\n[db.migrations]\nenabled = true\n[studio]\nport = 4\n[local_smtp]\nport = 5\n[auth]\nsite_url = "http://127.0.0.1:3000"\nadditional_redirect_urls = []\n`;
  const settings = parseLauncherArgs(baseArgs);
  const output = rewriteSupabaseConfig(source, settings);
  assert.match(output, /project_id = "terroir-demo-portable-a"/);
  assert.match(output, /\[api]\nport = 61321/);
  assert.match(output, /\[db]\nport = 61322\nshadow_port = 61320/);
  assert.match(output, /\[db.seed]\nenabled = false/);
  assert.match(output, /\[db.migrations]\nenabled = false/);
  assert.match(output, /site_url = "http:\/\/127\.0\.0\.1:3102"/);
  assert.throws(() => rewriteSupabaseConfig(source.replace("[api]\nport = 1\n", "[api]\n"), settings), /exactly one/);
});

test("status admission accepts exact loopback ports and refuses hosted, query, or wrong database targets", () => {
  const settings = parseLauncherArgs(baseArgs);
  const valid = JSON.stringify({
    API_URL: "http://127.0.0.1:61321",
    DB_URL: "postgresql://postgres:local@127.0.0.1:61322/postgres",
    PUBLISHABLE_KEY: "publishable-local-value-123456",
    SERVICE_ROLE_KEY: "service-local-value-123456789",
  });
  assert.equal(parseLocalStatus(valid, settings).apiURL, "http://127.0.0.1:61321");
  assert.throws(() => parseLocalStatus(valid.replace("127.0.0.1:61321", "example.com:61321"), settings), /loopback/);
  assert.throws(() => parseLocalStatus(valid.replace("/postgres\"", "/other\""), settings), /must be postgres/);
  assert.throws(() => parseLocalStatus(valid.replace("/postgres\"", "/postgres?ssl=true\""), settings), /query refused/);
});

test("journey arguments are closed and errors serialize only a bounded kind", () => {
  const parsed = parseJourneyArgs([
    "--ready-json=/tmp/ready.json",
    "--project-root=/tmp/runtime",
    "--evidence-dir=/tmp/evidence",
    "--headed",
  ]);
  assert.equal(parsed.headed, true);
  assert.throws(() => parseJourneyArgs(["--ready-json=/tmp/a", "--project-root=/tmp/b", "--evidence-dir=/tmp/c", "--password=secret"]), /unknown argument/);
  assert.equal(safeErrorKind(Object.assign(new Error("contains a synthetic password"), { name: "TimeoutError" })), "TimeoutError");
  assert.equal(safeErrorKind("raw secret"), "JourneyError");
});

test("fixture is catalog-only and guards migration, contract, and zero mutable state", async () => {
  const fixture = await readFile(path.join(here, "fixture.sql"), "utf8");
  assert.match(fixture, /schema_migrations where version = '0164'/);
  assert.match(fixture, /current_inventory_contract_version\(\) <> 2/);
  assert.match(fixture, /zero mutable inventory and receipts/);
  assert.doesNotMatch(fixture, /insert into public\.(?:inventory_items|open_bottles|pour_events|inventory_command_receipts)/i);
  assert.match(fixture, /'inventorySeedCount', 0/);
  assert.match(fixture, /'commandReceiptSeedCount', 0/);
  assert.doesNotMatch(fixture, /min\(restaurant_id\)/);
});

test("portable sources keep runtime and browser targets loopback-only and never load dotenv", async () => {
  const launcher = await readFile(path.join(here, "launcher.mjs"), "utf8");
  const journey = await readFile(path.join(here, "journey.mjs"), "utf8");
  assert.match(launcher, /HostIp: "127\.0\.0\.1"/);
  assert.match(launcher, /--hostname=127\.0\.0\.1/);
  assert.match(launcher, /assertRuntimeHasNoDotenv/);
  assert.doesNotMatch(launcher, /(?:readFile|source|dotenv\.config)\([^\n]*\.env\.local/);
  assert.match(journey, /assert\.equal\(base\.hostname, "127\.0\.0\.1"\)/);
});

test("destination paths refuse broad roots, relative paths and containing/overlapping trees", () => {
  for (const target of ["/", "/tmp", os.homedir(), "/Users/zero/projects", "relative/terroir-demo-runtime", "/tmp/terroir-source/terroir-demo-runtime"]) {
    assert.throws(() => parseLauncherArgs(baseArgs.map((arg) => arg.startsWith("--runtime-root=") ? `--runtime-root=${target}` : arg)));
  }
  assert.throws(() => parseLauncherArgs(baseArgs.map((arg) => arg.startsWith("--evidence-dir=") ? "--evidence-dir=/tmp/terroir-demo-runtime/terroir-demo-evidence" : arg)), /survive runtime cleanup/);
  assert.throws(() => parseLauncherArgs(baseArgs.map((arg) => arg.startsWith("--runtime-root=") ? "--runtime-root=/tmp/terroir-demo-evidence/terroir-demo-runtime" : arg)), /inside evidence/);
});

test("realpath admission refuses source aliases and existing destinations without changing them", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "terroir-demo-path-test-"));
  try {
    const source = path.join(temp, "source");
    await mkdir(source);
    await symlink(source, path.join(temp, "alias"));
    const settings = { sourceRoot: source, runtimeRoot: path.join(temp, "alias", "terroir-demo-runtime"), evidenceDir: path.join(temp, "terroir-demo-evidence") };
    await assert.rejects(admitDestinationPaths(settings), /aliases the source/);
    settings.runtimeRoot = path.join(temp, "terroir-demo-runtime");
    await mkdir(settings.runtimeRoot);
    await assert.rejects(admitDestinationPaths(settings), /already exists/);
    assert.equal((await lstat(settings.runtimeRoot)).isDirectory(), true);
  } finally { await rm(temp, { recursive: true }); }
});

test("runtime cleanup admission refuses root replacement, symlinks and changed ownership marker", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "terroir-demo-identity-test-"));
  try {
    const runtimeRoot = path.join(temp, "terroir-demo-runtime");
    await mkdir(runtimeRoot);
    const canonicalRoot = await import("node:fs/promises").then(({ realpath }) => realpath(runtimeRoot));
    const marker = { version: 2, projectId: "terroir-demo-test-a", executionId: "a", runtimeRoot: canonicalRoot };
    const markerPath = path.join(canonicalRoot, ".terroir-demo-owned.json");
    await writeFile(markerPath, JSON.stringify(marker));
    const identity = await lstat(canonicalRoot);
    const owned = { marker, dev: identity.dev, ino: identity.ino };
    const settings = { runtimeRoot: canonicalRoot };
    await assertOwnedRuntime(settings, owned);
    await writeFile(markerPath, JSON.stringify({ ...marker, executionId: "different" }));
    await assert.rejects(assertOwnedRuntime(settings, owned), /marker changed/);
    await rename(canonicalRoot, `${canonicalRoot}-preserved`);
    await symlink(`${canonicalRoot}-preserved`, canonicalRoot);
    await assert.rejects(assertOwnedRuntime(settings, owned), /symlink\/replaced/);
    await rm(canonicalRoot);
    await mkdir(canonicalRoot);
    await assert.rejects(assertOwnedRuntime(settings, owned), /inode identity changed/);
  } finally { await rm(temp, { recursive: true }); }
});

test("contained dependency copy preserves relative package links without changing canonical files", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "terroir-demo-dependency-test-"));
  try {
    const sourceRoot = path.join(temp, "source");
    const runtimeRoot = path.join(temp, "runtime");
    await mkdir(path.join(sourceRoot, "node_modules", ".pnpm", "package"), { recursive: true });
    await mkdir(runtimeRoot);
    const original = path.join(sourceRoot, "node_modules", ".pnpm", "package", "index.js");
    await writeFile(original, "canonical dependency");
    await symlink(".pnpm/package", path.join(sourceRoot, "node_modules", "package"));
    const before = await lstat(original);
    await materializeDependencies(sourceRoot, runtimeRoot);
    const copied = path.join(runtimeRoot, "node_modules");
    assert.equal((await lstat(copied)).isSymbolicLink(), false);
    assert.equal(await readlink(path.join(copied, "package")), ".pnpm/package");
    assert.equal(await realpath(path.join(copied, "package")), path.join(await realpath(copied), ".pnpm", "package"));
    await writeFile(path.join(copied, "package", "index.js"), "disposable runtime change");
    assert.equal(await readFile(original, "utf8"), "canonical dependency");
    assert.equal((await lstat(original)).ino, before.ino);
    assert.equal((await lstat(original)).mode, before.mode);
  } finally { await rm(temp, { recursive: true }); }
});

test("dependency validation rejects absolute, relative escaping and dotenv entries before copy", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "terroir-demo-dependency-refusal-"));
  try {
    const dependencies = path.join(temp, "node_modules");
    await mkdir(dependencies);
    await writeFile(path.join(temp, "outside.js"), "outside the dependency tree");
    await symlink(path.join(temp, "outside.js"), path.join(dependencies, "absolute"));
    await assert.rejects(assertContainedDependencyLinks(dependencies), /absolute dependency symlink/);
    await rm(path.join(dependencies, "absolute"));
    await symlink("../outside.js", path.join(dependencies, "relative"));
    await assert.rejects(assertContainedDependencyLinks(dependencies), /escapes node_modules/);
    await rm(path.join(dependencies, "relative"));
    await writeFile(path.join(dependencies, ".env.local"), "synthetic refusal fixture");
    await assert.rejects(assertContainedDependencyLinks(dependencies), /dotenv dependency file refused/);
  } finally { await rm(temp, { recursive: true }); }
});

const projectId = "terroir-demo-portable-a";
const executionId = "12345678-1234-1234-1234-123456789abc";
const networkId = "1".repeat(64);
const ownershipLabels = { supabase: projectId, compose: projectId, execution: null };
function dockerFixture() {
  const volumeName = `supabase_db_${projectId}`;
  return {
    container: ["db", "kong"].map((service, index) => ({
      id: String(index + 2).repeat(64), name: `/supabase_${service}_${projectId}`, created: "2026-10-01T10:00:01.000000000Z", running: true,
      labels: { ...ownershipLabels }, networks: { own: { NetworkID: networkId } },
      mounts: service === "db" ? [{ Type: "volume", Name: volumeName }] : [],
      ports: { [service === "db" ? "5432/tcp" : "8000/tcp"]: [{ HostIp: "127.0.0.1", HostPort: service === "db" ? "61322" : "61321" }] },
    })),
    network: [{ id: networkId, name: `supabase_network_${projectId}`, created: "2026-10-01T10:00:00.000000000Z", labels: { ...ownershipLabels, execution: executionId }, driver: "bridge", binding: "127.0.0.1" }],
    volume: [{ name: volumeName, created: "2026-10-01T10:00:01Z", labels: { ...ownershipLabels } }],
  };
}

function addObservedExcludedEdgeRuntimeVolume(raw) {
  raw.volume.push({
    name: `supabase_edge_runtime_${projectId}`,
    created: "2026-10-01T10:00:02Z",
    labels: { ...ownershipLabels, execution: "" },
  });
}

function fakeDocker(raw, beforeCommand = () => {}) {
  const mutations = [];
  const run = (command, args) => {
    assert.equal(command, "docker");
    beforeCommand(args, raw);
    const [kind, action] = args;
    if (action === "ls") return raw[kind].map((resource) => resource.id ?? resource.name).join("\n");
    if (action === "inspect") {
      assert(!args[3].includes(".Config.Env"));
      return args.slice(4).map((id) => JSON.stringify(raw[kind].find((resource) => (resource.id ?? resource.name) === id))).join("\n");
    }
    if (kind === "network" && action === "create") {
      mutations.push(args);
      const network = dockerFixture().network[0];
      raw.network.push(network);
      return network.id;
    }
    assert.equal(action, "rm");
    mutations.push(args);
    const index = raw[kind].findIndex((resource) => (resource.id ?? resource.name) === args.at(-1));
    assert(index >= 0, "unknown removal target");
    raw[kind].splice(index, 1);
    return "";
  };
  return { run, mutations };
}

function admitFixture(raw, run) {
  const inventory = readDockerInventory(run);
  return recordOwnedStack({ projectId, executionId, network: inventory.network[0], ports: parseLauncherArgs(baseArgs).ports }, inventory);
}

test("project inventory uses raw project labels and inspects only the new namespace plus attachment users", () => {
  assert.deepEqual(RAW_PROJECT_LABELS, {
    supabase: "com.supabase.cli.project",
    compose: "com.docker.compose.project",
  });
  const raw = dockerFixture();
  const attachedId = "8".repeat(64);
  const retainedId = "9".repeat(64);
  const similarId = "6".repeat(64);
  raw.container.push({
    id: attachedId, name: "/foreign-attached", created: "2026-10-01T10:00:03.000000000Z", running: true,
    labels: { supabase: null, compose: null, execution: null }, networks: { own: { NetworkID: networkId } },
    mounts: [], ports: {},
  });
  raw.container.push({
    id: retainedId, name: "/supabase_db_terroir-demo-retained-c", created: "2026-10-01T09:00:00.000000000Z", running: true,
    labels: { supabase: "terroir-demo-retained-c", compose: "terroir-demo-retained-c", execution: null },
    networks: { retained: { NetworkID: "7".repeat(64) } }, mounts: [], ports: {},
  });
  raw.container.push({
    id: similarId, name: `/archive-${projectId}-copy`, created: "2026-10-01T09:30:00.000000000Z", running: true,
    labels: { supabase: "unrelated-project", compose: "unrelated-project", execution: null },
    networks: { unrelated: { NetworkID: "5".repeat(64) } }, mounts: [], ports: {},
  });
  const inspected = [];
  const expectedNameFormats = {
    container: "{{.ID}}\t{{.Names}}",
    network: "{{.ID}}\t{{.Name}}",
    volume: "{{.Name}}\t{{.Name}}",
  };
  const run = (command, args) => {
    assert.equal(command, "docker");
    const [kind, action] = args;
    if (action === "ls") {
      const filterAt = args.indexOf("--filter");
      assert(filterAt >= 0);
      const filter = args[filterAt + 1];
      if (filter === `name=${projectId}`) {
        assert(args.includes("--format"), "name discovery must return names before inspection");
        assert.equal(args.at(-1), expectedNameFormats[kind], `${kind} name discovery must use its documented Docker format fields`);
        if (kind === "container") assert(!args.at(-1).includes("{{.Name}}"), "container ls does not support singular .Name");
        else assert(!args.at(-1).includes("{{.Names}}"), `${kind} ls does not support plural .Names`);
        return raw[kind].filter((resource) => resource.name.includes(projectId)).map((resource) => `${resource.id ?? resource.name}\t${resource.name.replace(/^\//, "")}`).join("\n");
      }
      if (filter === `label=${RAW_PROJECT_LABELS.supabase}=${projectId}` || filter === `label=${RAW_PROJECT_LABELS.compose}=${projectId}`) {
        return raw[kind].filter((resource) => resource.labels.supabase === projectId || resource.labels.compose === projectId).map((resource) => resource.id ?? resource.name).join("\n");
      }
      if (kind === "container" && filter === `network=${networkId}`) return [raw.container[0].id, raw.container[1].id, attachedId].join("\n");
      if (kind === "container" && filter === `volume=supabase_db_${projectId}`) return raw.container[0].id;
      assert.fail(`unexpected Docker filter: ${kind} ${filter}`);
    }
    assert.equal(action, "inspect");
    const ids = args.slice(4);
    inspected.push(...ids);
    assert(!ids.includes(retainedId), "retained resource must never be inspected");
    assert(!ids.includes(similarId), "similarly named unrelated resource must be filtered before inspection");
    return ids.map((id) => JSON.stringify(raw[kind].find((resource) => (resource.id ?? resource.name) === id))).join("\n");
  };
  const inventory = readProjectDockerInventory(projectId, run);
  assert(inventory.container.some((resource) => resource.id === attachedId));
  assert(!inventory.container.some((resource) => resource.id === retainedId));
  assert(!inspected.includes(retainedId));
  assert(!inspected.includes(similarId));
  assert.throws(() => recordOwnedStack({ projectId, executionId, network: inventory.network[0], ports: parseLauncherArgs(baseArgs).ports }, inventory), /foreign container joined owned network/);
});

test("namespace absence catches stopped containers, foreign labels, orphan networks and volumes", () => {
  for (const kind of ["container", "network", "volume"]) {
    const raw = dockerFixture();
    const snapshot = readDockerInventory(fakeDocker(raw).run);
    const only = { container: [], network: [], volume: [], [kind]: snapshot[kind] };
    if (kind === "container") only.container[0].running = false;
    assert.throws(() => assertNamespaceAbsent(projectId, only), /already has resources/);
    only[kind][0].name = "foreign-named-resource";
    assert.throws(() => assertNamespaceAbsent(projectId, only), /already has resources/);
  }
});

test("daemon admission refuses remote or malformed endpoints before any Docker mutation", () => {
  for (const endpoint of ["tcp://127.0.0.1:2375", "ssh://remote", "https://docker.example.test", "unix://host/var/run/docker.sock", "unix:///var/run/docker.sock?x=1", "unix:///var/run/docker.sock#fragment", "unix:relative", "unix:///", "not a URL"]) {
    const commands = [];
    const run = (command, args) => { commands.push([command, ...args]); return JSON.stringify(endpoint); };
    assert.throws(() => admitLocalDockerDaemon(run, () => assert.fail("refused endpoint must not inspect local files")));
    assert.deepEqual(commands, [["docker", "context", "inspect", "--format", "{{json .Endpoints.docker.Host}}"]]);
  }
  assert.equal(parseLocalDockerEndpoint("unix:///var/run/docker.sock"), "/var/run/docker.sock");
  const admitted = admitLocalDockerDaemon(() => '"unix:///var/run/docker.sock"', () => ({ socketPath: "/private/var/run/docker.sock", dev: 1, ino: 2 }));
  assert.equal(admitted.endpoint, "unix:///private/var/run/docker.sock");
  assertDockerSocketIdentity(admitted, () => ({ socketPath: "/private/var/run/docker.sock", dev: 1, ino: 2 }));
  assert.throws(() => assertDockerSocketIdentity(admitted, () => ({ socketPath: "/private/var/run/docker.sock", dev: 1, ino: 3 })), /socket identity changed/);
});

test("network creation uses a fresh exact namespace, ownership labels and loopback binding", () => {
  const raw = { container: [], network: [], volume: [] };
  const fake = fakeDocker(raw);
  const network = createOwnedNetwork(projectId, executionId, fake.run);
  assert.equal(network.id, networkId);
  assert(fake.mutations[0].includes("com.docker.network.bridge.host_binding_ipv4=127.0.0.1"));
  assert(fake.mutations[0].includes(`com.terroir.demo.execution=${executionId}`));
  assert.throws(() => createOwnedNetwork(projectId, executionId, fake.run), /already has resources/);
  assert.equal(fake.mutations.length, 1);
});

test("stack admission refuses widened ports, foreign networks, labels and unattached volumes", () => {
  for (const mutate of [
    (raw) => { raw.container[0].ports["5432/tcp"][0].HostIp = "0.0.0.0"; },
    (raw) => { raw.container[0].ports["5432/tcp"][0].HostPort = "54322"; },
    (raw) => { raw.container[0].networks.foreign = { NetworkID: "9".repeat(64) }; },
    (raw) => { raw.container[0].labels.supabase = "retained"; },
    (raw) => { raw.container[0].mounts = []; },
  ]) {
    const raw = dockerFixture();
    mutate(raw);
    assert.throws(() => admitFixture(raw, fakeDocker(raw).run));
  }
});

test("stack admission accepts only the observed excluded edge-runtime cache volume", () => {
  const accepted = dockerFixture();
  addObservedExcludedEdgeRuntimeVolume(accepted);
  assert.doesNotThrow(() => admitFixture(accepted, fakeDocker(accepted).run));

  for (const mutate of [
    (raw) => { raw.volume.at(-1).name = `supabase_unknown_${projectId}`; },
    (raw) => { raw.volume.at(-1).created = "2026-10-01T09:59:59Z"; },
    (raw) => { raw.volume.at(-1).labels.execution = null; },
    (raw) => {
      const volumeName = raw.volume.at(-1).name;
      raw.container.push({
        id: "9".repeat(64), name: "/foreign-container", created: "2026-10-01T10:00:03.000000000Z", running: true,
        labels: { supabase: null, compose: null, execution: null }, networks: { bridge: { NetworkID: "8".repeat(64) } },
        mounts: [{ Type: "volume", Name: volumeName }], ports: {},
      });
    },
  ]) {
    const raw = dockerFixture();
    addObservedExcludedEdgeRuntimeVolume(raw);
    mutate(raw);
    assert.throws(() => admitFixture(raw, fakeDocker(raw).run));
  }
});

test("cache-volume admission compares Docker creation times at their shared second precision", () => {
  const raw = dockerFixture();
  raw.network[0].created = "2026-10-01T10:00:00.789Z";
  addObservedExcludedEdgeRuntimeVolume(raw);
  raw.volume.at(-1).created = "2026-10-01T10:00:00Z";
  assert.doesNotThrow(() => admitFixture(raw, fakeDocker(raw).run));
  raw.volume.at(-1).created = "2026-10-01T09:59:59Z";
  assert.throws(() => admitFixture(raw, fakeDocker(raw).run), /predates/);
});

test("cleanup records and removes the exact excluded edge-runtime cache volume", () => {
  const raw = dockerFixture();
  addObservedExcludedEdgeRuntimeVolume(raw);
  const fake = fakeDocker(raw);
  const ledger = admitFixture(raw, fake.run);
  cleanupOwnedStack(ledger, fake.run);
  assert.deepEqual(fake.mutations.slice(-2), [
    ["volume", "rm", `supabase_db_${projectId}`],
    ["volume", "rm", `supabase_edge_runtime_${projectId}`],
  ]);

  const changed = dockerFixture();
  addObservedExcludedEdgeRuntimeVolume(changed);
  const changedFake = fakeDocker(changed);
  const changedLedger = admitFixture(changed, changedFake.run);
  changed.volume.at(-1).created = "2026-10-01T10:00:04Z";
  assert.throws(() => cleanupOwnedStack(changedLedger, changedFake.run), /identities or labels changed/);
  assert.equal(changedFake.mutations.length, 0);
});

test("cleanup re-admission rejects changed resource identities, labels and new namespace resources", () => {
  for (const mutate of [
    (raw) => { raw.container[0].id = "8".repeat(64); },
    (raw) => { raw.container[0].labels.compose = "retained"; },
    (raw) => { raw.network[0].labels.execution = "different"; },
    (raw) => { raw.volume[0].created = "2026-10-01T11:00:00Z"; },
    (raw) => { raw.volume.push({ ...raw.volume[0], name: `supabase_extra_${projectId}` }); },
    (raw) => { raw.container.push({ ...raw.container[0], id: "9".repeat(64), name: "/foreign-container", labels: { supabase: null, compose: null, execution: null } }); },
  ]) {
    const raw = dockerFixture();
    const fake = fakeDocker(raw);
    const ledger = admitFixture(raw, fake.run);
    mutate(raw);
    assert.throws(() => cleanupOwnedStack(ledger, fake.run));
    assert.equal(fake.mutations.length, 0, "unsafe cleanup must not remove any resource");
  }
});

test("cleanup repeats admission before every delete, and only removes admitted exact identities", () => {
  const raw = dockerFixture();
  const fake = fakeDocker(raw);
  const ledger = admitFixture(raw, fake.run);
  assertCleanupAdmitted(ledger, readDockerInventory(fake.run));
  cleanupOwnedStack(ledger, fake.run);
  assert.deepEqual(fake.mutations, [
    ["container", "rm", "--force", "2".repeat(64)],
    ["container", "rm", "--force", "3".repeat(64)],
    ["network", "rm", networkId],
    ["volume", "rm", `supabase_db_${projectId}`],
  ]);
  assertNamespaceAbsent(projectId, readDockerInventory(fake.run));
  const changed = dockerFixture();
  let afterFirstDelete = false;
  const guarded = fakeDocker(changed, (args) => {
    if (args[1] === "rm") afterFirstDelete = true;
    else if (afterFirstDelete && args[0] === "container" && args[1] === "ls") {
      changed.volume[0].labels.compose = "foreign";
      afterFirstDelete = false;
    }
  });
  const guardedLedger = admitFixture(changed, guarded.run);
  assert.throws(() => cleanupOwnedStack(guardedLedger, guarded.run), /identities or labels changed/);
  assert.equal(guarded.mutations.length, 1, "changed resources survive the next cleanup boundary");
});

test("migration and ledger insert share a transaction and immutable container identity", () => {
  const args = transactionalMigrationArgs("2".repeat(64), "0152_native_physical.sql");
  assert(args.includes("--single-transaction"));
  assert(args.includes("--no-password"));
  assert.equal(args[2], "2".repeat(64));
  assert.deepEqual(args.slice(-4), ["-f", "-", "-c", "insert into supabase_migrations.schema_migrations(version,name) values ('0152','native_physical');"]);
  assert.throws(() => transactionalMigrationArgs("supabase_db_retained", "0152_native_physical.sql"), /identity/);
  assert.throws(() => transactionalMigrationArgs("2".repeat(64), "0152_bad';delete.sql"), /filename/);
});

test("launcher keeps failed runtimes and never uses project-name stop or dotenv materialization", async () => {
  const launcher = await readFile(path.join(here, "launcher.mjs"), "utf8");
  assert.match(launcher, /if \(!settings\.bootstrapOnly && !thrown && ownedRuntime && ledger\) await cleanupOwnedServices/);
  assert.doesNotMatch(launcher, /await rm\(settings\.runtimeRoot/);
  assert.match(launcher, /result\.runtimePreserved = true/);
  assert.doesNotMatch(launcher, /supabase", "stop"|--no-backup/);
  assert.match(launcher, /"--network-id", network\.name/);
  assert.doesNotMatch(launcher, /"--network-id", network\.id/);
  assert.match(launcher, /admittedDockerDaemon = admitLocalDockerDaemon\(run\)/);
  assert.match(launcher, /DOCKER_HOST: admittedDockerDaemon.endpoint/);
  assert.match(launcher, /pnpm_config_verify_deps_before_run: "false"/);
  assert.match(launcher, /assertDockerSocketIdentity\(admittedDockerDaemon\)/);
  assert.match(launcher, /--viewport-width=\$\{settings\.journeyWidth\}/);
  assert.match(launcher, /readFile\(path\.join\(settings\.runtimeRoot, `scripts\/\$\{version\}-production-preflight\.sql`\)/);
});

test("bootstrap-only stops after migrations and preserves the admitted stack without auth, fixture, app, or browser", async () => {
  const launcher = await readFile(path.join(here, "launcher.mjs"), "utf8");
  const stop = launcher.indexOf("if (settings.bootstrapOnly)");
  const tail = launcher.indexOf("await runPortableJourneyTail(settings, local, target, result");
  assert(stop > 0 && stop < tail, "bootstrap stop must precede the auth/fixture/app/browser tail");
  const boundary = launcher.slice(stop, tail);
  assert.match(boundary, /READY_FOR_READ_ONLY_PREFLIGHT/);
  assert.match(boundary, /status: "READY_FOR_READ_ONLY_PREFLIGHT"/);
  assert.match(boundary, /fixtureApplied: false/);
  assert.match(boundary, /appStarted: false/);
  assert.match(boundary, /browserStarted: false/);
  assert.match(boundary, /privacyMigrationApplied: false/);
  assert.match(boundary, /executionId: settings\.executionId/);
  assert.match(boundary, /runtimeIdentity:/);
  assert.match(boundary, /dev: ownedRuntime\.dev/);
  assert.match(boundary, /ino: ownedRuntime\.ino/);
  assert.match(boundary, /marker: ownedRuntime\.marker/);
  assert.match(boundary, /runtimeRoot: settings\.runtimeRoot/);
  assert.match(boundary, /evidenceRoot: settings\.evidenceDir/);
  assert.match(launcher, /"psql", "-X", "--no-password"/);
  assert.match(launcher, /"-c", "select 1"/);
  assert.match(launcher, /if \(!settings\.bootstrapOnly && !thrown && ownedRuntime && ledger\) await cleanupOwnedServices/);
  assert.match(launcher, /const readInventory = settings\.bootstrapOnly\s+\? \(runner\) => readProjectDockerInventory/);
});

test("preserved D continuation reuses only the existing tail and cannot bootstrap, recreate, or clean the stack", async () => {
  const launcher = await readFile(path.join(here, "launcher.mjs"), "utf8");
  const start = launcher.indexOf("async function admitPreservedDContinuation");
  const end = launcher.indexOf("async function main()", start);
  assert(start > 0 && end > start);
  const continuation = launcher.slice(start, end);
  assert.match(continuation, /runPortableJourneyTail\(/);
  assert.equal(continuation.match(/runPortableJourneyTail\(/g)?.length, 1);
  for (const forbidden of [
    "applySourceMigrations(", "createOwnedNetwork(", "materializeRuntime(",
    "cleanupOwnedServices(", "cleanupOwnedStack(", "assertNamespaceAbsent(",
    '"supabase", "start"', '"supabase", "stop"', "--no-backup",
  ]) {
    assert.equal(continuation.includes(forbidden), false, `continuation contains forbidden lifecycle action: ${forbidden}`);
  }
  assert.match(continuation, /assertCleanupAdmitted\(admitted\.ownership, inventory\)/);
  assert.match(continuation, /assertPreservedDDockerDaemon\(admitLocalDockerDaemon\(run\)\)/);
  assert.match(continuation, /default_transaction_read_only=on/);
  assert.match(continuation, /"137\/0165\/0\/0\/0\/0"/);
  assert.match(continuation, /result\.stackPreserved = true/);
});
