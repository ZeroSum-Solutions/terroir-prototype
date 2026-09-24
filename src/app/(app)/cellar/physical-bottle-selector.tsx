"use client";

import type { PhysicalBottleSummary } from "@/lib/wine-list/shapes";
import { formatPhysicalBottleId } from "@/domains/pours/physical-bottle-command";
import { formatAbsolute, timeAgo } from "@/lib/time";
import { ML_PER_OZ } from "@/lib/units";
import { cn } from "@/lib/utils";

const PRESERVATION_LABELS: Record<PhysicalBottleSummary["preservationMethod"], string> = {
  argon: "Argon",
  coravin: "Coravin",
  none: "No preservation",
  vacuum: "Vacuum",
};

type SelectionResolution = {
  status: "ready" | "choice_required" | "stale" | "invalid";
  selectedBottleId: string | null;
};

export function resolvePhysicalBottleSelection(input: {
  contractVersion: 1 | 2;
  bottles: PhysicalBottleSummary[] | undefined;
  activeBottleCount: number | undefined;
  activeOpenMl: number | undefined;
  requestedBottleId: string | null;
}): SelectionResolution {
  if (input.contractVersion !== 2) {
    return { status: "ready", selectedBottleId: input.requestedBottleId };
  }
  const bottles = input.bottles;
  if (
    !bottles ||
    !Number.isInteger(input.activeBottleCount) ||
    !Number.isInteger(input.activeOpenMl) ||
    input.activeBottleCount !== bottles.length ||
    input.activeOpenMl !== bottles.reduce((sum, bottle) => sum + bottle.remainingMl, 0) ||
    new Set(bottles.map((bottle) => bottle.id)).size !== bottles.length ||
    bottles.some((bottle) => bottle.identityContract !== 2)
  ) {
    return { status: "invalid", selectedBottleId: null };
  }
  if (input.requestedBottleId) {
    return bottles.some((bottle) => bottle.id === input.requestedBottleId)
      ? { status: "ready", selectedBottleId: input.requestedBottleId }
      : { status: "stale", selectedBottleId: null };
  }
  if (bottles.length === 1) {
    return { status: "ready", selectedBottleId: bottles[0].id };
  }
  return {
    status: bottles.length > 1 ? "choice_required" : "ready",
    selectedBottleId: null,
  };
}

export function PhysicalBottleSelector({
  bottles,
  selectedBottleId,
  onSelect,
}: {
  bottles: PhysicalBottleSummary[];
  selectedBottleId: string | null;
  onSelect: (bottleId: string) => void;
}) {
  if (bottles.length === 0) return null;
  return (
    <fieldset className="mt-md">
      <legend className="text-caption font-medium uppercase text-grey">
        Open bottles
      </legend>
      <div className="mt-xs grid gap-xs">
        {bottles.map((bottle) => {
          const selected = bottle.id === selectedBottleId;
          const remainingOz = (bottle.remainingMl / ML_PER_OZ).toFixed(1);
          const inputId = `physical-open-bottle-${bottle.id}`;
          const displayId = formatPhysicalBottleId(bottle.id);
          const openedAge = timeAgo(bottle.openedAt);
          const preservation = PRESERVATION_LABELS[bottle.preservationMethod];
          const capacity = bottle.nominalCapacityMl === null
            ? "Captured capacity unavailable"
            : `${bottle.remainingMl} of ${bottle.nominalCapacityMl} ml`;
          const location = bottle.sourceBinLocation
            ? `, Bin ${bottle.sourceBinLocation}`
            : "";
          return (
            <label
              key={bottle.id}
              htmlFor={inputId}
              className={cn(
                "flex min-h-11 cursor-pointer items-center gap-sm rounded-card border px-sm py-xs text-body-sm focus-within:ring-2 focus-within:ring-accent",
                selected ? "border-accent bg-accent/10" : "border-edge bg-surface hover:bg-wash",
              )}
            >
              <input
                id={inputId}
                aria-label={`Bottle ID ${displayId}, ${remainingOz} ounces remaining, ${capacity}${location}, Opened ${openedAge}, ${preservation}`}
                type="radio"
                name="physical-open-bottle"
                checked={selected}
                onChange={() => onSelect(bottle.id)}
                className="h-4 w-4 accent-[var(--color-accent)]"
              />
              <span className="min-w-0 flex-1">
                <span className="block font-medium text-ink">
                  Bottle ID {displayId} · {remainingOz} oz remaining
                </span>
                <span className="block text-ledger text-grey">
                  {capacity}
                  {bottle.sourceBinLocation ? ` · Bin ${bottle.sourceBinLocation}` : ""}
                </span>
                <span className="block text-ledger text-grey" title={formatAbsolute(bottle.openedAt)}>
                  Opened {openedAge} · {preservation}
                </span>
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
