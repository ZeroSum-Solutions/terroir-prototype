"use client";

import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { OfflineContextResponseSchema, type OfflineContextResponse } from "@/domains/offline/contract";
import {
  captureDeviceAccessFence,
  provisionOfflineContext,
  type FenceCapture,
  type OfflineReadResult,
  type ProvisionAuthorization,
  type ProvisionResult,
} from "@/domains/offline/database";
import {
  clearReprovisionMarkerAfterCommit,
  HARD_DEVICE_LOCK,
  readAuthorizationGeneration,
  readDeviceLockMarker,
  REPROVISION_REQUIRED,
} from "@/domains/offline/device-lock";
import { readEligibleOfflineContext } from "@/domains/offline/eligibility";

const REQUEST_DEADLINE_MS = 5_000;

export type OfflineContextStatus =
  | { phase: "checking" }
  | { phase: "ready"; value: OfflineContextResponse }
  | {
      phase: "unavailable";
      reason:
        | "hard_lock"
        | "missing_generation"
        | "site_transition_unacknowledged"
        | "storage_failure"
        | "request_failure"
        | "invalid_response"
        | "stale_attempt"
        | "marker_acknowledgement_failed";
    };

type ProviderClock = {
  now: () => number;
  setTimeout: (callback: () => void, delay: number) => () => void;
};
export type OfflineContextProviderDependencies = {
  readCookieHeader: () => string;
  captureFence: () => Promise<FenceCapture>;
  requestContext: (signal: AbortSignal) => Promise<Response>;
  provision: (
    value: OfflineContextResponse,
    authorization: ProvisionAuthorization,
  ) => Promise<ProvisionResult>;
  clearMarker: (authorizationGeneration: string) => boolean;
  readEligible: (userId: string, restaurantId: string) => Promise<OfflineReadResult>;
  clock: ProviderClock;
};

const defaultDependencies: OfflineContextProviderDependencies = {
  readCookieHeader: () => globalThis.document?.cookie ?? "",
  captureFence: () => captureDeviceAccessFence(),
  requestContext: (signal) => fetch("/api/offline-context", {
    method: "GET",
    credentials: "same-origin",
    cache: "no-store",
    signal,
  }),
  provision: (value, authorization) => provisionOfflineContext(value, authorization),
  clearMarker: (authorizationGeneration) =>
    clearReprovisionMarkerAfterCommit(authorizationGeneration),
  readEligible: (userId, restaurantId) => readEligibleOfflineContext(userId, restaurantId),
  clock: {
    now: Date.now,
    setTimeout(callback, delay) {
      const handle = globalThis.setTimeout(callback, delay);
      return () => globalThis.clearTimeout(handle);
    },
  },
};

const StatusContext = createContext<OfflineContextStatus>({ phase: "checking" });

function settleRequest(
  request: Promise<Response>,
  controller: AbortController,
  clock: ProviderClock,
): Promise<Response | null> {
  return new Promise((resolve) => {
    let settled = false;
    let cancelDeadline: () => void = () => undefined;
    const finish = (response: Response | null) => {
      if (settled) return;
      settled = true;
      cancelDeadline();
      resolve(response);
    };
    try {
      cancelDeadline = clock.setTimeout(() => {
        controller.abort();
        finish(null);
      }, REQUEST_DEADLINE_MS);
    } catch {
      controller.abort();
      finish(null);
    }
    request.then((response) => finish(response), () => finish(null));
  });
}

