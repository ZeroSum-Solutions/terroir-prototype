"use client";

import { ArrowRight, Camera, ClipboardPaste, FileUp, ImageIcon, Wine } from "lucide-react";
import { Check, ListOrdered, ScanLine } from "lucide-react";
import { useRef, useState, type RefObject } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { TimeAgo } from "@/components/time-ago";
import { accuracyColor } from "@/lib/scanner/accuracy-color";
import { markScanStage } from "@/lib/scanner/scan-timing";
import type { RecentScan, ScanMode } from "@/lib/scanner/types";
import { formatMoney } from "../components/field-inputs";
import { isImportableSpreadsheet } from "@/app/(app)/import/spreadsheet-handoff";
import { useFileIntake } from "@/lib/upload/use-file-intake";
import type { ClipboardReadOutcome } from "@/lib/upload/file-intake";

interface RecentScansListProps {
  scans: RecentScan[];
}

function RecentScansList({ scans }: RecentScansListProps) {
  if (scans.length === 0) return null;
  return (
    <section className="mt-2xl">
      <div className="mb-sm flex items-center justify-between"><h3 className="text-caption font-medium uppercase tracking-[0.18em] text-grey">Recent scans</h3><Link href="/scans" className="inline-flex min-h-11 items-center gap-xs text-caption font-medium uppercase tracking-[0.18em] text-grey hover:text-accent focus-ring">View all<ArrowRight className="h-3 w-3" strokeWidth={2} /></Link></div>
      {/* Hairline index rows on the plain canvas (DESIGN.md — Index Row):
          rows separate with a rule, never a gap. */}
      <div className="overflow-hidden rounded-card card-surface">
        {scans.map((s, i) => (
          <Link
            key={s.id}
            href={`/scan/${s.id}`}
            className={cn(
              "flex min-h-11 items-center gap-md px-md py-sm transition-colors hover:bg-surface-raised focus-ring",
              i > 0 && "border-t border-rule",
            )}
          >
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-xs text-caption font-medium uppercase tracking-[0.18em] text-grey">
                <TimeAgo iso={s.parsedAt} className="tabular" />
                {s.hasImage && (
                  <ImageIcon className="h-3 w-3" strokeWidth={1.9} aria-label="Has invoice image" />
                )}
              </span>
              <span className="mt-2xs block truncate font-serif text-body-lg text-ink">
                {s.distributor}
              </span>
            </span>
            <span className="shrink-0 text-right">
              <span className="tabular block text-body-lg text-ink">
                ${formatMoney(s.total)}
              </span>
              <span className="mt-2xs block text-ledger text-grey">
                <span className="tabular">{s.items}</span> wines ·{" "}
                <span className={cn("tabular", accuracyColor(s.accuracy))}>{s.accuracy}%</span>
              </span>
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}

/** What to tell the operator when the clipboard yields nothing. A refusal is
 * an ordinary answer here — Safari asks its own permission first, and a
 * clipboard holding text rather than a photo is simply the wrong clipboard. */
function pasteHintFor(outcome: Extract<ClipboardReadOutcome, { ok: false }>): string {
  if (outcome.reason === "empty") {
    return "No image on the clipboard. Copy a photo or screenshot first, then paste.";
  }
  return "Couldn\u2019t read the clipboard. Allow paste when your browser asks, or use Upload file.";
}

interface ReadyViewProps {
  disabled?: boolean;
  onStart: (files: File[]) => void;
  /** A spreadsheet chosen here belongs to /import, not to document
   * intelligence. The parent parks it and navigates rather than refusing it. */
  onSpreadsheet: (file: File) => void;
  mode: ScanMode;
  onModeChange: (mode: ScanMode) => void;
  recentScans: RecentScan[];
  savedResult: { itemCount: number; wineCount: number } | null;
  onDismissSaved: () => void;
}

export function ReadyView({
  disabled = false,
  onStart,
  onSpreadsheet,
  mode,
  onModeChange,
  recentScans,
  savedResult,
  onDismissSaved,
}: ReadyViewProps) {
  const cameraRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [pasteHint, setPasteHint] = useState<string | null>(null);
  const isBottle = mode === "bottle";

  // M1-1: client-side "capture" stage starts here — the moment the user
  // taps to open the camera/file picker.
  const beginCapture = (inputRef: RefObject<HTMLInputElement | null>) => {
    markScanStage("capture", "start");
    inputRef.current?.click();
  };

  /**
   * The one route every file takes, however it arrived — picked from the
   * file dialog, dragged in from the desktop, or pasted. Drag and paste get no
   * validation, routing or limits of their own; whatever the picker does with
   * a file, they do too.
   *
   * `capture` timing belongs to the picker path alone. That stage measures
   * tap-to-file-selected, and a dropped or pasted file waited on no dialog —
   * marking it would report a capture latency that never happened.
   */
  const acceptFiles = (files: File[], source: "picker" | "drop-or-paste") => {
    if (files.length === 0) return;
    // A cellar spreadsheet is not a scannable document — document intelligence
    // reads photos and PDFs. Hand it to /import instead of starting a scan that
    // could only fail. Deliberately BEFORE the capture-stage end marker: no
    // scan begins here, so there is no scan for that timing to belong to.
    const spreadsheet = files.find(isImportableSpreadsheet);
    if (spreadsheet) {
      onSpreadsheet(spreadsheet);
      return;
    }
    // M1-1: client-side "capture" stage ends here (started at the
    // take-photo/upload-file button click below); reported once a scan id
    // exists, in scanner.tsx's startScan.
    if (source === "picker") markScanStage("capture", "end");
    onStart(files);
  };

  const handleFiles = (input: HTMLInputElement) => {
    const fileArr = input.files ? Array.from(input.files) : [];
    // Reset so re-selecting the exact same file (e.g. retaking a photo
    // after "New photo") reliably fires `change` again — some mobile
    // browsers/webviews otherwise treat an unchanged input as a no-op.
    input.value = "";
    acceptFiles(fileArr, "picker");
  };

  const { isDragging, pasteFromClipboard, canPasteFromClipboard } = useFileIntake({
    enabled: !disabled,
    onFiles: (files) => {
      setPasteHint(null);
      acceptFiles(files, "drop-or-paste");
    },
  });

  const handlePaste = async () => {
    setPasteHint(null);
    const outcome = await pasteFromClipboard();
    if (!outcome.ok) setPasteHint(pasteHintFor(outcome));
  };

  return (
    <section>
      {/* Shown while a drag carrying files is anywhere over the window: the
          whole page is the drop target, so there is no rectangle to aim at. */}
      {isDragging && (
        <div
          aria-hidden="true"
          className="fixed inset-0 z-[var(--z-dialog)] flex items-center justify-center bg-scrim p-lg"
        >
          <div className="glass rounded-card px-xl py-lg text-center">
            <p className="font-serif text-subheading text-ink">
              {isBottle ? "Drop the label photo" : "Drop to scan"}
            </p>
            <p className="mt-xs text-body-sm text-ink-soft">
              {isBottle ? "JPG or PNG" : "JPG, PNG, PDF — or a .csv/.xlsx cellar list"}
            </p>
          </div>
        </div>
      )}

      {/* SCAN-09's search bar moved to the global palette (P1 slice 2c):
          with no route-local search declared on this page, the palette's "/"
          shortcut now reaches it from /scan. */}

      {/* Masthead (DESIGN.md - Components, Masthead). No photograph on this
          route: the copper glow is the paint, and the eyebrow carries the
          section and the mode the switch below sets. */}
      <header className="dawn-gradient relative -mx-md -mt-lg mb-lg overflow-hidden px-md pb-lg pt-xl md:-mx-lg md:-mt-xl md:mb-xl md:px-lg md:pb-xl md:pt-2xl">
        <p className="text-caption font-medium uppercase tracking-[0.18em] text-accent">
          Scan &middot; {isBottle ? "Bottle" : "Invoice"}
        </p>
        <h1 className="mt-xs font-serif text-heading font-normal leading-[1.0] tracking-[-0.02em] text-ink">
          {isBottle ? "Scan a bottle label" : "Scan an invoice"}
        </h1>
        <p className="mt-sm max-w-[52ch] text-body text-ink-soft">
          {isBottle
            ? "Photograph a wine label. We'll identify the wine in a few seconds."
            : "Parsed into inventory in about 20 seconds."}
        </p>
      </header>

      {/* Mode switch - a glass segmented pill. The size token lives on the
          wrapper so cn() never has to choose between a size and a colour. */}
      <div className="mb-lg flex justify-center">
        <div className="glass inline-flex rounded-pill p-3xs text-control">
          <button
            type="button"
            onClick={() => onModeChange("invoice")}
            disabled={disabled}
            aria-pressed={!isBottle}
            className={cn(
              "flex min-h-11 items-center gap-xs rounded-pill px-md font-medium transition-colors focus-ring",
              !isBottle ? "bg-primary text-seal-ink" : "text-grey hover:text-ink",
            )}
          >
            <ScanLine className="h-3.5 w-3.5" strokeWidth={1.9} aria-hidden="true" />
            Invoice
          </button>
          <button
            type="button"
            onClick={() => onModeChange("bottle")}
            disabled={disabled}
            aria-pressed={isBottle}
            className={cn(
              "flex min-h-11 items-center gap-xs rounded-pill px-md font-medium transition-colors focus-ring",
              isBottle ? "bg-primary text-seal-ink" : "text-grey hover:text-ink",
            )}
          >
            <Wine className="h-3.5 w-3.5" strokeWidth={1.9} aria-hidden="true" />
            Bottle
          </button>
        </div>
      </div>

      {savedResult && (
        <div className="glass mb-lg flex items-center justify-between gap-sm rounded-card px-md py-sm">
          <div className="flex items-center gap-sm">
            <Check className="h-4 w-4 shrink-0 text-ready-ink" strokeWidth={2} aria-hidden="true" />
            <span role="status" aria-live="polite" className="text-body-sm text-ink">
              Saved {savedResult.itemCount} {savedResult.itemCount === 1 ? "item" : "items"} to inventory ({savedResult.wineCount} distinct {savedResult.wineCount === 1 ? "wine" : "wines"})
            </span>
          </div>
          <div className="flex shrink-0 items-center gap-xs">
            <Link
              href="/lists"
              onClick={onDismissSaved}
              className="flex min-h-11 items-center gap-xs rounded-pill px-sm text-caption font-medium uppercase tracking-[0.18em] text-accent hover:text-ink focus-ring"
            >
              <ListOrdered className="h-3.5 w-3.5" strokeWidth={1.9} aria-hidden="true" />
              Add to wine list
            </Link>
            <button
              type="button"
              onClick={onDismissSaved}
              className="min-h-11 px-xs text-caption font-medium uppercase tracking-[0.18em] text-grey hover:text-ink focus-ring"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      {/* The capture band: a full-bleed vault ground with a copper reticle
          drawn on it - four corner brackets and one scan line. */}
      <button
        type="button"
        onClick={() => beginCapture(cameraRef)}
        disabled={disabled}
        className="relative flex min-h-11 w-full flex-col items-center justify-center overflow-hidden rounded-card bg-surface-sunken px-lg py-2xl text-center transition-colors hover:bg-canvas focus-ring md:py-3xl"
      >
        <span aria-hidden="true" className="pointer-events-none absolute inset-md">
          <span className="absolute left-0 top-0 h-[26px] w-[26px] rounded-tl-lg border-l border-t border-accent/70" />
          <span className="absolute right-0 top-0 h-[26px] w-[26px] rounded-tr-lg border-r border-t border-accent/70" />
          <span className="absolute bottom-0 left-0 h-[26px] w-[26px] rounded-bl-lg border-b border-l border-accent/70" />
          <span className="absolute bottom-0 right-0 h-[26px] w-[26px] rounded-br-lg border-b border-r border-accent/70" />
          <span className="absolute inset-x-lg top-1/2 h-px bg-gradient-to-r from-transparent via-primary to-transparent" />
        </span>
        <span className="relative mb-md flex h-14 w-14 items-center justify-center rounded-full bg-primary text-seal-ink md:h-16 md:w-16">
          <Camera className="h-6 w-6 md:h-7 md:w-7" strokeWidth={1.75} aria-hidden="true" />
        </span>
        <h2 className="relative font-serif text-subheading font-normal text-ink md:text-heading-sm">
          {isBottle ? "Tap to photograph label" : "Tap to photograph"}
        </h2>
        {/* The zone is a camera target - advertising PDF formats on it was
            dishonest (a camera can't capture a PDF); file specs live on the
            upload affordance below (Kimi audit 2026-08-26). */}
        <p className="relative mt-xs text-body-sm text-grey">
          {isBottle
            ? "One label per photo"
            : "You'll review parsed lines before they reach the cellar"}
        </p>
      </button>

      {/* One camera entrance (the zone above) + one upload entrance - the
          old "Take photo" button duplicated the zone exactly. */}
      <div className="mt-md md:mt-lg">
        <div className="flex gap-sm">
          <button
            type="button"
            onClick={() => beginCapture(fileRef)}
            disabled={disabled}
            className="flex h-12 w-full flex-1 items-center justify-center gap-sm rounded-pill border border-rule-strong bg-transparent text-control font-medium text-ink transition-colors hover:border-accent hover:text-accent focus-ring"
          >
            <FileUp className="h-4 w-4" strokeWidth={1.9} aria-hidden="true" />
            Upload file
          </button>
          {/* The phone's only paste. A keyboard paste arrives as an event and
              needs no button, but a phone has no keyboard, and its long-press
              Paste menu appears only over an editable field - so asking the
              clipboard directly is the sole way to paste a photo here.
              Hidden where the browser cannot be asked. */}
          {canPasteFromClipboard && (
            <button
              type="button"
              onClick={() => void handlePaste()}
              disabled={disabled}
              className="flex h-12 shrink-0 items-center justify-center gap-sm rounded-pill border border-rule-strong bg-transparent px-lg text-control font-medium text-ink transition-colors hover:border-accent hover:text-accent focus-ring"
            >
              <ClipboardPaste className="h-4 w-4" strokeWidth={1.9} aria-hidden="true" />
              Paste
            </button>
          )}
        </div>
        {pasteHint && (
          <p role="status" className="mt-sm text-center text-ledger text-accent">
            {pasteHint}
          </p>
        )}
        <p className="mt-sm text-center text-ledger text-grey">
          {isBottle
            ? "JPG or PNG · up to 20MB · drag one in or paste it"
            : "JPG, PNG, or PDF · up to 10MB · multi-page invoices welcome · drag them in or paste them · a .csv or .xlsx cellar list opens in Import"}
        </p>
      </div>

      <input
        ref={cameraRef}
        disabled={disabled}
        type="file"
        accept="image/*"
        capture="environment"
        className="sr-only"
        onChange={(e) => handleFiles(e.currentTarget)}
      />
      <input
        ref={fileRef}
        disabled={disabled}
        type="file"
        accept={
          isBottle
            ? "image/jpeg,image/png"
            : "image/*,application/pdf,.csv,.xlsx"
        }
        // A multi-page invoice can genuinely be scanned as several files
        // in one batch (BND-081 / TER-CF-032); a bottle scan identifies
        // one wine from one label photo, so there's nothing to batch.
        multiple={!isBottle}
        className="sr-only"
        onChange={(e) => handleFiles(e.currentTarget)}
      />

      {!isBottle && <RecentScansList scans={recentScans} />}
    </section>
  );
}
