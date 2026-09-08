"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  formatSignedVarianceOz,
  getReconciliationVariance,
  reconciliationTone,
} from "@/lib/reconciliation/variance";
import { cn } from "@/lib/utils";
import { ML_PER_OZ } from "@/lib/units";
import { wineTitle } from "@/lib/wine-display-name";
import type { OpenBottleRow } from "@/lib/wine-list/shapes";
import { ReconcileNavigationGuard } from "./reconcile-navigation-guard";

type ReconcileItem = OpenBottleRow;

const FRACTIONS: Array<{ label: string; value: number; short?: string }> = [
  { label: "Empty", value: 0 },
  { label: "Quarter", short: "¼", value: 0.25 },
  { label: "Half", short: "½", value: 0.5 },
  { label: "Three Quarter", short: "¾", value: 0.75 },
  { label: "Full", value: 1 },
];

const badgeToneClasses = {
  positive: "bg-ready-wash text-ready-ink",
  negative: "bg-risk-wash text-risk-ink",
  neutral: "bg-wash text-grey",
} as const;

const flaggedCardClasses = {
  positive: "border-ready-ink/30 bg-ready-wash",
  negative: "border-risk-ink/40 bg-risk-wash",
  neutral: "border-rule bg-surface",
} as const;

type PendingChange = { newRemainingMl: number; note?: string };

export function ReconcileList({
  initialItems,
  varianceThresholdOz = 1.0,
  onStateChange,
  inDialog = false,
}: {
  initialItems: ReconcileItem[];
  varianceThresholdOz?: number;
  onStateChange?: (state: { dirty: boolean; busy: boolean }) => void;
  inDialog?: boolean;
}) {
  const router = useRouter();
  const [pending, setPending] = useState<Record<string, PendingChange>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, startTransition] = useTransition();
  const [success, setSuccess] = useState<string | null>(null);
  const inFlight = useRef(false);

  const changedCount = Object.keys(pending).length;
  const busy = saving || refreshing;
  useEffect(() => { onStateChange?.({ dirty: changedCount > 0, busy }); }, [changedCount, busy, onStateChange]);

  const onSaveAll = async () => {
    if (changedCount === 0 || inFlight.current || refreshing) return;
    inFlight.current = true;
    setError(null);
    setSuccess(null);
    setSaving(true);
    const entries = Object.entries(pending).map(([wine_id, p]) => ({
      wine_id,
      new_remaining_ml: p.newRemainingMl,
      note: p.note,
    }));
    try {
      const res = await fetch("/api/reconcile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entries }),
      });
      if (!res.ok) {
        const payload = (await res.json().catch(() => null)) as
          | { error?: string | { message?: string }; code?: string }
          | null;
        const message = typeof payload?.error === "string" ? payload.error : payload?.error?.message;
        throw new Error(message ?? `Could not save (${res.status}). Your counts are still here; try again.`);
      }
      setPending({});
      setSuccess(`${entries.length} bottle${entries.length === 1 ? "" : "s"} reconciled.`);
      startTransition(() => router.refresh());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed.");
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  };

  if (initialItems.length === 0) {
    return (
      <div className="rounded-card card-surface px-md py-lg text-center text-[13px] text-grey">
        No open bottles to reconcile. Open one by pouring a glass.
      </div>
    );
  }

  return (
    <div className="pb-[120px]">
      <ReconcileNavigationGuard dirty={changedCount > 0} busy={busy} interceptLinks={!inDialog} onDiscard={() => setPending({})} />
      {success && <p role="status" className="mb-md text-[14px] text-ready-ink">{success}</p>}
      {error && (
        <div
          role="alert"
          className="mb-md rounded-md border border-risk-ink/30 bg-risk-wash px-md py-sm text-[13px] text-risk-ink"
        >
          {error}
        </div>
      )}

      <fieldset disabled={busy} className="min-w-0">
      <legend className="sr-only">Actual remaining volume for each open bottle</legend>
      <ul className="flex flex-col gap-md">
        {initialItems.map((item) => (
          <ReconcileRow
            key={item.wine_id}
            item={item}
            inDialog={inDialog}
            pending={pending[item.wine_id] ?? null}
            varianceThresholdOz={varianceThresholdOz}
            onChange={(change) =>
              { setSuccess(null); setPending((prev) => ({ ...prev, [item.wine_id]: change })); }
            }
          />
        ))}
      </ul>
      </fieldset>

      <div className={cn("fixed left-0 right-0 z-[var(--z-chrome)] border-t border-rule bg-surface px-lg py-sm md:static md:mt-lg md:border-0 md:px-0 md:py-0", inDialog ? "bottom-0 pb-[calc(var(--safe-bottom)+var(--spacing-sm))]" : "bottom-[calc(var(--chrome-tabbar-total)+var(--spacing-xs))]")}>
        <button
          type="button"
          onClick={onSaveAll}
          disabled={changedCount === 0 || busy}
          className={cn(
            "h-[48px] w-full rounded-pill font-medium transition-colors",
            changedCount > 0 && !busy
              ? "bg-primary text-seal-ink hover:bg-primary-hover"
              : "bg-wash text-grey",
          )}
        >
          {busy
            ? "Saving..."
            : changedCount > 0
              ? `Save ${changedCount} change${changedCount === 1 ? "" : "s"}`
              : "No changes yet"}
        </button>
      </div>
    </div>
  );
}

