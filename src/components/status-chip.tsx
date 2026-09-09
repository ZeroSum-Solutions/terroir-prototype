import { cn } from "@/lib/utils";

/**
 * The one status language (DESIGN.md — Status). A single urgency scale, not
 * a family of hues:
 *
 *   muted     — no signal (out of scope, empty)
 *   neutral   — routine ledger stamp: quiet bordered pill, no fill
 *   optimal   — at peak, and deliberately ACHROMATIC. It is the good, quiet,
 *               common state and must not compete with the two that need
 *               action.
 *   attention — window risk: outlined claret (pink on Nocturne). Act soon.
 *   urgent    — the filled wax seal: act now / money at risk.
 *
 * `attention` and `urgent` are the same colour at two weights — outlined and
 * filled — because claret means one thing here and saying it twice in two
 * hues would dilute it. The filled seal keeps a faint inner impression ring,
 * struck in its own label colour rather than a hardcoded cream.
 */
export type WaxTone = "muted" | "neutral" | "optimal" | "attention" | "urgent";

export function StatusChip({
  tone,
  children,
  className,
}: {
  tone: WaxTone;
  children: React.ReactNode;
  className?: string;
}) {
  // The size token is concatenated OUTSIDE cn(): tailwind-merge reads
  // `text-caption` and `text-grey` as the same group and would keep only the
  // tone colour, silently dropping the seal's caption size (DESIGN.md —
  // Components, Status Seal).
  return (
    <span
      data-tone={tone}
      className={`text-caption ${cn(
        "inline-flex items-center gap-2xs whitespace-nowrap rounded-pill border px-sm py-2xs font-medium uppercase tracking-[0.13em]",
        tone === "muted" && "border-transparent bg-wash text-grey",
        tone === "neutral" && "border-edge bg-transparent text-ink-soft",
        tone === "optimal" && "border-rule-strong bg-peak-wash text-peak-ink",
        tone === "attention" && "border-risk-ink/40 bg-risk-wash text-risk-ink",
        // The wax seal keeps its inner impression ring, struck in the one
        // metal rather than a tint of its own label.
        tone === "urgent" &&
          "border-primary bg-primary text-seal-ink shadow-[inset_0_0_0_2px_var(--t-primary),inset_0_0_0_3px_var(--t-accent)]",
        className,
      )}`}
    >
      {children}
    </span>
  );
}
