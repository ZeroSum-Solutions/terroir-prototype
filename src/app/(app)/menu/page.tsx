import type { Metadata } from "next";
import { getAuthContext } from "@/lib/auth-context";
import { OperationsLauncher } from "../operations-launcher";

export const metadata: Metadata = { title: "Menu" };

export default async function MenuPage() {
  const auth = (await getAuthContext())!;
  return <section className="mx-auto max-w-[860px]">
    <div className="dawn-gradient relative -mx-md -mt-lg mb-lg overflow-hidden px-md pb-lg pt-xl md:-mx-lg md:-mt-xl md:mb-xl md:px-lg md:pb-2xl md:pt-2xl">
      <p className="text-caption font-medium uppercase tracking-[0.18em] text-accent">{auth.restaurantName}</p>
      <h1 className="mt-xs font-serif text-heading font-normal leading-none text-ink lg:text-display">Menu</h1>
      <p className="mt-sm max-w-[560px] text-body text-ink-soft">Everything in the cellar, from receiving to the floor.</p>
    </div>
    <OperationsLauncher userRole={auth.userRole} />
  </section>;
}