function ReconcileRow({
  item,
  pending,
  onChange,
  varianceThresholdOz,
  inDialog,
}: {
  item: ReconcileItem;
  inDialog: boolean;
  pending: PendingChange | null;
  onChange: (c: PendingChange) => void;
  varianceThresholdOz: number;
}) {
  const currentMl = pending?.newRemainingMl ?? item.open_remaining_ml;
  const currentOz = currentMl / ML_PER_OZ;
  const trackedOz = item.open_remaining_ml / ML_PER_OZ;
  const glassesLeft = useMemo(
    () => Math.floor(item.open_remaining_ml / item.glass_pour_ml),
    [item.open_remaining_ml, item.glass_pour_ml],
  );

  const expectedMl = item.open_remaining_ml;
  const actualMl = pending?.newRemainingMl ?? expectedMl;
  const variance = getReconciliationVariance(actualMl, expectedMl);
  const varianceOz = variance.deltaMl / ML_PER_OZ;
  const tone = reconciliationTone(variance.relation);
  const isVarianceFlagged = pending !== null && Math.abs(varianceOz) > varianceThresholdOz;

  return (
    <li
      className={`rounded-card p-md ${
        isVarianceFlagged
          ? `border ${flaggedCardClasses[tone]}`
          : "card-surface"
      }`}
    >
      <div className="mb-sm">
        <div className="flex items-start justify-between gap-sm">
          <div className="min-w-0">
            {/* The wine itself opens the wine. Everything else on this card is
                a counting control, so only the name is the link. */}
            {inDialog ? <p className="flex min-h-11 items-center font-serif text-body-lg font-medium leading-snug text-ink">
              {wineTitle(item.producer, item.name)} {item.vintage ?? ""}
            </p> : (
            <Link
              href={`/cellar?wine=${item.wine_id}`}
              className="flex min-h-11 items-center rounded-md font-serif text-[17px] font-medium text-ink leading-snug transition-colors hover:text-accent focus-ring"
            >
              {wineTitle(item.producer, item.name)}
              {item.vintage !== null && (
                <span className="ml-xs font-sans text-[12px] font-light text-grey">
                  {item.vintage}
                </span>
              )}
            </Link>
            )}
            <div className="mt-2xs flex flex-wrap items-center gap-xs text-[12px] text-grey">
              <span className="rounded-pill bg-surface-sunken px-sm py-2xs font-mono">
                {formatBottleSize(item.size_ml)}
              </span>
              {item.opened_at && (
                <span className="tabular-nums">
                  Opened {formatOpenedAt(item.opened_at)}
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="mb-sm rounded-md bg-wash px-sm py-sm">
        <div className="flex flex-wrap items-baseline gap-sm">
          <span className="text-[12px] text-grey">Tracked:</span>
          <span className="font-mono text-[15px] font-semibold text-ink tabular-nums">
            {trackedOz.toFixed(1)} oz
          </span>
          <span className="text-[12px] text-grey tabular-nums">
            ({item.open_remaining_ml} ml ~{glassesLeft} glass
            {glassesLeft === 1 ? "" : "es"})
          </span>
        </div>
      </div>

      <div className="mb-sm">
        <div className="flex flex-wrap items-center gap-sm">
          <label className="flex min-h-11 items-center gap-xs text-[13px] text-grey">
            <span>Actual:</span>
            <input
              type="number"
              inputMode="numeric"
              min={0}
              max={item.size_ml}
              value={currentMl}
              onChange={(e) => {
                const raw = e.target.value;
                if (raw === "") {
                  onChange({
                    newRemainingMl: 0,
                    note: pending?.note,
                  });
                  return;
                }
                const val = Number(raw);
                if (isNaN(val) || val < 0) {
                  return;
                }
                onChange({
                  newRemainingMl: Math.min(item.size_ml, val),
                  note: pending?.note,
                });
              }}
              className="h-11 w-[96px] rounded-pill border border-rule bg-surface px-sm text-body-lg font-mono tabular-nums outline-none focus:border-accent focus-ring"
              aria-label="Actual remaining volume in ml"
            />
          </label>
          <span className="text-[13px] text-grey tabular-nums">
            = {currentOz.toFixed(1)} oz
          </span>
        </div>
        {pending !== null && (
          <div
            className={`mt-xs inline-flex items-center gap-xs rounded-pill px-sm py-2xs text-[10.5px] font-medium uppercase tracking-wide ${badgeToneClasses[tone]}`}
          >
            {formatSignedVarianceOz(variance.deltaMl)} · {variance.label}
          </div>
        )}
      </div>

      <div className="mb-sm grid grid-cols-5 gap-2xs sm:gap-xs">
        {FRACTIONS.map((f) => {
          const ml = Math.round(item.size_ml * f.value);
          const isActive = currentMl === ml;
          return (
            <button
              key={f.label}
              type="button"
              aria-label={f.label}
              aria-pressed={isActive}
              onClick={() =>
                onChange({
                  newRemainingMl: ml,
                  note: pending?.note,
                })
              }
              className={cn(
                "h-[44px] rounded-pill border text-[12px] font-medium transition-colors",
                isActive
                  ? "border-accent bg-primary text-seal-ink"
                  : "border-rule bg-surface text-ink hover:bg-wash",
              )}
            >
              {f.short ?? f.label}
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-sm">
        <label className="flex min-h-11 w-full items-center gap-xs sm:w-auto sm:flex-1">
          <span className="text-[12px] text-grey whitespace-nowrap">
            Note:
          </span>
          <input
            type="text"
            maxLength={500}
            value={pending?.note ?? ""}
            onChange={(e) =>
              onChange({
                newRemainingMl: currentMl,
                note: e.target.value,
              })
            }
            placeholder="spill, miscount, etc."
            className="h-11 min-w-0 flex-1 rounded-pill border border-rule bg-surface px-sm text-body-lg outline-none focus:border-accent focus-ring"
          />
        </label>
      </div>
    </li>
  );
}

function formatBottleSize(sizeMl: number): string {
  if (sizeMl === 750) return "750ml";
  if (sizeMl === 375) return "Half (375ml)";
  if (sizeMl === 1500) return "Magnum (1.5L)";
  if (sizeMl === 3000) return "Double Magnum (3L)";
  if (sizeMl === 6000) return "Imperial (6L)";
  if (sizeMl >= 1000) return `${(sizeMl / 1000).toFixed(1)}L`;
  return `${sizeMl}ml`;
}

function formatOpenedAt(dateStr: string): string {
  const d = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return "today";
  if (diffDays === 1) return "yesterday";
  if (diffDays < 7) return `${diffDays}d ago`;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
