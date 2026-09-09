import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { getAuthContext } from "@/lib/auth-context";
import { RestaurantNameForm } from "../restaurant-name-form";

export const metadata = { title: "Restaurant setup guide" };

export default async function GetStartedPage() {
  const auth = await getAuthContext();
  if (!auth) return null;
  const canManage = auth.userRole !== "staff";
  const steps = canManage ? [
    { title: "Bring in your inventory", body: "Upload CSV or Excel (.xlsx), review the wines and quantities, then apply the import. For invoices, use a photo or PDF in Scan.", href: "/import", action: "Import CSV or Excel" },
    { title: "Put each wine in its place", body: "Create bins for your shelves, fridges and cellar areas. Use the reconciliation queue to place unassigned stock and review flagged records.", href: "/bins", action: "Set up storage bins" },
    { title: "Prepare your wine list", body: "Choose wines, check prices and pour sizes, then preview the guest list before publishing it.", href: "/lists", action: "Open wine lists" },
    ...(auth.userRole === "owner" ? [{ title: "Bring your team on board", body: "Invite managers and floor staff with the access each person needs. Have them open their invite on their own phone.", href: "/team", action: "Manage your team" }] : []),
  ] : [];

  return (
    <section className="mx-auto max-w-[640px]">
      {/* The masthead pattern (DESIGN.md — Masthead), without a photograph:
          the copper glow is what a masthead with no image band gets. */}
      <div className="dawn-gradient relative -mx-md -mt-lg mb-lg overflow-hidden px-md pb-lg pt-xl md:-mx-lg md:-mt-xl md:px-lg md:pb-xl md:pt-2xl">
        <p className="text-caption font-medium uppercase tracking-[0.18em] text-accent">{auth.restaurantName}</p>
        <h1 className="mt-xs font-serif text-heading font-normal leading-[1.0] tracking-[-0.02em] text-ink">{canManage ? "Get ready for service" : "Your guide to service"}</h1>
        <p className="mt-sm text-body text-ink-soft">{canManage ? "Start with the stock you have. Work through these steps at your own pace, and return here from Settings → Setup guide." : "Find a wine, record a pour and keep the guest list current from your phone."}</p>
      </div>

      {auth.userRole === "owner" && (
        <details className="glass mb-lg rounded-card p-md">
          <summary className="min-h-11 cursor-pointer text-control font-medium text-ink focus-ring">Restaurant details</summary>
          <RestaurantNameForm restaurantId={auth.restaurantId} initialName={auth.restaurantName} />
        </details>
      )}

      {/* A numbered sequence, one glass panel per step, one primary in each. */}
      {steps.length > 0 && <ol className="mb-xl flex flex-col gap-md">
        {steps.map((step, index) => <li key={step.href} className="glass rounded-card p-lg">
          <p className="text-micro uppercase tracking-[0.12em] text-accent">Step {index + 1}</p>
          <h2 className="mt-xs font-serif text-subheading font-normal text-ink">{step.title}</h2>
          <p className="mt-xs text-body-sm text-ink-soft">{step.body}</p>
          <Link href={step.href} className="mt-md inline-flex min-h-11 items-center gap-sm rounded-pill bg-primary px-lg text-control font-semibold text-seal-ink transition-colors hover:bg-primary-hover focus-ring">
            {step.action}
            <ArrowRight className="h-4 w-4 shrink-0" strokeWidth={1.9} aria-hidden />
          </Link>
        </li>)}
      </ol>}

      <h2 className="text-caption font-medium uppercase tracking-[0.18em] text-grey">On the floor</h2>
      <p className="mt-sm text-body-sm text-ink-soft">Use the search at the top of any screen. Match the producer, vintage and bottle size before recording a pour.</p>
      <div className="mt-md border-t border-rule">
        <GuideLink href="/cellar?mode=pour">Find a wine and pour</GuideLink>
        <GuideLink href="/cellar?mode=eightysix">Mark a wine unavailable</GuideLink>
        <GuideLink href="/cellar/open">Check open bottles</GuideLink>
        {canManage && <GuideLink href="/cellar/reconcile">Reconcile open bottles after service</GuideLink>}
      </div>
      <p className="mt-md text-body-sm text-ink-soft">Reconciliation checks the remaining volume in open bottles. It is not a full count of sealed stock. Confirm a save has succeeded before moving on; changes need a connection.</p>
      {canManage && <div className="mt-xl border-t border-rule">
        <GuideLink href="/scan">Receive an invoice photo or PDF</GuideLink>
        <GuideLink href="/reconcile-queue">Review inventory issues and placement</GuideLink>
      </div>}
    </section>
  );
}

/** A hairline index row — the secondary destinations, never a second primary. */
function GuideLink({ href, children }: { href: string; children: React.ReactNode }) {
  return <Link href={href} className="flex min-h-11 items-center justify-between gap-sm border-b border-rule px-2xs py-sm text-control font-medium text-ink transition-colors hover:text-accent focus-ring">{children}<ArrowRight className="h-4 w-4 shrink-0 text-grey" strokeWidth={1.9} aria-hidden /></Link>;
}
