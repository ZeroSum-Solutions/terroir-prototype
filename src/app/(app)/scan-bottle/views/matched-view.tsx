"use client";

import { Check, X } from "lucide-react";
import type { MatchedWine } from "../scan-bottle-state";
import { wineDisplayName } from "@/lib/wine-display-name";

interface MatchedViewProps {
  wine: MatchedWine;
  onCorrect: () => void;
  onConfirm: () => void;
}

const ROW =
  "flex items-baseline justify-between gap-md border-b border-rule py-sm last:border-b-0";
const ROW_LABEL = "text-caption font-medium uppercase tracking-[0.18em] text-grey";

export function MatchedView({ wine, onCorrect, onConfirm }: MatchedViewProps) {
  return (
    <div className="space-y-md">
      <div className="rounded-card card-surface p-md md:p-lg">
        <div className="mb-md flex items-start justify-between">
          <span className="text-caption font-medium uppercase tracking-[0.18em] text-grey">
            Matched wine
          </span>
          <span className="rounded-pill bg-ready-wash px-sm py-2xs text-caption font-medium uppercase tracking-[0.14em] text-ready-ink">
            Match found
          </span>
        </div>
        <h2 className="font-serif text-heading-sm font-normal leading-[1.15] text-ink">
          {wine.producer}
        </h2>
        <p className="mt-2xs font-serif text-subheading text-ink-soft">
          {wineDisplayName(wine.producer, wine.name)}
        </p>
        {/* Hairline rows, not a two-column key/value grid (DESIGN.md —
            Index Row): the eyebrow names the field, the value answers. */}
        <dl className="mt-md">
          {wine.vintage && (
            <div className={ROW}>
              <dt className={ROW_LABEL}>Vintage</dt>
              <dd className="tabular text-control text-ink">{wine.vintage}</dd>
            </div>
          )}
          {wine.varietal && (
            <div className={ROW}>
              <dt className={ROW_LABEL}>Varietal</dt>
              <dd className="text-control text-ink">{wine.varietal}</dd>
            </div>
          )}
          {wine.region && (
            <div className={ROW}>
              <dt className={ROW_LABEL}>Region</dt>
              <dd className="text-control text-ink">{wine.region}</dd>
            </div>
          )}
          {wine.country && (
            <div className={ROW}>
              <dt className={ROW_LABEL}>Country</dt>
              <dd className="text-control text-ink">{wine.country}</dd>
            </div>
          )}
        </dl>
      </div>
      <div className="grid grid-cols-2 gap-sm">
        <button
          type="button"
          onClick={onCorrect}
          className="flex h-12 items-center justify-center gap-sm rounded-pill border border-rule-strong bg-transparent text-control font-medium text-ink transition-colors hover:border-accent hover:text-accent focus-ring"
        >
          <X className="h-4 w-4" strokeWidth={1.9} />
          Correct
        </button>
        <button
          type="button"
          onClick={onConfirm}
          className="flex h-12 items-center justify-center gap-sm rounded-pill bg-primary text-control font-semibold text-seal-ink transition-colors hover:bg-primary-hover focus-ring"
        >
          <Check className="h-4 w-4" strokeWidth={1.9} />
          Confirm
        </button>
      </div>
    </div>
  );
}
