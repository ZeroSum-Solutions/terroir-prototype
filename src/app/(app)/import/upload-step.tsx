"use client";

// The upload step: choose/drag/paste a CSV or .xlsx, see the wait estimate
// for this file, download the template. Extracted verbatim from
// import-client.tsx, which still owns every piece of state behind it
// (file selection, spreadsheet conversion, the preview-unit count).

import { AlertTriangle, Loader2, Upload } from "lucide-react";
import Link from "next/link";
import { CLIENT_CHUNK_TARGET_ROWS } from "@/domains/import/constants";
import { describeWaitEstimate, estimateChunkedPhaseWaitSeconds } from "@/domains/import/wait-estimate";

/** BLOCK 1 (round-13 fix) — countPreviewUnits (preview-units.ts) resolves
 * asynchronously (it reads the whole file), so the wait estimate it
 * produces is NOT available the instant a file is selected. Without
 * tracking that gap explicitly, two races were possible: (1) an operator
 * could click Preview in the window before the estimate ever resolves,
 * seeing no disclosure at all; (2) switching from a small file to a large
 * one kept showing the SMALL file's stale estimate/unit count until the
 * new one resolved, so a click in that window committed to the wrong
 * file's wait. "pending" is set SYNCHRONOUSLY, DURING RENDER, the instant
 * `file` changes (see usePreviewUnits, use-preview-units.ts — a
 * render-phase state adjustment, not an effect), clearing whatever the
 * previous file's status was — Preview stays disabled for the whole
 * "pending" window on either race. "unavailable" (the file couldn't even
 * be decoded/split) still allows a click: handlePreview's own real
 * decode/split surfaces the actual error, there is nothing more honest to
 * gate on here. */
export type PreviewUnitsStatus = "idle" | "pending" | "ready" | "unavailable";

