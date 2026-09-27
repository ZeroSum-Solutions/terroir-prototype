"use client";

import { Check, X } from "lucide-react";
import type { MatchedWine } from "../scan-bottle-state";
import { wineTitle } from "@/lib/wine-display-name";
import type { ActiveBinsState } from "../use-active-bins";

interface LocationViewProps {
  wine: MatchedWine | null;
  section: string;
  binId: string;
  bins: ActiveBinsState;
  onReloadBins: () => void;
  /** SD-10: a refused save, reported next to the fields that produced it. */
  locationError: string | null;
  onSectionChange: (value: string) => void;
  onBinSelect: (value: string) => void;
  onSubmit: (e?: React.FormEvent) => void;
  onBack: () => void;
  confirming: boolean;
}

export function LocationView({
  wine,
  section,
  binId,
  bins,
  onReloadBins,
  locationError,
  onSectionChange,
  onBinSelect,
  onSubmit,
  onBack,
  confirming,
}: LocationViewProps) {
  return (
    <div className="space-y-md">
      <div className="rounded-card card-surface p-md md:p-lg">
        <div className="mb-md flex flex-wrap items-start justify-between gap-sm">
          <span className="text-caption font-medium uppercase tracking-[0.18em] text-grey">
            Bottle location
          </span>
          <span className="rounded-pill border border-rule-strong px-sm py-2xs text-ledger font-medium text-ink-soft">
            {wine ? wineTitle(wine.producer, wine.name) : "Pending wine selection retained"}
            {wine?.vintage ? " " + wine.vintage : ""}
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
              maxLength={200}
              disabled={confirming}
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
            <select
              id="bottle-bin"
              value={binId}
              disabled={confirming || bins.status !== "ready" || bins.bins.length === 0}
              onChange={(e) => onBinSelect(e.target.value)}
              className="h-12 w-full rounded-pill border border-rule-strong bg-surface-sunken px-md text-control text-ink placeholder:text-grey focus:border-accent focus-ring"
            >
              <option value="">Select an active bin</option>
              {bins.bins.map((bin) => <option key={bin.id} value={bin.id}>{bin.code}</option>)}
            </select>
            {bins.status === "loading" && <p role="status" className="mt-xs text-body-sm text-grey">Loading active bins…</p>}
            {bins.status === "error" && <p role="alert" className="mt-xs text-body-sm text-risk-ink">Active bins could not be loaded. Nothing has been received.</p>}
            {bins.status === "ready" && bins.bins.length === 0 && <p role="status" className="mt-xs text-body-sm text-ink-soft">No active bins. Ask a manager to create a bin before receiving this bottle.</p>}
            {bins.status !== "loading" && <button type="button" disabled={confirming} onClick={onReloadBins}
              className="min-h-11 px-sm text-control text-accent focus-ring">Refresh bins</button>}
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
              disabled={confirming}
              className="flex h-12 items-center justify-center gap-sm rounded-pill border border-rule-strong bg-transparent text-control font-medium text-ink transition-colors hover:border-accent hover:text-accent focus-ring"
            >
              <X className="h-4 w-4" strokeWidth={1.9} />
              Back
            </button>
            <button
              type="submit"
              disabled={!section.trim() || bins.status !== "ready" || !bins.bins.some((bin) => bin.id === binId) || confirming}
              className="flex h-12 items-center justify-center gap-sm rounded-pill bg-primary text-control font-semibold text-seal-ink transition-colors hover:bg-primary-hover focus-ring disabled:opacity-50"
            >
              <Check className="h-4 w-4" strokeWidth={1.9} />
              {confirming ? "Saving..." : "Receive 1 bottle"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
