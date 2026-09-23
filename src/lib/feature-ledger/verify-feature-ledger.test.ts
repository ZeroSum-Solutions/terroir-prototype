import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

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
  ])("maps TER-CF-%s to its completion contract", (order, spec, owner) => {
    expect(metadataForRequirement(order)).toEqual({
      completionSpec: spec,
      evidenceOwner: owner,
    });
  });

  it("rejects requirements outside the authoritative 281", () => {
    expect(() => metadataForRequirement(282)).toThrow(
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
        expandedOn: "2026-09-23",
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

  it("keeps 281 as the default approved source count", () => {
    expect(
      verifyFeatureLedger(SPEC, createTestLedger(), PLAN).join("\n"),
    ).toContain("source feature count must remain 281");
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

  it("accounts for all 281 real features without verifier errors", () => {
    expect(ledger.items).toHaveLength(281);
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

  it("promotes the atomic service-mutation command without renumbering it", () => {
    expect(ledger.items[150]).toMatchObject({
      id: "TER-CF-151",
      sourceOrder: 151,
      sourceText:
        "System applies bottle-opening, pour, spill and close operations through the atomic execute_inventory_command database function",
      completionSpec: "TER-041",
      evidenceOwner: "pour-reconciliation",
    });
  });

  it("retains TER-CF-244 while replacing the superseded canonical pour writer", () => {
    expect(APPROVED_SOURCE_REPLACEMENTS).toContainEqual({
      id: "TER-CF-244",
      domain: "database_constraints_and_functions",
      fromSourceText: "record_pour is the canonical pour-write entry point",
      toSourceText:
        "System treats execute_inventory_command as the canonical database entry point for new bottle-opening, pour, spill and close callers and retains record_pour only for legacy compatibility",
    });
    expect(ledger.items[243]).toMatchObject({
      id: "TER-CF-244",
      sourceOrder: 244,
      sourceText:
        "System treats execute_inventory_command as the canonical database entry point for new bottle-opening, pour, spill and close callers and retains record_pour only for legacy compatibility",
      completionSpec: "TER-020",
      evidenceOwner: "data-platform",
    });
  });

  it("appends the approved C04 Slice 1 contract without claiming enforcement", () => {
    expect(ledger.items.slice(273).map((item: { id: string }) => item.id)).toEqual(
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
    expect(ledger.items.slice(273).map((item: { sourceText: string }) => item.sourceText).join("\n"))
      .not.toContain("takes effect on the next request");
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
      "TER-041": 29,
      "TER-042": 37,
      "TER-043": 3,
      "TER-044": 15,
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
