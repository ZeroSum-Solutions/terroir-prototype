"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { readApiError } from "@/lib/api/client-error";
import { BottleInventorySaveReceiptSchema } from "@/lib/api/scan-idempotency-contract";
import {
  beginPendingBottleOperation,
  clearPendingBottleOperation,
  readPendingBottleOperation,
  sendPendingBottleOperation,
  type BottlePendingFailure,
  type BottlePendingOperation,
  type BottlePendingWine,
} from "./bottle-pending-operation";

export type BottleRecoveryState =
  | { phase: "checking" }
  | { phase: "empty" }
  | { phase: "ready"; operation: BottlePendingOperation }
  | { phase: "blocked"; reason: BottlePendingFailure };

type Feedback = { kind: "success" | "error"; message: string };
const CHECKING_STATE: BottleRecoveryState = { phase: "checking" };
const BOTTLE_SAVE_TIMEOUT_MS = 30_000;

export function useBottlePendingRecovery(input: {
  userId: string | null;
  restaurantId: string;
  onFeedback: (feedback: Feedback) => void;
  onSaved: (wineId: string) => void;
  onAbandoned: () => void;
}) {
  const { userId, restaurantId, onFeedback, onSaved, onAbandoned } = input;
  const contextKey = `${userId ?? "signed-out"}:${restaurantId}`;
  const [snapshot, setSnapshot] = useState<{
    contextKey: string;
    state: BottleRecoveryState;
  }>({ contextKey, state: CHECKING_STATE });
  const state = useMemo<BottleRecoveryState>(
    () => snapshot.contextKey === contextKey ? snapshot.state : CHECKING_STATE,
    [contextKey, snapshot],
  );
  const [isSaving, setIsSaving] = useState(false);
  const busyRef = useRef(false);
  const mountedRef = useRef(false);
  const latestContextRef = useRef({ userId, restaurantId, contextKey });

  useLayoutEffect(() => {
    latestContextRef.current = { userId, restaurantId, contextKey };
  }, [contextKey, restaurantId, userId]);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    let active = true;
    void readPendingBottleOperation({ userId, restaurantId }).then((result) => {
      if (!active) return;
      setSnapshot({
        contextKey,
        state: result.status === "ready"
          ? { phase: "ready", operation: result.operation }
          : result.status === "blocked"
            ? { phase: "blocked", reason: result.reason }
            : { phase: "empty" },
      });
    });
    return () => { active = false; };
  }, [contextKey, restaurantId, userId]);

  const run = useCallback(async (operation: BottlePendingOperation) => {
    try {
      const sent = await sendPendingBottleOperation(
        operation,
        () => mountedRef.current ? latestContextRef.current : null,
        async (lockedOperation) => {
          const controller = new AbortController();
          const timeoutId = window.setTimeout(
            () => controller.abort(),
            BOTTLE_SAVE_TIMEOUT_MS,
          );
          try {
            const response = await fetch("/api/inventory/save-bottle-scan", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "Idempotency-Key": lockedOperation.operationId,
                "X-Expected-User-Id": lockedOperation.userId,
                "X-Expected-Restaurant-Id": lockedOperation.restaurantId,
              },
              body: JSON.stringify(lockedOperation.payload),
              signal: controller.signal,
            });
            if (!response.ok) {
              throw new Error(readApiError(
                await response.json().catch(() => null),
                `Save failed (${response.status})`,
              ).message);
            }
            const receipt = BottleInventorySaveReceiptSchema.safeParse(
              await response.json().catch(() => null),
            );
            if (!receipt.success) {
              throw new Error("Save outcome is uncertain. Keep this recovery and check inventory before retrying.");
            }
            return receipt.data;
          } finally {
            window.clearTimeout(timeoutId);
          }
        },
      );
      if (!sent.ok) {
        if ("error" in sent) throw sent.error;
        if (mountedRef.current) {
          const latest = latestContextRef.current;
          setSnapshot({
            contextKey: latest.contextKey,
            state: { phase: "blocked", reason: sent.reason },
          });
          onFeedback({ kind: "error", message: failureMessage(sent.reason) });
        }
        return;
      }
      const cleared = await clearPendingBottleOperation({
        userId: operation.userId,
        restaurantId: operation.restaurantId,
        operationId: operation.operationId,
      });
      if (!cleared.ok) {
        if (mountedRef.current) {
          onFeedback({
            kind: "error",
            message: "Bottle saved, but retry recovery could not be cleared. Do not start another bottle save.",
          });
        }
        return;
      }
      const latest = latestContextRef.current;
      if (
        mountedRef.current &&
        latest.userId === operation.userId &&
        latest.restaurantId === operation.restaurantId
      ) {
        setSnapshot({ contextKey: latest.contextKey, state: { phase: "empty" } });
        onSaved(sent.value.wineId);
      }
    } catch (error) {
      if (mountedRef.current) {
        onFeedback({
          kind: "error",
          message: error instanceof Error ? error.message : "Save failed.",
        });
      }
    }
  }, [onFeedback, onSaved]);

  const save = useCallback(async (wine: BottlePendingWine) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setIsSaving(true);
    try {
      const prepared = await beginPendingBottleOperation({ userId, restaurantId, wine });
      if (!prepared.ok) {
        if (mountedRef.current && prepared.reason !== "invalid_payload") {
          setSnapshot({
            contextKey,
            state: { phase: "blocked", reason: prepared.reason },
          });
        }
        if (mountedRef.current) {
          onFeedback({ kind: "error", message: failureMessage(prepared.reason) });
        }
        return;
      }
      if (mountedRef.current) {
        setSnapshot({ contextKey, state: { phase: "ready", operation: prepared.value } });
      }
      await run(prepared.value);
    } finally {
      busyRef.current = false;
      if (mountedRef.current) setIsSaving(false);
    }
  }, [contextKey, onFeedback, restaurantId, run, userId]);

  const retry = useCallback(async () => {
    if (state.phase !== "ready" || busyRef.current) return;
    busyRef.current = true;
    setIsSaving(true);
    try {
      await run(state.operation);
    } finally {
      busyRef.current = false;
      if (mountedRef.current) setIsSaving(false);
    }
  }, [run, state]);

  const abandon = useCallback(async () => {
    if (state.phase !== "ready" || busyRef.current) return;
    busyRef.current = true;
    setIsSaving(true);
    try {
      const cleared = await clearPendingBottleOperation({
        userId: state.operation.userId,
        restaurantId: state.operation.restaurantId,
        operationId: state.operation.operationId,
      });
      if (!cleared.ok) {
        onFeedback({ kind: "error", message: failureMessage(cleared.reason) });
        return;
      }
      setSnapshot({ contextKey, state: { phase: "empty" } });
      onAbandoned();
    } finally {
      busyRef.current = false;
      if (mountedRef.current) setIsSaving(false);
    }
  }, [contextKey, onAbandoned, onFeedback, state]);

  return { state, isSaving, save, retry, abandon };
}

function failureMessage(reason: BottlePendingFailure): string {
  switch (reason) {
    case "collision":
      return "Another bottle save is already pending in this browser. Reload to recover it before starting a new save.";
    case "context_mismatch":
      return "Bottle recovery belongs to a different signed-in user or restaurant. Switch back to that context to continue.";
    case "corrupt":
      return "Stored bottle recovery could not be verified. No new bottle save was sent.";
    case "invalid_payload":
      return "These bottle details cannot be safely saved. Check the fields and try again.";
    case "unavailable":
      return "Secure bottle recovery is unavailable in this browser. No bottle save was sent.";
  }
}
