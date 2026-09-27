import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import {
  PHYSICAL_V2_ACK,
  PHYSICAL_V2_PROJECT_ID,
  resolveOwnedPhysicalV2Config,
  validatePhysicalV2Settings,
} from "./admission";

const config = {
  projectId: PHYSICAL_V2_PROJECT_ID,
  apiPort: 59321,
  dbPort: 59322,
};

function environment(
  overrides: Partial<NodeJS.ProcessEnv> = {},
): NodeJS.ProcessEnv {
  return {
    NODE_ENV: "test",
    NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:59321",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "publishable-local-test-key",
    SUPABASE_SERVICE_ROLE_KEY: "service-local-test-key",
    DEV_BYPASS_EMAIL: "owner+physical-v2@terroir.test",
    PHYSICAL_V2_DISPOSABLE_ACK: PHYSICAL_V2_ACK,
    PHYSICAL_V2_EXPECTED_DB_CONTAINER_ID: "a".repeat(64),
    PHYSICAL_V2_APP_PORT: "3107",
    ...overrides,
  };
}

describe("physical-v2 target settings", () => {
  test("accepts only the dedicated checkout identity and exact loopback URL", () => {
    expect(validatePhysicalV2Settings(environment(), config)).toMatchObject({
      projectId: PHYSICAL_V2_PROJECT_ID,
      supabaseUrl: "http://127.0.0.1:59321",
      databaseContainerId: "a".repeat(64),
      baseURL: "http://127.0.0.1:3107",
    });
  });

  test.each([
    ["retained repo stack", { ...config, projectId: "terroir-vw-local", apiPort: 57321 }],
    ["retained browser stack", { ...config, projectId: "terroir-c04-browser-0154", apiPort: 58321 }],
    ["generic loopback project", { ...config, projectId: "some-local-stack" }],
  ])("refuses %s", (_label, candidate) => {
    expect(() => validatePhysicalV2Settings(environment(), candidate)).toThrow(/refus/i);
  });

  test.each([
    "http://localhost:59321",
    "http://0.0.0.0:59321",
    "http://127.0.0.1:57321",
    "https://127.0.0.1:59321",
    "https://example.supabase.co",
  ])("refuses non-exact target URL %s", (url) => {
    expect(() => validatePhysicalV2Settings(
      environment({ NEXT_PUBLIC_SUPABASE_URL: url }),
      config,
    )).toThrow(/must be exactly/i);
  });

  test("requires a deliberate disposable acknowledgement", () => {
    expect(() => validatePhysicalV2Settings(
      environment({ PHYSICAL_V2_DISPOSABLE_ACK: "yes" }),
      config,
    )).toThrow(/must equal/i);
  });

  test("requires the exact admitted database container ID", () => {
    expect(() => validatePhysicalV2Settings(
      environment({ PHYSICAL_V2_EXPECTED_DB_CONTAINER_ID: "a".repeat(63) }),
      config,
    )).toThrow(/64-character/i);
  });

  test("fails closed when access material is missing", () => {
    expect(() => validatePhysicalV2Settings(
      environment({ SUPABASE_SERVICE_ROLE_KEY: "" }),
      config,
    )).toThrow(/SUPABASE_SERVICE_ROLE_KEY/);
  });
});

describe("physical-v2 runtime-owned config", () => {
  let temporaryRoot = "";

  beforeAll(() => {
    const repoTemporaryRoot = path.resolve(".tmp");
    mkdirSync(repoTemporaryRoot, { recursive: true });
    temporaryRoot = mkdtempSync(path.join(repoTemporaryRoot, "physical-v2-admission-"));
  });

  afterAll(() => {
    if (temporaryRoot) rmSync(temporaryRoot, { recursive: true });
  });

  test("accepts a regular config physically owned by the runtime root", () => {
    const runtime = makeRuntime("owned");
    expect(resolveOwnedPhysicalV2Config(runtime))
      .toBe(path.join(runtime, "supabase", "config.toml"));
  });

  test("accepts a symlink alias of the whole runtime root", () => {
    const runtime = makeRuntime("aliased");
    const alias = path.join(temporaryRoot, "runtime-alias");
    symlinkSync(runtime, alias, "dir");
    expect(resolveOwnedPhysicalV2Config(alias))
      .toBe(path.join(runtime, "supabase", "config.toml"));
  });

  test("refuses a config.toml symlink to an external file", () => {
    const runtime = path.join(temporaryRoot, "external-config-runtime");
    const supabase = path.join(runtime, "supabase");
    mkdirSync(supabase, { recursive: true });
    const externalConfig = path.join(temporaryRoot, "external-config.toml");
    writeFileSync(externalConfig, "project_id = \"external\"\n");
    symlinkSync(externalConfig, path.join(supabase, "config.toml"));
    expect(() => resolveOwnedPhysicalV2Config(runtime)).toThrow(/symlinked/i);
  });

  test("refuses a supabase directory symlink to an external directory", () => {
    const runtime = path.join(temporaryRoot, "external-directory-runtime");
    const externalSupabase = path.join(temporaryRoot, "external-supabase");
    mkdirSync(runtime, { recursive: true });
    mkdirSync(externalSupabase, { recursive: true });
    writeFileSync(
      path.join(externalSupabase, "config.toml"),
      "project_id = \"external\"\n",
    );
    symlinkSync(externalSupabase, path.join(runtime, "supabase"), "dir");
    expect(() => resolveOwnedPhysicalV2Config(runtime)).toThrow(/outside/i);
  });

  function makeRuntime(name: string): string {
    const runtime = path.join(temporaryRoot, name);
    const supabase = path.join(runtime, "supabase");
    mkdirSync(supabase, { recursive: true });
    writeFileSync(
      path.join(supabase, "config.toml"),
      `project_id = "${PHYSICAL_V2_PROJECT_ID}"\n`,
    );
    return runtime;
  }
});
