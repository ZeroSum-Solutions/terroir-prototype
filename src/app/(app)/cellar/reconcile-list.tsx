"use client";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { formatSignedVarianceOz, getReconciliationVariance, reconciliationTone } from "@/lib/reconciliation/variance";
import { cn } from "@/lib/utils";
import { ML_PER_OZ } from "@/lib/units";
import { wineTitle } from "@/lib/wine-display-name";
import type { OpenBottleRow } from "@/lib/wine-list/shapes";
import { isPhysicalReconcileResponse, serializePhysicalReconcileRequest, validateNewPhysicalReconcileRequest, type PhysicalReconcileEntry, type PhysicalReconcileItem } from "@/domains/cellar/reconcile-contract";
import { formatPhysicalBottleId } from "@/domains/pours/physical-bottle-command";
import { ReconcileNavigationGuard } from "./reconcile-navigation-guard";
import { RetainedReconciliationPanel } from "./retained-reconciliation-panel";
import { useReconciliationRecovery } from "./use-reconciliation-recovery";
import { useReconcileDraftSession, type PendingReconcileChange } from "./use-reconcile-draft-session";
import { clearReconcileDraft, describeReconcileDraft, persistPhysicalReconcileDraft, type FrozenPhysicalReconcileOperation } from "@/lib/reconcile-draft/draft-storage";
import { isDefinitiveStaleReconciliation } from "@/lib/reconcile-draft/retained-reconciliation-storage";
type ReconcileItem = {
  key: string; wineId: string; producer: string; name: string; vintage: number | null;
  sizeMl: number; remainingMl: number; openedAt: string | null; glassPourMl: number | null;
  physical: PhysicalReconcileItem | null;
};
const FRACTIONS: Array<{ label: string; value: number; short?: string }> = [
  { label: "Empty", value: 0 }, { label: "Quarter", short: "¼", value: 0.25 },
  { label: "Half", short: "½", value: 0.5 }, { label: "Three Quarter", short: "¾", value: 0.75 },
  { label: "Full", value: 1 },
];
const badgeToneClasses = {
  positive: "bg-ready-wash text-ready-ink",
  negative: "bg-risk-wash text-risk-ink",
  neutral: "bg-wash text-grey",
} as const;

const flaggedRowClasses = {
  positive: "border-l-2 border-ready-ink bg-ready-wash",
  negative: "border-l-2 border-risk-ink bg-risk-wash",
  neutral: "border-l-2 border-rule-strong bg-wash",
} as const;

