import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import type { Database } from "@/types/database";
import {
  resolveSitePricingAccess,
  SITE_CAPABILITY_DEADLINE_MS,
} from "./site-capability";

const RESTAURANT_ID = "00000000-0000-4000-8000-000000000001";

function clientWith(rpc: ReturnType<typeof vi.fn>): SupabaseClient<Database> {
  return { rpc } as unknown as SupabaseClient<Database>;
}

function rpcResult(
  resolve: (capability: string) => { data: unknown; error: unknown },
) {
  return vi.fn((_name: string, args: { p_capability_key: string }) => ({
    abortSignal: vi.fn(async () => resolve(args.p_capability_key)),
  }));
}

describe("resolveSitePricingAccess", () => {
  it("resolves each exact-site capability independently", async () => {
    const rpc = rpcResult((capability) => ({
      data: capability !== "margin.read",
      error: null,
    }));

    await expect(resolveSitePricingAccess(clientWith(rpc), RESTAURANT_ID)).resolves.toEqual({
      canReadCost: true,
      canReadMargin: false,
      canManagePricing: true,
    });
    expect(rpc.mock.calls).toEqual([
      ["effective_site_capability", { p_restaurant_id: RESTAURANT_ID, p_capability_key: "cost.read" }],
      ["effective_site_capability", { p_restaurant_id: RESTAURANT_ID, p_capability_key: "margin.read" }],
      ["effective_site_capability", { p_restaurant_id: RESTAURANT_ID, p_capability_key: "pricing.manage" }],
    ]);
  });

  it("fails closed when the authority RPC is absent, errors, or returns a non-boolean value", async () => {
    const rpc = vi.fn((_name: string, args: { p_capability_key: string }) => ({
      abortSignal: vi.fn(async () => {
        if (args.p_capability_key === "cost.read") {
          return { data: true, error: { message: "function does not exist" } };
        }
        if (args.p_capability_key === "margin.read") {
          return { data: null, error: null };
        }
        throw new Error("RPC unavailable");
      }),
    }));

    await expect(resolveSitePricingAccess(clientWith(rpc), RESTAURANT_ID)).resolves.toEqual({
      canReadCost: false,
      canReadMargin: false,
      canManagePricing: false,
    });
  });

  it("aborts and denies when the authority RPC misses the request deadline", async () => {
    vi.useFakeTimers();
    try {
      const signals: AbortSignal[] = [];
      const rpc = vi.fn(() => ({
        abortSignal: vi.fn((signal: AbortSignal) => {
          signals.push(signal);
          return new Promise<{ data: unknown; error: unknown }>(() => undefined);
        }),
      }));

      const access = resolveSitePricingAccess(clientWith(rpc), RESTAURANT_ID);
      await vi.advanceTimersByTimeAsync(SITE_CAPABILITY_DEADLINE_MS);

      await expect(access).resolves.toEqual({
        canReadCost: false,
        canReadMargin: false,
        canManagePricing: false,
      });
      expect(signals).toHaveLength(3);
      expect(signals.every((signal) => signal.aborted)).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});
