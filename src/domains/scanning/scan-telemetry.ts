/**
 * Compatibility wrapper for scan pipeline stages.
 *
 * The former Sentry span path is retired. Keeping this exported wrapper
 * avoids a scanner refactor while ensuring each stage runs exactly once
 * and its original result or error passes through unchanged.
 */

export type ScanSpanAttributes = Record<string, string | number | boolean>;

/** Runs a pipeline stage once without logging, tracing, or error capture. */
export async function withScanSpan<T>(
  _stage: string,
  _attributes: ScanSpanAttributes,
  fn: () => Promise<T>,
): Promise<T> {
  return fn();
}