type ReconcileListProps = {
  initialItems: OpenBottleRow[] | PhysicalReconcileItem[];
  varianceThresholdOz?: number;
  onStateChange?: (state: { dirty: boolean; busy: boolean }) => void;
  inDialog?: boolean;
  restaurantId: string; userId: string;
  inventoryContractVersion?: 1 | 2;
  navigateToFreshReconcile?: (url: string) => void; documentEpoch?: number;
};
const DOCUMENT_EPOCH = Date.now();
export function ReconcileList(props: ReconcileListProps) {
  return <ReconcileListSession key={JSON.stringify([props.restaurantId, props.userId, props.inventoryContractVersion ?? 1])} {...props} />;
}
function ReconcileListSession({ initialItems, varianceThresholdOz = 1.0, onStateChange,
  inDialog = false, restaurantId, userId, inventoryContractVersion = 1,
  navigateToFreshReconcile = (url) => window.location.assign(url),
  documentEpoch = DOCUMENT_EPOCH }: ReconcileListProps) {
  const router = useRouter();
  const [pending, setPending] = useState<Record<string, PendingReconcileChange>>({});
  const [draftNotice, setDraftNotice] = useState<ReturnType<typeof describeReconcileDraft>>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, startTransition] = useTransition();
  const [success, setSuccess] = useState<string | null>(null);
  const [frozenOperation, setFrozenOperation] = useState<FrozenPhysicalReconcileOperation | null>(null);
  const [draftLoaded, setDraftLoaded] = useState(false);
  const inFlight = useRef(false);
  const items = useMemo<ReconcileItem[]>(() => inventoryContractVersion === 2
    ? (initialItems as PhysicalReconcileItem[]).map((item) => ({
        key: item.openBottleId, wineId: item.wineId, producer: item.producer,
        name: item.name, vintage: item.vintage, sizeMl: item.nominalCapacityMl,
        remainingMl: item.remainingMl, openedAt: item.openedAt, glassPourMl: null,
        physical: item,
      }))
    : (initialItems as OpenBottleRow[]).map((item) => ({
        key: item.wine_id, wineId: item.wine_id, producer: item.producer,
        name: item.name, vintage: item.vintage, sizeMl: item.size_ml,
        remainingMl: item.open_remaining_ml ?? 0, openedAt: item.opened_at,
        glassPourMl: item.glass_pour_ml, physical: null,
      })), [initialItems, inventoryContractVersion]);

  const recovery = useReconciliationRecovery({
    restaurantId, userId, draftLoaded, frozenOperation, documentEpoch,
    navigate: navigateToFreshReconcile,
    onRelease: () => { setPending({}); setFrozenOperation(null); },
    onError: setError,
  });
  const sessionActive = useReconcileDraftSession({ restaurantId, userId, inventoryContractVersion, pending,
    frozenOperation, draftLoaded, autosaveSuspended: recovery.autosaveSuspended,
    setPending, setFrozenOperation, setDraftNotice, setDraftLoaded });
  const changedCount = Object.keys(pending).length;
  const busy = saving || refreshing || recovery.busy;
  const recoveryLocked = recovery.locked;
  useEffect(() => {
    onStateChange?.({ dirty: changedCount > 0, busy: busy || recoveryLocked });
  }, [changedCount, busy, recoveryLocked, onStateChange]);

  const discardDraft = () => {
    if (inFlight.current || busy || frozenOperation) return;
    setPending({}); setDraftNotice(null); clearReconcileDraft(restaurantId, userId);
  };

  const onSaveAll = async () => {
    if (changedCount === 0 || inFlight.current || refreshing) return;
    inFlight.current = true;
    setError(null);
    setSuccess(null);
    setSaving(true);
    const legacyEntries = Object.entries(pending).map(([wine_id, p]) => ({
      wine_id, new_remaining_ml: p.newRemainingMl, note: p.note,
    }));
    const rawPhysicalEntries: PhysicalReconcileEntry[] = Object.entries(pending)
      .map(([open_bottle_id, entry]) => ({
        open_bottle_id, expected_state_version: entry.expectedStateVersion ?? -1,
        target_remaining_ml: entry.newRemainingMl, note: entry.note ?? null,
      }));
    let physicalEntries: PhysicalReconcileEntry[] = [];
    let operation: FrozenPhysicalReconcileOperation | null = null;
    if (inventoryContractVersion === 2) {
      if (frozenOperation) {
        physicalEntries = rawPhysicalEntries;
        operation = frozenOperation;
      } else {
        const validated = validateNewPhysicalReconcileRequest(
          rawPhysicalEntries, initialItems as PhysicalReconcileItem[]);
        if (!validated.ok) {
          setError(validated.message); inFlight.current = false; setSaving(false); return;
        }
        physicalEntries = validated.entries;
        operation = { operationId: crypto.randomUUID(),
          payload: serializePhysicalReconcileRequest(physicalEntries) };
      }
      const durableDraft = {
        version: 2,
        entries: Object.fromEntries(physicalEntries.map((entry) => [entry.open_bottle_id, {
          expectedStateVersion: entry.expected_state_version, targetRemainingMl: entry.target_remaining_ml,
          note: entry.note,
        }])),
        frozenOperation: operation,
      } as const;
      if (!persistPhysicalReconcileDraft(restaurantId, userId, durableDraft)) {
        setError("Reconciliation was not sent because a retry-safe copy could not be saved. Make browser storage available, then try again.");
        inFlight.current = false; setSaving(false); return;
      }
      if (!frozenOperation) { setFrozenOperation(operation); setDraftNotice(null); }
    }
    try {
      const res = await fetch("/api/reconcile", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(operation ? { "Idempotency-Key": operation.operationId } : {}),
        },
        body: operation?.payload ?? JSON.stringify({ entries: legacyEntries }),
      });
      if (!sessionActive.current) return;
      if (!res.ok) {
        const payload = (await res.json().catch(() => null)) as
          | { error?: string | { message?: string }; code?: string }
          | null;
        if (!sessionActive.current) return;
        if (operation && inventoryContractVersion === 2 &&
          isDefinitiveStaleReconciliation(res.status, res.headers, payload, operation.operationId)) {
          recovery.retainStale(operation); setDraftNotice(null);
          return;
        }
        const message = typeof payload?.error === "string" ? payload.error : payload?.error?.message;
        throw new Error(message ?? `Could not save (${res.status}). Your counts are still here; try again.`);
      }
      if (operation) {
        const responseBody = await res.json().catch(() => null);
        if (!sessionActive.current) return;
        const replayed = res.headers?.get?.("Idempotency-Replayed");
        if (res.headers?.get?.("Idempotency-Key") !== operation.operationId ||
          (replayed !== "true" && replayed !== "false") ||
          !isPhysicalReconcileResponse(responseBody, operation.operationId, physicalEntries)) {
          throw new Error("The reconciliation result could not be verified. Retry the prior reconciliation.");
        }
      }
      setPending({});
      setFrozenOperation(null);
      setDraftNotice(null);
      clearReconcileDraft(restaurantId, userId);
      const count = inventoryContractVersion === 2 ? physicalEntries.length : legacyEntries.length;
      setSuccess(`${count} bottle${count === 1 ? "" : "s"} reconciled.`);
      startTransition(() => router.refresh());
    } catch (e) {
      if (sessionActive.current) setError(e instanceof Error ? e.message : "Save failed.");
    } finally {
      if (sessionActive.current) { inFlight.current = false; setSaving(false); }
    }
  };

  if (items.length === 0 && changedCount === 0 && !recovery.hasEvidence &&
    !recovery.retentionBlocked && !recovery.handoffPending) {
    return <div className="border-y border-rule px-md py-lg text-center text-body-sm text-grey">
      {inventoryContractVersion === 2
        ? "No open bottles to reconcile. Select a wine in Cellar, then choose Open bottle."
        : "No open bottles to reconcile. Open one by pouring a glass."}
    </div>;
  }

  return (
    <div className="pb-[120px]">
      <ReconcileNavigationGuard dirty={changedCount > 0} busy={busy || recoveryLocked} interceptLinks={!inDialog} onDiscard={discardDraft} />
      <RetainedReconciliationPanel records={recovery.records} current={recovery.current}
        retentionBlocked={recovery.retentionBlocked} confirming={recovery.confirming}
        handoffPending={recovery.handoffPending} busy={busy}
        onRetryRetention={recovery.retryRetention} onRequestFresh={recovery.requestFresh}
        onCancelFresh={recovery.cancelFresh} onConfirmFresh={recovery.confirmFresh}
        onReloadFresh={recovery.reloadFresh} />
      {draftNotice && (
        <div role="status" className="glass mb-md flex items-center justify-between gap-sm rounded-card px-md py-sm text-body-sm text-ink">
          <span>{draftNotice.message}</span>
          {draftNotice.canUndo && !busy && !frozenOperation && <button type="button" onClick={discardDraft} className="min-h-11 shrink-0 rounded-pill px-sm text-ledger font-medium text-accent hover:underline">Undo</button>}
        </div>
      )}
      {success && <p role="status" className="mb-md text-control text-ready-ink">{success}</p>}
      {frozenOperation && !recovery.current && !recovery.retentionBlocked && !error && (
        <p role="status" className="mb-md text-body-sm text-grey">
          The prior result is unconfirmed. Retry the same reconciliation before making other changes.
        </p>
      )}
      {error && (
        <div
          role="alert"
          className="mb-md rounded-card border border-risk-ink/30 bg-risk-wash px-md py-sm text-body-sm text-risk-ink"
        >
          {error}
        </div>
      )}

      <fieldset disabled={busy || recoveryLocked} className="min-w-0">
      <legend className="sr-only">Actual remaining volume for each open bottle</legend>
      <ul className="-mx-md divide-y divide-rule border-y border-rule md:mx-0">
        {items.map((item) => (
          <ReconcileRow
            key={item.key}
            item={item}
            inDialog={inDialog}
            pending={pending[item.key] ?? null}
            varianceThresholdOz={varianceThresholdOz}
            onChange={(change) =>
              { setSuccess(null); setDraftNotice(null); setPending((prev) => ({ ...prev, [item.key]: {
                ...change,
                ...(item.physical ? { expectedStateVersion: prev[item.key]?.expectedStateVersion ?? item.physical.stateVersion } : {}),
              } })); }
            }
          />
        ))}
      </ul>
      </fieldset>

      {!recovery.current && !recovery.retentionBlocked && !recovery.handoffPending && <div className={cn("glass fixed left-md right-md z-[var(--z-chrome)] rounded-card px-md py-sm md:static md:mt-lg", inDialog ? "bottom-[calc(var(--safe-bottom)+var(--spacing-sm))]" : "bottom-[calc(var(--chrome-tabbar-total)+var(--spacing-md)+var(--spacing-md))]")}>
        <button
          type="button"
          onClick={onSaveAll}
          disabled={changedCount === 0 || busy}
          className={cn(
            "h-[48px] w-full rounded-pill font-semibold transition-colors",
            changedCount > 0 && !busy
              ? "bg-primary text-seal-ink hover:bg-primary-hover"
              : "bg-wash text-grey",
          )}
        >
          {busy
            ? "Saving..."
            : changedCount > 0
            ? frozenOperation
              ? "Retry prior reconciliation"
              : `Save ${changedCount} change${changedCount === 1 ? "" : "s"}`
              : "No changes yet"}
        </button>
      </div>}
    </div>
  );
}

