// Explicit reviewed dry-run derivative, never a generic migration runner.
// Prints SQL only; a separately admitted operator must execute and verify it.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

export function prepareHostedDryRun(source) {
  assert.equal((source.match(/^begin;$/gm) ?? []).length, 1);
  assert.equal((source.match(/^commit;$/gm) ?? []).length, 1);
  assert.match(source, /\ncommit;\n$/);
  assert.equal((source.match(/C04_0165_APPLIED_STORAGE_POLICY_SHA256/g) ?? []).length, 1);
  // The only two edits: success receipt becomes dry-run receipt, and the
  // immutable terminal COMMIT becomes explicit ROLLBACK. Ledger insert rolls back.
  return source
    .replace("C04_0165_APPLIED_STORAGE_POLICY_SHA256", "C04_0165_DRY_RUN_STORAGE_POLICY_SHA256")
    .replace(/\ncommit;\n$/, "\nrollback;\n");
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  const source = readFileSync(new URL("../../migrations/0165_staff_cost_seal_contract.sql", import.meta.url), "utf8");
  const digest = createHash("sha256").update(source).digest("hex");
  assert.equal(process.argv[2], digest, "supply the independently reviewed exact forward SHA256");
  process.stdout.write(`-- C04_0165_EXPLICIT_DRY_RUN_SOURCE_SHA256|${digest}\n${prepareHostedDryRun(source)}`);
}
