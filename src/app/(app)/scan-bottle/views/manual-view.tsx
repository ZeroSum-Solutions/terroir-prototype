"use client";

import { Camera, Search } from "lucide-react";

interface ManualViewProps {
  manualCode: string;
  onManualCodeChange: (value: string) => void;
  onSubmit: (e?: React.FormEvent) => void;
  onUseCamera: () => void;
}

export function ManualView({ manualCode, onManualCodeChange, onSubmit, onUseCamera }: ManualViewProps) {
  return (
    <div className="space-y-md">
      <form onSubmit={onSubmit} className="space-y-md">
        <div className="rounded-card card-surface p-md md:p-lg">
          <label
            htmlFor="manual-code"
            className="mb-xs block text-caption font-medium uppercase tracking-[0.18em] text-grey"
          >
            Wine ID or QR code
          </label>
          <input
            id="manual-code"
            type="text"
            inputMode="text"
            autoComplete="off"
            autoFocus
            value={manualCode}
            onChange={(e) => onManualCodeChange(e.target.value)}
            placeholder="Enter the code from the bottle label"
            className="h-12 w-full rounded-pill border border-rule-strong bg-surface-sunken px-md text-control text-ink placeholder:text-grey focus:border-accent focus-ring"
          />
          <p className="mt-xs text-ledger text-grey">
            The code is printed below the QR code on the bottle label.
          </p>
        </div>
        <button
          type="submit"
          disabled={!manualCode.trim()}
          className="flex h-12 w-full items-center justify-center gap-sm rounded-pill bg-primary text-control font-semibold text-seal-ink transition-colors hover:bg-primary-hover focus-ring disabled:opacity-50"
        >
          <Search className="h-4 w-4" strokeWidth={2} />
          Look up wine
        </button>
      </form>
      <button
        type="button"
        onClick={onUseCamera}
        className="flex h-12 w-full items-center justify-center gap-sm rounded-pill border border-rule-strong bg-transparent text-control font-medium text-ink transition-colors hover:border-accent hover:text-accent focus-ring"
      >
        <Camera className="h-4 w-4" strokeWidth={2} />
        Use camera instead
      </button>
    </div>
  );
}