function ReconcileRow({ item, pending, onChange, varianceThresholdOz, inDialog }: {
  item: ReconcileItem; inDialog: boolean; pending: PendingReconcileChange | null;
  onChange: (change: PendingReconcileChange) => void; varianceThresholdOz: number;
}) {
  const currentMl = pending?.newRemainingMl ?? item.remainingMl;
  const currentOz = currentMl / ML_PER_OZ;
  const trackedOz = item.remainingMl / ML_PER_OZ;
  const glassesLeft = useMemo(() => item.glassPourMl
    ? Math.floor(item.remainingMl / item.glassPourMl) : null,
  [item.remainingMl, item.glassPourMl]);
  const expectedMl = item.remainingMl;
  const variance = getReconciliationVariance(pending?.newRemainingMl ?? expectedMl, expectedMl);
  const varianceOz = variance.deltaMl / ML_PER_OZ;
  const tone = reconciliationTone(variance.relation);
  const isVarianceFlagged = pending !== null && Math.abs(varianceOz) > varianceThresholdOz;
  const changeVolume = (value: number) => onChange({ newRemainingMl: value, note: pending?.note });

  return (
    <li className={`px-md py-md ${isVarianceFlagged ? flaggedRowClasses[tone] : ""}`}>
      <div className="mb-sm flex items-start justify-between gap-sm">
        <div className="min-w-0">
          {inDialog ? (
            <p className="flex min-h-11 items-center font-serif text-body-lg font-normal leading-snug text-ink">
              {wineTitle(item.producer, item.name)} {item.vintage ?? ""}
            </p>
          ) : (
            <Link href={`/cellar?wine=${item.wineId}${item.physical ? `&bottle=${item.physical.openBottleId}` : ""}`}
              className="flex min-h-11 items-center rounded-pill font-serif text-body-lg font-normal leading-snug text-ink transition-colors hover:text-accent focus-ring">
              {wineTitle(item.producer, item.name)}
              {item.vintage !== null && <span className="ml-xs font-sans text-ledger font-light text-grey">{item.vintage}</span>}
            </Link>
          )}
          <div className="mt-2xs flex flex-wrap items-center gap-xs text-ledger text-grey">
            <span className="rounded-pill bg-surface-sunken px-sm py-2xs tabular">{formatBottleSize(item.sizeMl)}</span>
            {item.openedAt && <span className="tabular-nums">Opened {formatOpenedAt(item.openedAt)}</span>}
            {item.physical && <span className="font-mono" data-physical-bottle-id={item.physical.openBottleId}>{formatPhysicalBottleId(item.physical.openBottleId)}</span>}
            {item.physical?.sourceBinLocation && <span>{item.physical.sourceBinLocation}</span>}
            {item.physical?.sourceProvenance === "legacy_unknown" && <span>Legacy source</span>}
          </div>
        </div>
      </div>

      <div className="mb-sm rounded-card bg-surface-sunken px-sm py-sm">
        <div className="flex flex-wrap items-baseline gap-sm">
          <span className="text-ledger text-grey">Tracked:</span>
          <span className="tabular text-body font-medium text-ink">{trackedOz.toFixed(1)} oz</span>
          <span className="text-ledger text-grey tabular-nums">({item.remainingMl} ml{glassesLeft === null ? "" : ` ~${glassesLeft} glass${glassesLeft === 1 ? "" : "es"}`})</span>
        </div>
      </div>

      <div className="mb-sm">
        <div className="flex flex-wrap items-center gap-sm">
          <label className="flex min-h-11 items-center gap-xs text-body-sm text-grey">
            <span>Actual:</span>
            <input type="number" inputMode="numeric" min={0} max={item.sizeMl} value={currentMl}
              onChange={(e) => {
                const raw = e.target.value;
                if (raw === "") return changeVolume(0);
                const val = Number(raw);
                if (!Number.isNaN(val) && val >= 0) changeVolume(Math.min(item.sizeMl, val));
              }}
              className="h-11 w-[96px] rounded-pill border border-rule bg-surface px-sm text-body-lg tabular outline-none focus:border-accent focus-ring"
              aria-label="Actual remaining volume in ml" />
          </label>
          <span className="text-body-sm text-grey tabular-nums">= {currentOz.toFixed(1)} oz</span>
        </div>
        {pending !== null && (
          <div className={`mt-xs inline-flex items-center gap-xs rounded-pill px-sm py-2xs text-caption font-medium uppercase tracking-[0.13em] ${badgeToneClasses[tone]}`}>
            {formatSignedVarianceOz(variance.deltaMl)} · {variance.label}
          </div>
        )}
      </div>

      <div className="mb-sm grid grid-cols-5 gap-2xs sm:gap-xs">
        {FRACTIONS.map((f) => {
          const ml = Math.round(item.sizeMl * f.value);
          const isActive = currentMl === ml;
          return (
            <button key={f.label} type="button" aria-label={f.label} aria-pressed={isActive}
              onClick={() => changeVolume(ml)}
              className={cn(
                "h-[44px] rounded-pill border text-ledger font-medium transition-colors",
                isActive ? "border-accent bg-primary text-seal-ink" : "border-rule-strong bg-transparent text-ink hover:bg-wash",
              )}>{f.short ?? f.label}</button>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-sm">
        <label className="flex min-h-11 w-full items-center gap-xs sm:w-auto sm:flex-1">
          <span className="text-ledger text-grey whitespace-nowrap">Note:</span>
          <input type="text" maxLength={500} value={pending?.note ?? ""}
            onChange={(e) => onChange({ newRemainingMl: currentMl, note: e.target.value })}
            placeholder="spill, miscount, etc."
            className="h-11 min-w-0 flex-1 rounded-pill border border-rule bg-surface px-sm text-body-lg outline-none focus:border-accent focus-ring" />
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
