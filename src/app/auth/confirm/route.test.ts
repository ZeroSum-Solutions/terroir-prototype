import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  cookieSet: vi.fn(),
  cookies: vi.fn(),
  createClient: vi.fn(),
  verifyOtp: vi.fn(),
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
  return new NextRequest(`https://untrusted-request.example${path}`);
}

describe("GET /auth/confirm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://staging.terroir.example");
    mocks.createClient.mockResolvedValue({ auth: { verifyOtp: mocks.verifyOtp } });
    scheduledCookies = new Map();
    failDeviceLockWrite = false;
    mocks.cookies.mockResolvedValue(mutableCookieStore());
    mocks.verifyOtp.mockResolvedValue({
      data: { session: { access_token: "session" } },
      error: null,
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("exchanges a recovery token and opens the reset page", async () => {
    const response = await GET(
      request("/auth/confirm?token_hash=recovery-proof&type=recovery"),
    );
    expect(mocks.verifyOtp).toHaveBeenCalledWith({
      type: "recovery",
      token_hash: "recovery-proof",
    });
    expect(response.headers.get("location")).toBe(
      "https://staging.terroir.example/auth/reset-password",
    );
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

  it("does not exchange a non-recovery token", async () => {
    const response = await GET(
      request("/auth/confirm?token_hash=proof&type=magiclink"),
    );
    expect(response.headers.get("location")).toBe(
      "https://staging.terroir.example/login?error=link",
    );
    expect(mocks.verifyOtp).not.toHaveBeenCalled();
  });

  it("opens reset under hard denial when generation rotation is unavailable", async () => {
    vi.stubGlobal("crypto", {});
    scheduledCookies.set(
      "terroir_authorization_generation",
      "10000000-0000-4000-8000-000000000010",
    );

    const response = await GET(
      request("/auth/confirm?token_hash=recovery-proof&type=recovery"),
    );

    expect(response.headers.get("location"))
      .toBe("https://staging.terroir.example/auth/reset-password");
    expect(scheduledCookies.get("terroir_authorization_generation"))
      .toBe("10000000-0000-4000-8000-000000000010");
    expect(scheduledCookies.get("terroir_device_locked")).toBe("1");
    expect(mocks.cookieSet).not.toHaveBeenCalledWith(
      "terroir_device_locked",
      "reprovision_required",
      expect.anything(),
    );
  });

  it("maps hard-denial scheduling failure to the existing generic recovery failure", async () => {
    vi.stubGlobal("crypto", {});
    failDeviceLockWrite = true;

    const response = await GET(
      request("/auth/confirm?token_hash=recovery-proof&type=recovery"),
    );

    expect(response.headers.get("location"))
      .toBe("https://staging.terroir.example/login?error=link");
    expect(scheduledCookies.has("terroir_device_locked")).toBe(false);
  });

  it("maps an expired provider token to the generic recovery redirect", async () => {
    mocks.verifyOtp.mockResolvedValue({ error: { message: "expired secret" } });
    const response = await GET(
      request("/auth/confirm?token_hash=expired&type=recovery"),
    );
    expect(response.headers.get("location")).toBe(
      "https://staging.terroir.example/login?error=link",
    );
    expect(mocks.cookieSet).not.toHaveBeenCalled();
  });
});
