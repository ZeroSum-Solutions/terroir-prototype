import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import {
  DEVICE_LOCK_COOKIE_NAME,
  HARD_DEVICE_LOCK,
  readDeviceLockMarker,
  REPROVISION_REQUIRED,
} from "@/domains/offline/device-lock";

const mocks = vi.hoisted(() => ({
  createServerClient: vi.fn(),
  getUser: vi.fn(),
  signOut: vi.fn(),
}));

vi.mock("@supabase/ssr", () => ({
  createServerClient: mocks.createServerClient,
}));

import { updateSession } from "@/lib/supabase/proxy";

type CookieAdapter = {
  setAll: (
    values: Array<{
      name: string;
      value: string;
      options?: { path?: string; maxAge?: number };
    }>,
  ) => void;
};

function requestFor(
  path: string,
  init: {
    method?: string;
    marker?: string;
    cookieHeader?: string;
    headers?: Record<string, string>;
  } = {},
) {
  const headers = new Headers(init.headers);
  if (init.cookieHeader) headers.set("cookie", init.cookieHeader);
  if (init.marker) {
    headers.set("cookie", `${DEVICE_LOCK_COOKIE_NAME}=${init.marker}`);
  }
  const request = new NextRequest(`http://localhost:3000${path}`, {
    method: init.method,
    headers,
  });
  Object.defineProperty(request, "headers", { value: headers });
  return request;
}

function documentHeaders(overrides: Record<string, string> = {}) {
  return {
    "sec-fetch-site": "same-origin",
    "sec-fetch-mode": "navigate",
    "sec-fetch-dest": "document",
    ...overrides,
  };
}

function createControlledClock() {
  let deadline: (() => void) | undefined;
  return {
    clock: {
      setTimeout(callback: () => void) {
        deadline = callback;
        return () => {
          deadline = undefined;
        };
      },
    },
    expire() {
      deadline?.();
    },
  };
}

