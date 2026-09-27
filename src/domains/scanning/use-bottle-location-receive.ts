"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { BottleLocationReceiveReceipt } from "@/lib/api/bottle-location-receive-contract";
import {
  beginBottleLocationReceive, readBottleLocationReceive, sendBottleLocationReceive,
  type BottleLocationContext, type BottleLocationFailure, type BottleLocationOperation,
  type BottleLocationPayload, type BottleLocationSendResult,
} from "./bottle-location-pending-operation";

export type BottleLocationRecoveryState =
  | { phase: "checking" }
  | { phase: "empty" }
  | { phase: "ready"; operation: BottleLocationOperation }
  | { phase: "blocked"; reason: BottleLocationFailure };
const CHECKING: BottleLocationRecoveryState = { phase: "checking" };
const TIMEOUT_MS = 30_000;

export function useBottleLocationReceive(input: BottleLocationContext & {
  onCommitted: (receipt: BottleLocationReceiveReceipt) => void;
  onReselect: (intent: Pick<BottleLocationPayload, "wine_id" | "section">) => void;
  onWineReselect: (section: string) => void;
  onRecoveryCleared: () => void;
}) {
  const { userId, restaurantId, onCommitted, onReselect, onWineReselect, onRecoveryCleared } = input;
  const contextKey = `${userId ?? "signed-out"}:${restaurantId}`;
  const [snapshot, setSnapshot] = useState<{ key: string; state: BottleLocationRecoveryState; message: string | null }>(
    { key: contextKey, state: CHECKING, message: null },
  );
  const [isSaving, setIsSaving] = useState(false);
  const mounted = useRef(false);
  const busy = useRef(false);
  const latest = useRef({ userId, restaurantId, contextKey, onRecoveryCleared });
  const recoverySnapshot = useRef(snapshot);
  const state = snapshot.key === contextKey ? snapshot.state : CHECKING;

  useLayoutEffect(() => {
    latest.current = { userId, restaurantId, contextKey, onRecoveryCleared };
    recoverySnapshot.current = snapshot;
  }, [userId, restaurantId, contextKey, onRecoveryCleared, snapshot]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  const recheck = useCallback(async () => {
    const result = await readBottleLocationReceive({ userId, restaurantId });
    if (!mounted.current || latest.current.contextKey !== contextKey) return;
    const previous = recoverySnapshot.current;
    if (result.status === "empty" && previous.key === contextKey &&
      (previous.state.phase === "ready" || previous.state.phase === "blocked")) {
      latest.current.onRecoveryCleared();
    }
    const retainedRefusal = previous.key === contextKey && previous.state.phase === "blocked" &&
      ["forbidden", "context_mismatch", "operation_conflict"].includes(previous.state.reason);
    if (result.status === "ready" && retainedRefusal && previous.state.phase === "blocked" &&
      previous.state.reason === "operation_conflict") return;
    const message = result.status === "ready" && retainedRefusal && previous.state.phase === "blocked"
      ? failureMessage(previous.state.reason) : null;
    setSnapshot({ key: contextKey, message, state: result.status === "ready"
      ? { phase: "ready", operation: result.operation }
      : result.status === "blocked" ? { phase: "blocked", reason: result.reason } : { phase: "empty" } });
  }, [contextKey, restaurantId, userId]);

  useEffect(() => { void recheck(); }, [recheck]);

  const run = useCallback(async (operation: BottleLocationOperation) => {
    let timer: number | undefined;
    let result: BottleLocationSendResult;
    try {
      result = await sendBottleLocationReceive(operation, () => mounted.current
      ? { userId: latest.current.userId, restaurantId: latest.current.restaurantId } : null,
    async (lockedOperation) => {
      const controller = new AbortController();
      timer = window.setTimeout(() => controller.abort(), TIMEOUT_MS);
      return await fetch("/api/scan-bottle/confirm", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Idempotency-Key": lockedOperation.operationId,
            "X-Expected-User-Id": lockedOperation.userId,
            "X-Expected-Restaurant-Id": lockedOperation.restaurantId,
          },
          body: JSON.stringify(lockedOperation.payload), signal: controller.signal,
      });
      }, undefined, (resolved) => {
        setSnapshot({ key: contextKey, state: { phase: "empty" }, message: null });
        if (resolved.status === "committed") onCommitted(resolved.receipt);
        else if (resolved.status === "reselect") onReselect(resolved.intent);
        else onWineReselect(resolved.section);
      });
    } finally {
      if (timer !== undefined) window.clearTimeout(timer);
    }
    if (!mounted.current || latest.current.contextKey !== contextKey) return;
    if (result.status === "committed" || result.status === "reselect" || result.status === "reselect_wine") {
      return;
    } else if (result.status === "blocked") {
      setSnapshot({ key: contextKey, state: { phase: "blocked", reason: result.reason }, message: failureMessage(result.reason) });
    } else {
      setSnapshot({ key: contextKey, state: { phase: "ready", operation: { ...operation, sendState: "attempted" } },
        message: "Receipt not confirmed. Retry this same bottle to check its saved result. Do not receive it again as a new bottle." });
    }
  }, [contextKey, onCommitted, onReselect, onWineReselect]);

  const save = useCallback(async (payload: BottleLocationPayload) => {
    if (busy.current || state.phase !== "empty") return;
    busy.current = true;
    setIsSaving(true);
    try {
      const prepared = await beginBottleLocationReceive({ userId, restaurantId }, payload);
      if (!mounted.current || latest.current.contextKey !== contextKey) return;
      if (!prepared.ok) {
        setSnapshot({ key: contextKey, message: failureMessage(prepared.reason),
          state: prepared.reason === "invalid_payload" ? { phase: "empty" } : { phase: "blocked", reason: prepared.reason } });
        return;
      }
      setSnapshot({ key: contextKey, message: null, state: { phase: "ready", operation: prepared.operation } });
      await run(prepared.operation);
    } finally {
      busy.current = false;
      if (mounted.current) setIsSaving(false);
    }
  }, [contextKey, restaurantId, run, state.phase, userId]);

  const retry = useCallback(async () => {
    if (busy.current || state.phase !== "ready") return;
    busy.current = true;
    setIsSaving(true);
    try { await run(state.operation); } finally {
      busy.current = false;
      if (mounted.current) setIsSaving(false);
    }
  }, [run, state]);

  return { state, isSaving, save, retry, recheck,
    message: snapshot.key === contextKey
      ? snapshot.message ?? (state.phase === "blocked" ? failureMessage(state.reason) : null) : null };
}

function failureMessage(reason: BottleLocationFailure): string {
  switch (reason) {
    case "context_mismatch": return "Return to the user and restaurant that started this bottle receipt. No new request was sent.";
    case "collision": return "Another bottle receipt is pending in this browser. Check recovery before continuing.";
    case "corrupt": return "Stored bottle recovery could not be verified. No new bottle receipt was sent.";
    case "invalid_payload": return "Check the wine and section, then select an active bin.";
    case "unavailable": return "This browser cannot safely receive bottles right now. Check browser storage and support, then try again. Keep any unconfirmed bottle aside.";
    case "resolved_elsewhere": return "This receipt is no longer pending in this browser. Check the other tab and inventory before receiving this bottle again.";
    case "forbidden": return "Your access could not be verified. Sign in with the original account and ask a manager to check your restaurant access. This receipt is retained.";
    case "operation_conflict": return "The saved receipt does not match this request. Keep the bottle aside and ask a manager to check its inventory history. Do not receive it again.";
  }
}
