"use client";

import { X } from "lucide-react";
import type { MatchedWine } from "../scan-bottle-state";
import { wineDisplayName } from "@/lib/wine-display-name";

interface CorrectingViewProps {
  searchQuery: string;
  onSearchChange: (query: string) => void;
  searching: boolean;
  searchResults: MatchedWine[];
  searchError: string | null;
  onSelect: (wine: MatchedWine) => void;
  onCancel: () => void;
}

export function CorrectingView({
  searchQuery,
  onSearchChange,
  searching,
  searchResults,
  searchError,
  onSelect,
  onCancel,
}: CorrectingViewProps) {
  return (
    <div className="space-y-md">
      <div className="rounded-card card-surface p-md md:p-lg">
        <label
          htmlFor="correct-search"
          className="mb-xs block text-caption font-medium uppercase tracking-[0.18em] text-grey"
        >
          Search for the correct wine
        </label>
        <input
          id="correct-search"
          type="search"
          inputMode="search"
          autoComplete="off"
          autoFocus
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Search by producer, name, or vintage..."
          className="h-12 w-full rounded-pill border border-rule-strong bg-surface-sunken px-md text-control text-ink placeholder:text-grey focus:border-accent focus-ring"
        />
      </div>

      {searching && (
        <p className="px-md text-body-sm text-grey">Searching...</p>
      )}

      {!searching && searchError && (
        <p role="alert" className="px-md text-body-sm text-risk-ink">
          {searchError}
        </p>
      )}

      {!searching && searchResults.length > 0 && (
        <ul className="divide-y divide-rule rounded-card card-surface">
          {searchResults.map((w) => (
            <li key={w.id}>
              <button
                type="button"
                onClick={() => onSelect(w)}
                className="flex min-h-11 w-full items-start gap-md px-md py-md text-left transition-colors hover:bg-surface-raised focus-ring"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate font-serif text-body-lg font-medium text-ink">
                    {w.producer}
                  </p>
                  <p className="truncate text-body-sm text-grey">
                    {wineDisplayName(w.producer, w.name)}
                    {w.vintage ? ", " + w.vintage : ""}
                  </p>
                </div>
                <span className="mt-0.5 shrink-0 text-ledger text-grey">
                  {w.varietal}
                  {w.varietal && w.region ? " . " : ""}
                  {w.region}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {!searching &&
        !searchError &&
        searchQuery.length >= 2 &&
        searchResults.length === 0 && (
          <p className="px-md text-body-sm text-grey">
            No wines found for &ldquo;
            {searchQuery}
            &rdquo;.
          </p>
        )}

      <button
        type="button"
        onClick={onCancel}
        className="flex h-12 w-full items-center justify-center gap-sm rounded-pill border border-rule-strong bg-transparent text-control font-medium text-ink transition-colors hover:border-accent hover:text-accent focus-ring"
      >
        <X className="h-4 w-4" strokeWidth={2} />
        Cancel
      </button>
    </div>
  );
}
