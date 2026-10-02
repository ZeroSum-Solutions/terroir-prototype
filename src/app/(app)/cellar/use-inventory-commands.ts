"use client";

import { useCallback, type Dispatch, type SetStateAction } from "react";
import type { PreservationMethod } from "@/lib/partial-bottles/math";
import type { CellarWineRow } from "./types";
import { useAsyncAction } from "./use-async-action";
import {
  isOpenBottleSuccess,
  isDefinitiveCommandResponse,
  isReplayedCommandResponse,
  unknownCommandOutcomeMessage,
  useIdempotentCommand,
} from "./use-idempotent-command";

type Toast = {
  success(message: string): void;
  error(message: string): void;
};

type OpenPayload = {
  wineId: string;
  preservationMethod: PreservationMethod;
  contractVersion: 1 | 2;
};

type PourPayload = {
  wineId: string;
  ml: number;
  contractVersion: 1 | 2;
  openBottleId: string | null;
  preservationMethod: PreservationMethod;
};

export type LastPourReceipt =
  | { contractVersion: 1; wineId: string; ml: number }
  | { contractVersion: 2; wineId: string; bottleId: string; eventId: string; ml: number };

export function useInventoryCommands(input: {
  row: CellarWineRow | null;
  contractVersion: 1 | 2;
  selectedBottleId: string | null;
  preservationMethod: PreservationMethod;
  setBusy: Dispatch<SetStateAction<boolean>>;
  setErrorMsg: Dispatch<SetStateAction<string | null>>;
  lastPour: LastPourReceipt | null;
  setLastPour: Dispatch<SetStateAction<LastPourReceipt | null>>;
  toast: Toast;
  refresh: () => void;
  onBottleOpened: (bottleId: string) => void;
  onBottleStale: (message: string) => void;
}) {
  const { busy: openBottleBusy, run: runOpen } = useAsyncAction();
  const {
    begin: beginOpen,
    retry: retryOpen,
    finish: finishOpen,
    pending: pendingOpen,
  } = useIdempotentCommand<OpenPayload>();
  const {
    begin: beginPour,
    retry: retryPour,
    finish: finishPour,
    pending: pendingPour,
  } = useIdempotentCommand<PourPayload>();
  const {
    begin: beginUndo, retry: retryUndo, finish: finishUndo, pending: pendingUndo,
  } = useIdempotentCommand<LastPourReceipt>();
  const {
    row,
    contractVersion,
    selectedBottleId,
    preservationMethod,
    setBusy,
    setErrorMsg,
    lastPour,
    setLastPour,
    toast,
    refresh,
    onBottleOpened,
    onBottleStale,
  } = input;
  const runOpenCommand = useCallback((attempt: CommandAttempt<OpenPayload>) => {
    setErrorMsg(null);
    let definitive = false;
    let successful = false;
    return runOpen(
      async () => {
        try {
          const response = await fetch("/api/open-bottles", {
            method: "POST",
            headers: commandHeaders(attempt.operationId),
            body: JSON.stringify({
              wine_id: attempt.payload.wineId,
              preservation_method: attempt.payload.preservationMethod,
            }),
          });
          const payload = await readPayload(response);
          definitive = isDefinitiveCommandResponse(
            response,
            payload,
            isOpenBottleSuccess,
          );
          if (!response.ok) {
            throw new Error(
              readError(payload) ?? `Failed to open bottle (${response.status}).`,
            );
          }
          if (!definitive) throw new Error("Invalid open-bottle response.");
          const openedBottleId = readOpenBottleId(payload);
          if (!openedBottleId) throw new Error("Invalid open-bottle response.");
          successful = true;
          toast.success(
            isReplayedCommandResponse(response)
              ? "Already recorded"
              : "Bottle opened",
          );
          refresh();
          if (attempt.payload.contractVersion === 2) {
            onBottleOpened(openedBottleId);
          }
        } finally {
          finishOpen(attempt.fingerprint, definitive, successful);
        }
      },
      {
        fallbackMessage: "Failed to open bottle.",
        onError: (message) => {
          if (!definitive || attempt.wasUncertain) {
            setErrorMsg(unknownCommandOutcomeMessage(
              "Open",
              "open",
              definitive ? message : undefined,
            ));
          } else {
            toast.error("Open bottle failed");
            setErrorMsg(message);
          }
        },
      },
    );
  }, [finishOpen, onBottleOpened, refresh, runOpen, setErrorMsg, toast]);

  const doOpenBottle = useCallback(() => {
    if (!row) return Promise.resolve();
    if (pendingOpen?.state === "unresolved") {
      setErrorMsg("Retry the prior open-bottle action before starting another one.");
      return Promise.resolve();
    }
    const payload = { wineId: row.wine_id, preservationMethod, contractVersion };
    const fingerprint = JSON.stringify([
      "open",
      payload.contractVersion,
      payload.wineId,
      payload.preservationMethod,
    ]);
    const operationId = beginOpen(fingerprint, payload);
    return operationId
      ? runOpenCommand({ fingerprint, operationId, payload, wasUncertain: false })
      : Promise.resolve();
  }, [beginOpen, contractVersion, pendingOpen, preservationMethod, row, runOpenCommand, setErrorMsg]);

  const retryPriorOpen = useCallback(() => {
    const attempt = retryOpen();
    return attempt
      ? runOpenCommand({ ...attempt, wasUncertain: true })
      : Promise.resolve();
  }, [retryOpen, runOpenCommand]);

  const runPourCommand = useCallback(async (attempt: CommandAttempt<PourPayload>) => {
    setErrorMsg(null);
    setBusy(true);
    setLastPour(null);
    let definitive = false;
    let successful = false;

    try {
      const response = await fetch("/api/pour", {
        method: "POST",
        headers: commandHeaders(attempt.operationId),
        body: JSON.stringify({
          wine_id: attempt.payload.wineId,
          ...(attempt.payload.contractVersion === 2
            ? { open_bottle_id: attempt.payload.openBottleId }
            : {}),
          ml: attempt.payload.ml,
          kind: "pour",
          ...(attempt.payload.contractVersion === 1
            ? { preservation_method: attempt.payload.preservationMethod }
            : {}),
        }),
      });
      const payload = await readPayload(response);
      definitive = isDefinitiveCommandResponse(response, payload,
        attempt.payload.contractVersion === 2
          ? (value) => isPhysicalPourSuccess(value, attempt.payload)
          : isOpenBottleSuccess);
      if (!response.ok) {
        const errorCode = readErrorCode(payload);
        if (
          attempt.payload.contractVersion === 2 &&
          (errorCode === "open_bottle_not_found" ||
            errorCode === "already_closed" ||
            errorCode === "open_bottle_changed")
        ) {
          onBottleStale("The selected bottle is no longer available. Choose an open bottle.");
        }
        throw new Error(
          readError(payload) ?? `Request failed (${response.status}).`,
        );
      }
      if (!definitive) throw new Error("Invalid pour response.");
      successful = true;
      toast.success(
        isReplayedCommandResponse(response) ? "Already recorded" : "Glass poured",
      );
      setLastPour(attempt.payload.contractVersion === 1
        ? { contractVersion: 1, wineId: attempt.payload.wineId, ml: attempt.payload.ml }
        : {
            contractVersion: 2,
            wineId: attempt.payload.wineId,
            bottleId: attempt.payload.openBottleId!,
            eventId: readUuidField(payload, "pour_event_id")!,
            ml: attempt.payload.ml,
          });
      refresh();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Pour failed.";
      if (!definitive || attempt.wasUncertain) {
        setErrorMsg(unknownCommandOutcomeMessage(
          "Pour",
          "pour",
          definitive ? message : undefined,
        ));
      } else {
        toast.error("Pour failed");
        setErrorMsg(message);
      }
    } finally {
      finishPour(attempt.fingerprint, definitive, successful);
      setBusy(false);
    }
  }, [finishPour, onBottleStale, refresh, setBusy, setErrorMsg, setLastPour, toast]);

  const doPour = useCallback((ml: number) => {
    if (!row || !row.glass_pour_ml || (contractVersion === 2 && !selectedBottleId)) {
      return Promise.resolve();
    }
    if (pendingPour?.state === "unresolved") {
      setErrorMsg("Retry the prior pour before recording another one.");
      return Promise.resolve();
    }
    const payload = {
      wineId: row.wine_id,
      ml,
      preservationMethod,
      contractVersion,
      openBottleId: contractVersion === 2 ? selectedBottleId : null,
    };
    const fingerprint = JSON.stringify([
      "pour",
      payload.contractVersion,
      payload.wineId,
      payload.openBottleId,
      payload.ml,
      payload.preservationMethod,
    ]);
    const operationId = beginPour(fingerprint, payload);
    return operationId
      ? runPourCommand({ fingerprint, operationId, payload, wasUncertain: false })
      : Promise.resolve();
  }, [beginPour, contractVersion, pendingPour, preservationMethod, row, runPourCommand, selectedBottleId, setErrorMsg]);

  const retryPriorPour = useCallback(() => {
    const attempt = retryPour();
    return attempt
      ? runPourCommand({ ...attempt, wasUncertain: true })
      : Promise.resolve();
  }, [retryPour, runPourCommand]);

  const runUndoCommand = useCallback(async (attempt: CommandAttempt<LastPourReceipt>) => {
    setErrorMsg(null); setBusy(true);
    let definitive = false; let successful = false;
    try {
      const physical = attempt.payload.contractVersion === 2;
      const response = await fetch("/api/pour/undo", {
        method: "POST",
        headers: physical ? commandHeaders(attempt.operationId) : { "Content-Type": "application/json" },
        body: JSON.stringify(attempt.payload.contractVersion === 2 ? {
          wine_id: attempt.payload.wineId,
          open_bottle_id: attempt.payload.bottleId,
          reversal_of_event_id: attempt.payload.eventId,
        } : { wine_id: attempt.payload.wineId }),
      });
      const payload = await readPayload(response);
      definitive = isDefinitiveCommandResponse(response, payload,
        physical ? (value) => isPhysicalUndoSuccess(value, attempt.payload) : isOpenBottleSuccess);
      if (!response.ok) throw new Error(readError(payload) ?? `Undo failed (${response.status}).`);
      if (!definitive) throw new Error("Invalid Undo response.");
      successful = true; setLastPour(null);
      toast.success(isReplayedCommandResponse(response) ? "Already recorded" : "Pour undone");
      refresh();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Undo failed.";
      if (!definitive || attempt.wasUncertain) {
        setErrorMsg(unknownCommandOutcomeMessage("Undo", "undo it again", definitive ? message : undefined));
      } else { toast.error("Undo failed"); setErrorMsg(message); }
    } finally {
      finishUndo(attempt.fingerprint, definitive, successful); setBusy(false);
    }
  }, [finishUndo, refresh, setBusy, setErrorMsg, setLastPour, toast]);

  const doUndo = useCallback(() => {
    if (!lastPour || pendingUndo?.state === "unresolved") return Promise.resolve();
    const fingerprint = JSON.stringify(["undo", lastPour]);
    const operationId = beginUndo(fingerprint, lastPour);
    return operationId
      ? runUndoCommand({ fingerprint, operationId, payload: lastPour, wasUncertain: false })
      : Promise.resolve();
  }, [beginUndo, lastPour, pendingUndo, runUndoCommand]);
  const retryPriorUndo = useCallback(() => {
    const attempt = retryUndo();
    return attempt ? runUndoCommand({ ...attempt, wasUncertain: true }) : Promise.resolve();
  }, [retryUndo, runUndoCommand]);

  return {
    doOpenBottle,
    doPour,
    retryPriorOpen,
    retryPriorPour,
    doUndo,
    retryPriorUndo,
    openBottleBusy,
    openNeedsReview: pendingOpen?.state === "unresolved",
    pourNeedsReview: pendingPour?.state === "unresolved",
    undoNeedsReview: pendingUndo?.state === "unresolved",
  };
}

