import { describe, expect, it } from "vitest";
import {
  MIN_REAL_PILOT_SPAN_US,
  calculatePilotMeasurement,
  mapRuntimeRejection,
  type CountPhaseEvidence,
  type CountSegment,
  type LookupAttempt,
  type PourAttempt,
  type SuppliedEvidenceBundle,
} from "./calculate";
import { exportSyntheticPilotCsv } from "./export";

const accepted = { status: "accepted", evidenceOrigin: "synthetic-fixture" } as const;

function closedInterval(durationUs: number, origin = "origin-a") {
  return {
    startOriginId: origin,
    endOriginId: origin,
    startUs: 0,
    endUs: durationUs,
  };
}

function baseBundle(
  overrides: Partial<SuppliedEvidenceBundle> = {},
): SuppliedEvidenceBundle {
  return {
    reportFingerprint: "report-1",
    contractVersion: "q7-v1",
    activationVersion: "activation-1",
    activatedVenueSetFingerprint: "venues-full",
    evidenceCutoffUs: 9_000_000_000_000,
    origin: "synthetic-fixture",
    windows: {
      baseline: { startUs: 0, endUs: 1_000_000, closed: true },
      pilot: { startUs: 2_000_000, endUs: 3_000_000, closed: false },
    },
    lookupAssignments: [],
    pourAttempts: [],
    inventoryReceipts: [],
    countUnits: [],
    health: {
      lookupKnownGap: false,
      pourKnownGap: false,
      countKnownGap: false,
    },
    ...overrides,
  };
}

function lookupAttempt(
  attemptId: string,
  durationUs: number,
  overrides: Partial<LookupAttempt> = {},
): LookupAttempt {
  return {
    attemptId,
    payloadFingerprint: `payload-${attemptId}`,
    phase: "pilot",
    mode: "search",
    terminalOutcome: "succeeded",
    interval: closedInterval(durationUs),
    validation: accepted,
    ...overrides,
  };
}

function pourAttempt(
  attemptId: string,
  overrides: Partial<PourAttempt> = {},
): PourAttempt {
  return {
    attemptId,
    intentId: "intent-1",
    operationId: "operation-1",
    payloadFingerprint: `payload-${attemptId}`,
    actorId: "actor-1",
    cohortEligible: true,
    phase: "baseline",
    terminalOutcome: "succeeded",
    interval: closedInterval(3_000_000),
    validation: accepted,
    ...overrides,
  };
}

function phase(
  phaseName: "baseline" | "pilot",
  rosterActorIds: string[],
  segments: CountSegment[],
  overrides: Partial<CountPhaseEvidence> = {},
): CountPhaseEvidence {
  return {
    phase: phaseName,
    scopeFingerprint: "scope-1",
    itemDenominator: 100,
    inventoryCutoffRule: "cutoff-v1",
    reconciliationDefinition: "reconcile-v1",
    rosterActorIds,
    reconciliationComplete: true,
    segments,
    ...overrides,
  };
}

function segment(
  segmentId: string,
  actorId: string,
  durationUs: number,
  overrides: Partial<CountSegment> = {},
): CountSegment {
  return {
    segmentId,
    attemptId: `attempt-${segmentId}`,
    payloadFingerprint: `payload-${segmentId}`,
    actorId,
    terminalOutcome: "succeeded",
    interval: closedInterval(durationUs, `origin-${segmentId}`),
    recordedAtUs: 8_000_000_000_000,
    validation: accepted,
    kind: "work",
    ...overrides,
  };
}

function actorIds(prefix: string, count: number): string[] {
  return Array.from({ length: count }, (_, index) => `${prefix}-${index + 1}`);
}

function staffedPhase(
  phaseName: "baseline" | "pilot",
  actors: string[],
  prefix: string,
  overrides: Partial<CountPhaseEvidence> = {},
): CountPhaseEvidence {
  return phase(
    phaseName,
    actors,
    actors.map((actor, index) => segment(`${prefix}-${index + 1}`, actor, 10)),
    overrides,
  );
}

