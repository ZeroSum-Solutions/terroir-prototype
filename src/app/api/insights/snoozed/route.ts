import { NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { requireMembership } from "@/lib/api/auth";
import { Errors } from "@/lib/api/errors";
import { withApiHandler } from "@/lib/api/handler";
import { resolveSiteMarginReadAccess } from "@/lib/api/site-capability";
import { fetchSnoozedAlerts } from "@/domains/cellar/snoozed-alerts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * BND-040 follow-up — GET /api/insights/snoozed
 *
 * Returns the list of wines with active snoozes (drink-window alert OR
 * pricing alert OR both). Powers the SnoozedAlertsCard on Insights —
 * lets operators see what's been snoozed and unsnooze early.
 *
 * "Active snooze" = the column is non-null AND in the future.
 * Past timestamps mean the snooze already expired; the alert reappears
 * naturally without needing a list entry.
 *
 * Per row, returns which kind of snooze applies and when it expires.
 * A wine could have both kinds active at once (separate fields).
 */

export type SnoozedRow = {
  wine_id: string;
  name: string;
  producer: string;
  vintage: number | null;
  // Drink-window snooze — null when not snoozed.
  drinkWindowSnoozedUntil: string | null;
  // Pricing review snooze — null when not snoozed.
  pricingDismissedUntil: string | null;
};

export async function GET() {
  return withApiHandler(getSnoozedAlerts);
}

async function getSnoozedAlerts() {
  const auth = await requireMembership();
  if (auth instanceof NextResponse) return auth;
  const { supabase, restaurantId } = auth;

  const canReadMargin = await resolveSiteMarginReadAccess(
    supabase,
    restaurantId,
  );
  if (!canReadMargin) {
    return Errors.forbidden(
      "Margin access is required to view pricing snoozes.",
    );
  }

  try {
    const rows = await fetchSnoozedAlerts(supabase, restaurantId);
    return NextResponse.json({ snoozed: rows });
  } catch (err) {
    Sentry.captureException(err, {
      tags: { surface: "insights-snoozed", phase: "fetch" },
      extra: { restaurantId },
    });
    return Errors.internal("Failed to fetch snoozed alerts.");
  }
}
