import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  deriveCriterion,
  metadataForRequirement,
  parseCoreFeatures,
  validateCompletionRules,
  verifyFeatureLedger,
} from "../../../scripts/verify-feature-ledger.mjs";
import {
  APPROVED_SOURCE_REPLACEMENTS,
  createInitialLedger,
  generateFeatureLedger,
} from "../../../scripts/generate-feature-ledger.mjs";

const SPEC = `<project_specification>
  <prerequisites>
    - This bullet is outside the ledger
  </prerequisites>
  <core_features>
    <authentication_and_session>
      - User can sign in
      - API returns 401 without a session
    </authentication_and_session>
    <cellar_and_inventory>
      - User can view inventory
    </cellar_and_inventory>
  </core_features>
</project_specification>`;

const PLAN = "### TER-010: Complete authentication";
const TEST_COMPLETION_RULES = [[1, 3, "TER-010", "identity"]];
const C14_SOURCE_TEXTS = [
  "System captures authorized, provenance-bound lookup-task, standard-pour, and count-labor evidence with explicit versioned baseline and pilot windows, explicit versioned provisional-export intervals of any duration, stable attempt identities, integer-microsecond durations, and retained rejected and failed evidence; only a real Q7 success claim requires a closed pilot window spanning at least 2419200000000 microseconds",
  "System computes fixed Q7 metrics as at least 90 percent of trained-cohort lookup units completed within 10 seconds, at least 90 percent of captured standard-pour attempts completed within 3 seconds after wine selection, and pilot count labor no more than half of its matched baseline, preserving every eligible denominator and failure and preventing synthetic or provisional evidence from claiming a real four-week result",
  "System exports one deterministic authorization-scoped baseline and pilot CSV with fixed record order and only cohort-gated full-cohort Q7 primary summaries, generic failure totals, and coarse qualifications, keeping actor, mode, stratum, coverage, terminal-outcome, threshold-miss, quality, comparison-unit, and count-diagnostic values private",
];
const C14_ANCHOR_SOURCE_HASH =
  "83dd041b3837e6485e328f6da56cdbf52d185d1be71fca189c73fb908fd09cb0";
const C14_ANCHOR_LEDGER_HASH =
  "95cb41da20570a2cbeace625aea6740e4fd9a9039431e4f3f883fcf9ab35df8e";
const hashJson = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
const createTestLedger = () => createInitialLedger(SPEC, 3);
const verifyTestLedger = (
  ledger: ReturnType<typeof createInitialLedger>,
  plan = PLAN,
) =>
  verifyFeatureLedger(SPEC, ledger, plan, {
    approvedFeatureCount: 3,
    completionRules: TEST_COMPLETION_RULES,
  });

describe("parseCoreFeatures", () => {
  it("extracts core bullets in source order without rewriting their text", () => {
    expect(parseCoreFeatures(SPEC)).toEqual([
      {
        domain: "authentication_and_session",
        sourceOrder: 1,
        sourceText: "User can sign in",
      },
      {
        domain: "authentication_and_session",
        sourceOrder: 2,
        sourceText: "API returns 401 without a session",
      },
      {
        domain: "cellar_and_inventory",
        sourceOrder: 3,
        sourceText: "User can view inventory",
      },
    ]);
  });
});

describe("deriveCriterion", () => {
  it.each([
    ["User can sign in", "User", "can sign in"],
    [
      "GET /api/health returns 200 with JSON",
      "GET /api/health",
      "returns 200 with JSON",
    ],
    [
      "record_pour is the canonical write path",
      "record_pour",
      "is the canonical write path",
    ],
    [
      "Dev login route bypasses email auth in non-production environments only",
      "Dev login route",
      "bypasses email auth in non-production environments only",
    ],
    [
      "System auto-removes 86'd wines from published lists (or marks them gray, configurable)",
      "System",
      "auto-removes 86'd wines from published lists (or marks them gray, configurable)",
    ],
    [
      "cleanup_scan_idempotency periodically clears stale idempotency keys",
      "cleanup_scan_idempotency",
      "periodically clears stale idempotency keys",
    ],
  ])("losslessly splits %s", (sourceText, actor, action) => {
    expect(deriveCriterion(sourceText)).toEqual({
      actor,
      action,
      observableOutcome: sourceText,
      negativeCase: `Assertion is not observed: ${sourceText}`,
    });
  });

  it("rejects grammar outside the current app_spec contract", () => {
    expect(() => deriveCriterion("An unknown grammar shape")).toThrow(
      "unsupported feature assertion grammar",
    );
  });
});

