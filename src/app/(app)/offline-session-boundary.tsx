"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  lockAllContexts,
  type OfflineLockResult,
} from "@/domains/offline/database";
import {
  HARD_DEVICE_LOCK,
  readAuthorizationGeneration,
  readDeviceLockMarker,
  writeClientDeviceLock,
} from "@/domains/offline/device-lock";
import {
  INTERNAL_SIGNOUT_HEADER,
  INTERNAL_SIGNOUT_VALUE,
} from "@/lib/auth/same-origin-request";

const SIGN_OUT_DEADLINE_MS = 5_000;

type SignOutResult =
  | "locked_server_unconfirmed"
  | "unlocked_server_unconfirmed"
  | "server_confirmed_lock_unverified";

type BoundaryState =
  | { phase: "active" }
  | { phase: "pending"; attempt: number }
  | { phase: "unresolved"; attempt: number; result: SignOutResult };

type BoundaryClock = {
  setTimeout: (callback: () => void, delay: number) => () => void;
};

export type OfflineSessionBoundaryDependencies = {
  requestSignOut: (signal: AbortSignal) => Promise<Response>;
  lockDevice: (authorizationGeneration: string | null) => Promise<OfflineLockResult>;
  writeHardMarker: () => boolean;
  readMarker: () => string | null;
  readGeneration: () => string | null;
  navigate: (path: string) => void;
  clock: BoundaryClock;
};

type BoundaryControls = {
  beginSignOut: () => void;
  signOutInProgress: boolean;
};

const BoundaryContext = createContext<BoundaryControls | null>(null);

const defaultDependencies: OfflineSessionBoundaryDependencies = {
  requestSignOut(signal) {
    return fetch("/auth/signout", {
      method: "POST",
      credentials: "same-origin",
      redirect: "error",
      signal,
      headers: { [INTERNAL_SIGNOUT_HEADER]: INTERNAL_SIGNOUT_VALUE },
    });
  },
  lockDevice(authorizationGeneration) {
    return lockAllContexts("sign_out", authorizationGeneration, () => undefined);
  },
  writeHardMarker() {
    return writeClientDeviceLock(HARD_DEVICE_LOCK);
  },
  readMarker() {
    return readDeviceLockMarker();
  },
  readGeneration() {
    return readAuthorizationGeneration();
  },
  navigate(path) {
    window.location.assign(path);
  },
  clock: {
    setTimeout(callback, delay) {
      const handle = window.setTimeout(callback, delay);
      return () => window.clearTimeout(handle);
    },
  },
};

function settleServerRequest(
  request: Promise<Response>,
  controller: AbortController,
  clock: BoundaryClock,
) {
  return new Promise<boolean>((resolve) => {
    let settled = false;
    let cancelDeadline: () => void = () => undefined;
    const finish = (confirmed: boolean) => {
      if (settled) return;
      settled = true;
      cancelDeadline();
      resolve(confirmed);
    };
    cancelDeadline = clock.setTimeout(() => {
      controller.abort();
      finish(false);
    }, SIGN_OUT_DEADLINE_MS);
    request.then(
      (response) => finish(response.status === 204),
      () => finish(false),
    );
  });
}

