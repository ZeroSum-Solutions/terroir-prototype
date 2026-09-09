"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, ChevronDown, Plus, Search, X } from "lucide-react";
import { IconButton } from "@/components/icon-button";
import { cn } from "@/lib/utils";
import {
  findBottleMatches,
  type BottleInventoryRow,
} from "@/lib/bins";
import { BinForm, type BinDraft } from "./bin-form";
import type { BinViewModel } from "./bin-view-model";
import { MobileBinList } from "./bin-mobile-list";
import { BinActions, BinThumb, OccupancyMeter } from "./bin-row-parts";
import { useBinEditor, useBinRequests } from "./use-bin-manager";
import { wineDisplayName } from "@/lib/wine-display-name";

type Props = {
  bins: BinViewModel[];
  inventory: BottleInventoryRow[];
  canManage: boolean;
  unplacedCount: number;
};

export function BinManager({ bins, inventory, canManage, unplacedCount }: Props) {
  const [query, setQuery] = useState("");
  const editor = useBinEditor();
  const requests = useBinRequests(editor);
  const matches = useMemo(
    () => findBottleMatches(query, inventory),
    [query, inventory],
  );
  return (
    <>
      <ManagerToolbar query={query} onQueryChange={setQuery} canManage={canManage} onCreate={editor.openCreate} />
      {query.trim() && <SearchResults matches={matches} />}
      <UnplacedInventoryLink count={unplacedCount} />
      {requests.error && <ErrorBanner message={requests.error} dismiss={requests.dismissError} />}
      {editor.creating && (
        <FormPanel title="Create bin">
          <BinForm draft={editor.draft} busy={requests.busy} submitLabel="Create bin" onChange={editor.setDraft} onCancel={editor.close} onSubmit={requests.save} />
        </FormPanel>
      )}
      <BinTable bins={bins} inventory={inventory} canManage={canManage} busy={requests.busy} editingId={editor.editingId} draft={editor.draft} onDraftChange={editor.setDraft} onEdit={editor.openEdit} onCancel={editor.close} onSave={requests.save} onRetire={requests.retire} />
    </>
  );
}

function ManagerToolbar({ query, onQueryChange, canManage, onCreate }: { query: string; onQueryChange: (value: string) => void; canManage: boolean; onCreate: () => void }) {
  return <div className="mb-lg grid gap-sm md:grid-cols-[minmax(0,1fr)_auto]"><SearchBox query={query} onChange={onQueryChange} />{canManage && <button type="button" onClick={onCreate} className="flex h-11 items-center justify-center gap-xs rounded-pill bg-primary px-md text-control font-semibold text-seal-ink hover:bg-primary-hover focus-ring"><Plus className="h-4 w-4" strokeWidth={1.9} aria-hidden />Create bin</button>}</div>;
}

/**
 * Unplaced stock has no bin, so there is nothing on this page to scroll to —
 * which is why this used to be `<a id="unplaced" href="#unplaced">`, a link
 * back to itself that looked tappable and did nothing.
 *
 * There is exactly one surface that turns unplaced stock into placed stock:
 * the reconciliation queue, whose `unplaced` rows carry a "Place in bin"
 * action. That is also what the product contract requires — top10-evals.yaml
 * EV-6.4, "no pseudo-bins: unplaced stock appears only in the OPP-5 queue" —
 * so /bins must not grow an unplaced pseudo-bin of its own, and the honest
 * affordance is a link out to the queue.
 */
function UnplacedInventoryLink({ count }: { count: number }) {
  if (count === 0) return null;
  return (
    <Link
      href="/reconcile-queue"
      data-unplaced-link
      className="glass group mb-lg flex min-h-11 items-center justify-between gap-md rounded-pill px-md py-sm text-control text-ink no-underline focus-ring"
    >
      <span className="font-medium">Unplaced inventory</span>
      <span className="flex shrink-0 items-center gap-xs">
        <span className="tabular text-grey">{count} {count === 1 ? "bottle" : "bottles"}</span>
        <ArrowUpRight className="h-3.5 w-3.5 text-grey group-hover:text-accent" aria-hidden />
      </span>
    </Link>
  );
}

