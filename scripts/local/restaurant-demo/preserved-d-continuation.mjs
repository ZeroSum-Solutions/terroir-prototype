import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lstat, readFile, readdir } from "node:fs/promises";
import path from "node:path";

export const PRESERVED_D_CONTINUATION_ACK = "I_ACKNOWLEDGE_EXACT_PRESERVED_D_CONTINUATION";

export const PRESERVED_D = Object.freeze({
  projectId: "terroir-demo-20261002-privacy-d",
  executionId: "18be85dc-0d2b-4bed-aed5-445d5c8ece45",
  sourceRoot: "/Users/zero/projects/_archive/terroir-prototype",
  sourceHead: "589a62d69d2a68976d1fe2a6965cd4bb86123f75",
  sourceTree: "4ba55ef8d10848c17c8f34d75259a53cac6074b2",
  runtimeRoot: "/Users/zero/.claude/goal-state/terroir-restaurant-demo-20260927/proof/terroir-demo-20261002-privacy-d-runtime",
  bootstrapEvidenceRoot: "/Users/zero/.claude/goal-state/terroir-restaurant-demo-20260927/proof/terroir-demo-20261002-privacy-d-evidence",
  databaseContainerId: "892816e85618d3f2147eff1783bfd89bb846be90e8e92716f376effa190aa0c2",
  networkId: "2f972c0eabaff2c3e94f902206b17cf31634b78dbbf79d19bf2e30fecd794042",
  dockerSocketPath: "/Users/zero/.orbstack/run/docker.sock",
  ownerEmail: "owner+privacy-d@terroir.test",
  staffEmail: "staff+privacy-d@terroir.test",
  migrationLedger: "136/0164",
  privacyMigrationLedger: "137/0165",
  ports: Object.freeze({ api: 63321, db: 63322, shadow: 63320, studio: 63323, mail: 63324, app: 3104 }),
  bootstrapResultSha256: "c72cd9650fe3f67417d5b9491746525d6a545072b88e4c5eea58db5aa00b01c3",
  ownershipSha256: "2c39de0d2c87b09087dc97b4530653f728b7875ce502cdf230841d5b0a78175e",
  markerSha256: "5a72c1257795c36e3db5f90c7baf242c17492dcf6303107b24bc4ba22345e497",
});

export function sha256(text) {
  return createHash("sha256").update(text).digest("hex");
}

function gitBlobSha1(contents) {
  return createHash("sha1").update(`blob ${contents.length}\0`).update(contents).digest("hex");
}

async function runtimeSourcePaths(root) {
  const found = [];
  const pending = [""];
  while (pending.length > 0) {
    const relativeDirectory = pending.pop();
    const directory = path.join(root, relativeDirectory);
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (relativeDirectory === "" && entry.name === "node_modules") continue;
      const relative = path.posix.join(relativeDirectory, entry.name);
      assert(!entry.isSymbolicLink(), `frozen runtime source symlink refused: ${relative}`);
      if (entry.isDirectory()) pending.push(relative);
      else {
        assert(entry.isFile(), `frozen runtime source entry refused: ${relative}`);
        found.push(relative);
      }
    }
  }
  return found.sort();
}

export async function assertFrozenPreservedDSource({ runtimeRoot, treeText, expectedConfigText }) {
  const expected = new Map();
  for (const row of treeText.split("\0").filter(Boolean)) {
    const matched = row.match(/^(\d+) blob ([a-f0-9]{40})\t(.+)$/s);
    assert(matched, "preserved D Git tree contains a non-file or malformed entry");
    const [, mode, objectId, relative] = matched;
    assert(mode === "100644" || mode === "100755", "preserved D Git tree file mode changed");
    if (relative.split("/").some((part) => part === ".env" || part.startsWith(".env."))) continue;
    expected.set(relative, objectId);
  }
  const actual = await runtimeSourcePaths(runtimeRoot);
  assert.deepEqual(actual, [...expected.keys(), ".terroir-demo-owned.json"].sort(), "frozen runtime source file set changed");
  for (const [relative, objectId] of expected) {
    const contents = await readFile(path.join(runtimeRoot, relative));
    if (relative === "supabase/config.toml") {
      assert.equal(contents.toString("utf8"), expectedConfigText, "frozen runtime Supabase config changed");
    } else {
      assert.equal(gitBlobSha1(contents), objectId, `frozen runtime source changed: ${relative}`);
    }
  }
  const root = await lstat(runtimeRoot);
  return { sourceFiles: expected.size, dev: root.dev, ino: root.ino };
}

