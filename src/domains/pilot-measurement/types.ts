export const MIN_REAL_PILOT_SPAN_US = 2_419_200_000_000;

export const TERMINAL_OUTCOMES = [
  "succeeded",
  "no-result",
  "incorrect-selection",
  "mode-mismatched",
  "denied",
  "abandoned",
  "interrupted",
  "storage-failed",
  "conflicted",
  "incomplete",
  "unaccepted",
  "unverifiable-clock",
  "context-expired",
  "context-not-yet-valid",
  "context-version-mismatched",
  "context-improperly-reissued",
  "replay-too-late",
  "invalid-provenance",
  "cross-window",
] as const;

export type TerminalOutcome = (typeof TERMINAL_OUTCOMES)[number];
export type Phase = "baseline" | "pilot";
export type EvidenceOrigin = "synthetic-fixture" | "runtime-validated-real";
export type Q7Verdict =
  | "met"
  | "not-met"
  | "not-evaluable-provisional"
  | "not-evaluable-qualification"
  | "not-evaluable-panel"
  | "confounded";

export interface WindowEvidence {
  startUs: number;
  endUs: number;
  closed: boolean;
}

export interface IntervalEvidence {
  startOriginId: string;
  endOriginId?: string;
  startUs: number;
  endUs?: number;
}

export type RuntimeValidationSnapshot =
  | { status: "accepted"; evidenceOrigin: EvidenceOrigin }
  | { status: "rejected"; reason: string; evidenceOrigin: EvidenceOrigin };

export interface AttemptEvidence {
  attemptId: string;
  payloadFingerprint: string;
  phase: Phase;
  terminalOutcome: string;
  interval?: IntervalEvidence;
  validation: RuntimeValidationSnapshot;
}

export interface LookupAttempt extends AttemptEvidence {
  mode: string;
}

export interface LookupAssignment {
  assignmentId: string;
  actorId: string;
  cohortEligible: boolean;
  phase: Phase;
  assignedMode: string;
  attempts: LookupAttempt[];
}

export interface PourAttempt extends AttemptEvidence {
  intentId: string;
  operationId: string;
  actorId: string;
  cohortEligible: boolean;
}

export interface InventoryReceipt {
  operationId: string;
  commitCount: number;
}

export interface CountSegment extends Omit<AttemptEvidence, "phase"> {
  segmentId: string;
  actorId: string;
  recordedAtUs: number;
  kind: "work" | "correction";
}

export interface CountPhaseEvidence {
  phase: Phase;
  scopeFingerprint: string;
  itemDenominator: number;
  inventoryCutoffRule: string;
  reconciliationDefinition: string;
  rosterActorIds: string[];
  reconciliationComplete: boolean;
  segments: CountSegment[];
}

export interface CountComparisonUnit {
  unitId: string;
  rosterPolicy: "same-workers" | "different-allowed";
  baseline?: CountPhaseEvidence;
  pilot?: CountPhaseEvidence;
}

export interface SuppliedEvidenceBundle {
  reportFingerprint: string;
  contractVersion: string;
  activationVersion: string;
  activatedVenueSetFingerprint: string;
  evidenceCutoffUs: number;
  origin: EvidenceOrigin;
  windows: Record<Phase, WindowEvidence>;
  lookupAssignments: LookupAssignment[];
  pourAttempts: PourAttempt[];
  inventoryReceipts: InventoryReceipt[];
  countUnits: CountComparisonUnit[];
  health: {
    lookupKnownGap: boolean;
    pourKnownGap: boolean;
    countKnownGap: boolean;
  };
}

export type OutcomeCounts = Record<TerminalOutcome, number>;
export type CoarseQualification =
  | "complete"
  | "known-health-gap"
  | "captured-attempts-only"
  | "captured-attempts-only-known-health-gap";

export interface RateCalculation {
  metric: "lookup" | "pour";
  phase: Phase;
  numerator: number;
  denominator: number;
  genericFailureTotal: number;
  thresholdMet: boolean;
  contributorIds: ReadonlySet<string>;
  coarseQualification: CoarseQualification;
  q7Verdict: Q7Verdict;
  outcomeCounts: OutcomeCounts;
}

export interface CountCalculation {
  baselineLaborUs: number;
  pilotLaborUs: number;
  comparisonMet: boolean | null;
  contributorCount: number;
  coarseQualification: CoarseQualification;
  panelStatus: "evaluable" | "non-evaluable" | "confounded";
  rosterHealthQualification:
    | "aligned-healthy"
    | "known-health-gap"
    | "different-rosters"
    | "non-evaluable";
  q7Verdict: Q7Verdict;
  outcomeCounts: OutcomeCounts;
}

export interface CountPhaseResult {
  laborUs: number;
  actors: Set<string>;
  valid: boolean;
}

export interface PilotMeasurementCalculation {
  reportFingerprint: string;
  contractVersion: string;
  activationVersion: string;
  activatedVenueSetFingerprint: string;
  evidenceCutoffUs: number;
  origin: EvidenceOrigin;
  windows: Record<Phase, WindowEvidence>;
  lookup: Record<Phase, RateCalculation>;
  pour: Record<Phase, RateCalculation>;
  count: CountCalculation;
  identity: {
    conflictingDeliveryCount: number;
    conflictedAttemptCount: number;
    inventoryCommitCount: number;
  };
}