describe("updateSession", () => {
  let cookieAdapter: CookieAdapter | undefined;

  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:57321");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "test-public-key");
    vi.stubEnv("NODE_ENV", "test");
    mocks.getUser.mockResolvedValue({ data: { user: null } });
    mocks.signOut.mockResolvedValue({ error: null });
    mocks.createServerClient.mockImplementation(
      (_url: string, _key: string, options: { cookies: CookieAdapter }) => {
        cookieAdapter = options.cookies;
        return { auth: { getUser: mocks.getUser, signOut: mocks.signOut } };
      },
    );
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
  });

  it.each([
    ["/auth/signout", "GET"],
    ["/auth/callback?code=proof", "GET"],
    ["/auth/confirm?token_hash=proof&type=recovery", "GET"],
    ["/login", "POST"],
  ])("passes %s %s directly to its auth handler", async (path, method) => {
    const response = await updateSession(
      requestFor(path, { method, marker: HARD_DEVICE_LOCK }),
    );
    expect(response.status).toBe(200);
    expect(mocks.createServerClient).not.toHaveBeenCalled();
  });

  it("keeps a hard-locked login renderable without refreshing auth", async () => {
    const request = requestFor("/login", { marker: HARD_DEVICE_LOCK });
    expect(readDeviceLockMarker(request.headers.get("cookie") ?? "")).toBe(
      HARD_DEVICE_LOCK,
    );
    const response = await updateSession(request);
    expect(response.status).toBe(200);
    expect(mocks.createServerClient).not.toHaveBeenCalled();
  });

  it("redirects hard-locked protected pages without refreshing auth", async () => {
    const response = await updateSession(
      requestFor("/cellar", { marker: HARD_DEVICE_LOCK }),
    );
    expect(response.status).toBe(307);
    expect(new URL(response.headers.get("location") ?? "").pathname).toBe(
      "/login",
    );
    expect(mocks.createServerClient).not.toHaveBeenCalled();
  });

  it.each([
    `${DEVICE_LOCK_COOKIE_NAME}=unknown; ${DEVICE_LOCK_COOKIE_NAME}=1`,
    `${DEVICE_LOCK_COOKIE_NAME}=1; ${DEVICE_LOCK_COOKIE_NAME}=unknown`,
    `${DEVICE_LOCK_COOKIE_NAME}=${REPROVISION_REQUIRED}; ${DEVICE_LOCK_COOKIE_NAME}=1`,
    `${DEVICE_LOCK_COOKIE_NAME}=1; ${DEVICE_LOCK_COOKIE_NAME}=${REPROVISION_REQUIRED}`,
  ])("keeps the strongest duplicate cookie denial for %s", async (cookieHeader) => {
    const response = await updateSession(
      requestFor("/cellar", { cookieHeader }),
    );
    expect(response.status).toBe(307);
    expect(mocks.createServerClient).not.toHaveBeenCalled();
  });

  it("attempts bounded local provider cleanup only for same-origin documents", async () => {
    mocks.signOut.mockImplementation(async () => {
      cookieAdapter?.setAll([
        { name: "sb-refresh", value: "expired", options: { path: "/" } },
      ]);
      return { error: null };
    });
    const response = await updateSession(
      requestFor("/cellar", {
        marker: HARD_DEVICE_LOCK,
        headers: documentHeaders(),
      }),
    );
    expect(mocks.signOut).toHaveBeenCalledWith({ scope: "local" });
    expect(response.cookies.get("sb-refresh")?.value).toBe("expired");
    expect(response.cookies.get(DEVICE_LOCK_COOKIE_NAME)).toBeUndefined();
  });

  it.each([
    ["RSC", { ...documentHeaders(), rsc: "1" }],
    ["prefetch", { ...documentHeaders(), "next-router-prefetch": "1" }],
    ["purpose prefetch", { ...documentHeaders(), purpose: "prefetch" }],
    ["cross-site", documentHeaders({ "sec-fetch-site": "cross-site" })],
    ["same-site", documentHeaders({ "sec-fetch-site": "same-site" })],
    ["browser-none", documentHeaders({ "sec-fetch-site": "none" })],
    ["missing headers", {}],
  ])("does not run deferred cleanup for %s requests", async (_name, headers) => {
    await updateSession(
      requestFor("/cellar", { marker: HARD_DEVICE_LOCK, headers }),
    );
    expect(mocks.signOut).not.toHaveBeenCalled();
  });

  it("bounds a hung cleanup and drains a late rejection", async () => {
    let rejectSignOut: ((reason?: unknown) => void) | undefined;
    mocks.signOut.mockReturnValue(
      new Promise((_resolve, reject) => {
        rejectSignOut = reject;
      }),
    );
    const controlled = createControlledClock();
    const pending = updateSession(
      requestFor("/cellar", {
        marker: HARD_DEVICE_LOCK,
        headers: documentHeaders(),
      }),
      { clock: controlled.clock },
    );
    controlled.expire();
    const response = await pending;
    rejectSignOut?.(new Error("late provider failure"));
    await Promise.resolve();
    expect(response.status).toBe(307);
    expect(mocks.signOut).toHaveBeenCalledTimes(1);
  });

  it("uses normal verified auth for a transition marker", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: { id: "actor-a" } } });
    const response = await updateSession(
      requestFor("/login", { marker: REPROVISION_REQUIRED }),
    );
    expect(mocks.getUser).toHaveBeenCalledTimes(1);
    expect(new URL(response.headers.get("location") ?? "").pathname).toBe("/");
    expect(response.cookies.get(DEVICE_LOCK_COOKIE_NAME)).toBeUndefined();
  });

  it("keeps transition-marked protected routes behind verified auth", async () => {
    const response = await updateSession(
      requestFor("/cellar", { marker: REPROVISION_REQUIRED }),
    );
    expect(mocks.getUser).toHaveBeenCalledTimes(1);
    expect(response.status).toBe(307);
    expect(new URL(response.headers.get("location") ?? "").pathname).toBe(
      "/login",
    );
    expect(response.cookies.get(DEVICE_LOCK_COOKIE_NAME)).toBeUndefined();
  });

  it("does not treat an unknown marker as online authority", async () => {
    const response = await updateSession(
      requestFor("/cellar", { marker: "unrecognized" }),
    );
    expect(mocks.getUser).toHaveBeenCalledTimes(1);
    expect(response.status).toBe(307);
  });

  it("applies accumulated auth cookie writes to the final response", async () => {
    mocks.getUser.mockImplementation(async () => {
      cookieAdapter?.setAll([
        { name: "sb-session", value: "refreshed", options: { path: "/" } },
      ]);
      return { data: { user: null } };
    });
    const response = await updateSession(requestFor("/cellar"));
    expect(response.cookies.get("sb-session")?.value).toBe("refreshed");
    expect(response.status).toBe(307);
  });

  it.each(["GET", "POST"])(
    "runs reset-password %s through verified session handling",
    async (method) => {
    const response = await updateSession(
      requestFor("/auth/reset-password", { marker: HARD_DEVICE_LOCK, method }),
    );
    expect(mocks.getUser).toHaveBeenCalledTimes(1);
    expect(response.status).toBe(307);
    },
  );
});

describe("updateSession missing Supabase public config", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "");
    vi.stubEnv("NODE_ENV", "test");
  });

  afterEach(() => vi.unstubAllEnvs());

  it("allows public routes in local/test environments", async () => {
    expect((await updateSession(requestFor("/login"))).status).toBe(200);
  });

  it("redirects protected routes and preserves their query", async () => {
    const response = await updateSession(
      requestFor("/cellar?section=reds&page=2"),
    );
    const location = new URL(response.headers.get("location") ?? "");
    expect(location.pathname).toBe("/login");
    expect(location.searchParams.get("next")).toBe(
      "/cellar?section=reds&page=2",
    );
  });

  it("fails closed in production when required config is missing", async () => {
    vi.stubEnv("NODE_ENV", "production");
    expect((await updateSession(requestFor("/login"))).status).toBe(503);
  });
});
