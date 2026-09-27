"use client";

import { AlertTriangle, RefreshCw, Trash2 } from "lucide-react";
import { useState } from "react";
import type { BottleRecoveryState } from "@/domains/scanning/use-bottle-pending-recovery";

export function BottleRecoveryView({
  state,
  isSaving,
  onRetry,
  onAbandon,
}: {
  state: Exclude<BottleRecoveryState, { phase: "empty" }>;
  isSaving: boolean;
  onRetry: () => void;
  onAbandon: () => void;
}) {
  const [confirmingAbandon, setConfirmingAbandon] = useState(false);
  const ready = state.phase === "ready";

  return (
    <section className="mx-auto max-w-[620px]">
      <div className="glass rounded-card p-md md:p-lg" role={ready ? "status" : "alert"}>
        <div className="flex items-start gap-sm">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-risk-ink" strokeWidth={1.9} aria-hidden="true" />
          <div>
            <h1 className="font-serif text-heading font-normal leading-tight text-ink">
              {ready ? "Bottle save needs recovery" : "Bottle recovery unavailable"}
            </h1>
            <p className="mt-xs text-body text-ink-soft">
              {ready
                ? "A prior save did not reach a certain client outcome. Retry sends the same operation and exact saved details."
                : blockedMessage(state)}
            </p>
          </div>
        </div>

        {ready && !confirmingAbandon && (
          <div className="mt-lg grid gap-sm sm:grid-cols-2">
            <button
              type="button"
              onClick={onRetry}
              disabled={isSaving}
              className="flex h-12 items-center justify-center gap-sm rounded-pill bg-primary px-md text-control font-semibold text-seal-ink transition-colors hover:bg-primary-hover focus-ring disabled:opacity-50"
            >
              <RefreshCw className="h-4 w-4" strokeWidth={1.9} aria-hidden="true" />
              {isSaving ? "Retrying..." : "Retry pending save"}
            </button>
            <button
              type="button"
              onClick={() => setConfirmingAbandon(true)}
              disabled={isSaving}
              className="flex h-12 items-center justify-center gap-sm rounded-pill border border-risk-ink/50 px-md text-control font-medium text-risk-ink focus-ring disabled:opacity-50"
            >
              <Trash2 className="h-4 w-4" strokeWidth={1.9} aria-hidden="true" />
              Abandon retry
            </button>
          </div>
        )}

        {ready && confirmingAbandon && (
          <div className="mt-lg rounded-card border border-risk-ink/40 bg-risk-wash p-md">
            <p className="text-body-sm font-medium text-risk-ink">
              The server may already have committed this bottle. Abandoning removes only this browser&rsquo;s retry data; it does not undo inventory.
            </p>
            <div className="mt-md flex flex-wrap gap-sm">
              <button
                type="button"
                onClick={() => setConfirmingAbandon(false)}
                className="h-11 rounded-pill border border-rule-strong px-md text-control font-medium text-ink focus-ring"
              >
                Keep recovery
              </button>
              <button
                type="button"
                onClick={onAbandon}
                disabled={isSaving}
                className="h-11 rounded-pill bg-risk-ink px-md text-control font-semibold text-canvas focus-ring disabled:opacity-50"
              >
                {isSaving ? "Abandoning..." : "Abandon recovery data"}
              </button>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

function blockedMessage(state: Exclude<BottleRecoveryState, { phase: "empty" | "ready" }>) {
  if (state.phase === "checking") return "Checking this browser for a pending bottle save.";
  if (state.reason === "context_mismatch") {
    return "A pending bottle save belongs to another signed-in user or restaurant. Switch back to that exact context to recover it.";
  }
  if (state.reason === "unavailable") {
    return "This browser cannot safely lock durable recovery storage, so no new bottle save can start.";
  }
  return "The stored recovery record cannot be verified. It was preserved and no new bottle save can start.";
}
