import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  PRESERVED_D,
  PRESERVED_D_CONTINUATION_ACK,
  admitPreservedDBootstrap,
  admitPreservedDPrivacyReceipt,
  assertFrozenPreservedDSource,
  assertPreservedDDockerDaemon,
  runPreservedDContinuation,
  sha256,
} from "./preserved-d-continuation.mjs";

const reviewedHash = "a".repeat(64);
const migrationHash = "b".repeat(64);
const privacyReviewHash = "c".repeat(64);

function settings(overrides = {}) {
  return {
    continuePreservedD: true,
    execute: true,
    bootstrapOnly: false,
    ack: PRESERVED_D_CONTINUATION_ACK,
    projectId: PRESERVED_D.projectId,
    sourceRoot: PRESERVED_D.sourceRoot,
    runtimeRoot: PRESERVED_D.runtimeRoot,
    evidenceDir: `${PRESERVED_D.bootstrapEvidenceRoot}-continuation`,
    privacyReceipt: "/tmp/preserved-d-privacy-receipt.json",
    privacyReceiptSha256: "d".repeat(64),
    privacyMigrationSha256: migrationHash,
    privacyReviewSha256: privacyReviewHash,
    reviewedLauncherSha256: reviewedHash,
    ownerEmail: PRESERVED_D.ownerEmail,
    staffEmail: PRESERVED_D.staffEmail,
    ports: { ...PRESERVED_D.ports },
    journeyWidth: 390,
    ...overrides,
  };
}

function fixture() {
  const marker = {
    version: 2,
    projectId: PRESERVED_D.projectId,
    executionId: PRESERVED_D.executionId,
    runtimeRoot: PRESERVED_D.runtimeRoot,
  };
  const runtimeIdentity = { dev: 101, ino: 202 };
  const bootstrap = {
    status: "READY_FOR_READ_ONLY_PREFLIGHT", result: "READY_FOR_READ_ONLY_PREFLIGHT",
    projectId: PRESERVED_D.projectId, executionId: PRESERVED_D.executionId,
    sourceHead: PRESERVED_D.sourceHead, sourceTree: PRESERVED_D.sourceTree,
    runtimeRoot: PRESERVED_D.runtimeRoot, evidenceRoot: PRESERVED_D.bootstrapEvidenceRoot,
    runtimeIdentity: { ...runtimeIdentity, marker }, database: "postgres",
    databaseContainerId: PRESERVED_D.databaseContainerId, networkId: PRESERVED_D.networkId,
    databaseBinding: `127.0.0.1:${PRESERVED_D.ports.db}`,
    apiBinding: `127.0.0.1:${PRESERVED_D.ports.api}`,
    migrationLedger: PRESERVED_D.migrationLedger,
    lastCompletedStep: "transactional-migrations-applied",
    fixtureApplied: false, appStarted: false, browserStarted: false,
    privacyMigrationApplied: false, runtimePreserved: true,
  };
  const ownership = {
    version: 1, projectId: PRESERVED_D.projectId, executionId: PRESERVED_D.executionId,
    resources: [{ kind: "network", id: PRESERVED_D.networkId }],
  };
  const bootstrapResultText = `${JSON.stringify(bootstrap)}\n`;
  const ownershipText = `${JSON.stringify(ownership)}\n`;
  const markerText = `${JSON.stringify(marker)}\n`;
  return {
    input: {
      settings: settings(), bootstrapResultText, ownershipText, markerText,
      runtimeIdentity, actualLauncherSha256: reviewedHash,
    },
    authority: {
      ...PRESERVED_D,
      bootstrapResultSha256: sha256(bootstrapResultText),
      ownershipSha256: sha256(ownershipText), markerSha256: sha256(markerText),
    },
  };
}

function privacyReceipt(overrides = {}) {
  return {
    version: 1, kind: "staff_cost_seal_contract_apply", status: "succeeded",
    projectId: PRESERVED_D.projectId, executionId: PRESERVED_D.executionId,
    databaseContainerId: PRESERVED_D.databaseContainerId, networkId: PRESERVED_D.networkId,
    previousMigrationLedger: PRESERVED_D.migrationLedger, migrationId: "0165",
    migrationSha256: migrationHash, independentReviewSha256: privacyReviewHash,
    result: "PASS", migrationLedger: PRESERVED_D.privacyMigrationLedger,
    ...overrides,
  };
}

test("exact preserved D bootstrap, ownership marker, source, IDs, ports, and phase are admitted", () => {
  const value = fixture();
  const admitted = admitPreservedDBootstrap(value.input, value.authority);
  assert.equal(admitted.bootstrap.migrationLedger, "136/0164");
  assert.equal(admitted.ownership.projectId, PRESERVED_D.projectId);
  assert.equal(admitted.marker.executionId, PRESERVED_D.executionId);
});

test("tampered or missing bootstrap/ownership inputs fail before the tail", async () => {
  const value = fixture();
  for (const mutate of [
    (input) => ({ ...input, bootstrapResultText: input.bootstrapResultText.replace("136/0164", "135/0163") }),
    (input) => ({ ...input, ownershipText: "{}\n" }),
    (input) => ({ ...input, markerText: "{}\n" }),
    (input) => ({ ...input, runtimeIdentity: { ...input.runtimeIdentity, ino: input.runtimeIdentity.ino + 1 } }),
  ]) {
    let tailCalls = 0;
    await assert.rejects(runPreservedDContinuation({
      admit: async () => admitPreservedDBootstrap(mutate(value.input), value.authority),
      tail: async () => { tailCalls += 1; },
    }));
    assert.equal(tailCalls, 0);
  }
});

