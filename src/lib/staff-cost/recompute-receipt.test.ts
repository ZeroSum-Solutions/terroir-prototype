import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  createRecomputeReceipt,
  parseRecomputeReceipt,
} from "./recompute-receipt";

describe("recompute receipts", () => {
  it.each([
    "cellar_health_recompute",
    "pricing_recommendations_recompute",
  ] as const)("creates the exact cost-free %s receipt", (kind) => {
    expect(createRecomputeReceipt(kind)).toEqual({
      version: 1,
      kind,
      status: "succeeded",
    });
  });

  it.each([
    { classified: 1 },
    { segments: { healthy: 1 } },
    { recommended: 1 },
    { classes: { hold: 1 } },
    { reason: "cost-derived" },
    { evidence: { marginPct: 75 } },
    { cost: 20 },
    { margin: 75 },
    { extra: true },
  ])("rejects legacy or additional output keys: %j", (extra) => {
    expect(parseRecomputeReceipt({
      version: 1,
      kind: "cellar_health_recompute",
      status: "succeeded",
      ...extra,
    }, "cellar_health_recompute")).toBeNull();
  });

  it("rejects a valid receipt for the wrong recompute kind", () => {
    expect(parseRecomputeReceipt({
      version: 1,
      kind: "pricing_recommendations_recompute",
      status: "succeeded",
    }, "cellar_health_recompute")).toBeNull();
  });

  it("keeps the operational seeder on the cost-free receipt contract", () => {
    const seedSource = readFileSync(
      resolve("scripts/seed-local-operational.ts"),
      "utf8",
    );

    expect(seedSource).not.toMatch(
      /\b(?:health\.(?:classified|segments)|pricing\.(?:recommended|classes))\b/,
    );
    expect(seedSource).toContain("health.kind, health.status");
    expect(seedSource).toContain("pricing.kind, pricing.status");
  });
});
