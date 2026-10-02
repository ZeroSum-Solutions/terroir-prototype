"use client";

import { useEffect, useRef, useState } from "react";
import {
  AcceptReconcileReceiptSchema,
  UndoReconcileReceiptSchema,
  type ReconcileAction,
} from "@/lib/reconcile-ledger";
import type { QueueResponse } from "./types";

type PendingAccept = {
  key: string;
  userId: string;
  restaurantId: string;
  canonicalActions: ReconcileAction[];
  canonicalBody: string;
};

export function useReconcileMutations(input: {
  userId: string;
  restaurantId: string;
  reload: () => Promise<void>;
  onAccepted: () => void;
}) {
  const { userId, restaurantId, reload, onAccepted } = input;
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pendingAccept = useRef<PendingAccept | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const accept = async (actions: ReconcileAction[]) => {
    const canonicalBody = JSON.stringify(actions);
    let pending = pendingAccept.current;
    if (
      !pending ||
      pending.userId !== userId ||
      pending.restaurantId !== restaurantId ||
      pending.canonicalBody !== canonicalBody
    ) {
      pending = {
        key: crypto.randomUUID(),
        userId,
        restaurantId,
        canonicalActions: actions,
        canonicalBody,
      };
      pendingAccept.current = pending;
    }

    start();
    try {
      const response = await fetch("/api/reconcile-queue/accept", {
        method: "POST",
        headers: mutationHeaders(pending, true),
        body: JSON.stringify(pending.canonicalActions),
      });
      if (!response.ok) throw new Error(await responseMessage(response));
      const receipt = AcceptReconcileReceiptSchema.safeParse(
        await response.json().catch(() => null),
      );
      if (
        !receipt.success ||
        receipt.data.batchId !== pending.key ||
        receipt.data.actionCount !== pending.canonicalActions.length
      ) {
        throw new Error(
          "Accept outcome is uncertain. Retry the same selection before changing it.",
        );
      }
      if (!mounted.current) return;
      pendingAccept.current = null;
      setMessage(
        `${receipt.data.actionCount} item${receipt.data.actionCount === 1 ? "" : "s"} accepted`,
      );
      onAccepted();
      await reload();
    } catch (failure) {
      fail(failure);
    } finally {
      finish();
    }
  };

  const undo = async (batch: NonNullable<QueueResponse["latest_batch"]>) => {
    start();
    try {
      const response = await fetch("/api/reconcile-queue/undo", {
        method: "POST",
        headers: mutationHeaders({ userId, restaurantId }, false),
        body: JSON.stringify({ batch_id: batch.id }),
      });
      if (!response.ok) throw new Error(await responseMessage(response));
      const receipt = UndoReconcileReceiptSchema.safeParse(
        await response.json().catch(() => null),
      );
      if (
        !receipt.success ||
        receipt.data.batchId !== batch.id ||
        receipt.data.actionCount !== batch.action_count
      ) {
        throw new Error(
          "Undo outcome is uncertain. Refresh the queue before trying again.",
        );
      }
      if (!mounted.current) return;
      setMessage("Latest batch undone");
      await reload();
    } catch (failure) {
      fail(failure);
    } finally {
      finish();
    }
  };

  function start() {
    setBusy(true);
    setError(null);
    setMessage(null);
  }

  function fail(failure: unknown) {
    if (mounted.current) {
      setError(failure instanceof Error ? failure.message : "Request failed.");
    }
  }

  function finish() {
    if (mounted.current) setBusy(false);
  }

  return { accept, undo, busy, message, error };
}

function mutationHeaders(
  context: { userId: string; restaurantId: string; key?: string },
  idempotent: boolean,
) {
  return {
    "Content-Type": "application/json",
    ...(idempotent && context.key ? { "Idempotency-Key": context.key } : {}),
    "X-Expected-User-Id": context.userId,
    "X-Expected-Restaurant-Id": context.restaurantId,
  };
}

async function responseMessage(response: Response): Promise<string> {
  const payload = await response.json().catch(() => null) as {
    error?: { message?: string } | string;
  } | null;
  if (typeof payload?.error === "string") return payload.error;
  return payload?.error?.message ?? `Request failed (${response.status}).`;
}
