import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { metricHref, type MetricKey } from "./metric-href";

export type OwnerMetrics = {
  inventoryValue: number;
  totalBottles: number;
  eightysixedCount: number;
  drinkNowCount: number;
};

export type TodayException = {
  wineId: string;
  kind: "drink-window" | "past-window" | "pricing";
  title: string;
  detail: string;
};

export function selectTodayExceptions(
  candidates: TodayException[],
): TodayException[] {
  const selected: TodayException[] = [];
  const seen = new Set<string>();
  for (const candidate of candidates) {
    if (seen.has(candidate.wineId)) continue;
    selected.push(candidate);
    seen.add(candidate.wineId);
    if (selected.length === 3) break;
  }
  return selected;
}

export function TodayStrip({ exceptions }: { exceptions: TodayException[] }) {
  if (exceptions.length === 0) return null;

  return (
    <section className="mb-xl md:mb-3xl" aria-labelledby="today-heading">
      <div className="mb-sm flex flex-wrap items-baseline justify-between gap-sm">
        <h2
          id="today-heading"
          className="text-caption font-medium uppercase tracking-[0.18em] text-grey"
        >
          Today
        </h2>
        <span className="text-ledger text-grey">Most actionable</span>
      </div>
      {/* Hairline index rows (DESIGN.md — Components, Index Row): the wine in
          the serif, the reason in the ledger voice, rows separated by `rule`
          with no gap between them — three bordered cards drew three boxes
          around one queue. */}
      <ul className="border-t border-rule">
        {exceptions.map((exception) => (
          <li
            key={`${exception.kind}:${exception.wineId}`}
            data-metric={`today-${exception.kind}-${exception.wineId}`}
            className="min-w-0 border-b border-rule"
          >
            <Link
              href={metricHref("wine", exception.wineId)}
              className="group flex min-h-11 min-w-0 items-center gap-md py-sm transition-colors focus-ring"
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate font-serif text-body-lg font-normal text-ink transition-colors group-hover:text-accent">
                  {exception.title}
                </span>
                <span className="mt-2xs block truncate text-ledger text-grey">
                  {exception.detail}
                </span>
              </span>
              <span
                className={
                  "shrink-0 rounded-pill px-xs py-2xs font-medium uppercase " +
                  exceptionBadgeClass(exception.kind)
                }
              >
                <span className="text-caption">
                  {exceptionLabel(exception.kind)}
                </span>
              </span>
              <ArrowUpRight
                className="h-4 w-4 shrink-0 text-grey transition-colors group-hover:text-accent"
                strokeWidth={1.75}
                aria-hidden
              />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function OwnerMetricGrid({ metrics }: { metrics: OwnerMetrics }) {
  const items: Array<{
    key: Exclude<MetricKey, "varietal" | "wine">;
    label: string;
    value: string;
  }> = [
    {
      key: "inventory-value",
      label: "Inventory value",
      value: formatMoney(metrics.inventoryValue),
    },
    {
      key: "bottles-in",
      // "Bottles in" uppercased to "BOTTLES IN" and read as a truncated
      // label (Kimi audit 2026-08-26).
      label: "Bottles on hand",
      value: metrics.totalBottles.toLocaleString("en-US"),
    },
    {
      key: "eightysixed-count",
      label: "86'd",
      value: metrics.eightysixedCount.toLocaleString("en-US"),
    },
    {
      key: "drink-now-count",
      label: "Drink now",
      value: metrics.drinkNowCount.toLocaleString("en-US"),
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-sm md:grid-cols-4 md:gap-md">
      {items.map((item) => (
        <div key={item.key} data-metric={item.key}>
          <Link
            href={metricHref(item.key)}
            // `.glass` sets box-shadow as unlayered CSS (see globals.css) so
            // it always wins over Tailwind's layered ring-* utilities on the
            // same element — never combine it with one of those. Focus goes
            // through `outline`, which glass never touches.
            className="glass group block rounded-lg p-md transition-transform hover:-translate-y-0.5 focus-ring"
          >
            <span className="flex items-center gap-xs text-caption font-medium uppercase text-grey">
              {item.label}
              <ArrowUpRight
                className="h-3 w-3 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
                strokeWidth={2}
                aria-hidden
              />
            </span>
            {/* Courier is the ledger voice — metric values speak mono;
                Bodoni is display-only (DESIGN.md type roles; Kimi audit). */}
            <span className="mt-xs block font-mono text-[26px] font-medium leading-none tabular text-ink">
              {item.value}
            </span>
          </Link>
        </div>
      ))}
    </div>
  );
}

function exceptionLabel(kind: TodayException["kind"]): string {
  switch (kind) {
    case "drink-window":
      return "Window closing";
    case "past-window":
      return "Past window";
    case "pricing":
      return "Pricing review";
  }
}

// One urgency scale (DESIGN.md — Status), and the same two weights
// StatusChip uses: a closing window is outlined claret, a past window is the
// filled seal, a pricing review is a routine ledger stamp.
function exceptionBadgeClass(kind: TodayException["kind"]): string {
  switch (kind) {
    case "drink-window":
      return "bg-risk-wash text-risk-ink";
    case "past-window":
      return "bg-primary text-seal-ink";
    case "pricing":
      return "bg-peak-wash text-peak-ink";
  }
}

function formatMoney(value: number): string {
  return "$" + value.toLocaleString("en-US", { maximumFractionDigits: 0 });
}
