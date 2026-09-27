import { describe, expect, it, vi } from "vitest";
import { expireStalledScans } from "./stalled-scans";

function client(data: unknown, error: unknown = null) {
  return { rpc: vi.fn().mockResolvedValue({ data, error }), from: vi.fn() };
}

describe("expireStalledScans authorized receipt", () => {
  it.each([0, 1, 37])("returns a verified count of %i from one exact-site RPC", async (count) => {
    const supabase = client({ version: 1, expiredCount: count });
    await expect(expireStalledScans({ supabase: supabase as never, restaurantId: "site-1" })).resolves.toBe(count);
    expect(supabase.rpc).toHaveBeenCalledExactlyOnceWith("expire_stalled_invoice_scans", {
      p_restaurant_id: "site-1",
    });
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it.each([
    null, undefined, [], 0, "0", {},
    { version: 1 }, { expiredCount: 0 },
    { version: 2, expiredCount: 0 },
    { version: "1", expiredCount: 0 },
    { version: 1, expiredCount: "0" },
    { version: 1, expiredCount: -1 },
    { version: 1, expiredCount: 0.5 },
    { version: 1, expiredCount: Number.MAX_SAFE_INTEGER + 1 },
    { version: 1, expiredCount: Number.NaN },
    { version: 1, expiredCount: Number.POSITIVE_INFINITY },
    { version: 1, expiredCount: 0, raw: "unexpected" },
  ])("refuses malformed receipt %# instead of reporting zero", async (data) => {
    const supabase = client(data);
    await expect(expireStalledScans({ supabase: supabase as never, restaurantId: "site-1" })).rejects.toThrow("Invalid stalled-scan expiry receipt");
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it.each(["42501", "42883", "XX000"])("preserves database failure %s instead of silently succeeding", async (code) => {
    const error = { code, message: "private database detail" };
    const supabase = client({ version: 1, expiredCount: 0 }, error);
    await expect(expireStalledScans({ supabase: supabase as never, restaurantId: "site-1" })).rejects.toBe(error);
  });

  it("propagates transport failure", async () => {
    const error = new Error("Network unavailable");
    const supabase = client(null);
    supabase.rpc.mockRejectedValue(error);
    await expect(expireStalledScans({ supabase: supabase as never, restaurantId: "site-1" })).rejects.toBe(error);
  });
});
