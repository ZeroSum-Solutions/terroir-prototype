import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, test, vi } from "vitest";

import { evidenceQueryCommand } from "../../../scripts/backup/collect-database-evidence.mjs";
import { assertRestoreContainerIsolation, restoreContainerArguments } from "../../../scripts/backup/restore-isolation.mjs";

// scripts/restore-drill.mjs is the recovery path: it decrypts a backup
// artifact into its own isolated PostgreSQL container. A loopback guard alone
// would not stop restored jobs from calling production or changing restored data.

const repoRoot = path.resolve(__dirname, "../../..");

describe("restore drill: restored code cannot reach an external service", () => {
  const state = { HostConfig: { NetworkMode: "none", PortBindings: {} }, Mounts: [], NetworkSettings: { Networks: { none: {} }, Ports: {} } };

  test("starts without networking or host exposure and disables cron before restore", () => {
    const args = restoreContainerArguments({ name: "terroir-restore-drill-123", image: "test-image", password: "synthetic" });
    expect(args.slice(args.indexOf("--network"), args.indexOf("--network") + 2)).toEqual(["--network", "none"]);
    expect(args.slice(-2)).toEqual(["-c", "cron.launch_active_jobs=off"]);
    for (const option of ["-p", "--publish", "-P", "--publish-all", "-v", "--volume", "--mount"]) {
      expect(args).not.toContain(option);
    }
    expect(assertRestoreContainerIsolation(state, "off\n")).toEqual({
      network: "none", published_ports: 0, host_bind_mounts: 0, cron_active_jobs: false,
    });
  });

  test("refuses an active project's container name", () => {
    for (const container of ["supabase_db_terroir-vw-local", "--privileged", "", "terroir-restore-drill-"]) {
      expect(() => restoreContainerArguments({ name: container, image: "image", password: "synthetic" })).toThrow();
      expect(() => evidenceQueryCommand("select 1", { container })).toThrow();
    }
  });

  test.each([
    [{ HostConfig: { NetworkMode: "bridge" }, Mounts: [] }, "off"],
    [{ ...state, HostConfig: { ...state.HostConfig, PortBindings: { "5432/tcp": [] } } }, "off"],
    [{ ...state, Mounts: [{ Type: "bind" }] }, "off"],
    [{ ...state, NetworkSettings: { Networks: { none: {}, bridge: {} }, Ports: {} } }, "off"],
    [{ ...state, NetworkSettings: { ...state.NetworkSettings, Ports: { "5432/tcp": [{ HostPort: "5432" }] } } }, "off"],
    [state, "on"],
    [{}, "off"],
  ])("fails closed on unexpected effective isolation", (inspect, cron) => {
    expect(() => assertRestoreContainerIsolation(inspect, cron)).toThrow();
  });

  test("reads scratch evidence by exact container exec, never ambient database credentials", () => {
    const result = evidenceQueryCommand("select 1", { container: "terroir-restore-drill-123" });
    expect(result).toEqual({ command: "docker", args: ["exec", "terroir-restore-drill-123", "psql", "-U", "supabase_admin", "-d", "postgres", "-X", "-A", "-t", "-q", "-v", "ON_ERROR_STOP=1", "-c", "select 1"] });
    expect(result.args.join(" ")).not.toMatch(/service=|snapshot|password|supabase\.co/);
  });

  test("leaves backup collection on its service-file transport", () => {
    const result = evidenceQueryCommand("select 1");
    expect(result.command).toBe("psql");
    expect(result.args[0]).toMatch(/^service=/);
    expect(result.args).not.toContain("docker");
  });

  test("keeps a backup's snapshot but ignores it for isolated restore collection", async () => {
    vi.stubEnv("PGSERVICE", "synthetic_backup_service");
    vi.stubEnv("BACKUP_SNAPSHOT_ID", "00000004-0000002E-1");
    vi.resetModules();
    try {
      const { evidenceQueryCommand: query } = await import("../../../scripts/backup/collect-database-evidence.mjs");
      expect(query("select 1").args[0]).toBe("service=synthetic_backup_service");
      expect(query("select 1").args.at(-1)).toContain("set transaction snapshot '00000004-0000002E-1'");
      expect(query("select 1", { container: "terroir-restore-drill-123" }).args.at(-1)).toBe("select 1");
      const copy = 'copy (select 1) to stdout';
      expect(query(copy)).toEqual({
        command: "psql",
        args: ["service=synthetic_backup_service", "-X", "-A", "-t", "-q", "-v", "ON_ERROR_STOP=1", "-c",
          `begin isolation level repeatable read read only;\nset transaction snapshot '00000004-0000002E-1';\n${copy};\ncommit`],
      });
    } finally {
      vi.unstubAllEnvs();
      vi.resetModules();
    }
  });
});

describe("restore drill: wiring", () => {
  test("is reachable as a package script, not only as a loose file", () => {
    // It sat in scripts/ with no package.json entry and no CI job, so nothing
    // pointed at it and nobody would find it during an incident.
    const pkg = JSON.parse(
      readFileSync(path.join(repoRoot, "package.json"), "utf8"),
    ) as { scripts: Record<string, string> };
    expect(pkg.scripts["drill:restore"]).toBe("node scripts/restore-drill.mjs");
  });

  test("its runbook exists where the backup runbook says it does", () => {
    expect(existsSync(path.join(repoRoot, "docs/RESTORE-DRILL.md"))).toBe(true);
  });
});
