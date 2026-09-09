"use client";

import { Check, Loader2, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ScanMode } from "@/lib/scanner/types";

export type ScanStage = "upload" | "extract" | "identify" | "review";
type ScanStep = { stage: ScanStage; label: string };

const INVOICE_STEPS: readonly ScanStep[] = [
  { stage: "upload", label: "Uploading invoice" },
  { stage: "extract", label: "Extracting invoice details" },
  { stage: "review", label: "Preparing your review" },
] as const;

const BOTTLE_STEPS: readonly ScanStep[] = [
  { stage: "upload", label: "Uploading label photo" },
  { stage: "identify", label: "Identifying the wine" },
  { stage: "review", label: "Preparing your review" },
] as const;

export function stageForProgress(mode: ScanMode, progress: number): ScanStage {
  if (progress < 30) return "upload";
  if (progress < 70) return mode === "bottle" ? "identify" : "extract";
  return "review";
}

interface ProcessingViewProps {
  progress: number;
  stage: ScanStage;
  mode: ScanMode;
  onCancel: () => void;
  /**
   * Object URL for the just-captured photo, set synchronously on file
   * selection (before the network round-trip resolves) so the user sees
   * their own photo rather than a generic icon — the walkthrough §1.2
   * "immediate acknowledgment" requirement.
   */
  previewUrl?: string | null;
}

export function ProcessingView({ progress, stage, mode, onCancel, previewUrl }: ProcessingViewProps) {
  const capped = progress >= 90;
  const isBottle = mode === "bottle";
  const steps = isBottle ? BOTTLE_STEPS : INVOICE_STEPS;
  const activeStep = steps.find((step) => step.stage === stage) ?? steps[0];
  const activeIndex = steps.indexOf(activeStep);
  return (
    <section className="flex min-h-[60vh] items-center justify-center">
      <div className="glass w-full max-w-[420px] rounded-card p-xl text-center">
        {previewUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- Browser-local blob preview must render directly without image optimization or generated attributes.
          <img
            src={previewUrl}
            alt="What you captured"
            className="mx-auto mb-md h-20 w-20 rounded-lg border border-glass-edge object-cover"
          />
        ) : (
          <div className="mx-auto mb-md flex h-16 w-16 items-center justify-center rounded-full border border-accent/60 text-accent">
            <Sparkles className="h-7 w-7" strokeWidth={1.5} aria-hidden="true" />
          </div>
        )}
        <h2 className="font-serif text-heading-sm font-normal text-ink">
          {isBottle ? "Reading the label" : "Reading your invoice"}
        </h2>
        <p className="mt-xs text-body-sm text-ink-soft">
          {capped
            ? isBottle
              ? "Still working — this should finish shortly."
              : "Still working — large invoices can take up to 90 seconds."
            : isBottle
              ? "Usually 5-10 seconds."
              : "Usually 20-30 seconds."}
        </p>

        <div
          className="relative mt-lg h-[3px] overflow-hidden rounded-pill bg-rule-strong"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={progress}
          aria-valuetext={`${activeStep.label}, estimated ${progress}% complete`}
        >
          <div
            className="absolute inset-y-0 left-0 bg-gradient-to-r from-accent to-primary transition-[width] duration-100 ease-out"
            style={{ width: `${progress}%` }}
            aria-hidden="true"
          />
        </div>
        <div className="tabular mt-xs flex items-center justify-between text-caption uppercase tracking-[0.18em] text-grey">
          <span>Estimated progress: {progress}%</span>
          <span>{isBottle ? "Reading label details" : "Reading invoice details"}</span>
        </div>

        <span className="sr-only" aria-live="polite">
          {activeStep.label}
        </span>

        <ul className="mt-lg flex flex-col gap-sm text-left text-body-sm">
          {steps.map((step, i) => {
            const done = i < activeIndex;
            const active = step.stage === stage;
            return (
              <li
                key={step.stage}
                aria-current={active ? "step" : undefined}
                className={cn(
                  "flex items-center gap-sm",
                  done && "text-ink",
                  active && "text-accent",
                  !done && !active && "text-grey",
                )}
              >
                {done ? (
                  <Check className="h-4 w-4" strokeWidth={2.25} aria-hidden="true" />
                ) : active ? (
                  <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} aria-hidden="true" />
                ) : (
                  <span className="block h-3.5 w-3.5 rounded-full border-2 border-current opacity-40" aria-hidden="true" />
                )}
                {step.label}
              </li>
            );
          })}
        </ul>
        <button
          type="button"
          onClick={onCancel}
          className="mt-lg h-11 rounded-pill border border-rule-strong bg-transparent px-lg text-control font-medium text-ink transition-colors hover:border-accent hover:text-accent focus-ring"
        >
          Cancel scan
        </button>
      </div>
    </section>
  );
}