function SearchBox({ query, onChange }: { query: string; onChange: (value: string) => void }) {
  return (
    <label className="relative block">
      <span className="sr-only">Find a bottle</span>
      <Search className="absolute left-md top-1/2 z-[1] h-4 w-4 -translate-y-1/2 text-ink-soft" aria-hidden />
      <input
        type="search"
        aria-label="Find a bottle"
        value={query}
        onChange={(event) => onChange(event.target.value)}
        placeholder="Find a bottle by wine or producer"
        // 17px keeps iOS from zooming the page on focus; 14px once there is
        // a pointer (see search-palette.tsx / cellar-shell.tsx).
        className="glass h-11 w-full rounded-pill pl-[40px] pr-sm text-body-lg text-ink placeholder:text-grey focus:border-accent focus-ring md:text-control"
      />
    </label>
  );
}

type Match = ReturnType<typeof findBottleMatches>[number];

function SearchResults({ matches }: { matches: Match[] }) {
  return (
    <div className="mb-lg border-y border-rule">
      {matches.length === 0 ? (
        <p className="px-md py-md text-body-sm text-grey">No placed bottles match.</p>
      ) : (
        matches.map((match) => (
          <div key={`${match.wineId}:${match.binId}`} data-bottle-match className="border-b border-rule last:border-b-0">
            {/* CELLAR-08 — the search result is the "somebody is on the floor
                hunting for a bottle" path, so the whole row opens the wine. */}
            <Link
              href={`/cellar?wine=${match.wineId}`}
              className="flex min-h-11 items-center justify-between gap-sm px-md py-sm transition-colors hover:bg-wash focus-ring"
            >
              <BinThumb src={match.heroImageUrl} producer={match.producer} name={match.name} colour={match.colour} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-caption font-medium uppercase text-grey">{match.producer}</p>
                <p className="truncate font-serif text-body-lg font-normal text-ink">{wineDisplayName(match.producer, match.name)}</p>
              </div>
              <div className="shrink-0 text-right">
                <p className="font-mono text-micro tracking-[0.12em] text-accent">{match.binZone ? `${match.binZone} › ` : ""}{match.binCode}</p>
                <p className="text-ledger tabular text-grey">{match.quantity} {match.quantity === 1 ? "bottle" : "bottles"}</p>
              </div>
            </Link>
          </div>
        ))
      )}
    </div>
  );
}

/**
 * GLOBAL-01 — the two row controls, pinned out of the table's scroll.
 *
 * Measured on the running app at 390px (e2e/one-row-rule.test.ts): the table is
 * 773px wide inside a 352px `overflow-x-auto`, so 421px of every row sits off
 * screen — and Edit and Retire were entirely inside that part. On the seeded
 * 23-bin cellar that is 46 buttons a phone cannot reach, behind a sideways
 * scroll the page gives no hint of, because an `overflow-x-auto` child absorbs
 * the overflow and `documentElement.scrollWidth` never grows. It is the same
 * defect /cellar had, with the evidence hidden the same way.
 *
 * The table keeps scrolling, deliberately. Six columns of bin data are DATA,
 * and Devin's rule is about buttons: the honest answer to "Capacity is off
 * screen" is a scroll, and forcing a data grid into cards to satisfy a rule
 * about control rows would be applying it where it does not reach. What the
 * rule does forbid is a CONTROL living behind that scroll — so the actions
 * column is pinned to the right edge and is in the frame at every width, with
 * the data still scrolling underneath it.
 */
const ACTIONS_CELL =
  "sticky right-0 z-[1] w-[104px] border-l border-rule px-sm py-sm";

type TableProps = {
  bins: BinViewModel[];
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
};

function BinTable(props: TableProps) {
  // CELLAR-08 — a bin row was a dead end: no picture, and nothing on it
  // clickable but Edit and Retire. Someone sent to Bin A5 for one of ten
  // bottles could not tell which was which. Opening a row now shows what is
  // in it, with the bottle's picture, and each wine goes to its own detail.
  //
  // Shared between the mobile list and the desktop table below (defect 8,
  // 2026-09-08 demo screenshots) — only one is ever visible at a width, but
  // there is no reason a bin expanded on one layout should collapse on the
  // other if the viewport is resized.
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const onToggle = (id: string) => setExpandedId(expandedId === id ? null : id);
  return (
    <div>
      <MobileBinList {...props} expandedId={expandedId} onToggle={onToggle} />
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full min-w-[720px] text-body-sm">
          <thead><tr className="border-b border-rule-strong text-caption font-medium uppercase text-grey"><th className="px-md py-sm text-left">Code</th><th className="px-md py-sm text-left">Zone</th><th className="px-md py-sm text-left">Occupancy</th><th className="px-md py-sm text-right">Capacity</th><th className="px-md py-sm text-right">Priority</th>{props.canManage && <th className={cn(ACTIONS_CELL, "border-l-0")} />}</tr></thead>
          <tbody>
            {props.bins.map((bin) => (
              <BinRow
                key={bin.id}
                bin={bin}
                expanded={expandedId === bin.id}
                onToggle={() => onToggle(bin.id)}
                {...props}
              />
            ))}
          </tbody>
        </table>
      </div>
      {props.bins.length === 0 && <p className="px-md py-xl text-center text-body-sm text-grey">No bins have been created yet.</p>}
    </div>
  );
}

