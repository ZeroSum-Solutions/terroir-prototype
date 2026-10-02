import type { RetainedReconciliationSnapshot } from "@/lib/reconcile-draft/retained-reconciliation-storage";

export function RetainedReconciliationPanel({
  records,
  current,
  retentionBlocked,
  confirming,
  handoffPending,
  busy,
  onRetryRetention,
  onRequestFresh,
  onCancelFresh,
  onConfirmFresh,
  onReloadFresh,
}: {
  records: RetainedReconciliationSnapshot[];
  current: RetainedReconciliationSnapshot | null;
  retentionBlocked: boolean;
  confirming: boolean;
  handoffPending: boolean;
  busy: boolean;
  onRetryRetention: () => void;
  onRequestFresh: () => void;
  onCancelFresh: () => void;
  onConfirmFresh: () => void;
  onReloadFresh: () => void;
}) {
  return (
    <div className="mb-lg space-y-sm">
      {(current || retentionBlocked || handoffPending) && (
        <section className="rounded-card border border-rule-strong bg-surface px-md py-md text-body-sm text-ink">
          <h2 className="text-control font-semibold">Previous count not applied</h2>
          <p className="mt-xs text-grey">
            Bottle states changed before this count could be applied. Keep its retained copy before starting a separate count.
          </p>
          {retentionBlocked && (
            <div className="mt-sm">
              <p className="text-risk-ink">
                Browser storage could not verify the retained copy. The prior count stays frozen; a fresh count is unavailable.
              </p>
              <button type="button" onClick={onRetryRetention} disabled={busy}
                className="mt-sm min-h-11 rounded-pill border border-edge px-md text-control font-semibold text-ink focus-ring disabled:text-grey">
                Retry Saving Retained Copy
              </button>
            </div>
          )}
          {current && !confirming && !handoffPending && (
            <button type="button" onClick={onRequestFresh} disabled={busy}
              className="mt-sm min-h-11 rounded-pill bg-primary px-md text-control font-semibold text-seal-ink transition-colors hover:bg-primary-hover focus-ring disabled:bg-wash disabled:text-grey">
              Start a Fresh Count
            </button>
          )}
          {current && confirming && !handoffPending && (
            <div className="mt-sm border-t border-rule pt-sm">
              <p>
                Start with newly loaded bottle versions and no measurements. The previous count remains read-only in this tab.
              </p>
              <div className="mt-sm flex flex-wrap gap-sm">
                <button type="button" onClick={onConfirmFresh} disabled={busy}
                  className="min-h-11 rounded-pill bg-primary px-md text-control font-semibold text-seal-ink transition-colors hover:bg-primary-hover focus-ring disabled:bg-wash disabled:text-grey">
                  Retain &amp; Start Fresh
                </button>
                <button type="button" onClick={onCancelFresh} disabled={busy}
                  className="min-h-11 rounded-pill border border-edge px-md text-control font-semibold text-ink focus-ring disabled:text-grey">
                  Cancel
                </button>
              </div>
            </div>
          )}
          {handoffPending && (
            <div className="mt-sm">
              <p className="text-grey">Reload the reconciliation page before entering a new count.</p>
              <button type="button" onClick={onReloadFresh} disabled={busy}
                className="mt-sm min-h-11 rounded-pill bg-primary px-md text-control font-semibold text-seal-ink transition-colors hover:bg-primary-hover focus-ring disabled:bg-wash disabled:text-grey">
                Reload Fresh Count
              </button>
            </div>
          )}
        </section>
      )}

      {(records.length > 0 || current || retentionBlocked || handoffPending) && (
        <p className="text-ledger text-grey">
          Session only: retained copies last in this browser tab, not across devices or after the tab closes. They are not server audit records.
        </p>
      )}

      {records.map((record) => {
        const draft = record.failedDraft;
        const operation = draft.draft.frozenOperation!;
        return (
          <details key={record.record.operationId}
            className="min-w-0 rounded-card border border-rule bg-surface-sunken px-md py-sm text-body-sm text-ink">
            <summary className="flex min-h-11 cursor-pointer items-center text-control font-semibold focus-ring">
              Previous count not applied · {formatTime(record.record.outcome.observedAt)}
            </summary>
            <div className="min-w-0 space-y-sm border-t border-rule pt-sm">
              <Evidence label="Operation UUID" value={operation.operationId} />
              <Evidence label="Original saved time" value={formatTime(draft.savedAt)} />
              <ul className="space-y-xs">
                {Object.entries(draft.draft.entries).map(([bottleId, entry]) => (
                  <li key={bottleId} className="min-w-0 rounded-sm border border-rule bg-surface px-sm py-xs">
                    <Evidence label="Bottle UUID" value={bottleId} />
                    <p className="mt-2xs break-words text-ledger text-grey">
                      Version {entry.expectedStateVersion} · {entry.targetRemainingMl} ml · Note: {entry.note ?? "None"}
                    </p>
                  </li>
                ))}
              </ul>
              <Evidence label="Canonical payload" value={operation.payload} pre />
            </div>
          </details>
        );
      })}
    </div>
  );
}

function Evidence({ label, value, pre = false }: { label: string; value: string; pre?: boolean }) {
  return (
    <div>
      <p className="text-ledger font-medium text-grey">{label}</p>
      {pre ? (
        <pre className="mt-2xs whitespace-pre-wrap break-all font-sans text-ledger text-ink">{value}</pre>
      ) : (
        <p className="mt-2xs break-all text-ledger text-ink">{value}</p>
      )}
    </div>
  );
}

function formatTime(value: number): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit",
  }).format(new Date(value));
}
