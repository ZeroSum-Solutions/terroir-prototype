"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { XCircle } from "lucide-react";
import { readApiError } from "@/lib/api/client-error";
import { useToast } from "@/lib/toast";
import {
  isClosedBottleSuccess,
  isDefinitiveCommandResponse,
  isReplayedCommandResponse,
  unknownCommandOutcomeMessage,
  useIdempotentCommand,
} from "../use-idempotent-command";

interface Props {
  bottleId: string;
  openedAt: string;
  remainingOz: number;
}

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
export function CloseBottleButton({ bottleId, openedAt, remainingOz }: Props) {
  const [confirming, setConfirming] = useState(false);
  const [uncertaintyMessage, setUncertaintyMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();
  const toast = useToast();
  const { begin, retry, finish, pending } = useIdempotentCommand<{
    bottleId: string;
    openedAt: string;
  }>();
  const retrying = pending?.state === "unresolved";

  const handleClose = () => {
    if (!confirming && !retrying) {
      setConfirming(true);
      // Auto-reset after 5 seconds if user doesn't confirm
      setTimeout(() => setConfirming(false), 5000);
      return;
    }

    const nextPayload = { bottleId, openedAt };
    const fingerprint = JSON.stringify(["legacy-close", bottleId, openedAt]);
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
          body: JSON.stringify({ expected_opened_at: command.openedAt }),
        });
        const body = await res.json().catch(() => null);
        definitive = isDefinitiveCommandResponse(
          res,
          body,
          isClosedBottleSuccess,
        );
        if (res.ok && definitive) {
          successful = true;
          if (isReplayedCommandResponse(res)) toast.success("Already recorded");
          router.refresh();
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

  const handleCancel = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setConfirming(false);
  };

  return (
    <>
      <div className="flex items-center gap-xs">
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
