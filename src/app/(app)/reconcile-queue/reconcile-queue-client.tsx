"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, RefreshCw, Undo2 } from "lucide-react";
import { buildAcceptAction } from "./accept-action";
import { QueueIssueRow } from "./issue-row";
import type { QueueResponse } from "./types";

const QUEUE_PAGE_SIZE = 25;

export function ReconcileQueueClient({ canManage }: { canManage: boolean }) {
  const queue = useQueueData();
  if (queue.loading) return <QueueLoading />;
  if (queue.error || !queue.data) return <QueueError message={queue.error ?? "Queue unavailable."} retry={queue.reload} />;
  return <LoadedQueue data={queue.data} reload={queue.reload} canManage={canManage} />;
}

function LoadedQueue({ data, reload, canManage }: { data: QueueResponse; reload: () => Promise<void>; canManage: boolean }) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [binByIssue, setBinByIssue] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const rows = useMemo(() => [...data.issues].sort(compareRows), [data.issues]);
  const ready = rows.filter((row) => buildAcceptAction(row, binByIssue[row.id]) !== null);
  const selectedRows = rows.filter((row) => selected.has(row.id));
  const mutate = useCallback(async (path: string, body: unknown, success: string) => {
    setBusy(true);
    setMutationError(null);
    try {
      await postJson(path, body);
      setMessage(success);
      setSelected(new Set());
      await reload();
    } catch (error) {
      setMutationError(error instanceof Error ? error.message : "Request failed.");
    } finally {
      setBusy(false);
    }
  }, [reload]);
  const accept = () => {
    const actions = selectedRows.flatMap((row) => {
      const action = buildAcceptAction(row, binByIssue[row.id]);
      return action ? [action] : [];
    });
    if (actions.length) void mutate("/api/reconcile-queue/accept", actions, `${actions.length} item${actions.length === 1 ? "" : "s"} accepted`);
  };
  const undo = () => {
    const id = data.latest_batch?.id;
    if (id) void mutate("/api/reconcile-queue/undo", { batch_id: id }, "Latest batch undone");
  };
  return <QueueView data={data} rows={rows} ready={ready} selected={selected} selectedRows={selectedRows} binByIssue={binByIssue} busy={busy} message={message} mutationError={mutationError} canManage={canManage} accept={accept} undo={undo} setSelected={setSelected} setBinByIssue={setBinByIssue} />;
}

type QueueViewProps = {
  data: QueueResponse;
  rows: QueueResponse["issues"];
  ready: QueueResponse["issues"];
  selectedRows: QueueResponse["issues"];
  selected: Set<string>;
  binByIssue: Record<string, string>;
  busy: boolean;
  message: string | null;
  mutationError: string | null;
  canManage: boolean;
  accept: () => void;
  undo: () => void;
  setSelected: React.Dispatch<React.SetStateAction<Set<string>>>;
  setBinByIssue: React.Dispatch<React.SetStateAction<Record<string, string>>>;
};

function QueueView(props: QueueViewProps) {
  const { data, rows, ready, selectedRows, selected, binByIssue, busy, canManage } = props;
  const paginationKey = rows.map((row) => row.id).join("\u0000");
  const [pagination, setPagination] = useState({
    key: paginationKey,
    count: QUEUE_PAGE_SIZE,
  });
  const visibleCount =
    pagination.key === paginationKey ? pagination.count : QUEUE_PAGE_SIZE;
  const visibleRows = rows.slice(0, visibleCount);
  return (
    <>
      <QueueHeader summary={data.summary} latestBatch={canManage ? data.latest_batch : null} busy={busy} undo={props.undo} />
      {(props.message || props.mutationError) && <StatusBanner message={props.message} error={props.mutationError} />}
      {rows.length === 0 ? <QueueEmpty /> : (
        <div className="border-y border-rule">
          {visibleRows.map((row) => (
          <QueueIssueRow
            key={row.id}
            row={row}
            bins={data.bins}
            binId={binByIssue[row.id]}
            checked={selected.has(row.id)}
            disabled={busy}
            canManage={canManage}
            onBinChange={(binId) => props.setBinByIssue((current) => ({ ...current, [row.id]: binId }))}
            onToggle={() => props.setSelected((current) => toggleId(current, row.id))}
          />
          ))}
        </div>
      )}
      {visibleRows.length < rows.length && (
        <button
          type="button"
          onClick={() =>
            setPagination({
              key: paginationKey,
              count: visibleCount + QUEUE_PAGE_SIZE,
            })
          }
          className="glass mt-md min-h-11 w-full rounded-pill px-md text-control font-medium text-ink focus-ring"
        >
          Show {Math.min(QUEUE_PAGE_SIZE, rows.length - visibleRows.length)} more ·{" "}
          {visibleRows.length} of {rows.length}
        </button>
      )}
      {canManage && rows.length > 0 && (
        <BulkRail
          busy={busy}
          selectedCount={selectedRows.length}
          readyCount={ready.length}
          allReadySelected={ready.length > 0 && ready.every((row) => selected.has(row.id))}
          accept={props.accept}
          toggleAll={() => props.setSelected((current) => toggleAllReady(current, ready.map((row) => row.id)))}
        />
      )}
    </>
  );
}

