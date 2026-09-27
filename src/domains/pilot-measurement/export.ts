import { encodeCsv, type CsvCell } from "@/lib/csv/encode";
import type {
  EvidenceOrigin,
  PilotMeasurementCalculation,
  RateCalculation,
} from "./types";

export const PILOT_EXPORT_COLUMNS = [
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
] as const;

type ExportColumn = (typeof PILOT_EXPORT_COLUMNS)[number];
type ExportRow = Record<ExportColumn, CsvCell>;

export interface PilotCsvExport {
  filename: string;
  csv: string;
}

function emptyRow(): ExportRow {
  return Object.fromEntries(PILOT_EXPORT_COLUMNS.map((column) => [column, ""])) as ExportRow;
}

function contributorBucket(count: number): "<5" | "5-9" | "10+" {
  if (count < 5) return "<5";
  if (count < 10) return "5-9";
  return "10+";
}

function dimensions(
  calculation: PilotMeasurementCalculation,
  metric: "lookup" | "pour" | "count",
): ExportRow {
  return {
    ...emptyRow(),
    report_fingerprint: calculation.reportFingerprint,
    contract_version: calculation.contractVersion,
    activation_version: calculation.activationVersion,
    evidence_origin: calculation.origin,
    metric,
    evidence_cutoff_us: calculation.evidenceCutoffUs,
    activated_venue_set_fingerprint: calculation.activatedVenueSetFingerprint,
  };
}

function privacyControls(row: ExportRow, contributorCount: number): boolean {
  const bucket = contributorBucket(contributorCount);
  const suppressed = bucket === "<5";
  row.summary_status = suppressed ? "suppressed-small-cohort" : "released";
  row.summary_contributor_bucket = bucket;
  row.diagnostic_status = "not-exported";
  row.q7_verdict = suppressed ? "not-evaluable-privacy" : row.q7_verdict;
  return suppressed;
}

function rateRow(
  calculation: PilotMeasurementCalculation,
  rate: RateCalculation,
): ExportRow {
  const row = dimensions(calculation, rate.metric);
  const window = calculation.windows[rate.phase];
  row.evaluation_phase = rate.phase;
  row.evaluation_window_start_us = window.startUs;
  row.evaluation_window_end_us = window.endUs;
  row.q7_verdict = rate.q7Verdict;
  if (privacyControls(row, rate.contributorIds.size)) return row;

  row.coarse_qualification = rate.coarseQualification;
  row.numerator = rate.numerator;
  row.denominator = rate.denominator;
  row.comparison_met = rate.thresholdMet;
  row.generic_failure_total = rate.genericFailureTotal;
  return row;
}

function countRow(calculation: PilotMeasurementCalculation): ExportRow {
  const row = dimensions(calculation, "count");
  const count = calculation.count;
  row.baseline_window_start_us = calculation.windows.baseline.startUs;
  row.baseline_window_end_us = calculation.windows.baseline.endUs;
  row.pilot_window_start_us = calculation.windows.pilot.startUs;
  row.pilot_window_end_us = calculation.windows.pilot.endUs;
  row.q7_verdict = count.q7Verdict;
  if (privacyControls(row, count.contributorCount)) return row;

  row.coarse_qualification = count.coarseQualification;
  row.baseline_staff_microseconds = count.baselineLaborUs;
  row.pilot_staff_microseconds = count.pilotLaborUs;
  row.comparison_met = count.comparisonMet;
  row.panel_evaluation_status = count.panelStatus;
  row.roster_health_qualification = count.rosterHealthQualification;
  return row;
}

function noticeRow(): ExportRow {
  return { ...emptyRow(), marker: "NOT REAL PILOT EVIDENCE" };
}

function safeFilenamePart(value: string): string {
  const part = value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return part || "report";
}

function render(
  calculation: PilotMeasurementCalculation,
  expectedOrigin: EvidenceOrigin,
  unexpectedProjectionRequests: readonly never[],
): string {
  if (unexpectedProjectionRequests.length > 0) {
    throw new Error("The canonical exporter accepts no projection request");
  }
  if (calculation.origin !== expectedOrigin) {
    const required = expectedOrigin === "synthetic-fixture" ? "synthetic evidence" : "real evidence";
    throw new Error(`This exporter requires ${required}`);
  }

  const rows: ExportRow[] = [];
  if (calculation.origin === "synthetic-fixture") rows.push(noticeRow());
  rows.push(
    rateRow(calculation, calculation.lookup.baseline),
    rateRow(calculation, calculation.lookup.pilot),
    rateRow(calculation, calculation.pour.baseline),
    rateRow(calculation, calculation.pour.pilot),
    countRow(calculation),
  );
  return encodeCsv([
    PILOT_EXPORT_COLUMNS,
    ...rows.map((row) => PILOT_EXPORT_COLUMNS.map((column) => row[column])),
  ]);
}

export function exportRealPilotCsv(
  calculation: PilotMeasurementCalculation,
  ...unexpectedProjectionRequests: never[]
): PilotCsvExport {
  return {
    filename: `pilot-measurement-${safeFilenamePart(calculation.reportFingerprint)}.csv`,
    csv: render(calculation, "runtime-validated-real", unexpectedProjectionRequests),
  };
}

export function exportSyntheticPilotCsv(
  calculation: PilotMeasurementCalculation,
  ...unexpectedProjectionRequests: never[]
): PilotCsvExport {
  return {
    filename: `pilot-measurement-synthetic-test-${safeFilenamePart(calculation.reportFingerprint)}.csv`,
    csv: render(calculation, "synthetic-fixture", unexpectedProjectionRequests),
  };
}
