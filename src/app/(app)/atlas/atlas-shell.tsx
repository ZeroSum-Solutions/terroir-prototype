"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { X } from "lucide-react";
import { useFocusTrap } from "@/lib/hooks/use-focus-trap";
import { cn } from "@/lib/utils";
import type { FacetCount } from "@/lib/cellar-facets";
import {
  aggregateAtlasCountries,
  regionsForCountry,
  type AtlasCountryAggregate,
  type AtlasFacetRow,
} from "@/lib/atlas/aggregate";
import { AtlasWorldMap } from "./atlas-world-map";

/**
 * Atlas v1 (recon lane "atlas-map") — owns which country is tapped and
 * renders the map + its region bottom sheet. Mirrors cellar's own
 * dawn-hero header and the filter sheet's dialog/scrim idiom
 * (cellar-filter-sheet.tsx) rather than inventing a new drawer pattern.
 */
export function AtlasShell({
  rows,
  restaurantName,
}: {
  rows: AtlasFacetRow[];
  restaurantName: string;
}) {
  const { countries, unmatched } = useMemo(() => aggregateAtlasCountries(rows), [rows]);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const hasCountryData = countries.length > 0 || unmatched.length > 0;

  const selectedCountry = countries.find((c) => c.key === selectedKey) ?? null;
  const regions = useMemo(
    () => (selectedCountry ? regionsForCountry(rows, selectedCountry.rawLabels) : []),
    [rows, selectedCountry],
  );

  return (
    <section className="min-w-0 max-w-full overflow-x-hidden">
      <div className="-mx-md -mt-lg dawn-gradient px-md pb-lg pt-lg md:-mx-lg md:-mt-xl md:px-lg md:pb-2xl md:pt-xl">
        <p className="truncate text-caption font-medium uppercase tracking-[0.18em] text-accent">
          {restaurantName} · Atlas
        </p>
        <h1 className="mt-xs max-w-[560px] font-serif text-heading font-normal leading-[1.0] tracking-[-0.02em] text-ink lg:max-w-[820px] lg:text-display">
          Every bottle has a <em className="font-normal italic text-primary">home</em>
        </h1>
      </div>

      {!hasCountryData ? (
        <p className="px-md py-2xl text-center text-body-sm text-grey md:px-lg">
          No country data yet — add a country to your wines to see them on the map.
        </p>
      ) : (
        <div className="px-md py-md md:px-lg">
          <AtlasWorldMap
            countries={countries}
            selectedKey={selectedKey}
            onSelect={setSelectedKey}
          />
          <AtlasCountryList
            countries={countries}
            selectedKey={selectedKey}
            onSelect={setSelectedKey}
          />
        </div>
      )}

      {unmatched.length > 0 && (
        <div className="px-md pb-lg md:px-lg">
          <h2 className="text-caption font-medium uppercase text-grey">Unmapped</h2>
          <p className="mt-2xs text-body-sm text-grey">
            These country labels on your wines didn&apos;t match a place on the map.
          </p>
          <ul className="mt-sm flex flex-col divide-y divide-rule border-y border-rule">
            {unmatched.map((entry) => (
              <li key={entry.label} className="flex items-center justify-between py-sm">
                <span className="text-body-sm text-ink">{entry.label}</span>
                <span className="tabular text-body-sm text-grey">
                  {entry.bottles}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {selectedCountry && (
        <AtlasRegionSheet
          country={selectedCountry}
          regions={regions}
          onClose={() => setSelectedKey(null)}
        />
      )}
    </section>
  );
}

/**
 * Accessible companion to the SVG map's button-role paths — small-country
 * geometry can't guarantee a real 44px hit area, and touch/assistive tech
 * shouldn't depend on hitting a sliver of coastline. Same onSelect as the
 * map, so both stay in sync; this is the reliable path, the map is the
 * at-a-glance one.
 */
function AtlasCountryList({
  countries,
  selectedKey,
  onSelect,
}: {
  countries: AtlasCountryAggregate[];
  selectedKey: string | null;
  onSelect: (key: string) => void;
}) {
  // Presence (wines > 0), not sealed count — an open-bottle-only country
  // must stay reachable from the list just like on the map.
  const withBottles = countries.filter((country) => country.wines > 0);
  if (withBottles.length === 0) return null;

  return (
    <div className="mt-md">
      <h2 className="text-caption font-medium uppercase text-grey">Countries</h2>
      <ul className="mt-sm grid grid-cols-2 gap-xs md:grid-cols-4" aria-label="Countries in your cellar">
        {withBottles.map((country) => {
          const selected = country.key === selectedKey;
          return (
            <li key={country.key} className="min-w-0">
              <button
                type="button"
                onClick={() => onSelect(country.key)}
                aria-pressed={selected}
                aria-label={`${country.label}, ${
                  country.bottles > 0
                    ? `${country.bottles} ${country.bottles === 1 ? "bottle" : "bottles"}`
                    : "open bottle only"
                }`}
                className={cn(
                  "flex min-h-11 w-full min-w-0 items-center justify-between gap-xs rounded-pill px-md transition-colors focus-ring",
                  selected
                    ? "bg-primary text-seal-ink"
                    : "glass text-ink",
                )}
              >
                <span className="min-w-0 truncate text-body-sm">{country.label}</span>
                <span className="shrink-0 tabular text-body-sm">
                  {country.bottles > 0 ? country.bottles : "open"}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function AtlasRegionSheet({
  country,
  regions,
  onClose,
}: {
  country: AtlasCountryAggregate;
  regions: FacetCount[];
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const headingId = "atlas-region-sheet-heading";

  useFocusTrap({ containerRef: dialogRef, onEscape: onClose });

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  const namedRegions = regions.filter((region) => !region.isUnknown);
  const unknownRegion = regions.find((region) => region.isUnknown);
  // rawLabels[0] — the actual wines.country spelling to filter /cellar by.
  // A country resolved from more than one raw spelling (rare) will only
  // link through its first-seen spelling; cellar's own URL-state contract
  // matches text exactly, not by alias.
  const countryParam = country.rawLabels[0];

  return (
    // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- backdrop-click-to-dismiss is a mouse-only convenience; the dialog below already has full keyboard access via useFocusTrap (Escape + a visible Close button).
    <div
      className="fixed inset-0 z-[var(--z-dialog)] flex items-end justify-center bg-scrim md:items-center"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        className="glass flex max-h-[75vh] w-full flex-col overflow-hidden rounded-t-card md:max-w-[440px] md:rounded-card"
      >
        <header className="flex items-center justify-between border-b border-rule px-md py-sm">
          <h2 id={headingId} className="font-serif text-subheading font-normal text-ink">
            {country.label}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-11 w-11 items-center justify-center rounded-pill text-grey transition-colors hover:bg-surface-raised focus-ring"
          >
            <X className="h-5 w-5" strokeWidth={2} aria-hidden />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto overscroll-contain px-md py-md">
          {namedRegions.length === 0 && !unknownRegion ? (
            <p className="py-md text-center text-body-sm text-grey">No regions recorded.</p>
          ) : (
            <ul className="flex flex-col divide-y divide-rule">
              {namedRegions.map((region) => (
                <li key={region.value}>
                  <Link
                    href={`/cellar?country=${encodeURIComponent(countryParam)}&region=${encodeURIComponent(region.label)}`}
                    className="flex min-h-11 items-center justify-between gap-md py-sm text-body-sm text-ink hover:text-accent"
                  >
                    <span className="truncate">{region.label}</span>
                    <span className="tabular text-grey">{region.count}</span>
                  </Link>
                </li>
              ))}
              {unknownRegion && (
                <li className="flex min-h-11 items-center justify-between gap-md py-sm text-body-sm text-grey">
                  <span>Unknown</span>
                  <span className="tabular">{unknownRegion.count}</span>
                </li>
              )}
            </ul>
          )}
        </div>

        <footer className="border-t border-rule px-md py-sm">
          <Link
            href={`/cellar?country=${encodeURIComponent(countryParam)}`}
            className="flex min-h-11 items-center justify-center rounded-pill bg-primary px-md text-control font-semibold text-seal-ink transition-colors hover:bg-primary-hover focus-ring"
          >
            View all {country.wines} in {country.label}
          </Link>
        </footer>
      </div>
    </div>
  );
}
