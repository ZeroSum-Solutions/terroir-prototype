import Link from "next/link";
import { redirect } from "next/navigation";
import { getAuthContext } from "@/lib/auth-context";
import { isLocalSupabaseTarget } from "@/lib/local-stack";
import { RestaurantProvider } from "@/lib/context/restaurant";
import { SettingsDropdown } from "./settings-dropdown";
import { AssistantPanel } from "./assistant-panel";
import { SearchPalette } from "./search/search-palette";
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
  const onLocalStack = isLocalSupabaseTarget();

  return (
    <RestaurantProvider restaurantId={restaurantId} restaurantName={restaurantName} userRole={userRole}>
      <ToastWrapper>
    <div className="flex min-h-screen flex-col overflow-x-hidden bg-canvas">
      {/* Top bar — minimal on mobile, full nav on md+. A glass strip
          (DESIGN.md — Components, Header): translucent, blurred over
          whatever scrolls beneath it, a hairline glass edge below.
          The top safe area is RESERVED, not ignored: viewportFit is "cover",
          so without this the brand mark and the settings control sit under a
          notched iPhone's Dynamic Island when Terroir is installed as a PWA.
          Geometry comes from the chrome tokens in globals.css, never from a
          hand-written 54px in one file and 56px in another. */}
      <header
        className="glass sticky top-0 z-[var(--z-sticky)] flex items-center rounded-none border-x-0 border-t-0 border-b border-glass-edge px-md md:px-lg"
        style={{ height: "var(--chrome-header-total)", paddingTop: "var(--safe-top)" }}
      >
        {/* The wordmark: the named face, uppercase, wide-tracked, in bone
            (DESIGN.md — Components, Header). */}
        <Link
          href="/"
          className="inline-flex min-h-11 shrink-0 items-center font-serif text-body font-medium uppercase tracking-[0.22em] text-primary md:text-body-lg md:tracking-[0.28em]"
        >
          Terroir
        </Link>

        {/* Restaurant identity — the board pairs the name with a chevron,
            not a role pill squeezed into a fixed-px cap: the old ShellContext
            capped this at max-w-[112px] regardless of what the wordmark and
            icon cluster actually left unclaimed, so a real tenant name
            truncated well short of the row's real width. flex-1/min-w-0 lets it claim
            whatever space its shrink-0 siblings don't need instead of a
            number picked with neither in view. The role pill is dropped —
            the board doesn't carry one, and the space it cost is exactly
            what the name needed. The per-page grey eyebrow repeating this
            same string in full is going away with it; see the handoff for
            which routes still carry one outside this file. */}
        <div className="ml-sm flex min-w-0 flex-1 items-center gap-3xs border-l border-rule-strong pl-sm md:ml-md md:pl-md">
          {/* text-ledger at every width, not text-caption on phones. The
              caption token carries 0.18em of tracking, which is right for the
              uppercase eyebrows it was made for and wrong for a proper noun:
              it spread a 13-character restaurant name over ~112px of a 390px
              header and truncated it. The same name in ledger, one pixel
              larger and untracked, is ~85px and fits whole. */}
          <span className="min-w-0 truncate text-ledger font-medium text-ink">
            {restaurantName?.trim() || "Unnamed restaurant"}
          </span>
          {/* Which database am I looking at? That question used to be answered
              by the demo tenant's own name — the local seed called itself
              "LOCAL SEED - Osteria Scala" — which meant the answer only
              existed if someone had remembered to prefix the row, cost the
              header its whole width on a phone, and told an investor the
              prototype was test data. It is derived from the connection now
              (src/lib/local-stack.ts): it cannot be renamed away, and it can
              never appear on a hosted deployment. */}
          {onLocalStack && (
            <span
              title="Connected to a local Supabase stack, not hosted data"
              className="shrink-0 rounded-pill border border-risk-ink/40 px-xs py-2xs text-micro font-medium uppercase tracking-[0.14em] text-risk-ink"
            >
              Local
            </span>
          )}
        </div>

        {/* Desktop nav */}
        <nav className="ml-xl hidden items-center gap-lg md:flex" aria-label="Primary">
          <DesktopNavLinks role={userRole} />
        </nav>

        {/* GLOBAL-02 — the search field is at the top of every page.
            Desktop has room for it inline, in the header's unclaimed middle;
            390px does not, so the phone gets the band below the header
            instead. Both are this same SearchPalette, one per breakpoint. */}
        <SearchPalette className="mx-lg hidden min-w-0 max-w-[360px] flex-1 md:block" />

        <div className="ml-auto flex shrink-0 items-center gap-sm md:gap-md">
          <span className="hidden text-ledger font-light tabular text-grey md:inline">
            {user.email}
          </span>
          {/* In the header, not the FAB: the FAB is mobile-only and hidden on
              /scan, /login and /atlas, and the assistant is useful on all of
              them. The header renders on every authenticated page. */}
          <AssistantPanel />
          <SettingsDropdown />
        </div>
      </header>

      {/* Mobile placement of the same field, restored. The Cellar Index pass
          replaced this band with a search ICON in the header cluster, on the
          reasoning that 390px has no room for a permanent field once the
          brand, tenant and controls are placed, and that /bins and /insights
          have no search need of their own. Both points are true and neither
          is the requirement: GLOBAL-02 asks for search AT THE TOP OF EVERY
          PAGE, and e2e/global-search.test.ts asserts a visible field under
          the header on a phone in as many words. An icon that opens the same
          palette is a menu item, which is the thing that assertion names as
          the failure. Sticky rather than fixed: in flow it reserves its own
          height, so nothing downstream has to know its size to clear it. */}
      <div
        className="glass sticky z-[var(--z-sticky)] rounded-none border-x-0 border-t-0 border-b border-glass-edge px-md py-sm md:hidden"
        style={{ top: "var(--chrome-header-total)" }}
      >
        <SearchPalette />
      </div>

      {/* Content — mobile bottom padding clears the tab bar AND the FAB,
          whose top edge sits ~136px above the viewport bottom (80px offset
          + 56px button). 88px let it cover the last ~48px of every list
          (Kimi audit 2026-08-26). */}
      {/* Content cap ~1160px (Kimi audit D4): the mobile stack stretched
          full-width to 1440px read as an unfinished desktop. */}
      <main className="mx-auto w-full max-w-[1160px] flex-1 px-md py-lg pb-[calc(var(--chrome-tabbar-total)+var(--chrome-fab)+var(--spacing-2xl))] md:px-lg md:py-xl md:pb-xl">
        {children}
      </main>

      {/* Bottom nav dock — mobile only, thumb-friendly. A glass pill
          floating above the safe area (DESIGN.md — Components, Nav Dock),
          not a flush bar. Five tabs per the v5 IA redesign
          (.council/specs/2026-04-24-ux-ia-redesign.md) plus D5's Atlas. */}
      <nav
        className="glass fixed inset-x-md z-[var(--z-chrome)] flex rounded-pill md:hidden"
        style={{ bottom: "calc(var(--safe-bottom) + var(--spacing-md))", height: "var(--chrome-tabbar)" }}
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
