import { describe, expect, it } from "vitest";
import {
  MIN_REAL_PILOT_SPAN_US,
  calculatePilotMeasurement,
  type CountSegment,
  type SuppliedEvidenceBundle,
} from "./calculate";
import {
  PILOT_EXPORT_COLUMNS,
  exportRealPilotCsv,
  exportSyntheticPilotCsv,
} from "./export";

const accepted = { status: "accepted", evidenceOrigin: "synthetic-fixture" } as const;

function fixture(contributorCount = 5): SuppliedEvidenceBundle {
  const actors = Array.from({ length: contributorCount }, (_, index) => `private-actor-${index}`);
  const lookupAssignments = (["baseline", "pilot"] as const).flatMap((phase) =>
    Array.from({ length: 240 }, (_, index) => ({
      assignmentId: `${phase}-lookup-${index}`,
      actorId: actors[index % actors.length],
      cohortEligible: true,
      phase,
      assignedMode: index % 2 === 0 ? "private-search" : "private-scan",
      attempts: [
        {
          attemptId: `${phase}-attempt-${index}`,
          payloadFingerprint: `${phase}-payload-${index}`,
          phase,
          mode: index % 2 === 0 ? "private-search" : "private-scan",
          terminalOutcome:
            phase === "pilot" && index >= 221 ? ("no-result" as const) : ("succeeded" as const),
          interval: {
            startOriginId: "clock",
            endOriginId: "clock",
            startUs: 0,
            endUs: 1,
          },
          validation: accepted,
        },
      ],
    })),
  );
  const countSegments = (phase: "baseline" | "pilot"): CountSegment[] =>
    actors.map((actorId, index) => ({
      segmentId: `${phase}-segment-${index}`,
      attemptId: `${phase}-count-${index}`,
      payloadFingerprint: `private-count-${phase}-${index}`,
      actorId,
      terminalOutcome: "succeeded",
      interval: {
        startOriginId: `${phase}-clock-${index}`,
        endOriginId: `${phase}-clock-${index}`,
        startUs: 0,
        endUs:
          Math.trunc((phase === "baseline" ? 28_800_000_000 : 13_200_000_000) / actors.length),
      },
      recordedAtUs: 4_000_000_000_000,
      validation: accepted,
      kind: "work",
    }));

  return {
    reportFingerprint: "report-fixed",
    contractVersion: "q7-v1",
    activationVersion: "activation-v1",
    activatedVenueSetFingerprint: "full-venue-set",
    evidenceCutoffUs: 5_000_000_000_000,
    origin: "synthetic-fixture",
    windows: {
      baseline: { startUs: 0, endUs: 100, closed: true },
      pilot: { startUs: 200, endUs: 300, closed: false },
    },
    lookupAssignments,
    pourAttempts: (["baseline", "pilot"] as const).flatMap((phase) =>
      actors.map((actorId, index) => ({
        attemptId: `${phase}-pour-${index}`,
        intentId: `${phase}-intent-${index}`,
        operationId: `${phase}-operation-${index}`,
        payloadFingerprint: `${phase}-pour-payload-${index}`,
        actorId,
        cohortEligible: true,
        phase,
        terminalOutcome: "succeeded" as const,
        interval: {
          startOriginId: "clock",
          endOriginId: "clock",
          startUs: 0,
          endUs: 3_000_000,
        },
        validation: accepted,
      })),
    ),
    inventoryReceipts: [],
    countUnits: [
      {
        unitId: "private-unit-1",
        rosterPolicy: "same-workers",
        baseline: {
          phase: "baseline",
          scopeFingerprint: "private-scope",
          itemDenominator: 100,
          inventoryCutoffRule: "private-cutoff",
          reconciliationDefinition: "private-reconciliation",
          rosterActorIds: actors,
          reconciliationComplete: true,
          segments: countSegments("baseline"),
        },
        pilot: {
          phase: "pilot",
          scopeFingerprint: "private-scope",
          itemDenominator: 100,
          inventoryCutoffRule: "private-cutoff",
          reconciliationDefinition: "private-reconciliation",
          rosterActorIds: actors,
          reconciliationComplete: true,
          segments: countSegments("pilot"),
        },
      },
    ],
    health: {
      lookupKnownGap: false,
      pourKnownGap: false,
      countKnownGap: false,
    },
  };
}

