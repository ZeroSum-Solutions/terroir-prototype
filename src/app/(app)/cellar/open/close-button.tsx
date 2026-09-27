"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { XCircle } from "lucide-react";
import { readApiError } from "@/lib/api/client-error";
import { useToast } from "@/lib/toast";
import {
  isClosedBottleSuccess,
  isDefinitiveCommandResponse,
  isOpenBottleSuccess,
  isReplayedCommandResponse,
  unknownCommandOutcomeMessage,
  useIdempotentCommand,
} from "../use-idempotent-command";

interface Props {
  bottleId: string;
  wineId?: string;
  identityContract?: 1 | 2;
  openedAt: string;
  remainingOz: number;
}

type DiscardReceipt = { bottleId: string; wineId: string; eventId: string };

/**
 * BND-122 — "Close bottle" button for the /cellar/open page.
 *
 * Shows a two-step confirmation to prevent accidental discards.
 * First click: "Close bottle" → "Confirm discard?"
 * Second click: calls POST /api/open-bottles/[id]/close, refreshes the page.
 *
 * SD-06: a refused close used to be console.error'd and the confirm state
 * reset — the bottle stayed open, the page did not move, and nothing said
 * why. Definitive refusals now use the mutation toast; uncertain outcomes stay
 * inline so a later successful replay cannot leave contradictory feedback.
 */
