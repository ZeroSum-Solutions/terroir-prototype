"use client";

import { Keyboard, ScanLine } from "lucide-react";
import type { RefObject } from "react";

interface ScanningViewProps {
  videoRef: RefObject<HTMLVideoElement | null>;
  onEnterCode: () => void;
}

export function ScanningView({ videoRef, onEnterCode }: ScanningViewProps) {
  return (
    <div className="space-y-md">
      <div className="relative overflow-hidden rounded-card bg-black">
        <div className="relative pb-[75%]">
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className="absolute inset-0 h-full w-full object-cover"
          />
          {/* The copper reticle: four corner brackets, hairline (DESIGN.md —
              the accent is the mark, never a box drawn round the subject). */}
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="relative h-48 w-48 md:h-56 md:w-56">
              <span className="absolute left-0 top-0 h-[26px] w-[26px] rounded-tl-lg border-l border-t border-accent/70" />
              <span className="absolute right-0 top-0 h-[26px] w-[26px] rounded-tr-lg border-r border-t border-accent/70" />
              <span className="absolute bottom-0 left-0 h-[26px] w-[26px] rounded-bl-lg border-b border-l border-accent/70" />
              <span className="absolute bottom-0 right-0 h-[26px] w-[26px] rounded-br-lg border-b border-r border-accent/70" />
              <span className="absolute inset-x-0 top-1/2 h-px bg-gradient-to-r from-transparent via-primary to-transparent" />
            </div>
          </div>
        </div>
        <div className="absolute bottom-md left-1/2 -translate-x-1/2">
          {/* Over live camera video — a fixed dark media scrim, not a
              themed surface (dark-mode ink is champagne). */}
          <span className="inline-flex items-center gap-sm rounded-pill border border-glass-edge bg-black/70 px-md py-sm text-body-sm font-medium text-white backdrop-blur-md">
            <ScanLine className="h-4 w-4 animate-pulse" strokeWidth={1.9} />
            Point camera at QR code
          </span>
        </div>
      </div>
      <button
        type="button"
        onClick={onEnterCode}
        className="flex h-12 w-full items-center justify-center gap-sm rounded-pill border border-rule-strong bg-transparent text-control font-medium text-ink transition-colors hover:border-accent hover:text-accent focus-ring"
      >
        <Keyboard className="h-4 w-4" strokeWidth={2} />
        Enter code manually
      </button>
    </div>
  );
}
