import { describe, expect, it } from "vitest";
import {
  IDENTITY_SNAPSHOT_SQL,
  TRACKED_IDENTITY_TABLES,
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
});
