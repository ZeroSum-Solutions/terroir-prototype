import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { init } = vi.hoisted(() => ({ init: vi.fn() }));
vi.mock("@sentry/nextjs", () => ({ init }));

describe("server error-monitoring privacy", () => {
  beforeEach(() => {
    vi.resetModules();
    init.mockClear();
    vi.stubEnv("SENTRY_DSN", "");
  });

  afterEach(() => vi.unstubAllEnvs());

  it.each(["production", "test", "development"])(
    "does not collect request or auth locals in %s",
    async (environment) => {
      vi.stubEnv("NODE_ENV", environment);
      await import("../../../sentry.server.config");

      expect(init).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
        includeLocalVariables: false,
        sendDefaultPii: false,
      }));
    },
  );
});
