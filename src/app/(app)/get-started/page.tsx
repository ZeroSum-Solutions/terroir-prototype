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
      <header className="mb-lg">
        <p className="text-caption text-grey">{auth.restaurantName}</p>
        <h1 className="mt-xs font-serif text-heading-sm text-ink">{canManage ? "Get ready for service" : "Your guide to service"}</h1>
        <p className="mt-sm text-body text-grey">{canManage ? "Start with the stock you have. Work through these steps at your own pace, and return here from Settings → Setup guide." : "Find a wine, record a pour and keep the guest list current from your phone."}</p>
      </header>

      {auth.userRole === "owner" && (
        <details className="mb-lg rounded-card card-surface p-md">
          <summary className="min-h-11 cursor-pointer text-body font-medium text-ink focus-ring">Restaurant details</summary>
          <RestaurantNameForm restaurantId={auth.restaurantId} initialName={auth.restaurantName} />
        </details>
      )}

      {steps.length > 0 && <ol className="mb-xl divide-y divide-rule rounded-card card-surface px-md">
        {steps.map((step, index) => <li key={step.href} className="py-lg">
          <p className="text-caption text-grey">Step {index + 1}</p>
          <h2 className="mt-xs font-serif text-subheading text-ink">{step.title}</h2>
          <p className="mt-xs text-control text-grey">{step.body}</p>
          <GuideLink href={step.href}>{step.action}</GuideLink>
        </li>)}
      </ol>}

      <h2 className="font-serif text-subheading text-ink">On the floor</h2>
      <p className="mt-xs text-control text-grey">Use the search at the top of any screen. Match the producer, vintage and bottle size before recording a pour.</p>
      <div className="mt-sm space-y-xs">
        <GuideLink href="/cellar?mode=pour">Find a wine and pour</GuideLink>
        <GuideLink href="/cellar?mode=eightysix">Mark a wine unavailable</GuideLink>
        <GuideLink href="/cellar/open">Check open bottles</GuideLink>
        {canManage && <GuideLink href="/cellar/reconcile">Reconcile open bottles after service</GuideLink>}
      </div>
      <p className="mt-md text-control text-grey">Reconciliation checks the remaining volume in open bottles. It is not a full count of sealed stock. Confirm a save has succeeded before moving on; changes need a connection.</p>
      {canManage && <div className="mt-xl border-t border-rule pt-md">
        <GuideLink href="/scan">Receive an invoice photo or PDF</GuideLink>
        <GuideLink href="/reconcile-queue">Review inventory issues and placement</GuideLink>
      </div>}
    </section>
  );
}

function GuideLink({ href, children }: { href: string; children: React.ReactNode }) {
  return <Link href={href} className="mt-sm flex min-h-11 items-center justify-between gap-sm rounded-md border border-rule bg-surface px-sm py-xs text-control font-medium text-ink hover:bg-wash focus-ring">{children}<ArrowRight className="h-4 w-4 shrink-0" aria-hidden /></Link>;
}
