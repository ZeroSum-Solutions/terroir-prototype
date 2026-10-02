import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import {
  HARD_DEVICE_LOCK,
  readDeviceLockMarker,
} from "@/domains/offline/device-lock";
import type { Database } from "@/types/database";
import {
  getSupabasePublicConfig,
  isProductionRuntime,
} from "@/lib/supabase/config";

const PUBLIC_PATHS = [
  "/login",
  "/auth/callback",
  "/auth/confirm",
  "/api/dev-login",
  "/list",
  "/invite",
];
const DEFERRED_SIGN_OUT_MS = 1_500;

type ProxyClock = {
  setTimeout: (callback: () => void, delay: number) => () => void;
};
type UpdateSessionOptions = { clock?: ProxyClock };
type ApplyCookie = (response: NextResponse) => void;

const defaultClock: ProxyClock = {
  setTimeout(callback, delay) {
    const handle = globalThis.setTimeout(callback, delay);
    return () => globalThis.clearTimeout(handle);
  },
};

function isPublic(pathname: string) {
  return PUBLIC_PATHS.some(
    (path) => pathname === path || pathname.startsWith(`${path}/`),
  );
}

function redirectToLogin(request: NextRequest) {
  const url = request.nextUrl.clone();
  const next = `${request.nextUrl.pathname}${request.nextUrl.search}`;
  url.pathname = "/login";
  url.search = "";
  url.searchParams.set("next", next);
  return NextResponse.redirect(url);
}

function passesDirectlyToAuthHandler(request: NextRequest): boolean {
  const { pathname } = request.nextUrl;
  return pathname === "/auth/signout" ||
    pathname === "/auth/callback" ||
    pathname === "/auth/confirm" ||
    (pathname === "/login" && request.method === "POST");
}

function isResetPassword(pathname: string): boolean {
  return pathname === "/auth/reset-password" ||
    pathname.startsWith("/auth/reset-password/");
}

function isDeferredCleanupDocument(request: NextRequest): boolean {
  const headers = request.headers;
  return request.method === "GET" &&
    headers.get("sec-fetch-site") === "same-origin" &&
    headers.get("sec-fetch-mode") === "navigate" &&
    headers.get("sec-fetch-dest") === "document" &&
    headers.get("rsc") !== "1" &&
    headers.get("next-router-prefetch") !== "1" &&
    headers.get("purpose") !== "prefetch";
}

function createSessionClient(
  request: NextRequest,
  cookieWrites: ApplyCookie[],
) {
  const config = getSupabasePublicConfig();
  if (!config) return null;
  return createServerClient<Database>(config.url, config.publishableKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) =>
          request.cookies.set(name, value),
        );
        cookiesToSet.forEach(({ name, value, options }) => {
          cookieWrites.push((response) =>
            response.cookies.set(name, value, options),
          );
        });
      },
    },
  });
}

function applyCookieWrites(response: NextResponse, writes: ApplyCookie[]) {
  for (const apply of writes) apply(response);
  return response;
}

async function settleDeferredSignOut(
  operation: Promise<unknown>,
  clock: ProxyClock,
): Promise<void> {
  let settled = false;
  await new Promise<void>((resolve) => {
    let cancelDeadline: () => void = () => undefined;
    const finish = () => {
      if (settled) return;
      settled = true;
      cancelDeadline();
      resolve();
    };
    cancelDeadline = clock.setTimeout(finish, DEFERRED_SIGN_OUT_MS);
    operation.then(finish, finish);
  });
  void operation.catch(() => undefined);
}

/**
 * Refresh the verified Supabase session and enforce the deny-only device marker.
 * The marker never authorizes an API or cached offline read.
 */
export async function updateSession(
  request: NextRequest,
  options: UpdateSessionOptions = {},
) {
  if (passesDirectlyToAuthHandler(request)) {
    return NextResponse.next({ request });
  }

  const { pathname } = request.nextUrl;
  const marker = readDeviceLockMarker(request.headers.get("cookie") ?? "");
  const hardDenied = marker === HARD_DEVICE_LOCK && !isResetPassword(pathname);

  if (hardDenied) {
    const response = pathname === "/login"
      ? NextResponse.next({ request })
      : redirectToLogin(request);
    if (!isDeferredCleanupDocument(request)) return response;

    const cookieWrites: ApplyCookie[] = [];
    const supabase = createSessionClient(request, cookieWrites);
    if (!supabase) return response;
    let operation: Promise<unknown>;
    try {
      operation = Promise.resolve(supabase.auth.signOut({ scope: "local" }));
    } catch {
      operation = Promise.reject(new Error("deferred sign-out unavailable"));
    }
    await settleDeferredSignOut(operation, options.clock ?? defaultClock);
    return applyCookieWrites(response, cookieWrites);
  }

  const cookieWrites: ApplyCookie[] = [];
  const supabase = createSessionClient(request, cookieWrites);
  if (!supabase) {
    if (isProductionRuntime()) {
      return new NextResponse("Service unavailable.", { status: 503 });
    }
    return isPublic(pathname)
      ? NextResponse.next({ request })
      : redirectToLogin(request);
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  let response: NextResponse;
  if (!user && !isPublic(pathname) && !isResetPassword(pathname)) {
    response = redirectToLogin(request);
  } else if (!user && isResetPassword(pathname)) {
    response = redirectToLogin(request);
  } else if (user && pathname === "/login") {
    response = NextResponse.redirect(new URL("/", request.url));
  } else {
    response = NextResponse.next({ request });
  }

  return applyCookieWrites(response, cookieWrites);
}
