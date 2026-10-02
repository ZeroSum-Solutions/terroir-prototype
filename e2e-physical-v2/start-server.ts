import { spawn } from "node:child_process";
import { admitPhysicalV2Target } from "./admission";

const admission = await admitPhysicalV2Target();
const child = spawn(
  "scripts/local/dev-local.sh",
  [`--port=${admission.settings.appPort}`],
  {
    cwd: process.cwd(),
    env: process.env,
    stdio: "inherit",
  },
);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => child.kill(signal));
}

child.on("error", (error) => {
  console.error(`physical-v2 server wrapper failed: ${error.message}`);
  process.exitCode = 1;
});
child.on("exit", (code, signal) => {
  process.exitCode = signal ? 1 : (code ?? 1);
});
