import { describe, expect, it, vi } from "vitest";
import {
  IDENTITY_SNAPSHOT_SQL,
  TRACKED_IDENTITY_TABLES,
  admitLocalStack,
  assertConservationApiUrl,
  captureLocalSnapshot,
  compareIdentitySnapshots,
  evaluateConservation,
  liveChildEnvironment,
  missingLiveEnvironment,
  parseIdentitySnapshot,
  runConservationOrchestration,
} from "../../../scripts/run-live-test-conservation.mjs";

type IdentitySnapshot = Record<string, string[]>;

const emptySnapshot = (): IdentitySnapshot => Object.fromEntries(
  TRACKED_IDENTITY_TABLES.map((table) => [table, [] as string[]]),
);

const stackConfig = (projectId = "terroir-vw-local") => `
project_id = "${projectId}"
[api]
port = 57321
[db]
port = 57322
`;

const commandResult = (stdout = "") => ({
  error: undefined,
  output: [null, stdout, ""] as [null, string, string],
  pid: 1,
  signal: null,
  status: 0,
  stderr: "",
  stdout,
});

const containerInspect = ({
  id,
  name,
  projectId,
  internalPort,
  hostPort,
  hostIps = ["0.0.0.0"],
}: {
  id: string;
  name: string;
  projectId: string;
  internalPort: number;
  hostPort: number;
  hostIps?: string[];
}) => [
  id,
  `/${name}`,
  "running",
  projectId,
  projectId,
  JSON.stringify({
    [`${internalPort}/tcp`]: hostIps.map((HostIp) => ({ HostIp, HostPort: String(hostPort) })),
  }),
].join("\t") + "\n";

function localStackRunner(
  projectId: string,
  replacement = () => false,
  portShift = 0,
  hostIps = ["0.0.0.0"],
) {
  const databaseId = "a".repeat(64);
  const replacementId = "b".repeat(64);
  const apiId = "c".repeat(64);
  return vi.fn((command: string, args: string[]) => {
    if (command !== "docker") return commandResult();
    const name = args.at(-1) ?? "";
    if (args[0] === "inspect") {
      const database = name === `supabase_db_${projectId}`;
      return commandResult(containerInspect({
        id: database && replacement()
          ? replacementId
          : database ? databaseId : apiId,
        name,
        projectId,
        internalPort: database ? 5432 : 8000,
        hostPort: (database ? 57322 : 57321) + portShift,
        hostIps,
      }));
    }
    return commandResult();
  });
}

