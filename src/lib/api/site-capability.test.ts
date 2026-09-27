import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import type { Database } from "@/types/database";
import {
  resolveSitePricingAccess,
  resolveSiteCostReadAccess,
  resolveSiteMarginReadAccess,
  resolveSitePricingReadAccess,
  SITE_CAPABILITY_DEADLINE_MS,
  SiteCapabilityResolutionError,
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
  it("can resolve a cost-only route without requesting unrelated authority", async () => {
    const rpc = rpcResult(() => ({ data: true, error: null }));

    await expect(resolveSiteCostReadAccess(clientWith(rpc), RESTAURANT_ID)).resolves.toBe(true);
    expect(rpc).toHaveBeenCalledWith("effective_site_capability", {
      p_restaurant_id: RESTAURANT_ID,
      p_capability_key: "cost.read",
    });
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("requests only margin.read for a margin-only route", async () => {
    const rpc = rpcResult(() => ({ data: false, error: null }));

    await expect(resolveSiteMarginReadAccess(clientWith(rpc), RESTAURANT_ID))
      .resolves.toBe(false);
    expect(rpc).toHaveBeenCalledWith("effective_site_capability", {
      p_restaurant_id: RESTAURANT_ID,
      p_capability_key: "margin.read",
    });
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("requests both reads but not pricing.manage for mixed protected output", async () => {
    const rpc = rpcResult((capability) => ({
      data: capability !== "margin.read",
      error: null,
    }));

    await expect(resolveSitePricingReadAccess(clientWith(rpc), RESTAURANT_ID))
      .resolves.toBe(false);
    expect(rpc.mock.calls.map(([, args]) => args.p_capability_key)).toEqual([
      "cost.read",
      "margin.read",
    ]);
  });

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

  it("keeps an explicit absence distinct from an evaluator failure", async () => {
    const rpc = rpcResult((capability) => ({
      data: capability === "pricing.manage",
      error: null,
    }));

    await expect(resolveSitePricingAccess(clientWith(rpc), RESTAURANT_ID)).resolves.toEqual({
      canReadCost: false,
      canReadMargin: false,
      canManagePricing: true,
    });
  });

  it.each([
    {
      label: "provider error",
      result: { data: true, error: { message: "function does not exist" } },
    },
    { label: "non-boolean result", result: { data: null, error: null } },
  ])("rejects a $label instead of reporting an absent grant", async ({ result }) => {
    const rpc = vi.fn(() => ({
      abortSignal: vi.fn(async () => result),
    }));

    await expect(
      resolveSitePricingAccess(clientWith(rpc), RESTAURANT_ID),
    ).rejects.toBeInstanceOf(SiteCapabilityResolutionError);
  });

  it("rejects a thrown evaluator failure instead of reporting an absent grant", async () => {
    const rpc = vi.fn(() => ({
      abortSignal: vi.fn(async () => {
        throw new Error("RPC unavailable");
      }),
    }));

    await expect(
      resolveSitePricingAccess(clientWith(rpc), RESTAURANT_ID),
    ).rejects.toBeInstanceOf(SiteCapabilityResolutionError);
  });

  it("aborts and rejects when the authority RPC misses the request deadline", async () => {
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
      const rejection = expect(access).rejects.toBeInstanceOf(
        SiteCapabilityResolutionError,
      );
      await vi.advanceTimersByTimeAsync(SITE_CAPABILITY_DEADLINE_MS);

      await rejection;
      expect(signals).toHaveLength(3);
      expect(signals.every((signal) => signal.aborted)).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});
