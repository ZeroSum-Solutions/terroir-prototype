"use client";

import { cn } from "@/lib/utils";
import { ML_PER_OZ } from "@/lib/units";

type PourItem = {
  id: string;
  glass_pour_ml: number | null;
  pour_size_mode: "fixed" | "picker";
  wines: { name: string };
};

type PourField = "glass_pour_ml" | "pour_size_mode";
type PourValue = number | "fixed" | "picker" | null;

/**
 * BND-038: compact per-wine pour config. An integer ml input with an
 * "≈ X.X oz" hint + a Fixed/Picker radio toggle. The radios disable
 * when ml is blank (pour tracking is off). Renders identically on
 * desktop and mobile — the parent row places it in the right slot.
 */
export function PourConfigRow({
  item,
  onPourChange,
}: {
  item: PourItem;
  onPourChange: (id: string, field: PourField, value: PourValue) => void;
}) {
  const pour = item.glass_pour_ml;
  const ozHint = pour != null ? `≈ ${(pour / ML_PER_OZ).toFixed(1)} oz` : "";
  const tracked = pour != null;
  const nameRadio = `pour-mode-${item.id}`;

  return (
    <div className="flex flex-wrap items-center gap-sm text-ledger text-grey">
      <label className="flex min-h-11 items-center gap-xs">
        <span className="shrink-0">Pour</span>
        <input
          type="number"
          min={1}
          max={2000}
          value={pour ?? ""}
          onChange={(e) => {
            const v = e.target.value.trim();
            if (v === "") {
              onPourChange(item.id, "glass_pour_ml", null);
              return;
            }
            const n = Number(v);
            if (!Number.isFinite(n) || n <= 0) return;
            onPourChange(
              item.id,
              "glass_pour_ml",
              Math.max(1, Math.min(2000, Math.round(n))),
            );
          }}
          placeholder="148"
          aria-label={`Pour size in ml for ${item.wines.name}`}
          className="h-11 w-[64px] rounded-md border border-rule-strong bg-surface-sunken px-xs text-right tabular text-ledger text-ink outline-none focus:border-accent focus-ring"
        />
        <span className="shrink-0 text-micro text-grey">ml</span>
        {ozHint && (
          <span className="shrink-0 text-micro text-grey">{ozHint}</span>
        )}
      </label>
      <fieldset
        className={cn(
          "flex items-center gap-sm",
          !tracked && "pointer-events-none opacity-40",
        )}
      >
        <legend className="sr-only">Pour size mode</legend>
        <label className="flex min-h-11 items-center gap-xs">
          <input
            type="radio"
            name={nameRadio}
            checked={item.pour_size_mode === "fixed"}
            disabled={!tracked}
            onChange={() => onPourChange(item.id, "pour_size_mode", "fixed")}
          />
          Fixed
        </label>
        <label className="flex min-h-11 items-center gap-xs">
          <input
            type="radio"
            name={nameRadio}
            checked={item.pour_size_mode === "picker"}
            disabled={!tracked}
            onChange={() => onPourChange(item.id, "pour_size_mode", "picker")}
          />
          Picker
        </label>
      </fieldset>
    </div>
  );
}
