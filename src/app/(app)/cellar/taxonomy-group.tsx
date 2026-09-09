import type { CellarFacetGroup } from "@/lib/cellar-facets";
import type { CellarWineRow } from "./types";
import { CellarRow } from "./cellar-row";
import { LineageBlockList } from "./lineage-block-list";

export function TaxonomyGroup({
  group,
  lowStockThreshold,
  onSelectWine,
  sortActive,
}: {
  group: CellarFacetGroup<CellarWineRow>;
  lowStockThreshold?: number;
  onSelectWine: (row: CellarWineRow) => void;
  sortActive?: boolean;
}) {
  return (
    <section
      data-cellar-taxonomy-group
      data-group-value={group.key}
      // Concept A — "The Cellar Index": the facet group is a run of the index
      // on the paper ground, headed by a label and one hairline. It used to be
      // a white card with a beige header band, which is what SectionGroup was
      // already moved off; the two render side by side in the same list, so
      // leaving this one behind read as two different products.
    >
      <header className="flex items-center justify-between gap-md border-b border-rule-strong px-md py-sm">
        <h2 className="text-caption font-medium uppercase text-ink-soft">
          {group.label}
        </h2>
        <span data-group-rollup className="tabular shrink-0 text-ledger text-grey">
          {group.wineCount} wine{group.wineCount === 1 ? "" : "s"} · {group.totalBottles}{" "}
          bottle{group.totalBottles === 1 ? "" : "s"}
        </span>
      </header>
      <div className="divide-y divide-rule">
        <LineageBlockList
          wines={group.wines}
          preserveOrder={sortActive}
          renderRow={(row) => (
            <CellarRow
              row={row}
              lowStockThreshold={lowStockThreshold}
              onSelect={() => onSelectWine(row)}
            />
          )}
        />
      </div>
    </section>
  );
}
