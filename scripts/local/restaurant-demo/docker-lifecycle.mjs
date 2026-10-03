import assert from "node:assert/strict";
import { lstatSync, realpathSync } from "node:fs";
import path from "node:path";

const PROJECT = /^terroir-demo-[a-z0-9][a-z0-9-]{2,40}$/;
const LABEL = "com.terroir.demo.execution";
export const RAW_PROJECT_LABELS = Object.freeze({
  supabase: "com.supabase.cli.project",
  compose: "com.docker.compose.project",
});
const PROJECT_LABELS = Object.values(RAW_PROJECT_LABELS);
const LABEL_FORMAT = `{"supabase":{{json (index .Labels "${PROJECT_LABELS[0]}")}},"compose":{{json (index .Labels "${PROJECT_LABELS[1]}")}},"execution":{{json (index .Labels "${LABEL}")}}}`;
const CONTAINER_LABEL_FORMAT = LABEL_FORMAT.replaceAll(".Labels", ".Config.Labels");
const FORMATS = {
  container: `{"id":{{json .Id}},"name":{{json .Name}},"created":{{json .Created}},"running":{{json .State.Running}},"labels":${CONTAINER_LABEL_FORMAT},"networks":{{json .NetworkSettings.Networks}},"mounts":{{json .Mounts}},"ports":{{json .NetworkSettings.Ports}}}`,
  network: `{"id":{{json .Id}},"name":{{json .Name}},"created":{{json .Created}},"labels":${LABEL_FORMAT},"driver":{{json .Driver}},"binding":{{json (index .Options "com.docker.network.bridge.host_binding_ipv4")}}}`,
  volume: `{"name":{{json .Name}},"created":{{json .CreatedAt}},"labels":${LABEL_FORMAT}}`,
};

const NAME_LIST_FORMATS = Object.freeze({
  container: "{{.ID}}\t{{.Names}}",
  network: "{{.ID}}\t{{.Name}}",
  volume: "{{.Name}}\t{{.Name}}",
});

export function parseLocalDockerEndpoint(raw) {
  assert(typeof raw === "string", "Docker daemon endpoint missing");
  const url = new URL(raw);
  assert.equal(url.protocol, "unix:", "Docker daemon must use a local Unix socket");
  assert.equal(url.hostname, "", "Docker Unix endpoint must not have a hostname");
  assert.equal(url.username + url.password + url.port + url.search + url.hash, "", "Docker Unix endpoint authority/query/fragment refused");
  const socketPath = decodeURIComponent(url.pathname);
  assert(path.isAbsolute(socketPath) && socketPath !== "/" && !socketPath.includes("\0"), "Docker Unix socket path refused");
  return socketPath;
}

function inspectLocalSocket(socketPath) {
  const canonical = realpathSync(socketPath);
  const metadata = lstatSync(canonical);
  assert(metadata.isSocket(), "Docker endpoint is not a local Unix socket");
  return { socketPath: canonical, dev: metadata.dev, ino: metadata.ino };
}

export function admitLocalDockerDaemon(run, inspectSocket = inspectLocalSocket) {
  const raw = JSON.parse(run("docker", ["context", "inspect", "--format", "{{json .Endpoints.docker.Host}}"]));
  const identity = inspectSocket(parseLocalDockerEndpoint(raw));
  assert(path.isAbsolute(identity.socketPath), "Docker socket inspection must return an absolute path");
  const endpoint = new URL("unix:///");
  endpoint.pathname = identity.socketPath;
  return { ...identity, endpoint: endpoint.href };
}

export function assertDockerSocketIdentity(admitted, inspectSocket = inspectLocalSocket) {
  assert.deepEqual(inspectSocket(admitted.socketPath), { socketPath: admitted.socketPath, dev: admitted.dev, ino: admitted.ino }, "local Docker socket identity changed; preserve runtime");
}

// Read only identity/topology fields: never Docker's Config.Env or service secrets.
export function readDockerInventory(run) {
  return Object.fromEntries(Object.keys(FORMATS).map((kind) => {
    const ids = listResourceIds(kind, run);
    return [kind, inspectResources(kind, ids, run)];
  }));
}

export function readProjectDockerInventory(projectId, run) {
  assert(PROJECT.test(projectId), "Docker project must be a disposable demo namespace");
  const idsByKind = Object.fromEntries(Object.keys(FORMATS).map((kind) => [kind, new Set()]));
  for (const kind of Object.keys(FORMATS)) {
    for (const id of listNamedProjectResourceIds(kind, projectId, run)) idsByKind[kind].add(id);
    for (const filter of [
      `label=${RAW_PROJECT_LABELS.supabase}=${projectId}`,
      `label=${RAW_PROJECT_LABELS.compose}=${projectId}`,
    ]) {
      for (const id of listResourceIds(kind, run, filter)) idsByKind[kind].add(id);
    }
  }
  let inventory = inspectInventory(idsByKind, run);
  for (const network of inventory.network) {
    for (const id of listResourceIds("container", run, `network=${network.id}`)) idsByKind.container.add(id);
  }
  for (const volume of inventory.volume) {
    for (const id of listResourceIds("container", run, `volume=${volume.name}`)) idsByKind.container.add(id);
  }
  inventory = inspectInventory(idsByKind, run);
  return inventory;
}

