import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getAuthContext: vi.fn(),
  getVersion: vi.fn(),
  listBottles: vi.fn(),
}));

vi.mock("@/lib/auth-context", () => ({
  getAuthContext: (...args: unknown[]) => mocks.getAuthContext(...args),
}));
vi.mock("@/domains/pours/physical-bottle-command", () => ({
  getInventoryContractVersion: (...args: unknown[]) => mocks.getVersion(...args),
  listActivePhysicalBottles: (...args: unknown[]) => mocks.listBottles(...args),
}));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("../reconcile-list", () => ({
  ReconcileList: (props: { inventoryContractVersion: number; initialItems: unknown[] }) => (
    <output
      data-contract-version={props.inventoryContractVersion}
      data-items={JSON.stringify(props.initialItems)}
    />
  ),
}));

const { default: ReconcilePage } = await import("./page");
const RESTAURANT_ID = "11111111-1111-4111-8111-111111111111";
const WINE_ID = "22222222-2222-4222-8222-222222222222";
const BOTTLE_A = "00000000-0000-4000-8000-00000000000f";
const BOTTLE_B = "00000000-0000-4000-8000-000000000010";

function query(result: unknown) {
  const chain = {
    select: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    in: vi.fn(() => Promise.resolve(result)),
    limit: vi.fn(() => chain),
    maybeSingle: vi.fn(() => Promise.resolve(result)),
  };
  return chain;
}

beforeEach(() => {
  vi.clearAllMocks();
  const wines = query({
    data: [{ id: WINE_ID, producer: "Producer", name: "Wine", vintage: 2022 }],
    error: null,
  });
  const config = query({ data: { reconcile_variance_threshold_oz: 1.5 }, error: null });
  const supabase = {
    rpc: vi.fn().mockResolvedValue({ data: [], error: null }),
    from: vi.fn((table: string) => table === "wines" ? wines : config),
  };
  mocks.getAuthContext.mockResolvedValue({
    supabase,
    restaurantId: RESTAURANT_ID,
    userRole: "manager",
    user: { id: "user-1" },
  });
});

describe("dedicated reconciliation page contract dispatch", () => {
  it("renders one exact DTO per physical sibling in stable UUID order", async () => {
    mocks.getVersion.mockResolvedValue(2);
    mocks.listBottles.mockResolvedValue([BOTTLE_B, BOTTLE_A].map((id, index) => ({
      id,
      wineId: WINE_ID,
      remainingMl: 400 - index * 50,
      nominalCapacityMl: 750,
      openedAt: "2026-09-24T12:00:00.000Z",
      preservationMethod: "none",
      sourceProvenance: "known",
      sourceBinLocation: null,
      identityContract: 2,
      identityOrigin: "native",
      stateVersion: index + 4,
    })));

    const html = renderToStaticMarkup(await ReconcilePage());
    const encoded = html.match(/data-items="([^"]+)"/)?.[1] ?? "";
    const items = JSON.parse(encoded.replaceAll("&quot;", '"')) as Array<{ openBottleId: string }>;
    expect(items.map((item) => item.openBottleId)).toEqual([BOTTLE_A, BOTTLE_B]);
    expect(html).toContain('data-contract-version="2"');
  });

  it("preserves the legacy wine-keyed reader when the contract is version 1", async () => {
    mocks.getVersion.mockResolvedValue(1);
    const auth = await mocks.getAuthContext();
    auth.supabase.rpc.mockResolvedValue({ data: [{
      wine_id: WINE_ID,
      wine_list_item_id: "item-1",
      producer: "Producer",
      name: "Wine",
      vintage: 2022,
      size_ml: 750,
      sealed_count: 0,
      opened_at: "2026-09-24T12:00:00.000Z",
      open_remaining_ml: 300,
      glass_pour_ml: 150,
      pour_size_mode: "fixed",
    }], error: null });
    mocks.getAuthContext.mockResolvedValue(auth);

    const html = renderToStaticMarkup(await ReconcilePage());
    expect(html).toContain('data-contract-version="1"');
    expect(mocks.listBottles).not.toHaveBeenCalled();
    expect(auth.supabase.rpc).toHaveBeenCalledWith("list_open_bottle_items", {
      p_restaurant_id: RESTAURANT_ID,
    });
  });

  it("fails closed when contract authority cannot be read", async () => {
    mocks.getVersion.mockRejectedValue(new Error("inventory_contract_version_unknown"));
    await expect(ReconcilePage()).rejects.toThrow("inventory_contract_version_unknown");
    expect(mocks.listBottles).not.toHaveBeenCalled();
  });
});
