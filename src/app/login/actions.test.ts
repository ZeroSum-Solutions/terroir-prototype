import { beforeEach, describe, expect, it, vi } from "vitest";
import { __resetRateLimitForTests } from "@/lib/api/rate-limit";

class RedirectSignal extends Error {
  constructor(readonly url: string) {
    super(url);
  }
}

const mocks = vi.hoisted(() => ({
  cookieSet: vi.fn(),
  cookies: vi.fn(),
  createClient: vi.fn(),
  headers: vi.fn(),
  redirect: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));
vi.mock("next/headers", () => ({
  cookies: mocks.cookies,
  headers: mocks.headers,
}));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));

const {
  sendMagicLink,
  sendPasswordReset,
  signInWithPassword,
  signUpWithPassword,
} = await import("./actions");

function form(values: Record<string, string>): FormData {
  const result = new FormData();
  for (const [key, value] of Object.entries(values)) result.set(key, value);
  return result;
}

async function redirectedUrl(action: () => Promise<unknown>): Promise<URL> {
  try {
    await action();
  } catch (error) {
    if (error instanceof RedirectSignal) return new URL(error.url);
    throw error;
  }
  throw new Error("expected a redirect");
}

describe("login server actions", () => {
  const auth = {
    signInWithOtp: vi.fn(),
    signInWithPassword: vi.fn(),
    signUp: vi.fn(),
    resetPasswordForEmail: vi.fn(),
  };

  beforeEach(() => {
    __resetRateLimitForTests();
    vi.clearAllMocks();
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "");
    mocks.headers.mockResolvedValue(
      new Headers({ "x-forwarded-for": "198.51.100.7" }),
    );
    mocks.cookies.mockResolvedValue({ set: mocks.cookieSet });
    mocks.redirect.mockImplementation((url: string) => {
      throw new RedirectSignal(url);
    });
    mocks.createClient.mockResolvedValue({ auth });
    auth.signInWithOtp.mockResolvedValue({ error: null });
    auth.signInWithPassword.mockResolvedValue({
      data: { session: { access_token: "session" } },
      error: null,
    });
    auth.signUp.mockResolvedValue({
      data: { session: { access_token: "session" } },
      error: null,
    });
    auth.resetPasswordForEmail.mockResolvedValue({ error: null });
  });

  it("sends a normalized magic-link request with a safe configured callback", async () => {
    const url = await redirectedUrl(() =>
      sendMagicLink(
        form({ email: " PERSON@RESTAURANT.TEST ", next: "//evil.example" }),
      ),
    );

    expect(auth.signInWithOtp).toHaveBeenCalledWith({
      email: "person@restaurant.test",
      options: {
        emailRedirectTo: "http://localhost:3000/auth/callback?next=%2F",
        shouldCreateUser: true,
      },
    });
    expect(url.pathname).toBe("/login");
    expect(url.searchParams.get("sent")).toBe("1");
    expect(url.searchParams.get("email")).toBeNull();
  });

  it("creates a password account without exposing provider detail", async () => {
    const url = await redirectedUrl(() =>
      signUpWithPassword(
        form({
          email: "new@restaurant.test",
          password: "secure-password",
          confirm: "secure-password",
          next: "/cellar?section=reds",
        }),
      ),
    );

    expect(auth.signUp).toHaveBeenCalledWith({
      email: "new@restaurant.test",
      password: "secure-password",
      options: {
        emailRedirectTo:
          "http://localhost:3000/auth/callback?next=%2Fcellar%3Fsection%3Dreds",
      },
    });
    expect(url.searchParams.get("signup")).toBe("1");
    expect(mocks.cookieSet).toHaveBeenCalledWith(
      "terroir_device_locked",
      "reprovision_required",
      expect.objectContaining({ path: "/", maxAge: 34_560_000 }),
    );
  });

  it("preserves marker state when signup returns no session", async () => {
    auth.signUp.mockResolvedValue({ data: { session: null }, error: null });

    await redirectedUrl(() =>
      signUpWithPassword(
        form({
          email: "new@restaurant.test",
          password: "secure-password",
          confirm: "secure-password",
        }),
      ),
    );

    expect(mocks.cookieSet).not.toHaveBeenCalled();
  });

  it("rejects mismatched signup passwords before calling Supabase", async () => {
    const url = await redirectedUrl(() =>
      signUpWithPassword(
        form({
          email: "new@restaurant.test",
          password: "secure-password",
          confirm: "different-password",
        }),
      ),
    );
    expect(url.searchParams.get("error")).toBe("password_mismatch");
    expect(auth.signUp).not.toHaveBeenCalled();
  });

  it("redirects a successful password sign-in to the sanitized intended path", async () => {
    const url = await redirectedUrl(() =>
      signInWithPassword(
        form({
          email: "person@restaurant.test",
          password: "secure-password",
          next: "/cellar?section=reds",
        }),
      ),
    );

    expect(auth.signInWithPassword).toHaveBeenCalledWith({
      email: "person@restaurant.test",
      password: "secure-password",
    });
    expect(url.href).toBe("http://localhost:3000/cellar?section=reds");
    expect(mocks.cookieSet).toHaveBeenCalledWith(
      "terroir_device_locked",
      "reprovision_required",
      expect.objectContaining({ path: "/", maxAge: 34_560_000 }),
    );
  });

  it("maps rejected credentials to one generic response", async () => {
    auth.signInWithPassword.mockResolvedValue({
      data: { session: null },
      error: { message: "Email not confirmed for person@restaurant.test" },
    });

    const url = await redirectedUrl(() =>
      signInWithPassword(
        form({ email: "person@restaurant.test", password: "wrong-password" }),
      ),
    );

    expect(url.searchParams.get("error")).toBe("invalid_credentials");
    expect(url.href).not.toContain("person%40restaurant.test");
    expect(mocks.cookieSet).not.toHaveBeenCalled();
  });

  it("always gives the same password-reset completion response", async () => {
    auth.resetPasswordForEmail.mockResolvedValue({
      error: { message: "User not found: person@restaurant.test" },
    });

    const url = await redirectedUrl(() =>
      sendPasswordReset(form({ email: "person@restaurant.test" })),
    );

    expect(auth.resetPasswordForEmail).toHaveBeenCalledWith(
      "person@restaurant.test",
      {
        redirectTo:
          "http://localhost:3000/auth/callback?next=%2Fauth%2Freset-password",
      },
    );
    expect(url.searchParams.get("reset")).toBe("1");
    expect(url.href).not.toContain("person%40restaurant.test");
  });
});
