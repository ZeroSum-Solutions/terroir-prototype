import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "@/lib/toast";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const mocks = vi.hoisted(() => ({ getAuthContext: vi.fn(), select: vi.fn(), rpc: vi.fn() }));
vi.mock("@/lib/auth-context", () => ({
  getAuthContext: (...args: unknown[]) => mocks.getAuthContext(...args),
}));
const { default: OpenBottlesPage } = await import("./page");

const RESTAURANT_ID = "22222222-2222-4222-8222-222222222222";
const WINE_ID = "55555555-5555-4555-8555-555555555555";
const BOTTLE_A = "66666666-6666-4666-8666-111111111111";
const BOTTLE_B = "66666666-6666-4666-8666-222222222222";

function authenticate(options: {
  bottles?: unknown[];
  bottleError?: unknown;
  contractVersion?: 1 | 2;
  contractError?: unknown;
  wines?: unknown[];
  wineError?: unknown;
} = {}) {
  mocks.rpc.mockImplementation((name: string) => {
    if (name === "current_inventory_contract_version") {
      return Promise.resolve({
        data: options.contractVersion ?? 1,
        error: options.contractError ?? null,
      });
    }
    return Promise.resolve({
      data: options.bottles ?? [],
      error: options.bottleError ?? null,
    });
  });
  const chain = {
    select: mocks.select, eq: () => chain, in: () => chain,
    then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
      Promise.resolve({ data: options.wines ?? [], error: options.wineError ?? null }).then(resolve, reject),
  };
  mocks.select.mockReturnValue(chain);
  mocks.getAuthContext.mockResolvedValue({
    user: { id: "user-1" }, userRole: "owner", restaurantId: RESTAURANT_ID,
    restaurantName: "House", supabase: { rpc: mocks.rpc, from: vi.fn(() => chain) },
  });
}

describe("OpenBottlesPage", () => {
  beforeEach(() => vi.clearAllMocks());

  it("throws an exact-reader failure instead of presenting it as no bottles", async () => {
    authenticate({ bottleError: new Error("forced reader failure") });
    await expect(OpenBottlesPage()).rejects.toMatchObject({
      message: "invalid_physical_bottle_reader_result",
    });
  });

  it("fails closed when the inventory contract version cannot be observed", async () => {
    authenticate({ contractError: new Error("forced contract failure") });
    await expect(OpenBottlesPage()).rejects.toMatchObject({
      message: "inventory_contract_version_unknown",
    });
  });

  it("renders the genuine no-open-bottle outcome with a reachable cellar action", async () => {
    authenticate();
    const html = renderToStaticMarkup(<ToastProvider>{await OpenBottlesPage()}</ToastProvider>);
    expect(html).toContain("No open bottles");
    expect(html).toContain('href="/cellar"');
    expect(html).toContain("h-11");
  });

  it("renders sibling rows with captured capacity, stable identity, provenance, location, and exact links", async () => {
    authenticate({
      bottles: [bottle(BOTTLE_A, 375, "A-1"), bottle(BOTTLE_B, 600, "B-2")],
      wines: [{ id: WINE_ID, name: "Estate", producer: "House", vintage: 2020,
        hero_image_url: null, colour: "red", size_ml: 1500, unit_cost: 999 }],
    });
    const html = renderToStaticMarkup(<ToastProvider>{await OpenBottlesPage()}</ToastProvider>);
    expect(html.match(/House Estate/g)).toHaveLength(4);
    expect(html).toContain("Standard (750ml)");
    expect(html).not.toContain("Magnum");
    expect(html).toContain("628RYTLL9GS2FTQ998GJMQRRL");
    expect(html).toContain("628RYTLL9GS2FTQ9FVX2EBKF6");
    expect(html).toContain("Tracked source · A-1");
    expect(html).toContain(`/cellar?wine=${WINE_ID}&amp;bottle=${BOTTLE_A}`);
    expect(html).not.toContain("999");
    expect(mocks.select).toHaveBeenCalledWith(
      "id, name, producer, vintage, hero_image_url, colour",
    );
    expect(mocks.rpc).toHaveBeenCalledWith("list_active_physical_bottles", {
      p_restaurant_id: RESTAURANT_ID,
    });
  });

  it.each([
    {
      name: "uses the legacy body when site version 1 returns a contract-2 row",
      contractVersion: 1 as const,
      rowContract: 2 as const,
      expectedBody: { expected_opened_at: "2026-09-23T12:00:00.000Z" },
    },
    {
      name: "uses the physical body when site version 2 returns a legacy row",
      contractVersion: 2 as const,
      rowContract: 1 as const,
      expectedBody: { wine_id: WINE_ID },
    },
  ])("$name", async ({ contractVersion, rowContract, expectedBody }) => {
    authenticate({
      contractVersion,
      bottles: [{ ...bottle(BOTTLE_A, 375, "A-1"), identity_contract: rowContract }],
      wines: [{ id: WINE_ID, name: "Estate", producer: "House", vintage: 2020,
        hero_image_url: null, colour: "red" }],
    });
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      closed: { id: BOTTLE_A, wine_id: WINE_ID, closed_at: "2026-09-23T13:00:00.000Z" },
    }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    await act(async () => root.render(
      <ToastProvider>{await OpenBottlesPage()}</ToastProvider>,
    ));
    await click(container, "Close bottle");
    await click(container, "Confirm discard 12.7 oz");

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual(expectedBody);
    expect(mocks.rpc).toHaveBeenCalledWith("current_inventory_contract_version");
    expect(mocks.rpc.mock.calls.filter(([name]) =>
      name === "current_inventory_contract_version")).toHaveLength(1);
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });
});

async function click(container: HTMLElement, label: string) {
  const button = container.querySelector<HTMLButtonElement>(
    `button[aria-label="${label}"]`,
  );
  if (!button) throw new Error(`No control labelled "${label}"`);
  await act(async () => button.click());
}

function bottle(id: string, remaining: number, location: string) {
  return {
    id, restaurant_id: RESTAURANT_ID, wine_id: WINE_ID, remaining_ml: remaining,
    nominal_capacity_ml: 750, opened_at: "2026-09-23T12:00:00.000Z",
    preservation_method: "argon", source_inventory_item_id: null,
    source_provenance: "known", source_bin_location: location,
    identity_contract: 2, identity_origin: "migrated_active", state_version: 1,
  };
}
