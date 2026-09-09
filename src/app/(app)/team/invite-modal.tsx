"use client";

import { useRef } from "react";
import { Check, Copy, Loader2 } from "lucide-react";
import { useFocusTrap } from "@/lib/hooks/use-focus-trap";
import { ROLE_DESCRIPTIONS } from "@/lib/team/member-identities";

export function InviteModal({
  inviteEmail,
  setInviteEmail,
  inviteRole,
  setInviteRole,
  inviteUrl,
  creating,
  error,
  copied,
  onClose,
  onCreate,
  onCopy,
}: {
  inviteEmail: string;
  setInviteEmail: (e: string) => void;
  inviteRole: "manager" | "staff";
  setInviteRole: (r: "manager" | "staff") => void;
  inviteUrl: string;
  creating: boolean;
  error: string | null;
  copied: boolean;
  onClose: () => void;
  onCreate: () => void;
  onCopy: () => void;
}) {
  const trapRef = useRef<HTMLDivElement>(null);
  useFocusTrap({ containerRef: trapRef, onEscape: onClose });

  return (
    // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-noninteractive-element-interactions -- backdrop-click-to-dismiss is a mouse-only convenience; this dialog already has full keyboard access via useFocusTrap (Escape + a visible Close button).
    <div
      className="fixed inset-0 z-[var(--z-dialog)] flex items-end justify-center bg-scrim p-md sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="invite-modal-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={trapRef}
        className="glass w-full rounded-t-card p-lg pb-[calc(var(--safe-bottom)+var(--spacing-lg))] sm:max-w-[420px] sm:rounded-card sm:pb-lg"
      >
        <h3
          id="invite-modal-title"
          className="font-serif text-subheading font-normal leading-tight text-ink"
        >
          Invite team member
        </h3>
        <p className="mt-xs text-body-sm text-ink-soft">
          Create a shareable link. Anyone with the link can join your
          restaurant as the selected role.
        </p>

        {!inviteUrl ? (
          <>
            <div className="mt-lg">
              <label
                htmlFor="invite-email"
                className="block text-caption font-medium uppercase tracking-[0.18em] text-grey"
              >
                Email
              </label>
              <input
                id="invite-email"
                type="email"
                inputMode="email"
                autoComplete="email"
                required
                placeholder="teammate@restaurant.com"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !creating) {
                    e.preventDefault();
                    onCreate();
                  }
                }}
                className="mt-xs min-h-11 h-[52px] w-full rounded-pill border border-rule-strong bg-surface-sunken px-md text-control text-ink focus:border-accent focus-ring"
              />
              <p className="mt-xs text-ledger text-grey">
                The link will only work for this address.
              </p>
            </div>

            <div className="mt-md">
              <label
                htmlFor="invite-role"
                className="block text-caption font-medium uppercase tracking-[0.18em] text-grey"
              >
                Role
              </label>
              <select
                id="invite-role"
                value={inviteRole}
                onChange={(e) =>
                  setInviteRole(e.target.value as "manager" | "staff")
                }
                className="mt-xs min-h-11 h-[52px] w-full rounded-pill border border-rule-strong bg-surface-sunken px-md text-control text-ink focus:border-accent focus-ring"
              >
                <option value="manager">Manager</option>
                <option value="staff">Staff</option>
              </select>
              <p className="mt-xs text-ledger text-grey">
                {ROLE_DESCRIPTIONS[inviteRole]}
              </p>
            </div>

            {error && (
              <p
                role="alert"
                className="mt-md rounded-card border border-risk-ink/30 bg-risk-wash px-sm py-xs text-body-sm text-risk-ink"
              >
                {error}
              </p>
            )}

            <div className="mt-lg flex flex-col-reverse gap-sm sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={onClose}
                className="flex min-h-11 items-center justify-center rounded-pill border border-rule-strong bg-transparent px-lg text-control font-medium text-ink transition-colors hover:border-accent hover:text-accent focus-ring"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={onCreate}
                disabled={creating || inviteEmail.trim().length === 0}
                className="flex min-h-11 items-center justify-center gap-xs rounded-pill bg-primary px-lg text-control font-semibold text-seal-ink transition-colors hover:bg-primary-hover focus-ring disabled:opacity-60"
              >
                {creating && (
                  <Loader2
                    className="h-4 w-4 animate-spin"
                    strokeWidth={1.9}
                  />
                )}
                Generate link
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="mt-lg rounded-card border border-rule-strong bg-surface-sunken p-md">
              <p className="break-all text-ledger text-ink">
                {inviteUrl}
              </p>
            </div>
            <div className="mt-md flex flex-col-reverse gap-sm sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={onClose}
                className="flex min-h-11 items-center justify-center rounded-pill border border-rule-strong bg-transparent px-lg text-control font-medium text-ink transition-colors hover:border-accent hover:text-accent focus-ring"
              >
                Done
              </button>
              <button
                type="button"
                onClick={onCopy}
                className="flex min-h-11 items-center justify-center gap-xs rounded-pill bg-primary px-lg text-control font-semibold text-seal-ink transition-colors hover:bg-primary-hover focus-ring"
              >
                {copied ? (
                  <Check className="h-4 w-4" strokeWidth={1.9} />
                ) : (
                  <Copy className="h-4 w-4" strokeWidth={1.9} />
                )}
                {copied ? "Copied" : "Copy link"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