function syntheticCountRow(bundle: SuppliedEvidenceBundle): Record<string, string> {
  const [header, ...rows] = exportSyntheticPilotCsv(calculatePilotMeasurement(bundle)).csv
    .slice(1)
    .split("\r\n");
  const columns = header.split(",");
  const count = rows.find((row) => row.split(",")[5] === "count");
  if (!count) throw new Error("Synthetic export omitted count row");
  return Object.fromEntries(count.split(",").map((value, index) => [columns[index], value]));
}

describe("closed vocabularies and interval consistency", () => {
  it("maps every runtime rejection exactly and preserves distinct context failures", () => {
    expect(mapRuntimeRejection("authorization-denied")).toBe("denied");
    expect(mapRuntimeRejection("authorization-revoked")).toBe("denied");
    expect(mapRuntimeRejection("context-not-yet-valid")).toBe("context-not-yet-valid");
    expect(mapRuntimeRejection("context-expired")).toBe("context-expired");
    expect(mapRuntimeRejection("context-version-mismatched")).toBe(
      "context-version-mismatched",
    );
    expect(mapRuntimeRejection("context-improperly-reissued")).toBe(
      "context-improperly-reissued",
    );
    expect(mapRuntimeRejection("clock-divergence")).toBe("unverifiable-clock");
    expect(mapRuntimeRejection("impossible-server-receipt-order")).toBe(
      "unverifiable-clock",
    );
    expect(mapRuntimeRejection("replay-too-late")).toBe("replay-too-late");
    expect(mapRuntimeRejection("open-interval-lost")).toBe("interrupted");
    expect(mapRuntimeRejection("cross-window-capture")).toBe("cross-window");
    expect(mapRuntimeRejection("synthetic-on-live-path")).toBe("invalid-provenance");
    expect(mapRuntimeRejection("client-asserted-provenance")).toBe("invalid-provenance");
    expect(mapRuntimeRejection("immutable-identity-conflict")).toBe("conflicted");
    expect(() => mapRuntimeRejection("new-reason")).toThrow(/unknown runtime rejection/i);
  });

  it("keeps a persisted closed interval but maps an open or cross-origin interval to interrupted", () => {
    const result = calculatePilotMeasurement(
      baseBundle({
        lookupAssignments: [
          {
            assignmentId: "closed",
            actorId: "actor-1",
            cohortEligible: true,
            phase: "pilot",
            assignedMode: "search",
            attempts: [lookupAttempt("closed", 3_000)],
          },
          {
            assignmentId: "open",
            actorId: "actor-2",
            cohortEligible: true,
            phase: "pilot",
            assignedMode: "search",
            attempts: [
              lookupAttempt("open", 3_000, {
                interval: {
                  startOriginId: "before-reload",
                  endOriginId: "after-reload",
                  startUs: 1_000,
                  endUs: 4_000,
                },
              }),
            ],
          },
        ],
      }),
    );

    expect(result.lookup.pilot.numerator).toBe(1);
    expect(result.lookup.pilot.denominator).toBe(2);
    expect(result.lookup.pilot.outcomeCounts.interrupted).toBe(1);
  });

  it("treats a lower numeric boundary after an origin reset as lost duration across metrics", () => {
    const resetInterval = {
      startOriginId: "before-reload",
      endOriginId: "after-reload",
      startUs: 5_000_000,
      endUs: 500_000,
    };
    const lostOpenInterval = {
      status: "rejected",
      reason: "open-interval-lost",
      evidenceOrigin: "synthetic-fixture",
    } as const;
    const result = calculatePilotMeasurement(
      baseBundle({
        lookupAssignments: [
          {
            assignmentId: "reset-lookup",
            actorId: "actor-1",
            cohortEligible: true,
            phase: "pilot",
            assignedMode: "search",
            attempts: [
              lookupAttempt("reset-lookup", 1, {
                interval: resetInterval,
                validation: lostOpenInterval,
              }),
            ],
          },
        ],
        pourAttempts: [
          pourAttempt("reset-pour", {
            phase: "pilot",
            interval: resetInterval,
            validation: lostOpenInterval,
          }),
        ],
        countUnits: [
          {
            unitId: "reset-count",
            rosterPolicy: "same-workers",
            baseline: phase("baseline", ["actor-1"], [
              segment("reset-baseline", "actor-1", 1, {
                terminalOutcome: "interrupted",
                interval: resetInterval,
              }),
            ]),
            pilot: phase("pilot", ["actor-1"], [
              segment("reset-pilot", "actor-1", 1, {
                terminalOutcome: "interrupted",
                interval: resetInterval,
                validation: lostOpenInterval,
              }),
            ]),
          },
        ],
      }),
    );

    expect(result.lookup.pilot).toMatchObject({ numerator: 0, denominator: 1 });
    expect(result.lookup.pilot.outcomeCounts.interrupted).toBe(1);
    expect(result.pour.pilot).toMatchObject({ numerator: 0, denominator: 1 });
    expect(result.pour.pilot.outcomeCounts.interrupted).toBe(1);
    expect(result.count).toMatchObject({
      baselineLaborUs: 0,
      pilotLaborUs: 0,
      panelStatus: "non-evaluable",
    });
    expect(result.count.outcomeCounts.interrupted).toBe(2);
  });

  it("rejects a descending interval instead of converting it to a failure category", () => {
    expect(() =>
      calculatePilotMeasurement(
        baseBundle({
          pourAttempts: [
            pourAttempt("descending", {
              interval: {
                startOriginId: "origin-a",
                endOriginId: "origin-a",
                startUs: 10,
                endUs: 9,
              },
            }),
          ],
        }),
      ),
    ).toThrow(/ends before/i);
  });

  it("rejects unknown terminal outcomes before arithmetic", () => {
    expect(() =>
      calculatePilotMeasurement(
        baseBundle({
          pourAttempts: [pourAttempt("a1", { terminalOutcome: "future-outcome" })],
        }),
      ),
    ).toThrow(/unknown terminal outcome/i);
  });

  it("rejects mixed or relabeled evidence origins before arithmetic", () => {
    expect(() =>
      calculatePilotMeasurement(
        baseBundle({
          pourAttempts: [
            pourAttempt("a1", {
              validation: { status: "accepted", evidenceOrigin: "runtime-validated-real" },
            }),
          ],
        }),
      ),
    ).toThrow(/evidence origin/i);
  });

  it("validates vocabulary inside an incomplete count pair", () => {
    expect(() =>
      calculatePilotMeasurement(
        baseBundle({
          countUnits: [
            {
              unitId: "missing-pilot",
              rosterPolicy: "same-workers",
              baseline: phase("baseline", ["a"], [
                segment("bad", "a", 10, { terminalOutcome: "future-outcome" }),
              ]),
            },
          ],
        }),
      ),
    ).toThrow(/unknown terminal outcome/i);
  });
});

