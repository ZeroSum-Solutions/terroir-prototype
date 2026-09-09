import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, History, TrendingDown, TrendingUp, BarChart3 } from "lucide-react";
import { getAuthContext } from "@/lib/auth-context";
import { RouteDataEmpty } from "@/components/route-data-state";
import {
  formatSignedVarianceOz,
  getReconciliationVariance,
  reconciliationTone,
} from "@/lib/reconciliation/variance";
import {
  buildHistoryFromPersistedEvents,
  type DayGroup,
  type ReconEvent,
} from "./history-data";
import { wineDisplayName } from "@/lib/wine-display-name";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Reconcile History — Terroir" };

function formatAbsoluteOz(ml: number): string {
  const oz = Math.abs(ml) / 29.5735;
  return oz.toFixed(1) + " oz";
}

const varianceTextClasses = {
  positive: "text-ready-ink",
  negative: "text-risk-ink",
  neutral: "text-grey",
} as const;

const varianceBadgeClasses = {
  positive: "bg-ready-wash text-ready-ink",
  negative: "bg-risk-wash text-risk-ink",
  neutral: "bg-wash text-grey",
} as const;

function VarianceValue({
  deltaMl,
  badge = false,
  className = "",
}: {
  deltaMl: number | null;
  badge?: boolean;
  className?: string;
}) {
  if (deltaMl == null) {
    return <span className={`${className} text-grey`}>—</span>;
  }

  const variance = getReconciliationVariance(deltaMl, 0);
  const tone = reconciliationTone(variance.relation);
  const toneClasses = badge ? varianceBadgeClasses[tone] : varianceTextClasses[tone];

  return (
    <span className={`${className} ${toneClasses}`}>
      {badge && variance.relation === "over" && (
        <TrendingUp className="h-3 w-3" strokeWidth={2.5} />
      )}
      {badge && variance.relation === "under" && (
        <TrendingDown className="h-3 w-3" strokeWidth={2.5} />
      )}
      {formatSignedVarianceOz(variance.deltaMl)} · {variance.label}
    </span>
  );
}

/**
 * Simple CSS bar chart for variance trend over time.
 * Each bar represents one day; height is proportional to max variance.
 */
