import { beforeEach, describe, expect, it, vi } from "vitest";
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

function request(path: string) {
  return new NextRequest(`https://untrusted-request.example${path}`);
}

describe("GET /auth/confirm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://staging.terroir.example");
    mocks.createClient.mockResolvedValue({ auth: { verifyOtp: mocks.verifyOtp } });
    mocks.cookies.mockResolvedValue({ set: mocks.cookieSet });
    mocks.verifyOtp.mockResolvedValue({
      data: { session: { access_token: "session" } },
      error: null,
    });
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
