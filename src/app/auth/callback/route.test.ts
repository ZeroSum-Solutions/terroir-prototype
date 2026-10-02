import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  cookieSet: vi.fn(),
  cookies: vi.fn(),
  createClient: vi.fn(),
  exchangeCodeForSession: vi.fn(),
}));

vi.mock("next/headers", () => ({ cookies: mocks.cookies }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));

const { GET } = await import("./route");

let scheduledCookies = new Map<string, string>();
let failDeviceLockWrite = false;

function mutableCookieStore() {
  return {
    get(name: string) {
      const value = scheduledCookies.get(name);
      return value === undefined ? undefined : { name, value };
    },
    set(name: string, value: string, options: unknown) {
      mocks.cookieSet(name, value, options);
      if (failDeviceLockWrite && name === "terroir_device_locked") {
        throw new Error("private detail");
      }
      scheduledCookies.set(name, value);
    },
  };
}

function request(path: string) {
  return new NextRequest(`https://untrusted-request.example${path}`, {
    headers: {
      host: "untrusted-request.example",
      "x-forwarded-host": "evil.example",
    },
  });
}

describe("GET /auth/callback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://staging.terroir.example");
    mocks.createClient.mockResolvedValue({
      auth: { exchangeCodeForSession: mocks.exchangeCodeForSession },
    });
    scheduledCookies = new Map();
    failDeviceLockWrite = false;
    mocks.cookies.mockResolvedValue(mutableCookieStore());
    mocks.exchangeCodeForSession.mockResolvedValue({
      data: { session: { access_token: "session" } },
      error: null,
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("exchanges a code and returns to a safe path on the configured origin", async () => {
    const response = await GET(
      request("/auth/callback?code=valid&next=%2Fcellar%3Ftab%3Dreds"),
    );

    expect(mocks.exchangeCodeForSession).toHaveBeenCalledWith("valid");
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      "https://staging.terroir.example/cellar?tab=reds",
    );
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(mocks.cookieSet).toHaveBeenCalledWith(
      "terroir_device_locked",
      "reprovision_required",
      expect.objectContaining({ path: "/", maxAge: 34_560_000 }),
    );
    expect(mocks.cookieSet).toHaveBeenCalledWith(
      "terroir_authorization_generation",
      expect.stringMatching(/^[0-9a-f-]{36}$/i),
      expect.objectContaining({ path: "/", maxAge: 34_560_000 }),
    );
    expect(mocks.cookieSet).toHaveBeenCalledTimes(2);
  });

  it("uses one generic redirect when the code is missing", async () => {
    const response = await GET(request("/auth/callback?next=%2Fcellar"));
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      "https://staging.terroir.example/login?error=link",
    );
  });

  it("returns the normal callback under hard denial when generation rotation is unavailable", async () => {
    vi.stubGlobal("crypto", {});
    scheduledCookies.set(
      "terroir_authorization_generation",
      "10000000-0000-4000-8000-000000000010",
    );

    const response = await GET(request("/auth/callback?code=valid&next=%2Fcellar"));

    expect(response.headers.get("location"))
      .toBe("https://staging.terroir.example/cellar");
    expect(scheduledCookies.get("terroir_authorization_generation"))
      .toBe("10000000-0000-4000-8000-000000000010");
    expect(scheduledCookies.get("terroir_device_locked")).toBe("1");
    expect(mocks.cookieSet).not.toHaveBeenCalledWith(
      "terroir_device_locked",
      "reprovision_required",
      expect.anything(),
    );
  });

  it("maps hard-denial scheduling failure to the existing generic callback failure", async () => {
    vi.stubGlobal("crypto", {});
    failDeviceLockWrite = true;

    const response = await GET(request("/auth/callback?code=valid&next=%2Fcellar"));

    expect(response.headers.get("location"))
      .toBe("https://staging.terroir.example/login?error=link");
    expect(scheduledCookies.has("terroir_device_locked")).toBe(false);
  });

  it("maps provider failures to the same generic redirect", async () => {
    mocks.exchangeCodeForSession.mockResolvedValue({
      data: { session: null },
      error: { message: "provider-secret" },
    });
    const response = await GET(
      request("/auth/callback?code=expired&next=%2Fcellar"),
    );
    const location = response.headers.get("location") ?? "";
    expect(location).toBe("https://staging.terroir.example/login?error=link");
    expect(location).not.toContain("provider-secret");
    expect(location).not.toContain("next");
    expect(mocks.cookieSet).not.toHaveBeenCalled();
  });

  it("does not write transition state without a returned session", async () => {
    mocks.exchangeCodeForSession.mockResolvedValue({
      data: { session: null },
      error: null,
    });
    await GET(request("/auth/callback?code=valid"));
    expect(mocks.cookieSet).not.toHaveBeenCalled();
  });

  it("opens the password form when recovery returns through the PKCE callback", async () => {
    const response = await GET(
      request("/auth/callback?code=valid&next=%2Fauth%2Freset-password"),
    );
    expect(response.headers.get("location")).toBe(
      "https://staging.terroir.example/auth/reset-password",
    );
  });

  it("rejects a protocol-relative destination after a valid exchange", async () => {
    const response = await GET(
      request("/auth/callback?code=valid&next=%2F%2Fevil.example"),
    );
    expect(response.headers.get("location")).toBe(
      "https://staging.terroir.example/",
    );
  });
});