type CommandAttempt<TPayload> = { operationId: string; fingerprint: string;
  payload: TPayload; wasUncertain: boolean };

function commandHeaders(operationId: string) {
  return {
    "Content-Type": "application/json",
    "Idempotency-Key": operationId,
  };
}

async function readPayload(response: Response) {
  return response.json().catch(() => null) as Promise<unknown>;
}

function readError(payload: unknown) {
  const errorPayload = payload as
    | { error?: string | { message?: string } }
    | null;
  return typeof errorPayload?.error === "string"
    ? errorPayload.error
    : errorPayload?.error?.message;
}

function readErrorCode(payload: unknown) {
  const errorPayload = payload as { error?: { code?: unknown } } | null;
  return typeof errorPayload?.error?.code === "string"
    ? errorPayload.error.code
    : null;
}

function readOpenBottleId(payload: unknown) {
  const result = payload as { open_bottle?: { id?: unknown } } | null;
  return typeof result?.open_bottle?.id === "string"
    ? result.open_bottle.id
    : null;
}

function readUuidField(payload: unknown, key: string) {
  const value = (payload as Record<string, unknown> | null)?.[key];
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value) ? value : null;
}

function isPhysicalPourSuccess(payload: unknown, expected: PourPayload) {
  const bottle = (payload as { open_bottle?: Record<string, unknown> } | null)?.open_bottle;
  return isExactEnvelope(payload, ["open_bottle", "pour_event_id"]) &&
    isOpenBottleSuccess(payload) && bottle?.id === expected.openBottleId &&
    bottle.wine_id === expected.wineId && Boolean(readUuidField(payload, "pour_event_id"));
}

function isPhysicalUndoSuccess(payload: unknown, expected: LastPourReceipt) {
  if (expected.contractVersion !== 2) return false;
  const bottle = (payload as { open_bottle?: Record<string, unknown> } | null)?.open_bottle;
  const undoEventId = readUuidField(payload, "undo_event_id");
  return isExactEnvelope(payload, ["open_bottle", "undo_event_id"]) &&
    isOpenBottleSuccess(payload) && bottle?.id === expected.bottleId &&
    bottle.wine_id === expected.wineId && undoEventId !== null && undoEventId !== expected.eventId;
}
function isExactEnvelope(value: unknown, keys: string[]) {
  return Boolean(value && typeof value === "object" &&
    Object.keys(value).sort().join() === [...keys].sort().join());
}
