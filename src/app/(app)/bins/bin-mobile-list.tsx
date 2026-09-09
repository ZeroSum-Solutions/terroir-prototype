"use client";

import Link from "next/link";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import type { BottleInventoryRow } from "@/lib/bins";
import { wineDisplayName } from "@/lib/wine-display-name";
import { BinForm, type BinDraft } from "./bin-form";
import type { BinViewModel } from "./bin-view-model";
import { BinActions, BinThumb, OccupancyMeter } from "./bin-row-parts";

/**
 * Defect 8 (2026-09-08 demo screenshots, 390-bins.png): a six-column table
 * is the wrong form factor at 390px — Zone wrapped "Dessert & Fortified"
 * onto three lines, the "OCCUPANCY" header clipped mid-word, and the bars
 * themselves were cut off by the horizontal scroll container. Below `md:`
 * this renders instead: bins grouped by zone (130 bins across six zones on
 * the seed data makes one unbroken list unreadable), one row per bin with
 * its code, zone, occupancy as a labelled bar plus a plain-language number,
 * and the same Edit/Retire actions the table offers. `BinTable` in
 * bin-manager.tsx keeps the six-column table for `md:` and up, unchanged.
 *
 * Every row renders as an `<li>` — check-control-rows.mjs treats a list
 * item as "repeats with the collection" and does not count what is inside
 * it as a page-level control row, the same way the table's `<tr>` already
 * doesn't.
 */

type SharedProps = {
  inventory: BottleInventoryRow[];
  canManage: boolean;
  busy: boolean;
  editingId: string | null;
  draft: BinDraft;
  onDraftChange: (draft: BinDraft) => void;
  onEdit: (bin: BinViewModel) => void;
  onCancel: () => void;
  onSave: () => void;
  onRetire: (bin: BinViewModel) => void;
  expandedId: string | null;
  onToggle: (id: string) => void;
};

type Props = SharedProps & { bins: BinViewModel[] };

export function MobileBinList(props: Props) {
  const groups = groupByZone(props.bins);
  return (
    <div className="md:hidden">
      {groups.map((group) => (
        <div key={group.zone}>
          <div className="flex items-baseline justify-between gap-sm border-b border-rule-strong px-md pb-2xs pt-lg">
            <span className="text-caption font-medium uppercase text-ink-soft">
              {group.zone}
            </span>
            <span className="tabular text-ledger text-grey">
              {group.bins.length} {group.bins.length === 1 ? "bin" : "bins"}
            </span>
          </div>
          <ul>
            {group.bins.map((bin) => (
              <MobileBinRow key={bin.id} bin={bin} {...props} />
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

function groupByZone(
  bins: readonly BinViewModel[],
): Array<{ zone: string; bins: BinViewModel[] }> {
  const order: string[] = [];
  const byZone = new Map<string, BinViewModel[]>();
  for (const bin of bins) {
    const zone = bin.zone?.trim() || "Unzoned";
    if (!byZone.has(zone)) {
      byZone.set(zone, []);
      order.push(zone);
    }
    byZone.get(zone)!.push(bin);
  }
  return order.map((zone) => ({ zone, bins: byZone.get(zone)! }));
}

function MobileBinRow({
  bin,
  inventory,
  canManage,
  busy,
  editingId,
  draft,
  onDraftChange,
  onEdit,
  onCancel,
  onSave,
  onRetire,
  expandedId,
  onToggle,
}: SharedProps & { bin: BinViewModel }) {
  if (editingId === bin.id) {
    return (
      <li data-bin-row className="border-b border-rule px-md py-md">
        <BinForm
          draft={draft}
          busy={busy}
          submitLabel="Save changes"
          onChange={onDraftChange}
          onCancel={onCancel}
          onSubmit={onSave}
        />
      </li>
    );
  }
  const wines = inventory.filter((item) => item.binId === bin.id);
  const expanded = expandedId === bin.id;
  return (
    <li data-bin-row className="border-b border-rule px-md py-sm">
      <div className="flex justify-between gap-sm">
        <button
          type="button"
          onClick={() => onToggle(bin.id)}
          aria-expanded={expanded}
          disabled={wines.length === 0}
          className="flex min-h-11 min-w-0 flex-1 items-center gap-xs text-left focus-ring disabled:cursor-default"
        >
          <ChevronDown
            className={cn(
              "h-4 w-4 shrink-0 text-grey transition-transform",
              !expanded && "-rotate-90",
              wines.length === 0 && "invisible",
            )}
            strokeWidth={1.75}
            aria-hidden
          />
          <span className="truncate font-serif text-body-lg font-normal text-ink">{bin.code}</span>
          <span className="shrink-0 truncate text-caption font-medium uppercase text-grey">
            {bin.zone ?? "Unzoned"}
          </span>
        </button>
        {canManage && (
          <BinActions bin={bin} busy={busy} onEdit={onEdit} onRetire={onRetire} />
        )}
      </div>
      <div className="mt-xs flex items-baseline justify-between gap-sm">
        <OccupancyMeter bin={bin} className="min-w-0 flex-1" />
        <p className="shrink-0 text-ledger text-grey">{bin.occupancy}</p>
      </div>
      {expanded && wines.length > 0 && (
        <div data-bin-wines={bin.code} className="mt-sm border-t border-rule">
          {wines.map((wine) => (
            <Link
              key={`${wine.wineId}:${wine.binId}`}
              href={`/cellar?wine=${wine.wineId}`}
              data-bin-wine={wine.wineId}
              className="flex min-h-11 items-center gap-sm border-b border-rule px-sm py-xs transition-colors last:border-b-0 hover:bg-wash focus-ring"
            >
              <BinThumb src={wine.heroImageUrl} producer={wine.producer} name={wine.name} colour={wine.colour} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-caption font-medium uppercase text-grey">{wine.producer}</span>
                <span className="block truncate font-serif text-body-lg font-normal text-ink">{wineDisplayName(wine.producer, wine.name)}</span>
              </span>
              <span className="shrink-0 tabular text-body-sm text-grey">
                {wine.quantity} {wine.quantity === 1 ? "bottle" : "bottles"}
              </span>
            </Link>
          ))}
        </div>
      )}
    </li>
  );
}
