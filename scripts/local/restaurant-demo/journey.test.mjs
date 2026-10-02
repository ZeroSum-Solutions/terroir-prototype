import assert from "node:assert/strict";
import test from "node:test";
import { parseJourneyArgs } from "./journey.mjs";

const required = [
  "--ready-json=/tmp/demo-ready.json",
  "--project-root=/tmp/demo-runtime",
  "--evidence-dir=/tmp/demo-evidence",
];

test("the complete journey defaults to mobile and accepts an explicit desktop run", () => {
  assert.equal(parseJourneyArgs(required).viewportWidth, 390);
  assert.equal(parseJourneyArgs([...required, "--viewport-width=1200"]).viewportWidth, 1200);
  assert.equal(parseJourneyArgs([...required, "--viewport-width=390"]).viewportWidth, 390);
});

test("the journey rejects unsupported or ambiguous viewport settings", () => {
  for (const value of ["320", "0", "desktop", "1200.5"]) {
    assert.throws(() => parseJourneyArgs([...required, `--viewport-width=${value}`]), /390 or 1200/);
  }
  assert.throws(() => parseJourneyArgs([...required, "--viewport-width=390", "--viewport-width=1200"]), /duplicate argument/);
});