function VarianceChart({ dailySummaries }: { dailySummaries: DayGroup[] }) {
  if (dailySummaries.length === 0) return null;

  // Chart shows oldest→newest (left→right), so reverse
  const chartData = [...dailySummaries].reverse();
  const maxVariance = Math.max(
    ...chartData.map((d) => d.totalVarianceMl),
    1,
  );

  return (
    <div className="glass mb-xl rounded-card p-lg">
      <h2 className="mb-md flex items-center gap-xs font-serif text-subheading font-normal text-ink">
        <BarChart3 className="h-5 w-5 text-grey" strokeWidth={1.5} />
        Variance trend
      </h2>
      <div className="flex items-end gap-xs" style={{ height: "120px" }}>
        {chartData.map((day) => {
          const pct = (day.totalVarianceMl / maxVariance) * 100;
          return (
            <div
              key={day.date}
              className="flex flex-1 flex-col items-center justify-end"
              style={{ height: "100%" }}
            >
              <span className="mb-xs text-micro tabular-nums text-grey">
                {formatAbsoluteOz(day.totalVarianceMl)}
              </span>
              <div
                className="w-full max-w-[40px] rounded-t-sm bg-gradient-to-t from-accent to-primary transition-opacity hover:opacity-80"
                style={{ height: `${Math.max(pct, 4)}%` }}
                title={`${day.displayDate}: ${formatAbsoluteOz(day.totalVarianceMl)}`}
              />
              <span className="mt-xs text-center text-micro leading-tight text-grey">
                {new Date(day.date + "T12:00:00").toLocaleDateString("en-US", {
                  month: "short",
                  day: "numeric",
                })}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default async function ReconcileHistoryPage() {
  const auth = await getAuthContext();
  if (!auth) redirect("/login");

  const { supabase, restaurantId, userRole } = auth;

  // Role gate: manager or owner only
  if (userRole !== "owner" && userRole !== "manager") {
    redirect("/cellar");
  }

  // Fetch reconciliation events with wine details
  const { data: events, error: eventsError } = await supabase
    .from("availability_events")
    .select("id, created_at, delta, note, user_id, wine_id, wines(producer, name, vintage)")
    .eq("restaurant_id", restaurantId)
    .eq("direction", "reconcile")
    .order("created_at", { ascending: false })
    .limit(500);

  if (eventsError) throw eventsError;

  const history = buildHistoryFromPersistedEvents((events ?? []) as ReconEvent[]);

  return (
    <section>
      <header className="dawn-gradient relative -mx-md -mt-lg mb-lg overflow-hidden px-md pb-lg pt-xl md:-mx-lg md:-mt-xl md:mb-xl md:px-lg md:pb-xl md:pt-2xl">
        <div className="flex items-start gap-sm">
          <Link
            href="/cellar/reconcile"
            className="glass flex h-11 w-11 shrink-0 items-center justify-center rounded-pill text-ink-soft transition-colors hover:text-ink"
            aria-label="Back to reconcile"
          >
            <ArrowLeft className="h-5 w-5" strokeWidth={1.9} />
          </Link>
          <div className="min-w-0 flex-1">
            <p className="text-caption font-medium uppercase tracking-[0.18em] text-accent">
              {history.length > 0
                ? `Reconcile · ${history.length} day${history.length === 1 ? "" : "s"} of reconciliation data`
                : "Reconcile · No reconciliation history yet"}
            </p>
            <h1 className="mt-xs font-serif text-heading font-normal leading-[1.0] tracking-[-0.02em] text-ink lg:text-display">
              Reconcile History
            </h1>
          </div>
        </div>
      </header>

      {history.length === 0 ? (
        <RouteDataEmpty
          icon={<History className="h-6 w-6" strokeWidth={1.5} />}
          title="No reconciliation history yet"
          description="History will appear here after you run your first end-of-shift reconciliation."
          action={
            <Link
              href="/cellar/reconcile"
              className="inline-flex h-11 items-center gap-sm rounded-pill bg-primary px-md text-control font-semibold text-seal-ink hover:bg-primary-hover"
            >
              Go to reconcile
            </Link>
          }
        />
      ) : (
        <>
          {/* Variance chart */}
          <VarianceChart dailySummaries={history} />

          {/* Summary cards */}
          <div className="mb-lg grid grid-cols-1 gap-sm sm:grid-cols-3">
            <div className="glass rounded-card p-md">
              <div className="text-caption font-medium uppercase text-grey">
                Total sessions
              </div>
              <div className="mt-xs text-subheading tabular-nums text-ink">
                {history.reduce((sum, d) => sum + d.sessions.length, 0)}
              </div>
            </div>
            <div className="glass rounded-card p-md">
              <div className="text-caption font-medium uppercase text-grey">
                Bottles reconciled
              </div>
              <div className="mt-xs text-subheading tabular-nums text-ink">
                {history.reduce((sum, d) => sum + d.eventCount, 0)}
              </div>
            </div>
            <div className="glass rounded-card p-md">
              <div className="text-caption font-medium uppercase text-grey">
                Total variance
              </div>
              <div className="mt-xs text-subheading tabular-nums text-ink">
                {formatAbsoluteOz(history.reduce((sum, d) => sum + d.totalVarianceMl, 0))}
              </div>
            </div>
          </div>

          {/* Daily history */}
          <div className="flex flex-col gap-lg">
            {history.map((day) => (
              <div key={day.date}>
                <h2 className="mb-md flex items-center gap-xs font-serif text-subheading font-normal text-ink">
                  <span className="inline-block h-[6px] w-[6px] rounded-full bg-accent" />
                  {day.displayDate}
                  <span className="text-ledger tabular-nums text-grey">
                    · {day.sessions.length} session
                    {day.sessions.length !== 1 ? "s" : ""}
                    {" · "}
                    {formatAbsoluteOz(day.totalVarianceMl)} variance
                  </span>
                </h2>

                <div className="flex flex-col gap-md">
                  {day.sessions.map((session, si) => {
                    const wineCount = session.bottleCount;

                    return (
                      <div
                        key={`${day.date}-${si}`}
                        className="rounded-card border border-rule"
                      >
                        {/* Session header */}
                        <div className="flex items-center justify-between border-b border-rule px-md py-sm">
                          <span className="text-control font-medium tabular-nums text-ink">
                            {session.timeLabel}
                          </span>
                          <div className="flex items-center gap-sm">
                            <span className="text-ledger tabular-nums text-grey">
                              {wineCount} bottle{wineCount !== 1 ? "s" : ""}
                            </span>
                            <VarianceValue
                              deltaMl={session.totalVarianceMl}
                              badge
                              className="inline-flex items-center gap-xs rounded-pill px-sm py-2xs text-caption font-medium uppercase tracking-[0.13em]"
                            />
                          </div>
                        </div>

                        {/* Session wines — desktop table */}
                        <div className="hidden md:block">
                          <table className="w-full text-body-sm">
                            <thead>
                              <tr className="text-caption font-medium uppercase text-grey">
                                <th scope="col" className="px-md py-sm text-left font-semibold">
                                  Wine
                                </th>
                                <th scope="col" className="px-md py-sm text-right font-semibold">
                                  Variance
                                </th>
                                <th scope="col" className="px-md py-sm text-left font-semibold">
                                  Note
                                </th>
                              </tr>
                            </thead>
                            <tbody>
                              {session.events.map((event) => (
                                <tr
                                  key={event.id}
                                  className="border-t border-rule"
                                >
                                  <td className="px-md py-sm">
                                    {event.wines ? (
                                      <Link
                                        href={`/cellar?wine=${event.wine_id}`}
                                        className="group rounded-pill focus-ring"
                                      >
                                        <span className="font-serif text-body-lg font-normal text-ink group-hover:text-accent">
                                          {event.wines.producer}
                                        </span>
                                        <span className="text-grey group-hover:text-accent">
                                          {" "}
                                          {wineDisplayName(event.wines.producer, event.wines.name)}
                                          {event.wines.vintage
                                            ? ` ${event.wines.vintage}`
                                            : ""}
                                        </span>
                                      </Link>
                                    ) : (
                                      <span className="text-grey">Unknown wine</span>
                                    )}
                                  </td>
                                  <td className="px-md py-sm text-right tabular-nums">
                                    <VarianceValue deltaMl={event.delta} />
                                  </td>
                                  <td className="px-md py-sm text-grey">
                                    {event.note || "—"}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>

                        {/* Session wines — mobile cards */}
                        <div className="flex flex-col md:hidden">
                          {session.events.map((event) => (
                            <div
                              key={event.id}
                              className="flex items-center justify-between border-t border-rule px-md py-sm"
                            >
                              <div className="min-w-0 flex-1">
                                {event.wines ? (
                                  <Link
                                    href={`/cellar?wine=${event.wine_id}`}
                                    className="group rounded-pill focus-ring"
                                  >
                                    <div className="truncate font-serif text-body-lg font-normal text-ink group-hover:text-accent">
                                      {event.wines.producer}{" "}
                                      {wineDisplayName(event.wines.producer, event.wines.name)}
                                    </div>
                                    {event.wines.vintage && (
                                      <div className="text-ledger tabular-nums text-grey">
                                        {event.wines.vintage}
                                      </div>
                                    )}
                                  </Link>
                                ) : (
                                  <span className="text-body-sm text-grey">
                                    Unknown wine
                                  </span>
                                )}
                                {event.note && (
                                  <div className="mt-2xs truncate text-ledger text-grey">
                                    {event.note}
                                  </div>
                                )}
                              </div>
                              <VarianceValue
                                deltaMl={event.delta}
                                className="ml-sm shrink-0 text-body-sm font-medium tabular-nums"
                              />
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
