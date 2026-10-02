import { useEffect, useRef, useState } from "react";
import {
  readPhysicalReconcileDraftSnapshot,
  releasePhysicalReconcileDraft,
  type FrozenPhysicalReconcileOperation,
} from "@/lib/reconcile-draft/draft-storage";
import {
  confirmRetainedReconciliation,
  markRetainedReconciliationFreshLoaded,
  readRetainedReconciliationConfirmation,
  readRetainedReconciliations,
  retainStaleReconciliation,
  type RetainedReconciliationSnapshot,
} from "@/lib/reconcile-draft/retained-reconciliation-storage";

export function useReconciliationRecovery({
  restaurantId,
  userId,
  draftLoaded,
  frozenOperation,
  documentEpoch,
  navigate,
  onRelease,
  onError,
}: {
  restaurantId: string;
  userId: string;
  draftLoaded: boolean;
  frozenOperation: FrozenPhysicalReconcileOperation | null;
  documentEpoch: number;
  navigate: (url: string) => void;
  onRelease: () => void;
  onError: (message: string | null) => void;
}) {
  const [records, setRecords] = useState<RetainedReconciliationSnapshot[]>([]);
  const [current, setCurrent] = useState<RetainedReconciliationSnapshot | null>(null);
  const [retentionBlocked, setRetentionBlocked] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [handoffPending, setHandoffPending] = useState(false);
  const [busy, setBusy] = useState(false);
  const autosaveSuspended = useRef(false);
  const actionInFlight = useRef(false);

  /* eslint-disable react-hooks/set-state-in-effect -- sessionStorage is external state restored on mount. */
  useEffect(() => {
    if (!draftLoaded) return;
    const retained = readRetainedReconciliations(restaurantId, userId);
    if (!retained.ok) {
      onError("Retained reconciliation evidence could not be verified. Browser storage must be available before continuing.");
      setRecords([]); setCurrent(null); setHandoffPending(true); return;
    }
    setRecords(retained.value); setCurrent(null); setConfirming(false);
    setHandoffPending(false); setRetentionBlocked(false);
    if (frozenOperation) {
      const active = readPhysicalReconcileDraftSnapshot(restaurantId, userId, frozenOperation);
      const matched = active && retained.value.find((entry) => entry.record.failedDraftRaw === active.raw);
      if (!matched) return;
      setCurrent(matched);
      const confirmation = readRetainedReconciliationConfirmation(matched);
      if (confirmation.ok && confirmation.value.confirmation.freshLoadedAt === null) setConfirming(true);
      return;
    }
    const pending = retained.value.map((entry) => ({
      entry, confirmation: readRetainedReconciliationConfirmation(entry),
    })).find(({ confirmation }) => confirmation.ok &&
      confirmation.value.confirmation.freshLoadedAt === null);
    if (!pending?.confirmation.ok) return;
    const freshAfter = new URLSearchParams(window.location.search).get("fresh-after");
    if (freshAfter === pending.entry.record.operationId &&
      documentEpoch > pending.confirmation.value.confirmation.confirmedAt &&
      markRetainedReconciliationFreshLoaded(pending.entry).ok) {
      setCurrent(null); setHandoffPending(false); return;
    }
    setCurrent(pending.entry); setHandoffPending(true);
  }, [documentEpoch, draftLoaded, frozenOperation, onError, restaurantId, userId]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const retainStale = (operation: FrozenPhysicalReconcileOperation): boolean => {
    const activeDraft = readPhysicalReconcileDraftSnapshot(restaurantId, userId, operation);
    const retained = activeDraft && retainStaleReconciliation({ restaurantId, userId, activeDraft });
    if (!retained || !retained.ok) {
      setRetentionBlocked(true); setCurrent(null); return false;
    }
    setRecords((existing) => [retained.value,
      ...existing.filter((entry) => entry.record.operationId !== operation.operationId)]);
    setCurrent(retained.value); setRetentionBlocked(false); return true;
  };

  const navigateFresh = (record: RetainedReconciliationSnapshot) => {
    try {
      navigate(`/cellar/reconcile?fresh-after=${encodeURIComponent(record.record.operationId)}`);
    } catch {
      onError("The fresh reconciliation page did not load. Reload it before entering a new count.");
    }
  };

  const confirmFresh = () => {
    if (!current || actionInFlight.current) return;
    actionInFlight.current = true; setBusy(true); onError(null);
    const confirmed = confirmRetainedReconciliation(current);
    if (!confirmed.ok) {
      onError("The retained copy could not be confirmed. The prior count is still frozen.");
      actionInFlight.current = false; setBusy(false); return;
    }
    autosaveSuspended.current = true;
    const operation = current.failedDraft.draft.frozenOperation!;
    const active = readPhysicalReconcileDraftSnapshot(restaurantId, userId, operation);
    if (!active || active.raw !== current.record.failedDraftRaw ||
      !releasePhysicalReconcileDraft(restaurantId, userId, current.record.failedDraftRaw)) {
      onError("The active count release could not be verified. Reload to continue recovery.");
      setHandoffPending(true); setConfirming(false);
      actionInFlight.current = false; setBusy(false); return;
    }
    onRelease(); setConfirming(false); setHandoffPending(true);
    actionInFlight.current = false; setBusy(false); navigateFresh(current);
  };

  return {
    records,
    current,
    retentionBlocked,
    confirming,
    handoffPending,
    busy,
    locked: frozenOperation !== null || handoffPending,
    autosaveSuspended,
    hasEvidence: records.length > 0,
    retainStale,
    retryRetention: () => { onError(null); if (frozenOperation) retainStale(frozenOperation); },
    requestFresh: () => setConfirming(true),
    cancelFresh: () => setConfirming(false),
    confirmFresh,
    reloadFresh: () => {
      if (current) navigateFresh(current);
      else {
        try { navigate("/cellar/reconcile"); }
        catch { onError("The reconciliation page did not reload. Try again before entering a new count."); }
      }
    },
  };
}