describe("attempt and operation identity", () => {
  it.each([
    { terminalOutcome: "succeeded" as const, numerator: 1 },
    { terminalOutcome: "no-result" as const, numerator: 0 },
  ])(
    "deduplicates exact lookup replay while retaining the original $terminalOutcome outcome",
    ({ terminalOutcome, numerator }) => {
      const original = lookupAttempt("lookup-replay", 1, { terminalOutcome });
      const result = calculatePilotMeasurement(
        baseBundle({
          lookupAssignments: [
            {
              assignmentId: "assignment-1",
              actorId: "actor-1",
              cohortEligible: true,
              phase: "pilot",
              assignedMode: "search",
              attempts: [original, { ...original }],
            },
          ],
        }),
      );

      expect(result.lookup.pilot).toMatchObject({ denominator: 1, numerator });
      expect(result.lookup.pilot.outcomeCounts[terminalOutcome]).toBe(1);
    },
  );

  it("rejects changed lookup redelivery and cross-assignment attempt reuse", () => {
    const original = lookupAttempt("lookup-conflict", 1);
    const changed = {
      ...original,
      payloadFingerprint: "changed-payload",
      terminalOutcome: "no-result" as const,
    };
    const assignment = {
      assignmentId: "assignment-1",
      actorId: "actor-1",
      cohortEligible: true,
      phase: "pilot" as const,
      assignedMode: "search",
      attempts: [original, changed],
    };

    expect(() =>
      calculatePilotMeasurement(baseBundle({ lookupAssignments: [assignment] })),
    ).toThrow(/conflicting lookup attempt delivery/i);
    expect(original).toMatchObject({
      payloadFingerprint: "payload-lookup-conflict",
      terminalOutcome: "succeeded",
    });

    expect(() =>
      calculatePilotMeasurement(
        baseBundle({
          lookupAssignments: [
            { ...assignment, attempts: [original] },
            {
              ...assignment,
              assignmentId: "assignment-2",
              actorId: "actor-2",
              cohortEligible: false,
              attempts: [{ ...original }],
            },
          ],
        }),
      ),
    ).toThrow(/conflicting lookup attempt delivery/i);
  });

  it.each([
    {
      name: "exact redelivery",
      attempts: [pourAttempt("a1"), pourAttempt("a1")],
      denominator: 1,
      commits: 1,
    },
    {
      name: "local failure then retry",
      attempts: [
        pourAttempt("a1", { terminalOutcome: "storage-failed" }),
        pourAttempt("a2"),
      ],
      denominator: 2,
      commits: 1,
    },
    {
      name: "acknowledgement lost and exact replay",
      attempts: [
        pourAttempt("a1", { terminalOutcome: "incomplete" }),
        pourAttempt("a1", { terminalOutcome: "incomplete" }),
      ],
      denominator: 1,
      commits: 1,
    },
    {
      name: "user retry after lost acknowledgement",
      attempts: [
        pourAttempt("a1", { terminalOutcome: "incomplete" }),
        pourAttempt("a2"),
      ],
      denominator: 2,
      commits: 1,
    },
    {
      name: "retry after acknowledged success",
      attempts: [pourAttempt("a1"), pourAttempt("a2")],
      denominator: 2,
      commits: 1,
      conflicts: 1,
    },
    {
      name: "changed payload under one attempt identity",
      attempts: [
        pourAttempt("a1"),
        pourAttempt("a1", { payloadFingerprint: "changed" }),
      ],
      denominator: 1,
      commits: 1,
      conflictingDeliveries: 1,
    },
    {
      name: "operation reused by another intent",
      attempts: [
        pourAttempt("a1"),
        pourAttempt("a2", { intentId: "intent-2", actorId: "actor-2" }),
      ],
      denominator: 2,
      commits: 1,
      conflicts: 1,
    },
    {
      name: "new independent pour",
      attempts: [
        pourAttempt("a1"),
        pourAttempt("a2", {
          intentId: "intent-2",
          operationId: "operation-2",
          actorId: "actor-2",
        }),
      ],
      denominator: 2,
      commits: 2,
    },
  ])("accounts for $name", ({ attempts, denominator, commits, ...expected }) => {
    const operationIds = [...new Set(attempts.map((attempt) => attempt.operationId))];
    const result = calculatePilotMeasurement(
      baseBundle({
        pourAttempts: attempts,
        inventoryReceipts: operationIds.map((operationId) => ({
          operationId,
          commitCount: 1,
        })),
      }),
    );

    expect(result.pour.baseline.denominator).toBe(denominator);
    expect(result.identity.inventoryCommitCount).toBe(commits);
    expect(result.identity.conflictedAttemptCount).toBe(expected.conflicts ?? 0);
    expect(result.identity.conflictingDeliveryCount).toBe(expected.conflictingDeliveries ?? 0);
  });
});

