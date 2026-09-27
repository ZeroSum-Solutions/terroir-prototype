/**
 * Local client-side scan latency measurement.
 *
 * Records User Timing marks (`performance.mark`) for the client-observable
 * stages of a scan — capture (tap-to-file-selected), prep (building the
 * upload request), upload (the network round trip), and render (state
 * update through next paint). The measurements stay in the current
 * process and are not exported to Sentry.
 *
 * Every export here is defensive: capturing or reporting timing can never
 * throw, block, or otherwise affect the scan itself (M1-1 acceptance #2).
 * The legacy parameters remain for caller compatibility while the export
 * channel is retired.
 */

export type ClientScanStage = "capture" | "prep" | "upload" | "render";

const MARK_NAMESPACE = "terroir:scan";

function markKey(stage: ClientScanStage, edge: "start" | "end"): string {
  return `${MARK_NAMESPACE}:${stage}:${edge}`;
}

/** Records a User Timing mark for a stage boundary. Never throws. */
export function markScanStage(stage: ClientScanStage, edge: "start" | "end"): void {
  try {
    if (typeof performance === "undefined" || typeof performance.mark !== "function") return;
    performance.mark(markKey(stage, edge));
  } catch {
    // Timing capture must never affect the scan (M1-1 acceptance #2).
  }
}

/**
 * Measures a stage's most recent start/end mark pair, then clears those
 * marks so a retried scan measures fresh boundaries. Returns the
 * measured duration in ms, or null if the stage was never fully marked
 * (e.g. a test that dispatches the file input directly, skipping the
 * button click that marks "capture:start"). Never throws.
 */
export function reportScanStage(
  _scanId: string,
  stage: ClientScanStage,
  _extra: Record<string, string | number | boolean> = {},
): number | null {
  try {
    if (typeof performance === "undefined" || typeof performance.measure !== "function") {
      return null;
    }
    const startKey = markKey(stage, "start");
    const endKey = markKey(stage, "end");
    if (performance.getEntriesByName(startKey).length === 0) return null;
    if (performance.getEntriesByName(endKey).length === 0) return null;

    const measureName = `${MARK_NAMESPACE}:${stage}:measure`;
    const measure = performance.measure(measureName, startKey, endKey);
    const durationMs = Math.round(measure.duration);

    performance.clearMarks(startKey);
    performance.clearMarks(endKey);
    performance.clearMeasures(measureName);

    return durationMs;
  } catch {
    return null;
  }
}
