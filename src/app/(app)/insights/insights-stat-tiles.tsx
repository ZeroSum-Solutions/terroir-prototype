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
 * Defect 9 (2026-09-08 demo screenshots, 390-insights.png): the inventory
 * value figure ("$656,531") overflowed its tile at 390px. The prior tile
 * (insights-drilldown.tsx's OwnerMetricGrid, still used elsewhere) fixed the
 * value at a mono-face 26-pixel step that does not shrink, and a typeface
 * DESIGN.md reserves for bin codes, not money (Typography: mono is for the
 * code roles only — prices and counts are Inter with tabular-nums). This
 * grid steps the value down to the `subheading` token below `sm:` and back
 * up to `heading-sm` (close to the original step) from `sm:` on, with
 * `truncate` as a last-resort guard rather than a silent cut of the actual
 * number. Applies to all four tiles, not just inventory value, since bottle
 * counts grow the same way.
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

  return (
    <div className="grid grid-cols-2 gap-sm md:grid-cols-4 md:gap-md">
      {items.map((item) => (
        <div key={item.key} data-metric={item.key} className="min-w-0">
          <Link
            href={metricHref(item.key)}
            className="glass group block min-w-0 rounded-lg p-md transition-transform hover:-translate-y-0.5 focus-ring"
          >
            <span className="flex items-center gap-xs text-caption font-medium uppercase text-grey">
              {item.label}
              <ArrowUpRight
                className="h-3 w-3 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
                strokeWidth={2}
                aria-hidden
              />
            </span>
            <span
              title={item.value}
              className="mt-xs block truncate text-subheading font-medium leading-none tabular text-ink sm:text-heading-sm"
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