async function runSignOut(dependencies: OfflineSessionBoundaryDependencies) {
  let authorizationGeneration: string | null = null;
  try {
    authorizationGeneration = dependencies.readGeneration();
  } catch {
    authorizationGeneration = null;
  }
  const controller = new AbortController();
  let request: Promise<Response>;
  try {
    request = Promise.resolve(dependencies.requestSignOut(controller.signal));
  } catch {
    request = Promise.reject(new Error("sign-out request unavailable"));
  }
  const serverResult = settleServerRequest(
    request,
    controller,
    dependencies.clock,
  );

  const cookieResult = Promise.resolve().then(() => {
    try {
      return dependencies.writeHardMarker();
    } catch {
      return false;
    }
  });
  const databaseResult = Promise.resolve()
    .then(() => dependencies.lockDevice(authorizationGeneration))
    .catch(() => ({
      locked: false,
      denialFenceCommitted: false,
      projectionsDeleted: false,
    }));

  const [serverSignOut, clientCookieVerified, database] = await Promise.all([
    serverResult,
    cookieResult,
    databaseResult,
  ]);
  let responseCookieVerified = false;
  try {
    responseCookieVerified = dependencies.readMarker() === HARD_DEVICE_LOCK;
  } catch {
    responseCookieVerified = false;
  }
  const durableLock =
    database.denialFenceCommitted || database.locked ||
    clientCookieVerified || responseCookieVerified;

  if (serverSignOut && durableLock) return { navigate: true as const };
  if (!serverSignOut && durableLock) {
    return { result: "locked_server_unconfirmed" as const };
  }
  if (serverSignOut) {
    return { result: "server_confirmed_lock_unverified" as const };
  }
  return { result: "unlocked_server_unconfirmed" as const };
}

const messages: Record<SignOutResult, string> = {
  locked_server_unconfirmed:
    "Locked on this device. Server sign-out is not confirmed.",
  unlocked_server_unconfirmed:
    "This device lock could not be saved. Server sign-out is not confirmed.",
  server_confirmed_lock_unverified:
    "Online sign-out completed, but this device lock was not verified. Do not hand this device to another person until retry or recovery succeeds.",
};

export function useOfflineSessionBoundary() {
  return useContext(BoundaryContext);
}

export function OfflineSessionBoundary({
  children,
  dependencies = defaultDependencies,
}: {
  children: React.ReactNode;
  dependencies?: OfflineSessionBoundaryDependencies;
}) {
  const [state, setState] = useState<BoundaryState>({ phase: "active" });
  const runningRef = useRef(false);
  const attemptDependenciesRef = useRef(dependencies);

  const beginSignOut = useCallback(() => {
    setState((current) => {
      if (current.phase === "pending") return current;
      attemptDependenciesRef.current = dependencies;
      return { phase: "pending", attempt: ("attempt" in current ? current.attempt : 0) + 1 };
    });
  }, [dependencies]);

  const phase = state.phase;
  const attempt = "attempt" in state ? state.attempt : 0;

  useEffect(() => {
    if (phase !== "pending" || runningRef.current) return;
    runningRef.current = true;
    let active = true;
    const attemptDependencies = attemptDependenciesRef.current;
    void runSignOut(attemptDependencies).then((outcome) => {
      if (!active) return;
      runningRef.current = false;
      if ("navigate" in outcome) {
        attemptDependencies.navigate("/login");
        return;
      }
      setState({
        phase: "unresolved",
        attempt,
        result: outcome.result,
      });
    });
    return () => {
      active = false;
    };
  }, [attempt, phase]);

  useEffect(() => {
    if (state.phase !== "unresolved") return;
    const retry = () => beginSignOut();
    window.addEventListener("online", retry);
    return () => window.removeEventListener("online", retry);
  }, [beginSignOut, state.phase]);

  if (state.phase !== "active") {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-[32rem] flex-col items-center justify-center gap-md px-lg text-center">
        <h1 className="font-serif text-title text-ink">Signing out</h1>
        <p className="text-body text-grey" role="status">
          {state.phase === "pending"
            ? "Locking this device and confirming online sign-out."
            : messages[state.result]}
        </p>
        {state.phase === "unresolved" && (
          <button
            type="button"
            className="min-h-11 rounded-pill border border-rule-strong px-lg py-sm text-control text-ink focus-ring"
            onClick={beginSignOut}
          >
            Retry sign-out
          </button>
        )}
      </main>
    );
  }

  return (
    <BoundaryContext.Provider
      value={{ beginSignOut, signOutInProgress: false }}
    >
      {children}
    </BoundaryContext.Provider>
  );
}