function asRuntimeValidatedReal(bundle: SuppliedEvidenceBundle): SuppliedEvidenceBundle {
  bundle.origin = "runtime-validated-real";
  const realOrigin = { status: "accepted", evidenceOrigin: "runtime-validated-real" } as const;
  bundle.lookupAssignments.forEach((assignment) =>
    assignment.attempts.forEach((attempt) => (attempt.validation = realOrigin)),
  );
  bundle.pourAttempts.forEach((attempt) => (attempt.validation = realOrigin));
  bundle.countUnits.forEach((unit) => {
    unit.baseline?.segments.forEach((segment) => (segment.validation = realOrigin));
    unit.pilot?.segments.forEach((segment) => (segment.validation = realOrigin));
  });
  return bundle;
}

function records(csv: string): Record<string, string>[] {
  const [header, ...rows] = csv.slice(1).split("\r\n");
  const columns = header.split(",");
  return rows.map((row) =>
    Object.fromEntries(row.split(",").map((value, index) => [columns[index], value])),
  );
}

describe("canonical pilot CSV", () => {
  it("uses only the reviewed fixed projection columns", () => {
    expect(PILOT_EXPORT_COLUMNS).toEqual([
      "marker",
      "report_fingerprint",
      "contract_version",
      "activation_version",
      "evidence_origin",
      "metric",
      "evidence_cutoff_us",
      "activated_venue_set_fingerprint",
      "evaluation_phase",
      "evaluation_window_start_us",
      "evaluation_window_end_us",
      "baseline_window_start_us",
      "baseline_window_end_us",
      "pilot_window_start_us",
      "pilot_window_end_us",
      "summary_status",
      "summary_contributor_bucket",
      "diagnostic_status",
      "coarse_qualification",
      "q7_verdict",
      "numerator",
      "denominator",
      "comparison_met",
      "generic_failure_total",
      "baseline_staff_microseconds",
      "pilot_staff_microseconds",
      "panel_evaluation_status",
      "roster_health_qualification",
    ]);
  });

  it("marks synthetic evidence and keeps the fixed positional record order", () => {
    const exported = exportSyntheticPilotCsv(calculatePilotMeasurement(fixture()));
    const rows = records(exported.csv);

    expect(exported.filename).toContain("synthetic-test");
    expect(rows.map((row) => `${row.marker ? "notice" : "metric"}:${row.metric}:${row.evaluation_phase}`)).toEqual([
      "notice::",
      "metric:lookup:baseline",
      "metric:lookup:pilot",
      "metric:pour:baseline",
      "metric:pour:pilot",
      "metric:count:",
    ]);
    expect(rows[0].marker).toBe("NOT REAL PILOT EVIDENCE");
    expect(exported.csv.endsWith("\r\n")).toBe(false);
  });

  it("starts a real export with lookup baseline and emits no synthetic marker", () => {
    const bundle = asRuntimeValidatedReal(fixture());
    const rows = records(exportRealPilotCsv(calculatePilotMeasurement(bundle)).csv);
    expect(rows).toHaveLength(5);
    expect(rows[0]).toMatchObject({ marker: "", metric: "lookup", evaluation_phase: "baseline" });
    expect(rows.every((row) => row.marker === "")).toBe(true);
  });

  it("emits met only for the fixed Q7 arithmetic in a full closed real pilot window", () => {
    const bundle = asRuntimeValidatedReal(fixture());
    bundle.windows.pilot = {
      startUs: 2_000_000,
      endUs: 2_000_000 + MIN_REAL_PILOT_SPAN_US,
      closed: true,
    };
    const rows = records(exportRealPilotCsv(calculatePilotMeasurement(bundle)).csv);

    expect(
      rows.find((row) => row.metric === "lookup" && row.evaluation_phase === "pilot"),
    ).toMatchObject({ numerator: "221", denominator: "240", q7_verdict: "met" });
    expect(
      rows.find((row) => row.metric === "pour" && row.evaluation_phase === "pilot"),
    ).toMatchObject({ numerator: "5", denominator: "5", q7_verdict: "met" });
    expect(rows.find((row) => row.metric === "count")).toMatchObject({
      baseline_staff_microseconds: "28800000000",
      pilot_staff_microseconds: "13200000000",
      comparison_met: "true",
      q7_verdict: "met",
    });
  });

  it("exports the 221/240 full-cohort summary without its private failure distribution", () => {
    const rows = records(exportSyntheticPilotCsv(calculatePilotMeasurement(fixture(12))).csv);
    const lookupPilot = rows.find(
      (row) => row.metric === "lookup" && row.evaluation_phase === "pilot",
    );

    expect(lookupPilot).toMatchObject({
      numerator: "221",
      denominator: "240",
      generic_failure_total: "19",
      summary_contributor_bucket: "10+",
      diagnostic_status: "not-exported",
    });
    expect(Object.keys(lookupPilot ?? {})).toEqual([...PILOT_EXPORT_COLUMNS]);
    expect(JSON.stringify(lookupPilot)).not.toMatch(/private-search|private-scan|no-result/);
  });

  it("suppresses all arithmetic and all three qualification fields below five contributors", () => {
    const rows = records(exportSyntheticPilotCsv(calculatePilotMeasurement(fixture(4))).csv);
    const metricRows = rows.filter((row) => row.marker === "");

    expect(metricRows).toHaveLength(5);
    for (const row of metricRows) {
      expect(row).toMatchObject({
        summary_status: "suppressed-small-cohort",
        summary_contributor_bucket: "<5",
        diagnostic_status: "not-exported",
        coarse_qualification: "",
        q7_verdict: "not-evaluable-privacy",
        numerator: "",
        denominator: "",
        comparison_met: "",
        generic_failure_total: "",
        baseline_staff_microseconds: "",
        pilot_staff_microseconds: "",
        panel_evaluation_status: "",
        roster_health_qualification: "",
      });
    }
  });

  it("keeps pour coverage qualification out of q7_verdict", () => {
    const rows = records(exportSyntheticPilotCsv(calculatePilotMeasurement(fixture())).csv);
    const pourPilot = rows.find(
      (row) => row.metric === "pour" && row.evaluation_phase === "pilot",
    );

    expect(pourPilot?.coarse_qualification).toBe("captured-attempts-only");
    expect(pourPilot?.q7_verdict).toBe("not-evaluable-provisional");
  });

  it("releases the full cohort when a private lookup mode has fewer than five contributors", () => {
    const bundle = fixture(10);
    for (const assignment of bundle.lookupAssignments) {
      const actorNumber = Number(assignment.actorId.split("-").at(-1));
      const mode = actorNumber < 4 ? "private-rare-mode" : "private-common-mode";
      assignment.assignedMode = mode;
      assignment.attempts[0].mode = mode;
    }
    const rows = records(exportSyntheticPilotCsv(calculatePilotMeasurement(bundle)).csv);
    const lookupPilot = rows.find(
      (row) => row.metric === "lookup" && row.evaluation_phase === "pilot",
    );

    expect(lookupPilot).toMatchObject({
      summary_status: "released",
      summary_contributor_bucket: "10+",
      numerator: "221",
      denominator: "240",
    });
    expect(JSON.stringify(lookupPilot)).not.toContain("private-rare-mode");
  });

  it("exports only panel count arithmetic and never unit, actor, roster, or diagnostic detail", () => {
    const exported = exportSyntheticPilotCsv(calculatePilotMeasurement(fixture(8)));
    const count = records(exported.csv).find((row) => row.metric === "count");

    expect(count).toMatchObject({
      baseline_staff_microseconds: "28800000000",
      pilot_staff_microseconds: "13200000000",
      comparison_met: "true",
      panel_evaluation_status: "evaluable",
      roster_health_qualification: "aligned-healthy",
      diagnostic_status: "not-exported",
    });
    expect(exported.csv).not.toMatch(/private-actor|private-unit|private-scope|private-count/);
  });

  it("is deterministic and rejects mixed exporters or any extra projection request", () => {
    const synthetic = calculatePilotMeasurement(fixture());
    const real = { ...synthetic, origin: "runtime-validated-real" } as typeof synthetic;

    expect(exportSyntheticPilotCsv(synthetic)).toEqual(exportSyntheticPilotCsv(synthetic));
    expect(() => exportRealPilotCsv(synthetic)).toThrow(/real evidence/i);
    expect(() => exportSyntheticPilotCsv(real)).toThrow(/synthetic evidence/i);
    const callWithProjection = exportSyntheticPilotCsv as unknown as (
      calculation: typeof synthetic,
      request: unknown,
    ) => unknown;
    expect(() => callWithProjection(synthetic, { venueId: "private-venue" })).toThrow(
      /projection request/i,
    );
  });
});
