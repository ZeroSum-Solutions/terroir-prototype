"use client";

import { Check, X } from "lucide-react";
import type { MatchedWine } from "../scan-bottle-state";
import { wineTitle } from "@/lib/wine-display-name";

interface LocationViewProps {
  wine: MatchedWine;
  section: string;
  binLocation: string;
  /** SD-10: a refused save, reported next to the fields that produced it. */
  locationError: string | null;
  onSectionChange: (value: string) => void;
  onBinLocationChange: (value: string) => void;
  onSubmit: (e?: React.FormEvent) => void;
  onBack: () => void;
  confirming: boolean;
}

export function LocationView({
  wine,
  section,
  binLocation,
  locationError,
  onSectionChange,
  onBinLocationChange,
  onSubmit,
  onBack,
  confirming,
}: LocationViewProps) {
  return (
    <div className="space-y-md">
      <div className="rounded-card card-surface p-md md:p-lg">
        <div className="mb-md flex items-start justify-between">
          <span className="text-caption font-medium uppercase tracking-[0.18em] text-grey">
            Bottle location
          </span>
          <span className="rounded-pill border border-rule-strong px-sm py-2xs text-ledger font-medium text-ink-soft">
            {wineTitle(wine.producer, wine.name)}
            {wine.vintage ? " " + wine.vintage : ""}
          </span>
        </div>
        <form onSubmit={onSubmit} className="space-y-md">
          <div>
            <label
              htmlFor="bottle-section"
              className="mb-xs block text-caption font-medium uppercase tracking-[0.18em] text-grey"
            >
              Section
            </label>
            <input
              id="bottle-section"
              type="text"
              autoComplete="off"
              autoFocus
              value={section}
              onChange={(e) => onSectionChange(e.target.value)}
              placeholder='e.g. "Red Room", "Main Cellar"'
              className="h-12 w-full rounded-pill border border-rule-strong bg-surface-sunken px-md text-control text-ink placeholder:text-grey focus:border-accent focus-ring"
            />
          </div>
          <div>
            <label
              htmlFor="bottle-bin"
              className="mb-xs block text-caption font-medium uppercase tracking-[0.18em] text-grey"
            >
              Bin location
            </label>
            <input
              id="bottle-bin"
              type="text"
              autoComplete="off"
              value={binLocation}
              onChange={(e) => onBinLocationChange(e.target.value)}
              placeholder='e.g. "A-12", "Shelf 3, Row 5"'
              className="h-12 w-full rounded-pill border border-rule-strong bg-surface-sunken px-md text-control text-ink placeholder:text-grey focus:border-accent focus-ring"
            />
          </div>
          {locationError && (
            <p role="alert" className="text-body-sm text-risk-ink">
              {locationError}
            </p>
          )}
          <div className="grid grid-cols-2 gap-sm">
            <button
              type="button"
              onClick={onBack}
              className="flex h-12 items-center justify-center gap-sm rounded-pill border border-rule-strong bg-transparent text-control font-medium text-ink transition-colors hover:border-accent hover:text-accent focus-ring"
            >
              <X className="h-4 w-4" strokeWidth={1.9} />
              Back
            </button>
            <button
              type="submit"
              disabled={!section.trim() || !binLocation.trim() || confirming}
              className="flex h-12 items-center justify-center gap-sm rounded-pill bg-primary text-control font-semibold text-seal-ink transition-colors hover:bg-primary-hover focus-ring disabled:opacity-50"
            >
              <Check className="h-4 w-4" strokeWidth={1.9} />
              {confirming ? "Saving..." : "Save location"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
