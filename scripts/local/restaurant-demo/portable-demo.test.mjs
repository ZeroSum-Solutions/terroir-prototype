import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  EXECUTION_ACK,
  assertSafeSourcePath,
  parseLauncherArgs,
  parseLocalStatus,
  rewriteSupabaseConfig,
} from "./launcher.mjs";
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
  assert.equal(dry.projectId, "terroir-demo-portable-a");
  assert.throws(() => parseLauncherArgs(baseArgs.map((value) => value.startsWith("--project-id=") ? "--project-id=production" : value)), /disposable namespace/);
  assert.throws(() => parseLauncherArgs(baseArgs.map((value) => value === "--db-port=61322" ? "--db-port=61321" : value)), /ports must be unique/);
  assert.throws(() => parseLauncherArgs([...baseArgs, "--execute"]), /acknowledgement/);
  assert.throws(
    () => parseLauncherArgs([...baseArgs, "--execute", `--ack=${EXECUTION_ACK}`]),
    /execution is disabled pending independent Docker resource ownership admission/,
  );
});

test("source materialization refuses dotenv, traversal, Git, dependencies, and temp paths", () => {
  assert.equal(assertSafeSourcePath("src/app/page.tsx"), "src/app/page.tsx");
  for (const value of [".env.local", ".env", "../outside", ".git/config", "node_modules/a", ".tmp/output.json", "/absolute"]) {
    assert.throws(() => assertSafeSourcePath(value));
  }
});

test("Supabase config rewrite changes only the isolated project, ports, seed, and redirects", () => {
  const source = `project_id = "retained"\n[api]\nport = 1\n[db]\nport = 2\nshadow_port = 3\n[db.seed]\nenabled = true\n[studio]\nport = 4\n[local_smtp]\nport = 5\n[auth]\nsite_url = "http://127.0.0.1:3000"\nadditional_redirect_urls = []\n`;
  const settings = parseLauncherArgs(baseArgs);
  const output = rewriteSupabaseConfig(source, settings);
  assert.match(output, /project_id = "terroir-demo-portable-a"/);
  assert.match(output, /\[api]\nport = 61321/);
  assert.match(output, /\[db]\nport = 61322\nshadow_port = 61320/);
  assert.match(output, /\[db.seed]\nenabled = false/);
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
