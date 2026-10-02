import { afterEach, describe, expect, it } from "vitest";
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const sourceScript = join(process.cwd(), "scripts/local/dev-local.sh");
const fixtures: string[] = [];

afterEach(() => {
  for (const fixture of fixtures.splice(0)) rmSync(fixture, { recursive: true, force: true });
});

describe("dev-local application origin", () => {
  it("defaults both Next and the pinned application origin to port 3000", () => {
    const result = runDevLocal();

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("NEXT_PUBLIC_APP_URL=http://127.0.0.1:3000");
    expect(result.stdout).toContain("ARGS\tdev");
  });

  it.each([
    [["-p", "3100", "--webpack"], "3100"],
    [["--port", "3101"], "3101"],
    [["--port=3102"], "3102"],
    [["-p3103"], "3103"],
  ])("pins the origin to explicit Next arguments %j", (args, port) => {
    const result = runDevLocal(args);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain(`NEXT_PUBLIC_APP_URL=http://127.0.0.1:${port}`);
    expect(result.stdout).toContain(`ARGS\tdev\t${args.join("\t")}`);
  });

  it("uses PORT only when no explicit CLI port overrides it", () => {
    const fromEnvironment = runDevLocal([], "3104");
    const overridden = runDevLocal(["--port", "3105"], "3999");

    expect(fromEnvironment.status).toBe(0);
    expect(fromEnvironment.stdout).toContain("NEXT_PUBLIC_APP_URL=http://127.0.0.1:3104");
    expect(overridden.status).toBe(0);
    expect(overridden.stdout).toContain("NEXT_PUBLIC_APP_URL=http://127.0.0.1:3105");
    expect(overridden.stdout).toContain("ARGS\tdev\t--port\t3105");
  });

  it.each([
    [["--port"], undefined],
    [["-p"], undefined],
    [["--port="], undefined],
    [["--port=abc"], undefined],
    [["--port", "70000"], undefined],
    [["-p0"], undefined],
    [["--port", "3100", "-p3101"], undefined],
    [[], "not-a-port"],
  ])("refuses malformed or ambiguous port input before launch: %j PORT=%s", (args, port) => {
    const result = runDevLocal(args, port);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("dev-local: REFUSING");
    expect(result.stdout).not.toContain("LAUNCH");
    expect(result.statusInvoked).toBe(false);
  });
});

function runDevLocal(args: string[] = [], port?: string) {
  const root = mkdtempSync(join(tmpdir(), "terroir-dev-local-port-"));
  fixtures.push(root);
  const bin = join(root, "bin");
  const localScripts = join(root, "scripts", "local");
  mkdirSync(bin, { recursive: true });
  mkdirSync(localScripts, { recursive: true });
  cpSync(sourceScript, join(localScripts, "dev-local.sh"));
  chmodSync(join(localScripts, "dev-local.sh"), 0o755);
  executable(join(bin, "npx"), `#!/usr/bin/env bash
touch "$PWD/status-invoked"
printf '%s\\n' '{"API_URL":"http://127.0.0.1:57321","PUBLISHABLE_KEY":"local-publishable","SERVICE_ROLE_KEY":"local-service"}'
`);
  executable(join(bin, "pnpm"), `#!/usr/bin/env bash
printf 'LAUNCH\\nNEXT_PUBLIC_APP_URL=%s\\nARGS' "$NEXT_PUBLIC_APP_URL"
printf '\\t%s' "$@"
printf '\\n'
`);
  executable(join(localScripts, "assert-local-db.sh"), `#!/usr/bin/env bash
test "$NEXT_PUBLIC_SUPABASE_URL" = "http://127.0.0.1:57321"
`);
  const environment: NodeJS.ProcessEnv = {
    ...process.env,
    PATH: `${bin}:${process.env.PATH}`,
    ACTIVE_RESTAURANT_COOKIE_SECRET: "local-cookie-secret",
    OPENROUTER_API_KEY: "local-provider-placeholder",
  };
  if (port === undefined) delete environment.PORT;
  else environment.PORT = port;
  const result = spawnSync(join(localScripts, "dev-local.sh"), args, {
    cwd: root,
    encoding: "utf8",
    env: environment,
  });
  return { ...result, statusInvoked: existsSync(join(root, "status-invoked")) };
}

function executable(path: string, contents: string) {
  writeFileSync(path, contents, { mode: 0o755 });
}
