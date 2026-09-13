import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getAuthContext: vi.fn(),
  redirect: vi.fn((href: string) => {
    throw new Error(`redirect:${href}`);
  }),
}));

vi.mock("@/lib/auth-context", () => ({
  getAuthContext: mocks.getAuthContext,
}));

vi.mock("next/navigation", () => ({
  redirect: mocks.redirect,
}));

import Home from "./page";

describe("public root", () => {
  beforeEach(() => vi.clearAllMocks());

  it("sends an authenticated member to the shared Home", async () => {
    mocks.getAuthContext.mockResolvedValue({ userRole: "staff" });
    await expect(Home()).rejects.toThrow("redirect:/home");
    expect(mocks.redirect).toHaveBeenCalledWith("/home");
  });

  it("keeps unauthenticated visitors on the login flow", async () => {
    mocks.getAuthContext.mockResolvedValue(null);
    await expect(Home()).rejects.toThrow("redirect:/login");
    expect(mocks.redirect).toHaveBeenCalledWith("/login");
  });
});