export function CloseBottleButton({
  bottleId, wineId, identityContract = 1, openedAt, remainingOz,
}: Props) {
  const [confirming, setConfirming] = useState(false);
  const [uncertaintyMessage, setUncertaintyMessage] = useState<string | null>(null);
  const [discardReceipt, setDiscardReceipt] = useState<DiscardReceipt | null>(null);
  const [needsReview, setNeedsReview] = useState(false);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();
  const toast = useToast();
  const { begin, retry, finish, pending } = useIdempotentCommand<{
    bottleId: string;
    wineId?: string;
    identityContract: 1 | 2;
    openedAt: string;
  }>();
  const correction = useIdempotentCommand<DiscardReceipt>();
  const retrying = pending?.state === "unresolved";
  const correctionLocked = isPending || correction.pending !== null;

  const handleClose = () => {
    if (!confirming && !retrying) {
      setConfirming(true);
      // Auto-reset after 5 seconds if user doesn't confirm
      setTimeout(() => setConfirming(false), 5000);
      return;
    }

    const nextPayload = { bottleId, wineId, identityContract, openedAt };
    const fingerprint = JSON.stringify([
      identityContract === 2 ? "physical-discard" : "legacy-close",
      bottleId,
      identityContract === 2 ? wineId : openedAt,
    ]);
    const hadUncertainOutcome = retrying;
    const retryCommand = retrying ? retry() : null;
    const operationId = retryCommand?.operationId ?? begin(fingerprint, nextPayload);
    const command = retryCommand?.payload ?? nextPayload;
    const commandFingerprint = retryCommand?.fingerprint ?? fingerprint;
    if (!operationId) return;

    startTransition(async () => {
      setUncertaintyMessage(null);
      let definitive = false;
      let successful = false;
      try {
        const res = await fetch(`/api/open-bottles/${command.bottleId}/close`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Idempotency-Key": operationId,
          },
          body: JSON.stringify(command.identityContract === 2
            ? { wine_id: command.wineId }
            : { expected_opened_at: command.openedAt }),
        });
        const body = await res.json().catch(() => null);
        definitive = isDefinitiveCommandResponse(res, body, (value) =>
          command.identityContract === 2
            ? isPhysicalDiscardSuccess(value, command.bottleId, command.wineId)
            : isClosedBottleSuccess(value));
        if (res.ok && definitive) {
          successful = true;
          if (isReplayedCommandResponse(res)) toast.success("Already recorded");
          if (command.identityContract === 2) {
            setDiscardReceipt({
              bottleId: command.bottleId,
              wineId: command.wineId!,
              eventId: readUuidField(body, "discard_event_id")!,
            });
          } else {
            router.refresh();
          }
        } else {
          const message = res.ok
            ? "Couldn't confirm the bottle was closed. Retry the close."
            : readApiError(
              body,
              `Couldn't close the bottle (${res.status}).`,
            ).message;
          if (!definitive || hadUncertainOutcome) {
            setUncertaintyMessage(unknownCommandOutcomeMessage(
              "Discard",
              "discard",
              definitive ? message : undefined,
            ));
          } else {
            toast.error(message);
          }
          setConfirming(false);
        }
      } catch {
        setUncertaintyMessage(unknownCommandOutcomeMessage(
          "Discard",
          "discard",
        ));
        setConfirming(false);
      } finally {
        finish(commandFingerprint, definitive, successful);
      }
    });
  };

  const correctDiscard = () => {
    if (!discardReceipt) return;
    const fingerprint = JSON.stringify(["undo-discard", discardReceipt]);
    const prior = correction.pending?.state === "unresolved" ? correction.retry() : null;
    const operationId = prior?.operationId ?? correction.begin(fingerprint, discardReceipt);
    const command = prior?.payload ?? discardReceipt;
    const commandFingerprint = prior?.fingerprint ?? fingerprint;
    if (!operationId) return;
    startTransition(async () => {
      setUncertaintyMessage(null);
      let definitive = false;
      let successful = false;
      try {
        const res = await fetch("/api/pour/undo", {
          method: "POST",
          headers: { "Content-Type": "application/json", "Idempotency-Key": operationId },
          body: JSON.stringify({
            wine_id: command.wineId,
            open_bottle_id: command.bottleId,
            reversal_of_event_id: command.eventId,
            correction_reason: "mistaken_report",
            operator_confirms_same_bottle_present: true,
          }),
        });
        const body = await res.json().catch(() => null);
        definitive = isDefinitiveCommandResponse(res, body, (value) =>
          isPhysicalUndoSuccess(value, command));
        if (!res.ok || !definitive) {
          throw new Error(res.ok
            ? "Couldn't confirm the correction."
            : readApiError(body, `Correction failed (${res.status}).`).message);
        }
        successful = true;
        setDiscardReceipt(null);
        setConfirming(false);
        toast.success(isReplayedCommandResponse(res) ? "Already recorded" : "Discard corrected");
        router.refresh();
      } catch (error) {
        const message = error instanceof Error ? error.message : undefined;
        setUncertaintyMessage(unknownCommandOutcomeMessage(
          "Correction", "restore the bottle again", definitive ? message : undefined,
        ));
      } finally {
        correction.finish(commandFingerprint, definitive, successful);
      }
    });
  };

  const handleCancel = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setConfirming(false);
  };

  const guardRowAction = (event: React.MouseEvent, action: () => void) => {
    event.preventDefault();
    event.stopPropagation();
    action();
  };

  return (
    <>
      {discardReceipt && !needsReview ? (
        <div className="col-span-full grid w-full gap-xs md:grid-cols-3">
          <button type="button" aria-label="Mistaken report — same bottle is here"
            disabled={isPending} onClick={(event) => guardRowAction(event, correctDiscard)}
            className="min-h-11 rounded-pill border border-risk-ink/40 bg-risk-wash px-sm text-caption font-medium text-risk-ink">
            {correction.pending?.state === "unresolved"
              ? "Retry mistaken-discard correction"
              : "Mistaken report — same bottle is here"}
          </button>
          <button type="button" aria-label="Discard was correct"
            disabled={correctionLocked}
            onClick={(event) => guardRowAction(event, () => router.refresh())}
            className="min-h-11 rounded-pill border border-rule-strong px-sm text-caption font-medium text-ink disabled:opacity-60">
            Discard was correct
          </button>
          <button type="button" aria-label="Bottle status uncertain"
            disabled={correctionLocked}
            onClick={(event) => guardRowAction(event, () => setNeedsReview(true))}
            className="min-h-11 rounded-pill border border-rule-strong px-sm text-caption font-medium text-ink disabled:opacity-60">
            Bottle status uncertain
          </button>
        </div>
      ) : needsReview ? (
        <div className="col-span-full w-full text-left md:text-right">
          <p role="alert" className="text-body-sm text-risk-ink">
            Bottle status needs review. Do not restore or discard it again.
          </p>
          <button type="button" aria-label="Refresh bottle list"
            onClick={(event) => guardRowAction(event, () => router.refresh())}
            className="mt-xs min-h-11 rounded-pill border border-rule-strong px-sm text-caption font-medium text-ink">
            Refresh bottle list
          </button>
        </div>
      ) : (
      <div
        className={confirming
          ? "col-span-full flex w-full items-center justify-end gap-xs"
          : "flex items-center gap-xs"}
      >
        {confirming && (
          <button
            type="button"
            onClick={handleCancel}
            className="min-h-11 min-w-11 rounded-pill px-xs text-caption font-medium uppercase tracking-[0.13em] text-grey transition-colors hover:text-ink"
            aria-label="Cancel close"
          >
            Cancel
          </button>
        )}
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            handleClose();
          }}
          disabled={isPending}
          className={
            confirming
              ? "inline-flex min-h-11 min-w-11 items-center gap-xs rounded-pill border border-risk-ink/40 bg-risk-wash px-sm text-caption font-medium uppercase tracking-[0.13em] text-risk-ink transition-colors hover:bg-risk-wash/70"
              : "inline-flex min-h-11 min-w-11 items-center gap-xs rounded-pill border border-rule-strong bg-transparent px-sm text-caption font-medium uppercase tracking-[0.13em] text-ink transition-colors hover:text-risk-ink"
          }
          aria-label={confirming
            ? `Confirm discard ${remainingOz.toFixed(1)} oz`
            : retrying
              ? "Retry prior action"
              : "Close bottle"}
        >
          <XCircle className="h-3.5 w-3.5" strokeWidth={2} />
          {confirming
            ? `Discard ${remainingOz.toFixed(1)} oz?`
            : isPending
              ? "Closing..."
              : retrying
                ? "Retry prior action"
                : "Close"}
        </button>
      </div>
      )}
      {uncertaintyMessage && (
        <p
          role="alert"
          className="col-span-full w-full text-left text-body-sm text-risk-ink md:text-right"
        >
          {uncertaintyMessage}
        </p>
      )}
    </>
  );
}