describe("lookup and pour arithmetic", () => {
  it("uses exact threshold edges and retains mode, unaccepted, and cross-window failures", () => {
    const assignments = Array.from({ length: 10 }, (_, index) => ({
      assignmentId: `assignment-${index}`,
      actorId: `actor-${index}`,
      cohortEligible: true,
      phase: "pilot" as const,
      assignedMode: "search",
      attempts:
        index === 9
          ? []
          : [
              lookupAttempt(`lookup-${index}`, index === 8 ? 10_000_001 : 10_000_000, {
                mode: index === 7 ? "scan" : "search",
                terminalOutcome: index === 6 ? "cross-window" : "succeeded",
              }),
            ],
    }));
    const result = calculatePilotMeasurement(baseBundle({ lookupAssignments: assignments }));

    expect(result.lookup.pilot).toMatchObject({
      numerator: 6,
      denominator: 10,
      genericFailureTotal: 4,
      thresholdMet: false,
    });
    expect(result.lookup.pilot.outcomeCounts["mode-mismatched"]).toBe(1);
    expect(result.lookup.pilot.outcomeCounts["cross-window"]).toBe(1);
    expect(result.lookup.pilot.outcomeCounts.unaccepted).toBe(1);
  });

  it("passes 9/10, fails 8/10, and applies the exact pour duration edge", () => {
    const lookupAssignments = Array.from({ length: 20 }, (_, index) => ({
      assignmentId: `assignment-${index}`,
      actorId: `actor-${index % 10}`,
      cohortEligible: true,
      phase: index < 10 ? ("baseline" as const) : ("pilot" as const),
      assignedMode: "search",
      attempts: [
        lookupAttempt(`lookup-${index}`, 1, {
          phase: index < 10 ? "baseline" : "pilot",
          terminalOutcome:
            (index < 10 && index === 9) || (index >= 10 && index >= 18)
              ? "no-result"
              : "succeeded",
        }),
      ],
    }));
    const result = calculatePilotMeasurement(
      baseBundle({
        lookupAssignments,
        pourAttempts: [
          pourAttempt("p1", { interval: closedInterval(3_000_000) }),
          pourAttempt("p2", {
            actorId: "actor-2",
            intentId: "intent-2",
            operationId: "operation-2",
            interval: closedInterval(3_000_001),
          }),
        ],
      }),
    );

    expect(result.lookup.baseline.thresholdMet).toBe(true);
    expect(result.lookup.pilot.thresholdMet).toBe(false);
    expect(result.pour.baseline).toMatchObject({ numerator: 1, denominator: 2 });
    expect(result.pour.baseline.coarseQualification).toBe("captured-attempts-only");
  });
});