function parseObject(text, label) {
  let value;
  try { value = JSON.parse(text); } catch { throw new Error(`${label} is not valid JSON`); }
  assert(value && typeof value === "object" && !Array.isArray(value), `${label} must be a JSON object`);
  return value;
}

export function assertPreservedDSettings(settings) {
  assert.equal(settings.continuePreservedD, true, "preserved D continuation mode required");
  assert.equal(settings.execute, true, "preserved D continuation requires execution");
  assert.equal(settings.bootstrapOnly, false, "preserved D continuation cannot bootstrap");
  assert.equal(settings.ack, PRESERVED_D_CONTINUATION_ACK, "exact preserved D continuation acknowledgement required");
  for (const key of ["projectId", "sourceRoot", "runtimeRoot", "ownerEmail", "staffEmail"]) {
    assert.equal(settings[key], PRESERVED_D[key], `preserved D ${key} changed`);
  }
  assert.deepEqual(settings.ports, PRESERVED_D.ports, "preserved D ports changed");
  assert.equal(settings.journeyWidth, 390, "preserved D continuation is the admitted mobile journey only");
  assert.match(settings.reviewedLauncherSha256 ?? "", /^[a-f0-9]{64}$/, "reviewed launcher SHA-256 required");
  assert(typeof settings.privacyReceipt === "string" && path.isAbsolute(settings.privacyReceipt), "privacy receipt path must be absolute");
  for (const key of ["privacyReceiptSha256", "privacyMigrationSha256", "privacyReviewSha256"]) {
    assert.match(settings[key] ?? "", /^[a-f0-9]{64}$/, `${key} must be an externally admitted SHA-256`);
  }
  assert(typeof settings.evidenceDir === "string" && path.isAbsolute(settings.evidenceDir), "continuation evidence directory must be absolute");
  assert.notEqual(settings.evidenceDir, PRESERVED_D.bootstrapEvidenceRoot, "continuation cannot overwrite bootstrap evidence");
}