describe("metadataForRequirement", () => {
  it.each([
    [1, "TER-010", "identity"],
    [57, "TER-028", "bottle-scanning"],
    [180, "TER-023", "operations"],
    [269, "TER-005", "quality-engineering"],
    [273, "TER-041", "pour-reconciliation"],
    [274, "TER-012", "tenant-access"],
    [281, "TER-014", "authorization"],
    [282, "TER-047", "pos-integrations"],
    [290, "TER-047", "pos-integrations"],
    [291, "TER-048", "offline-lookup"],
    [297, "TER-048", "offline-lookup"],
    [298, "TER-041", "physical-bottle-inventory"],
    [315, "TER-041", "physical-bottle-inventory"],
    [316, "TER-049", "csv-identity-review"],
    [317, "TER-049", "csv-identity-review"],
    [318, "TER-050", "pilot-measurement"],
    [320, "TER-050", "pilot-measurement"],
  ])("maps TER-CF-%s to its completion contract", (order, spec, owner) => {
    expect(metadataForRequirement(order)).toEqual({
      completionSpec: spec,
      evidenceOwner: owner,
    });
  });

  it("rejects requirements outside the authoritative 320", () => {
    expect(() => metadataForRequirement(321)).toThrow(
      "no completion metadata",
    );
  });
});

describe("validateCompletionRules", () => {
  it("detects a gap in a completion-rule partition", () => {
    expect(
      validateCompletionRules(
        [
          [1, 1, "TER-001", "first"],
          [3, 3, "TER-003", "third"],
        ],
        3,
      ),
    ).toContain("completion-rule gap at source order 2");
  });

  it("detects an overlap in a completion-rule partition", () => {
    expect(
      validateCompletionRules(
        [
          [1, 2, "TER-001", "first"],
          [2, 3, "TER-002", "second"],
        ],
        3,
      ),
    ).toContain("completion-rule overlap at source order 2");
  });
});

describe("createInitialLedger", () => {
  it("assigns deterministic IDs, criteria, and completion ownership", () => {
    expect(createTestLedger()).toMatchObject({
      schemaVersion: 2,
      featureCount: 3,
      budgetResolution: {
        previousMaximum: 200,
        approvedActiveCount: 3,
        decision: "all_enumerated_features_active",
        approvedBy: "product_owner",
        approvedOn: "2026-07-23",
        expandedOn: "2026-09-24",
      },
      items: [
        {
          id: "TER-CF-001",
          domain: "authentication_and_session",
          sourceOrder: 1,
          sourceText: "User can sign in",
          actor: "User",
          action: "can sign in",
          observableOutcome: "User can sign in",
          negativeCase: "Assertion is not observed: User can sign in",
          status: "active",
          completionSpec: "TER-010",
          evidenceOwner: "identity",
        },
        {
          id: "TER-CF-002",
          sourceOrder: 2,
          status: "active",
          completionSpec: "TER-010",
          evidenceOwner: "identity",
        },
        {
          id: "TER-CF-003",
          sourceOrder: 3,
          status: "active",
          completionSpec: "TER-010",
          evidenceOwner: "identity",
        },
      ],
    });
  });
});

