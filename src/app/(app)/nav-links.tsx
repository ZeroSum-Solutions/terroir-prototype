"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BarChart3, ListOrdered, Map, ScanLine, Wine } from "lucide-react";
import { cn } from "@/lib/utils";

type Role = "owner" | "manager" | "staff";

type Tab = {
  href: string;
  label: string;
  Icon: React.ComponentType<{
    className?: string;
    strokeWidth?: number;
    "aria-hidden"?: boolean;
  }>;
  // Undefined = all roles. Otherwise only the listed roles see the tab.
  requires?: Role[];
};

// 5-tab IA (Atlas center tab, D5) — was the 4-tab set per
// .council/specs/2026-04-24-ux-ia-redesign.md (itself a consolidation of
// 7: Scanner / Wine Lists / Pour / Availability / Reconcile / Dashboard /
// Cellar — bloated past the prototype's 3-tab intent and truncated on
// 390px phones at ~55px per tab). Pour + Availability + Reconcile + the
// original bin grid all live inside /cellar (single-screen with rich
// row-actions). Atlas joins as a fifth, center tab — 390px/5 lands at
// ~78px per tab, still comfortably above the 55px truncation floor the
// 7->4 collapse was fixing. Default landing per role is handled at
// src/app/page.tsx.
const ALL_TABS: Tab[] = [
  { href: "/scan", label: "Scan", Icon: ScanLine },
  { href: "/cellar", label: "Cellar", Icon: Wine },
  { href: "/atlas", label: "Atlas", Icon: Map },
  { href: "/lists", label: "Lists", Icon: ListOrdered },
  { href: "/insights", label: "Insights", Icon: BarChart3 },
];

function visibleTabs(role: Role): Tab[] {
  return ALL_TABS.filter((t) => !t.requires || t.requires.includes(role));
}

/** Desktop top nav links with aria-current for the active route. */
export function DesktopNavLinks({ role }: { role: Role }) {
  const tabs = visibleTabs(role);
  const pathname = usePathname();
  return (
    <>
      {tabs.map(({ href, label }) => {
        const active = pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "inline-flex min-h-11 min-w-11 items-center justify-center py-sm text-body-sm font-medium transition-colors",
              active ? "text-mark" : "text-ink-soft hover:text-ink",
            )}
          >
            {label}
          </Link>
        );
      })}
    </>
  );
}

/**
 * Mobile bottom tab bar. Uses flex so N tabs distribute evenly without
 * Tailwind needing a grid-cols-N class at build time. v5 IA collapsed
 * the previous 7-tab nav to 4, then D5 added Atlas as a fifth, center
 * tab — touch targets at ~78px each on a 390px phone (was 55px and
 * truncating at 7 tabs).
 */
export function MobileNavLinks({ role }: { role: Role }) {
  const tabs = visibleTabs(role);
  const pathname = usePathname();
  return (
    <>
      {tabs.map(({ href, label, Icon }) => {
        const active = pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={cn(
              // Inside the glass dock, colour-only "you are here": the
              // active item is bone, the rest ash (DESIGN.md — Nav Dock).
              // The size lives on the label span, not here: tailwind-merge
              // cannot tell a custom text-<size> from a text-<colour> and
              // keeps only the last, so `text-micro text-grey` would drop the size.
              "flex min-h-[64px] flex-1 flex-col items-center justify-center gap-2xs px-2xs py-xs font-medium transition-colors first:rounded-l-pill last:rounded-r-pill",
              active ? "text-primary" : "text-grey active:text-ink",
            )}
          >
            <Icon
              className={cn("h-[22px] w-[22px]", active && "text-primary")}
              strokeWidth={active ? 1.9 : 1.6}
              aria-hidden
            />
            <span className="truncate text-micro tracking-normal">{label}</span>
          </Link>
        );
      })}
    </>
  );
}
