import { beforeEach, describe, expect, it, vi } from "vitest";

const physical = vi.hoisted(() => ({
  executePhysicalBottleCommand: vi.fn(),
  getInventoryContractVersion: vi.fn(),
}));

vi.mock("./physical-bottle-command", () => physical);
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn() }));
vi.mock("@/lib/api/auto-eightysix-revalidation", () => ({
  revalidateAutoEightysixedWines: vi.fn(),
}));

const { recordPour } = await import("./pour-service");

describe("recordPour adapter guard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    physical.getInventoryContractVersion.mockResolvedValue(2);
  });

  it("rejects a physical adapter result without an open bottle", async () => {
    physical.executePhysicalBottleCommand.mockResolvedValue({
      openBottle: null,
      pourEventIds: [],
      replayed: false,
    });

    await expect(recordPour({
      supabase: {} as never,
      operationId: "11111111-1111-4111-8111-111111111111",
      restaurantId: "22222222-2222-4222-8222-222222222222",
      wineId: "55555555-5555-4555-8555-555555555555",
      openBottleId: "66666666-6666-4666-8666-666666666666",
      ml: 150,
      kind: "pour",
    })).rejects.toMatchObject({ message: "invalid_inventory_command_result" });
  });
});
