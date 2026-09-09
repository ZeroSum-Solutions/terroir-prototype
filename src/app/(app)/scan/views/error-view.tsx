"use client";

import { AlertTriangle, Camera, RotateCw } from "lucide-react";
import type { ScanMode } from "@/lib/scanner/types";

interface ErrorViewProps {
  mode: ScanMode;
  message: string;
  onRetry: () => void;
  onNewPhoto: () => void;
  hasFile: boolean;
  onManual: () => void;
}

export function ErrorView({ mode, message, onRetry, onNewPhoto, hasFile, onManual }: ErrorViewProps) {
  const isBottle = mode === "bottle";
  return (
    <section className="flex min-h-[60vh] items-center justify-center">
      <div role="alert" className="glass w-full max-w-[480px] rounded-card p-xl text-center">
        <div className="mx-auto mb-md flex h-14 w-14 items-center justify-center rounded-full border border-accent/60 text-accent">
          <AlertTriangle className="h-6 w-6" strokeWidth={1.75} aria-hidden="true" />
        </div>
        <h2 className="font-serif text-heading-sm font-normal text-ink">
          {isBottle ? "Couldn’t read the label" : "Couldn’t read the invoice"}
        </h2>
        <p className="mt-sm text-body-sm text-ink-soft">{message}</p>
        <div className="mt-lg flex flex-col gap-sm">
          {hasFile && (
            <button
              type="button"
              onClick={onRetry}
              className="flex h-12 items-center justify-center gap-sm rounded-pill bg-primary text-control font-semibold text-seal-ink transition-colors hover:bg-primary-hover focus-ring"
            >
              <RotateCw className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
              {isBottle ? "Retry label scan" : "Retry invoice scan"}
            </button>
          )}
          <div className={`grid gap-sm ${isBottle ? "grid-cols-1" : "grid-cols-2"}`}>
            <button
              type="button"
              onClick={onNewPhoto}
              className="flex h-12 items-center justify-center gap-sm rounded-pill border border-rule-strong bg-transparent text-control font-medium text-ink transition-colors hover:border-accent hover:text-accent focus-ring"
            >
              <Camera className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
              New photo
            </button>
            {!isBottle && (
              <button
                type="button"
                onClick={onManual}
                className="flex h-12 items-center justify-center gap-sm rounded-pill border border-rule-strong bg-transparent text-control font-medium text-ink transition-colors hover:border-accent hover:text-accent focus-ring"
              >
                Enter manually
              </button>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