export function UploadStep({
  file,
  setFile,
  converting,
  conversionNotice,
  dropNotice,
  fileInputRef,
  onPreview,
  previewing,
  previewUnits,
  previewUnitsStatus,
  error,
}: {
  file: File | null;
  setFile: (f: File | null) => void;
  /** True while a chosen .xlsx is being converted to CSV server-side. */
  converting: boolean;
  /** What the conversion read, once it succeeds — which sheet, how many rows.
   * A workbook can hold several sheets and only the first is imported, so the
   * operator is told which one they are about to preview. */
  conversionNotice: string | null;
  /** Set when a drop carried several files and only the first was taken. */
  dropNotice: string | null;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  onPreview: () => void;
  previewing: boolean;
  /** BLOCK 1 (round-11 fix): the preview/confirm unit count
   * (countPreviewUnits) for the currently-selected file — 1 for a plain
   * file, a chunk count for one over MAX_ROWS, or null before it's known
   * (no file selected yet, or the file couldn't even be decoded/split).
   * Drives the wait estimate below on BOTH paths, shown as soon as it's
   * known — before the operator ever clicks Preview, not only once
   * "previewing" is already true. */
  previewUnits: number | null;
  /** BLOCK 1 (round-13 fix): whether previewUnits (above) reflects the
   * CURRENTLY selected file yet — see PreviewUnitsStatus's own comment.
   * Gates the Preview button below so a click can't land in the window
   * before the estimate resolves, or while a stale previous-file estimate
   * is still on screen mid-swap. */
  previewUnitsStatus: PreviewUnitsStatus;
  error: string | null;
}) {
  return (
    <div className="glass rounded-card p-lg">
      <p className="mb-md text-control text-grey">On your phone, choose a file from Files or your cloud drive. Nothing changes in your stock during preview.</p>
      <label
        htmlFor="import-file"
        className="flex min-h-11 cursor-pointer flex-col items-center justify-center gap-sm rounded-card border border-dashed border-rule-strong px-lg py-xl text-center transition-colors hover:border-accent focus-ring"
      >
        <input
          ref={fileInputRef}
          id="import-file"
          type="file"
          accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          className="sr-only"
          onChange={(event) => setFile(event.target.files?.[0] ?? null)}
        />
        <span className="flex h-14 w-14 items-center justify-center rounded-full bg-primary text-seal-ink">
          <Upload className="h-6 w-6" strokeWidth={1.75} aria-hidden="true" />
        </span>
        <span className="text-control font-medium text-ink">
          {converting ? "Reading spreadsheet…" : file ? file.name : "Choose CSV or Excel"}
        </span>
        <span className="text-control text-grey">
          .csv or .xlsx. Large CSV files are split into {CLIENT_CHUNK_TARGET_ROWS}-row parts, with a 5 MB limit per upload.
        </span>
      </label>

      {dropNotice && (
        <p role="status" className="mt-md text-body-sm text-ink-soft">{dropNotice}</p>
      )}

      {conversionNotice && (
        <p className="mt-md text-body-sm text-ink-soft">{conversionNotice}</p>
      )}

      {error && (
        <p role="alert" className="mt-md flex items-start gap-xs text-body-sm text-risk-ink">
          <AlertTriangle className="mt-[2px] h-4 w-4 shrink-0" aria-hidden="true" />
          {error}
        </p>
      )}

      {/* BLOCK 1 (round-11 fix, was WARN 4 round-29 audit): shown as soon as
          previewUnits is known — BEFORE the operator clicks Preview, on
          every file (single-unit or multi-chunk), not only a chunked one
          and not only once "previewing" is already true. A multi-chunk
          file is previewed one chunk at a time, so this is the total for
          the whole (sequential) phase, not any one chunk's own budget. */}
      {previewUnits !== null && (
        <p className="mt-md text-body-sm text-ink-soft">
          {previewUnits > 1
            ? `This file needs ${previewUnits} chunks, uploaded one at a time — previewing it is estimated to take `
            : "Previewing this file is estimated to take "}
          up to {describeWaitEstimate(estimateChunkedPhaseWaitSeconds(previewUnits))}.
          {previewUnits > 1 ? " Confirming afterward repeats a similar, chunk-by-chunk process." : ""}
        </p>
      )}

      <button
        type="button"
        // BLOCK 1 (round-13 fix): disabled while previewUnitsStatus is
        // "pending" — the window where this file's own estimate hasn't
        // resolved yet (either it was just selected, or a different file
        // was just swapped in and this one's async count is still in
        // flight). "unavailable" still allows a click: handlePreview's own
        // real decode/split will surface the actual error.
        // `converting` is belt-and-braces: the conversion path clears `file`
        // first, so `!file` already covers it — but the guard must not depend on
        // that ordering staying true.
        disabled={!file || converting || previewing || previewUnitsStatus === "pending"}
        onClick={onPreview}
        className="mt-lg flex min-h-11 w-full items-center justify-center gap-xs rounded-pill bg-primary px-lg text-control font-medium text-seal-ink transition-colors hover:bg-primary-hover focus-ring disabled:cursor-not-allowed disabled:opacity-60"
      >
        {previewing ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
        {previewing ? "Reading file…" : "Preview import"}
      </button>

      {/* A real route, not a `data:` URI `<a download>` — mobile Safari
          handles download on data: URIs unreliably and tends to navigate
          the tab to raw text instead. The route sets Content-Disposition
          so the download attribute below is a hint, not the mechanism. */}
      <a
        href="/api/import/template"
        download="cellar-import-template.csv"
        className="mt-md flex min-h-11 items-center justify-center text-body-sm font-medium text-accent underline underline-offset-4 hover:text-ink focus-ring"
      >
        Download CSV template
      </a>
      <details className="mt-md border-t border-rule pt-sm text-control text-ink-soft">
        <summary className="min-h-11 cursor-pointer font-medium text-ink focus-ring">Which file should I use?</summary>
        <p className="mt-xs">Use the CSV template for column names and examples. Include the wine name, quantity and bottle size; keep the producer and vintage in separate columns when available.</p>
        <p className="mt-sm">Excel imports read the first worksheet only. Export Apple Numbers, Google Sheets or older .xls workbooks as CSV or .xlsx first.</p>
        <Link href="/scan" className="mt-sm flex min-h-11 items-center text-accent underline underline-offset-4 focus-ring">Have an invoice photo or PDF? Open Scan</Link>
      </details>
    </div>
  );
}