function BinRow({ bin, inventory, canManage, busy, editingId, draft, onDraftChange, onEdit, onCancel, onSave, onRetire, expanded, onToggle }: TableProps & { bin: BinViewModel; expanded: boolean; onToggle: () => void }) {
  if (editingId === bin.id) {
    return <tr data-bin-row className="border-t border-rule"><td colSpan={6} className="px-md py-md"><BinForm draft={draft} busy={busy} submitLabel="Save changes" onChange={onDraftChange} onCancel={onCancel} onSubmit={onSave} /></td></tr>;
  }
  const wines = inventory.filter((item) => item.binId === bin.id);
  return (
    <>
      <tr data-bin-row className="group/bin border-t border-rule hover:bg-wash">
        <td className="px-md py-sm text-ink">
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={expanded}
            disabled={wines.length === 0}
            className="inline-flex min-h-11 items-center gap-xs rounded-pill px-2xs text-left font-serif text-body-lg font-normal text-ink focus-ring disabled:cursor-default"
          >
            <ChevronDown
              className={cn("h-4 w-4 shrink-0 text-grey transition-transform", !expanded && "-rotate-90", wines.length === 0 && "invisible")}
              strokeWidth={1.75}
              aria-hidden
            />
            {bin.code}
          </button>
        </td>
        <td className="px-md py-sm text-grey">{bin.zone ?? "—"}</td>
        <td className="px-md py-sm text-ink">
          <div className="flex items-center gap-xs">
            {/* The bottles themselves, at a glance — this is what tells ten
                bottles in one bin apart. */}
            {wines.slice(0, 5).map((wine) => (
              <BinThumb
                key={`${wine.wineId}:${wine.binId}`}
                src={wine.heroImageUrl}
                producer={wine.producer}
                name={wine.name}
                colour={wine.colour}
              />
            ))}
            <span className="text-ledger text-grey">{bin.occupancy}</span>
          </div>
          <OccupancyMeter bin={bin} className="mt-2xs" />
        </td>
        <td className="px-md py-sm text-right tabular text-grey">{bin.capacity ?? "—"}</td>
        <td className="px-md py-sm text-right tabular text-grey">{bin.priority}</td>
        {canManage && <td className={cn(ACTIONS_CELL, "bg-canvas group-hover/bin:bg-wash")}><BinActions bin={bin} busy={busy} onEdit={onEdit} onRetire={onRetire} /></td>}
      </tr>
      {expanded && wines.length > 0 && (
        <tr data-bin-wines={bin.code} className="border-t border-rule">
          <td colSpan={6} className="px-md py-sm">
            <div className="flex flex-col gap-xs">
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
                  <span className="shrink-0 tabular text-body-sm text-grey">{wine.quantity} {wine.quantity === 1 ? "bottle" : "bottles"}</span>
                </Link>
              ))}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function FormPanel({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="glass mb-lg rounded-card p-md"><h2 className="mb-md font-serif text-subheading font-normal text-ink">{title}</h2>{children}</section>;
}

function ErrorBanner({ message, dismiss }: { message: string; dismiss: () => void }) {
  return <div role="alert" className="mb-md flex items-center justify-between gap-sm rounded-card border border-risk-ink/30 bg-risk-wash px-sm py-xs text-body-sm text-risk-ink"><span>{message}</span><IconButton label="Dismiss error" onClick={dismiss} className="shrink-0 rounded-pill text-risk-ink/70 hover:text-risk-ink focus-ring"><X className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden /></IconButton></div>;
}