function useQueueData() {
  const [data, setData] = useState<QueueResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(async () => {
    setError(null);
    try {
      const response = await fetch("/api/reconcile-queue", { cache: "no-store" });
      if (!response.ok) throw new Error(await responseMessage(response));
      setData(await response.json() as QueueResponse);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Queue unavailable.");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    let active = true;
    requestQueue().then((result) => {
      if (active) setData(result);
    }).catch((failure: unknown) => {
      if (active) setError(failure instanceof Error ? failure.message : "Queue unavailable.");
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, []);
  return { data, loading, error, reload };
}

function QueueHeader({ summary, latestBatch, busy, undo }: { summary: QueueResponse["summary"]; latestBatch: QueueResponse["latest_batch"]; busy: boolean; undo: () => void }) {
  return (
    // The summary line stays ONE text node: e2e/reconcile-queue.test.ts
    // asserts it with an exact getByText.
    <header className="dawn-gradient relative -mx-md -mt-lg mb-lg flex flex-wrap items-end justify-between gap-md overflow-hidden px-md pb-lg pt-xl md:-mx-lg md:-mt-xl md:mb-xl md:px-lg md:pb-xl md:pt-2xl">
      <div className="min-w-0">
        <p className="text-caption font-medium uppercase tracking-[0.18em] text-accent">Inventory control</p>
        <h1 className="mt-xs font-serif text-heading font-normal leading-[1.0] tracking-[-0.02em] text-ink lg:text-display">Reconciliation queue</h1>
        <p className="mt-sm text-control tabular-nums text-grey">{summary.itemCount} items · {summary.unitCount} units · ${formatRisk(summary.atRisk)} at risk</p>
      </div>
      {latestBatch && (
        <button type="button" onClick={undo} disabled={busy} className="glass flex h-11 items-center gap-xs rounded-pill px-md text-control font-medium text-ink focus-ring disabled:opacity-50">
          <Undo2 className="h-4 w-4" strokeWidth={1.75} aria-hidden />Undo latest batch
        </button>
      )}
    </header>
  );
}

/**
 * GLOBAL-01 — the bulk rail, minus the count it was already saying twice.
 *
 * FIXED, not sticky, on a phone: the app shell's wrapper carries
 * `overflow-x-hidden`, which makes it a scroll container whose scrollport is
 * its own full height — so a `position: sticky` child inside it resolves
 * against a box that never scrolls and simply never sticks. Measured on the
 * running app: the rail sat 6,264px below the fold with the page scrolled to
 * it. `fixed` above the nav dock is what the rail was always meant to do —
 * and above the FAB as well as the dock, since the FAB owns the bottom-right
 * corner at exactly the dock+md+md the rail would otherwise take.
 *
 * Measured on the running app at 390px against the production-shaped tenant
 * (e2e/one-row-rule.test.ts): "Select actionable (51)" 147px + "51 selected"
 * 56px + "Accept 51 items" 146px is 349px of content plus 24px of gaps against
 * 354px of rail, so the accept button wrapped onto a second line. The demo
 * tenant's shorter labels happened to fit, which is why nothing had noticed.
 *
 * The read-out was the control to lose: "Accept 51 items" already states the
 * selected count, on the button that acts on it, so the standalone span was
 * the same number a second time. Two controls, one line — and the label only
 * grows one digit at a time from here.
 *
 * The two survivors then wrapped anyway when the Cellar Index redesign swapped
 * the sans face for Inter, which sets the same 13px labels wider: 161px + 153px
 * against the 310px the 390px frame leaves once the page gutter, the rail's own
 * padding and the gap are taken out. Four pixels. The labels are both load-
 * bearing (one names what gets selected, the other what gets accepted), so the
 * padding gave way instead — px-xs on the ghost toggle, px-sm on the primary.
 * That leaves ~16px of slack, which is what a third digit in either count costs.
 */
function BulkRail({ busy, selectedCount, readyCount, allReadySelected, accept, toggleAll }: { busy: boolean; selectedCount: number; readyCount: number; allReadySelected: boolean; accept: () => void; toggleAll: () => void }) {
  return (
    <div data-bulk-rail className="glass fixed inset-x-md bottom-[calc(var(--chrome-tabbar-total)+var(--spacing-md)+var(--spacing-md))] z-[var(--z-chrome)] flex flex-nowrap items-center justify-between gap-sm rounded-card px-sm py-sm md:static md:mt-md md:px-md">
      <button type="button" onClick={toggleAll} disabled={busy || readyCount === 0} className="h-11 shrink-0 whitespace-nowrap rounded-pill px-xs text-body-sm font-medium text-ink-soft hover:bg-wash hover:text-ink focus-ring disabled:opacity-40">
        {allReadySelected ? "Clear actionable" : `Select actionable (${readyCount})`}
      </button>
      <button type="button" onClick={accept} disabled={busy || selectedCount === 0} className="flex h-11 shrink-0 items-center gap-xs whitespace-nowrap rounded-pill bg-primary px-sm text-body-sm font-semibold text-seal-ink hover:bg-primary-hover focus-ring disabled:opacity-45">
        {busy ? <RefreshCw className="h-4 w-4 animate-spin" strokeWidth={1.75} aria-hidden /> : <Check className="h-4 w-4" strokeWidth={2} aria-hidden />}
        Accept {selectedCount} item{selectedCount === 1 ? "" : "s"}
      </button>
    </div>
  );
}

function QueueLoading() {
  return <div aria-label="Loading reconciliation queue" className="space-y-sm"><div className="h-20 animate-pulse rounded-card bg-wash" />{[1, 2, 3].map((item) => <div key={item} className="h-24 animate-pulse border-t border-rule bg-wash/60" />)}</div>;
}

function QueueError({ message, retry }: { message: string; retry: () => void }) {
  return <div role="alert" className="rounded-card border border-risk-ink/30 bg-risk-wash p-md text-body-sm text-risk-ink"><p>{message}</p><button type="button" onClick={retry} className="mt-sm h-11 rounded-pill border border-rule-strong bg-transparent px-md font-medium hover:bg-wash focus-ring">Try again</button></div>;
}

function QueueEmpty() {
  return <div className="rounded-card card-surface px-lg py-3xl text-center"><Check className="mx-auto mb-sm h-8 w-8 text-ready-ink" aria-hidden /><p className="font-serif text-subheading font-normal text-ink">Queue is clear</p><p className="mt-xs text-body-sm text-grey">No inventory records need reconciliation.</p></div>;
}

function StatusBanner({ message, error }: { message: string | null; error: string | null }) {
  return <div role={error ? "alert" : "status"} className={`mb-md rounded-card border px-md py-sm text-body-sm ${error ? "border-risk-ink/30 bg-risk-wash text-risk-ink" : "border-ready-ink/30 bg-ready-wash text-ready-ink"}`}>{error ?? message}</div>;
}

function toggleId(current: Set<string>, id: string) {
  const next = new Set(current);
  if (next.has(id)) next.delete(id); else next.add(id);
  return next;
}

function toggleAllReady(current: Set<string>, ready: string[]) {
  const next = new Set(current);
  const remove = ready.every((id) => next.has(id));
  for (const id of ready) {
    if (remove) next.delete(id);
    else next.add(id);
  }
  return next;
}

function compareRows(left: QueueResponse["issues"][number], right: QueueResponse["issues"][number]) {
  return right.atRisk - left.atRisk || left.id.localeCompare(right.id);
}

async function postJson(path: string, body: unknown) {
  const response = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!response.ok) throw new Error(await responseMessage(response));
}

async function requestQueue(): Promise<QueueResponse> {
  const response = await fetch("/api/reconcile-queue", { cache: "no-store" });
  if (!response.ok) throw new Error(await responseMessage(response));
  return response.json() as Promise<QueueResponse>;
}

async function responseMessage(response: Response): Promise<string> {
  const payload = await response.json().catch(() => null) as { error?: { message?: string } | string } | null;
  if (typeof payload?.error === "string") return payload.error;
  return payload?.error?.message ?? `Request failed (${response.status}).`;
}

function formatRisk(value: number): string {
  return new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
}
