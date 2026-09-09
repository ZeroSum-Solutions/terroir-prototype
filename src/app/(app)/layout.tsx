import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronDown } from "lucide-react";
import { getAuthContext } from "@/lib/auth-context";
import { RestaurantProvider } from "@/lib/context/restaurant";
import { SettingsDropdown } from "./settings-dropdown";
import { AssistantPanel } from "./assistant-panel";
import { SearchPalette } from "./search/search-palette";
import { SearchEverywhere } from "./search-everywhere";
import { DesktopNavLinks, MobileNavLinks } from "./nav-links";
import { Fab } from "./fab";
import { ToastWrapper } from "./toast-wrapper";
import { OnboardingModal } from "./onboarding-modal";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const auth = await getAuthContext();
  if (!auth) redirect("/login");

  const { restaurantId, restaurantName, userRole, user } = auth;

  return (
    <RestaurantProvider restaurantId={restaurantId} restaurantName={restaurantName} userRole={userRole}>
      <ToastWrapper>
    <div className="flex min-h-screen flex-col overflow-x-hidden bg-canvas">
      {/* Top bar — minimal on mobile, full nav on md+. Hard-edged on paper
          with a hairline rule beneath (Concept A — "The Cellar Index" —
          replaces the old translucent glass strip: no blur, no shadow,
          just the canvas colour and a border).
          The top safe area is RESERVED, not ignored: viewportFit is "cover",
          so without this the brand mark and the settings control sit under a
          notched iPhone's Dynamic Island when Terroir is installed as a PWA.
          Geometry comes from the chrome tokens in globals.css, never from a
          hand-written 54px in one file and 56px in another. */}
      <header
        className="sticky top-0 z-[var(--z-sticky)] flex items-center border-b border-rule bg-canvas px-md md:px-lg"
        style={{ height: "var(--chrome-header-total)", paddingTop: "var(--safe-top)" }}
      >
        {/* The board's TERROIR wordmark: one heavy blue grotesque, not the
            old two-tone ink/mark split with loosened small-caps tracking. */}
        <Link
          href="/"
          className="inline-flex min-h-11 shrink-0 items-center font-serif text-body-lg font-bold uppercase tracking-[-0.01em] text-primary"
        >
          Terroir
        </Link>

        {/* Restaurant identity — the board pairs the name with a chevron,
            not a role pill squeezed into a fixed-px cap: the old ShellContext
            capped this at max-w-[112px] regardless of what the wordmark and
            icon cluster actually left unclaimed, so a real tenant name
            ("LOCAL SEED - Osteria Scala") truncated to "LOCAL SE…" well
            short of the row's real width. flex-1/min-w-0 lets it claim
            whatever space its shrink-0 siblings don't need instead of a
            number picked with neither in view. The role pill is dropped —
            the board doesn't carry one, and the space it cost is exactly
            what the name needed. The per-page grey eyebrow repeating this
            same string in full is going away with it; see the handoff for
            which routes still carry one outside this file. */}
        <div className="ml-sm flex min-w-0 flex-1 items-center gap-3xs border-l border-rule pl-sm md:ml-md md:pl-md">
          <span className="min-w-0 truncate text-caption font-medium text-ink md:text-ledger">
            {restaurantName?.trim() || "Unnamed restaurant"}
          </span>
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-grey" strokeWidth={2} aria-hidden />
        </div>

        {/* Desktop nav */}
        <nav className="ml-xl hidden items-center gap-lg md:flex" aria-label="Primary">
          <DesktopNavLinks role={userRole} />
        </nav>

        {/* GLOBAL-02 — search reachable from the header on every page.
            Desktop has room for the field itself, inline, in the header's
            unclaimed middle. At 390px there is no such room once the brand,
            the restaurant identity and the icon cluster are placed, so
            mobile collapses it to the icon in that cluster below
            (search-everywhere.tsx) — tapping it opens the same palette
            rather than giving it a permanent full-width band under the
            header on every route, including the ones with no search need
            of their own (/bins, /insights) or their own field already
            (/cellar). */}
        <SearchPalette className="mx-lg hidden min-w-0 max-w-[360px] flex-1 md:block" />

        <div className="ml-auto flex shrink-0 items-center gap-sm md:gap-md">
          <span className="hidden text-ledger font-light tabular text-grey md:inline">
            {user.email}
          </span>
          <SearchEverywhere />
          {/* In the header, not the FAB: the FAB is mobile-only and hidden on
              /scan, /login and /atlas, and the assistant is useful on all of
              them. The header renders on every authenticated page. */}
          <AssistantPanel />
          <SettingsDropdown />
        </div>
      </header>

      {/* Content — mobile bottom padding clears the tab bar AND the FAB,
          whose top edge sits ~136px above the viewport bottom (80px offset
          + 56px button). 88px let it cover the last ~48px of every list
          (Kimi audit 2026-08-26). */}
      {/* Content cap ~1160px (Kimi audit D4): the mobile stack stretched
          full-width to 1440px read as an unfinished desktop. */}
      <main className="mx-auto w-full max-w-[1160px] flex-1 px-md py-lg pb-[calc(var(--chrome-tabbar-total)+var(--chrome-fab)+var(--spacing-2xl))] md:px-lg md:py-xl md:pb-xl">
        {children}
      </main>

      {/* Bottom tab bar — mobile only, thumb-friendly. Now 4 tabs
          per the v5 IA redesign (.council/specs/2026-04-24-ux-ia-redesign.md).
          Was 6-7 tabs (truncating at ~55px on a 390px phone); now ~97px
          per tab. */}
      <nav
        className="fixed inset-x-0 bottom-0 z-[var(--z-chrome)] flex border-t border-rule bg-canvas md:hidden"
        style={{ paddingBottom: "var(--safe-bottom)" }}
        aria-label="Primary mobile"
      >
        <MobileNavLinks role={userRole} />
      </nav>

      {/* Floating Action Button — mobile-only primary actions surface.
          Speed-dial: tap "+" to reveal Scan / Pour / 86.
          Hidden on /scan (already a primary-action surface). */}
      <Fab />

      {/* First-login onboarding — restaurant exists in auth but has no name yet. */}
      {userRole === "owner" && (restaurantName == null || restaurantName.trim() === "") && (
        <OnboardingModal restaurantId={restaurantId} />
      )}
    </div>
    </ToastWrapper>
    </RestaurantProvider>
  );
}
