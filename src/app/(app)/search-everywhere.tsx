"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { Search } from "lucide-react";
import { SearchPalette } from "./search/search-palette";

/**
 * Mobile entry point for global search (GLOBAL-02).
 *
 * At 390px the header has no spare width left for an always-visible field
 * once the wordmark, restaurant identity and the icon cluster are placed
 * (see layout.tsx) — desktop instead keeps <SearchPalette> inline in the
 * header's unclaimed middle (`md:block` there), so this component renders
 * nothing at that breakpoint (`md:hidden`) and desktop's "/" shortcut is
 * untouched by any of this.
 *
 * Replaces the old always-on band that rendered <SearchPalette> full width
 * under the header on every mobile route regardless of need — ~140px of an
 * 844px viewport, spent even on /bins and /insights (neither has a search
 * of its own) and duplicated on /cellar, which already has its own field
 * directly beneath it. The icon opens the same palette on demand instead;
 * closing it (Escape, tapping outside, or navigating) unmounts it again so
 * it costs nothing when not in use.
 */
export function SearchEverywhere() {
  const pathname = usePathname();
  // This sits in the persistent layout, not a per-route tree, so nothing
  // else would reset an open state on navigation. Keying on pathname
  // remounts it fresh on every route change instead of calling setState
  // from an effect (the pattern fab.tsx already uses for the same reason).
  return <SearchEverywhereInner key={pathname} />;
}

function SearchEverywhereInner() {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    rootRef.current?.querySelector<HTMLInputElement>('input[type="search"]')?.focus();

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    function onPointerDown(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("mousedown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("mousedown", onPointerDown);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative md:hidden">
      <button
        type="button"
        aria-label={open ? "Close search" : "Search"}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="grid h-11 w-11 shrink-0 place-items-center rounded-md text-ink-soft transition-colors hover:bg-surface focus-ring"
      >
        <Search className="h-5 w-5" strokeWidth={2} aria-hidden />
      </button>
      {open ? (
        <div
          className="fixed inset-x-0 z-[var(--z-sticky)] border-b border-rule bg-canvas px-md py-sm"
          style={{ top: "var(--chrome-header-total)" }}
        >
          <SearchPalette />
        </div>
      ) : null}
    </div>
  );
}
