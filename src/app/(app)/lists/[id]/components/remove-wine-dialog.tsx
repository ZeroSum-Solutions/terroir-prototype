"use client";

import { X } from "lucide-react";
import { wineDisplayName } from "@/lib/wine-display-name";
import type { WineListEditorItem } from "../wine-list-editor.types";

/**
 * BND-194's "remove wine" confirmation, lifted out of wine-list-editor.tsx so
 * that file stays inside its source budget. A glass sheet: bottom-anchored on a
 * phone, centred on a desktop, pill controls (DESIGN.md — Components).
 */
export function RemoveWineDialog({
  item,
  busy,
  onCancel,
  onConfirm,
}: {
  item: WineListEditorItem;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[var(--z-dialog)] flex items-end justify-center bg-scrim p-md sm:items-center">
      <div className="glass w-full rounded-t-card px-lg py-lg pb-[calc(var(--safe-bottom)+var(--spacing-lg))] sm:max-w-[384px] sm:rounded-card sm:pb-lg">
        <div className="flex items-start justify-between">
          <h3 className="font-serif text-subheading font-normal leading-tight text-ink">
            Remove wine
          </h3>
          <button
            type="button"
            onClick={onCancel}
            className="-mr-2xs -mt-2xs flex min-h-11 min-w-11 items-center justify-center rounded-pill text-grey transition-colors hover:text-accent focus-ring"
            aria-label="Close"
          >
            <X className="h-4 w-4" strokeWidth={1.9} />
          </button>
        </div>
        <p className="mt-sm text-body-sm leading-relaxed text-ink-soft">
          Remove{" "}
          <strong className="font-serif font-normal text-ink">
            {item.wines.producer},{" "}
            {wineDisplayName(item.wines.producer, item.wines.name)}
          </strong>
          {item.wines.vintage && <span> ({item.wines.vintage})</span>} from this
          wine list?
        </p>
        <p className="mt-xs text-ledger text-grey">
          The wine will remain in your cellar inventory.
        </p>
        <div className="mt-lg flex flex-col-reverse gap-sm sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={onCancel}
            className="min-h-11 rounded-pill border border-rule-strong bg-transparent px-lg text-control font-medium text-ink transition-colors hover:border-accent hover:text-accent focus-ring"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className="min-h-11 rounded-pill bg-primary px-lg text-control font-semibold text-seal-ink transition-colors hover:bg-primary-hover focus-ring disabled:opacity-60"
          >
            Remove wine
          </button>
        </div>
      </div>
    </div>
  );
}