function listNamedProjectResourceIds(kind, projectId, run) {
  const args = kind === "container" ? ["--all", "--no-trunc"] : kind === "network" ? ["--no-trunc"] : [];
  const format = NAME_LIST_FORMATS[kind];
  const output = run("docker", [kind, "ls", ...args, "--filter", `name=${projectId}`, "--format", format]);
  return output.split("\n").filter(Boolean).flatMap((line) => {
    const [id, rawName, ...extra] = line.split("\t");
    assert(id && rawName && extra.length === 0, "Docker name inventory is malformed");
    return resourceNameMatchesProject(rawName.replace(/^\//, ""), projectId) ? [id] : [];
  });
}

function listResourceIds(kind, run, filter) {
  const args = kind === "container" ? ["--all", "--quiet", "--no-trunc"] : kind === "network" ? ["--quiet", "--no-trunc"] : ["--quiet"];
  if (filter) args.push("--filter", filter);
  return run("docker", [kind, "ls", ...args]).split(/\s+/).filter(Boolean);
}

function inspectInventory(idsByKind, run) {
  return Object.fromEntries(Object.keys(FORMATS).map((kind) => [kind, inspectResources(kind, [...idsByKind[kind]], run)]));
}

function inspectResources(kind, ids, run) {
  const rows = ids.length === 0 ? [] : run("docker", [kind, "inspect", "--format", FORMATS[kind], ...ids]).split("\n").map((line) => JSON.parse(line));
  assert.equal(rows.length, ids.length, "Docker inventory changed during inspection");
  return rows.map((row) => normalizeResource(kind, row));
}

function normalizeResource(kind, row) {
  assert(row && typeof row.name === "string" && typeof row.created === "string" && row.created, "Docker resource identity missing");
  const resource = { kind, name: row.name.replace(/^\//, ""), created: row.created, labels: row.labels };
  assert(resource.labels && typeof resource.labels === "object", "Docker labels missing");
  if (kind !== "volume") {
    assert(/^[a-f0-9]{64}$/.test(row.id), "Docker immutable identity missing");
    resource.id = row.id;
  }
  if (kind === "network") Object.assign(resource, { driver: row.driver, binding: row.binding });
  if (kind === "container") Object.assign(resource, {
    running: row.running,
    networks: Object.values(row.networks ?? {}).map((network) => network.NetworkID).sort(),
    volumes: (row.mounts ?? []).filter((mount) => mount.Type === "volume").map((mount) => mount.Name).sort(),
    ports: Object.entries(row.ports ?? {}).flatMap(([internal, bindings]) => (bindings ?? []).map((binding) => ({ internal, ip: binding.HostIp, port: binding.HostPort }))).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
  });
  return resource;
}

export function namespaceResources(projectId, inventory) {
  assert(PROJECT.test(projectId), "Docker project must be a disposable demo namespace");
  return Object.values(inventory).flat().filter((resource) => (
    resourceNameMatchesProject(resource.name, projectId) ||
    resource.labels.supabase === projectId || resource.labels.compose === projectId
  )).sort((a, b) => `${a.kind}/${a.name}`.localeCompare(`${b.kind}/${b.name}`));
}

function resourceNameMatchesProject(name, projectId) {
  return name === projectId || name.endsWith(`_${projectId}`) || name.startsWith(`${projectId}-`);
}

export function assertNamespaceAbsent(projectId, inventory) {
  assert.equal(namespaceResources(projectId, inventory).length, 0, "disposable Docker namespace already has resources (including stopped containers)");
}

export function createOwnedNetwork(projectId, executionId, run, readInventory = readDockerInventory) {
  assertNamespaceAbsent(projectId, readInventory(run));
  assert(/^[a-f0-9-]{36}$/.test(executionId), "execution identity must be a UUID");
  const id = run("docker", ["network", "create", "--driver", "bridge", "--opt", "com.docker.network.bridge.host_binding_ipv4=127.0.0.1",
    ...PROJECT_LABELS.flatMap((label) => ["--label", `${label}=${projectId}`]),
    "--label", `${LABEL}=${executionId}`, `supabase_network_${projectId}`]);
  const resources = namespaceResources(projectId, readInventory(run));
  assert.equal(resources.length, 1, "unexpected resources appeared during network creation");
  const [network] = resources;
  assert.equal(network.id, id, "created network identity drifted");
  assertOwnedNetwork(network, projectId, executionId);
  return network;
}

function assertProjectLabels(resource, projectId) {
  assert.equal(resource.labels.supabase, projectId, "Supabase resource ownership label changed");
  assert.equal(resource.labels.compose, projectId, "Compose resource ownership label changed");
}

function assertOwnedNetwork(network, projectId, executionId) {
  assert.equal(network.kind, "network");
  assert.equal(network.name, `supabase_network_${projectId}`);
  assertProjectLabels(network, projectId);
  assert.equal(network.labels.execution, executionId, "network execution ownership changed");
  assert.equal(network.driver, "bridge", "demo network must be a bridge");
  assert.equal(network.binding, "127.0.0.1", "demo network must bind published ports to loopback");
}

function assertObservedExcludedEdgeRuntimeVolume(volume, projectId, network, inventory) {
  assert.equal(volume.name, `supabase_edge_runtime_${projectId}`, "unattached volume in disposable namespace");
  assert.equal(volume.labels.execution, "", "excluded edge-runtime volume execution label changed");
  const networkCreated = Date.parse(network.created);
  const volumeCreated = Date.parse(volume.created);
  assert(Number.isFinite(networkCreated) && Number.isFinite(volumeCreated), "Docker resource creation time is invalid");
  assert(Math.floor(volumeCreated / 1000) >= Math.floor(networkCreated / 1000), "excluded edge-runtime volume predates the owned network");
  assert(!inventory.container.some((container) => container.volumes.includes(volume.name)), "excluded edge-runtime volume is attached to a container");
}

export function recordOwnedStack({ projectId, executionId, network, ports }, inventory) {
  const resources = namespaceResources(projectId, inventory);
  const networks = resources.filter((resource) => resource.kind === "network");
  assert.deepEqual(networks, [network], "owned network identity/topology changed during stack startup");
  assertOwnedNetwork(network, projectId, executionId);
  const containers = resources.filter((resource) => resource.kind === "container");
  for (const service of ["db", "kong"]) assert(containers.some((resource) => resource.name === `supabase_${service}_${projectId}`), "required owned stack container missing");
  for (const resource of resources) {
    assertProjectLabels(resource, projectId);
    assert(resource.name.startsWith("supabase_") && resource.name.endsWith(`_${projectId}`), "unexpected Docker resource name in disposable namespace");
    if (resource.kind === "container") {
      assert.equal(resource.running, true, "owned demo container is stopped");
      assert.deepEqual(resource.networks, [network.id], "container attached outside the owned network");
      for (const binding of resource.ports) {
        assert.equal(binding.ip, "127.0.0.1", "demo container published a non-loopback port");
        assert(Object.values(ports).map(String).includes(binding.port), "demo container published an unrequested port");
      }
      for (const name of resource.volumes) assert(resources.some((volume) => volume.kind === "volume" && volume.name === name), "container uses a volume outside the owned namespace");
    }
    if (resource.kind === "volume" && !containers.some((container) => container.volumes.includes(resource.name))) {
      assertObservedExcludedEdgeRuntimeVolume(resource, projectId, network, inventory);
    }
  }
  const ledger = { version: 1, projectId, executionId, resources };
  assertCleanupAdmitted(ledger, inventory);
  return ledger;
}

export function assertCleanupAdmitted(ledger, inventory) {
  assert.equal(ledger.version, 1, "Docker ownership ledger version refused");
  assert.deepEqual(namespaceResources(ledger.projectId, inventory), ledger.resources, "Docker resource identities or labels changed; preserve runtime");
  const containerIds = new Set(ledger.resources.filter((resource) => resource.kind === "container").map((resource) => resource.id));
  const networkIds = new Set(ledger.resources.filter((resource) => resource.kind === "network").map((resource) => resource.id));
  const volumeNames = new Set(ledger.resources.filter((resource) => resource.kind === "volume").map((resource) => resource.name));
  for (const container of inventory.container) {
    if (containerIds.has(container.id)) continue;
    assert(!container.networks.some((id) => networkIds.has(id)), "foreign container joined owned network; preserve runtime");
    assert(!container.volumes.some((name) => volumeNames.has(name)), "foreign container uses owned volume; preserve runtime");
  }
}

export function cleanupOwnedStack(ledger, run) {
  const remaining = { ...ledger, resources: [...ledger.resources] };
  assertCleanupAdmitted(remaining, readDockerInventory(run));
  // Docker containers/networks are addressed by immutable ID, never project-name stop.
  // Volumes have no immutable API ID: re-admit name + CreatedAt + labels + users.
  for (const kind of ["container", "network", "volume"]) {
    for (const resource of ledger.resources.filter((entry) => entry.kind === kind)) {
      assertCleanupAdmitted(remaining, readDockerInventory(run));
      run("docker", [kind, "rm", ...(kind === "container" ? ["--force"] : []), resource.id ?? resource.name]);
      remaining.resources = remaining.resources.filter((entry) => entry !== resource);
    }
  }
  assertNamespaceAbsent(ledger.projectId, readDockerInventory(run));
}