describe("live test identity conservation", () => {
  it("parses and sorts exact identities for all six tracked tables", () => {
    const receiptIdentity = [
      "11111111-1111-4111-8111-111111111111",
      "22222222-2222-4222-8222-222222222222",
    ].join("/");
    const snapshot = parseIdentitySnapshot([
      "public.restaurants\tb",
      "auth.users\tu",
      "public.restaurants\ta",
      `public.inventory_command_receipts\t${receiptIdentity}`,
      "",
    ].join("\n"));

    expect(snapshot).toEqual({
      "auth.users": ["u"],
      "public.restaurants": ["a", "b"],
      "public.workspaces": [],
      "public.memberships": [],
      "public.workspace_memberships": [],
      "public.inventory_command_receipts": [receiptIdentity],
    });
  });

  it("reports exact added and removed identities, not counts alone", () => {
    const before = emptySnapshot();
    before["public.restaurants"] = ["same-count-old"];
    const after = emptySnapshot();
    after["public.restaurants"] = ["same-count-new"];

    expect(compareIdentitySnapshots(before, after)).toEqual([{
      table: "public.restaurants",
      beforeCount: 1,
      afterCount: 1,
      added: ["same-count-new"],
      removed: ["same-count-old"],
    }]);
  });

  it("fails when an injected cleanup defect leaves residue despite child exit zero", () => {
    const before = emptySnapshot();
    const after = emptySnapshot();
    after["public.restaurants"] = ["leaked-restaurant"];
    after["public.workspaces"] = ["leaked-workspace"];

    const result = evaluateConservation({ before, after, childExitCode: 0 });

    expect(result.exitCode).toBe(1);
    expect(result.drift.map(({ table }) => table)).toEqual([
      "public.restaurants",
      "public.workspaces",
    ]);
  });

  it("passes only when the child and exact identity sets both pass", () => {
    const snapshot = emptySnapshot();
    expect(evaluateConservation({
      before: snapshot,
      after: structuredClone(snapshot),
      childExitCode: 0,
    })).toMatchObject({ exitCode: 0, drift: [] });
    expect(evaluateConservation({
      before: snapshot,
      after: structuredClone(snapshot),
      childExitCode: 2,
    })).toMatchObject({ exitCode: 1, childExitCode: 2, drift: [] });
  });

  it("binds the SQL snapshot to the complete six-table contract", () => {
    for (const table of TRACKED_IDENTITY_TABLES) {
      expect(IDENTITY_SNAPSHOT_SQL).toContain(`from ${table}`);
    }
  });

  it.each([
    ["malformed", "public.restaurants"],
    ["unknown table", "public.unknown\tid"],
    ["duplicate", "public.restaurants\tid\npublic.restaurants\tid"],
    ["empty identity", "public.restaurants\t"],
    ["extra column", "public.restaurants\tid\textra"],
    ["invalid receipt composite", "public.inventory_command_receipts\tr/o"],
  ])("rejects %s snapshot output", (_label, raw) => {
    expect(() => parseIdentitySnapshot(raw)).toThrow();
  });

  it("compares exact composite receipt identities", () => {
    const before = emptySnapshot();
    const after = emptySnapshot();
    const restaurantId = "11111111-1111-4111-8111-111111111111";
    const oldOperationId = "22222222-2222-4222-8222-222222222222";
    const newOperationId = "33333333-3333-4333-8333-333333333333";
    before["public.inventory_command_receipts"] = [`${restaurantId}/${oldOperationId}`];
    after["public.inventory_command_receipts"] = [`${restaurantId}/${newOperationId}`];

    expect(compareIdentitySnapshots(before, after)).toEqual([{
      table: "public.inventory_command_receipts",
      beforeCount: 1,
      afterCount: 1,
      added: [`${restaurantId}/${newOperationId}`],
      removed: [`${restaurantId}/${oldOperationId}`],
    }]);
  });

  it("captures post-state after ENOENT and reports child failure separately", () => {
    let snapshots = 0;
    const result = runConservationOrchestration({
      captureSnapshot: () => {
        snapshots += 1;
        return emptySnapshot();
      },
      runChild: () => ({
        error: Object.assign(new Error("spawn failed"), { code: "ENOENT" }),
        signal: null,
        status: null,
      }),
    });

    expect(snapshots).toBe(2);
    expect(result).toMatchObject({
      exitCode: 1,
      childFailure: "spawn_error:ENOENT",
      postCaptureFailure: null,
      drift: [],
    });
  });

  it("fails on residue after a zero-exit child through real orchestration", () => {
    const before = emptySnapshot();
    const after = emptySnapshot();
    after["public.restaurants"] = ["residue"];
    const snapshots = [before, after];
    const result = runConservationOrchestration({
      captureSnapshot: () => snapshots.shift()!,
      runChild: () => ({ error: undefined, signal: null, status: 0 }),
    });

    expect(result).toMatchObject({
      exitCode: 1,
      childFailure: null,
      postCaptureFailure: null,
    });
    expect(result.drift).toHaveLength(1);
  });

  it("preserves child and post-capture failures together", () => {
    let snapshots = 0;
    const result = runConservationOrchestration({
      captureSnapshot: () => {
        snapshots += 1;
        if (snapshots === 2) throw new Error("post unavailable");
        return emptySnapshot();
      },
      runChild: () => ({ error: undefined, signal: null, status: 7 }),
    });

    expect(result).toMatchObject({
      exitCode: 1,
      childExitCode: 7,
      childFailure: "exit_code:7",
      postCaptureFailure: "post unavailable",
      drift: [],
    });
  });

  it("treats a signal as child failure and still captures post-state", () => {
    let snapshots = 0;
    const result = runConservationOrchestration({
      captureSnapshot: () => {
        snapshots += 1;
        return emptySnapshot();
      },
      runChild: () => ({ error: undefined, signal: "SIGTERM", status: null }),
    });

    expect(snapshots).toBe(2);
    expect(result.childFailure).toBe("signal:SIGTERM");
    expect(result.exitCode).toBe(1);
  });

  it("requires all local live variables and forces CI in the child without exposing values", () => {
    const complete = {
      NEXT_PUBLIC_SUPABASE_URL: "local-url",
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "publishable-secret",
      SUPABASE_SERVICE_ROLE_KEY: "service-secret",
    };
    expect(missingLiveEnvironment(complete)).toEqual([]);
    expect(missingLiveEnvironment({ NEXT_PUBLIC_SUPABASE_URL: "local-url" })).toEqual([
      "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
      "SUPABASE_SERVICE_ROLE_KEY",
    ]);
    expect(liveChildEnvironment({ ...complete, CI: "0" })).toMatchObject({ CI: "1" });
  });

  it("requires the conservation URL to use the admitted IPv4 loopback spelling", () => {
    expect(() => assertConservationApiUrl(
      "http://localhost:57321",
      stackConfig(),
    )).toThrow("http://127.0.0.1:57321");
    expect(() => assertConservationApiUrl(
      "http://127.0.0.1:57321",
      stackConfig(),
    )).not.toThrow();
  });

  it("derives an alternate stack and never invokes the retained project target", () => {
    const runCommand = localStackRunner("alternate-local");
    const target = admitLocalStack(stackConfig("alternate-local"), runCommand);

    expect(captureLocalSnapshot(target, runCommand)).toEqual(emptySnapshot());
    expect(JSON.stringify(runCommand.mock.calls)).not.toContain("terroir-vw-local");
    expect(runCommand).toHaveBeenCalledWith(
      "docker",
      expect.arrayContaining(["exec", "a".repeat(64)]),
      expect.any(Object),
    );
  });

  it.each([
    ["malformed config", "project_id = '../wrong'\n[api]\nport = 57321\n[db]\nport = 57322", vi.fn(), "invalid project_id"],
    ["ambiguous project id", `project_id = "first-local"\n${stackConfig("second-local")}`, vi.fn(), "ambiguous or missing projectId"],
    ["mismatched Docker labels", stackConfig(), localStackRunner("other-local"), "labels do not match"],
    ["mismatched Docker ports", stackConfig(), localStackRunner("terroir-vw-local", () => false, 1), "port binding does not match"],
  ])("refuses %s before a child can run", (_label, config, runCommand, failure) => {
    const child = vi.fn();
    const result = runConservationOrchestration({
      captureSnapshot: () => captureLocalSnapshot(
        admitLocalStack(config, runCommand),
        runCommand,
      ),
      runChild: child,
    });

    expect(result).toMatchObject({
      exitCode: 1,
      childFailure: "not_run",
      preCaptureFailure: expect.stringContaining(failure),
    });
    expect(child).not.toHaveBeenCalled();
  });

  it("supports the retained config while executing snapshots by immutable container id", () => {
    const runCommand = localStackRunner("terroir-vw-local", () => false, 0, ["0.0.0.0", "::"]);
    const target = admitLocalStack(stackConfig(), runCommand);

    captureLocalSnapshot(target, runCommand);

    const exec = runCommand.mock.calls.find(([, args]) => args[0] === "exec");
    expect(exec?.[1]).toEqual(expect.arrayContaining([
      "--env",
      expect.stringContaining("default_transaction_read_only=on"),
      "a".repeat(64),
    ]));
  });

  it("supports an explicit IPv4 loopback-only stack binding", () => {
    const runCommand = localStackRunner("terroir-vw-local", () => false, 0, ["127.0.0.1"]);
    const target = admitLocalStack(stackConfig(), runCommand);

    expect(captureLocalSnapshot(target, runCommand)).toEqual(emptySnapshot());
  });

  it("refuses a matching project and port bound only to a LAN address before child launch", () => {
    const runCommand = localStackRunner("terroir-vw-local", () => false, 0, ["192.168.1.50"]);
    const child = vi.fn();
    const result = runConservationOrchestration({
      captureSnapshot: () => captureLocalSnapshot(
        admitLocalStack(stackConfig(), runCommand),
        runCommand,
      ),
      runChild: child,
    });

    expect(result).toMatchObject({
      exitCode: 1,
      childFailure: "not_run",
      preCaptureFailure: expect.stringContaining("IPv4 loopback"),
    });
    expect(child).not.toHaveBeenCalled();
    expect(runCommand.mock.calls.some(([, args]) => args[0] === "exec")).toBe(false);
  });

  it("fails post-capture if the admitted database container is replaced", () => {
    let replaced = false;
    const runCommand = localStackRunner("terroir-vw-local", () => replaced);
    const target = admitLocalStack(stackConfig(), runCommand);
    const result = runConservationOrchestration({
      captureSnapshot: () => captureLocalSnapshot(target, runCommand),
      runChild: () => {
        replaced = true;
        return commandResult();
      },
    });

    expect(result).toMatchObject({
      childFailure: null,
      exitCode: 1,
      postCaptureFailure: expect.stringContaining("container changed"),
    });
    expect(runCommand.mock.calls.filter(([, args]) => args[0] === "exec")).toHaveLength(1);
  });
});