export function admitPreservedDBootstrap({
  settings,
  bootstrapResultText,
  ownershipText,
  markerText,
  runtimeIdentity,
  actualLauncherSha256,
}, authority = PRESERVED_D) {
  assertPreservedDSettings(settings);
  assert.equal(actualLauncherSha256, settings.reviewedLauncherSha256, "launcher source is not the independently reviewed source");
  assert.equal(sha256(bootstrapResultText), authority.bootstrapResultSha256, "bootstrap result receipt changed");
  assert.equal(sha256(ownershipText), authority.ownershipSha256, "Docker ownership receipt changed");
  assert.equal(sha256(markerText), authority.markerSha256, "runtime ownership marker changed");

  const bootstrap = parseObject(bootstrapResultText, "bootstrap result receipt");
  const ownership = parseObject(ownershipText, "Docker ownership receipt");
  const marker = parseObject(markerText, "runtime ownership marker");
  assert.equal(bootstrap.status, "READY_FOR_READ_ONLY_PREFLIGHT");
  assert.equal(bootstrap.result, "READY_FOR_READ_ONLY_PREFLIGHT");
  assert.equal(bootstrap.projectId, PRESERVED_D.projectId);
  assert.equal(bootstrap.executionId, PRESERVED_D.executionId);
  assert.equal(bootstrap.sourceHead, PRESERVED_D.sourceHead);
  assert.equal(bootstrap.sourceTree, PRESERVED_D.sourceTree);
  assert.equal(bootstrap.runtimeRoot, PRESERVED_D.runtimeRoot);
  assert.equal(bootstrap.evidenceRoot, PRESERVED_D.bootstrapEvidenceRoot);
  assert.equal(bootstrap.database, "postgres");
  assert.equal(bootstrap.databaseContainerId, PRESERVED_D.databaseContainerId);
  assert.equal(bootstrap.networkId, PRESERVED_D.networkId);
  assert.equal(bootstrap.databaseBinding, `127.0.0.1:${PRESERVED_D.ports.db}`);
  assert.equal(bootstrap.apiBinding, `127.0.0.1:${PRESERVED_D.ports.api}`);
  assert.equal(bootstrap.migrationLedger, PRESERVED_D.migrationLedger);
  assert.equal(bootstrap.lastCompletedStep, "transactional-migrations-applied");
  assert.equal(bootstrap.fixtureApplied, false);
  assert.equal(bootstrap.appStarted, false);
  assert.equal(bootstrap.browserStarted, false);
  assert.equal(bootstrap.privacyMigrationApplied, false);
  assert.equal(bootstrap.runtimePreserved, true);
  assert.deepEqual(bootstrap.runtimeIdentity?.marker, marker);
  assert.equal(bootstrap.runtimeIdentity?.dev, runtimeIdentity.dev, "runtime device identity changed");
  assert.equal(bootstrap.runtimeIdentity?.ino, runtimeIdentity.ino, "runtime inode identity changed");
  assert.deepEqual(marker, {
    version: 2,
    projectId: PRESERVED_D.projectId,
    executionId: PRESERVED_D.executionId,
    runtimeRoot: PRESERVED_D.runtimeRoot,
  });
  assert.equal(ownership.version, 1);
  assert.equal(ownership.projectId, PRESERVED_D.projectId);
  assert.equal(ownership.executionId, PRESERVED_D.executionId);
  assert(Array.isArray(ownership.resources) && ownership.resources.length > 0, "Docker ownership receipt has no resources");
  return { bootstrap, ownership, marker };
}

export function admitPreservedDPrivacyReceipt(settings, privacyReceiptText) {
  assert.equal(sha256(privacyReceiptText), settings.privacyReceiptSha256, "privacy application receipt changed");
  const receipt = parseObject(privacyReceiptText, "privacy application receipt");
  assert.deepEqual(Object.keys(receipt).sort(), [
    "databaseContainerId", "executionId", "independentReviewSha256", "kind",
    "migrationId", "migrationLedger", "migrationSha256", "networkId",
    "previousMigrationLedger", "projectId", "result", "status", "version",
  ].sort(), "privacy application receipt fields changed");
  assert.deepEqual(receipt, {
    version: 1,
    kind: "staff_cost_seal_contract_apply",
    status: "succeeded",
    projectId: PRESERVED_D.projectId,
    executionId: PRESERVED_D.executionId,
    databaseContainerId: PRESERVED_D.databaseContainerId,
    networkId: PRESERVED_D.networkId,
    previousMigrationLedger: PRESERVED_D.migrationLedger,
    migrationId: "0165",
    migrationSha256: settings.privacyMigrationSha256,
    independentReviewSha256: settings.privacyReviewSha256,
    result: "PASS",
    migrationLedger: PRESERVED_D.privacyMigrationLedger,
  });
  return receipt;
}

export function assertPreservedDDockerDaemon(admitted) {
  assert.equal(admitted?.socketPath, PRESERVED_D.dockerSocketPath, "preserved D Docker socket path changed");
  return admitted;
}

export async function runPreservedDContinuation({ admit, tail }) {
  const admitted = await admit();
  return tail(admitted);
}