test("wrong target, source, phase, ports, mode, or reviewed launcher fails before the tail", async () => {
  for (const mutate of [
    (value) => ({ ...value.input, settings: settings({ projectId: "terroir-demo-wrong-target" }) }),
    (value) => ({ ...value.input, settings: settings({ sourceRoot: "/tmp/wrong-source" }) }),
    (value) => ({ ...value.input, settings: settings({ runtimeRoot: "/tmp/wrong-runtime" }) }),
    (value) => ({ ...value.input, settings: settings({ ports: { ...PRESERVED_D.ports, app: 3105 } }) }),
    (value) => ({ ...value.input, settings: settings({ bootstrapOnly: true }) }),
    (value) => ({ ...value.input, actualLauncherSha256: "e".repeat(64) }),
    (value) => ({ ...value.input, bootstrapResultText: value.input.bootstrapResultText.replace("136/0164", "137/0165") }),
  ]) {
    const value = fixture();
    let tailCalls = 0;
    await assert.rejects(runPreservedDContinuation({
      admit: async () => admitPreservedDBootstrap(mutate(value), value.authority),
      tail: async () => { tailCalls += 1; },
    }));
    assert.equal(tailCalls, 0);
  }
});

test("privacy receipt requires exact applied and independently reviewed 0165 chain", async () => {
  for (const overrides of [
    { status: "failed" }, { projectId: "terroir-demo-wrong-target" },
    { migrationId: "0164" }, { previousMigrationLedger: "135/0163" },
    { migrationLedger: "136/0164" }, { migrationSha256: "e".repeat(64) },
    { independentReviewSha256: "f".repeat(64) },
  ]) {
    const text = `${JSON.stringify(privacyReceipt(overrides))}\n`;
    let tailCalls = 0;
    await assert.rejects(runPreservedDContinuation({
      admit: async () => admitPreservedDPrivacyReceipt(settings({ privacyReceiptSha256: sha256(text) }), text),
      tail: async () => { tailCalls += 1; },
    }));
    assert.equal(tailCalls, 0);
  }
  const validText = `${JSON.stringify(privacyReceipt())}\n`;
  assert.throws(() => admitPreservedDPrivacyReceipt(settings({ privacyReceiptSha256: "0".repeat(64) }), validText), /receipt changed/);
});

test("a valid bootstrap and privacy admission invokes the existing tail exactly once", async () => {
  const value = fixture();
  const privacyText = `${JSON.stringify(privacyReceipt())}\n`;
  let tailCalls = 0;
  const executionId = await runPreservedDContinuation({
    admit: async () => ({
      ...admitPreservedDBootstrap(value.input, value.authority),
      privacy: admitPreservedDPrivacyReceipt(settings({ privacyReceiptSha256: sha256(privacyText) }), privacyText),
    }),
    tail: async ({ bootstrap }) => { tailCalls += 1; return bootstrap.executionId; },
  });
  assert.equal(executionId, PRESERVED_D.executionId);
  assert.equal(tailCalls, 1);
});

test("wrong Docker socket path fails before the existing tail", async () => {
  let tailCalls = 0;
  await assert.rejects(runPreservedDContinuation({
    admit: async () => assertPreservedDDockerDaemon({
      socketPath: "/Users/zero/.docker/run/docker.sock", dev: 1, ino: 2,
    }),
    tail: async () => { tailCalls += 1; },
  }), /socket path changed/);
  assert.equal(tailCalls, 0);
  assert.equal(
    assertPreservedDDockerDaemon({ socketPath: PRESERVED_D.dockerSocketPath, dev: 1, ino: 2 }).ino,
    2,
  );
});

test("frozen runtime source rejects modified and additional application files", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "preserved-d-source-"));
  try {
    await mkdir(path.join(root, "supabase"));
    const app = Buffer.from("original application\n");
    const objectId = createHash("sha1").update(`blob ${app.length}\0`).update(app).digest("hex");
    const config = "project_id = preserved-d\n";
    const configBuffer = Buffer.from(config);
    const configId = createHash("sha1").update(`blob ${configBuffer.length}\0`).update(configBuffer).digest("hex");
    const tree = `100644 blob ${objectId}\tsrc.mjs\0` + `100644 blob ${configId}\tsupabase/config.toml\0`;
    await writeFile(path.join(root, "src.mjs"), app);
    await writeFile(path.join(root, "supabase/config.toml"), config);
    await writeFile(path.join(root, ".terroir-demo-owned.json"), "{}\n");
    await assert.doesNotReject(assertFrozenPreservedDSource({ runtimeRoot: root, treeText: tree, expectedConfigText: config }));
    await writeFile(path.join(root, "src.mjs"), "tampered\n");
    await assert.rejects(assertFrozenPreservedDSource({ runtimeRoot: root, treeText: tree, expectedConfigText: config }), /source changed/);
    await writeFile(path.join(root, "src.mjs"), app);
    await writeFile(path.join(root, "extra.mjs"), "unexpected\n");
    await assert.rejects(assertFrozenPreservedDSource({ runtimeRoot: root, treeText: tree, expectedConfigText: config }), /file set changed/);
  } finally {
    await rm(root, { recursive: true });
  }
});
