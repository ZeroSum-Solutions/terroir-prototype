import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { metricHref, type MetricKey } from "./metric-href";

export type StatTileMetrics = {
  inventoryValue: number;
  totalBottles: number;
  eightysixedCount: number;
  drinkNowCount: number;
};

/**
 * The current-snapshot strip (DESIGN.md — Components, Glass Panel).
 *
 * This was four separate glass tiles with four separate edges, which drew four
 * boxes around one fact. It is now ONE glass panel divided by hairlines: two
 * cells per row on a phone, four across from `md:`. Each cell keeps its own
 * `data-metric` and its own drill-down link, so the behaviour is unchanged —
 * only the number of edges is.
 *
 * Defect 9 (2026-09-08 demo screenshots, 390-insights.png): the inventory
 * value figure ("$656,531") overflowed its tile at 390px. The value is set in
 * the serif at the `heading-sm` role, which is narrower per character than the
 * mono face it replaced, with `truncate` and a `title` as the last-resort
 * guard rather than a silent cut of the actual number.
 */
export function StatTileGrid({ metrics }: { metrics: StatTileMetrics }) {
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

  // Four fixed cells, so the hairlines are written per position rather than
  // derived: a phone divides 2×2, desktop divides 1×4.
  const cellEdges = [
    "",
    "border-l border-rule",
    "border-t border-rule md:border-t-0 md:border-l",
    "border-l border-t border-rule md:border-t-0",
  ];

  return (
    <div className="glass grid grid-cols-2 overflow-hidden rounded-card md:grid-cols-4">
      {items.map((item, i) => (
        <div
          key={item.key}
          data-metric={item.key}
          className={`min-w-0 ${cellEdges[i]}`}
        >
          <Link
            href={metricHref(item.key)}
            className="group block min-w-0 p-md focus-ring"
          >
            <span className="flex items-center gap-xs text-caption font-medium uppercase tracking-[0.18em] text-grey">
              <span className="truncate">{item.label}</span>
              <ArrowUpRight
                className="h-3 w-3 shrink-0 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
                strokeWidth={1.75}
                aria-hidden
              />
            </span>
            <span
              title={item.value}
              className="mt-xs block truncate font-serif text-heading-sm font-normal leading-none tabular text-ink"
            >
              {item.value}
            </span>
          </Link>
        </div>
      ))}
    </div>
  );
}

function formatMoney(value: number): string {
  return "$" + value.toLocaleString("en-US", { maximumFractionDigits: 0 });
}
