"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ChevronRight, Clock, X } from "lucide-react";
import { DrinkWindowTimeline } from "@/components/drink-window-timeline";
import { getYearsUntilWindowClose } from "@/lib/drink-window/status";
import type { DrinkWindowAlertRow } from "@/lib/drink-window/alerts";
import { WineThumb } from "@/components/wine-thumb";
import { metricHref } from "./metric-href";
import { wineTitle } from "@/lib/wine-display-name";

/**
 * BND-039 — BriefingAlertCard
 *
 * One card per wine entering its final drinking window. Sits at the top
 * of the Insights briefing. Personalised headline names the operator
 * (first name from email) so the alert reads as a message, not a metric.
 *
 * Architecture: this is a client component because Snooze is interactive
 * (POST + revalidation). The parent server component fetches the alerts
 * list and passes it as `alerts` prop.
 *
 * Actions:
 *   • View bottles → deep-link to /cellar?wine={id} (Cellar opens drawer)
 *   • Snooze 30 days → POST /api/wines/{id}/snooze-alert + refresh
 *
 * SD-24: that POST is `requireRole(["owner", "manager"])`, so the button is
 * rendered only for `canManage`. Reading the alert is membership-only and is
 * unchanged — the same split /reconcile-queue and /bins already make.
 */

// Type re-export for back-compat. The canonical shape lives in
// @/lib/drink-window/alerts (DrinkWindowAlertRow) and is the same here.
export type DrinkWindowAlert = DrinkWindowAlertRow;

export function BriefingAlertCard({
  alert,
  canManage,
}: {
  alert: DrinkWindowAlert;
  canManage: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const yearsLeft = getYearsUntilWindowClose(alert.drink_window_end);
  const pastWindow = yearsLeft != null && yearsLeft < 0;
  const ratingSourceLabel = formatRatingSourceLabel(alert.rating_source);
  // Whole clauses, not ledger fragments — "~— remaining of optimal" shipped
  // to the screen (Kimi audit 2026-08-26). Null window end → say nothing.
  const remainingLabel =
    yearsLeft == null
      ? null
      : pastWindow
        ? `Optimal window ended in ${alert.drink_window_end}`
      : yearsLeft === 0
        ? "Final year of the optimal window"
        : `~${yearsLeft} yr${yearsLeft === 1 ? "" : "s"} of optimal window left`;

  const onSnooze = async () => {
    setBusy(true);
    setErrorMsg(null);
    try {
      const res = await fetch(`/api/wines/${alert.wine_id}/snooze-alert`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ days: 30 }),
      });
      if (!res.ok) {
        const payload = (await res.json().catch(() => null)) as
          | { error?: string }
          | null;
        throw new Error(payload?.error ?? `Failed (${res.status}).`);
      }
      // router.refresh re-runs the server component which re-fetches
      // alerts; the snoozed wine drops out automatically.
      startTransition(() => router.refresh());
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Snooze failed.");
      setBusy(false);
    }
  };

  return (
    <article
      data-metric={`drink-window-${alert.wine_id}`}
      className="border-b border-rule py-md"
    >
      <div className="flex flex-col gap-md md:flex-row md:items-start md:gap-lg">
        {/* The bottle itself. This alert asks someone to go and find a
            specific wine in a cellar; the label is how they will recognise
            it on the shelf. */}
        <WineThumb
          src={alert.hero_image_url}
          producer={alert.producer}
          name={alert.name}
          colour={alert.colour}
          size={56}
        />
        <div className="min-w-0 flex-1">
          {/* Fact first — the salutation ("Hey Owner+local") both leaked the
              email local-part and buried the actionable sentence
              (Kimi audit 2026-08-26). */}
          <h3 className="font-serif text-body-lg font-normal text-ink md:text-subheading">
            <span className="tabular">{alert.bottle_count}</span> bottle{alert.bottle_count === 1 ? "" : "s"} of{" "}
            <em className="font-medium italic">
              {wineTitle(alert.producer, alert.name, ", ")}
              {alert.vintage ? ` ${alert.vintage}` : ""}
            </em>{" "}
            {alert.bottle_count === 1 ? "is" : "are"} {pastWindow ? "past" : "entering"} {alert.bottle_count === 1 ? "its" : "their"} {pastWindow ? "drinking window." : "final drinking window."}
          </h3>
          <div className="mt-xs flex flex-wrap items-center gap-sm text-ledger text-grey">
            {remainingLabel && (
              <span className="inline-flex items-center gap-2xs">
                <Clock className="h-3 w-3" strokeWidth={2} aria-hidden />
                {remainingLabel}
              </span>
            )}
            {alert.rating != null && ratingSourceLabel && (
              <span>
                · last reviewed <span className="tabular">{alert.rating} pts</span>
              </span>
            )}
            {alert.bin_location && (
              <span>
                · bin <span className="inline-flex rounded-pill border border-rule-strong px-xs py-2xs text-micro tracking-[0.12em] text-accent">{alert.bin_location}</span>
              </span>
            )}
          </div>
          {alert.review_excerpt && (
            <p className="mt-sm font-serif text-body-lg italic leading-snug text-ink-soft">
              &ldquo;{alert.review_excerpt}&rdquo;
            </p>
          )}

          <div className="mt-md flex flex-wrap items-center gap-xs">
            <Link
              href={metricHref("wine", alert.wine_id)}
              className="inline-flex min-h-11 items-center gap-xs rounded-pill bg-primary px-md text-control font-semibold text-seal-ink transition-colors hover:bg-primary-hover focus-ring"
            >
              View {alert.bottle_count} bottle{alert.bottle_count === 1 ? "" : "s"}
              <ChevronRight className="h-4 w-4" strokeWidth={2} aria-hidden />
            </Link>
            {canManage && (
              <button
                type="button"
                disabled={busy}
                onClick={onSnooze}
                className="inline-flex min-h-11 items-center gap-xs rounded-pill px-md text-control font-medium text-grey transition-colors hover:bg-surface-raised focus-ring disabled:opacity-60"
              >
                <X className="h-4 w-4" strokeWidth={2} aria-hidden />
                {busy ? "Snoozing…" : "Snooze 30 days"}
              </button>
            )}
          </div>

          {errorMsg && (
            <p role="alert" className="mt-sm text-ledger text-risk-ink">
              {errorMsg}
            </p>
          )}
        </div>

        {/* Timeline — full size on desktop, mini on mobile */}
        <div className="md:w-[320px] md:shrink-0">
          <DrinkWindowTimeline
            start={alert.drink_window_start}
            end={alert.drink_window_end}
            size="full"
          />
          {/* Only cite a source that exists — "Source: Unknown" printed on
              every unattributed alert and eroded trust (Kimi audit). */}
          {ratingSourceLabel && (
            <p className="mt-xs text-micro italic text-grey">
              Source: {ratingSourceLabel}
              {alert.rating_source === "claude_inference" && " (estimated)"}
            </p>
          )}
        </div>
      </div>
    </article>
  );
}

function formatRatingSourceLabel(source: string | null): string | null {
  switch (source) {
    case "rule_engine":
      return "Rule engine estimate";
    case "claude_inference":
      return "Claude AI";
    case "vinous":
      return "Vinous (Galloni)";
    case "parker":
      return "Wine Advocate";
    case "js":
      return "James Suckling";
    case "wine_spectator":
      return "Wine Spectator";
    case "decanter":
      return "Decanter";
    case "aggregate":
      return "Multiple critics";
    default:
      return null;
  }
}