function readUuidField(payload: unknown, key: string) {
  const value = (payload as Record<string, unknown> | null)?.[key];
  return typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
    ? value : null;
}

function isPhysicalDiscardSuccess(payload: unknown, bottleId: string, wineId?: string) {
  const closed = (payload as { closed?: Record<string, unknown> } | null)?.closed;
  return isExactEnvelope(payload, ["closed", "discard_event_id"]) &&
    isClosedBottleSuccess(payload) && closed?.id === bottleId &&
    closed.wine_id === wineId && Boolean(readUuidField(payload, "discard_event_id"));
}

function isPhysicalUndoSuccess(payload: unknown, receipt: DiscardReceipt) {
  const bottle = (payload as { open_bottle?: Record<string, unknown> } | null)?.open_bottle;
  const undoEventId = readUuidField(payload, "undo_event_id");
  return isExactEnvelope(payload, ["open_bottle", "undo_event_id"]) &&
    isOpenBottleSuccess(payload) && bottle?.id === receipt.bottleId &&
    bottle.wine_id === receipt.wineId && undoEventId !== null &&
    undoEventId !== receipt.eventId;
}

function isExactEnvelope(value: unknown, keys: string[]) {
  return Boolean(value && typeof value === "object" &&
    Object.keys(value).sort().join() === [...keys].sort().join());
}
