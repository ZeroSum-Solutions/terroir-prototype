import {
  MIN_REAL_PILOT_SPAN_US,
  TERMINAL_OUTCOMES,
  type AttemptEvidence,
  type CountCalculation,
  type CountPhaseEvidence,
  type CountPhaseResult,
  type IntervalEvidence,
  type OutcomeCounts,
  type Phase,
  type PilotMeasurementCalculation,
  type PourAttempt,
  type Q7Verdict,
  type RateCalculation,
  type SuppliedEvidenceBundle,
  type TerminalOutcome,
} from "./types";

export { MIN_REAL_PILOT_SPAN_US, TERMINAL_OUTCOMES } from "./types";
export type * from "./types";
const OUTCOME_SET = new Set<string>(TERMINAL_OUTCOMES);
const REJECTION_MAP: Readonly<Record<string, TerminalOutcome>> = {
  "authorization-denied": "denied",
  "authorization-revoked": "denied",
  "context-not-yet-valid": "context-not-yet-valid",
  "context-expired": "context-expired",
  "context-version-mismatched": "context-version-mismatched",
  "context-improperly-reissued": "context-improperly-reissued",
  "clock-divergence": "unverifiable-clock",
  "impossible-server-receipt-order": "unverifiable-clock",
  "replay-too-late": "replay-too-late",
  "open-interval-lost": "interrupted",
  "cross-window-capture": "cross-window",
  "synthetic-on-live-path": "invalid-provenance",
  "client-asserted-provenance": "invalid-provenance",
  "immutable-identity-conflict": "conflicted",
};
export function mapRuntimeRejection(reason: string): TerminalOutcome {
  const outcome = REJECTION_MAP[reason];
  if (!outcome) throw new Error("Unknown runtime rejection reason");
  return outcome;
}
function emptyOutcomeCounts(): OutcomeCounts {
  return Object.fromEntries(TERMINAL_OUTCOMES.map((outcome) => [outcome, 0])) as OutcomeCounts;
}
function safeInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${label} must be a safe integer`);
}
function checkedAdd(left: number, right: number, label: string): number {
  const result = left + right;
  safeInteger(result, label);
  return result;
}
function intervalDuration(interval: IntervalEvidence | undefined): number | null {
  if (!interval) return null;
  safeInteger(interval.startUs, "interval start");
  if (interval.endUs === undefined) return null;
  safeInteger(interval.endUs, "interval end");
  if (interval.endOriginId !== interval.startOriginId) return null;
  if (interval.endUs < interval.startUs) throw new Error("Interval ends before it starts");
  return interval.endUs - interval.startUs;
}
function validatedOutcome(evidence: Pick<AttemptEvidence, "terminalOutcome" | "validation" | "interval">): TerminalOutcome {
  if (!OUTCOME_SET.has(evidence.terminalOutcome)) {
    throw new Error("Unknown terminal outcome");
  }
  if (evidence.validation.status === "rejected") {
    return mapRuntimeRejection(evidence.validation.reason);
  }
  const outcome = evidence.terminalOutcome as TerminalOutcome;
  if (outcome === "succeeded" && intervalDuration(evidence.interval) === null) return "interrupted";
  return outcome;
}
function thresholdMet(numerator: number, denominator: number, percentage: number): boolean {
  return BigInt(100) * BigInt(numerator) >= BigInt(percentage) * BigInt(denominator);
}
function realPilotEligible(bundle: SuppliedEvidenceBundle): boolean {
  const window = bundle.windows.pilot;
  return (
    bundle.origin === "runtime-validated-real" &&
    window.closed &&
    window.endUs - window.startUs >= MIN_REAL_PILOT_SPAN_US
  );
}
function rateVerdict(
  bundle: SuppliedEvidenceBundle,
  phase: Phase,
  knownGap: boolean,
  denominator: number,
  met: boolean,
): Q7Verdict {
  if (phase !== "pilot" || !realPilotEligible(bundle)) return "not-evaluable-provisional";
  if (knownGap) return "not-evaluable-qualification";
  if (denominator === 0) return "not-evaluable-panel";
  return met ? "met" : "not-met";
}
function calculateLookup(bundle: SuppliedEvidenceBundle): Record<Phase, RateCalculation> {
  const calculatePhase = (phase: Phase): RateCalculation => {
    const seen = new Map<string, string>();
    const counts = emptyOutcomeCounts();
    const contributors = new Set<string>();
    let numerator = 0;
    let denominator = 0;
    for (const assignment of bundle.lookupAssignments) {
      let represented = 0;
      for (const attempt of assignment.attempts) {
        let outcome = validatedOutcome(attempt);
        const identity = `${assignment.assignmentId}:${attempt.payloadFingerprint}`;
        const prior = seen.get(attempt.attemptId);
        if (prior !== undefined) {
          if (prior !== identity) throw new Error("Conflicting lookup attempt delivery");
          continue;
        }
        seen.set(attempt.attemptId, identity);
        if (!assignment.cohortEligible || assignment.phase !== phase) continue;
        represented += 1;
        denominator += 1;
        if (attempt.phase !== phase) outcome = "cross-window";
        if (attempt.mode !== assignment.assignedMode) outcome = "mode-mismatched";
        counts[outcome] += 1;
        const duration = intervalDuration(attempt.interval);
        if (outcome === "succeeded" && duration !== null && duration <= 10_000_000) numerator += 1;
      }
      if (!assignment.cohortEligible || assignment.phase !== phase) continue;
      contributors.add(assignment.actorId);
      if (represented === 0) {
        denominator += 1;
        counts.unaccepted += 1;
      }
    }
    const met = denominator > 0 && thresholdMet(numerator, denominator, 90);
    const knownGap = bundle.health.lookupKnownGap;
    return {
      metric: "lookup",
      phase,
      numerator,
      denominator,
      genericFailureTotal: denominator - numerator,
      thresholdMet: met,
      contributorIds: contributors,
      coarseQualification: knownGap ? "known-health-gap" : "complete",
      q7Verdict: rateVerdict(bundle, phase, knownGap, denominator, met),
      outcomeCounts: counts,
    };
  };
  return { baseline: calculatePhase("baseline"), pilot: calculatePhase("pilot") };
}
function calculatePour(bundle: SuppliedEvidenceBundle): {
  rates: Record<Phase, RateCalculation>;
  conflictingDeliveryCount: number;
  conflictedAttemptCount: number;
  inventoryCommitCount: number;
} {
  const seen = new Map<string, PourAttempt>();
  const unique: PourAttempt[] = [];
  let conflictingDeliveryCount = 0;
  for (const attempt of bundle.pourAttempts) {
    validatedOutcome(attempt);
    const prior = seen.get(attempt.attemptId);
    if (!prior) {
      seen.set(attempt.attemptId, attempt);
      unique.push(attempt);
    } else if (prior.payloadFingerprint !== attempt.payloadFingerprint) {
      conflictingDeliveryCount += 1;
    }
  }
  const operationIntent = new Map<string, string>();
  const intentOperation = new Map<string, string>();
  const closedIntents = new Set<string>();
  const derived = new Map<string, TerminalOutcome>();
  let conflictedAttemptCount = 0;
  for (const attempt of unique) {
    let outcome = validatedOutcome(attempt);
    const operationOwner = operationIntent.get(attempt.operationId);
    const intentOperationId = intentOperation.get(attempt.intentId);
    if (
      (operationOwner !== undefined && operationOwner !== attempt.intentId) ||
      (intentOperationId !== undefined && intentOperationId !== attempt.operationId) ||
      closedIntents.has(attempt.intentId)
    ) {
      outcome = "conflicted";
      conflictedAttemptCount += 1;
    }
    operationIntent.set(attempt.operationId, operationOwner ?? attempt.intentId);
    intentOperation.set(attempt.intentId, intentOperationId ?? attempt.operationId);
    if (outcome === "succeeded") closedIntents.add(attempt.intentId);
    derived.set(attempt.attemptId, outcome);
  }
  const knownOperations = new Set(unique.map((attempt) => attempt.operationId));
  const receiptOperations = new Set<string>();
  let inventoryCommitCount = 0;
  for (const receipt of bundle.inventoryReceipts) {
    safeInteger(receipt.commitCount, "inventory commit count");
    if (receipt.commitCount > 1) throw new Error("Inventory operation committed more than once");
    if (!knownOperations.has(receipt.operationId)) throw new Error("Inventory receipt has no attempt");
    if (receiptOperations.has(receipt.operationId)) throw new Error("Duplicate inventory receipt");
    receiptOperations.add(receipt.operationId);
    inventoryCommitCount = checkedAdd(inventoryCommitCount, receipt.commitCount, "inventory commits");
  }

  const calculatePhase = (phase: Phase): RateCalculation => {
    const counts = emptyOutcomeCounts();
    const contributors = new Set<string>();
    let numerator = 0;
    let denominator = 0;
    for (const attempt of unique) {
      if (!attempt.cohortEligible || attempt.phase !== phase) continue;
      contributors.add(attempt.actorId);
      denominator += 1;
      const outcome = derived.get(attempt.attemptId) ?? "conflicted";
      counts[outcome] += 1;
      const duration = intervalDuration(attempt.interval);
      if (outcome === "succeeded" && duration !== null && duration <= 3_000_000) numerator += 1;
    }
    const met = denominator > 0 && thresholdMet(numerator, denominator, 90);
    const knownGap = bundle.health.pourKnownGap;
    return {
      metric: "pour",
      phase,
      numerator,
      denominator,
      genericFailureTotal: denominator - numerator,
      thresholdMet: met,
      contributorIds: contributors,
      coarseQualification: knownGap
        ? "captured-attempts-only-known-health-gap"
        : "captured-attempts-only",
      q7Verdict: rateVerdict(bundle, phase, knownGap, denominator, met),
      outcomeCounts: counts,
    };
  };
  return {
    rates: { baseline: calculatePhase("baseline"), pilot: calculatePhase("pilot") },
    conflictingDeliveryCount,
    conflictedAttemptCount,
    inventoryCommitCount,
  };
}
function evaluateCountPhase(
  evidence: CountPhaseEvidence,
  expectedPhase: Phase,
  cutoffUs: number,
  counts: OutcomeCounts,
  seenSegments: Map<string, string>,
): CountPhaseResult {
  const roster = new Set(evidence.rosterActorIds);
  let laborUs = 0;
  let valid = evidence.phase === expectedPhase && evidence.reconciliationComplete;
  safeInteger(evidence.itemDenominator, "count item denominator");
  if (evidence.itemDenominator === 0) valid = false;
  const actors = new Set<string>();
  const ranges = new Map<string, IntervalEvidence[]>();
  for (const segment of evidence.segments) {
    safeInteger(segment.recordedAtUs, "segment recorded time");
    if (segment.recordedAtUs > cutoffUs) throw new Error("Count segment exceeds evidence cutoff");
    const outcome = validatedOutcome(segment);
    const priorPayload = seenSegments.get(segment.segmentId);
    if (priorPayload !== undefined) {
      if (priorPayload !== segment.payloadFingerprint) valid = false;
      continue;
    }
    seenSegments.set(segment.segmentId, segment.payloadFingerprint);
    counts[outcome] += 1;
    const duration = intervalDuration(segment.interval);
    if (!roster.has(segment.actorId) || duration === null || segment.validation.status === "rejected") {
      valid = false;
      continue;
    }
    actors.add(segment.actorId);
    laborUs = checkedAdd(laborUs, duration, "count labor");
    const actorRanges = ranges.get(segment.actorId) ?? [];
    for (const prior of actorRanges) {
      if (
        prior.startOriginId === segment.interval?.startOriginId &&
        prior.endUs !== undefined &&
        segment.interval.endUs !== undefined &&
        prior.startUs < segment.interval.endUs &&
        segment.interval.startUs < prior.endUs
      ) {
        valid = false;
      }
    }
    actorRanges.push(segment.interval as IntervalEvidence);
    ranges.set(segment.actorId, actorRanges);
  }
  return { laborUs, actors, valid };
}
function sameRoster(left: string[], right: string[]): boolean {
  return [...new Set(left)].sort().join("\u0000") === [...new Set(right)].sort().join("\u0000");
}
function calculateCount(bundle: SuppliedEvidenceBundle): CountCalculation {
  const counts = emptyOutcomeCounts();
  const seenSegments = new Map<string, string>();
  const baselineActors = new Set<string>();
  const pilotActors = new Set<string>();
  let baselineLaborUs = 0;
  let pilotLaborUs = 0;
  let valid = bundle.countUnits.length > 0;
  let confounded = false;
  for (const unit of bundle.countUnits) {
    const { baseline: baselineEvidence, pilot: pilotEvidence } = unit;
    const baseline = baselineEvidence ? evaluateCountPhase(baselineEvidence, "baseline", bundle.evidenceCutoffUs, counts, seenSegments) : null;
    const pilot = pilotEvidence ? evaluateCountPhase(pilotEvidence, "pilot", bundle.evidenceCutoffUs, counts, seenSegments) : null;
    if (baseline) baselineLaborUs = checkedAdd(baselineLaborUs, baseline.laborUs, "baseline panel labor");
    baseline?.actors.forEach((actor) => baselineActors.add(actor));
    if (pilot) pilotLaborUs = checkedAdd(pilotLaborUs, pilot.laborUs, "pilot panel labor");
    pilot?.actors.forEach((actor) => pilotActors.add(actor));
    if (!baselineEvidence || !pilotEvidence || !baseline || !pilot) {
      valid = false;
      continue;
    }
    const metadataMatch =
      baselineEvidence.scopeFingerprint === pilotEvidence.scopeFingerprint &&
      baselineEvidence.itemDenominator === pilotEvidence.itemDenominator &&
      baselineEvidence.inventoryCutoffRule === pilotEvidence.inventoryCutoffRule &&
      baselineEvidence.reconciliationDefinition === pilotEvidence.reconciliationDefinition;
    const rosterMatch = sameRoster(baselineEvidence.rosterActorIds, pilotEvidence.rosterActorIds);
    if (!baseline.valid || !pilot.valid || !metadataMatch || baseline.laborUs === 0) valid = false;
    if (!rosterMatch && unit.rosterPolicy === "same-workers") valid = false;
    if (!rosterMatch && unit.rosterPolicy === "different-allowed") confounded = true;
  }
  const panelStatus = !valid ? "non-evaluable" : confounded ? "confounded" : "evaluable";
  const comparisonMet =
    panelStatus === "evaluable"
      ? BigInt(2) * BigInt(pilotLaborUs) <= BigInt(baselineLaborUs)
      : null;
  const knownGap = bundle.health.countKnownGap;
  let q7Verdict: Q7Verdict = "not-evaluable-panel";
  if (panelStatus === "confounded") q7Verdict = "confounded";
  else if (panelStatus === "evaluable" && knownGap) q7Verdict = "not-evaluable-qualification";
  else if (panelStatus === "evaluable" && !realPilotEligible(bundle)) {
    q7Verdict = "not-evaluable-provisional";
  } else if (panelStatus === "evaluable") q7Verdict = comparisonMet ? "met" : "not-met";
  return {
    baselineLaborUs,
    pilotLaborUs,
    comparisonMet,
    contributorCount: Math.min(baselineActors.size, pilotActors.size),
    coarseQualification: knownGap
      ? "captured-attempts-only-known-health-gap"
      : "captured-attempts-only",
    panelStatus,
    rosterHealthQualification:
      panelStatus === "non-evaluable"
        ? "non-evaluable"
        : panelStatus === "confounded"
          ? "different-rosters"
          : knownGap
            ? "known-health-gap"
            : "aligned-healthy",
    q7Verdict,
    outcomeCounts: counts,
  };
}
function validateBundle(bundle: SuppliedEvidenceBundle): void {
  safeInteger(bundle.evidenceCutoffUs, "evidence cutoff");
  for (const phase of ["baseline", "pilot"] as const) {
    const window = bundle.windows[phase];
    safeInteger(window.startUs, `${phase} window start`);
    safeInteger(window.endUs, `${phase} window end`);
    if (window.endUs < window.startUs) throw new Error(`${phase} window ends before it starts`);
  }
  const evidence = [
    ...bundle.lookupAssignments.flatMap((assignment) => assignment.attempts),
    ...bundle.pourAttempts,
    ...bundle.countUnits.flatMap((unit) => [
      ...(unit.baseline?.segments ?? []), ...(unit.pilot?.segments ?? []),
    ]),
  ];
  for (const item of evidence) {
    validatedOutcome(item);
    if (item.validation.evidenceOrigin !== bundle.origin) {
      throw new Error("Mixed or mismatched evidence origin");
    }
  }
}
export function calculatePilotMeasurement(bundle: SuppliedEvidenceBundle): PilotMeasurementCalculation {
  validateBundle(bundle);
  const lookup = calculateLookup(bundle);
  const pour = calculatePour(bundle);
  return {
    reportFingerprint: bundle.reportFingerprint,
    contractVersion: bundle.contractVersion,
    activationVersion: bundle.activationVersion,
    activatedVenueSetFingerprint: bundle.activatedVenueSetFingerprint,
    evidenceCutoffUs: bundle.evidenceCutoffUs,
    origin: bundle.origin,
    windows: bundle.windows,
    lookup,
    pour: pour.rates,
    count: calculateCount(bundle),
    identity: {
      conflictingDeliveryCount: pour.conflictingDeliveryCount,
      conflictedAttemptCount: pour.conflictedAttemptCount,
      inventoryCommitCount: pour.inventoryCommitCount,
    },
  };
}
