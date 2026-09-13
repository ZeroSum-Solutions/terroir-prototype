"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { House, Map, Menu, MessageCircle, Wine } from "lucide-react";
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

// The approved mobile-demo IA. Every tab is a real application route;
// authorization continues to be enforced by the destination, never by a
// visual perspective or a hidden link.
const ALL_TABS: Tab[] = [
  { href: "/home", label: "Home", Icon: House },
  { href: "/cellar", label: "Cellar", Icon: Wine },
  { href: "/atlas", label: "Atlas", Icon: Map },
  { href: "/somm", label: "Somm", Icon: MessageCircle },
  { href: "/menu", label: "Menu", Icon: Menu },
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
 * Mobile bottom tab bar. Flex keeps five equal, touch-sized destinations
 * without coupling Tailwind generation to a dynamic grid class.
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