describe("generateFeatureLedger", () => {
  const specFor = (assertions: string[]) => `<project_specification>
  <core_features>
    <inventory>
${assertions.map((assertion) => `      - ${assertion}`).join("\n")}
    </inventory>
  </core_features>
</project_specification>`;
  const rules = (count: number) => [[1, count, "TER-010", "identity"]];
  const original = [
    "User can sign in",
    "API returns 401 without a session",
    "System records inventory",
  ];

  it("preserves IDs and status while recomputing reviewed metadata", () => {
    const previousLedger = createInitialLedger(specFor(original), 3, rules(3));
    const updatedRules = [[1, 4, "TER-020", "data-platform"]];
    const generated = generateFeatureLedger({
      source: specFor([...original, "System records a stable operation"]),
      previousLedger,
      approvedFeatureCount: 4,
      completionRules: updatedRules,
      replacements: [],
    });

    expect(generated.items.map((item: { id: string }) => item.id)).toEqual([
      "TER-CF-001",
      "TER-CF-002",
      "TER-CF-003",
      "TER-CF-004",
    ]);
    expect(generated.items[0]).toMatchObject({
      id: "TER-CF-001",
      status: "active",
      completionSpec: "TER-020",
      evidenceOwner: "data-platform",
    });
    expect(
      verifyFeatureLedger(specFor([...original, "System records a stable operation"]), generated, "### TER-020: Data", {
        approvedFeatureCount: 4,
        completionRules: updatedRules,
      }),
    ).toEqual([]);
  });

  it("refuses changed source text without an explicit ID mapping", () => {
    const previousLedger = createInitialLedger(specFor(original), 3, rules(3));
    expect(() =>
      generateFeatureLedger({
        source: specFor([original[0], "API returns 403 without access", original[2]]),
        previousLedger,
        approvedFeatureCount: 3,
        completionRules: rules(3),
        replacements: [],
      }),
    ).toThrow("changed or was removed without an explicit replacement: TER-CF-002");
  });

  it("applies an explicit source replacement without changing its ID", () => {
    const previousLedger = createInitialLedger(specFor(original), 3, rules(3));
    const replacement = "API returns 403 without access";
    const generated = generateFeatureLedger({
      source: specFor([original[0], replacement, original[2]]),
      previousLedger,
      approvedFeatureCount: 3,
      completionRules: rules(3),
      replacements: [{
        id: "TER-CF-002",
        domain: "inventory",
        fromSourceText: original[1],
        toSourceText: replacement,
      }],
    });

    expect(generated.items[1]).toMatchObject({
      id: "TER-CF-002",
      sourceText: replacement,
      actor: "API",
      action: "returns 403 without access",
    });
  });

  it("rejects duplicate source assertions", () => {
    const previousLedger = createInitialLedger(specFor(original), 3, rules(3));
    expect(() =>
      generateFeatureLedger({
        source: specFor([...original, original[0]]),
        previousLedger,
        approvedFeatureCount: 4,
        completionRules: rules(4),
        replacements: [],
      }),
    ).toThrow("duplicate source assertion");
  });

  it("is idempotent after generation", () => {
    const previousLedger = createInitialLedger(specFor(original), 3, rules(3));
    const source = specFor([...original, "System records a stable operation"]);
    const options = {
      source,
      approvedFeatureCount: 4,
      completionRules: rules(4),
      replacements: [],
    };
    const first = generateFeatureLedger({ ...options, previousLedger });
    expect(generateFeatureLedger({ ...options, previousLedger: first })).toEqual(first);
  });

  it("refuses to move an existing assertion to a different source order", () => {
    const previousLedger = createInitialLedger(specFor(original), 3, rules(3));
    expect(() =>
      generateFeatureLedger({
        source: specFor([original[1], original[0], original[2]]),
        previousLedger,
        approvedFeatureCount: 3,
        completionRules: rules(3),
        replacements: [],
      }),
    ).toThrow("existing assertion TER-CF-002 moved from source order 2 to 1");
  });

  it("rejects a malformed previous ID before allocating an appended ID", () => {
    const previousLedger = createInitialLedger(specFor(original), 3, rules(3));
    previousLedger.items[2].id = "TER-CF-NaN";
    expect(() =>
      generateFeatureLedger({
        source: specFor([...original, "System records a stable operation"]),
        previousLedger,
        approvedFeatureCount: 4,
        completionRules: rules(4),
        replacements: [],
      }),
    ).toThrow("invalid previous ID: TER-CF-NaN");
  });
});

