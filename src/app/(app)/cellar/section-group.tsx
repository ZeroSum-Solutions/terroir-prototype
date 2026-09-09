import { useDroppable } from "@dnd-kit/core";
import { cn } from "@/lib/utils";
import type { CellarWineRow } from "./types";
import { DraggableWineRow } from "./draggable-wine-row";
import { LineageBlockList } from "./lineage-block-list";

/**
 * BND-063 — SectionGroup. A droppable section with a header and wine list.
 * Each wine row inside is draggable (using the wine_id as the DnD id).
 */
export function SectionGroup({
  sectionKey,
  sectionName,
  wines,
  lowStockThreshold,
  onSelectWine,
  selectMode,
  selectedIds,
  onToggleSelect,
  sortActive,
}: {
  sectionKey: string;
  sectionName: string;
  wines: CellarWineRow[];
  lowStockThreshold?: number;
  onSelectWine: (row: CellarWineRow) => void;
  selectMode: boolean;
  selectedIds: Set<string>;
  onToggleSelect: (wineId: string) => void;
  sortActive?: boolean;
}) {
  // The whole card is the drop target, not just its header: a two-line header
  // is a hard thing to hit while dragging a row on a phone.
  const { setNodeRef, isOver } = useDroppable({
    id: `section-${sectionKey}`,
    data: { type: "section", sectionKey },
  });

  return (
    <div
      ref={setNodeRef}
      data-cellar-section={sectionKey}
      data-drop-over={isOver ? "" : undefined}
      // Concept A — "The Cellar Index" is a continuous index on the paper
      // ground, not white cards floating on it: no card surface, no beige
      // header band. The section label sits directly on canvas, closed off
      // by one hairline, and the rows beneath it divide the same way.
      className={cn("transition-colors", isOver && "bg-surface-raised")}
    >
      <div className="flex items-baseline gap-xs border-b border-rule-strong px-md py-sm">
        <h3 className="text-caption font-medium uppercase text-ink-soft">
          {sectionName}
        </h3>
        <span className="tabular text-caption text-grey">{wines.length}</span>
      </div>

      {/* Wine rows in this section */}
      {wines.length > 0 ? (
        <div className="divide-y divide-rule">
          <LineageBlockList
            wines={wines}
            preserveOrder={sortActive}
            renderRow={(row) => (
              <DraggableWineRow
                sectionKey={sectionKey}
                row={row}
                lowStockThreshold={lowStockThreshold}
                onSelect={() => onSelectWine(row)}
                selectMode={selectMode}
                selected={selectedIds.has(row.wine_id)}
                onToggleSelect={() => onToggleSelect(row.wine_id)}
              />
            )}
          />
        </div>
      ) : (
        <div className="px-md py-lg text-center text-body-sm text-grey">
          No wines in this section.
        </div>
      )}
    </div>
  );
}
