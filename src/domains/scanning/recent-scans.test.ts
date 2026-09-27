import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import type { Database } from "@/types/database";

const protectedReaders = vi.hoisted(() => ({
  readInvoiceScanPrivate: vi.fn(),
}));
vi.mock("@/lib/staff-cost/protected-readers", () => protectedReaders);

import { fetchRecentScans } from "./recent-scans";

const RESTAURANT_ID = "11111111-1111-4111-8111-111111111111";
const SCAN_ID = "22222222-2222-4222-8222-222222222222";

function fixture(error: { message: string } | null = null) {
  const row = {
    id: SCAN_ID,
    distributor_name: "Safe Distributor",
    item_count: 2,
    accuracy_score: 0.91,
    created_at: "2026-09-26T12:00:00+00:00",
  };
  const query = {
    select: vi.fn(),
    eq: vi.fn(),
    order: vi.fn(),
    limit: vi.fn(),
    then: (
      resolve: (value: { data: typeof row[] | null; error: typeof error }) => unknown,
      reject?: (reason: unknown) => unknown,
    ) => Promise.resolve({ data: error ? null : [row], error }).then(resolve, reject),
  };
  query.select.mockReturnValue(query);
  query.eq.mockReturnValue(query);
  query.order.mockReturnValue(query);
  query.limit.mockReturnValue(query);
  const from = vi.fn(() => query);
  return {
    client: { from } as unknown as SupabaseClient<Database>,
    from,
    ...query,
  };
}

describe("fetchRecentScans", () => {
  it("returns safe metadata with an explicit restricted cost state", async () => {
    const db = fixture();

    await expect(fetchRecentScans(db.client, RESTAURANT_ID, false)).resolves.toEqual([{
      id: SCAN_ID,
      parsedAt: "2026-09-26T12:00:00+00:00",
      distributor: "Safe Distributor",
      items: 2,
      total: null,
      accuracy: 91,
      hasImage: null,
    }]);
    expect(db.select).toHaveBeenCalledWith(
      "id, distributor_name, item_count, accuracy_score, created_at",
    );
    expect(protectedReaders.readInvoiceScanPrivate).not.toHaveBeenCalled();
  });

  it("derives totals and image presence only from the exact protected row", async () => {
    protectedReaders.readInvoiceScanPrivate.mockResolvedValue({
      scan_id: SCAN_ID,
      restaurant_id: RESTAURANT_ID,
      final_line_items: [
        { qty: 2, unitCost: 15 },
        { qty: 1, unitCost: 9 },
      ],
      has_image: true,
    });

    await expect(fetchRecentScans(fixture().client, RESTAURANT_ID, true))
      .resolves.toEqual([
        expect.objectContaining({ total: 39, hasImage: true }),
      ]);
  });

  it("rejects query and protected-row failures instead of fabricating empty scans", async () => {
    const providerError = { message: "safe query failed" };
    await expect(fetchRecentScans(fixture(providerError).client, RESTAURANT_ID, false))
      .rejects.toBe(providerError);

    protectedReaders.readInvoiceScanPrivate.mockResolvedValue(null);
    await expect(fetchRecentScans(fixture().client, RESTAURANT_ID, true))
      .rejects.toThrow("protected read was incomplete");
  });
});