describe("verifyFeatureLedger", () => {
  it("accepts a complete ledger that matches its source", () => {
    expect(verifyTestLedger(createTestLedger())).toEqual([]);
  });

  it("keeps 320 as the default approved source count", () => {
    expect(
      verifyFeatureLedger(SPEC, createTestLedger(), PLAN).join("\n"),
    ).toContain("source feature count must remain 320");
  });

  it.each([
    {
      name: "schema version drift",
      mutate: (ledger: ReturnType<typeof createInitialLedger>) => {
        ledger.schemaVersion = 1;
      },
      expected: "schemaVersion must be 2",
    },
    {
      name: "budget resolution drift",
      mutate: (ledger: ReturnType<typeof createInitialLedger>) => {
        ledger.budgetResolution.approvedActiveCount = 200;
      },
      expected: "budgetResolution.approvedActiveCount",
    },
    {
      name: "source file drift",
      mutate: (ledger: ReturnType<typeof createInitialLedger>) => {
        ledger.sourceFile = "other-spec.txt";
      },
      expected: "sourceFile must be app_spec.txt",
    },
    {
      name: "count drift",
      mutate: (ledger: ReturnType<typeof createInitialLedger>) => {
        ledger.items.pop();
      },
      expected: "featureCount",
    },
    {
      name: "duplicate IDs",
      mutate: (ledger: ReturnType<typeof createInitialLedger>) => {
        ledger.items[1].id = ledger.items[0].id;
      },
      expected: "duplicate ID TER-CF-001",
    },
    {
      name: "stable ID drift",
      mutate: (ledger: ReturnType<typeof createInitialLedger>) => {
        ledger.items[1].id = "TER-CF-999";
      },
      expected: "id must remain TER-CF-002",
    },
    {
      name: "stable ID reassignment with the complete ID set retained",
      mutate: (ledger: ReturnType<typeof createInitialLedger>) => {
        [ledger.items[0].id, ledger.items[1].id] = [
          ledger.items[1].id,
          ledger.items[0].id,
        ];
      },
      expected: "items[0].id must remain TER-CF-001",
    },
    {
      name: "missing required fields",
      mutate: (ledger: ReturnType<typeof createInitialLedger>) => {
        ledger.items[0].evidenceOwner = "";
      },
      expected: "evidenceOwner",
    },
    {
      name: "criterion drift",
      mutate: (ledger: ReturnType<typeof createInitialLedger>) => {
        ledger.items[0].negativeCase = "Something else";
      },
      expected: "negativeCase",
    },
    {
      name: "completion spec drift",
      mutate: (ledger: ReturnType<typeof createInitialLedger>) => {
        ledger.items[0].completionSpec = "TER-999";
      },
      expected: "completionSpec",
    },
    {
      name: "evidence owner drift",
      mutate: (ledger: ReturnType<typeof createInitialLedger>) => {
        ledger.items[0].evidenceOwner = "unassigned";
      },
      expected: "evidenceOwner",
    },
    {
      name: "source text mismatch",
      mutate: (ledger: ReturnType<typeof createInitialLedger>) => {
        ledger.items[1].sourceText = "Rewritten text";
      },
      expected: "sourceText",
    },
    {
      name: "domain mismatch",
      mutate: (ledger: ReturnType<typeof createInitialLedger>) => {
        ledger.items[2].domain = "wrong_domain";
      },
      expected: "domain",
    },
    {
      name: "source order mismatch",
      mutate: (ledger: ReturnType<typeof createInitialLedger>) => {
        ledger.items[0].sourceOrder = 2;
      },
      expected: "sourceOrder",
    },
    {
      name: "unknown statuses",
      mutate: (ledger: ReturnType<typeof createInitialLedger>) => {
        ledger.items[0].status = "done";
      },
      expected: "status",
    },
    {
      name: "recognized but non-active current statuses",
      mutate: (ledger: ReturnType<typeof createInitialLedger>) => {
        ledger.items[0].status = "amended";
      },
      expected: "status must remain active",
    },
  ])("rejects $name", ({ mutate, expected }) => {
    const ledger = createTestLedger();
    mutate(ledger);

    expect(verifyTestLedger(ledger).join("\n")).toContain(expected);
  });

  it("rejects a completion spec missing from the plan", () => {
    expect(verifyTestLedger(createTestLedger(), "").join("\n")).toContain(
      "completionSpec TER-010 is absent",
    );
  });

  it("rejects unknown top-level, budget, and item provenance fields", () => {
    const ledger = createTestLedger() as ReturnType<typeof createInitialLedger> & Record<string, unknown>;
    ledger.provenanceNote = "injected";
    (ledger.budgetResolution as typeof ledger.budgetResolution & Record<string, unknown>).note = "injected";
    (ledger.items[0] as typeof ledger.items[0] & Record<string, unknown>).injectedProvenance = "injected";
    const errors = verifyTestLedger(ledger).join("\n");
    expect(errors).toContain("ledger.provenanceNote is not allowed");
    expect(errors).toContain("budgetResolution.note is not allowed");
    expect(errors).toContain("items[0].injectedProvenance is not allowed");
  });

  it("rejects duplicate source assertions at verifier level", () => {
    const duplicate = SPEC.replace(
      "User can view inventory",
      "User can sign in",
    );
    expect(verifyFeatureLedger(duplicate, createTestLedger(), PLAN, {
      approvedFeatureCount: 3,
      completionRules: TEST_COMPLETION_RULES,
    }).join("\n")).toContain("duplicate source assertion at source order 3");
  });
});

