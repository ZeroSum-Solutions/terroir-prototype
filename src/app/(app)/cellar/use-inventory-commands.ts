"use client";

import { useCallback, type Dispatch, type SetStateAction } from "react";
import type { PreservationMethod } from "@/lib/partial-bottles/math";
import type { CellarWineRow } from "./types";
import { useAsyncAction } from "./use-async-action";
import {
  isOpenBottleSuccess,
  isDefinitiveCommandResponse,
  isReplayedCommandResponse,
  useIdempotentCommand,
} from "./use-idempotent-command";

type Toast = {
  success(message: string): void;
  error(message: string): void;
};

type OpenPayload = {
  wineId: string;
  preservationMethod: PreservationMethod;
};

type PourPayload = OpenPayload & { ml: number };

export function useInventoryCommands(input: {
  row: CellarWineRow | null;
  preservationMethod: PreservationMethod;
  setBusy: Dispatch<SetStateAction<boolean>>;
  setErrorMsg: Dispatch<SetStateAction<string | null>>;
  setLastPour: Dispatch<SetStateAction<{ ml: number } | null>>;
  toast: Toast;
  refresh: () => void;
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
    preservationMethod,
    setBusy,
    setErrorMsg,
    setLastPour,
    toast,
    refresh,
  } = input;

  const runOpenCommand = useCallback((attempt: CommandAttempt<OpenPayload>) => {
    setErrorMsg(null);
    return runOpen(
      async () => {
        let definitive = false;
        let successful = false;
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
          successful = true;
          toast.success(
            isReplayedCommandResponse(response)
              ? "Already recorded"
              : "Bottle opened",
          );
          refresh();
        } finally {
          finishOpen(attempt.fingerprint, definitive, successful);
        }
      },
      {
        fallbackMessage: "Failed to open bottle.",
        onError: (message) => {
          toast.error("Open bottle failed");
          setErrorMsg(message);
        },
      },
    );
  }, [finishOpen, refresh, runOpen, setErrorMsg, toast]);

  const doOpenBottle = useCallback(() => {
    if (!row) return Promise.resolve();
    if (pendingOpen?.state === "unresolved") {
      setErrorMsg("Retry the prior open-bottle action before starting another one.");
      return Promise.resolve();
    }
    const payload = { wineId: row.wine_id, preservationMethod };
    const fingerprint = JSON.stringify(["open", payload.wineId, payload.preservationMethod]);
    const operationId = beginOpen(fingerprint, payload);
    return operationId
      ? runOpenCommand({ fingerprint, operationId, payload })
      : Promise.resolve();
  }, [beginOpen, pendingOpen, preservationMethod, row, runOpenCommand, setErrorMsg]);

  const retryPriorOpen = useCallback(() => {
    const attempt = retryOpen();
    return attempt ? runOpenCommand(attempt) : Promise.resolve();
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
          ml: attempt.payload.ml,
          kind: "pour",
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
          readError(payload) ?? `Request failed (${response.status}).`,
        );
      }
      if (!definitive) throw new Error("Invalid pour response.");
      successful = true;
      toast.success(
        isReplayedCommandResponse(response) ? "Already recorded" : "Glass poured",
      );
      setLastPour({ ml: attempt.payload.ml });
      refresh();
    } catch (error) {
      toast.error("Pour failed");
      setErrorMsg(error instanceof Error ? error.message : "Pour failed.");
    } finally {
      finishPour(attempt.fingerprint, definitive, successful);
      setBusy(false);
    }
  }, [finishPour, refresh, setBusy, setErrorMsg, setLastPour, toast]);

  const doPour = useCallback((ml: number) => {
    if (!row || !row.glass_pour_ml) return Promise.resolve();
    if (pendingPour?.state === "unresolved") {
      setErrorMsg("Retry the prior pour before recording another one.");
      return Promise.resolve();
    }
    const payload = { wineId: row.wine_id, ml, preservationMethod };
    const fingerprint = JSON.stringify([
      "pour",
      payload.wineId,
      payload.ml,
      payload.preservationMethod,
    ]);
    const operationId = beginPour(fingerprint, payload);
    return operationId
      ? runPourCommand({ fingerprint, operationId, payload })
      : Promise.resolve();
  }, [beginPour, pendingPour, preservationMethod, row, runPourCommand, setErrorMsg]);

  const retryPriorPour = useCallback(() => {
    const attempt = retryPour();
    return attempt ? runPourCommand(attempt) : Promise.resolve();
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
