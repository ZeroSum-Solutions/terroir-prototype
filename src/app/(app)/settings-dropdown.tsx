"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { ArrowUpRight, LogOut, Menu, Settings } from "lucide-react";
import { useFocusTrap } from "@/lib/hooks/use-focus-trap";
import { ThemeToggle } from "./theme-toggle";

export function SettingsDropdown() {
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<{ top: number; right: number } | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const close = useCallback(() => {
    setOpen(false);
  }, []);

  useFocusTrap({ containerRef: menuRef, onEscape: close, enabled: open });

  useEffect(() => {
    if (!open) return;
    function handleClick(event: MouseEvent) {
      const target = event.target as Node;
      if (!ref.current?.contains(target) && !menuRef.current?.contains(target)) close();
    }
    document.addEventListener("mousedown", handleClick);
    return () => {
      document.removeEventListener("mousedown", handleClick);
    };
  }, [close, open]);

  return <div ref={ref} className="relative">
    <button
      ref={triggerRef}
      type="button"
      onClick={() => {
        const rect = triggerRef.current?.getBoundingClientRect();
        if (rect) setAnchor({ top: rect.bottom + 8, right: Math.max(8, window.innerWidth - rect.right) });
        setOpen((value) => !value);
      }}
      aria-label="Settings"
      aria-expanded={open}
      aria-haspopup="dialog"
      className="glass flex h-11 w-11 items-center justify-center rounded-pill text-grey transition-colors hover:text-accent focus-ring md:h-auto md:w-auto md:px-md md:py-sm"
    >
      <Settings className="h-5 w-5 md:h-4 md:w-4" strokeWidth={1.75} aria-hidden />
    </button>

    {open && typeof document !== "undefined" ? createPortal(<>
      <button type="button" className="fixed inset-0 z-[var(--z-overlay)] bg-scrim md:hidden" onClick={() => close()} aria-label="Close settings" />
      <div
        ref={menuRef}
        className="glass fixed inset-x-0 bottom-0 z-[var(--z-overlay)] w-full overflow-hidden rounded-t-[28px] border-x-0 border-b-0 md:inset-x-auto md:bottom-auto md:right-[var(--settings-right)] md:top-[var(--settings-top)] md:w-[340px] md:rounded-card md:border"
        style={{
          "--settings-top": `${anchor?.top ?? 64}px`,
          "--settings-right": `${anchor?.right ?? 16}px`,
        } as CSSProperties}
        role="dialog"
        aria-modal="true"
        aria-label="Settings"
      >
        <div className="border-b border-rule px-md py-sm">
          <p className="font-serif text-body-lg text-ink">Settings</p>
          <p className="mt-2xs text-ledger text-grey">Workspace and appearance</p>
        </div>
        <Link href="/menu" onClick={close} data-settings-action className="flex min-h-11 items-center gap-sm border-b border-rule px-md py-sm text-control text-ink transition-colors hover:text-accent focus-ring">
          <Menu className="h-4 w-4 text-accent" strokeWidth={1.75} aria-hidden />
          <span className="flex-1">Operations menu</span>
          <ArrowUpRight className="h-4 w-4 text-grey" strokeWidth={1.6} aria-hidden />
        </Link>
        <ThemeToggle />
        <form action="/auth/signout" method="post" className="border-t border-rule">
          <button type="submit" data-settings-action className="flex min-h-11 w-full items-center gap-sm px-md py-sm text-control text-ink transition-colors hover:text-accent focus-ring">
            <LogOut className="h-4 w-4 text-grey" strokeWidth={1.75} aria-hidden />
            Sign out
          </button>
        </form>
      </div>
    </>, document.body) : null}
  </div>;
}