function sameValue(left: OfflineContextResponse, right: OfflineContextResponse) {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function useOfflineContextStatus() {
  return useContext(StatusContext);
}

export function OfflineContextProvider({
  userId,
  restaurantId,
  children,
  dependencies = defaultDependencies,
}: {
  userId: string;
  restaurantId: string;
  children: React.ReactNode;
  dependencies?: OfflineContextProviderDependencies;
}) {
  const [status, setStatus] = useState<OfflineContextStatus>({ phase: "checking" });
  const attemptRef = useRef(0);

  useEffect(() => {
    const attempt = attemptRef.current + 1;
    attemptRef.current = attempt;
    let active = true;
    const current = () => active && attemptRef.current === attempt;
    const unavailable = (reason: Extract<OfflineContextStatus, { phase: "unavailable" }>["reason"]) => {
      if (current()) setStatus({ phase: "unavailable", reason });
    };
    let controller: AbortController | null;
    try { controller = new AbortController(); } catch { controller = null; }
    if (controller === null) {
      void Promise.resolve().then(() => unavailable("request_failure"));
      return () => {
        active = false;
        attemptRef.current += 1;
      };
    }
    void (async () => {
      await Promise.resolve();
      if (!current()) return;
      setStatus({ phase: "checking" });
      let cookieHeader: string;
      try { cookieHeader = dependencies.readCookieHeader(); } catch {
        unavailable("missing_generation");
        return;
      }
      const marker = readDeviceLockMarker(cookieHeader);
      const authorizationGeneration = readAuthorizationGeneration(cookieHeader);
      if (marker === HARD_DEVICE_LOCK) { unavailable("hard_lock"); return; }
      if (authorizationGeneration === null) { unavailable("missing_generation"); return; }

      if (marker === null) {
        const read = await dependencies.readEligible(userId, restaurantId).catch(() => null);
        if (!current()) return;
        if (read?.status === "ready") setStatus({ phase: "ready", value: read.value });
        else unavailable("site_transition_unacknowledged");
        return;
      }
      if (marker !== REPROVISION_REQUIRED) { unavailable("hard_lock"); return; }

      const captured = await dependencies.captureFence().catch(() => null);
      if (!current()) return;
      if (!captured || captured.status !== "captured") { unavailable("storage_failure"); return; }

      let request: Promise<Response>;
      try { request = Promise.resolve(dependencies.requestContext(controller.signal)); } catch {
        request = Promise.reject(new Error("request unavailable"));
      }
      const response = await settleRequest(request, controller, dependencies.clock);
      if (!current()) return;
      if (!response || response.status !== 200) { unavailable("request_failure"); return; }

      let payload: unknown;
      try { payload = await response.json(); } catch { unavailable("invalid_response"); return; }
      const parsed = OfflineContextResponseSchema.safeParse(payload);
      if (!parsed.success || parsed.data.context.userId !== userId ||
        parsed.data.context.restaurantId !== restaurantId) {
        unavailable("invalid_response");
        return;
      }
      let observedAt: number;
      try { observedAt = dependencies.clock.now(); } catch {
        unavailable("invalid_response");
        return;
      }
      if (!Number.isFinite(observedAt) ||
        observedAt < Date.parse(parsed.data.context.issuedAt) ||
        observedAt >= Date.parse(parsed.data.context.expiresAt)) {
        unavailable("invalid_response");
        return;
      }
      let finalCookie: string;
      try { finalCookie = dependencies.readCookieHeader(); } catch {
        unavailable("stale_attempt");
        return;
      }
      if (!current() || readDeviceLockMarker(finalCookie) !== REPROVISION_REQUIRED ||
        readAuthorizationGeneration(finalCookie) !== authorizationGeneration) {
        unavailable("stale_attempt");
        return;
      }

      const stored = await dependencies.provision(parsed.data, {
        userId,
        restaurantId,
        authorizationGeneration,
        marker: REPROVISION_REQUIRED,
        capturedFence: captured.fence,
      }).catch(() => null);
      if (!current()) return;
      if (!stored || stored.status !== "stored") { unavailable("storage_failure"); return; }

      let acknowledged = false;
      try { acknowledged = dependencies.clearMarker(authorizationGeneration); } catch {
        acknowledged = false;
      }
      const readback = await dependencies.readEligible(userId, restaurantId).catch(() => null);
      if (!current()) return;
      if (!acknowledged) { unavailable("marker_acknowledgement_failed"); return; }
      if (readback?.status === "ready" && sameValue(readback.value, parsed.data)) {
        setStatus({ phase: "ready", value: readback.value });
      } else {
        unavailable("storage_failure");
      }
    })();

    return () => {
      active = false;
      attemptRef.current += 1;
      controller.abort();
    };
  }, [dependencies, restaurantId, userId]);

  return <StatusContext.Provider value={status}>{children}</StatusContext.Provider>;
}
