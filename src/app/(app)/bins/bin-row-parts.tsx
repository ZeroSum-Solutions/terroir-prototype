"use client";

import { Archive, Pencil } from "lucide-react";
import { IconButton } from "@/components/icon-button";
import { WineThumb } from "@/components/wine-thumb";
import type { BinViewModel } from "./bin-view-model";

/**
 * The three pieces a bin row is built from, shared by the phone list
 * (bin-mobile-list.tsx) and the desktop table (bin-manager.tsx) so a bin reads
 * the same either way (DESIGN.md — Components, Index Row / Meter).
 */

/**
 * 2:3 portrait at radius `lg` behind a glass hairline, never square
 * (DESIGN.md — Imagery). WineThumb paints a square at an inline size, so it is
 * centred inside a 2:3 window and cropped by it; the initials stand-in crops
 * the same way.
 */
export function BinThumb({
  src,
  producer,
  name,
  colour,
}: {
  src: string | null | undefined;
  producer: string | null | undefined;
  name: string | null | undefined;
  colour?: string | null;
}) {
  return (
    <span className="relative block h-12 w-8 shrink-0 overflow-hidden rounded-lg border border-glass-edge">
      <WineThumb
        src={src}
        producer={producer}
        name={name}
        colour={colour}
        size={48}
        className="absolute left-1/2 top-0 -translate-x-1/2 rounded-none object-cover"
      />
    </span>
  );
}

/**
 * Occupancy as the system's one meter: a 3px `rule-strong` track with a
 * copper→bone fill, and the figure itself as "26 / 36" in tabular ledger type.
 * A bin with no capacity has nothing to fill, so it shows the count alone.
 */
export function OccupancyMeter({
  bin,
  className,
}: {
  bin: BinViewModel;
  className?: string;
}) {
  const capacity = bin.capacity != null && bin.capacity > 0 ? bin.capacity : null;
  const pct = capacity ? Math.min(100, (bin.bottleCount / capacity) * 100) : 0;
  return (
    <div className={className}>
      <p className="tabular text-ledger text-ink">
        {bin.bottleCount}
        {capacity ? ` / ${capacity}` : ""}
      </p>
      {capacity != null && (
        <div className="mt-3xs h-[3px] w-full max-w-[180px] overflow-hidden rounded-pill bg-rule-strong">
          <div
            className="h-full rounded-pill bg-gradient-to-r from-accent to-primary"
            style={{ width: `${pct}%` }}
          />
        </div>
      )}
    </div>
  );
}

/** Edit and Retire as 44px glass circles — the row's only two controls. */
export function BinActions({
  bin,
  busy,
  onEdit,
  onRetire,
}: {
  bin: BinViewModel;
  busy: boolean;
  onEdit: (bin: BinViewModel) => void;
  onRetire: (bin: BinViewModel) => void;
}) {
  return (
    <div className="flex shrink-0 justify-end gap-2xs">
      <IconButton
        label={`Edit bin ${bin.code}`}
        onClick={() => onEdit(bin)}
        className="glass h-11 w-11 rounded-pill text-ink-soft hover:text-ink focus-ring"
      >
        <Pencil className="h-4 w-4" strokeWidth={1.75} aria-hidden />
      </IconButton>
      <IconButton
        label={`Retire bin ${bin.code}`}
        onClick={() => onRetire(bin)}
        disabled={busy}
        className="glass h-11 w-11 rounded-pill text-ink-soft hover:text-risk-ink disabled:opacity-50 focus-ring"
      >
        <Archive className="h-4 w-4" strokeWidth={1.75} aria-hidden />
      </IconButton>
    </div>
  );
}