describe("count labor and panel evaluation", () => {
  it("adds parallel, handoff, failure, and pre-cutoff correction labor", () => {
    const result = calculatePilotMeasurement(
      baseBundle({
        countUnits: [
          {
            unitId: "unit-1",
            rosterPolicy: "same-workers",
            baseline: phase("baseline", ["a", "b"], [
              segment("b1", "a", 10),
              segment("b2", "b", 10),
              segment("b3", "a", 5, { terminalOutcome: "abandoned" }),
              segment("b4", "b", 5, { kind: "correction" }),
            ]),
            pilot: phase("pilot", ["a", "b"], [
              segment("p1", "a", 5),
              segment("p2", "b", 5),
              segment("p3", "a", 5, { kind: "correction" }),
            ]),
          },
        ],
      }),
    );

    expect(result.count).toMatchObject({
      baselineLaborUs: 30,
      pilotLaborUs: 15,
      comparisonMet: true,
      panelStatus: "evaluable",
    });
    expect(result.count.outcomeCounts.abandoned).toBe(1);
  });

  it("fails closed for missing pairs, same-worker overlap, and zero baseline", () => {
    const overlapping = [
      segment("one", "a", 10, { interval: { ...closedInterval(10, "same"), startUs: 0 } }),
      segment("two", "a", 10, {
        interval: { ...closedInterval(15, "same"), startUs: 5 },
      }),
    ];
    const result = calculatePilotMeasurement(
      baseBundle({
        countUnits: [
          {
            unitId: "missing",
            rosterPolicy: "same-workers",
            baseline: phase("baseline", ["a"], [segment("m1", "a", 10)]),
          },
          {
            unitId: "overlap",
            rosterPolicy: "same-workers",
            baseline: phase("baseline", ["a"], overlapping),
            pilot: phase("pilot", ["a"], [segment("o1", "a", 5)]),
          },
          {
            unitId: "zero",
            rosterPolicy: "same-workers",
            baseline: phase("baseline", ["a"], []),
            pilot: phase("pilot", ["a"], [segment("z1", "a", 1)]),
          },
        ],
      }),
    );

    expect(result.count.panelStatus).toBe("non-evaluable");
    expect(result.count.comparisonMet).toBeNull();
  });

  it.each([
    { phaseName: "baseline" as const, baselineLaborUs: 10, pilotLaborUs: 0 },
    { phaseName: "pilot" as const, baselineLaborUs: 0, pilotLaborUs: 10 },
  ])(
    "retains valid $phaseName-only history while the absent phase keeps the privacy count at zero",
    ({ phaseName, baselineLaborUs, pilotLaborUs }) => {
      const suppliedPhase = phase(phaseName, ["actor-1"], [
        segment(`${phaseName}-only`, "actor-1", 10, { terminalOutcome: "abandoned" }),
      ]);
      const result = calculatePilotMeasurement(
        baseBundle({
          countUnits: [
            {
              unitId: `${phaseName}-only`,
              rosterPolicy: "same-workers",
              ...(phaseName === "baseline"
                ? { baseline: suppliedPhase }
                : { pilot: suppliedPhase }),
            },
          ],
        }),
      );

      expect(result.count).toMatchObject({
        baselineLaborUs,
        pilotLaborUs,
        comparisonMet: null,
        contributorCount: 0,
        panelStatus: "non-evaluable",
      });
      expect(result.count.outcomeCounts.abandoned).toBe(1);
    },
  );

  it("retains incomplete-unit history beside a complete count pair", () => {
    const result = calculatePilotMeasurement(
      baseBundle({
        countUnits: [
          {
            unitId: "complete",
            rosterPolicy: "same-workers",
            baseline: phase("baseline", ["complete-actor"], [
              segment("complete-baseline", "complete-actor", 20),
            ]),
            pilot: phase("pilot", ["complete-actor"], [
              segment("complete-pilot", "complete-actor", 10),
            ]),
          },
          {
            unitId: "incomplete",
            rosterPolicy: "same-workers",
            baseline: phase("baseline", ["incomplete-actor"], [
              segment("incomplete-baseline", "incomplete-actor", 5, {
                terminalOutcome: "abandoned",
              }),
            ]),
          },
        ],
      }),
    );

    expect(result.count).toMatchObject({
      baselineLaborUs: 25,
      pilotLaborUs: 10,
      comparisonMet: null,
      contributorCount: 1,
      panelStatus: "non-evaluable",
    });
    expect(result.count.outcomeCounts.abandoned).toBe(1);
  });

  it.each(["baseline", "pilot"] as const)(
    "uses the full %s panel when the opposite phase is missing from one unit",
    (oneSidedPhase) => {
      const baselineActors = actorIds("baseline", 8);
      const pilotActors = actorIds("pilot", 8);
      const baselineSplit = oneSidedPhase === "baseline" ? 4 : 8;
      const pilotSplit = oneSidedPhase === "pilot" ? 4 : 8;
      const oneSidedActors =
        oneSidedPhase === "baseline"
          ? baselineActors.slice(baselineSplit)
          : pilotActors.slice(pilotSplit);
      const bundle = baseBundle({
        countUnits: [
          {
            unitId: "one-sided",
            rosterPolicy: "same-workers",
            ...(oneSidedPhase === "baseline"
              ? { baseline: staffedPhase("baseline", oneSidedActors, "one-sided-baseline") }
              : { pilot: staffedPhase("pilot", oneSidedActors, "one-sided-pilot") }),
          },
          {
            unitId: "complete",
            rosterPolicy: "different-allowed",
            baseline: staffedPhase(
              "baseline",
              baselineActors.slice(0, baselineSplit),
              "complete-baseline",
            ),
            pilot: staffedPhase(
              "pilot",
              pilotActors.slice(0, pilotSplit),
              "complete-pilot",
            ),
          },
        ],
      });
      const result = calculatePilotMeasurement(bundle);

      expect(result.count).toMatchObject({
        baselineLaborUs: 80,
        pilotLaborUs: 80,
        comparisonMet: null,
        contributorCount: 8,
        panelStatus: "non-evaluable",
        q7Verdict: "not-evaluable-panel",
      });
      expect(syntheticCountRow(bundle)).toMatchObject({
        summary_status: "released",
        summary_contributor_bucket: "5-9",
        q7_verdict: "not-evaluable-panel",
        baseline_staff_microseconds: "80",
        pilot_staff_microseconds: "80",
        comparison_met: "",
        panel_evaluation_status: "non-evaluable",
      });
    },
  );

  it("deduplicates overlapping actors across complete and one-sided units", () => {
    const pilotActors = actorIds("pilot", 8);
    const result = calculatePilotMeasurement(
      baseBundle({
        countUnits: [
          {
            unitId: "baseline-only",
            rosterPolicy: "same-workers",
            baseline: staffedPhase("baseline", ["b1", "b2", "b3", "b4"], "one-sided"),
          },
          {
            unitId: "complete",
            rosterPolicy: "different-allowed",
            baseline: staffedPhase("baseline", ["b1", "b2", "b5", "b6"], "complete-baseline"),
            pilot: staffedPhase("pilot", pilotActors, "complete-pilot"),
          },
        ],
      }),
    );

    expect(result.count).toMatchObject({
      contributorCount: 6,
      panelStatus: "non-evaluable",
      comparisonMet: null,
    });
  });

  it("retains admitted history from an invalid supplied phase without making it comparable", () => {
    const baselineActors = actorIds("baseline", 8);
    const pilotActors = actorIds("pilot", 8);
    const result = calculatePilotMeasurement(
      baseBundle({
        countUnits: [
          {
            unitId: "invalid-baseline-only",
            rosterPolicy: "same-workers",
            baseline: staffedPhase(
              "baseline",
              baselineActors.slice(4),
              "invalid-baseline",
              { reconciliationComplete: false },
            ),
          },
          {
            unitId: "complete",
            rosterPolicy: "different-allowed",
            baseline: staffedPhase("baseline", baselineActors.slice(0, 4), "complete-baseline"),
            pilot: staffedPhase("pilot", pilotActors, "complete-pilot"),
          },
        ],
      }),
    );

    expect(result.count).toMatchObject({
      baselineLaborUs: 80,
      pilotLaborUs: 80,
      contributorCount: 8,
      panelStatus: "non-evaluable",
      comparisonMet: null,
      q7Verdict: "not-evaluable-panel",
    });
  });

  it("distinguishes prohibited roster mismatch from allowed but confounded mismatch", () => {
    const unit = {
      unitId: "unit",
      baseline: phase("baseline", ["a"], [segment("b", "a", 10)]),
      pilot: phase("pilot", ["b"], [segment("p", "b", 5)]),
    };

    expect(
      calculatePilotMeasurement(
        baseBundle({ countUnits: [{ ...unit, rosterPolicy: "same-workers" }] }),
      ).count.panelStatus,
    ).toBe("non-evaluable");
    expect(
      calculatePilotMeasurement(
        baseBundle({ countUnits: [{ ...unit, rosterPolicy: "different-allowed" }] }),
      ).count.panelStatus,
    ).toBe("confounded");
  });

  it("deduplicates exact segment replay and fails a changed segment closed", () => {
    const exact = segment("same", "a", 10);
    const unit = {
      unitId: "unit",
      rosterPolicy: "same-workers" as const,
      baseline: phase("baseline", ["a"], [exact, { ...exact }]),
      pilot: phase("pilot", ["a"], [segment("pilot", "a", 5)]),
    };
    const replay = calculatePilotMeasurement(baseBundle({ countUnits: [unit] }));
    expect(replay.count).toMatchObject({ baselineLaborUs: 10, panelStatus: "evaluable" });

    const changed = calculatePilotMeasurement(
      baseBundle({
        countUnits: [
          {
            ...unit,
            baseline: phase("baseline", ["a"], [
              exact,
              { ...exact, payloadFingerprint: "changed" },
            ]),
          },
        ],
      }),
    );
    expect(changed.count.panelStatus).toBe("non-evaluable");
  });

  it("rejects after-cutoff segments and invalid item denominators", () => {
    const completeUnit = (baseline: CountPhaseEvidence) => ({
      unitId: "unit",
      rosterPolicy: "same-workers" as const,
      baseline,
      pilot: phase("pilot", ["a"], [segment("pilot", "a", 5)]),
    });
    expect(() =>
      calculatePilotMeasurement(
        baseBundle({
          countUnits: [
            completeUnit(
              phase("baseline", ["a"], [
                segment("late", "a", 10, { recordedAtUs: 9_000_000_000_001 }),
              ]),
            ),
          ],
        }),
      ),
    ).toThrow(/evidence cutoff/i);
    expect(() =>
      calculatePilotMeasurement(
        baseBundle({
          countUnits: [
            completeUnit(
              phase("baseline", ["a"], [segment("bad-denominator", "a", 10)], {
                itemDenominator: 1.5,
              }),
            ),
          ],
        }),
      ),
    ).toThrow(/item denominator/i);
  });
});

