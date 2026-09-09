"use client";

export default function ReconciliationQueueError({ reset }: { error: Error; reset: () => void }) {
  return (
    <section role="alert" className="rounded-card border border-risk-ink/30 bg-risk-wash p-md text-body-sm text-risk-ink">
      <p>Reconciliation queue could not be loaded.</p>
      <button type="button" onClick={reset} className="mt-sm h-11 rounded-pill border border-rule-strong bg-transparent px-md font-medium hover:bg-wash focus-ring">Try again</button>
    </section>
  );
}
