"use client";

import * as Sentry from "@sentry/nextjs";
import {
  ChevronDown,
  Download,
  FileJson,
  FileText,
  Loader2,
  Save,
  ScanLine,
  Sparkles,
  Trash2,
} from "lucide-react";
import Image from "next/image";
import { useEffect, useMemo, useState } from "react";
import { ActionDialog } from "@/components/action-dialog";
import { Field } from "@/components/field";
import { IconButton } from "@/components/icon-button";
import { SCORED_FIELDS_COUNT } from "@/lib/scanner/scored-fields";
import { cn } from "@/lib/utils";
import type { LineItem, LineItemField, Scan } from "@/lib/scanner/types";
import {
  formatMoney,
  MoneyInput,
  QtyStepper,
  TextInput,
  Th,
  VintageInput,
} from "../components/field-inputs";
import { LineItemCard } from "../components/line-item-card";

interface SummaryRowProps {
  items: number;
  bottles: number;
  total: number;
  lowCount: number;
}

function SummaryRow({ items, bottles, total, lowCount }: SummaryRowProps) {
  const stats: Array<{
    label: string;
    value: string;
    tone?: "warning" | "success";
  }> = [
    { label: "Line items", value: String(items) },
    { label: "Bottles", value: String(bottles) },
    { label: "Invoice total", value: `$${formatMoney(total)}` },
    {
      label: "Need review",
      value: `${lowCount} field${lowCount === 1 ? "" : "s"}`,
      tone: lowCount > 0 ? "warning" : "success",
    },
  ];
  // One glass strip rather than four stat cards (DESIGN.md — Surfaces).
  return (
    <div className="glass grid grid-cols-2 gap-md rounded-card p-md md:grid-cols-4 md:p-lg">
      {stats.map((s) => (
        <div key={s.label}>
          <div className="text-caption font-medium uppercase tracking-[0.18em] text-grey">
            {s.label}
          </div>
          <div className="mt-2xs text-subheading">
            <span
              className={cn(
                "tabular",
                s.tone === "warning" && "text-accent",
                s.tone === "success" && "text-ready-ink",
                !s.tone && "text-ink",
              )}
            >
              {s.value}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}

interface ResultsViewProps {
  scan: Scan;
  onUpdate: (id: string, field: LineItemField, value: string | number | null) => void;
  onUpdateSource: (field: "distributor" | "invoiceNo" | "invoiceDate", value: string) => void;
  onRemove: (id: string) => void;
  onScanAnother: () => void;
  onExportCsv: () => void;
  onExportAccuracy: () => void;
  onSaveToInventory: () => void;
  isSaving: boolean;
}

export function ResultsView({
  scan,
  onUpdate,
  onUpdateSource,
  onRemove,
  onScanAnother,
  onExportCsv,
  onExportAccuracy,
  onSaveToInventory,
  isSaving,
}: ResultsViewProps) {
  const { items, edits, source, rawText } = scan;
  const [rawTextOpen, setRawTextOpen] = useState(false);
  const [discardOpen, setDiscardOpen] = useState(false);
  const [discardBusy, setDiscardBusy] = useState(false);

  // POST /api/scan responds with `{ scanId, ...Scan }` — scanId isn't part
  // of the `Scan` type (it doesn't exist until the scan is persisted), but
  // it round-trips on the object through setScan/saveScan/localStorage, so
  // it's safe to read here at runtime. Degrade gracefully when absent (e.g.
  // manual entry, which never has a scan id).
  const scanId = (scan as unknown as { scanId?: string }).scanId;
  const [capturedImageUrl, setCapturedImageUrl] = useState<string | null>(null);

  useEffect(() => {
    // No scan id (e.g. manual entry) — nothing to fetch; the render guard
    // below ignores any stale URL rather than resetting state here.
    if (!scanId) return;
    let cancelled = false;
    fetch(`/api/scans/${scanId}/image`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { url?: string } | null) => {
        if (!cancelled && data?.url) setCapturedImageUrl(data.url);
      })
      .catch((err) => {
        console.error("Failed to load captured invoice photo:", err);
        Sentry.captureException(err, {
          tags: { surface: "scanner", phase: "results-image-load" },
          extra: { scan_id: scanId },
        });
      });
    return () => {
      cancelled = true;
    };
  }, [scanId]);

  const confirmDiscard = () => {
    setDiscardBusy(true);
    try {
      onScanAnother();
      setDiscardOpen(false);
    } finally {
      setDiscardBusy(false);
    }
  };

  const { total, bottles, lowCount, accuracy } = useMemo(() => {
    const totalFields = items.length * SCORED_FIELDS_COUNT;
    const edited = Object.keys(edits).length;
    return {
      total: items.reduce((s, it) => s + it.qty * it.unitCost, 0),
      bottles: items.reduce((s, it) => s + it.qty, 0),
      lowCount: items.reduce(
        (n, it) => n + (it.lowFields?.length ?? 0),
        0,
      ),
      accuracy:
        totalFields === 0
          ? 100
          : Math.max(
              0,
              Math.round(((totalFields - edited) / totalFields) * 100),
            ),
    };
  }, [items, edits]);

  const isLow = (item: LineItem, field: LineItemField) =>
    (item.lowFields ?? []).includes(field) && !edits[`${item.id}:${field}`];

  const isEdited = (item: LineItem, field: LineItemField) =>
    edits[`${item.id}:${field}`] === true;

  return (
    <section className={rawText ? "md:flex md:gap-lg" : ""}>
      {/* Mobile: raw text accordion */}
      {rawText && (
        <div className="mb-md md:hidden">
          <button
            type="button"
            onClick={() => setRawTextOpen(!rawTextOpen)}
            className="flex min-h-11 w-full items-center justify-between rounded-card card-surface p-md text-body-sm font-medium text-ink focus-ring"
          >
            <span className="flex items-center gap-sm">
              <FileText className="h-4 w-4 text-grey" strokeWidth={1.75} />
              Raw invoice text
            </span>
            <ChevronDown
              className={cn("h-4 w-4 text-grey transition-transform", rawTextOpen && "rotate-180")}
              strokeWidth={2}
            />
          </button>
          {rawTextOpen && (
            <div className="mt-xs rounded-card border border-rule bg-surface-sunken p-md">
              <pre className="max-h-[300px] overflow-auto whitespace-pre-wrap text-ledger leading-relaxed text-grey">
                {rawText}
              </pre>
            </div>
          )}
        </div>
      )}

      <div className={rawText ? "md:min-w-0 md:flex-1" : ""}>
      <header className="mb-lg flex flex-col gap-sm md:mb-xl md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-caption font-medium uppercase tracking-[0.18em] text-accent">
            Scan · Invoice · Review
          </p>
          <h1 className="mt-xs font-serif text-heading font-normal leading-[1.0] tracking-[-0.02em] text-ink">
            Invoice scan results
          </h1>
          <p className="mt-sm max-w-[52ch] text-body text-ink-soft">
            Review, correct, and export. Flagged fields need a second look.
          </p>
        </div>
        <div className="flex items-center gap-sm self-start md:self-auto">
          <span className="inline-flex items-center gap-xs rounded-pill bg-ready-wash px-sm py-2xs text-caption font-medium uppercase tracking-[0.14em] text-ready-ink">
            <Sparkles className="h-3.5 w-3.5" strokeWidth={1.9} aria-hidden="true" />
            <span>Parsed accuracy</span>
            <span className="tabular">{accuracy}%</span>
          </span>
          <button
            type="button"
            onClick={() => setDiscardOpen(true)}
            className="flex min-h-11 items-center gap-xs rounded-pill border border-rule-strong px-md text-caption font-medium uppercase tracking-[0.18em] text-grey transition-colors hover:border-accent hover:text-accent focus-ring"
          >
            <Trash2 className="h-3.5 w-3.5" strokeWidth={1.9} aria-hidden="true" />
            Clear
          </button>
        </div>
      </header>

      {scanId != null && capturedImageUrl && (
        <div className="mb-lg rounded-card bg-surface-sunken p-md">
          <div className="mb-sm text-caption font-medium uppercase tracking-[0.18em] text-grey">
            Captured photo
          </div>
          <a
            href={capturedImageUrl}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Open full-resolution invoice photo in a new tab"
            className="block rounded-lg focus-ring"
          >
            <Image
              src={capturedImageUrl}
              alt="Captured invoice photo"
              width={0}
              height={0}
              unoptimized
              className="max-h-[220px] w-full cursor-zoom-in rounded-lg object-contain"
              style={{ width: "100%", height: "auto", touchAction: "pinch-zoom" }}
            />
          </a>
        </div>
      )}

      <div className="glass mb-lg rounded-card p-md md:p-lg">
        <div className="flex flex-col gap-sm">
          <Field id="scan-supplier" label="Supplier">
            {(a11y) => (
              <div className="relative mt-xs flex min-h-12 w-full items-center rounded-pill border border-rule-strong bg-surface-sunken px-md transition-colors focus-within:border-accent focus-ring">
                <input
                  {...a11y}
                  value={source.distributor}
                  onChange={(e) => onUpdateSource("distributor", e.target.value)}
                  className="min-h-11 w-full bg-transparent text-control font-medium text-ink outline-none"
                />
              </div>
            )}
          </Field>
          <div className="flex items-center gap-sm">
            <Field id="scan-invoice-number" label="Invoice number" className="flex-1">
              {(a11y) => (
                <div className="relative mt-xs flex min-h-12 w-full items-center rounded-pill border border-rule-strong bg-surface-sunken px-md transition-colors focus-within:border-accent focus-ring">
                  <input
                    {...a11y}
                    value={source.invoiceNo}
                    onChange={(e) => onUpdateSource("invoiceNo", e.target.value)}
                    className="min-h-11 w-full bg-transparent text-control text-ink outline-none"
                  />
                </div>
              )}
            </Field>
            <Field id="scan-delivery-date" label="Delivery date" className="flex-1">
              {(a11y) => (
                <div className="relative mt-xs flex min-h-12 w-full items-center rounded-pill border border-rule-strong bg-surface-sunken px-md transition-colors focus-within:border-accent focus-ring">
                  <input
                    {...a11y}
                    type="date"
                    value={source.invoiceDate}
                    onChange={(e) => onUpdateSource("invoiceDate", e.target.value)}
                    className="min-h-11 w-full bg-transparent text-control text-ink outline-none"
                  />
                </div>
              )}
            </Field>
          </div>
        </div>
        <div className="mt-md flex items-center justify-between">
          <span className="text-caption font-medium uppercase tracking-[0.18em] text-grey">
            <span className="tabular">{items.length}</span> items
          </span>
        </div>
      </div>

      <SummaryRow
        items={items.length}
        bottles={bottles}
        total={total}
        lowCount={lowCount}
      />

      {/* Desktop table (md+) */}
      <div className="glass mt-lg hidden overflow-hidden rounded-card md:block">
        <table className="w-full border-collapse text-control">
          <thead>
            <tr className="border-b border-rule-strong">
              <Th className="w-[32%]">Wine</Th>
              <Th className="w-[14%]">Varietal</Th>
              <Th className="w-[9%]">Vintage</Th>
              <Th className="w-[14%]">Region</Th>
              <Th className="w-[11%] text-center">Qty</Th>
              <Th className="w-[14%] text-right">Unit cost</Th>
              <Th className="w-[6%]" />
            </tr>
          </thead>
          <tbody>
            {items.map((it) => (
              <tr
                key={it.id}
                className="border-t border-rule align-middle transition-colors hover:bg-surface-raised"
              >
                <td className="p-sm">
                  <TextInput
                    id={`line-${it.id}-desktop-name`}
                    label="Wine name"
                    srOnlyLabel
                    value={it.name}
                    low={isLow(it, "name")}
                    edited={isEdited(it, "name")}
                    onCommit={(v) => onUpdate(it.id, "name", v)}
                    variant="name"
                  />
                  <div className="mt-2xs">
                    <TextInput
                      id={`line-${it.id}-desktop-producer`}
                      label="Producer"
                      srOnlyLabel
                      value={it.producer}
                      low={isLow(it, "producer")}
                      edited={isEdited(it, "producer")}
                      onCommit={(v) => onUpdate(it.id, "producer", v)}
                      variant="secondary"
                    />
                  </div>
                </td>
                <td className="p-sm">
                  <TextInput
                    id={`line-${it.id}-desktop-varietal`}
                    label="Varietal"
                    srOnlyLabel
                    value={it.varietal}
                    low={isLow(it, "varietal")}
                    edited={isEdited(it, "varietal")}
                    onCommit={(v) => onUpdate(it.id, "varietal", v)}
                  />
                </td>
                <td className="p-sm">
                  <VintageInput
                    id={`line-${it.id}-desktop-vintage`}
                    label="Vintage"
                    srOnlyLabel
                    value={it.vintage}
                    low={isLow(it, "vintage")}
                    edited={isEdited(it, "vintage")}
                    onCommit={(v) => onUpdate(it.id, "vintage", v)}
                  />
                </td>
                <td className="p-sm">
                  <TextInput
                    id={`line-${it.id}-desktop-region`}
                    label="Region"
                    srOnlyLabel
                    value={it.region}
                    low={isLow(it, "region")}
                    edited={isEdited(it, "region")}
                    onCommit={(v) => onUpdate(it.id, "region", v)}
                  />
                </td>
                <td className="p-sm">
                  <div className="flex justify-center">
                    <QtyStepper
                      value={it.qty}
                      onChange={(v) => onUpdate(it.id, "qty", v)}
                    />
                  </div>
                </td>
                <td className="p-sm">
                  <MoneyInput
                    id={`line-${it.id}-desktop-unit-cost`}
                    label="Unit cost"
                    srOnlyLabel
                    value={it.unitCost}
                    low={isLow(it, "unitCost")}
                    edited={isEdited(it, "unitCost")}
                    onCommit={(v) => onUpdate(it.id, "unitCost", v)}
                  />
                </td>
                <td className="p-sm text-center">
                  <IconButton
                    label={`Remove ${it.name}`}
                    onClick={() => onRemove(it.id)}
                    className="text-grey transition-colors hover:text-accent focus-ring"
                  >
                    <Trash2 className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" />
                  </IconButton>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile: hairline index rows inside one sheet (< md) */}
      <div className="glass mt-md overflow-hidden rounded-card md:hidden">
        {items.map((it) => (
          <LineItemCard
            key={it.id}
            item={it}
            isLow={isLow}
            isEdited={isEdited}
            onUpdate={onUpdate}
            onRemove={onRemove}
          />
        ))}
      </div>

      {/* Action bar */}
      {/* The sticky bottom glass rail: one primary, ghosts beside it. */}
      <div
        className="glass sticky bottom-[var(--chrome-tabbar-total)] z-[var(--z-sticky)] mt-md flex flex-col gap-sm rounded-card p-md md:static md:bottom-auto md:mt-lg md:flex-row md:items-center md:justify-between"
        style={{ marginBottom: "calc(var(--safe-bottom) + var(--spacing-xs))" }}
      >
        <div className="tabular text-caption font-medium uppercase tracking-[0.18em] text-grey">
          <span className="text-ink">{items.length} wines</span>
          <span className="mx-xs">·</span>
          <span>{Object.keys(edits).length} corrections</span>
        </div>
        <div className="grid grid-cols-2 gap-sm md:flex md:gap-md">
          <button
            type="button"
            onClick={() => setDiscardOpen(true)}
            className="flex min-h-11 items-center justify-center gap-sm rounded-pill border border-rule-strong bg-transparent text-control font-medium text-ink transition-colors hover:border-accent hover:text-accent focus-ring md:px-md"
          >
            <ScanLine className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
            <span className="hidden sm:inline">Scan another</span>
            <span className="sm:hidden">Scan</span>
          </button>
          <div className="flex gap-sm">
            <button
              type="button"
              onClick={onExportCsv}
              className="flex min-h-11 flex-1 items-center justify-center gap-sm rounded-pill border border-rule-strong bg-transparent text-control font-medium text-ink transition-colors hover:border-accent hover:text-accent focus-ring md:flex-none md:px-md"
              title="Export as CSV"
            >
              <Download className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
              <span className="hidden md:inline">CSV</span>
            </button>
            <button
              type="button"
              onClick={onExportAccuracy}
              className="flex min-h-11 flex-1 items-center justify-center gap-sm rounded-pill border border-rule-strong bg-transparent text-control font-medium text-ink transition-colors hover:border-accent hover:text-accent focus-ring md:flex-none md:px-md"
              title="Export accuracy JSON (source + items + per-field edits)"
            >
              <FileJson className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
              <span className="hidden md:inline">JSON</span>
            </button>
          </div>
          <button
            type="button"
            onClick={onSaveToInventory}
            disabled={isSaving}
            className="col-span-2 flex min-h-12 items-center justify-center gap-sm rounded-pill bg-primary text-control font-semibold text-seal-ink transition-colors hover:bg-primary-hover focus-ring disabled:opacity-60 md:px-md"
          >
            {isSaving ? (
              <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} aria-hidden="true" />
            ) : (
              <Save className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
            )}
            <span>{isSaving ? "Saving..." : "Save to Inventory"}</span>
          </button>
        </div>
      </div>
      </div>

      {/* Desktop: raw text sidebar */}
      {rawText && (
        <aside className="hidden shrink-0 md:block md:w-[320px]">
          <div className="glass sticky top-[72px] rounded-card">
            <div className="flex items-center gap-sm border-b border-rule p-md">
              <FileText className="h-4 w-4 text-grey" strokeWidth={1.75} />
              <span className="text-caption font-medium uppercase tracking-[0.18em] text-grey">
                Raw invoice text
              </span>
            </div>
            <div className="p-md">
              <pre className="max-h-[calc(100vh-200px)] overflow-auto whitespace-pre-wrap text-ledger leading-relaxed text-grey">
                {rawText}
              </pre>
            </div>
          </div>
        </aside>
      )}

      <ActionDialog
        open={discardOpen}
        title="Discard scan"
        description="The current scan and all edits will be lost."
        confirmLabel="Discard scan"
        busy={discardBusy}
        onClose={() => setDiscardOpen(false)}
        onConfirm={confirmDiscard}
      />
    </section>
  );
}
