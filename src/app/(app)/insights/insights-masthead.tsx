import { Download } from "lucide-react";

/**
 * The Insights masthead (DESIGN.md — Components, Masthead): the copper
 * `.dawn-gradient` glow rather than a photograph, an eyebrow carrying the
 * tenant and the range currently in force, and the room's name in the serif.
 *
 * The CSV export rides in the masthead's top-right on desktop and drops below
 * the headline on a phone — a back-office export is the secondary action here,
 * so it stays a ghost pill and never spends the one primary fill.
 *
 * The h1 stays the literal "Insights": the demo journeys assert it by name.
 */
export function InsightsMasthead({
  tenant,
  rangeLabel,
}: {
  tenant?: string;
  rangeLabel: string;
}) {
  const eyebrow = [tenant?.trim(), rangeLabel].filter(Boolean).join(" · ");
  return (
    <div className="dawn-gradient -mx-md -mt-lg mb-xl px-md pb-lg pt-lg md:-mx-lg md:-mt-xl md:mb-3xl md:px-lg md:pb-2xl md:pt-xl">
      <div className="flex flex-col gap-md md:flex-row md:items-start md:justify-between">
        <div className="min-w-0">
          <p className="truncate text-caption font-medium uppercase tracking-[0.18em] text-accent">
            {eyebrow}
          </p>
          <h1 className="mt-xs font-serif text-heading font-normal leading-[1.0] tracking-[-0.02em] text-ink lg:text-display">
            Insights
          </h1>
        </div>
        <a
          href="/api/insights/csv"
          download="insights-export.csv"
          className="inline-flex min-h-11 shrink-0 items-center gap-xs self-start rounded-pill border border-rule-strong bg-transparent px-md text-control font-medium text-ink transition-colors hover:bg-surface-raised focus-ring"
        >
          <Download className="h-4 w-4 shrink-0" strokeWidth={1.75} aria-hidden />
          Export CSV
        </a>
      </div>
    </div>
  );
}
