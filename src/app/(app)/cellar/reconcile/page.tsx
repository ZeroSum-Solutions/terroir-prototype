import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, History } from "lucide-react";
import { getAuthContext } from "@/lib/auth-context";
import { ReconcileList } from "../reconcile-list";
import type { OpenBottleRow } from "@/lib/wine-list/shapes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Reconcile — Terroir" };

/**
 * /cellar/reconcile — BND-128 / BND-135
 *
 * Dedicated end-of-shift reconciliation page. Gated to manager+ only;
 * staff are redirected to /cellar with a 403-like UX.
 *
 * Renders the ReconcileList component (shared with the ReconcileModal)
 * in a full-page layout with a back button to /cellar and a link to
 * the reconciliation history view (BND-135).
 */
export default async function ReconcilePage() {
  const auth = await getAuthContext();
  if (!auth) redirect("/login");

  const { supabase, restaurantId, userRole, user } = auth;

  // Role gate: manager or owner only
  if (userRole !== "owner" && userRole !== "manager") {
    redirect("/cellar");
  }

  // Fetch open bottles for reconciliation (same query as cellar/page.tsx)
  const { data: openBottleRows } = await supabase.rpc(
    "list_open_bottle_items",
    { p_restaurant_id: restaurantId },
  );

  const reconcileItems: OpenBottleRow[] = (
    (openBottleRows ?? []) as OpenBottleRow[]
  ).filter((i) => i.open_remaining_ml !== null);

  // Fetch reconcile variance threshold from config
  const { data: configRow } = await supabase
    .from("cellar_config")
    .select("reconcile_variance_threshold_oz")
    .eq("restaurant_id", restaurantId)
    .limit(1)
    .maybeSingle();

  const varianceThresholdOz = configRow?.reconcile_variance_threshold_oz ?? 1.0;

  return (
    <section>
      {/* Masthead (DESIGN.md — Components, Masthead) over the copper glow:
          the count that used to be a second line under the title is now the
          eyebrow, which is where the section and the tally belong. */}
      <header className="dawn-gradient relative -mx-md -mt-lg mb-lg overflow-hidden px-md pb-lg pt-xl md:-mx-lg md:-mt-xl md:mb-xl md:px-lg md:pb-xl md:pt-2xl">
        <div className="flex items-start gap-sm">
          <Link
            href="/cellar"
            className="glass flex h-11 w-11 shrink-0 items-center justify-center rounded-pill text-ink-soft transition-colors hover:text-ink"
            aria-label="Back to cellar"
          >
            <ArrowLeft className="h-5 w-5" strokeWidth={1.9} />
          </Link>
          <div className="min-w-0 flex-1">
            <p className="text-caption font-medium uppercase tracking-[0.18em] text-accent">
              Cellar ·{" "}
              <span className="tabular">{reconcileItems.length}</span> to verify
            </p>
            <h1 className="mt-xs font-serif text-heading font-normal leading-[1.0] tracking-[-0.02em] text-ink lg:text-display">
              Reconcile
            </h1>
          </div>
          <Link
            href="/cellar/reconcile/history"
            aria-label="Reconciliation history"
            className="glass flex min-h-11 shrink-0 items-center gap-xs rounded-pill px-sm text-control font-medium text-ink-soft transition-colors hover:text-ink"
          >
            <History className="h-4 w-4" strokeWidth={1.75} />
            <span className="hidden sm:inline">History</span>
          </Link>
        </div>
      </header>

      <ReconcileList
        initialItems={reconcileItems}
        varianceThresholdOz={varianceThresholdOz}
        restaurantId={restaurantId}
        userId={user.id}
      />
    </section>
  );
}
