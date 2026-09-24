import { NextResponse, type NextRequest } from "next/server";
import {
  DEVICE_LOCK_COOKIE_NAME,
  deviceLockCookieOptions,
  HARD_DEVICE_LOCK,
} from "@/domains/offline/device-lock";
import {
  __ACTIVE_RESTAURANT_COOKIE_NAME__,
  clearActiveRestaurant,
} from "@/lib/api/active-restaurant";
import { loginUrl } from "@/lib/auth/redirects";
import {
  hasSameOriginEvidence,
  isInternalSignOut,
} from "@/lib/auth/same-origin-request";
import { createClient } from "@/lib/supabase/server";

const SAFE_HEADERS = {
  "Cache-Control": "no-store",
  "Referrer-Policy": "no-referrer",
};

export async function POST(request: NextRequest) {
  if (!hasSameOriginEvidence(request.headers)) {
    return new NextResponse("Forbidden.", { status: 403, headers: SAFE_HEADERS });
  }

  let activeRestaurantCleared = true;
  try {
    await clearActiveRestaurant();
  } catch {
    activeRestaurantCleared = false;
  }

  let confirmed = false;
  try {
    const supabase = await createClient();
    const { error } = await supabase.auth.signOut({ scope: "global" });
    confirmed = error === null;
  } catch {
    confirmed = false;
  }

  let response: NextResponse;
  if (!confirmed) {
    response = new NextResponse("Sign-out not confirmed.", {
      status: 503,
      headers: SAFE_HEADERS,
    });
  } else if (isInternalSignOut(request.headers)) {
    response = new NextResponse(null, { status: 204, headers: SAFE_HEADERS });
  } else {
    response = NextResponse.redirect(loginUrl(), {
      status: 303,
      headers: SAFE_HEADERS,
    });
  }

  if (!activeRestaurantCleared) {
    response.cookies.set(__ACTIVE_RESTAURANT_COOKIE_NAME__, "", {
      path: "/",
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 0,
    });
  }
  response.cookies.set(
    DEVICE_LOCK_COOKIE_NAME,
    HARD_DEVICE_LOCK,
    deviceLockCookieOptions(),
  );
  return response;
}
