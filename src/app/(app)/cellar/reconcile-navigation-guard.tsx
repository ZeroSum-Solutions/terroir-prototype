"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ActionDialog } from "@/components/action-dialog";

export function ReconcileNavigationGuard({ dirty, busy, onDiscard, interceptLinks = true }: {
  dirty: boolean;
  busy: boolean;
  onDiscard: () => void;
  interceptLinks?: boolean;
}) {
  const router = useRouter();
  const [destination, setDestination] = useState<string | null>(null);
  useEffect(() => {
    if (!dirty && !busy) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    function navigate(event: MouseEvent) {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const link = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>("a[href]") : null;
      if (!link || link.hasAttribute("download") || (link.target && link.target !== "_self")) return;
      const target = new URL(link.href, window.location.href);
      if (target.pathname === window.location.pathname && target.search === window.location.search && target.origin === window.location.origin) return;
      event.preventDefault();
      event.stopPropagation();
      if (!busy) setDestination(target.href);
    }
    window.addEventListener("beforeunload", warn);
    if (interceptLinks) document.addEventListener("click", navigate, true);
    return () => {
      window.removeEventListener("beforeunload", warn);
      document.removeEventListener("click", navigate, true);
    };
  }, [dirty, busy, interceptLinks]);

  return <ActionDialog open={destination !== null} title="Leave without saving counts?" description="Your changes to the remaining bottle volumes have not been saved." confirmLabel="Discard and leave" cancelLabel="Keep counting" onClose={() => setDestination(null)} onConfirm={() => {
    if (!destination || busy) return;
    const target = new URL(destination);
    onDiscard();
    setDestination(null);
    if (target.origin === window.location.origin) router.push(target.pathname + target.search + target.hash);
    else window.location.assign(target.href);
  }} />;
}
