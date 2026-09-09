"use client";

import { useRef } from "react";
import { useFocusTrap } from "@/lib/hooks/use-focus-trap";
import { RestaurantNameForm } from "./restaurant-name-form";

export function OnboardingModal({ restaurantId }: { restaurantId: string }) {
  const trapRef = useRef<HTMLDivElement>(null);
  useFocusTrap({ containerRef: trapRef, onEscape: () => {} });
  return (
    <div className="fixed inset-0 z-[var(--z-dialog)] flex items-end justify-center overflow-y-auto bg-scrim p-md sm:items-center" role="dialog" aria-modal="true" aria-labelledby="onboarding-title">
      <div ref={trapRef} className="glass w-full rounded-t-card p-lg pb-[calc(var(--safe-bottom)+var(--spacing-lg))] sm:max-w-[400px] sm:rounded-card sm:pb-lg">
        <p className="text-micro uppercase tracking-[0.12em] text-accent">Step 1</p>
        <h2 id="onboarding-title" className="font-serif text-subheading font-normal leading-tight text-ink">Name your restaurant</h2>
        <p className="mt-xs text-body-sm text-ink-soft">Next, bring in your wines and get ready for service. You can change this name later in the setup guide.</p>
        <RestaurantNameForm restaurantId={restaurantId} onboarding />
      </div>
    </div>
  );
}
