"use client";

import { Camera, Keyboard } from "lucide-react";

interface NoCameraViewProps {
  onEnterCode: () => void;
}

export function NoCameraView({ onEnterCode }: NoCameraViewProps) {
  return (
    <div className="space-y-md">
      <div className="flex flex-col items-center gap-md rounded-card card-surface px-lg py-2xl text-center">
        <div className="rounded-full border border-rule-strong p-lg">
          <Camera className="h-8 w-8 text-grey" strokeWidth={1.75} />
        </div>
        <div>
          <h2 className="font-serif text-heading-sm font-normal text-ink">
            Camera not available
          </h2>
          <p className="mt-xs text-body-sm text-ink-soft">
            Enter the bottle&rsquo;s wine code manually.
          </p>
        </div>
        <button
          type="button"
          onClick={onEnterCode}
          className="flex h-12 items-center justify-center gap-sm rounded-pill bg-primary px-lg text-control font-semibold text-seal-ink transition-colors hover:bg-primary-hover focus-ring"
        >
          <Keyboard className="h-4 w-4" strokeWidth={2} />
          Enter code
        </button>
      </div>
    </div>
  );
}
