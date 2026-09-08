"use client";

import { useRef } from "react";
import { useFocusTrap } from "@/lib/hooks/use-focus-trap";
import { RestaurantNameForm } from "./restaurant-name-form";

export function OnboardingModal({ restaurantId }: { restaurantId: string }) {
  const trapRef = useRef<HTMLDivElement>(null);
  useFocusTrap({ containerRef: trapRef, onEscape: () => {} });
  return (
    <div className="fixed inset-0 z-[var(--z-dialog)] flex items-center justify-center overflow-y-auto bg-scrim px-md py-lg" role="dialog" aria-modal="true" aria-labelledby="onboarding-title">
      <div ref={trapRef} className="w-full max-w-[400px] rounded-card card-surface p-lg">
        <h2 id="onboarding-title" className="font-serif text-[22px] font-normal text-ink">Name your restaurant</h2>
        <p className="mt-xs text-[14px] text-grey">Next, bring in your wines and get ready for service. You can change this name later in the setup guide.</p>
        <RestaurantNameForm restaurantId={restaurantId} onboarding />
      </div>
    </div>
  );
}
