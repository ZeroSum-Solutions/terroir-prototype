"use client";

import { useState } from "react";
import { Grid2x2, Loader2, X, Wine } from "lucide-react";
import { WineThumb } from "@/components/wine-thumb";
import type { GridData } from "./grid-types";
import { useRouter } from "next/navigation";
import { wineTitle } from "@/lib/wine-display-name";

type CellarConfig = {
  id: string;
  rows: number;
  columns: number;
  name: string;
};

const CELL_SIZE = 48;
const GAP = 4;
const LABEL_OFFSET = 28;

export function CellarSetup({ restaurantName: _restaurantName }: { restaurantName: string }) {
  const router = useRouter();
  const [setupRows, setSetupRows] = useState(10);
  const [setupCols, setSetupCols] = useState(10);
  const [creating, setCreating] = useState(false);

  const createCellar = async () => {
    setCreating(true);
    const res = await fetch("/api/cellar/config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rows: setupRows, columns: setupCols }),
    });
    if (res.ok) {
      router.refresh();
    }
    setCreating(false);
  };

  return (
    <div className="mx-auto w-full max-w-[420px] rounded-card card-surface p-lg">
      <div className="mb-lg text-center">
        <Grid2x2
          className="mx-auto mb-md h-10 w-10 text-grey"
          strokeWidth={1.5}
        />
        <h2 className="font-serif text-subheading font-normal text-ink">
          Set up your cellar grid
        </h2>
        <p className="mt-xs text-body-sm text-grey">
          Choose a grid size that matches your storage layout. You can change
          this later.
        </p>
      </div>

      <div className="mb-lg grid grid-cols-2 gap-md">
        <div>
          <label
            htmlFor="cellar-setup-rows"
            className="text-caption block font-medium uppercase text-grey"
          >
            Rows
          </label>
          <input
            id="cellar-setup-rows"
            type="number"
            min={1}
            max={26}
            value={setupRows}
            onChange={(e) =>
              setSetupRows(Math.max(1, Math.min(26, +e.target.value)))
            }
            className="tabular mt-xs w-full rounded-pill border border-edge bg-surface px-md py-sm text-center text-body-lg text-ink"
          />
        </div>
        <div>
          <label
            htmlFor="cellar-setup-cols"
            className="text-caption block font-medium uppercase text-grey"
          >
            Columns
          </label>
          <input
            id="cellar-setup-cols"
            type="number"
            min={1}
            max={30}
            value={setupCols}
            onChange={(e) =>
              setSetupCols(Math.max(1, Math.min(30, +e.target.value)))
            }
            className="tabular mt-xs w-full rounded-pill border border-edge bg-surface px-md py-sm text-center text-body-lg text-ink"
          />
        </div>
      </div>

      {/* Quick presets */}
      <div className="mb-lg flex gap-sm">
        {[
          { label: "5 x 5", r: 5, c: 5 },
          { label: "8 x 10", r: 8, c: 10 },
          { label: "10 x 10", r: 10, c: 10 },
        ].map((preset) => (
          <button
            key={preset.label}
            type="button"
            onClick={() => {
              setSetupRows(preset.r);
              setSetupCols(preset.c);
            }}
            className={`min-h-11 flex-1 rounded-pill border px-sm py-xs text-body-sm font-medium transition-colors ${
              setupRows === preset.r && setupCols === preset.c
                ? "border-accent text-accent"
                : "border-rule-strong text-grey hover:border-accent/40"
            }`}
          >
            {preset.label}
          </button>
        ))}
      </div>

      <button
        type="button"
        onClick={createCellar}
        disabled={creating}
        className="flex h-11 w-full items-center justify-center gap-xs rounded-pill bg-primary text-control font-semibold text-seal-ink hover:bg-primary-hover disabled:opacity-60"
      >
        {creating && (
          <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} />
        )}
        Create cellar
      </button>
    </div>
  );
}

