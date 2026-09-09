"use client";

import { AlertCircle, Check, Pencil, RotateCcw, Save } from "lucide-react";
import { useCallback, useState } from "react";
import { cn } from "@/lib/utils";
import type { BottleCandidate, BottleField, BottleScanResult } from "@/lib/scanner/types";
import { TextInput, VintageInput, MoneyInput, QtyStepper } from "../components/field-inputs";
import { IdentitySeal, InfoRow, LabelPhotoBand } from "./bottle-identity";
import { needsCorrectionBeforeSave } from "./bottle-confirm-gate";

interface BottleResultsViewProps {
  result: BottleScanResult;
  /** Object URL of the label photo the user just captured (scanner.tsx
   * holds it until save/start-over) — shown beside the identification so
   * the operator can eyeball the match against their own photo. */
  previewUrl?: string | null;
  onSave: (wine: {
    name: string;
    producer: string;
    vintage: number | null;
    varietal: string;
    region: string;
    country: string | null;
    format: string | null;
    qty: number;
    unitCost: number;
  }) => void;
  onScanAnother: () => void;
  isSaving: boolean;
}

/** Below this, the confidence badge and low-confidence banner switch to "needs review" styling. */
const LOW_CONFIDENCE_THRESHOLD = 0.75;

function confidenceBadgeClass(confidence: number) {
  if (confidence >= 0.9) return "bg-ready-wash text-ready-ink";
  if (confidence >= LOW_CONFIDENCE_THRESHOLD) return "bg-hold-wash text-hold-ink";
  return "bg-risk-wash text-risk-ink";
}

