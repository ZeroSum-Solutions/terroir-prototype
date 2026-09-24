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

export function useInventoryCommands(input: {
  row: CellarWineRow | null;
  contractVersion: 1 | 2;
  selectedBottleId: string | null;
  preservationMethod: PreservationMethod;
  setBusy: Dispatch<SetStateAction<boolean>>;
  setErrorMsg: Dispatch<SetStateAction<string | null>>;
  setLastPour: Dispatch<SetStateAction<{ ml: number } | null>>;
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
    row,
    contractVersion,
    selectedBottleId,
    preservationMethod,
    setBusy,
    setErrorMsg,
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
      definitive = isDefinitiveCommandResponse(
        response,
        payload,
        isOpenBottleSuccess,
      );
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
        ? { ml: attempt.payload.ml }
        : null);
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

  return {
    doOpenBottle,
    doPour,
    retryPriorOpen,
    retryPriorPour,
    openBottleBusy,
    openNeedsReview: pendingOpen?.state === "unresolved",
    pourNeedsReview: pendingPour?.state === "unresolved",
  };
}

type CommandAttempt<TPayload> = {
  operationId: string;
  fingerprint: string;
  payload: TPayload;
  wasUncertain: boolean;
};

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
