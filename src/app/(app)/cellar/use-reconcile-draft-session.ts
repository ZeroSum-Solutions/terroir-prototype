import { useEffect, useRef, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import {
  describeReconcileDraft,
  readReconcileDraft,
  writeReconcileDraft,
  type FrozenPhysicalReconcileOperation,
} from "@/lib/reconcile-draft/draft-storage";

export type PendingReconcileChange = {
  newRemainingMl: number;
  note?: string;
  expectedStateVersion?: number;
};

export function useReconcileDraftSession({
  restaurantId,
  userId,
  inventoryContractVersion,
  pending,
  frozenOperation,
  draftLoaded,
  autosaveSuspended,
  setPending,
  setFrozenOperation,
  setDraftNotice,
  setDraftLoaded,
}: {
  restaurantId: string;
  userId: string;
  inventoryContractVersion: 1 | 2;
  pending: Record<string, PendingReconcileChange>;
  frozenOperation: FrozenPhysicalReconcileOperation | null;
  draftLoaded: boolean;
  autosaveSuspended: MutableRefObject<boolean>;
  setPending: Dispatch<SetStateAction<Record<string, PendingReconcileChange>>>;
  setFrozenOperation: Dispatch<SetStateAction<FrozenPhysicalReconcileOperation | null>>;
  setDraftNotice: Dispatch<SetStateAction<ReturnType<typeof describeReconcileDraft>>>;
  setDraftLoaded: Dispatch<SetStateAction<boolean>>;
}) {
  const activeSession = useRef(true);
  useEffect(() => {
    activeSession.current = true;
    return () => { activeSession.current = false; };
  }, []);
  useEffect(() => {
    const result = readReconcileDraft(restaurantId, userId, inventoryContractVersion);
    if (result.kind === "restored") setPending(result.entries);
    if (result.kind === "restored-physical") {
      setPending(Object.fromEntries(Object.entries(result.draft.entries).map(([id, entry]) => [id, {
        newRemainingMl: entry.targetRemainingMl,
        note: entry.note ?? undefined,
        expectedStateVersion: entry.expectedStateVersion,
      }])));
      setFrozenOperation(result.draft.frozenOperation);
    }
    setDraftNotice(describeReconcileDraft(result));
    setDraftLoaded(true);
  }, [inventoryContractVersion, restaurantId, setDraftLoaded, setDraftNotice,
    setFrozenOperation, setPending, userId]);

  useEffect(() => {
    if (!draftLoaded || autosaveSuspended.current || frozenOperation) return;
    if (inventoryContractVersion === 2) {
      writeReconcileDraft(restaurantId, userId, {
        version: 2,
        entries: Object.fromEntries(Object.entries(pending).map(([id, entry]) => [id, {
          expectedStateVersion: entry.expectedStateVersion ?? -1,
          targetRemainingMl: entry.newRemainingMl,
          note: entry.note ?? null,
        }])),
        frozenOperation,
      });
    } else writeReconcileDraft(restaurantId, userId, pending);
  }, [autosaveSuspended, draftLoaded, frozenOperation, inventoryContractVersion,
    pending, restaurantId, userId]);
  return activeSession;
}
