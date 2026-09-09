"use client";

import { AlertTriangle } from "lucide-react";
import type { ScanQuality } from "@/lib/scanner/types";

interface ConfidenceGateViewProps {
  quality: ScanQuality;
  onReviewResults: () => void;
  onManualEntry: () => void;
}

export function ConfidenceGateView({
  quality,
  onReviewResults,
  onManualEntry,
}: ConfidenceGateViewProps) {
  const isArithmeticMismatch = quality.reason === "arithmetic_mismatch";

  const message = isArithmeticMismatch
    ? "Some of the numbers on this invoice don't add up — a quantity, unit cost, or total looks inconsistent. Review the flagged wines before saving."
    : quality.reason === "too_few_items"
      ? `Only ${quality.totalItems} wine${quality.totalItems === 1 ? "" : "s"} found. The invoice may not have been fully captured.`
      : quality.reason === "both"
        ? `Only ${quality.totalItems} wine${quality.totalItems === 1 ? "" : "s"} found with ${Math.round(quality.avgConfidence * 100)}% average confidence. Many fields may need correction.`
        : `${quality.lowConfidenceItems} of ${quality.totalItems} wines have low confidence (${Math.round(quality.avgConfidence * 100)}% average). Several fields may need correction.`;

  const heading = isArithmeticMismatch
    ? "This invoice needs a second look"
    : "This invoice was harder to read";

  return (
    <section className="flex min-h-[60vh] items-center justify-center">
      <div className="glass w-full max-w-[480px] rounded-card p-xl text-center">
        <div className="mx-auto mb-md flex h-14 w-14 items-center justify-center rounded-full border border-accent/60 text-accent">
          <AlertTriangle className="h-6 w-6" strokeWidth={1.75} />
        </div>
        <span className="text-caption font-medium uppercase tracking-[0.18em] text-accent">
          Verify
        </span>
        <h2 className="mt-xs font-serif text-heading-sm font-normal text-ink">
          {heading}
        </h2>
        <p className="mt-sm text-body-sm text-ink-soft">{message}</p>
        <div className="mt-lg grid grid-cols-1 gap-sm md:grid-cols-2 md:gap-md">
          <button
            type="button"
            onClick={onReviewResults}
            className="flex h-12 items-center justify-center gap-sm rounded-pill bg-primary text-control font-semibold text-seal-ink transition-colors hover:bg-primary-hover focus-ring"
          >
            Review AI results
          </button>
          <button
            type="button"
            onClick={onManualEntry}
            className="flex h-12 items-center justify-center gap-sm rounded-pill border border-rule-strong bg-transparent text-control font-medium text-ink transition-colors hover:border-accent hover:text-accent focus-ring"
          >
            Enter manually
          </button>
        </div>
      </div>
    </section>
  );
}
