"use client";

import { useRef } from "react";
import { useFocusTrap } from "@/lib/hooks/use-focus-trap";

export function CreateListModal({
  newName,
  setNewName,
  newDescription,
  setNewDescription,
  creating,
  error,
  onClose,
  onCreate,
}: {
  newName: string;
  setNewName: (v: string) => void;
  newDescription: string;
  setNewDescription: (v: string) => void;
  creating: boolean;
  error: string | null;
  onClose: () => void;
  onCreate: () => void;
}) {
  const trapRef = useRef<HTMLDivElement>(null);
  useFocusTrap({ containerRef: trapRef, onEscape: onClose });

  return (
    // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-noninteractive-element-interactions -- backdrop-click-to-dismiss is a mouse-only convenience; this dialog already has full keyboard access via useFocusTrap (Escape + a visible Close button).
    <div
      className="fixed inset-0 z-[var(--z-dialog)] flex items-end justify-center bg-scrim p-md sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="new-wine-list-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={trapRef}
        className="glass w-full rounded-t-card p-lg pb-[calc(var(--safe-bottom)+var(--spacing-lg))] sm:max-w-[400px] sm:rounded-card sm:pb-lg"
      >
        <h2
          id="new-wine-list-title"
          className="font-serif text-subheading font-normal leading-tight text-ink"
        >
          New wine list
        </h2>
        <p className="mt-xs text-body-sm text-ink-soft">
          Default sections will be created. You can rename or add more later.
        </p>
        <input
          autoFocus
          type="text"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") onCreate();
          }}
          placeholder="Spring 2026 Wine List…"
          className="mt-lg min-h-11 h-[52px] w-full rounded-pill border border-rule-strong bg-surface-sunken px-md text-control text-ink placeholder:text-grey focus-visible:border-accent focus-ring"
        />
        <textarea
          value={newDescription}
          onChange={(e) => setNewDescription(e.target.value)}
          placeholder="Description (optional)"
          rows={3}
          className="mt-sm w-full resize-none rounded-md border border-rule-strong bg-surface-sunken px-sm py-xs text-control text-ink placeholder:text-grey focus-visible:border-accent focus-ring"
        />
        {error && (
          <p
            role="alert"
            className="mt-sm rounded-card border border-risk-ink/30 bg-risk-wash px-sm py-xs text-body-sm text-risk-ink"
          >
            {error}
          </p>
        )}
        <div className="mt-lg flex flex-col-reverse gap-sm sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={onClose}
            className="min-h-11 rounded-pill border border-rule-strong bg-transparent px-lg text-control font-medium text-ink transition-colors hover:border-accent hover:text-accent focus-ring"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onCreate}
            disabled={creating}
            className="min-h-11 rounded-pill bg-primary px-lg text-control font-semibold text-seal-ink transition-colors hover:bg-primary-hover focus-ring disabled:opacity-60"
          >
            {creating ? "Creating..." : "Create"}
          </button>
        </div>
      </div>
    </div>
  );
}
