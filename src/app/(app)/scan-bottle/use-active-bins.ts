"use client";

import { useEffect, useState } from "react";
import { z } from "zod";

const ActiveBinsSchema = z.array(z.object({ id: z.string().uuid(), code: z.string().min(1) }))
  .refine((bins) => new Set(bins.map((bin) => bin.id.toLowerCase())).size === bins.length);
export type ActiveBin = z.infer<typeof ActiveBinsSchema>[number];
export type ActiveBinsState =
  | { status: "loading"; bins: ActiveBin[] }
  | { status: "ready"; bins: ActiveBin[] }
  | { status: "error"; bins: ActiveBin[] };

export function useActiveBins(enabled: boolean) {
  const [attempt, setAttempt] = useState(0);
  const [snapshot, setSnapshot] = useState<{ enabled: boolean; attempt: number; state: ActiveBinsState }>({ enabled, attempt, state: { status: "loading", bins: [] } });
  const currentRequest = snapshot.enabled === enabled && snapshot.attempt === attempt;
  const state: ActiveBinsState = currentRequest ? snapshot.state : { status: "loading", bins: [] };
  if (!currentRequest) setSnapshot({ enabled, attempt, state });
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    let current = true;
    const timer = window.setTimeout(() => controller.abort(), 15_000);
    void (async () => {
      try {
        const response = await fetch("/api/bins", { signal: controller.signal, cache: "no-store" });
        if (!response.ok) throw new Error("Bin list unavailable");
        const bins = ActiveBinsSchema.parse(await response.json());
        if (current) setSnapshot({ enabled, attempt, state: { status: "ready", bins } });
      } catch {
        if (current) setSnapshot({ enabled, attempt, state: { status: "error", bins: [] } });
      } finally { window.clearTimeout(timer); }
    })();
    return () => { current = false; controller.abort(); window.clearTimeout(timer); };
  }, [enabled, attempt]);
  return { ...state, reload: () => setAttempt((value) => value + 1) };
}
