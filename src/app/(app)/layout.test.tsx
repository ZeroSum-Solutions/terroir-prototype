import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getAuthContext: vi.fn(),
  restaurantProviderProps: vi.fn(),
  redirect: vi.fn(),
}));

vi.mock("@/lib/auth-context", () => ({
  getAuthContext: (...args: unknown[]) => mocks.getAuthContext(...args),
}));
vi.mock("next/navigation", () => ({
  redirect: (...args: unknown[]) => mocks.redirect(...args),
}));
vi.mock("@/lib/context/restaurant", () => ({
  RestaurantProvider: (props: {
    children: React.ReactNode;
    restaurantId: string;
    restaurantName: string;
    userRole: string;
  }) => {
    mocks.restaurantProviderProps(props);
    return <div data-restaurant-provider="true">{props.children}</div>;
  },
}));
vi.mock("./toast-wrapper", () => ({
  ToastWrapper: ({ children }: { children: React.ReactNode }) => (
    <div data-toast-wrapper="true">{children}</div>
  ),
}));
vi.mock("./settings-dropdown", () => ({
  SettingsDropdown: () => <button data-settings="true">Settings</button>,
}));
vi.mock("./search/search-palette", () => ({
  SearchPalette: ({ className }: { className?: string }) => (
    <input data-global-search="true" type="search" className={className} />
  ),
}));
vi.mock("./nav-links", () => ({
  DesktopNavLinks: () => <span data-desktop-nav="true">Desktop nav</span>,
  MobileNavLinks: () => <span data-mobile-nav="true">Mobile nav</span>,
}));
vi.mock("./fab", () => ({
  Fab: () => <button data-fab="true">Actions</button>,
}));
vi.mock("./onboarding-modal", () => ({
  OnboardingModal: () => <div data-onboarding="true">Onboarding</div>,
}));

const { default: AppLayout } = await import("./layout");

describe("AppLayout header", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = "";
  });

  it("mounts the current restaurant without sacrificing shell edges", async () => {
    const root = await renderLayout("Bar Norman");
    const home = root.querySelector<HTMLAnchorElement>('a[href="/"]')!;
    const settings = root.querySelector('[data-settings="true"]')!;

    expect(home.textContent).toBe("Terroir");
    expect(home.className).toContain("shrink-0");
    expect(home.className).toContain("min-h-11");
    // Restaurant identity renders once, in the header, and is free to use
    // whatever width its shrink-0 siblings don't need — not a role pill
    // squeezed into a fixed-px cap (removed with ShellContext).
    expect(root.querySelector("header")?.textContent).toContain("Bar Norman");
    expect(settings.parentElement?.className).toContain("ml-auto");
    expect(settings.parentElement?.className).toContain("shrink-0");
    // Search renders twice, once per breakpoint: the header field (md:block)
    // and the band beneath it (md:hidden). Both are the same SearchPalette.
    expect(root.querySelectorAll('[data-global-search="true"]')).toHaveLength(2);
    expect(root.querySelector('[data-desktop-nav="true"]')).not.toBeNull();
    expect(root.querySelector('[data-mobile-nav="true"]')).not.toBeNull();
    expect(root.querySelector("header")?.parentElement?.className).toContain(
      "overflow-x-hidden",
    );
    // The bottom gutter clears the tab bar, its safe area and the FAB, and
    // comes from the chrome tokens rather than a hand-written 152px.
    expect(root.querySelector("main")?.className).toContain(
      "pb-[calc(var(--chrome-tabbar-total)+var(--chrome-fab)+var(--spacing-2xl))]",
    );
  });

  it.each(["owner", "manager", "staff"])("only requires owner naming for a null restaurant (%s)", async (role) => {
    const root = await renderLayout(null, role);

    expect(root.querySelector("header")?.textContent).toContain("Unnamed restaurant");
    expect(root.querySelector('[data-onboarding="true"]') !== null).toBe(role === "owner");
  });

  it("keeps the server-only shadow observation out of markup and provider props", async () => {
    const sentinel = "SHADOW_ACCESS_MUST_NOT_SERIALIZE";
    const root = await renderLayout("Bar Norman", "manager", {
      state: "resolved",
      value: {
        siteId: sentinel,
        workspaceId: sentinel,
        legacyRole: "manager",
        roleKey: "beverage_manager",
        capabilities: ["site.read"],
        accessSource: "explicit_site_membership",
      },
    });

    expect(root.innerHTML).not.toContain(sentinel);
    expect(root.innerHTML).not.toContain("shadowAccess");
    expect(mocks.restaurantProviderProps).toHaveBeenCalledTimes(1);
    const providerProps = mocks.restaurantProviderProps.mock.calls[0]?.[0] as
      Record<string, unknown>;
    expect(Object.keys(providerProps).sort()).toEqual([
      "children",
      "restaurantId",
      "restaurantName",
      "userRole",
    ]);
    expect(providerProps).not.toHaveProperty("shadowAccess");
  });
});

async function renderLayout(
  restaurantName: string | null,
  userRole = "manager",
  shadowAccess: unknown = { state: "denied" },
) {
  mocks.getAuthContext.mockResolvedValue({
    restaurantId: "restaurant-1",
    restaurantName,
    userRole,
    shadowAccess,
    user: { email: "manager@example.com" },
  });

  const element = await AppLayout({ children: <p>Dashboard</p> });
  document.body.innerHTML = renderToStaticMarkup(element);
  return document.body;
}
