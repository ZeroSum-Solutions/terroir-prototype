"use client";

import type { BottleLocationRecoveryState } from "@/domains/scanning/use-bottle-location-receive";

export function ReceivingRecoveryView({ state, message, saving, onRetry, onRecheck }: {
  state: BottleLocationRecoveryState;
  message: string | null;
  saving: boolean;
  onRetry: () => void;
  onRecheck: () => void;
}) {
  return <section className="space-y-md rounded-card card-surface p-md md:p-lg" aria-busy={saving || state.phase === "checking"}>
    <h2 className="font-serif text-heading-sm text-ink">{saving ? "Confirming bottle receipt" : state.phase === "checking" ? "Checking pending receipts" : "Finish the pending bottle"}</h2>
    <p role={state.phase === "blocked" ? "alert" : "status"} className="text-body-sm text-ink-soft">
      {message ?? (state.phase === "checking" ? "Checking this browser before receiving another bottle."
        : "A bottle receipt is pending. Check its saved result before receiving another bottle; retrying uses the same receipt and cannot add a second bottle.")}
    </p>
    {state.phase === "ready" && <button type="button" disabled={saving} onClick={onRetry}
      className="min-h-12 w-full rounded-pill bg-primary px-md text-control font-semibold text-seal-ink focus-ring disabled:opacity-50">
      {saving ? "Checking receipt…" : "Retry pending receipt"}
    </button>}
    {state.phase === "blocked" && <button type="button" disabled={saving} onClick={onRecheck}
      className="min-h-12 w-full rounded-pill border border-rule-strong px-md text-control text-ink focus-ring disabled:opacity-50">Check recovery again</button>}
    <p className="text-body-sm text-grey">Keep this bottle aside until its receipt is confirmed. Do not submit it as a new bottle in another browser.</p>
  </section>;
}
