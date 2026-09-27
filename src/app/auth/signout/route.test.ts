import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import {
  AUTHORIZATION_GENERATION_COOKIE_NAME,
  DEVICE_LOCK_COOKIE_NAME,
  HARD_DEVICE_LOCK,
} from "@/domains/offline/device-lock";
import {
  hasSameOriginEvidence,
  INTERNAL_SIGNOUT_HEADER,
  INTERNAL_SIGNOUT_VALUE,
} from "@/lib/auth/same-origin-request";

const mocks = vi.hoisted(() => ({
  clearActiveRestaurant: vi.fn(),
  createClient: vi.fn(),
  signOut: vi.fn(),
}));

vi.mock("@/lib/api/active-restaurant", () => ({
  __ACTIVE_RESTAURANT_COOKIE_NAME__: "active_restaurant_id",
  clearActiveRestaurant: mocks.clearActiveRestaurant,
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));

const { POST } = await import("./route");

function request(headers: Record<string, string> = {}) {
  return { headers: new Headers(headers) } as NextRequest;
}

function expectSafetyHeaders(response: Response) {
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("referrer-policy")).toBe("no-referrer");
}

const rejectedOriginHeaders: Array<Record<string, string>> = [
  {},
  { "sec-fetch-site": "cross-site" },
  { "sec-fetch-site": "same-site" },
  { "sec-fetch-site": "none" },
  { origin: "not an origin" },
  { origin: "https://evil.example" },
];

describe("POST /auth/signout", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://terroir.example");
    mocks.clearActiveRestaurant.mockResolvedValue(undefined);
    mocks.createClient.mockResolvedValue({ auth: { signOut: mocks.signOut } });
    mocks.signOut.mockResolvedValue({ error: null });
  });

  afterEach(() => vi.unstubAllEnvs());

  it.each(rejectedOriginHeaders)("rejects missing or foreign origin evidence without side effects", async (headers) => {
    const response = await POST(request(headers));

    expect(response.status).toBe(403);
    expectSafetyHeaders(response);
    expect(mocks.clearActiveRestaurant).not.toHaveBeenCalled();
    expect(mocks.createClient).not.toHaveBeenCalled();
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("returns 204 only for confirmed internal same-origin sign-out", async () => {
    const acceptedRequest = request({
      "sec-fetch-site": "same-origin",
      [INTERNAL_SIGNOUT_HEADER]: INTERNAL_SIGNOUT_VALUE,
    });
    expect(hasSameOriginEvidence(acceptedRequest.headers)).toBe(true);
    const response = await POST(acceptedRequest);

    expect(response.status).toBe(204);
    expect(mocks.clearActiveRestaurant).toHaveBeenCalledOnce();
    expect(mocks.signOut).toHaveBeenCalledWith({ scope: "global" });
    expect(response.cookies.get(DEVICE_LOCK_COOKIE_NAME)?.value).toBe(
      HARD_DEVICE_LOCK,
    );
    expect(response.cookies.get(AUTHORIZATION_GENERATION_COOKIE_NAME)?.value)
      .toMatch(/^[0-9a-f-]{36}$/i);
    expectSafetyHeaders(response);
  });

  it("redirects a confirmed native form from exact configured Origin", async () => {
    const response = await POST(
      request({ origin: "https://terroir.example" }),
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("https://terroir.example/login");
    expect(response.cookies.get(DEVICE_LOCK_COOKIE_NAME)?.value).toBe(
      HARD_DEVICE_LOCK,
    );
  });

  it.each(["returned", "thrown"])(
    "returns one generic 503 for a %s provider failure and still writes hard state",
    async (kind) => {
      if (kind === "returned") {
        mocks.signOut.mockResolvedValue({ error: { message: "private detail" } });
      } else {
        mocks.signOut.mockRejectedValue(new Error("private detail"));
      }

      const response = await POST(
        request({ "sec-fetch-site": "same-origin" }),
      );
      const text = await response.text();

      expect(response.status).toBe(503);
      expect(text).toBe("Sign-out not confirmed.");
      expect(text).not.toContain("private detail");
      expect(response.cookies.get(DEVICE_LOCK_COOKIE_NAME)?.value).toBe(
        HARD_DEVICE_LOCK,
      );
      expect(mocks.clearActiveRestaurant).toHaveBeenCalledOnce();
      expectSafetyHeaders(response);
    },
  );

  it("still attempts global sign-out and expires the active cookie when its primary clear throws", async () => {
    mocks.clearActiveRestaurant.mockRejectedValue(new Error("cookie store denied"));

    const response = await POST(
      request({ "sec-fetch-site": "same-origin" }),
    );

    expect(response.status).toBe(303);
    expect(mocks.signOut).toHaveBeenCalledWith({ scope: "global" });
    expect(response.cookies.get("active_restaurant_id")).toMatchObject({
      value: "",
      path: "/",
      httpOnly: true,
      sameSite: "lax",
      secure: true,
    });
    expect(response.cookies.get(DEVICE_LOCK_COOKIE_NAME)?.value).toBe(
      HARD_DEVICE_LOCK,
    );
  });
});
