"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { BookOpen, Archive, DollarSign, LogOut, Settings, Upload, Users } from "lucide-react";
import { ThemeToggle } from "./theme-toggle";

export function SettingsDropdown() {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const ref = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const itemsRef = useRef<(HTMLElement | null)[]>([]);
  // Where the menu lands, in viewport pixels, measured from the trigger
  // when it opens. The menu is PORTALLED to <body>: the header is a glass
  // strip (backdrop-filter) at z-sticky, which makes it a stacking context,
  // so anything absolutely positioned inside it is capped at the header's
  // own z-index — and the nav dock, the fixed action rails and the cellar's
  // compact masthead all sit at z-chrome, one step above. That is why the
  // menu opened underneath the page's cards. Outside the header it can use
  // the overlay layer it was always assigned.
  const [anchor, setAnchor] = useState<{ top: number; right: number } | null>(null);

  const close = useCallback(() => {
    setOpen(false);
    setActiveIndex(-1);
    triggerRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      const target = e.target as Node;
      if (ref.current?.contains(target) || menuRef.current?.contains(target)) return;
      close();
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        close();
        return;
      }
      const items = itemsRef.current.filter(Boolean) as HTMLElement[];
      if (!items.length) return;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        const next = activeIndex < items.length - 1 ? activeIndex + 1 : 0;
        setActiveIndex(next);
        items[next]?.focus();
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        const prev = activeIndex > 0 ? activeIndex - 1 : items.length - 1;
        setActiveIndex(prev);
        items[prev]?.focus();
      }
    }
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open, close, activeIndex]);

  return (
    <div ref={ref} className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => {
          const rect = triggerRef.current?.getBoundingClientRect();
          if (rect) {
            setAnchor({
              top: rect.bottom + 8,
              right: Math.max(8, window.innerWidth - rect.right),
            });
          }
          setOpen((v) => !v);
        }}
        aria-label="Settings"
        aria-expanded={open}
        aria-haspopup="true"
        className="glass flex h-11 w-11 items-center justify-center rounded-pill text-grey transition-colors hover:text-accent focus-ring md:h-auto md:w-auto md:px-md md:py-sm"
      >
        <Settings className="h-5 w-5 md:h-4 md:w-4" strokeWidth={1.75} aria-hidden="true" />
      </button>

      {open && typeof document !== "undefined" && createPortal(
        <>
      {/* Mobile scrim — the menu floated over a busy screen of chips and
          CTAs with no separation (Kimi audit 2026-08-26). Desktop keeps
          the lightweight dropdown convention. */}
      <div
        className="fixed inset-0 z-[var(--z-overlay)] bg-scrim md:hidden"
        aria-hidden="true"
        onClick={close}
      />
        <div
          ref={menuRef}
          className="glass fixed z-[var(--z-overlay)] w-[180px] rounded-card"
          style={{ top: anchor?.top ?? 64, right: anchor?.right ?? 16 }}
          role="menu"
        >
          <div className="flex flex-col py-xs">
            <Link
              ref={(el) => { itemsRef.current[0] = el; }}
              href="/price-comparison"
              onClick={close}
              role="menuitem"
              tabIndex={-1}
              className="flex min-h-11 items-center gap-sm px-md py-sm text-control text-ink transition-colors hover:text-accent focus-ring"
            >
              <DollarSign className="h-4 w-4 text-grey" strokeWidth={1.75} aria-hidden="true" />
              Pricing
            </Link>
            <Link
              ref={(el) => { itemsRef.current[1] = el; }}
              href="/bins"
              onClick={close}
              role="menuitem"
              tabIndex={-1}
              className="flex min-h-11 items-center gap-sm px-md py-sm text-control text-ink transition-colors hover:text-accent focus-ring"
            >
              <Archive className="h-4 w-4 text-grey" strokeWidth={1.75} aria-hidden="true" />
              Bins
            </Link>
            {/* Reconcile lives on the dashboard as a live-count CTA; the
                duplicate menu entry (without the count) is gone
                (Kimi audit 2026-08-26). */}
            <Link
              ref={(el) => { itemsRef.current[2] = el; }}
              href="/team"
              onClick={close}
              role="menuitem"
              tabIndex={-1}
              className="flex min-h-11 items-center gap-sm px-md py-sm text-control text-ink transition-colors hover:text-accent focus-ring"
            >
              <Users className="h-4 w-4 text-grey" strokeWidth={1.75} aria-hidden="true" />
              Team
            </Link>
            <Link
              ref={(el) => { itemsRef.current[3] = el; }}
              href="/import"
              onClick={close}
              role="menuitem"
              tabIndex={-1}
              className="flex min-h-11 items-center gap-sm px-md py-sm text-control text-ink transition-colors hover:text-accent focus-ring"
            >
              <Upload className="h-4 w-4 text-grey" strokeWidth={1.75} aria-hidden="true" />
              Import
            </Link>
            <Link
              ref={(el) => { itemsRef.current[4] = el; }}
              href="/get-started"
              onClick={close}
              role="menuitem"
              tabIndex={-1}
              className="flex min-h-11 items-center gap-sm px-md py-sm text-control text-ink transition-colors hover:text-accent focus-ring"
            >
              <BookOpen className="h-4 w-4 text-grey" aria-hidden="true" />
              Setup guide
            </Link>
            <div className="mx-md my-xs border-t border-rule" role="separator" />
            <ThemeToggle />
            <div className="mx-md my-xs border-t border-rule" role="separator" />
            <form action="/auth/signout" method="post">
              <button
                ref={(el) => { itemsRef.current[5] = el; }}
                type="submit"
                role="menuitem"
                tabIndex={-1}
                className="flex min-h-11 w-full items-center gap-sm px-md py-sm text-control text-ink transition-colors hover:text-accent focus-ring"
              >
                <LogOut className="h-4 w-4 text-grey" strokeWidth={1.75} aria-hidden="true" />
                Sign out
              </button>
            </form>
          </div>
        </div>
        </>,
        document.body,
      )}
    </div>
  );
}
