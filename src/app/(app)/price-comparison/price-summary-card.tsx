import Link from "next/link";
import { formatPrice } from "./price-comparison-helpers";
import type { WineComparison } from "./price-comparison-helpers";
import { wineDisplayName } from "@/lib/wine-display-name";

// BND-140: summary stats above the comparable-wines table — count, total
// savings opportunity, overpaid-vs-market count, and a link to the single
// biggest savings opportunity.
//
// One glass strip divided by hairlines (DESIGN.md — Components, Glass Panel),
// two cells per row on a phone and four across from `md:`, rather than four
// figures floating in a padded box.
export function PriceSummaryCard({
  comparable,
  totalSavings,
}: {
  comparable: WineComparison[];
  totalSavings: number;
}) {
  if (comparable.length === 0) return null;

  const overpaidCount = comparable.filter(
    (c) => c.variancePct != null && c.variancePct > 0,
  ).length;
  const topOpportunity = comparable[0];
  const showTopOpportunity =
    topOpportunity != null && topOpportunity.potentialSavings > 0;

  const cells: React.ReactNode[] = [
    <Cell key="count" label="Wines with multiple suppliers">
      <span className="tabular text-ink">{comparable.length}</span>
    </Cell>,
  ];
  if (totalSavings > 0) {
    cells.push(
      <Cell key="savings" label="Potential savings">
        <span className="tabular text-ready-ink">
          {formatPrice(totalSavings)}
        </span>
      </Cell>,
    );
  }
  if (overpaidCount > 0) {
    cells.push(
      <Cell key="overpaid" label="Overpaid vs market">
        <span className="tabular text-risk-ink">{overpaidCount}</span>
      </Cell>,
    );
  }
  if (showTopOpportunity) {
    cells.push(
      <Link
        key="top"
        href={`/cellar?wine=${topOpportunity.wine.id}`}
        aria-label={`View top savings opportunity: ${topOpportunity.wine.producer} ${wineDisplayName(topOpportunity.wine.producer, topOpportunity.wine.name)} in cellar`}
        className="group block min-w-0 p-md focus-ring"
      >
        <span className="block truncate text-caption font-medium uppercase text-grey">
          Top opportunity
        </span>
        <span className="mt-xs block truncate font-serif text-heading-sm font-normal leading-none">
          <span className="tabular text-ready-ink group-hover:text-accent">
            Save {formatPrice(topOpportunity.potentialSavings)}
          </span>
        </span>
        <span className="mt-2xs block truncate text-ledger text-grey group-hover:text-accent">
          {topOpportunity.wine.producer} ·{" "}
          {wineDisplayName(topOpportunity.wine.producer, topOpportunity.wine.name)}
          {topOpportunity.wine.vintage ? ` ${topOpportunity.wine.vintage}` : ""}
        </span>
      </Link>,
    );
  }

  return (
    <div className="glass mb-lg grid grid-cols-2 overflow-hidden rounded-card md:grid-cols-4">
      {cells.map((cell, i) => (
        <div key={i} className={`min-w-0 border-rule ${cellEdges(i)}`}>
          {cell}
        </div>
      ))}
    </div>
  );
}

/** Hairlines by position: a phone divides 2 up, desktop 4 across. */
function cellEdges(i: number): string {
  return [
    i % 2 !== 0 ? "border-l" : "",
    i >= 2 ? "border-t" : "",
    "md:border-t-0",
    i % 4 !== 0 ? "md:border-l" : "md:border-l-0",
  ]
    .filter(Boolean)
    .join(" ");
}

function Cell({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-w-0 p-md">
      <div className="truncate text-caption font-medium uppercase text-grey">
        {label}
      </div>
      <div className="mt-xs truncate font-serif text-heading-sm font-normal leading-none">
        {children}
      </div>
    </div>
  );
}
