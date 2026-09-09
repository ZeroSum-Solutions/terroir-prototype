"use client";

import { AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * The bottle result's identity chrome, kept out of bottle-results-view.tsx so
 * that view can carry the photo band without growing past the file-size gate.
 *
 * Every `text-<size>` token below is concatenated OUTSIDE cn(): tailwind-merge
 * cannot tell a custom size from a colour and keeps only the last of the two.
 */

/**
 * The status seal (DESIGN.md — Components, Status Seal). A confidence
 * percentage is the model's self-assessment, not a measurement, and the
 * masthead is the wrong place to argue about it: the seal says what the
 * operator can DO — confirm it, or check it first. The percentage itself is
 * still stated once, in the panel below.
 */
export function IdentitySeal({ confirmable }: { confirmable: boolean }) {
  return (
    <span
      className={
        "text-caption " +
        cn(
          "inline-flex items-center gap-xs rounded-pill px-sm py-2xs font-medium uppercase tracking-[0.14em]",
          confirmable
            ? "bg-ready-wash text-ready-ink"
            : "border border-accent/60 text-accent",
        )
      }
    >
      {!confirmable && (
        <AlertCircle className="h-3.5 w-3.5" strokeWidth={1.9} aria-hidden="true" />
      )}
      {confirmable ? "Identified" : "Verify"}
    </span>
  );
}

/**
 * One identity field, as a hairline row (DESIGN.md — Index Row): the eyebrow
 * and its flag on the left, the value on the right. `emphasis` is the wine
 * name — the serif at heading-sm, never bold.
 *
 * The flag stays inside the eyebrow cluster rather than getting a wrapper of
 * its own: a wrapper holding only the seal would read as a second "Needs
 * review" element to anything counting them.
 */
export function InfoRow({
  label,
  value,
  low,
  emphasis,
}: {
  label: string;
  value: string;
  low?: boolean;
  emphasis?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-md border-b border-rule py-sm last:border-b-0">
      <div className="flex min-w-0 flex-wrap items-center gap-xs">
        <span className="text-caption font-medium uppercase tracking-[0.18em] text-grey">
          {label}
        </span>
        {low && (
          <span className="inline-flex items-center gap-3xs rounded-pill border border-accent/60 px-xs py-2xs text-micro font-medium uppercase tracking-[0.14em] text-accent">
            <AlertCircle className="h-3 w-3" strokeWidth={1.9} aria-hidden="true" />
            Needs review
          </span>
        )}
      </div>
      <div
        className={
          emphasis
            ? "font-serif text-heading-sm font-medium leading-[1.15] text-ink min-w-0 text-right"
            : "text-control text-ink min-w-0 text-right"
        }
      >
        {value ? (
          value
        ) : (
          <span className="inline-flex items-center gap-3xs text-accent">
            <AlertCircle className="h-3.5 w-3.5" strokeWidth={1.9} aria-hidden="true" />
            Not read
          </span>
        )}
      </div>
    </div>
  );
}

/**
 * The label photograph as a full-bleed band the glass sheet then sits over —
 * the wine-detail hero treatment (DESIGN.md — Imagery). The scrim is built
 * from the canvas token so the band fades into whichever room is on.
 */
export function LabelPhotoBand({ src }: { src: string }) {
  return (
    <div className="relative -mx-md overflow-hidden md:-mx-lg">
      {/* Plain <img>: src is a local object URL, never a remote asset —
          next/image adds nothing here. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt="Label you captured"
        className="h-[38vh] w-full bg-surface-sunken object-cover"
      />
      <div
        className="absolute inset-0"
        aria-hidden
        style={{
          background:
            "linear-gradient(180deg, color-mix(in srgb, var(--color-canvas) 30%, transparent) 0%, transparent 30%, color-mix(in srgb, var(--color-canvas) 55%, transparent) 78%, var(--color-canvas) 100%)",
        }}
      />
    </div>
  );
}