export function BottleResultsView({
  result,
  previewUrl,
  onSave,
  onScanAnother,
  isSaving,
}: BottleResultsViewProps) {
  const candidates = result.candidates;
  const [activeIndex, setActiveIndex] = useState(0);
  const [stage, setStage] = useState<"review" | "editing">("review");
  const active: BottleCandidate = candidates[activeIndex] ?? candidates[0];

  // Editable identity fields — populated from the active candidate only
  // when the user chooses "Correct details" (handleCorrect below).
  const [name, setName] = useState(active.name);
  const [producer, setProducer] = useState(active.producer);
  const [vintage, setVintage] = useState<number | null>(active.vintage);
  const [varietal, setVarietal] = useState(active.varietal);
  const [region, setRegion] = useState(active.region);
  const [format, setFormat] = useState(active.format ?? "");
  const [qty, setQty] = useState(1);
  const [unitCost, setUnitCost] = useState(0);

  const lowConfidence = active.confidence < LOW_CONFIDENCE_THRESHOLD;
  // Issue #118: route an unidentifiable result through Correct details.
  const mustCorrect = needsCorrectionBeforeSave(active);
  const isLow = useCallback((field: BottleField) => active.lowFields.includes(field), [active]);
  const showBanner = lowConfidence || mustCorrect;

  const handleCorrect = useCallback(() => {
    setName(active.name);
    setProducer(active.producer);
    setVintage(active.vintage);
    setVarietal(active.varietal);
    setRegion(active.region);
    setFormat(active.format ?? "");
    setStage("editing");
  }, [active]);

  const handleConfirm = useCallback(() => {
    if (!active.name.trim() || !active.producer.trim()) return;
    onSave({
      name: active.name,
      producer: active.producer,
      vintage: active.vintage,
      varietal: active.varietal,
      region: active.region,
      country: active.country,
      format: active.format,
      qty,
      unitCost,
    });
  }, [active, qty, unitCost, onSave]);

  const handleSaveCorrected = useCallback(() => {
    if (!name.trim() || !producer.trim()) return;
    onSave({
      name,
      producer,
      vintage,
      varietal,
      region,
      country: active.country,
      format: format.trim() ? format.trim() : null,
      qty,
      unitCost,
    });
  }, [name, producer, vintage, varietal, region, active.country, format, qty, unitCost, onSave]);

  const canCommit =
    stage === "review"
      ? !!active.name.trim() && !!active.producer.trim() && !mustCorrect
      : !!name.trim() && !!producer.trim();

  return (
    <section>
      <header className="mb-lg md:mb-xl">
        <IdentitySeal confirmable={!mustCorrect} />
        <h1 className="mt-sm font-serif text-heading font-normal leading-[1.0] tracking-[-0.02em] text-ink">
          Wine identified
        </h1>
        <p className="mt-sm max-w-[52ch] text-body text-ink-soft">
          {stage === "review"
            ? "Confirm the AI match is right, or correct the details yourself."
            : "Update the fields, then save to inventory."}
        </p>
      </header>

      {previewUrl && <LabelPhotoBand src={previewUrl} />}

      {/* Whatever comes first after the band sits OVER it, so the photograph
          keeps going behind the glass (DESIGN.md — Do's). */}
      {showBanner && (
        <div
          className={cn(
            "glass relative flex items-start gap-sm rounded-card px-md py-sm",
            previewUrl ? "-mt-2xl" : "mt-md",
          )}
        >
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-accent" strokeWidth={1.9} />
          <div className="text-body-sm text-ink">
            <span className="font-medium">
              {mustCorrect
                ? "Confirm & save is off for this result."
                : `Low AI match confidence (${Math.round(active.confidence * 100)}%).`}
            </span>{" "}
            {mustCorrect
              ? "It doesn't look reliable enough to save as-is — use Correct details to check the fields first."
              : `The label may have been hard to read. Check the flagged fields below${candidates.length > 1 ? ", or try another match." : "."}`}
          </div>
        </div>
      )}

      {/* The sheet sits OVER the photograph, so the band keeps going behind
          it (DESIGN.md — Do's). */}
      <div
        className={cn(
          "glass relative rounded-card p-md md:p-lg",
          previewUrl && !showBanner ? "-mt-2xl" : "mt-md",
        )}
      >
        {/* Confidence badge — the model's self-assessment, never a measured accuracy. */}
        <div className="mb-md flex items-center justify-between border-b border-rule pb-sm">
          <span className="text-caption font-medium uppercase tracking-[0.18em] text-grey">
            AI match confidence
          </span>
          <span className={"text-caption " + cn("rounded-pill px-sm py-2xs font-medium uppercase tracking-[0.14em]", confidenceBadgeClass(active.confidence))}>
            <span className="tabular">{Math.round(active.confidence * 100)}%</span>
          </span>
        </div>

        {stage === "review" && candidates.length > 1 && (
          <div className="mb-md">
            <div className="mb-xs text-caption font-medium uppercase tracking-[0.18em] text-grey">
              Other possible matches
            </div>
            <div className="flex flex-wrap gap-xs">
              {candidates.map((candidate, i) => (
                <button
                  key={i}
                  type="button"
                  aria-pressed={i === activeIndex}
                  onClick={() => setActiveIndex(i)}
                  className={
                    "text-control " +
                    cn(
                      "flex min-h-11 items-center gap-xs rounded-pill border px-sm py-xs font-medium transition-colors focus-ring",
                      i === activeIndex
                        ? "border-primary bg-primary text-seal-ink"
                        : "border-rule-strong bg-transparent text-ink hover:border-accent hover:text-accent",
                    )
                  }
                >
                  <span className="max-w-[160px] truncate">{candidate.name || "Unnamed match"}</span>
                  <span className="tabular opacity-75">
                    {Math.round(candidate.confidence * 100)}%
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        {stage === "review" ? (
          <div className="flex flex-col">
            <InfoRow label="Wine name" value={active.name} low={isLow("name")} emphasis />
            <InfoRow label="Producer" value={active.producer} low={isLow("producer")} />
            <InfoRow
              label="Vintage"
              value={active.vintage === null ? "NV" : String(active.vintage)}
              low={isLow("vintage")}
            />
            <InfoRow label="Varietal" value={active.varietal} />
            <InfoRow label="Region" value={active.region} low={isLow("region")} />
            <InfoRow label="Format" value={active.format ?? ""} low={isLow("format")} />

            {active.notes && (
              <p className="mt-md text-body-sm text-ink-soft">{active.notes}</p>
            )}

            <button
              type="button"
              onClick={handleCorrect}
              /* When the confirm path is off, correcting the details IS the
                 primary action, so it carries the one bone fill. */
              className={
                "text-control " +
                cn(
                  "mt-md flex h-12 items-center justify-center gap-xs self-start rounded-pill px-md font-medium focus-ring",
                  mustCorrect
                    ? "bg-primary font-semibold text-seal-ink transition-colors hover:bg-primary-hover"
                    : "border border-rule-strong bg-transparent text-ink transition-colors hover:border-accent hover:text-accent",
                )
              }
            >
              <Pencil className="h-3.5 w-3.5" strokeWidth={1.9} aria-hidden="true" />
              Something&rsquo;s off — correct details
            </button>
          </div>
        ) : (
          /* eslint-disable jsx-a11y/label-has-associated-control --
             Each <label> below sits beside a TextInput/VintageInput/
             MoneyInput/QtyStepper, not a bare <input>; those components
             already carry a matching aria-label (or, for QtyStepper, two
             self-describing "Increase/Decrease quantity" buttons) on their
             actual form controls, so the accessible name exists even
             though the visible label lacks a `for`/`id` pairing to it. */
          <div className="flex flex-col gap-md">
            <div>
              <label className="mb-xs block text-caption font-medium uppercase tracking-[0.18em] text-grey">
                Wine name
              </label>
              <TextInput
                value={name}
                low={isLow("name")}
                onCommit={setName}
                label="Wine name"
                variant="name"
              />
            </div>

            <div>
              <label className="mb-xs block text-caption font-medium uppercase tracking-[0.18em] text-grey">
                Producer
              </label>
              <TextInput value={producer} low={isLow("producer")} onCommit={setProducer} label="Producer" />
            </div>

            <div className="grid grid-cols-2 gap-sm md:grid-cols-3">
              <div>
                <label className="mb-xs block text-caption font-medium uppercase tracking-[0.18em] text-grey">
                  Vintage
                </label>
                <VintageInput value={vintage} low={isLow("vintage")} onCommit={setVintage} />
              </div>
              <div>
                <label className="mb-xs block text-caption font-medium uppercase tracking-[0.18em] text-grey">
                  Varietal
                </label>
                <TextInput value={varietal} onCommit={setVarietal} label="Varietal" />
              </div>
              <div className="col-span-2 md:col-span-1">
                <label className="mb-xs block text-caption font-medium uppercase tracking-[0.18em] text-grey">
                  Region
                </label>
                <TextInput value={region} low={isLow("region")} onCommit={setRegion} label="Region" />
              </div>
            </div>

            <div>
              <label className="mb-xs block text-caption font-medium uppercase tracking-[0.18em] text-grey">
                Format
              </label>
              <TextInput value={format} low={isLow("format")} onCommit={setFormat} label="Format" />
            </div>

            {active.notes && (
              <p className="text-body-sm text-ink-soft">{active.notes}</p>
            )}
          </div>
        )}

        {/* Separator */}
        <div className="my-lg border-t border-rule-strong" />

        {/* User-provided fields */}
        <div className="text-caption font-medium uppercase tracking-[0.18em] text-grey">
          You provide
        </div>
        <div className="mt-md grid grid-cols-2 gap-md">
          <div>
            <label className="mb-xs block text-caption font-medium uppercase tracking-[0.18em] text-grey">
              Quantity
            </label>
            <QtyStepper value={qty} onChange={setQty} />
          </div>
          <div>
            <label className="mb-xs block text-caption font-medium uppercase tracking-[0.18em] text-grey">
              Unit cost
            </label>
            <MoneyInput value={unitCost} onCommit={setUnitCost} />
          </div>
        </div>
        {/* eslint-enable jsx-a11y/label-has-associated-control */}
      </div>

      {/* The sticky bottom glass rail (DESIGN.md — Layout). */}
      <div
        className="glass sticky bottom-[var(--chrome-tabbar-total)] z-[var(--z-sticky)] mt-md grid grid-cols-2 gap-sm rounded-card p-md md:static md:bottom-auto"
        style={{ marginBottom: "calc(var(--safe-bottom) + var(--spacing-xs))" }}
      >
        <button
          type="button"
          onClick={onScanAnother}
          className="flex h-12 items-center justify-center gap-sm rounded-pill border border-rule-strong bg-transparent text-control font-medium text-ink transition-colors hover:border-accent hover:text-accent focus-ring"
        >
          <RotateCcw className="h-4 w-4" strokeWidth={1.9} aria-hidden="true" />
          Scan another
        </button>
        <button
          type="button"
          onClick={stage === "review" ? handleConfirm : handleSaveCorrected}
          disabled={isSaving || !canCommit}
          className={
            "text-control " +
            cn(
              "flex h-12 items-center justify-center gap-sm rounded-pill font-medium focus-ring disabled:opacity-50",
              canCommit
                ? "bg-primary font-semibold text-seal-ink transition-colors hover:bg-primary-hover"
                : "border border-rule-strong bg-transparent text-ink",
            )
          }
        >
          {isSaving ? (
            <>Saving...</>
          ) : stage === "review" ? (
            <>
              <Check className="h-4 w-4" strokeWidth={1.9} aria-hidden="true" />
              Confirm & save
            </>
          ) : (
            <>
              <Save className="h-4 w-4" strokeWidth={1.9} aria-hidden="true" />
              Save to inventory
            </>
          )}
        </button>
      </div>
    </section>
  );
}