describe("feature ledger generator CLI", () => {
  const copyFixture = () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "terroir-ledger-check-"));
    fs.mkdirSync(path.join(root, "docs/plans"), { recursive: true });
    for (const file of [
      "app_spec.txt",
      "docs/feature-ledger.json",
      "docs/plans/2026-07-20-terroir-completion-spec.md",
    ]) {
      fs.copyFileSync(path.resolve(file), path.join(root, file));
    }
    return root;
  };

  it("checks canonical bytes and rejects injected metadata", () => {
    const root = copyFixture();
    try {
      const script = path.resolve("scripts/generate-feature-ledger.mjs");
      expect(spawnSync(process.execPath, [script, "--check"], { cwd: root }).status).toBe(0);

      const ledgerPath = path.join(root, "docs/feature-ledger.json");
      const ledger = JSON.parse(fs.readFileSync(ledgerPath, "utf8"));
      ledger.items[0].injectedProvenance = "fabricated";
      fs.writeFileSync(ledgerPath, `${JSON.stringify(ledger, null, 2)}\n`);
      const rejected = spawnSync(process.execPath, [script, "--check"], {
        cwd: root,
        encoding: "utf8",
      });
      expect(rejected.status).toBe(1);
      expect(rejected.stderr).toContain("generated feature ledger is stale");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("verifies generated content before replacing the checked-in ledger", () => {
    const root = copyFixture();
    try {
      const ledgerPath = path.join(root, "docs/feature-ledger.json");
      const ledger = JSON.parse(fs.readFileSync(ledgerPath, "utf8"));
      ledger.items[0].status = "done";
      const invalid = `${JSON.stringify(ledger, null, 2)}\n`;
      fs.writeFileSync(ledgerPath, invalid);

      const result = spawnSync(
        process.execPath,
        [path.resolve("scripts/generate-feature-ledger.mjs"), "--write"],
        { cwd: root, encoding: "utf8" },
      );
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("generated ledger failed verification");
      expect(fs.readFileSync(ledgerPath, "utf8")).toBe(invalid);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("checked-in feature ledger", () => {
  const source = fs.readFileSync(path.resolve("app_spec.txt"), "utf8");
  const plan = fs.readFileSync(
    path.resolve("docs/plans/2026-07-20-terroir-completion-spec.md"),
    "utf8",
  );
  const ledger = JSON.parse(
    fs.readFileSync(path.resolve("docs/feature-ledger.json"), "utf8"),
  );

  it("accounts for all 320 real features without verifier errors", () => {
    expect(ledger.items).toHaveLength(320);
    expect(verifyFeatureLedger(source, ledger, plan)).toEqual([]);
  });

  it("keeps every current requirement active and losslessly structured", () => {
    expect(new Set(ledger.items.map((item: { status: string }) => item.status))).toEqual(
      new Set(["active"]),
    );

    for (const item of ledger.items) {
      expect(deriveCriterion(item.sourceText).actor).toBe(item.actor);
      expect(`${item.actor} ${item.action}`).toBe(item.sourceText);
      expect(item.observableOutcome).toBe(item.sourceText);
      expect(item.evidenceOwner).not.toBe("unassigned");
    }
  });

  it("promotes the physical service command without renumbering it", () => {
    expect(ledger.items[150]).toMatchObject({
      id: "TER-CF-151",
      sourceOrder: 151,
      sourceText:
        "Fresh physical open, pour, spill, close, discard, and undo writes use execute_physical_bottle_command; completed version-1 receipts remain replay-only",
      completionSpec: "TER-041",
      evidenceOwner: "pour-reconciliation",
    });
  });

  it("retains all twenty amended IDs while replacing version-1 promises", () => {
    expect(APPROVED_SOURCE_REPLACEMENTS.map(({ id }) => id)).toEqual([
      "TER-CF-142", "TER-CF-143", "TER-CF-146", "TER-CF-147", "TER-CF-148",
      "TER-CF-150", "TER-CF-151", "TER-CF-152", "TER-CF-153", "TER-CF-157",
      "TER-CF-159", "TER-CF-160", "TER-CF-161", "TER-CF-164", "TER-CF-192",
      "TER-CF-193", "TER-CF-244", "TER-CF-245", "TER-CF-263", "TER-CF-273",
    ]);
    expect(APPROVED_SOURCE_REPLACEMENTS).toContainEqual({
      id: "TER-CF-244",
      domain: "database_constraints_and_functions",
      fromSourceText:
        "System treats execute_inventory_command as the canonical database entry point for new bottle-opening, pour, spill and close callers and retains record_pour only for legacy compatibility",
      toSourceText:
        "Version 2 uses the physical scalar and batch RPCs; execute_inventory_command is completed-version-1 replay-only and all other legacy writers are retired",
    });
    expect(ledger.items[243]).toMatchObject({
      id: "TER-CF-244",
      sourceOrder: 244,
      sourceText:
        "Version 2 uses the physical scalar and batch RPCs; execute_inventory_command is completed-version-1 replay-only and all other legacy writers are retired",
      completionSpec: "TER-020",
      evidenceOwner: "data-platform",
    });
  });

  it("appends the approved C04 Slice 1 contract without claiming enforcement", () => {
    expect(ledger.items.slice(273, 281).map((item: { id: string }) => item.id)).toEqual(
      Array.from({ length: 8 }, (_, index) => `TER-CF-${274 + index}`),
    );
    expect(ledger.items[278]).toMatchObject({
      id: "TER-CF-279",
      sourceText:
        "System computes effective site access in shadow mode while legacy membership helpers remain authoritative",
      completionSpec: "TER-014",
      evidenceOwner: "authorization",
    });
    expect(ledger.items[279].sourceText).toContain(
      "shadow effective-site access denies revoked or expired site or workspace membership",
    );
    expect(ledger.items.slice(273, 281).map((item: { sourceText: string }) => item.sourceText).join("\n"))
      .not.toContain("takes effect on the next request");
  });

  it("appends the approved C08 Slice A contract without claiming live activation", () => {
    expect(ledger.items.slice(281, 290).map((item: { id: string }) => item.id)).toEqual(
      Array.from({ length: 9 }, (_, index) => `TER-CF-${282 + index}`),
    );
    expect(ledger.items[281]).toMatchObject({
      id: "TER-CF-282",
      completionSpec: "TER-047",
      evidenceOwner: "pos-integrations",
    });
    expect(ledger.items[282].sourceText).toContain(
      "live activation and any public webhook route disabled",
    );
    expect(ledger.items.slice(281, 290).map((item: { sourceText: string }) => item.sourceText).join("\n"))
      .not.toContain("live-active connection");
  });

  it("appends lookup-only requirements without granting cached server authority", () => {
    expect(ledger.items.slice(290, 297).map((item: { id: string }) => item.id)).toEqual(
      Array.from({ length: 7 }, (_, index) => `TER-CF-${291 + index}`),
    );
    expect(ledger.items[290]).toMatchObject({
      completionSpec: "TER-048", evidenceOwner: "offline-lookup", status: "active",
    });
    expect(ledger.items[291].sourceText).toContain("without treating");
    expect(ledger.items[294].sourceText).toContain("when both local writes fail");
    expect(ledger.items[295].sourceText).toContain("all authorized placements");
    expect(ledger.items[296].actor).toBe("GET /api/offline-context");
    expect(plan).toContain("all seven requirements remain unimplemented");
  });

  it("appends the eighteen physical-bottle requirements as one reviewed interval", () => {
    expect(ledger.items.slice(297, 315).map((item: { id: string }) => item.id)).toEqual(
      Array.from({ length: 18 }, (_, index) => `TER-CF-${298 + index}`),
    );
    expect(ledger.items[297]).toMatchObject({
      domain: "physical_bottle_inventory",
      completionSpec: "TER-041",
      evidenceOwner: "physical-bottle-inventory",
    });
    expect(ledger.items[300].sourceText).toContain("all-or-none batch");
    expect(ledger.items[314].actor).toBe("POST /api/reconcile");
  });

  it("appends the approved C09 CSV identity-review contract without claiming implementation", () => {
    expect(ledger.items.slice(315, 317).map((item: { id: string }) => item.id)).toEqual([
      "TER-CF-316",
      "TER-CF-317",
    ]);
    expect(ledger.items[315]).toMatchObject({
      domain: "csv_identity_review",
      actor: "User",
      status: "active",
      completionSpec: "TER-049",
      evidenceOwner: "csv-identity-review",
    });
    expect(ledger.items[316]).toMatchObject({
      domain: "csv_identity_review",
      actor: "System",
      status: "active",
      completionSpec: "TER-049",
      evidenceOwner: "csv-identity-review",
    });
    expect(ledger.items[315].sourceText).toContain("including an empty set");
    expect(ledger.items[316].sourceText).toContain("optional display-only");
  });

  it("appends the approved C14 measurement contract without claiming implementation", () => {
    expect(ledger.items.slice(317).map((item: { id: string }) => item.id)).toEqual([
      "TER-CF-318",
      "TER-CF-319",
      "TER-CF-320",
    ]);
    for (const [index, sourceText] of C14_SOURCE_TEXTS.entries()) {
      expect(ledger.items[317 + index]).toMatchObject({
        domain: "pilot_measurement_capability",
        actor: "System",
        sourceText,
        status: "active",
        completionSpec: "TER-050",
        evidenceOwner: "pilot-measurement",
      });
    }
    expect(plan).toContain("### TER-050: Deliver pilot measurement capability");
    expect(plan).toContain("do not require real four-week pilot observations");
  });

  it("preserves the complete first 317 source and ledger objects from 006330bb", () => {
    expect(hashJson(parseCoreFeatures(source).slice(0, 317))).toBe(
      C14_ANCHOR_SOURCE_HASH,
    );
    expect(hashJson(ledger.items.slice(0, 317))).toBe(C14_ANCHOR_LEDGER_HASH);
  });

  it("matches the reviewed completion-spec distribution", () => {
    const counts = Object.fromEntries(
      [...new Set<string>(ledger.items.map((item: { completionSpec: string }) => item.completionSpec))]
        .sort()
        .map((spec) => [
          spec,
          ledger.items.filter(
            (item: { completionSpec: string }) => item.completionSpec === spec,
          ).length,
        ]),
    );

    expect(counts).toEqual({
      "TER-005": 13,
      "TER-010": 13,
      "TER-012": 6,
      "TER-013": 2,
      "TER-014": 7,
      "TER-015": 7,
      "TER-020": 49,
      "TER-023": 7,
      "TER-025": 27,
      "TER-026": 11,
      "TER-027": 15,
      "TER-028": 7,
      "TER-032": 1,
      "TER-033": 1,
      "TER-034": 1,
      "TER-035": 2,
      "TER-040": 28,
      "TER-041": 47,
      "TER-042": 37,
      "TER-043": 3,
      "TER-044": 15,
      "TER-047": 9,
      "TER-048": 7,
      "TER-049": 2,
      "TER-050": 3,
    });
  });

  it("marks the old progress counter as historical", () => {
    const progress = fs.readFileSync(path.resolve("claude-progress.txt"), "utf8");

    expect(progress.startsWith("# Historical progress diary")).toBe(true);
    expect(progress).toContain(
      "docs/feature-ledger.json is the authoritative completion ledger",
    );
  });

  it("still parses exactly the checked-in source bullets", () => {
    const source = fs.readFileSync(path.resolve("app_spec.txt"), "utf8");

    expect(parseCoreFeatures(source).map((item) => item.sourceText)).toEqual(
      ledger.items.map((item: { sourceText: string }) => item.sourceText),
    );
  });
});