describe("real-pilot claim gate", () => {
  function realLookupBundle(pilotSpanUs: number, closed: boolean) {
    return baseBundle({
      origin: "runtime-validated-real",
      windows: {
        baseline: { startUs: 0, endUs: 1_000, closed: true },
        pilot: { startUs: 2_000, endUs: 2_000 + pilotSpanUs, closed },
      },
      lookupAssignments: Array.from({ length: 10 }, (_, index) => ({
        assignmentId: `a-${index}`,
        actorId: `actor-${index % 5}`,
        cohortEligible: true,
        phase: "pilot" as const,
        assignedMode: "search",
        attempts: [
          lookupAttempt(`attempt-${index}`, 1, {
            validation: { status: "accepted", evidenceOrigin: "runtime-validated-real" },
          }),
        ],
      })),
    });
  }

  it("keeps synthetic, open, and short pilot results provisional", () => {
    expect(
      calculatePilotMeasurement(
        baseBundle({
          lookupAssignments: realLookupBundle(
            MIN_REAL_PILOT_SPAN_US,
            true,
          ).lookupAssignments.map((assignment) => ({
            ...assignment,
            attempts: assignment.attempts.map((attempt) => ({
              ...attempt,
              validation: accepted,
            })),
          })),
        }),
      ).lookup.pilot.q7Verdict,
    ).toBe("not-evaluable-provisional");
    expect(
      calculatePilotMeasurement(realLookupBundle(MIN_REAL_PILOT_SPAN_US, false)).lookup.pilot
        .q7Verdict,
    ).toBe("not-evaluable-provisional");
    expect(
      calculatePilotMeasurement(realLookupBundle(MIN_REAL_PILOT_SPAN_US - 1, true)).lookup.pilot
        .q7Verdict,
    ).toBe("not-evaluable-provisional");
  });

  it("permits a real Q7 verdict only at the closed minimum span", () => {
    expect(
      calculatePilotMeasurement(realLookupBundle(MIN_REAL_PILOT_SPAN_US, true)).lookup.pilot
        .q7Verdict,
    ).toBe("met");
  });

  it("does not emit a real success verdict through a known health gap", () => {
    const bundle = realLookupBundle(MIN_REAL_PILOT_SPAN_US, true);
    bundle.health.lookupKnownGap = true;
    expect(calculatePilotMeasurement(bundle).lookup.pilot.q7Verdict).toBe(
      "not-evaluable-qualification",
    );
  });
});
