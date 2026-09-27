import { defineConfig } from "@playwright/test";
import {
  PHYSICAL_V2_PROJECT_ID,
  resolveOwnedPhysicalV2Config,
  validatePhysicalV2Settings,
} from "./e2e-physical-v2/admission";
import { readFileSync } from "node:fs";

const configText = readFileSync(resolveOwnedPhysicalV2Config(process.cwd()), "utf8");
const projectId = configText.match(/^project_id\s*=\s*"([^"]+)"/m)?.[1] ?? "";
const apiPort = Number(configText.match(/^\[api]\s*[\s\S]*?^port\s*=\s*(\d+)/m)?.[1]);
const dbPort = Number(configText.match(/^\[db]\s*[\s\S]*?^port\s*=\s*(\d+)/m)?.[1]);
const settings = validatePhysicalV2Settings(process.env, { projectId, apiPort, dbPort });

if (settings.projectId !== PHYSICAL_V2_PROJECT_ID) {
  throw new Error("physical-v2 config did not admit the dedicated runtime checkout");
}

export default defineConfig({
  testDir: "./e2e-physical-v2",
  testMatch: ["d1-physical-bottle.test.ts", "d1-command-recovery.test.ts"],
  globalSetup: "./e2e-physical-v2/global-setup.ts",
  reporter: [["list"], ["./e2e/no-skips-reporter.ts"]],
  timeout: 60_000,
  workers: 1,
  retries: 0,
  use: {
    baseURL: settings.baseURL,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    video: "retain-on-failure",
  },
  webServer: {
    command: "node_modules/.bin/tsx e2e-physical-v2/start-server.ts",
    port: settings.appPort,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
