import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { WineThumb } from "@/components/wine-thumb";
import { cn } from "@/lib/utils";
import type { ReconcileQueueKind, ReconcileQueueRow } from "@/lib/reconcile-queue";
import { buildAcceptAction } from "./accept-action";
import type { QueueBin } from "./types";

const KIND_LABELS: Record<ReconcileQueueKind, string> = {
  unplaced: "Unplaced",
  unmatched_scan: "Unmatched scan",
  duplicate_suspect: "Duplicate suspect",
  ambiguous_lineage: "Ambiguous lineage",
};

const KIND_STYLES: Record<ReconcileQueueKind, string> = {
  unplaced: "bg-risk-wash text-risk-ink",
  unmatched_scan: "bg-hold-wash text-hold-ink",
  duplicate_suspect: "bg-risk-wash text-risk-ink",
  ambiguous_lineage: "bg-risk-wash text-risk-ink",
};

type Props = {
  row: ReconcileQueueRow;
  bins: QueueBin[];
  binId?: string;
  checked: boolean;
  disabled: boolean;
  /** Accepting a batch is owner/manager only, so staff get neither the
   *  selection checkbox nor the bin picker — both exist only to build an
   *  accept action the API would refuse. */
  canManage: boolean;
  onBinChange: (binId: string) => void;
  onToggle: () => void;
};

export function QueueIssueRow(props: Props) {
  const { row, bins, binId, checked, disabled, canManage, onBinChange, onToggle } = props;
  const actionable = buildAcceptAction(row, binId) !== null;
  return (
    <article
      data-queue-row
      data-queue-kind={row.kind}
      data-risk={row.atRisk}
      className={cn(
        "grid gap-sm border-t border-rule px-md py-md first:border-t-0 md:items-center",
        canManage
          ? "md:grid-cols-[44px_minmax(0,1fr)_minmax(180px,auto)_110px]"
          : "md:grid-cols-[minmax(0,1fr)_minmax(180px,auto)_110px]",
      )}
    >
      {canManage && (
        <label className="flex h-11 w-11 items-center justify-center">
          <span className="sr-only">Select {row.title}</span>
          <input
            type="checkbox"
            aria-label={`Select ${row.title}`}
            checked={checked}
            disabled={disabled || !actionable}
            onChange={onToggle}
            className="h-4 w-4 rounded-sm border-rule-strong text-accent focus-ring disabled:opacity-35"
          />
        </label>
      )}
      <IssueIdentity row={row} />
      <IssueControl row={row} bins={bins} binId={binId} canManage={canManage} onBinChange={onBinChange} />
      {/* Capital at risk is what this queue is sorted by, so it is the one
          figure the row sets big — Manrope with tabular-nums, never mono
          (DESIGN.md — Typography, Source Code Pro is identifiers only). */}
      <div className="flex items-baseline justify-between gap-md md:block md:text-right">
        <span className="text-caption uppercase text-grey md:hidden">At risk</span>
        <span className="text-right">
          <span className="text-body-lg font-semibold tabular-nums text-ink">
            ${formatRisk(row.atRisk)}
          </span>
          <span className="ml-xs text-ledger tabular-nums text-grey md:ml-0 md:block">
            {row.units} units
          </span>
        </span>
      </div>
    </article>
  );
}

function IssueIdentity({ row }: { row: ReconcileQueueRow }) {
  return (
    <div className="flex min-w-0 gap-sm">
      {/* A queue row carries no photograph — the subject may not be a wine
          record yet — so it takes the same initials stand-in every other
          index row falls back to, cropped to the 2:3 window (DESIGN.md —
          Imagery: thumbnails are portrait, never square). */}
      <span className="relative mt-3xs block h-12 w-8 shrink-0 overflow-hidden rounded-lg border border-glass-edge">
        <WineThumb
          src={null}
          producer={null}
          name={row.title}
          colour={null}
          size={48}
          className="absolute left-1/2 top-0 -translate-x-1/2 rounded-none"
        />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-xs">
          <span className={`rounded-pill px-sm py-2xs text-caption font-medium uppercase tracking-[0.13em] ${KIND_STYLES[row.kind]}`}>
            {KIND_LABELS[row.kind]}
          </span>
          {row.suggestion && <BasisChip row={row} />}
        </div>
        {row.deepLink ? (
          <Link href={row.deepLink} className="group inline-flex min-h-11 items-center gap-xs font-serif text-body-lg font-normal text-ink hover:text-accent">
            {row.title}
            <ArrowUpRight className="h-3.5 w-3.5 text-grey group-hover:text-accent" aria-hidden />
          </Link>
        ) : (
          <p className="py-xs font-serif text-body-lg font-normal text-ink">{row.title}</p>
        )}
        <p className="text-ledger text-grey">{row.detail}</p>
      </div>
    </div>
  );
}

function BasisChip({ row }: { row: ReconcileQueueRow }) {
  const basis = row.suggestion!.basis;
  const label = basis.kind === "lwin" ? "LWIN" : "Field match";
  const detail = basis.kind === "lwin" ? basis.lwin : basis.fields.join(" · ");
  // The basis is an eyebrow, not a status: the label carries the caption
  // weight and the field list rides behind it at micro size, so a four-field
  // match no longer paints a two-line green block across the row.
  return (
    <span data-basis={basis.kind} className="inline-flex min-w-0 max-w-full items-center gap-2xs rounded-pill border border-ready-ink/40 px-sm py-2xs text-ready-ink">
      <span className="shrink-0 text-caption font-medium uppercase tracking-[0.13em]">{label}</span>
      <span className="sr-only">{detail}</span>
      <span aria-hidden className="truncate text-micro opacity-75">{detail}</span>
    </span>
  );
}

function IssueControl({ row, bins, binId, canManage, onBinChange }: Pick<Props, "row" | "bins" | "binId" | "canManage" | "onBinChange">) {
  if (row.kind !== "unplaced" || !canManage) {
    return <p className="text-ledger text-grey">{row.action?.label ?? "Review in cellar"}</p>;
  }
  if (bins.length === 0) return <p className="text-ledger text-risk-ink">Create an active bin first</p>;
  return (
    <label className="block">
      <span className="sr-only">Bin for {row.title}</span>
      <select
        aria-label={`Bin for ${row.title}`}
        value={binId ?? ""}
        onChange={(event) => onBinChange(event.target.value)}
        className="h-11 w-full rounded-pill border border-rule-strong bg-surface-sunken px-md text-control text-ink focus:border-accent focus-ring"
      >
        <option value="">Choose bin</option>
        {bins.map((bin) => <option key={bin.id} value={bin.id}>{bin.zone ? `${bin.zone} · ` : ""}{bin.code}</option>)}
      </select>
    </label>
  );
}

function formatRisk(value: number): string {
  return new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
}