export function CellarGridView({
  config,
  gridData,
  onSelectWine,
}: {
  config: CellarConfig;
  gridData: GridData;
  /** CELLAR-08 — opens the wine detail drawer, same as a list-view row. */
  onSelectWine: (wineId: string) => void;
}) {
  const [selectedBin, setSelectedBin] = useState<string | null>(null);

  const svgWidth = LABEL_OFFSET + config.columns * (CELL_SIZE + GAP);
  const svgHeight = LABEL_OFFSET + config.rows * (CELL_SIZE + GAP);
  const selectedData = selectedBin ? gridData[selectedBin] : null;

  return (
    <>
      <div className="flex flex-col gap-lg md:flex-row">
        {/* SVG Grid */}
        <div className="flex-1 overflow-x-auto rounded-card card-surface p-md">
          <svg
            width={svgWidth}
            height={svgHeight}
            viewBox={`0 0 ${svgWidth} ${svgHeight}`}
            className="block"
          >
            {/* Column labels */}
            {Array.from({ length: config.columns }, (_, c) => (
              <text
                key={`col-${c}`}
                x={LABEL_OFFSET + c * (CELL_SIZE + GAP) + CELL_SIZE / 2}
                y={LABEL_OFFSET - 8}
                textAnchor="middle"
                className="fill-grey text-micro"
              >
                {c + 1}
              </text>
            ))}

            {/* Row labels + cells */}
            {Array.from({ length: config.rows }, (_, r) => (
              <g key={`row-${r}`}>
                <text
                  x={LABEL_OFFSET - 8}
                  y={LABEL_OFFSET + r * (CELL_SIZE + GAP) + CELL_SIZE / 2 + 4}
                  textAnchor="end"
                  className="fill-grey text-micro"
                >
                  {String.fromCharCode(65 + r)}
                </text>
                {Array.from({ length: config.columns }, (_, c) => {
                  const binId = `${String.fromCharCode(65 + r)}${c + 1}`;
                  const data = gridData[binId];
                  const total = data?.totalBottles ?? 0;

                  // Obsidian Glass: a rack cell is a small glass tile, not a
                  // painted swatch. Occupancy is carried by the hairline and
                  // the depth of the fill, in the one metal — an empty cell is
                  // glass on a rule, a filled one takes a copper hairline and
                  // an in-stock one a copper wash behind it. --t-* runtime
                  // vars so both rooms retint the SVG.
                  let fill = "var(--t-glass)"; // empty
                  let stroke = "var(--t-rule-strong)";
                  if (total > 0 && total <= 2) {
                    stroke = "var(--t-accent)"; // low: the hairline alone
                  } else if (total > 2) {
                    fill = "color-mix(in srgb, var(--t-accent) 22%, transparent)";
                    stroke = "var(--t-accent)";
                  }

                  const isSelected = selectedBin === binId;

                  return (
                    <g key={binId}>
                      <rect
                        x={LABEL_OFFSET + c * (CELL_SIZE + GAP)}
                        y={LABEL_OFFSET + r * (CELL_SIZE + GAP)}
                        width={CELL_SIZE}
                        height={CELL_SIZE}
                        rx={10}
                        fill={fill}
                        stroke={isSelected ? "var(--t-ink)" : stroke}
                        strokeWidth={isSelected ? 2 : 1}
                        role="button"
                        tabIndex={0}
                        aria-label={`Bin ${binId}${total > 0 ? `, ${total} bottles` : ", empty"}`}
                        className="cursor-pointer transition-opacity hover:opacity-80"
                        onClick={() =>
                          setSelectedBin(isSelected ? null : binId)
                        }
                        onKeyDown={(e: React.KeyboardEvent) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            setSelectedBin(isSelected ? null : binId);
                          }
                        }}
                      />
                      {/* The tile says which bin it is, which is what someone
                          reading a rack needs first. Both labels are painted
                          OVER the clickable rect as its siblings, so without
                          pointer-events-none an SVG <text> swallows the click
                          and tapping the middle of a bin does nothing. */}
                      <text
                        x={LABEL_OFFSET + c * (CELL_SIZE + GAP) + CELL_SIZE / 2}
                        y={LABEL_OFFSET + r * (CELL_SIZE + GAP) + 20}
                        textAnchor="middle"
                        className="pointer-events-none fill-ink-soft text-micro"
                      >
                        {binId}
                      </text>
                      {total > 0 && (
                        <text
                          x={LABEL_OFFSET + c * (CELL_SIZE + GAP) + CELL_SIZE / 2}
                          y={LABEL_OFFSET + r * (CELL_SIZE + GAP) + 37}
                          textAnchor="middle"
                          className="pointer-events-none fill-ink text-ledger tabular"
                        >
                          {total}
                        </text>
                      )}
                    </g>
                  );
                })}
              </g>
            ))}
          </svg>
        </div>

        {/* Bin detail drawer */}
        {selectedBin && (
          <div className="w-full shrink-0 rounded-card card-surface p-lg md:w-[280px]">
            <div className="mb-md flex items-center justify-between">
              <h3 className="tabular font-serif text-subheading font-normal text-ink">
                Bin {selectedBin}
              </h3>
              <button
                type="button"
                onClick={() => setSelectedBin(null)}
                aria-label="Close bin detail"
                className="flex h-11 w-11 items-center justify-center rounded-pill text-grey hover:bg-wash focus-ring"
              >
                <X className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
              </button>
            </div>

            {selectedData ? (
              <>
                <div className="mb-md text-ledger text-grey">
                  {selectedData.totalBottles} bottle
                  {selectedData.totalBottles !== 1 ? "s" : ""}
                </div>
                <div className="flex flex-col gap-sm">
                  {/* CELLAR-08 — this was a plain div: a bin card named the
                      wine and did nothing else. Someone sent to Bin A5 for one
                      of ten bottles could neither see what it looks like nor
                      click through to find out. It is now a button onto the
                      same detail drawer the list view opens, and it carries the
                      bottle's picture. */}
                  {selectedData.wines.map((w, i) => (
                    <button
                      key={`${w.wineId}-${i}`}
                      type="button"
                      data-bin-wine={w.wineId}
                      onClick={() => onSelectWine(w.wineId)}
                      className="flex w-full items-center gap-sm rounded-lg border border-glass-edge px-sm py-sm text-left transition-colors hover:bg-wash focus-ring"
                    >
                      <span className="relative block h-12 w-8 shrink-0 overflow-hidden rounded-lg border border-glass-edge">
                        <WineThumb
                          src={w.heroImageUrl}
                          producer={w.producer}
                          name={w.name}
                          colour={w.colour}
                          size={48}
                          className="absolute left-1/2 top-0 -translate-x-1/2 rounded-none object-cover"
                        />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block font-serif text-body-lg font-normal leading-snug text-ink">
                          {wineTitle(w.producer, w.name, ", ")}
                        </span>
                        <span className="mt-2xs flex items-center gap-sm text-ledger text-grey">
                          <span className="tabular">
                            {w.vintage ?? "NV"}
                          </span>
                          <span>&middot;</span>
                          <span className="tabular">Qty {w.quantity}</span>
                        </span>
                      </span>
                    </button>
                  ))}
                </div>
              </>
            ) : (
              <div className="flex flex-col items-center py-lg text-center">
                <Wine
                  className="mb-sm h-8 w-8 text-grey"
                  strokeWidth={1.5}
                />
                <p className="text-body-sm text-grey">
                  This bin is empty
                </p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Legend — the same runtime vars the cells are filled with. It used to
          carry three hardcoded Cantina hexes, so after any palette change the
          legend quietly described a map that no longer existed. One of them
          was a brown, which is exactly what check-design-palette now catches
          in source as well as in DESIGN.md. */}
      <div className="mt-lg flex items-center gap-lg text-ledger text-grey">
        <div className="flex items-center gap-xs">
          <span className="inline-block h-3 w-3 rounded-sm border border-accent bg-accent/20" />
          In stock (3+)
        </div>
        <div className="flex items-center gap-xs">
          <span className="inline-block h-3 w-3 rounded-sm border border-accent" />
          Low (1-2)
        </div>
        <div className="flex items-center gap-xs">
          <span className="inline-block h-3 w-3 rounded-sm border border-rule-strong" />
          Empty
        </div>
      </div>
    </>
  );
}
